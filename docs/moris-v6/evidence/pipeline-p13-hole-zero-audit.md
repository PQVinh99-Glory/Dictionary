# P13 — `catalogue_image_vectors.hole_count = 0` hậu kiểm read-only

Khảo sát cuối phiên ngày 2026-10-21 sau khi hoàn tất các task local P04–P12 có thể thực hiện. **Không ghi Supabase/R2, không tạo/xóa vector, không deploy.** Production index vẫn thuộc đợt owner rebuild; các số dưới đây là snapshot, chưa là baseline nghiệm thu ổn định.

## Bằng chứng database

Snapshot SQL read-only lúc **03:39:36 UTC**: 1.110 vector hybrid/v3 active, trong đó **236 hàng `hole_count=0`**, 874 hàng >0, không có `NULL`; cả 1.110 `quality_score` là `NULL`. Theo `asset_type`: thumb 149/546 zero, front 81/546, detail 6/10, back 0/8. Trong 546 record có cả front+thumb: **68 front >0 nhưng thumb=0**, không có trường hợp front=0/thumb>0; 81 cùng zero, 397 cùng >0. Snapshot thứ hai lúc 03:43:22 UTC vẫn 1.110/236, `max(updated_at)` 03:33:54 UTC; hai lần đọc cách nhau vài phút không chứng minh rebuild đã kết thúc.

Schema production hiện có `hole_count integer DEFAULT 0`, `quality_score`, `foreground_status`, nhưng **chưa có** `geometry_evidence`, `embedding_signature_version`, `geometry_processed_at`, `source_etag`. Vì vậy bảng không lưu cờ mask, lý do unreliable hay dấu vết byte nguồn để phân biệt 0 thật và unknown. Migration cũ `2026101000050000_add_geometry_metadata_to_vectors.sql` dùng `COALESCE(p_hole_count,0)` khi ghi và `COALESCE(v.hole_count,0)` khi match; API `vector-upsert.js` fallback sang RPC này khi V6 provenance RPC chưa có.

`identifying_features` chứa mô tả lỗ có số lượng ở 93 thumb-zero, 47 front-zero và 6 detail-zero theo truy vấn regex. Mô tả nhập tay không phải pixel GT; đây là tập ưu tiên kiểm tra, không phải 146 lỗi đã xác nhận.

## Tái hiện hai asset thật, cùng code path local

Đọc object R2 public của hai mã, giải mã WebP vào `/tmp` rồi chạy **chính** `segmentForegroundAndHoles`, `processLayer1Optical`, `normalizeGeometry` hiện tại. Không đưa ảnh private vào git. Kết quả:

| Mã / asset | Kích thước | Lỗ raw → canonical | `maskQuality` | Payload count → DB cũ | DB snapshot |
| --- | --- | --- | --- | --- | --- |
| `3233050001` front | 1600×234 | 7 → 6 | reliable | 6 → 6 | 6 |
| `3233050001` thumb | 460×67 | 6 → 7 | `subject_touches_edge` | `NULL` → `COALESCE` 0 | 0 |
| `3433410101` front | 1579×305 | 5 → 5 | `subject_touches_edge` | `NULL` → `COALESCE` 0 | 0 |

Ảnh thumb/front trong hai ca có lỗ nhìn thấy. Với cả hai hàng DB=0, optical **vẫn phát hiện lỗ**; `normalizeGeometry` xóa count vì `quality.reliable=false`, rồi RPC/schema cũ biến unknown thành 0. Đây là nguyên nhân tái hiện được cho **hai asset này**, không được suy rộng tự động sang cả 236 hàng. Số raw/canonical khác nhau cũng cho thấy thuật toán đếm có sai lệch riêng cần đo với mask/instance GT.

Định danh byte để owner/agent kế tiếp replay đúng ảnh: `front/3233050001/08555a32-8620-4dd1-a876-9ceaab9cfd94.webp` SHA-256 `4aa2ad580dd9a2b24a8b63b6dc67eda0e1a0bd43b2f89217685a45315322d938`; `thumb/3233050001/cf6aa1ad-f2ad-4e38-aa53-bf84f9c3f39a.webp` SHA-256 `9d9a2b26c2e897febe7f0c50c55646fd18c82b9fd24dc9849f2106104725f88e`; `front/3433410101/bc014637-ca9c-4263-83f5-aaf52d549d63.webp` SHA-256 `1549a6354cbcc8b4f87689211b3e690143ac3fc56503a0c8d13c85af402b57cd`. Replay dùng Pillow chỉ để giải mã RGBA, sau đó gọi hàm optical/normalizer hiện hữu của dự án. Không dùng ảnh này làm holdout chưa xem.

