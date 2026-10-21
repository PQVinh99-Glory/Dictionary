# Khảo sát tính khả thi Plan_uplevel

> Tài liệu nghiên cứu/khảo sát lịch sử. Kế hoạch triển khai hiện hành: [Plan_pipeline_moris.md](../../Plan_pipeline_moris.md), thay Plan_uplevel.md từ 2026-10-21. Các câu “chưa sửa plan” bên dưới mô tả thời điểm khảo sát.


Ngày: 2026-10-21. Phạm vi: đọc tài liệu, đối chiếu mã nguồn, chạy kiểm tra local; chưa triển khai U0–U7.

Nguồn: `Plan_uplevel.md`, `state.json`, `AGENTS.md`, kiến trúc V6, sổ nợ kỹ thuật và các module được dẫn dưới đây. HEAD lúc khảo sát: `b5b65c2`; baseline code ứng dụng gần nhất: `5a9218d`.

## 1. Kết luận

**Khả thi về kỹ thuật; chưa đủ bằng chứng để cam kết tăng Top-1/Recall@10 hoặc phát hành.** Có thể triển khai tăng dần trên hệ thống hiện hữu, giữ DINOv2 và quyền ghi vector. Phần khó nhất là dữ liệu query thật, contract độ tin cậy, candidate union và hiệu chỉnh thứ hạng; không phải thiếu model mới.

**Quyết định chủ dự án trong phiên này: bắt buộc chụp trọn vật.** Quyết định này thay hướng `partial_allowed` trong kế hoạch: U1 phải phát hiện vật bị cắt và chặn chụp/tìm theo policy đã chốt; không triển khai chế độ cho phép partial. Cần chốt thêm policy tương ứng cho ảnh tải từ máy để không có đường bỏ qua kiểm tra.

Đề xuất GO cho chuẩn bị dữ liệu và U0 sau khi thống nhất phạm vi triển khai; NO-GO cho bật ranking mới/production khi chưa có baseline ảnh thật, ablation, budget latency và nghiệm thu. Khảo sát này không tự triển khai U0.

## 2. Kiểm chứng thực tế

| Kiểm tra | Kết quả phiên này |
|---|---|
| `npm test` trong sandbox | 607 pass, 3 lỗi EPERM khi spawn tiến trình con; 60/62 file pass |
| Chạy lại `npm test` ngoài sandbox | **62/62 file, 610/610 test pass**, exit 0 |
| `npx --no-install tsc --noEmit` | exit 0 |
| `npm run build` | exit 0, **47 file**, 10 biến cấu hình public |
| Parser ba chuỗi U4 | kết quả đúng như mục 4 bên dưới |
| Thư mục `private/` | không tồn tại trong workspace |
| Queue hard-negative | 57 mục: **2 approved, 55 rejected**, tất cả có curator/reviewed_at |
| DB/R2/production hiện tại | không truy vấn trong khảo sát; các số coverage là lịch sử trong tài liệu |

Log test lưu tại `docs/moris-v6/evidence/uplevel-feasibility-tests*.log`. Test logic không chứng minh độ chính xác camera. TypeScript exit 0 cũng không chứng minh mọi module JavaScript được kiểm tra kiểu: tsconfig hiện không bật `allowJs`/`checkJs`.

## 3. Nền tảng có thể tái sử dụng

- Capture đã có mask, tracking, độ nét, chói và readiness năm điều kiện (`src/moris/capture-subject-lock.js`).
- Optical layer đã có segmentation, PCA, crop bbox có padding, letterbox 224, specular clamp và CLAHE (`src/moris/moris-layer1-optical.js:1004`). Không cần viết lại toàn bộ normalizer.
- Browser worker đã tạo embedding/probes, geometry, chất lượng mask và provenance (`src/moris/vector/dinov2.worker.js`).
- Server đã có oversampling giới hạn 100, collapse theo record, hydrate metadata, size gate và ranker riêng (`functions/_lib/moris/v5/orchestrator.js`).
- `scoreFusion.js` đã là owner của final_score trong image branch; có reliability và penalty giới hạn. `imageDecision.js` đã có needs_review, nhưng ghi rõ chưa calibrated.
- Parser đặc điểm, từ điển định dạng lỗ, confusing pairs, công cụ replay metric và manifest đã có. U4/U7 nên mở rộng các thành phần này.

