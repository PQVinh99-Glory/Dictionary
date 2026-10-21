# Moris pipeline — contract và baseline P00/P01

Ngày khảo sát: 2026-10-21. Tài liệu này ghi rõ điều đã được chủ dự án chốt, giả định đang chờ xác nhận và mức chứng cứ hiện có. Kế hoạch triển khai: [Plan_pipeline_moris.md](../../Plan_pipeline_moris.md).

## Quyết định nghiệp vụ đã chốt

| Chủ đề | Contract |
|---|---|
| Capture | Điện thoại cầm ngang; hỗ trợ Android Chrome và iPhone Safari; vật phải hiện trọn. Upload ảnh phải qua quality gate tương đương. |
| Size | Cạnh dài là chính, cạnh ngắn tùy chọn. Sai số chấp nhận tối đa 5% theo quyết định của owner; code V1.2 đã thay S1.1 10%/3 mm. |
| Kết quả | Khi có đủ 10 primary hợp lệ sau xếp hạng, trả top-10 primary; thiếu mới dùng rescue đủ chất lượng để bù số còn lại, có lý do và score thật. |
| Ngoại quan | Nhận cả lỗ kín và phần khoét hở; lỗ tròn cần đếm instance, răng cưa chỉ cần tương đương/presence. Unknown không thành số 0. |
| Vector | Hybrid là baseline kỹ thuật để kiểm chứng; chỉ Vector Center confirmed action có quyền ghi index. |

**Đã được owner xác nhận trong phiên này:** `abs(candidate_length_mm - query_length_mm) / query_length_mm <= 0.05`, tức 180 mm nhận 171–189 mm; không có sàn 2–3 mm. Query không nhập size vẫn chạy tìm ảnh và ghi rõ chưa đối chiếu size. Cạnh ngắn là evidence hỗ trợ, không veto mã có cạnh dài phù hợp. Top-10 primary/rescue chọn sau quality và điểm thật; rescue chỉ bù chỗ trống, có lý do riêng cho missing length và outside 5%. Upload phải kiểm tra trọn vật theo cùng policy camera. Chưa có budget P95, quality floor hoặc danh sách thiết bị/phiên bản cụ thể được duyệt; các ngưỡng này phải được đo trên thiết bị thật trước release.

## Manifest và phân nhóm chứng cứ

Manifest hiện hữu là JSONL được kiểm tra bằng `evaluation/moris-v6/manifest.js` và `tools/validate-moris-dataset.mjs`. Mỗi ảnh cần ít nhất query ID, expected SKU, asset path, SHA-256, source kind/group, physical shot ID, split và label status theo schema hiện hữu. Với bộ camera mới, bảng nhãn kèm theo cần device/browser/version, ánh sáng, full/partial, glare/occlusion, frame dimensions và ground truth mask/instance cho lỗ kín/khoét hở.

Schema mở rộng hiện đã có ở `evaluation/moris-v6/cameraManifest.js`: `camera_capture` ghi model máy, OS/browser/version, hướng máy, kích thước frame, glare/occlusion và nhãn trọn vật; `perception_labels` ghi từng instance với `boundary=closed|open`, `format_tag`, mức chắc chắn số đếm và răng cưa presence. `mask_annotation` có đường dẫn tương đối và SHA-256. Nhãn `pending` không được chứa `instances=[]` hay `full_subject=false`, vì hai giá trị đó là khẳng định đã kiểm chứng. CLI `tools/validate-moris-dataset.mjs ... --camera-labels --approved` kiểm tra schema và byte ảnh/mask khi được cung cấp asset root. Hiện **chưa có manifest ảnh camera mới có dữ liệu thật**; test chỉ dùng fixture tổng hợp.

Tách bốn nhóm khi báo số: (1) self-query ảnh catalogue, (2) camera thật có nhãn, (3) screenshot giao diện, (4) synthetic fixture. Hai screenshot ở root chỉ thuộc nhóm 3. Ca 3448000001 hiện có self-query đúng profile rank 1 và screenshot top-10 thiếu mã; không có raw frame/request payload để replay ca lỗi camera. Hash ảnh và config/Git SHA phải đi cùng mỗi replay để tránh trộn phiên bản.

