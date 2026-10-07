# LỘ TRÌNH TRIỂN KHAI NÂNG CẤP HỆ THỐNG AI TÌM KIẾM & SO KHỚP LINH KIỆN CƠ KHÍ

> **Phiên bản tài liệu:** 1.0.0  
> **Trạng thái:** Kế hoạch lập checklist thẩm định (Chưa can thiệp code logic AI, chờ duyệt)  
> **Mục tiêu:** Nâng cấp kiến trúc tìm kiếm ảnh linh kiện cơ khí theo mô hình 3 lớp, giải quyết triệt để bài toán nhận diện các chi tiết dập kim loại cùng màu có sai khác hình học $< 5\%$ (khác số lỗ, khoảng cách tâm lỗ, góc gập hoặc tỷ lệ kích thước).

---

## I. TỔNG QUAN KIẾN TRÚC 3 LỚP (ARCHITECTURE OVERVIEW)

```
[ẢNH ĐẦU VÀO: CHỤP ĐIỆN THOẠI TẠI XƯỞNG]
  │ (Góc chụp tự do, nền bàn/vải bẩn, ánh sáng loang lổ)
  ▼
[LỚP 1: PREPROCESSING PIPELINE (Web Worker Client)]
  ├── 1. Xóa nền bàn/vải bằng model RMBG-1.4 ONNX (hoặc Thresholding Canvas) -> Nền đen tuyệt đối
  ├── 2. Căn xoay ngang chuẩn hóa bằng thuật toán PCA / MinAreaRect (Trục dài luôn nằm ngang)
  └── 3. Bounding box crop & Pad đối xứng khung vuông 448x448 (Bảo toàn tỉ lệ 1:1)
  │
  ▼
[LỚP 2: COARSE VECTOR RETRIEVAL (Web Worker + Supabase pgvector)]
  ├── 1. Trích xuất embedding 384-d bằng DINOv2-small (ViT-S/14 quantized q8)
  └── 2. RPC Supabase HNSW Index lọc nhanh Top 10 ứng viên (Cosine Similarity > 0.70)
  │
  ▼
[LỚP 3: GEOMETRIC RE-RANKING (Client-side Topology Engine)]
  ├── 1. So khớp cấu trúc lỗ: Số lỗ rỗng (Hole Count) + Tọa độ tâm chuẩn hóa (Centroids)
  ├── 2. Xử lý đối xứng gương (Mirror invariant: kiểm tra cả trục x và 1 - x)
  ├── 3. Tính điểm tổng hợp: S_final = 0.45*S_vec + 0.40*S_holes + 0.15*S_ratio
  └── 4. Xuất Top 1-3 ứng viên chính xác tuyệt đối kèm cảnh báo chi tiết
```

---

## II. CHECKLIST CHI TIẾT 3 GIAI ĐOẠN TRIỂN KHAI

### GIAI ĐOẠN 1: NÂNG CẤP CƠ SỞ DỮ LIỆU & NẠP MẪU (DATA INGESTION)

#### 1. Mục tiêu
- Chuẩn bị đầy đủ cấu trúc bảng và hàm RPC trên Supabase để lưu trữ và truy vấn metadata hình học.
- Quét toàn bộ ảnh phôi mẫu hiện có trong Catalogue để trích xuất số lỗ, tọa độ tâm và tỷ lệ khung hình, nạp sẵn vào cơ sở dữ liệu.

#### 2. Chi tiết kỹ thuật
- **Các trường dữ liệu mới trên Supabase:**
  - `hole_count` (`integer`, mặc định `0`): Tổng số lỗ rỗng bên trong chi tiết.
  - `aspect_ratio` (`float`, không null): Tỉ lệ khung hình bounding box chiều rộng / chiều cao ($W / H$).
  - `hole_centroids` (`jsonb`, mặc định `'[]'::jsonb`): Mảng tọa độ tâm chuẩn hóa $[0, 1]$ của các lỗ theo trục hoành $X$:
    ```json
    [
      {"x": 0.152, "y": 0.501, "radius": 0.045},
      {"x": 0.485, "y": 0.503, "radius": 0.045},
      {"x": 0.817, "y": 0.498, "radius": 0.045}
    ]
    ```