Hệ thống hiện có cấu trúc đủ để nâng cấp từng stage. Tuy nhiên, nhiều chức năng đã code nhưng đang OFF/chưa nghiệm thu; không coi sự tồn tại của module là bằng chứng hiệu quả.

## 4. Những điểm phải sửa hoặc bổ sung trong kế hoạch

### 4.1 Readiness hiện là hướng dẫn, chưa phải khóa chụp

`computeReadiness` yêu cầu không chạm biên và lề tối thiểu 10%. Nhưng `index.html:2242` chỉ disable nút khi `!camera.ready || camera.busy`; `captureCamera()` cũng không kiểm tra `camera.lock.ready`.

Vì vậy, câu “nửa linh kiện sẽ không ready” đúng; suy ra “không thể chụp” là sai. Với yêu cầu mới, phải kiểm tra lại chất lượng ở frame thực sự chụp, chặn frame không đạt và xử lý lỗi nạp module; không chỉ đổi màu overlay hoặc kiểm tra trạng thái của frame cũ. Ảnh tải từ máy cũng cần policy nhất quán.

### 4.2 U2 đang vừa đề xuất đổi preprocess vừa yêu cầu giữ nguyên

Optical layer đã crop theo mask/bbox. Cần phân biệt crop sensor/UI trước encoder với thay thuật toán segmentation/PCA/padding/clamp bên trong canonicalizer.

Giữ cùng chuỗi `kim_canon_v3_letterbox` không tự chứng minh preprocess không đổi. Nếu sửa thuật toán chung làm vector catalogue thay đổi mà vẫn giữ version, provenance mất ý nghĩa. Trong giai đoạn đầu nên chỉ đo/chỉnh capture ở biên đầu vào và bổ sung quality; mọi thay đổi canonicalizer ảnh hưởng index phải có version, quyết định S2/re-index riêng.

Browser thường cung cấp embedding sẵn. `encoder.js` trả ngay embedding đã kiểm tra khi có suppliedEmbedding; sửa riêng `canonicalizeImage` trên server không thay được embedding đã tạo ở browser. Phải sửa đúng đường chạy thật.

### 4.3 Size gate hiện chưa đáp ứng policy “mềm” của kế hoạch

`applySizeGate` giữ candidate thiếu dims, nhưng loại mọi mismatch có số đo, kể cả manual; confidence chưa tham gia quyết định loại. Chỉ thiếu width không đồng nghĩa luôn giữ: cạnh dài lệch vẫn trả mismatch. Comment “không loại trừ” cần được đọc cùng implementation.

`orchestrator.js:388` trả `MORIS_SIZE_GATE_NO_MATCH` khi tất cả bị loại; chưa có fallback về pool trước gate.

U3 phải chốt một bảng policy: manual/unknown chỉ evidence/rerank; hard reject chỉ khi đủ điều kiện verified đã được duyệt; khi hết pool thì cảnh báo + needs_review. Không suy ra phép đo đáng tin chỉ từ chuỗi source do client gửi. Contract đề xuất có method, nhưng normalizeQuerySize hiện chỉ giữ source/confidence; cần mapping rõ.

Thay expectation test cho behavior mới phải ghi nhận đây là thay đổi nghiệp vụ được duyệt, không phải nới assertion để che lỗi.

### 4.4 Parser U4 đã xử lý đúng các ví dụ chính

Đã thực thi trực tiếp `parseIdentifyingFeaturesAST`:

| Chuỗi | Total | To | Nhỏ | shapeCounts |
|---|---:|---:|---:|---|
| `2 lỗ tròn 1 lỗ to 1 lỗ nhỏ` | 2 | 1 | 1 | tron: 2 |
| `2 lỗ tròn, 1 lỗ to, 1 lỗ nhỏ` | 2 | 1 | 1 | tron: 2 |
| `2 lỗ tròn to 1 lỗ nhỏ` | 3 | 2 | 1 | tron: 2 |

U4 chủ yếu cần adapter facts, kiểm tra tính nhất quán và confidence theo field. Không được tự suy hình dạng của lỗ nhỏ chưa mô tả. `shapes` phải phân biệt unknown và 0; contract toàn số 0 dễ biến thiếu thông tin thành “không có lỗ”.

Số lỗ nhìn thấy không nhất thiết là tổng số lỗ nếu có che khuất/chói. Kể cả chụp trọn vật cũng cần holeEvidenceUsable. Size L≈W chỉ là tỷ lệ bbox, chưa chứng minh thân vật vuông thay vì tròn. Không dùng shapeClass làm body_shape chắc chắn.

### 4.5 Candidate union chưa có contract đủ để đưa vào ranker

Hiện nếu vector không có hit đạt ngưỡng, orchestrator return sớm trước evidence/ranking. U5 phải cho size/feature channels có cơ hội chạy trước quyết định no_match, đồng thời giữ fallback có kiểm soát.

Candidate được cứu từ size/feature có thể chưa có vector_similarity. Fusion hiện chỉ nhận vector khi là số, rồi chuẩn hóa trọng số các signal có mặt. Nếu thêm các candidate chỉ có feature tốt, chúng có thể được so thứ hạng thiếu công bằng với candidate có đủ vector evidence.

Cần quy định: identity, source ranks, source limits, null raw vector score, cách lấy vector score cho candidate được cứu hoặc ranking theo nguồn đã hiệu chỉnh, tổng budget, timeout, tie-break và failure isolation. Không gán vector score 0/1 giả. Dedupe theo record_id chuẩn; chỉ fallback code khi đã xác minh identity.

Union có thể tăng recall của pool rộng nhưng không tự đảm bảo Recall@10: candidate thêm vào vẫn có thể đẩy target khỏi top-10. Phải đo cả recall trước ranker và sau ranker.

### 4.6 Scan và latency là việc phải đưa rõ vào roadmap

Image branch gọi `retrieveTextCandidates` trước vector, có thể scan fallback. `hydrateVectorHits` luôn gọi `scanCatalogue`, giới hạn maxScanRows mặc định 1500, để map record. Vì vậy yêu cầu U5 “không full-table scan mỗi request” chưa được thỏa ở đường hydrate hiện hữu.

Với catalogue lịch sử khoảng 545 mã có thể vận hành được, nhưng chưa có P95 phiên này. Khi tăng dữ liệu vượt giới hạn, candidate tồn tại cũng có thể mất ở hydrate. Cần keyed hydration đã kiểm tra quyền, hoặc cache snapshot có invalidation rõ; không mở RLS để tối ưu.

Multi-probe gọi RPC tuần tự. Camera còn cố ý hiển thị quét tối thiểu 1.6 giây. Budget cần tách cold model load, warm inference, capture/animation, network và DB; đo trên thiết bị thực. Chưa đủ cơ sở kết luận chi phí/hạ tầng sẽ giữ nguyên khi shadow chạy thêm pipeline.

### 4.7 Multi-probe và fallback profile cần được audit trong U0

`multiProbeSearch.js` tính retrieval_score từ cosine, RRF và consensus. `hydrateVectorHits` giữ các field này, nhưng `scoreFusion.js` ưu tiên raw vector similarity, không dùng RRF/consensus làm signal trực tiếp. Vì vậy không thể giả định thứ hạng cuối đã tận dụng đầy đủ nhiều probe. Chỉ thêm signal sau ablation và kiểm soát double-count.

