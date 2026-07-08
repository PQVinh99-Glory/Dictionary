# 06 — Mobile / iOS / APK

## Rủi ro

Local vision model trong browser có thể:
- tải model lớn;
- tốn RAM;
- first-load chậm;
- WebGPU không đồng đều.

## Chiến lược adaptive

### PC mạnh / Android phù hợp

```text
local encoder
WebGPU when available
WebAssembly fallback
```

### iOS / low-memory

```text
lazy load only when image search used
single query image only
model cache
224px input
no batch embedding
release intermediate tensors
```

### Ingestion hàng loạt

Không làm trên iOS.

Khuyến nghị:

```text
Admin PC
-> batch foreground
-> batch embeddings
-> upload sidecar vectors
```

## Query trên mobile

Chỉ cần:
- preprocess 1 ảnh;
- encode 1 vector;
- gửi 384 số hoặc vector string;
- server vector search;
- tải tối đa candidate Top 10 khi AI rerank.

## UX

Hiển thị stage:

```text
Đang tách vật thể...
Đang tạo dấu vân tay hình ảnh...
Đang tìm ứng viên gần nhất...
Đang kiểm tra độ tương thích...
Đang duyệt Top 5...
```

Không dùng chữ:
- Planner;
- Resolver;
- Judge.

Người dùng chỉ thấy:

```text
Thư ký Kim
```