- **Hàm RPC Supabase nâng cấp:**
  - Cập nhật hàm `kim_upsert_catalogue_image_vector` nhận thêm `p_hole_count`, `p_aspect_ratio`, `p_hole_centroids`.
  - Cập nhật hàm `match_catalogue_image_vectors` trả về Top 10 kèm đầy đủ các trường metadata hình học này.
- **Offline Ingestion Script (`tools/ingest-geometry.mjs` hoặc script Python):**
  - Đọc danh sách ảnh sản phẩm từ Catalogue (R2 CDN URL).
  - Tách nền ảnh studio, tìm contour ngoài lớn nhất và contour con bên trong.
  - Đếm số lỗ, tính tâm $(x_i, y_i)$, tính tỷ lệ $W/H$.
  - Cập nhật batch theo từng đợt (chunk 50-100 bản ghi) vào Supabase để không gây nghẽn database.

#### 3. Bảng Checklist Giai đoạn 1
- [ ] **Task 1.1:** Soạn thảo script migration SQL Supabase:
  - `ALTER TABLE ... ADD COLUMN IF NOT EXISTS hole_count INT DEFAULT 0;`
  - `ALTER TABLE ... ADD COLUMN IF NOT EXISTS aspect_ratio FLOAT DEFAULT 1.0;`
  - `ALTER TABLE ... ADD COLUMN IF NOT EXISTS hole_centroids JSONB DEFAULT '[]'::jsonb;`
- [ ] **Task 1.2:** Cập nhật hàm RPC `kim_upsert_catalogue_image_vector` và `match_catalogue_image_vectors` trên Supabase để ghi/đọc metadata hình học.
- [ ] **Task 1.3:** Viết script offline trích xuất hình học `tools/ingest-geometry.mjs` (sử dụng thư viện xử lý ảnh thuần hoặc Sharp/Canvas/OpenCV).
- [ ] **Task 1.4:** Chạy thử nghiệm offline trên tập mẫu 20 ảnh catalogue, kiểm tra độ chính xác của số lỗ và tọa độ tâm.
- [ ] **Task 1.5:** Chạy quét toàn bộ kho ảnh Catalogue hiện có, log kết quả chi tiết (số ảnh thành công, số ảnh phát hiện 0 lỗ, số ảnh bất thường).
- [ ] **Task 1.6:** Viết Unit Test kiểm tra hợp lệ schema dữ liệu và RPC query trả về Top 10 có đủ 3 trường hình học.

---

### GIAI ĐOẠN 2: TÁCH NỀN & CHUẨN HÓA GÓC XOAY (LỚP 1 - PREPROCESSING IN WEB WORKER)

#### 1. Mục tiêu
- Triệt tiêu 100% nhiễu do môi trường chụp từ người dùng (nền bàn xưởng, mặt vải gấp nếp, ánh sáng phức tạp, phôi bị đặt chéo góc).
- Toàn bộ pipeline chạy client-side trong Web Worker, không phụ thuộc vào server ngoại vi, đảm bảo tốc độ phản hồi nhanh và bảo mật ảnh nội bộ.

#### 2. Chi tiết kỹ thuật
- **Module tách nền (`background-remover`):**
  - Tích hợp model **`briaai/RMBG-1.4`** (ONNX quantized `q8`, dung lượng ~40MB) lưu trữ local tại `/models/rmbg-1.4/`.
  - Chạy qua ONNX Runtime WebAssembly (`ort.env.wasm`).
  - Fallback: Nếu trình duyệt bộ nhớ hạn chế hoặc lỗi WebAssembly, kích hoạt fallback bộ lọc màu nền (Thresholding trên Canvas).