`vector/search.js:50` có thể tái sử dụng cùng query vector khi fallback hybrid/v3 sang cls/v2. Cùng dimension chưa chứng minh hai không gian có thể so sánh; unit test fallback chỉ chứng minh đường gọi chạy. Đây là rủi ro hợp đồng cần đo riêng, không phải kết luận đã gây ca lỗi. Cần query embedding đúng profile hoặc policy degraded rõ; không âm thầm coi fallback là tương đương.

### 4.8 U0 cần quyền admin và quan sát đúng stage

`search.js` hiện kiểm tra session; debug dựa env `MORIS_DEBUG_EXPOSE_INTERNAL`, chưa thấy điều kiện admin tại call site. Không tận dụng flag này để trả top-N cho mọi session. Debug mới phải có kiểm tra quyền server và schema cho phép field rõ ràng.

Trace đang ghi thời điểm chuyển stage, chưa đủ timing encoder/RPC/hydrate/ranker tách biệt. Cần target rank ở: từng probe, pool vector trước/sau threshold/collapse, sau hydrate, sau gate, sau fusion và top-10. Nếu target ngoài top-N quan sát được thì ghi `not_in_pool`/rank giới hạn, không bịa global rank.

Self-query rank 1 chỉ chứng minh record có thể truy hồi ở phép đo đó. Không đủ để loại trừ mọi lỗi profile, fallback, hydrate hoặc production config trong query camera thật. Kết luận “index/RPC/profile không hỏng” ở kế hoạch cần thu hẹp.

### 4.9 Baseline dữ liệu và tài liệu đang lệch nhau

- Kế hoạch ghi HEAD `5a9218d`; HEAD hiện `b5b65c2`, thêm chính tài liệu kế hoạch.
- Kế hoạch/sổ nợ ghi 0/57 nhãn; queue thực tế 2 approved + 55 rejected, tất cả đã review. Đây là 2 ca approved, không phải 57 ca hard-negative được xác nhận. Cần xác minh lại bytes ảnh/snapshot trước khi tái dùng làm benchmark mới.
- README evaluation mô tả camera124 có 93 dev/31 holdout, nhưng `private/` không có; state ghi ảnh camera đã bị xóa. Không coi manifest/hash lịch sử là bộ dữ liệu đang sẵn sàng.
- `6/545` dims và tỷ lệ feature coverage là số lịch sử, không đo lại production trong phiên này. Cần audit coverage mới trước khi bật channel.
- “545 ảnh” cần phân biệt SKU/record, front/thumb và tổng asset/vector; không dùng chung mẫu số.
- Quy định đánh giá catalogue 122 mã trong AGENTS cần được đối chiếu với scope 124 camera/545 record ở tài liệu; không tự đổi mẫu số báo cáo.

## 5. Tính khả thi theo phase sau quyết định chụp trọn vật

| Phase | Đánh giá | Việc quyết định |
|---|---|---|
| U0 baseline/telemetry | Cao về triển khai; baseline camera thiếu input | Đo đúng stage, quyền admin, khôi phục query thật |
| U1 capture | Cao về nối gate; cần kiểm chứng false-reject | Bỏ partial_allowed, thực sự enforce full subject ở frame chụp; chốt upload policy |
| U2 canonicalization | Trung bình, dễ ảnh hưởng không gian embedding | Tận dụng crop sẵn; chỉ thay thuật toán khi có version và phép đo parity |
| U3 size | Cao về logic; lợi ích hiện bị giới hạn coverage | Soft/manual, verified policy, fallback, query theo size có giới hạn |
| U4 feature facts | Cao về parser; trung bình về độ tin cậy ảnh | Unknown theo field, grammar, không double-count |
| U5 union | Trung bình | Candidate thiếu vector score, hydrate, budget/timeout và early return |
| U6 fusion/decision | Trung bình; phụ thuộc dữ liệu | Calibration, fairness theo source/coverage, ablation |
| U7 nghiệm thu | Chưa sẵn sàng | Query thật, holdout mới, thiết bị/latency, owner duyệt rollout |

