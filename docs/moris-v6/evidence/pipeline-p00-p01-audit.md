# P00/P01 audit — 2026-10-21 UTC

Scope: P00 contract/schema và P01 instrumentation/coverage. Production access chỉ dùng `SELECT` qua Supabase SQL plugin; không ghi DB, vector, deploy hoặc commit. Camera thật do owner nghiệm thu trên production, không có raw frame/request ở workspace.

## Snapshot production

`2026-10-21 02:50:18 UTC`: `image_library` 545 rows/545 codes, 326 có identifying_features. `catalogue_part_dimensions` 6 code có length, 0 có width. Active vector: hybrid `hybrid_gem3_edge_55_45_pseudorgb_u8_v1` + `kim_canon_v3_letterbox` 1.103 rows/544 records; CLS `cls_l2_v1` + `kim_canon_v2` 1.069 rows/534 records.

`2026-10-21 02:53:12 UTC`: `image_assets` có 545 front, 545 thumb, 5 back, 10 detail. Active hybrid vector khớp `record_id + asset_type + object_key=image_path`: 544/545 front, 544/545 thumb, 5/5 back, 10/10 detail. Mã thiếu front và thumb: `3433430001`. Đây là khớp key, chưa kiểm byte/ETag freshness. `record_id` ở vector là text, `image_id` ở asset là UUID, nên join dùng `image_id::text`.

**Cảnh báo baseline biến động:** một truy vấn `SELECT` lúc `02:56:01 UTC` chỉ còn **44 hybrid active/19 record, 0 CLS active** (hybrid model `onnx-community/dinov2-small`, version `ef1fb10`, preprocess `kim_canon_v3_letterbox`, variant `canon_rgb_v2`). Đã thấy 31 rồi 39 hybrid active trong các truy vấn ngay trước đó; index đang biến động mạnh. Không suy rằng snapshot 02:50/02:53 còn đại diện trạng thái hiện tại, không dùng các số đó làm baseline so trước/sau hoặc kết luận lỗi thuật toán. Chờ owner xác nhận có rebuild và chỉ đo lại khi index ổn định.

Query riêng mã `3448000001` xác nhận `length_mm=180`, `width_mm=NULL`, `method=user`. Dữ liệu size có thật nhưng thuật toán hiện chỉ chạy gate **sau** global ANN/hydrate; nếu mã không vào pool ANN, size không thể cứu nó. Không có raw camera query để kết luận trường hợp screenshot rớt ở stage nào.

SQL đã chạy là phép đếm `SELECT` trên `image_library`, `catalogue_part_dimensions`, `catalogue_image_vectors` nhóm theo `embedding_profile, preprocess_version`, và `image_assets` với `EXISTS` khớp record/type/key/profile. Không dùng bộ 122 mã đã xóa hay queue 57 lịch sử làm mẫu số.

## Kiểm chứng local

`npx vitest run tests/moris-vector-search-fallback.test.js tests/moris-pipeline-telemetry.test.js`: 2 file/9 test pass. `npm test`: 64 file/622 test pass. `npx --no-install tsc --noEmit`: exit 0. `npm run build`: 47 file. `git diff --check`: exit 0. P00 manifest test riêng có 5/5 pass, gồm xác minh hash ảnh/mask và phát hiện mask bị sửa.

P00 hoàn tất vì contract, schema/validator và metric có trạng thái `pending` rõ. P01 chưa hoàn tất: trace frontend/capture còn thiếu, cần byte/ETag freshness và raw camera request để replay `3448000001`. Self-query rank 1 trong evidence cũ không chứng minh camera query đúng.
