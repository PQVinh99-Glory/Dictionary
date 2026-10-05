# HỆ THỐNG TÌM KIẾM & SO KHỚP LINH KIỆN CƠ KHÍ (OFFLINE CLIENT-FIRST)
> Tài liệu kỹ thuật tích hợp bao gồm: **Kiến Trúc AI 3 Lớp (`pipeline-ai.md`)** và **Kế Hoạch Triển Khai Cho Agent (`plan-ai.md`)**.

---

# PHẦN 1: PIPELINE-AI.MD (KIẾN TRÚC KỸ THUẬT HỆ THỐNG)

## 1. Bối Cảnh & Thách Thức Kỹ Thuật

* **Đặc tính sản phẩm:** Linh kiện kim loại dập cơ khí, cùng tone màu (đơn sắc), khác biệt giữa các biến thể có thể $< 5\%$ (chỉ khác vị trí lỗ dập, khoảng cách tâm, hoặc góc gập).
* **Nhiễu môi trường:** Ảnh mẫu trong cơ sở dữ liệu được chụp chuẩn studio (nền đen, góc thẳng), trong khi ảnh đầu vào từ người dùng chụp bằng điện thoại tại xưởng (nền vải/bàn bẩn, ánh sáng loang lổ, góc nghiêng phối cảnh, bị xoay tự do).
* **Ràng buộc hệ thống:** Chạy offline 100% trong Web Worker, không gọi API thị giác bên ngoài, chỉ giao tiếp với Supabase (lưu vector và metadata) và Cloudflare R2 (lưu ảnh).

---

## 2. Luồng Dữ Liệu Tổng Quan (End-to-End Data Flow)

```text
[LUỒNG NẠP MẪU - INGESTION]
Ảnh Phôi Chuẩn (Studio)
   ├──> Cloudflare R2 (Lưu trữ ảnh gốc & thumbnail)
   └──> Preprocessing + Geometry Extraction + DINOv2-small
          └──> Vector 384-d + Metadata (Số lỗ, Tọa độ lỗ, Tỷ lệ)
                 └──> Insert vào Supabase (pgvector)

[LUỒNG TÌM KIẾM - SEARCH CHATBOX]
Ảnh Chụp Điện Thoại
   │
   ▼
[LỚP 1: PREPROCESSING (Web Worker)]
   ├── Tách nền (Background Removal: RMBG-1.4 ONNX hoặc Canvas Thresholding)
   ├── Chuẩn hoá góc xoay ngang (PCA / MinAreaRect)
   └── Crop vật thể & Pad vuông (Aspect Ratio Preserved, 448x448)
   │
   ▼
[LỚP 2: COARSE RETRIEVAL (Worker + Supabase)]
   ├── Trích xuất vector 384-d bằng DINOv2-small (ONNX q8)
   └── RPC Query Supabase pgvector (HNSW Index) -> Lọc Top 10 (Cosine Sim > 0.70)
   │
   ▼
[LỚP 3: GEOMETRIC RE-RANKING (Web Worker / Client Engine)]
   ├── So khớp cấu trúc lỗ (Hole Count & Centroid Distribution)
   ├── So khớp tỷ lệ khung hình & đường biên (Aspect Ratio & Hu Moments)
   └── Tính điểm tổng hợp (Weighted Final Score)
   │
   ▼
[CHATBOX UI]
Hiển thị Top 1-3 ứng viên, % trùng khớp thực tế, cảnh báo sai lệch chi tiết
```

---

## 3. Đặc Tả Chi Tiết 3 Lớp Xử Lý

### Lớp 1: Client Preprocessing Pipeline (Web Worker)
Triệt tiêu hoàn toàn nhiễu từ môi trường chụp trước khi đưa vào mô hình nhận diện.

1. **Ràng buộc UI Camera:**
   * Camera Viewfinder hiển thị khung ngắm định hướng: *"Đặt linh kiện nằm ngang, chụp vuông góc 90° từ trên xuống"*.
   * Giới hạn kích thước ảnh chụp tối đa $1280 \times 1280$ px để đảm bảo hiệu năng tính toán.
2. **Tách nền (Background Removal):**
   * Chạy model **`briaai/RMBG-1.4`** (ONNX quantized `q8`, dung lượng ~40MB) qua ONNX Runtime WebAssembly.
   * Xóa sạch nền bàn, vải nhăn, bóng đổ. Chuyển toàn bộ pixel nền về màu đen tuyệt đối (`RGB: 0, 0, 0`) hoặc kênh Alpha trong suốt.