Coverage không cần đầy đủ toàn catalogue mới được thử size channel. Có thể thử trên nhóm có số đo, nhưng phải báo metric riêng nhóm covered/uncovered và kiểm tra không thiên lệch; không tự chọn một ngưỡng “coverage đủ”.

## 6. Evaluation và thứ tự đề xuất

1. Chốt full-subject policy, phạm vi 122/124/545, bộ query và latency budget. Cập nhật mâu thuẫn trong Plan trước khi code behavior.
2. U0 ghi nguyên trạng, lưu config/profile/Git SHA và manifest/hash. Thu ảnh query thật của 3448000001; self-query báo riêng.
3. U1 enforce full-subject, bổ sung quality contract đi hết client → schema → orchestrator → decision. Kế hoạch file hiện thiếu `schemas/query.js`, geometry schema, worker và test API cho contract mới.
4. U3/U4 triển khai facts/evidence ở chế độ quan sát. Thêm kiểm thử manual mismatch, confidence thấp, missing width, conflict/unknown và all-rejected fallback.
5. U5 hoàn thiện union có giới hạn và hydrate; U6 ablation từng signal. U2 thay đổi pixel/canonicalizer là thí nghiệm độc lập để biết gain đến từ đâu.
6. U7 holdout mới sau khi chốt cấu hình. Shadow trước hết chạy local/replay; production shadow cần authorization riêng và budget vì có thêm workload. Không gọi staging pass khi skipped.

Metric nên ưu tiên Top-1, Recall@10, recall của candidate pool, false exclusion và P95. MRR@10 hỗ trợ chẩn đoán. nDCG@10 cần định nghĩa relevance; nếu mỗi query chỉ có một SKU đúng thì không thay thế được các metric chính. Cần ảnh unknown/non-part và ca tương tự nhưng không có trong catalogue để đo false-accept/abstain; known-only không đủ.

Gate “Top-1 không giảm quá sai số đo” và “target rank cải thiện rõ ràng” chưa có ngưỡng cụ thể. Phải chốt trước khi chạy thí nghiệm. So sánh cùng query, cùng dataset/hash và lưu số đếm đúng/sai, không chỉ phần trăm. Không tuyên bố false-exclusion bằng 0 trên mọi trường hợp chỉ từ fixture hữu hạn.

## 7. Câu hỏi còn mở

1. Có thể cung cấp lại ảnh query thật 3448000001 và bộ camera có nhãn từ nguồn nào? Ai xác nhận SKU/session/điều kiện chụp?
2. Thiết bị chính và thời gian chờ tối đa từ bấm chụp đến kết quả? Phân biệt warm/cold nếu có.
3. Yêu cầu trọn vật có áp dụng bắt buộc cho ảnh tải từ máy? Khi không thể xác định chắc chắn có thấy trọn, UI yêu cầu chụp lại hay xác nhận thủ công?
4. Giữ dung sai verified 5%/2mm và manual 10%/3mm? Khảo sát chưa đổi mức nào.

Chưa có cơ sở định lượng mức tăng accuracy, chi phí cloud hay lịch hoàn tất. Việc thu ảnh/nhãn và hiệu chỉnh có thể chi phối thời gian hơn phần viết code. Có thể bắt đầu quan sát với hạ tầng hiện có; schema/index/RPC mới chỉ quyết định sau audit và benchmark.

## 8. Phạm vi thay đổi khảo sát

Chỉ thêm báo cáo/evidence và cập nhật state/checklist. Không sửa code ứng dụng, assertion, Plan_uplevel, DB, vector, deploy hay commit. Giữ nguyên việc chủ dự án xóa `pipeline_moris.md`. U0–U7 vẫn chưa được đánh dấu hoàn thành.

## 9. Bổ sung kiểm tra production chỉ đọc và hai screenshot (2026-10-21)