- **Module chuẩn hóa góc xoay (`orientation-normalizer`):**
  - Trích xuất mask nhị phân từ kết quả tách nền.
  - Dùng thuật toán **PCA (Principal Component Analysis)**:
    - Tính ma trận hiệp phương sai của tập hợp pixel vật thể:
      $$Cov = \frac{1}{M}\sum (p_i - \bar{p})(p_i - \bar{p})^T$$
    - Tính vector riêng (eigenvector) tương ứng với giá trị riêng lớn nhất để xác định góc xoay trục chính $\theta$.
  - Xoay ảnh ngược chiều một góc $-\theta$ quanh trọng tâm để đưa trục dài về phương nằm ngang $0^\circ$ (hoặc $180^\circ$).
- **Module căn lề & Pad vuông (`crop-pad-normalizer`):**
  - Tìm bounding box sát viền vật thể đã xoay ngang.
  - Căn giữa vào khung hình vuông tiêu chuẩn $448 \times 448$ px với đệm nền đen tuyệt đối (`RGB: 0, 0, 0`).
  - Giữ nguyên tỉ lệ $1:1$, tuyệt đối không co giãn làm biến dạng hình học của linh kiện.

#### 3. Bảng Checklist Giai đoạn 2
- [ ] **Task 2.1:** Chuẩn bị file model ONNX `rmbg-1.4` quantized và cấu hình static serving với header tối ưu cache.
- [ ] **Task 2.2:** Xây dựng Web Worker `pipeline.worker.js` và module `background-remover.js` nạp ONNX Runtime WASM.
- [ ] **Task 2.3:** Xây dựng thuật toán PCA / MinAreaRect trong `orientation-normalizer.js` để tự động tính góc $\theta$ và xoay ngang canvas.
- [ ] **Task 2.4:** Xây dựng hàm crop & padding đối xứng vào kích thước $448 \times 448$ px.
- [ ] **Task 2.5:** Xây dựng cơ chế fallback an toàn: nếu model AI tách nền gặp ngoại lệ, chuyển sang phân ngưỡng tự động (Adaptive Otsu Thresholding) trên Canvas.
- [ ] **Task 2.6:** Kiểm thử hiệu năng xử lý (Benchmark): đo thời gian hoàn tất Lớp 1 trên thiết bị di động (mục tiêu $< 1.8$ giây).

---

### GIAI ĐOẠN 3: SO KHỚP HÌNH HỌC (LỚP 3 - GEOMETRIC RE-RANKING)

#### 1. Mục tiêu
- Tiếp nhận Top 10 ứng viên thô từ Lớp 2 (DINOv2 embedding với Cosine Similarity $> 0.70$).
- Sử dụng metadata hình học thực tế từ ảnh chụp để tái thẩm định và xếp hạng lại (Re-ranking), đưa mã linh kiện chính xác 100% lên vị trí Top 1-3.

#### 2. Chi tiết kỹ thuật
- **Trích xuất hình học từ ảnh chụp truy vấn:**
  - Sau Lớp 1, trích xuất: $N_{Query}$ (số lỗ), mảng tâm lỗ $[(x_{Q,1}, y_{Q,1}), ...]$, và tỷ lệ khung hình $AR_{Query}$.
- **Công thức tính điểm tổng hợp:**
  $$S_{final} = 0.45 \cdot S_{vec} + 0.40 \cdot S_{holes} + 0.15 \cdot S_{ratio}$$