3. **Căn chỉnh góc xoay ngang (Orientation Normalization):**
   * Tìm đường bao ngoài lớn nhất (External Contour) của vật thể.
   * Dùng thuật toán **PCA (Principal Component Analysis)** hoặc **MinAreaRect** xác định góc lệch $\theta$ của trục chính dài nhất.
   * Xoay ảnh một góc $-\theta$ quanh tâm vật thể để đưa trục dài về phương ngang tuyệt đối.
4. **Padding & Chuẩn hóa kích thước:**
   * Căn giữa vật thể vào khung $448 \times 448$ px.
   * Đệm viền đen đối xứng hai bên, giữ nguyên tỉ lệ co giãn $1:1$ (không làm méo biên dạng linh kiện).

---

### Lớp 2: Coarse Vector Retrieval (Web Worker + Supabase)

1. **Mô hình Embedding:**
   * Model: **`Xenova/dinov2-small`** (ViT-S/14).
   * Cấu hình: ONNX Runtime WebAssembly, Quantization `q8` (~85MB), chạy đa luồng (`numThreads: 2`).
   * Output: Vector đặc trưng 384 chiều, được chuẩn hóa L2 (L2-Normalized).

2. **Cấu trúc Database Supabase (`pgvector`):**

```sql
create extension if not exists vector;

create table public.mechanical_parts (
    id uuid primary key default gen_random_uuid(),
    part_code text not null unique,
    image_r2_url text not null,
    thumbnail_r2_url text not null,
    embedding vector(384) not null,
    hole_count int not null default 0,
    aspect_ratio float not null,
    hole_centroids jsonb default '[]'::jsonb, -- Tọa độ chuẩn hoá [{x: 0.12, y: 0.5}, ...]
    created_at timestamp with time zone default now()
);

-- Index HNSW tối ưu tìm kiếm Cosine Similarity
create index on public.mechanical_parts 
using hnsw (embedding vector_cosine_ops)
with (m = 16, ef_construction = 64);

-- RPC Function tìm kiếm thô Top K
create or replace function match_mechanical_parts(
    query_embedding vector(384),
    match_threshold float,
    match_count int
)
returns table (
    id uuid,
    part_code text,
    image_r2_url text,
    similarity float,
    hole_count int,
    aspect_ratio float,
    hole_centroids jsonb
)
language sql stable as $$
    select
        id,
        part_code,
        image_r2_url,
        1 - (embedding <=> query_embedding) as similarity,
        hole_count,
        aspect_ratio,
        hole_centroids
    from public.mechanical_parts
    where 1 - (embedding <=> query_embedding) > match_threshold
    order by similarity desc
    limit match_count;
$$;
```

---

### Lớp 3: Fine-Grained Geometric Re-Ranking (Xử Lý Sai Lệch < 5%)

Vector toàn cục phản ánh cấu trúc tổng quát nhưng có thể bỏ qua sự khác biệt nhỏ về số lượng lỗ hoặc cự ly gân dập. Lớp 3 thẩm định lại Top 10 ứng viên từ Lớp 2:

1. **Phân tích cấu trúc lỗ (Hole Topology Analysis):**
   * Sử dụng thuật toán phân cấp đường bao (`cv.findContours` với cờ `RETR_TREE`).
   * Lấy tất cả các contour con nằm hoàn toàn bên trong contour chính để đếm số lỗ ($N$).
   * Tính tọa độ tâm chuẩn hóa $(x_i, y_i) \in [0, 1]$ của từng lỗ dọc theo trục hoành $X$.
2. **Công thức chấm điểm tổng hợp:**

$$S_{final} = 0.45 \cdot S_{vec} + 0.40 \cdot S_{holes} + 0.15 \cdot S_{ratio}$$

* $S_{vec}$: Điểm Cosine Similarity từ DINOv2 ($0.0 \rightarrow 1.0$).
* $S_{holes}$: Điểm tương đồng cấu trúc lỗ:
  * Nếu $|N_{Query} - N_{DB}| \ge 1$: $S_{holes} = \max(0, 1 - 0.5 \cdot |N_{Query} - N_{DB}|)$. Sai lệch quá 2 lỗ thì $S_{holes} = 0$.
  * Nếu $N_{Query} = N_{DB} = N$: So khớp khoảng cách tâm các lỗ đã sắp xếp theo trục X:
    $$S_{holes} = 1.0 - \frac{1}{N} \sum_{i=1}^{N} \sqrt{(x_{Q,i} - x_{D,i})^2 + (y_{Q,i} - y_{D,i})^2}$$