## Kết luận kỹ thuật và quyết định chưa làm

1. Có ít nhất một đường gây **false zero do provenance loss**, độc lập với khả năng detector không thấy lỗ. `subject_touches_edge` trên ảnh catalogue cutout/tight crop có thể là cờ bảo thủ; chưa đủ GT để đổi thành reliable hoặc khẳng định vật trọn.
2. Có thể còn các nguyên nhân khác: lỗ nhỏ mất khi resize 224, nền/chói làm mask kín, open-notch không phải lỗ kín, view/detail khác, và zero thật. Cần gán nhãn mẫu raw theo view trước khi báo tỷ lệ false-zero của toàn bảng.
3. Cách sửa an toàn cần được owner review ở P12: provenance nullable (`geometry_evidence.quality` + `hole_count NULL` khi unreliable), bỏ `COALESCE(NULL,0)` ở đường ghi/đọc mới, giữ vector embedding nguyên profile nếu chỉ đổi metadata; sau đó cập nhật metadata/vector qua Vector Center theo đúng quyền ghi. **Không sửa hàng production hoặc tự kích hoạt migration/rebuild trong khảo sát này.**
4. Trong khi V6 provenance chưa triển khai, `hole_count=0` từ RPC cũ phải được coi là **ambiguous**, không thể dùng như bằng chứng chắc chắn không có lỗ. Image geometry ranking vẫn mặc định OFF theo gate M22; nếu bật lại phải xử lý unknown trước.

Để đóng P13 hoàn toàn: owner xác nhận index đã ổn định, chốt tập asset có nhãn lỗ/không lỗ theo front/thumb/detail, đo false-zero có mẫu số và kiểm cả asset 0 thực sự. Hai ảnh tái hiện trên là bằng chứng cơ chế, chưa thay thế nghiệm thu diện rộng.

## Bổ sung replay toàn bộ 236 hàng và bản sửa local — 2026-10-21

Owner xác nhận ảnh catalogue `front`/`thumb` trên R2 đều chụp trọn linh kiện; `hole_count` được định nghĩa là **số lỗ kín nhìn thấy trên chính asset**, không cộng phần khoét hở ra mép. Đây là điều kiện nghiệp vụ cho sửa quality gate; ảnh camera/query vẫn phải bắt trọn vật.

Đã đọc **236/236** object R2 tương ứng 236 hàng zero (149 thumb, 81 front, 6 detail), lưu byte giải mã tạm ngoài repo, kiểm SHA-256 từng object trong [`pipeline-p13-zero-asset-replay.csv`](pipeline-p13-zero-asset-replay.csv). Toàn bộ là `cutout_alpha`, đều có duy nhất cờ `subject_touches_edge`; thuật toán tìm được ít nhất một khoang kín ở cả raw lẫn canonical. Trước sửa, `quality.reliable=false` khiến `normalizeGeometry` trả `NULL`, rồi RPC cũ `COALESCE` thành DB 0. Đây là **nguyên nhân lưu zero tái lập được cho cả 236 asset snapshot**, không đồng nghĩa số lỗ canonical đã khớp nhãn người.

Bản sửa local giữ cờ chạm mép để truy vết nhưng coi cờ đó không chặn đo hình học khi ảnh là alpha cutout và không có cờ lỗi khác. Ảnh camera/opaque vẫn bị chặn nếu vật chạm mép. Bỏ trần diện tích 45% foreground chỉ cho khoang kín alpha; một lỗ oval lớn trên `3445170001` từng bị loại vì diện tích khoang 209.629 px / foreground 372.827 px = 56,2%, nay front/thumb đều đếm 2 thay vì 1. Flood-fill từ viền vẫn loại phần khoét hở ra mép. Không dùng ảnh mẫu `moris_hole_samples` để quyết định kín/hở: chúng là tham chiếu hình dạng, không có mask/nhãn topology; có thể phân loại hình dạng **sau** bước xác định khoang kín khi có dữ liệu gán nhãn.