- **Quy tắc tính $S_{holes}$:**
  - Nếu số lỗ chênh lệch $|N_{Query} - N_{DB}| \ge 1$:
    $$S_{holes} = \max\left(0,\, 1.0 - 0.5 \cdot |N_{Query} - N_{DB}|\right)$$
    *(Chênh lệch từ 2 lỗ trở lên thì $S_{holes} = 0$, ngăn chặn tuyệt đối việc nhầm lẫn giữa chi tiết 2 lỗ và chi tiết 3-4 lỗ).*
  - Nếu số lỗ bằng nhau $N_{Query} = N_{DB} = N$:
    - Sắp xếp các tọa độ tâm theo thứ tự tăng dần của trục hoành $X$.
    - Tính khoảng cách Euclid trung bình giữa các cặp tâm tương ứng:
      $$D_{centers} = \frac{1}{N}\sum_{i=1}^{N}\sqrt{(x_{Q,i} - x_{D,i})^2 + (y_{Q,i} - y_{D,i})^2}$$
      $$S_{holes} = \max\left(0,\, 1.0 - D_{centers}\right)$$
- **Xử lý linh kiện bị lật mặt sau (Mirror Invariant):**
  - Tính song song hai trường hợp: tọa độ gốc $x_i$ và tọa độ phản xạ gương $x'_i = 1.0 - x_i$.
  - Lấy giá trị $S_{holes} = \max(S_{holes, direct},\, S_{holes, mirror})$ để không bị ảnh hưởng nếu thợ chụp lật mặt trái linh kiện.
- **Quy tắc tính $S_{ratio}$:**
  $$S_{ratio} = 1.0 - \frac{|AR_{Query} - AR_{DB}|}{\max(AR_{Query}, AR_{DB})}$$

#### 3. Bảng Checklist Giai đoạn 3
- [ ] **Task 3.1:** Xây dựng module `geometric-reranker.js` thực thi công thức $S_{final}$ với đầy đủ các trọng số đã định nghĩa.
- [ ] **Task 3.2:** Triển khai thuật toán trích xuất lỗ rỗng và tâm lỗ từ ảnh truy vấn trong Web Worker sau bước chuẩn hóa.
- [ ] **Task 3.3:** Xử lý tình huống đối xứng gương (lật mặt linh kiện $x \leftrightarrow 1 - x$) và tình huống xoay $180^\circ$.
- [ ] **Task 3.4:** Tích hợp module Re-ranking vào luồng trả lời của Moris: nhận Top 10 từ RPC `match_catalogue_image_vectors` $\rightarrow$ tái xếp hạng $\rightarrow$ xuất Top 1-3.
- [ ] **Task 3.5:** Xây dựng giao diện hiển thị kết quả trực quan trong chatbox:
  - Thanh tiến trình độ tương đồng $S_{final} \times 100\%$.
  - Cảnh báo rõ ràng khi kiểu dáng giống nhưng số lỗ khác nhau (ví dụ: *"Kiểu dáng khớp 95% nhưng khác số lỗ: Ảnh chụp có 3 lỗ, mẫu catalogue có 4 lỗ"*).
- [ ] **Task 3.6:** Viết bộ Unit Test kiểm thử so khớp:
  - Case 1: Hai chi tiết cùng hình dáng nhưng khác số lỗ (1 lỗ vs 2 lỗ vs 4 lỗ) -> Chi tiết đúng số lỗ bắt buộc phải xếp Top 1.
  - Case 2: Chi tiết bị lật mặt sau -> Vẫn nhận diện chính xác 100%.
  - Case 3: Chi tiết xoay ngược $180^\circ$ -> Vẫn nhận diện chính xác.

---

## III. NGUYÊN TẮC THỰC THI & CHỐT CHẶN AN TOÀN

1. **Tuân thủ chỉ đạo:** Tuyệt đối không tự ý viết code sửa đổi trước khi báo cáo và được người dùng xác nhận bản kế hoạch này.
2. **Bảo toàn bảo mật:**
   - Không đưa `service_role` hoặc token bí mật vào client-side script hoặc file tĩnh.
   - Thêm `plan.md` vào danh sách `DENY` của `tools/build-static.mjs` để không bị lộ trên môi trường production.
3. **Chỉ số kiểm thử:** Sau mỗi giai đoạn code, toàn bộ 94 unit test hiện hữu phải tiếp tục PASS 100%, cộng thêm các test case mới cho từng module.