Chủ dự án cho phép dùng cấu hình `.env`, Supabase/API để khảo sát dữ liệu và chỉ rõ `image.png`, `image copy.png`. Đã xem cả hai ảnh. Supabase CLI không có sẵn trong PATH; thử `npx --no-install supabase --help` không lấy được help (tiến trình kết thúc 143). Khảo sát dùng connector Supabase cho SELECT và PostgREST GET bằng `.env`; không cài thêm CLI. GET trong sandbox lỗi kết nối; chạy lại ngoài sandbox được HTTP 200. Không in key/token/password.

### 9.1 Bằng chứng ảnh

- `image.png` là screenshot Editor: code 3448000001, dài 180 mm, chưa có cạnh ngắn, mô tả 2 lỗ tròn 1 to 1 nhỏ, vị trí bên phải.
- `image copy.png` là screenshot điện thoại: preview cho thấy toàn bộ linh kiện với hai lỗ; danh sách gợi ý 10 mã không có target. Moris đồng thời cảnh báo ảnh chưa rõ vùng linh kiện.
- Đây là bằng chứng giao diện về ca lỗi; không phải request gốc hoặc ảnh camera nguyên byte. Không thể khôi phục chính xác embedding, query size, filter, runtime profile và target rank ở từng stage từ screenshot.
- SHA256 `image.png`: `76aeef63ce6cc72b91a028941477e9d996e7e6cabcc633e1f27599f5e946193a`.
- SHA256 `image copy.png`: `0f35a713c259474e02d648a9f5834cdb11eeb307f91ced198e24468eb8e2d4fe`.

### 9.2 Dữ liệu live đã đo

| Hạng mục | Kết quả SELECT/API thực tế |
|---|---|
| Catalogue | 545 record, 545 code khác nhau |
| identifying_features không rỗng | 326/545; đây không phải tỷ lệ parser/nhãn lỗ hợp lệ |
| Có dimensions | 6/545; 0 mã có cả dài và rộng |
| Active legacy cls/v2 | 1.069 vector, 534 record |
| Active hybrid/v3 | 1.103 vector, 544 record |
| Target dimensions | dài 180 mm, rộng null, method user, confidence 0.9 |
| Target vector | 2 active hybrid front/thumb, 0 legacy; hole_count 2 |
| Self-query front qua RPC production | target front rank 1, similarity 1; thumb rank 2, similarity khoảng 0.990368 |
| Kênh size giả lập bằng SELECT quanh 180 mm | đúng 1 record phù hợp trong dữ liệu đã nhập: 3448000001 |
| RPC vector hiện có | `match_catalogue_image_vectors`; SELECT pg_proc không thấy bản `_v6` |

Self-query chỉ đọc vector đã có để gọi hàm match STABLE; không inference, embed, re-index hay ghi DB. Phép SELECT size dùng dung sai `max(10% * max(L,180),3mm)` giống manual contract; chưa triển khai size channel và chưa chạy lại pipeline camera.

Đối chiếu các mã đọc từ screenshot: 9/10 mã tìm thấy trong DB hiện tại đều không có dims và đều có cả legacy/hybrid. Chuỗi đọc ở vị trí thứ 2 là `3410640001` không tìm thấy trong catalogue hiện tại; cần request/snapshot gốc để phân biệt mã bị xóa với lỗi đọc ảnh. Không khẳng định 10/10 đã đối chiếu được.

### 9.3 Chẩn đoán cập nhật, theo độ chắc chắn

**Đã xác nhận: dữ liệu target và đơn vị đúng.** Editor và API/SQL cùng cho dài 180 mm = 18 cm. Target có hybrid active và có thể truy hồi rank 1 khi self-query đúng profile. Không có cơ sở quy lỗi cho thiếu metadata/size của target.

**Đã xác nhận: size hiện chưa thể cứu target ngoài vector pool.** Size chỉ chạy sau ANN/hydrate và không tạo candidate mới. Candidate không có dims vẫn được giữ. Do đó target có 180 mm không tự giúp nó vào top-10. Catalogue có size cũng không thay thế query size: phải có số đo query hợp lệ, payload gửi lên và gate được bật. Screenshot không chứng minh request có truyền 180 mm; không thể suy số đo tuyệt đối đáng tin từ ảnh không có chuẩn tỷ lệ.