Trong manifest V1, `same_asset`/`cross_view` thuộc nhóm catalogue, `camera` thuộc nhóm ảnh camera thật và `synthetic` chỉ là fixture. Screenshot giao diện giữ ở evidence riêng vì validator V1 không có `source_kind=screenshot`; screenshot không có ground truth pixel của query để đưa vào phép đo camera. Không đổi enum V1 của benchmark đã đóng băng.

Owner đã xác nhận bộ 122 mã cũ bị xóa và queue 57 ca lịch sử được bỏ khỏi gate nghiệm thu. Bộ M22 có 124 query (dev 93, holdout 31) chỉ là lịch sử; holdout đã xem không còn là unseen cho thay đổi mới. Phép đo hiện hành phải dùng snapshot catalogue production bằng truy vấn chỉ đọc, ghi rõ thời điểm/mẫu số/profile/coverage. Ảnh camera và thiết bị thật sẽ do owner nghiệm thu trên production; khi chưa có ảnh thô và nhãn thì không tuyên bố cải thiện accuracy camera.

Đối chiếu tại workspace: `docs/moris-v6/evidence/M19-camera124-frozen.json` chỉ là **báo cáo tổng hợp** 124 ảnh, không chứa các ảnh/row manifest; `private/camera124-v1.jsonl` được README lịch sử nhắc tới hiện không tồn tại. Hai hard-negative approved có đường dẫn `evaluation/moris-v6/private/catalogue-front/...`, nhưng thư mục private hiện không tồn tại; 55 mục rejected không thể dùng như nhãn đúng. Không dùng các bộ này để đo hiện hành hoặc tự chọn lại 122 mã sau khi xem kết quả.

## Metric cần đo và trạng thái gate

| Metric | Nguồn | Gate hiện tại |
|---|---|---|
| Full-object completeness, false-ready/false-reject, mask IoU | Camera thật + mask người gán | Pending dữ liệu và ngưỡng |
| Closed/open instance recall, count exact/unknown, sawtooth presence | Crop camera thật có nhãn | Pending dữ liệu và ngưỡng |
| Shortlist recall, target membership, false exclusion | Query cùng catalogue snapshot | Pending ngưỡng; báo riêng measured/missing size |
| Top-1, Recall@5/10/50, MRR@10 | Snapshot catalogue production hiện hành và camera split mới | Pending manifest/freeze ảnh query; self-query phải báo riêng |
| P50/P95 cold/warm latency, memory, orientation/permission | Android Chrome, iPhone Safari thật | Pending thiết bị/budget |
| Primary/rescue count, reason và quality floor | Cùng request/search trace | Pending calibration |

Snapshot production **chỉ đọc** lúc `2026-10-21 02:50:18 UTC` (Supabase SQL `SELECT`, không ghi): `image_library` có 545 dòng/545 mã, 326 dòng có `identifying_features`; `catalogue_part_dimensions` có 6 mã có cạnh dài và 0 mã có cạnh ngắn; `catalogue_image_vectors` active gồm 1.103 vector/544 record hybrid `kim_canon_v3_letterbox` và 1.069 vector/534 record CLS `kim_canon_v2`. Đây là coverage tại thời điểm đọc, **không phải** accuracy hay kết quả camera; 539/545 mã chưa có cạnh dài nên length shortlist không thể áp dụng cho đa số catalogue hiện tại. Query kiểm tra: đếm `image_library`, `catalogue_part_dimensions` và nhóm active vector theo `embedding_profile, preprocess_version` (join record theo `record_id`).

**Biến động production:** lúc `02:56:01 UTC` truy vấn lại chỉ còn 44 hybrid active/19 record và 0 CLS. Snapshot 02:50/02:53 là lịch sử tức thời, không phải baseline ổn định. P01 coverage và mọi so sánh accuracy cần đo lại sau khi owner xác nhận rebuild/index ngừng biến động.
Owner đã xác nhận đang rebuild index chuẩn hybrid; đây là trạng thái chuyển tiếp dự kiến. Chỉ đo lại coverage và accuracy khi owner báo rebuild hoàn tất, không dùng snapshot cũ làm phép so trước/sau.

Định nghĩa phép tính để tránh đổi mẫu số giữa các lần chạy:

- **Full-object false-ready** = số ảnh partial/invalid mà gate cho chụp ÷ tổng ảnh partial/invalid có nhãn người; **false-reject** = số ảnh trọn, đạt điều kiện nhãn người mà gate chặn ÷ tổng ảnh trọn, đạt điều kiện. Chỉ báo trên frame thật, tách theo thiết bị và ánh sáng.
- **Mask IoU** = giao/hiệp mask vật thể với mask người gán trên cùng frame, cùng tọa độ. **Completeness** = phần pixel vật thể GT còn trong ROI/crop ÷ tổng pixel vật thể GT của frame gốc; nếu vật nằm ngoài frame sensor thì không có GT đủ để tính completeness của vật, phải gắn trạng thái `out_of_frame` riêng.
- **Recall instance lỗ/khoét** và **classification accuracy** dùng các instance người gán nhãn closed/open, đếm sau matching 1:1 theo rule vị trí/IoU được đóng băng trước đánh giá. `count_exact_accuracy` chỉ dùng ảnh có `count_certainty=exact`; lower-bound/unknown báo tỷ lệ riêng. Răng cưa đo presence/absence khi nhãn đã duyệt, không đếm từng răng.
- **Shortlist recall** = query có target hợp lệ xuất hiện trong tập trước vector ÷ query có target hợp lệ; báo riêng nhóm measured length và missing length. **False exclusion** = target có evidence tương thích bị lọc mất ÷ target tương thích. Không suy rank khi target `not_in_pool`.
- **Top-1/Recall@K/MRR@10** dùng các query `known=true` đã duyệt, mỗi query tính một phiếu và báo theo SKU/session để tránh nhiều shot một SKU áp đảo. Unknown negatives dùng false accept riêng, chỉ khi có nhãn và quyết định accept/reject thật.
- **Latency** tính từ thao tác chụp/tải ảnh đến lúc kết quả hiển thị; P50/P95 tách cold/warm, Android/iPhone và từng stage. `performance.now()` cho duration, timestamp tường chỉ để đối chiếu log. Chưa có budget ms nào được chủ dự án duyệt.

**Ngưỡng release:** full-object false-ready, mask completeness/IoU, instance/count, Recall@10, false accept, quality floor cho primary/rescue và P95 đều ở trạng thái `pending calibration/owner review`. Việc đánh dấu schema/metric đã lập không đồng nghĩa đạt GO. Tương thích được thiết kế theo kiểm tra khả năng API tại runtime, không có allowlist model máy. Ma trận nghiệm thu lấy mẫu đại diện nhiều Android Chrome, iPhone Safari và các cấu hình trình duyệt thiếu/từ chối fullscreen/orientation lock; thử camera resolution thấp/cao, permission deny/retry, portrait→landscape, đổi camera, background/resume và cold/warm. Model/OS/browser version được ghi lại cho **mỗi ca kiểm thử** để tái lập lỗi, không dùng để chặn người dùng. Chưa có máy thật trong workspace để chạy nghiệm thu.

Owner thực hiện thử camera/thiết bị thật trên production. Agent chịu trách nhiệm kiểm chứng thuật toán và đường gọi bằng test, phép đo read-only, trace và bằng chứng tái lập được; danh mục cần owner kiểm tra được bàn giao riêng với mẫu số/ảnh thô/nhãn. Không đánh dấu nghiệm thu camera chỉ từ unit test hoặc self-query.

Không dùng test unit/synthetic hoặc self-query để ghi “camera đạt”. Khi tính pool rank, target không vào pool phải ghi `not_in_pool`, không bịa rank toàn cục. Chưa có gate được owner duyệt thì báo `pending`, không tự đặt số để đạt GO.

## Baseline code và runtime

