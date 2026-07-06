# DEPLOY_REAL_CLOUDFLARE.md

# Mục tiêu

Test trực tiếp trên Cloudflare Pages production:

```text
https://dictionary-dnw.pages.dev/
```

Không cần Node.js.
Không cần Wrangler local.
Không cần custom domain.
Không xóa Worker cũ.

## Cấu trúc phải nằm ở root GitHub repo

```text
Dictionary/
├── index.html
├── pages-r2-test.html
└── functions/
    └── api/
        ├── upload.js
        └── upload/
            └── health.js
```

## Luồng mới

```text
Frontend
  -> GET /api/upload/health
  -> POST /api/upload
  -> Pages Function
  -> R2 binding CATALOGUE_BUCKET
  -> R2 bucket hiện tại
```

Nếu health route không khả dụng, `index.html` vẫn giữ Worker cũ làm fallback.

---

# Thứ tự thao tác

## 1. Backup repo hiện tại

Tạo branch hoặc tải ZIP repo trước khi thay file.

## 2. Copy 4 file/folder vào repo GitHub

- thay `index.html` bằng file trong package này;
- thêm `pages-r2-test.html`;
- thêm `functions/api/upload.js`;
- thêm `functions/api/upload/health.js`.

## 3. Push GitHub

Cloudflare Pages project đang nối GitHub sẽ tự tạo deployment mới.

## 4. Trên Cloudflare Dashboard thêm R2 binding

Mở project `dictionary-dnw`.

Tìm phần Bindings / Functions bindings.

Thêm:

```text
Type: R2 bucket
Variable name: CATALOGUE_BUCKET
Bucket: chọn đúng bucket ảnh catalogue hiện tại
```

Áp dụng cho Production.
Preview có thể thêm sau.

## 5. Thêm Variables and Secrets

Thêm:

```text
SUPABASE_URL
SUPABASE_ANON_KEY
```

Giá trị dùng đúng project Supabase hiện tại.

Không cần:

```text
SUPABASE_SERVICE_ROLE_KEY
R2_ACCESS_KEY
R2_SECRET_KEY
```

## 6. Redeploy

Sau khi thêm binding/variables, tạo deployment mới hoặc retry deployment để Function nhận cấu hình.

## 7. Test health trước

Mở:

```text
https://dictionary-dnw.pages.dev/api/upload/health
```

Kỳ vọng:

```json
{
  "ok": true,
  "provider": "pages-r2",
  "status": "healthy"
}
```

## 8. Đăng nhập app thật

Mở:

```text
https://dictionary-dnw.pages.dev/
```

Đăng nhập bình thường.

## 9. Test upload riêng, không ghi metadata

Mở:

```text
https://dictionary-dnw.pages.dev/pages-r2-test.html
```

Bấm:

```text
1. Kiểm tra /api/upload/health
```

Sau đó chọn một ảnh nhỏ và bấm:

```text
2. Upload thử vào R2
```

Kết quả thành công sẽ có:

```json
{
  "http": 200,
  "ok": true,
  "provider": "pages-r2",
  "image_path": "detail/TEST_PAGES_R2/..."
}
```

## 10. Kiểm tra R2 Dashboard

Tìm object mới dưới path tương tự:

```text
detail/TEST_PAGES_R2/<upload-id>.<ext>
```

Trang test không ghi metadata Supabase.

## 11. Test app thật

Chỉ sau khi bước 9 thành công.

Tạo một record test rõ ràng:

```text
TEST-PAGES-R2-001
```

Upload ảnh và Save trong app.

Kiểm tra:

- ảnh có ở R2;
- metadata vẫn lưu;
- asset vẫn liên kết;
- card hiện ảnh;
- detail mở được.

---

# Nếu lỗi

## `/api/upload/health` trả 404

Functions chưa được deploy hoặc `functions/` không nằm ở root repo.

## `missing_binding`

Chưa bind R2 với tên chính xác:

```text
CATALOGUE_BUCKET
```

## `503` nói thiếu Supabase config

Chưa thêm:

```text
SUPABASE_URL
SUPABASE_ANON_KEY
```

## `401`

Session token không hợp lệ/hết hạn. Đăng nhập lại ở `/`.

## `403`

Role hiện tại không phải admin/editor.

## Upload thành công nhưng public URL không mở

Kiểm tra R2 public URL hiện tại và quyền public bucket/domain.

---

# Rollback

Worker cũ chưa bị xóa.

Nếu cần quay lại:

1. rollback Cloudflare Pages deployment trước;
2. hoặc khôi phục `index.html` cũ;
3. giữ nguyên R2 bucket và Supabase.