* $S_{ratio}$: Độ tương đồng tỷ lệ kích thước bao ngoài:
  $$S_{ratio} = 1.0 - \frac{|AR_{Query} - AR_{DB}|}{\max(AR_{Query}, AR_{DB})}$$

---

# PHẦN 2: PLAN-AI.MD (KẾ HOẠCH TRIỂN KHAI CHO AGENT)

## 1. Cấu Trúc Thư Mục Dự Án (Target Directory Tree)

```text
├── public/
│   └── models/
│       ├── dinov2-small/
│       │   ├── model_quantized.onnx       # ~85MB
│       │   ├── preprocessor_config.json
│       │   └── config.json
│       └── rmbg-1.4/
│           ├── model_quantized.onnx       # ~40MB
│           └── config.json
├── src/
│   ├── workers/
│   │   ├── pipeline.worker.ts             # Entry point của Web Worker
│   │   ├── modules/
│   │   │   ├── background-remover.ts      # Xử lý tách nền bằng RMBG-1.4
│   │   │   ├── orientation-normalizer.ts  # Căn xoay ngang PCA / MinAreaRect
│   │   │   ├── geometry-extractor.ts      # Trích xuất số lỗ & tọa độ tâm
│   │   │   └── dinov2-embedder.ts         # Trích xuất vector 384-d
│   ├── services/
│   │   ├── supabase.ts                    # Client SDK gọi RPC pgvector
│   │   ├── r2-storage.ts                  # Upload ảnh lên Cloudflare R2
│   │   └── reranker.ts                    # Module tính điểm S_final Lớp 3
│   ├── components/
│   │   ├── CameraCaptureModal.tsx         # UI chụp ảnh có khung căn chỉnh
│   │   └── SearchChatbox.tsx              # Giao diện chatbox tìm kiếm linh kiện
│   └── types/
│       └── mechanical-part.ts             # Type definitions
├── supabase/
│   └── migrations/
│       └── 20261005_mechanical_parts.sql  # Migration tạo bảng và hàm RPC
```

---

## 2. Kế Hoạch Triển Khai Theo Giai Đoạn (Milestones & Tasks)

### Giai đoạn 1: Chuẩn Bị Model & Hạ Tầng Dữ Liệu
* [ ] **Task 1.1**: Tải model Quantized ONNX (`Xenova/dinov2-small` và `briaai/RMBG-1.4`) đặt vào thư mục `public/models/`. Cấu hình Vite / Webpack phục vụ file tĩnh với header `Cross-Origin-Opener-Policy: same-origin` và `Cross-Origin-Embedder-Policy: require-corp` để Web Worker dùng được đa luồng `SharedArrayBuffer`.
* [ ] **Task 1.2**: Triển khai file migration SQL trên Supabase (bật extension `vector`, tạo bảng `mechanical_parts`, đánh chỉ mục HNSW, tạo hàm RPC `match_mechanical_parts`).
* [ ] **Task 1.3**: Thiết lập kết nối Cloudflare R2 thông qua S3-compatible client SDK để upload và sinh URL hiển thị ảnh.

### Giai đoạn 2: Xây Dựng Web Worker Pipeline (`pipeline.worker.ts`)
* [ ] **Task 2.1**: Xây dựng module `background-remover.ts`: Nhận `ImageBitmap`/`ImageData`, chạy RMBG-1.4 ONNX, xuất ra `OffscreenCanvas` chứa vật thể đã tách nền.
* [ ] **Task 2.2**: Xây dựng module `orientation-normalizer.ts`: Tìm ma trận covariance của các điểm pixel vật thể để tính vector riêng (PCA), xác định góc nghiêng và xoay ngang vật thể về trục hoành.
* [ ] **Task 2.3**: Xây dựng module `geometry-extractor.ts`: Dùng thuật toán quét đường bao trên Canvas/OpenCV để đếm số lỗ rỗng và tính mảng tọa độ tâm $(x, y)$ chuẩn hóa.
* [ ] **Task 2.4**: Xây dựng module `dinov2-embedder.ts`: Tích hợp `@huggingface/transformers`, load model từ thư mục tĩnh local, trích xuất vector 384-d với `pooling: 'mean'` và `normalize: true`.
* [ ] **Task 2.5**: Tích hợp luồng worker chính: Nhận message `{ action: 'PROCESS_IMAGE', blob }` $\rightarrow$ tuần tự thực thi qua 4 module $\rightarrow$ trả về `{ embedding, metadata: { hole_count, aspect_ratio, hole_centroids }, processedBlob }`.