- `functions/api/moris/search.js`: session qua `app_me`. P01 đã bổ sung yêu cầu role admin **cùng** cờ `MORIS_DEBUG_EXPOSE_INTERNAL` trước khi trả `debug`; trace timing chỉ xuất hiện ở debug admin. Không đổi ranking.
- P01 debug admin hiện ghi chuỗi RPC thực gọi (`match_catalogue_image_vectors_v6` hoặc fallback `match_catalogue_image_vectors`), trạng thái/row count/mã lỗi an toàn, và server model/version/preprocess/profile; không ghi vector hay token. Unit test xác nhận fallback giữ nguyên profile. Đây là instrumentation code; chưa có request camera production được replay để xác nhận trace phiên lỗi.
- Audit asset production đọc-only `2026-10-21 02:53:12 UTC`: `image_assets` có 545 front, 545 thumb, 5 back, 10 detail. Đối chiếu `record_id` + `asset_type` + `object_key=image_path` với hybrid active: front 544/545, thumb 544/545, back 5/5, detail 10/10; mã thiếu cả front/thumb là `3433430001`. Key khớp không chứng minh bytes/ETag còn tươi. Số asset (1.105), record (545) và vector active (1.103 hybrid) là ba mẫu số khác nhau.
- `functions/_lib/moris/v5/runtime/trace.js`: stage timing dùng đồng hồ monotonic. Nó đo thời gian giữa các mốc gọi `trace`; chưa có mốc cho mọi nhánh frontend/capture/RPC, nên chưa được gọi là latency pipeline đầy đủ.
- `functions/_lib/moris/v5/orchestrator.js`: baseline production hiện encode/search global ANN trước hydrate rồi mới áp size gate. P06/P08 đã có code path local length shortlist trước ANN và scoped cosine union để cứu target ngoài global ANN, nhưng `MORIS_SCOPED_SIZE_SEARCH_ENABLED` mặc định OFF đến khi ba RPC proposal tại `docs/moris-v6/sql/pipeline_scoped_match_proposal.sql` được review/triển khai. Không gọi code path local là production recall.
- `functions/_lib/moris/v5/vector/search.js`: fallback tên RPC v6 sang RPC cũ vẫn dùng đúng profile. Nhánh tráo hybrid query sang `cls_l2_v1/kim_canon_v2` đã bị loại ở P07; chưa có bằng chứng nó đã xảy ra trong phiên screenshot.
- `src/app.js`/`index.html`: P02 dùng khung hiển thị theo videoWidth/videoHeight thực và toàn frame cho tap/tracking/capture; request orientation lock khi API cho phép, Safari hướng dẫn xoay máy. P03 chặn chụp khi chưa ready và revalidate frame cuối. Chưa có nghiệm thu Android/iPhone thật và chưa bảo đảm detector không khóa nhầm mảnh vật ổn định.
- P02 bổ sung request ID cho `getUserMedia` và lượt mở camera: luồng trả về sau khi đóng/đổi camera bị stop thay vì đánh dấu ready; tracking reset khi mở stream; chỉ đặt ready sau khi video play thành công. Orientation lock trả về trễ sau khi đóng sẽ dọn fullscreen. Unit tests 5 ca lifecycle pass; chưa thay thế test thiết bị thật.
- P02 dùng `screen.orientation.type` hoặc `window.orientation` trước khi suy hướng từ viewport, nên bàn phím không làm máy dọc bị nhận là ngang; chỉ reset tracker khi hướng máy đổi. Overlay/modal camera chừa CSS `env(safe-area-inset-*)`. Lifecycle unit tests hiện 7/7 pass; chưa có ảnh chụp máy thật để kiểm safe area/keyboard UX.
- `src/moris/size-contract.js`/`functions/_lib/moris/v5/retrieval/sizeGate.js`: V1.2 dùng 5%/0 mm cho mọi nguồn, d_max theo query long edge, width chỉ evidence. Loader đọc dimensions theo chunk100; shortlist range/paging có trạng thái thiếu bảng/vượt budget. P09 code chọn primary trước rescue unknown/outside và giữ score thật; nghiệm thu production/hard-negative còn pending.
- `.env` local chọn CLS/v2, browser worker hiện sinh hybrid/v3. Không đồng nhất local env với production runtime.
- Live read-only snapshot và self-query: `evidence/uplevel-live-overview.json`, `evidence/uplevel-live-vector_coverage.json`, `evidence/uplevel-live-self_rpc.json`. Không có write DB/vector.

P01 chưa hoàn tất: cần trace profile thật từng stage, target membership, read-only replay trên raw camera query, coverage freshness theo asset và baseline đo trên manifest hợp lệ. Trạng thái P01 vẫn pending.