**Nguy cơ loại target theo profile đã được chứng minh về điều kiện.** Các giá trị không bí mật trong `.env` hiện là `cls_l2_v1`, `kim_canon_v2`, topK 60, minSimilarity 0.55. Target chỉ có hybrid/v3. Nếu query runtime thực sự dùng cls/v2, WHERE profile/preprocess trong RPC sẽ loại target trước ranking, bất kể ảnh dễ nhận diện. Không được lấy `.env` local làm bằng chứng cấu hình production của phiên lỗi. Cần request embedding_profile và runtime config của phiên đó để kết luận nguyên nhân lịch sử.

**Feature evidence đang chưa tham gia đầy đủ.** Target có hai lỗ; các mã gợi ý có mô tả 3, 4 hoặc 11 lỗ vẫn có thể đứng cao khi geometry flags OFF và image search chưa có feature facts/channel được đo. Cảnh báo chất lượng trên screenshot cho thấy cần theo dõi mask reliability, nhưng chưa đủ để khẳng định segmentation là nguyên nhân duy nhất.

**RPC có rủi ro unknown bị biến thành số đo.** Hàm production COALESCE hole_count null thành 0, aspect_ratio null thành 1.0; đây là điểm cần đưa vào audit U4/quality trước khi dùng như evidence đáng tin. Chưa chứng minh nó tác động ca này, nhất là khi geometry verifier OFF.

### 9.4 Ưu tiên xử lý sau khảo sát

1. U0 ghi profile/preprocess thực tế của browser/server, đường fallback và số ứng viên theo profile; kiểm tra coverage của target ngay từ đầu.
2. Có query size 180 mm thì thử size-compatible union có giới hạn, đồng thời giữ unknown neutral. SELECT hiện tại chứng minh có thể tìm lại target qua dữ liệu size; không chứng minh thứ hạng mới sẽ tốt hơn trên toàn bộ catalogue.
3. Đưa feature facts reliable vào evidence/rerank mềm; không bật lại toàn bộ geometry chỉ vì ca này.
4. Dùng hai screenshot làm tài liệu ca hồi quy. Nếu có ảnh capture/request gốc, dùng để replay đúng phiên lỗi; nếu chỉ có screenshot, mọi thử nghiệm lấy preview từ screenshot phải ghi là ảnh dẫn xuất, không gọi là tái lập chính xác.

Log/response chỉ đọc nằm trong `docs/moris-v6/evidence/uplevel-live-*.json`. Các kết quả live thay thế số coverage lịch sử ở phần trước khi lập baseline kế tiếp. Chưa thay đổi code hay cấu hình/profile nào.

## 10. Quyết định nghiệp vụ và đề xuất hướng tiếp theo

Chủ dự án xác nhận cạnh dài là ưu tiên, cạnh ngắn chỉ hỗ trợ và không bắt buộc có dữ liệu. Vì vậy số 0 mã có đủ hai cạnh không phải blocker cho size recall. Đánh giá CLS/hybrid và đề xuất điều chỉnh U0–U7 nằm tại [UPLEVEL_DIRECTION_DECISION.md](UPLEVEL_DIRECTION_DECISION.md). Đây là kết luận mới nhất của khảo sát; chưa sửa Plan_uplevel hoặc runtime.

Bổ sung nghiệp vụ mới nhất 2026-10-21: chủ dự án chốt camera landscape khi cầm ngang (Android+iPhone Safari), nhận dạng cả lỗ kín và khoét hở, số đo nhập tay lệch<=5% được chấp nhận. Mức manual10% trong các phần trước là lịch sử/code hiện hành, không còn là đề xuất nghiệp vụ mới. Xem [nghiên cứu chi tiết](HARNESS_CAPTURE_HOLE_RESEARCH.md); chưa thay code hoặc authorization rebuild.
