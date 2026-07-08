# V5.6 — Vector Lifecycle & Backfill Center

## Vì sao cần V5.6?

V5.5 có encoder thật nhưng lifecycle còn mờ:
- save xong vector chạy nền
- lỗi có thể chỉ nằm trong console
- ảnh cũ phải biết URL reindex riêng
- không có coverage dashboard

V5.6 thêm:

```text
Header
  -> Vector AI

Editor
  -> Tạo vector thủ công cho 1 SKU

Save new SKU
  -> persistent local queue
  -> retry sau reload/login

Vector Center
  -> load model
  -> coverage
  -> backfill ảnh cũ
  -> pause/resume
```

## Không nhét DINOv2 vào Worker thường

Cloudflare Pages/Functions giữ vai trò:
- auth
- API
- R2 proxy
- secure write

DINOv2:
- browser Web Worker
- WebGPU fp16
- WASM q8 fallback

## Existing images

Open:

```text
/tools/kim-vector-center.html
```

Then:
1. `Nạp model DINOv2`
2. kiểm tra coverage
3. `Bắt đầu / Tiếp tục`

## New images

After save:
1. metadata saved
2. assets saved
3. job persisted in localStorage
4. browser worker embeds
5. `/api/kim/vector-upsert`
6. Supabase pgvector

If page reloads, queue retries after next successful session restore.