Replay sau sửa: **236/236** asset zero cũ có `normalized_hole_count>0`, `normalized_aspect_ratio>0` và số `normalized_centroids` khớp count. Raw/canonical count khớp **203/236**, lệch **33/236** do resize/canonicalization hoặc ngưỡng phát hiện; các số đó chưa có ground truth. Một nhóm đối chứng 58 asset DB count>0 được lấy theo seed cố định: canonical local khớp số đã lưu ở **58/58**, nhưng đây là đối chiếu với pipeline cũ, **không phải đo accuracy**. Ví dụ `3433350101` front raw20/canonical22 trong khi text mô tả nhiều lỗ hơn; cần nhãn instance để biết số đúng. Mô tả `identifying_features` nhập tay không thay cho mask/nhãn.

Đường ghi API nay từ chối nếu thiếu RPC provenance V6, thay vì rơi về RPC legacy làm mất NULL. Trung tâm Vector AI hiển thị cảnh báo dữ liệu hình học legacy chưa phân biệt được zero/unknown hoặc thiếu count/ratio/centroids; list có fallback đọc schema cũ nhưng không coi thiếu ETag là vector tươi. **Không có hàng production nào được sửa trong audit này.** Muốn cập nhật 236 hàng hiện có, cần migration V6 được rehearsal/áp đúng trình tự rồi người dùng xác nhận `replace` tại Trung tâm Vector AI để nhúng lại asset R2 hiện có; Editor/Moris không ghi index.

Local validation sau bản sửa: focused 37/37 và 47/47; lần chạy cuối `npm test` **69 file/659 test pass**, `npx --no-install tsc --noEmit` exit 0, `npm run build` 47 file, `git diff --check` exit 0. TypeScript ban đầu bắt lỗi import JS thiếu declaration trong test mới; đã chuyển assertion normalize sang test JS rồi chạy lại toàn bộ. Production accuracy, replay trên chính Web Worker/browser, ETag, DB migration, camera Android/iPhone và ranking top-10 còn pending; không gọi P13 hoàn tất.

Rehearsal DB **chỉ trên PostgreSQL 17/pgvector container local, không mở port ra ngoài**: `check-moris-vector-db.mjs` pass retry/replace/ETag/concurrency 8 request (1 created/7 skipped)/privileges/rollback; `check-moris-provenance-db.mjs` pass nullable geometry, measured zero, idempotency, 3 payload xấu bị từ chối, ACL, backup/restore và rollback; `check-moris-catalogue-db.mjs` pass 1.000 ID cùng timestamp + last-page/filter/auth, EXPLAIN fixture 6,157 ms. Các fixture chỉ mô phỏng schema được kiểm, **không chứng minh migration/plan trên bản sao toàn bộ production**. Đã xóa container test sau rehearsal; không có DB production write.
`check-moris-scoped-db.mjs` cũng pass trên fixture local: scoped match không lọt ID ngoài shortlist, filter dùng session/usage side, keyed hydration giữ asset front, token sai bị từ chối và anon không gọi được vector RPC. Đã đóng gói SQL thành migration `20261021051000_moris_scoped_match_keyed_hydration.sql`. Read-only production `information_schema`/`pg_indexes` xác nhận các cột và index `record_id`, profile của vector, asset và metadata catalogue; `app_session_user_id(text)` trả UUID. Fixture chưa thay thế đo end-to-end camera/ranking.

**Release update 05:15 UTC:** Sau backup schema+data public và dry-run, đã áp bốn migration V6/scoped vào production bằng Supabase CLI. Các phép đọc sau migration xác nhận 1.110 active vector/546 SKU, 236 zero cũ và 0 hàng có `geometry_evidence` (chưa reindex), bốn cột provenance/ETag có mặt; anon không có quyền gọi writer/scoped RPC. Scoped RPC thật với shortlist 180±5% trả đúng hai view của `3448000001`. Bản sửa 236 zero **chưa có hiệu lực trên hàng vector cũ** cho tới khi owner xác nhận replace qua Trung tâm Vector AI sau deploy. Không gọi số 236/236 replay local là accuracy theo GT.