### Giai đoạn 3: Luồng Nạp Mẫu (Data Ingestion Pipeline)
* [ ] **Task 3.1**: Xây dựng trang Admin Ingestion: Cho phép upload ảnh phôi chuẩn, nhập mã linh kiện (`part_code`).
* [ ] **Task 3.2**: Kích hoạt worker xử lý ảnh mẫu $\rightarrow$ đẩy ảnh gốc & ảnh đã tiền xử lý lên Cloudflare R2.
* [ ] **Task 3.3**: Ghi bản ghi hoàn chỉnh (mã, URL ảnh R2, vector 384-d, số lỗ, tọa độ tâm) vào Supabase `mechanical_parts`.

### Giai đoạn 4: Re-Ranking Engine & Chatbox Tìm Kiếm
* [ ] **Task 4.1**: Viết module `reranker.ts` trên client: Nhận Top 10 ứng viên từ Supabase RPC và metadata của ảnh chụp $\rightarrow$ tính $S_{final}$ theo công thức trọng số $\rightarrow$ sắp xếp lại danh sách.
* [ ] **Task 4.2**: Xây dựng component `CameraCaptureModal`: Tích hợp canvas hướng dẫn (hộp chữ nhật căn giữa + nhắc nhở chụp góc 90°).
* [ ] **Task 4.3**: Xây dựng component `SearchChatbox`:
  * Người dùng chụp/gửi ảnh vào khung chat.
  * Hiển thị trạng thái tiến trình từng bước:
    1. *Đang tách nền & chuẩn hóa góc chụp...*
    2. *Đang phân tích vector hình học (DINOv2)...*
    3. *Đang so khớp chi tiết lỗ và tỷ lệ...*
  * Trả về kết quả: Ảnh mẫu R2 khớp nhất, mã linh kiện, thanh phần trăm độ tương đồng ($S_{final} \times 100\%$).
  * Nếu điểm tương đồng $< 90\%$, hiển thị cảnh báo chi tiết (ví dụ: *"Khớp kiểu dáng (95%) nhưng sai khác số lượng lỗ: Ảnh chụp có 3 lỗ, mẫu DB có 4 lỗ"*).

---

## 3. Quản Trị Rủi Ro & Giải Pháp Kỹ Thuật (Edge Cases)

| Tình huống thực tế | Rủi ro | Giải pháp kỹ thuật xử lý |
| :--- | :--- | :--- |
| **Linh kiện bị lật mặt sau** | Cụm lỗ bị đối xứng gương theo chiều ngang. | Trong `reranker.ts`, tính song song 2 kịch bản: Tọa độ gốc $x_i$ và tọa độ đảo gương $1.0 - x_i$. Lấy điểm số cao nhất trong hai trường hợp. |
| **Phôi kim loại bị chói sáng** | Mất biên dạng một số lỗ nhỏ do phản chiếu ánh kim. | Thêm bước cân bằng sáng cục bộ (CLAHE) trên canvas trước khi nhị phân hóa tìm lỗ. |
| **Nền vải quá bẩn / dính phôi vụn** | Xuất hiện các blob rác nhỏ xung quanh. | Đặt ngưỡng lọc diện tích (Area Threshold): Chỉ giữ lại contour lớn nhất làm thân chi tiết, bỏ toàn bộ các contour bên ngoài có diện tích $< 2\%$ diện tích phôi. |
| **Trình duyệt không hỗ trợ WebGPU** | Tốc độ suy luận model bị chậm. | Đặt fallback cấu hình ONNX Runtime: Ưu tiên `webgpu`, nếu không khả dụng tự động chuyển sang `wasm` đa luồng (`numThreads: 2` hoặc `4`). |

---

## 4. Tiêu Chí Nghiệm Thu (Definition of Done - DoD)
1. **Độc lập Offline:** Ứng dụng chạy trên trình duyệt không phát sinh bất kỳ HTTP request nào ra ngoài miền (ngoại trừ Supabase database và Cloudflare R2 chứa ảnh).
2. **Thời gian phản hồi:** Tổng thời gian từ lúc bấm chụp ảnh đến khi hiển thị kết quả trong Chatbox $\le 2.5$ giây trên desktop và $\le 4.5$ giây trên smartphone tầm trung.
3. **Độ chính xác so khớp:** Phân biệt chính xác $100\%$ các trường hợp phôi giống nhau về kiểu dáng nhưng khác nhau về số lượng hoặc vị trí lỗ (sai lệch $< 5\%$).