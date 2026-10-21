# Plan Pipeline Moris — Camera → Sàng lọc → Hybrid → Ranking

> Ngày: 2026-10-21. Trạng thái: **PLAN — CHƯA TRIỂN KHAI PIPELINE MỚI**.
>
> Thay thế `Plan_uplevel.md` theo yêu cầu chủ dự án. Quyết định nghiệp vụ mới nhất trong phiên được ưu tiên so với đề xuất cũ. Việc lập plan không phải authorization để sửa production, xóa/tạo vector, chạy migration, train, deploy hoặc commit.

## 0. Điểm vào cho agent phiên sau

Đọc theo thứ tự:

1. `AGENTS.md` — quyền, phạm vi và quy trình bắt buộc.
2. `state.json` — trạng thái thực tế, bằng chứng và checkpoint.
3. `Plan_pipeline_moris.md` — kế hoạch triển khai hiện hành.
4. `docs/moris-v6/HARNESS_CAPTURE_HOLE_RESEARCH.md` — khảo sát code và cơ sở nghiên cứu.
5. `docs/moris-v6/UPLEVEL_FEASIBILITY_REVIEW.md` mục 9 — live data, screenshots và giới hạn chẩn đoán.
6. `docs/moris-v6/UPLEVEL_DIRECTION_DECISION.md` — phân biệt CLS/hybrid, giới hạn số liệu cũ.
7. `docs/moris-v6/ARCHITECTURE.md`, `TECH_DEBT_REGISTER.md`, `DB_MIGRATION.md`, `RELEASE_CHECKLIST.md`.

Trước khi sửa: `git status --short --branch`, `git log --oneline -5`. Không reset/clean/stash/restore thay đổi của người dùng. `pipeline_moris.md` đang bị chủ dự án xóa; giữ nguyên trạng thái đó. File này khác tên `Plan_pipeline_moris.md` mới.

Plan dùng các phase **P00–P13**. U0–U7 trong báo cáo cũ chỉ là lịch sử, không chạy hai checklist đồng thời. P13 là hậu kiểm mới do owner bổ sung 2026-10-21 và được khảo sát sau cùng. Không đánh dấu xong bằng việc viết tài liệu.

## 1. Mục tiêu và phạm vi

Moris phải tìm linh kiện bằng ảnh camera thật, dùng đúng cạnh dài nhập tay và bằng chứng ngoại quan để giảm nhầm lẫn. Harness điều phối các thuật toán/model; DINOv2 chỉ là tầng biểu diễn ảnh trong hệ thống.

Luồng sản phẩm đích:

```text
Mở camera landscape + nhập cạnh dài
  → tracking toàn vật trên vùng ảnh đủ rộng
  → khóa frame, xác nhận trọn vật, crop có khoảng đệm
  → hậu kỳ: mask/nền/chói/căn hướng có bằng chứng
  → sàng lọc sớm: cạnh dài + ngoại quan đáng tin
  → DINOv2 hybrid tạo query vector đúng profile
  → đối chiếu và xếp hạng nhóm ưu tiên
  → chỉ mở rộng nhóm cứu khi thiếu top-10 hợp lệ
  → Moris trả kết quả, điểm và lý do đối chiếu
```

Có thể lấy shortlist length song song camera/hậu kỳ để giảm chờ. Điều này không biến size gate sau ANN thành sàng lọc sớm, và không tự giảm chi phí inference query.

Phạm vi đợt chính: capture đúng, evidence, length-first recall, nhận dạng lỗ/khoét, hybrid contract, ranking và nghiệm thu. Model bổ sung/training là nhánh có điều kiện P11. Rebuild/retire legacy là phần riêng ở P12, chưa được thực thi.

## 2. Nghiệp vụ đã chốt

### 2.1 Camera và ảnh

- Người dùng **cầm điện thoại ngang**, camera landscape; hỗ trợ Android Chrome và iPhone Safari.
- Giữ UI/control hiện có; chỉ điều chỉnh hướng, vùng camera và responsive cần thiết để không che thao tác.
- Không dùng CSS rotate video như bằng chứng đã mở rộng vùng capture.
- Phải **thấy trọn vật**. Không có chế độ partial_allowed trong đợt này.
- Tracking một mảnh ổn định không đồng nghĩa khóa đúng toàn bộ vật.
- Crop có khoảng đệm; không lấy bbox hiển thị đang làm mượt làm tọa độ crop cuối.
- Ảnh tải từ máy phải đi qua kiểm tra chất lượng/trọn vật tương đương; không trở thành đường bỏ qua gate. Nghiệm thu policy này cùng P03.

### 2.2 Cạnh dài và nhóm cứu

- Cạnh dài nhập tay là kích thước chính; cạnh ngắn hỗ trợ, không bắt buộc.
- Chênh lệch **≤5%** được chấp nhận. Mức manual 10% trong code/tài liệu cũ không phải yêu cầu đích.
- Nếu có **ít nhất 10 ứng viên nhóm phù hợp đạt điều kiện chất lượng**, chọn top-10 trong nhóm đó; không chèn nhóm phụ.
- Nếu nhóm phù hợp thiếu 10, mới mở rộng nhóm cứu và chỉ bổ sung số còn thiếu.
- Mỗi kết quả cứu phải có note rõ lý do và điểm; thiếu size khác với đã đo vượt 5%.
- Không nhồi mã bất kỳ để đủ 10. Hết ứng viên đủ chất lượng thì trả ít hơn 10 hoặc no_match.
- Không có query length hợp lệ: vẫn tìm qua ảnh/feature; không bịa kích thước từ ảnh không có chuẩn tỷ lệ.
- Candidate thiếu width không bị phạt. Width không tự tạo veto lấn át length.

### 2.3 Lỗ và khoét

- Nhận dạng cả **lỗ kín bên trong** lẫn **khoét hở ra mép**.
- Lỗ tròn và nhóm cần số lượng phải có instance/count; chỉ khớp tên định dạng chưa đủ.
- Răng cưa hiếm, không có biến thể cần phân giải: tương đương mẫu/presence là đủ, không đếm từng răng.
- Thiếu hoặc không chắc bằng chứng là unknown, không thành 0/không khớp.
- Mẫu ảnh trong `moris_hole_samples` là từ điển tham chiếu, không tự huấn luyện model khi thêm row.
- `identifying_features` là dữ liệu catalogue sẵn có; không bắt người dùng nhập lại toàn bộ khi tìm ảnh.

### 2.4 Hybrid và quyền ghi

- Hướng phát triển dùng **hybrid** làm baseline kỹ thuật; chưa có A/B công bằng chứng minh luôn thắng CLS.
- Không coi nhãn “wasm/q8” là chứng minh đang dùng hybrid.
- Query vector tạm không được ghi index. Editor không embed/enqueue/enroll/reindex.
- Chỉ Vector Center single/batch do người dùng xác nhận và server kiểm tra quyền được ghi index.
- Mong muốn xóa/tạo lại để hybrid-only là ý định tương lai, không phải lệnh xóa trong plan này.
- Không fine-tune backbone hoặc thêm model chỉ để gọi tên định dạng tiếng Việt.

## 3. Baseline đã quan sát và khoảng trống

Các số dưới đây đo ngày 2026-10-21; phải đo lại khi bắt đầu implementation nếu dữ liệu thay đổi.

| Hạng mục | Quan sát |
|---|---|
| Catalogue live | 545 record/545 code |
| identifying_features không rỗng | 326; không đồng nghĩa 326 nhãn lỗ đúng/đủ |
| Có length | 6/545; width không cần đầy đủ để triển khai |
| Legacy active | 1.069 vector / 534 record |
| Hybrid active | 1.103 vector / 544 record |
| Target 3448000001 | dài 180mm, width null, method user; 2 hybrid active, 0 legacy |
| Self-query đúng profile | target rank 1, similarity 1; không phải replay camera |
| SELECT length tương thích 180mm trước đây | target là mã duy nhất trong dữ liệu size hiện có; không chứng minh duy nhất trong 545 mã |
| Camera | center crop 1000:410; chưa có landscape flow đầy đủ |
| Mask | tracking/overlay và optical segmentation độc lập |
| Hậu kỳ | có p98 clamp/median/CLAHE nhưng segmentation chạy trước clamp |
| Size | gate sau ANN; chưa có recall/shortlist sớm theo length |
| Hole reference | tag matching bỏ số lượng; chưa visual-match ảnh mẫu từng instance |
| Khoét hở | enclosed-hole floodfill hiện không nhận phần thông ra biên |
| Scan | hydrate vector hits hiện scan catalogue, có giới hạn mặc định 1500 |

`image.png` là screenshot Editor; `image copy.png` là screenshot ca camera top-10 thiếu target. Hai ảnh đính kèm Editor là cùng một file. Chưa có raw camera/request payload để gọi là đã tái lập chính xác query gốc.

`.env` local chọn CLS/v2, browser variants hiện dùng hybrid/v3. Đây là rủi ro cần audit runtime, không kết luận production phiên lỗi dùng CLS. RPC production đã đọc là `match_catalogue_image_vectors`, không thấy `_v6` ở lần quan sát đó.

M22 global dùng hybrid, không phải CLS. Số lịch sử: dev Top1 58/93, Recall10 78/93; thêm holes làm giảm 54/93 và 75/93; holdout Top1 20/31, Recall10 29/31. Không dùng lại holdout đã xem làm unseen cho thuật toán mới; không lấy số này làm performance production hiện tại.

## 4. Kiến trúc và hợp đồng đích

Tên field/module mới ở phần này là **đề xuất**, chưa phải API/schema đang tồn tại. Trước khi thêm phải đối chiếu implementation và chốt version.

### 4.1 Capture và ownership

Một capture có frame ID và các phép biến đổi có thể truy vết:

```text
Sensor frame gốc
  → mapping display/tap/orientation
  → tracking trên frame đủ rộng
  → frame cuối + object envelope + material mask
       ├─ crop ảnh độ phân giải cao → hole/notch perception
       └─ normalizer đúng version → hybrid embedding
```

- Envelope/ROI chứa toàn vật; material mask giữ topology lỗ; display box chỉ để hiển thị.
- Chọn một owner mask/ROI hoặc truyền contract rõ; không âm thầm chạy hai segmentation rồi coi chúng tương đương.
- Revalidate frame cuối; mask/box cũ, khác orientation/kích thước hoặc khác chủ thể phải bị từ chối.
- Reliability là kết quả kiểm chứng/quality, không dựa một mình vào stable count hoặc client tự gắn true.
- Crop padding và mask dilation là hai phép khác nhau; không bít lỗ nhỏ để làm ảnh sạch hơn.

### 4.2 Hợp đồng quality/provenance đề xuất

| Nhóm | Nội dung tối thiểu |
|---|---|
| Capture | version, frame ID/hash, settings thực tế, orientation, timestamp, full/partial/rejected |
| Tọa độ | sensor/display/crop dimensions, transform, bbox, padding, boundary checks |
| Chất lượng | mask reliability, sharpness, glare/occlusion, completeness, warnings |
| Preprocess | algorithm version, profile, input/output hash, status succeeded/fallback/skipped/failed |
| Perception | instance IDs, closed/open, class/unknown, contour/crop ref, quality, count exact/lower-bound/unknown |
| Search | query length/width, source, candidate IDs từng stage, profile, score, nguồn và rescue reason |

Không log secret/embedding/raw ảnh vào public response. Diagnostic nội bộ cần kiểm tra session **và quyền admin phía server**. Ảnh chẩn đoán mặc định tạm/local; lưu ảnh thật lâu dài hoặc lên server cần quyết định retention/access riêng. Không đưa diagnostics/private manifest vào static allowlist.

### 4.3 Quy ước size cần khóa ở P00

Quyết định đã chốt là 5%; mẫu số và sàn mm chưa được chủ dự án chốt. Thiết kế đề xuất để review:

```text
delta_rel = abs(candidate_length - query_length) / query_length
within_tolerance = delta_rel <= 0.05
Ví dụ query 180mm → 171–189mm, tính cả hai biên.
```

Không âm thầm kế thừa sàn 2/3mm nếu khiến ứng viên lệch >5% thành “trong 5%”. Nếu cần sàn tuyệt đối cho vật nhỏ phải ghi thành ngoại lệ nghiệp vụ riêng. Không tự chọn mẫu số khác rồi dùng cùng ví dụ biên. Chưa đổi code ở bước viết plan.

Chuẩn hóa mm, dấu phẩy thập phân, số âm/0/NaN/blank; L≥W khi có cả hai. Nếu user chỉ nhập một cạnh thì đó là cạnh dài. Chặn việc nhập 18 rồi tự đoán 18cm nếu UI đang ghi mm; mọi chuyển đơn vị phải rõ.

### 4.4 Perception và từ điển

Luồng: phát hiện instance → phân loại closed/open → chuẩn hóa contour/crop → tra mẫu/taxonomy → nhận tên/unknown → tổng hợp facts → so metadata.

- Giữ một leaf label/instance, parent alias chỉ để tra cứu; không đếm bán oval thêm một lần nữa ở họ oval.
- Preserve aspect ratio khi chuẩn hóa mẫu; không bóp ellipse/slot thành vuông.
- Lỗ tròn nhìn xiên có thể thành ellipse; không mặc định đó là oval cơ khí.
- Nhóm count dùng số instance; răng cưa dùng presence/similarity/unknown.
- Nếu chói/che mất vùng thì count có thể là lower-bound, không gán exact total.
- To/nhỏ là tương đối nếu không có phép đo riêng, không bịa đường kính mm.
- Không suy query facts từ chính metadata target; không dùng output model làm ground truth cho model đó.

Mẫu hiện có là registry đọc-only. Nếu thêm descriptor hoặc model registry thì design/local proposal trước; không tạo đường ghi vector ngoài Vector Center. Không bắt buộc thêm một vector DB để tra 15 ảnh tham chiếu.

### 4.5 Early shortlist và vector matching

1. Khi query có length: lấy danh sách candidate tương thích theo length và filters được phép trước vector matching.
2. Bổ sung/đối chiếu facts ngoại quan đáng tin; missing giữ unknown. Chưa hard exclude bằng geometry yếu.
3. Tạo query hybrid một lần đúng profile. Làm rõ preprocess chung với catalogue trước đổi output.
4. Đối chiếu vector **trong tập ưu tiên**, có đường tìm bổ sung cho size/feature candidate chưa vào global ANN.
5. Sau khi rank/quality-check mới biết có đủ 10 ứng viên hợp lệ. Có 10 row cùng size chưa đủ để tắt rescue.
6. Nếu thiếu, tìm nhóm cứu với budget và quality floor đã hiệu chỉnh.

Phải đánh giá keyed/scoped matching bằng RPC mới hoặc distance lookup giới hạn, so với union global ANN. Không giả định RPC hiện đã nhận candidate IDs. Lấy global top-100 rồi giao với shortlist có thể tiếp tục làm mất target; nếu dùng phương án đó phải có đường chấm vector đúng-profile cho candidate được cứu và đo recall.

Không tải toàn bộ embeddings xuống browser để bù thiếu RPC. Candidate không có vector hợp lệ không được gán 0/1 giả; quyết định có được trả như metadata-only needs_review phải có policy/score_source riêng, không giả cùng thang đo với fused image score.

### 4.6 Selection và ranking

- Ranker duy nhất sở hữu final_score; giữ raw cosine, distance, source ranks và breakdown riêng.
- Đầu tiên chọn top-10 hợp lệ trong primary. Nếu ít hơn 10, giữ primary và bổ sung rescue đủ số còn thiếu khi có ứng viên hợp lệ.
- `primary_count=10` → `rescue_count=0`; `primary_count=7` → tối đa 3 rescue; không đủ quality → trả <10.
- Phân biệt rescue vì missing_length, outside_tolerance, feature_unknown/conflict, hay degraded retrieval; không che lý do.
- Không double-count số lỗ qua structural/feature/hole-format, hoặc cộng nhiều view như nhiều phiếu độc lập.
- Chấm width như hỗ trợ; thiếu width neutral.
- Nếu hiển thị primary trước rescue, dùng comparator nhóm rồi score, giữ score thật. Không sửa score để tạo thứ tự mong muốn. API/publicResult/frontend phải dùng cùng quy tắc; không để sort score toàn cục vô hiệu hóa policy nhóm.
- Điểm là ranking score, không phải xác suất đúng. Nếu có %, phải mô tả đúng đơn vị và calibration.
- Query không có size: rank ảnh/feature bình thường và ghi chưa kiểm tra size; không giả nhóm primary đã đạt length.

## 5. Bản đồ file thực tế

| Khu vực | File hiện hữu ưu tiên khảo sát/sửa đúng phạm vi |
|---|---|
| Camera/UI | `src/app.js`, `index.html` |
| Tracking | `src/moris/capture-subject-lock.js` |
| Optical | `src/moris/moris-layer1-optical.js`, `.ts` |
| Embedding | `src/moris/moris-layer2-embedding.js`, `.ts`; `src/moris/vector/dinov2.worker.js`, `browserDinov2.js` |
| Size client/server | `src/moris/size-contract.js`, `functions/_lib/moris/v5/retrieval/sizeGate.js` |
| Query contract | `functions/_lib/moris/v5/schemas/query.js`, `geometry.js`, `candidate.js` |
| Retrieval | `orchestrator.js`, `connectors/catalogue.js`, `connectors/supabase.js`, `vector/search.js`, `retrieval/multiProbeSearch.js`, `vectorHitCollapse.js` trong v5 |
| Facts/dictionary | `retrieval/featureMatcher.js`, `holeFormatReference.js`, `structuralEvidence.js`, `confusingPairs.js` trong v5 |
| Ranking/public | `retrieval/scoreFusion.js`, `candidatePool.js`, `presentation/imageDecision.js`, `publicResult.js`, `userMessage.js` trong v5 |
| Runtime/API | `runtime/{trace,queryContext,config}.js`, `vector/{profiles,encoder}.js`; `functions/api/moris/{health,health-admin,search,vector-search,vector-upsert}.js` |
| Eval | `evaluation/moris-v6/`, `tools/validate-moris-dataset.mjs`, `tools/evaluate-moris-v6.mjs`, `tools/ablate-moris-v6.mjs` |

JS/TS nguồn song song cần xác định file runtime và quy trình đồng bộ trước sửa; không chỉ sửa file test import còn bỏ runtime. Module mới/endpoint/migration chỉ thêm khi có thiết kế rõ; không tự bịa schema hoặc tên env đã tồn tại.

## 6. Roadmap và phụ thuộc

```text
P00 Contract, dữ liệu và metric
  → P01 Baseline + telemetry
  → P02 Camera landscape và mapping
  → P03 Full-object lock + crop
  → P04 Hậu kỳ có bằng chứng
  → P05 Hole/notch dictionary + facts
  → P08 Scoped matching/recall
  → P09 Ranking, rescue và trình bày
  → P10 Nghiệm thu end-to-end
  → P12 Rebuild/release theo authorization riêng

P06 Length shortlist: phát triển sau P00/P01, song song P02–P05
P07 Hybrid parity: audit từ P01, chốt trước P08 và trước mọi rebuild
P11 Model bổ sung: chỉ mở nếu dữ liệu P05/P10 chứng minh cần
```

Không thay nhiều stage trong một thí nghiệm. Có thể phát triển module độc lập, nhưng phải có baseline/ablation trước bật behavior gộp. Không suy “viết xong” = “nghiệm thu ảnh thật”.

### [x] P00 — Khóa contract nghiệp vụ, dữ liệu và điều kiện đo

**Đầu vào:** nghiên cứu, live evidence, quyết định owner ở §2.

- [x] Ghi decision record về công thức 5%/sàn mm; policy rescue và comparator; query không có size; upload full-object. Xem `docs/moris-v6/PIPELINE_CONTRACT_AND_BASELINE.md`; owner xác nhận 5% theo query, không sàn mm.
- [x] Chốt định nghĩa metric chính; quality floor và budget P95 ghi `pending calibration/owner review`, không tự đặt gate đã duyệt.
- [x] Lập schema/validator manifest camera thật có SKU/session/shot, device, ánh sáng, full/partial/chói và nhãn lỗ/khoét. Ảnh/nhãn thật do owner bổ sung khi nghiệm thu production.
- [x] Đo snapshot catalogue production bằng truy vấn chỉ đọc lúc 2026-10-21 02:50:18 UTC; 545 mã, 6 có length, hybrid active 1.103 vector/544 record, CLS active 1.069/534. Index thay đổi ngay sau đó (02:56 chỉ 44 hybrid/0 CLS), nên snapshot này chỉ là mốc lịch sử, phải đo lại khi ổn định. Không dùng 122 mã đã xóa làm gate.
- [x] Tách self-query/catalogue, camera thật, screenshot-derived và synthetic. Schema giữ hash và label status; chưa có camera ảnh thật để đo.
- [x] Queue 57 ca lịch sử được owner bỏ khỏi gate nghiệm thu; giữ làm hồ sơ lịch sử, không đưa vào metric hiện hành.
- [x] Xác định ma trận năng lực để nghiệm thu rộng trên Android Chrome/iPhone Safari, cold/warm và orientation lock fallback; ghi model/phiên bản của từng ca khi chạy, không khóa sản phẩm vào allowlist thiết bị. Xem `docs/moris-v6/PIPELINE_CONTRACT_AND_BASELINE.md`; kiểm thử máy thật vẫn pending ở P02/P10.

**Exit:** decision record + manifest/schema + bảng metric/threshold có trạng thái duyệt rõ. Thiếu camera không cản khảo sát/unit/instrumentation nhưng chặn claim accuracy/GO release.

**Rollback:** tài liệu/fixture local; không DB.

### [ ] P01 — Baseline, profile audit và evidence từng stage

**Phụ thuộc:** P00 đủ contract đo. **Behavior ranking giữ nguyên.**

- [ ] Trace monotonic timings cho capture/normalizer/encoder/shortlist/RPC/hydrate/fusion/decision; không chỉ timestamp tên stage.
- [x] Debug nội bộ server-gated admin, không chỉ env flag; public response không lộ top-N/secret/raw embedding.
- [ ] Ghi model/version/preprocess/profile browser, health/server, RPC thực sự gọi; count view/probe thực tế và fallback reason. Đã có server embedding profile và chuỗi RPC thực gọi/ok/error trong debug admin; browser/health/probe còn thiếu.
- [ ] Ghi target membership/rank ở từng pool. Ngoài pool quan sát thì not_in_pool, không bịa global rank.
- [ ] Audit coverage live theo asset/profile và freshness; phân biệt record, image asset và vector. Snapshot exact object-key 02:53 đã biến động lúc 02:56 (44 hybrid/0 CLS); chờ index ổn định để đo lại, byte/ETag freshness còn thiếu.
- [ ] Công cụ read-only replay một query có target, lưu config/Git SHA/hash và metrics JSON.
- [ ] Với 3448000001: giữ self-query baseline; screenshot chỉ evidence UI. Chỉ báo reproduced khi có input/request đủ để replay.

**File:** trace/queryContext, API search/health-admin, orchestrator, tools/evaluation; mở rộng tests API/telemetry hiện hữu hoặc thêm file có tên được ghi trong task.

**Test/exit:** không đổi thứ hạng baseline; test admin/public separation và redaction; log baseline thật + profile audit. Có thể bắt đầu P02 sau baseline kỹ thuật, không tuyên bố baseline camera nếu thiếu input.

**Rollback:** tắt diagnostics mới, không thay ranking/index.

### [ ] P02 — Camera landscape, vùng xem và tọa độ thống nhất

- [x] Feature-detect orientation/fullscreen; dùng user gesture mở camera; giữ custom controls, không ép native video fullscreen làm mất overlay. Code và unit test xác nhận đường fallback; máy thật chờ owner nghiệm thu.
- [x] Android hỗ trợ thì lock landscape; Safari/thiết bị từ chối thì detect hướng cầm, hướng dẫn xoay, không crash hoặc chặn camera vì lock API lỗi. Code/unit test pass; kiểm thử máy thật pending.
- [x] Đọc videoWidth/videoHeight và track settings thực tế; không suy ideal 1920×1080 là đã nhận đúng. Chưa nghiệm thu thiết bị thật.
- [x] Bỏ phụ thuộc crop 1000:410 ở vùng phân tích khi làm mất vật; dùng toàn frame sensor và khung video aspect thực. Chưa đo mobile UX thật.
- [x] Tap, box, analysis và capture dùng tọa độ toàn frame; reset seed/mask history khi rotate/resize/switch camera. Đã kiểm code và test tọa độ; mapping trên máy thật còn chờ owner.
- [ ] Kiểm tra safe area, bàn phím size, close/reopen, camera permission và stream cleanup. Đã thêm safe-area CSS và test keyboard resize không reset tracker, close/pending permission/track cleanup; E2E thiết bị thật còn pending.

**File/test:** src/app.js, index.html, camera box/frontend tests; test toán tọa độ + E2E rotation; nghiệm thu máy thật hai hệ.

**Exit:** cùng vật và điểm chạm map đúng ở portrait→landscape/đổi camera; vùng capture đúng preview đã quy định, UI còn đủ control. Mock browser không thay nghiệm thu Safari thật.

**Rollback:** khôi phục camera layout/mapping theo version; ghi rõ nếu fallback chỉ còn chế độ cũ, không gọi landscape đã pass.

### [ ] P03 — Khóa toàn vật và crop từ frame gốc

- [ ] Phân biệt envelope/material/display box; mask bbox và padded ROI của frame cuối tách khỏi EMA display box, lưu source frame/ROI. Frame ID và ảnh thật cần bổ sung khi owner nghiệm thu.
- [ ] Khảo sát lỗi bóng/chói chia component, seed rơi trên mảnh, merge nhầm hai vật, vật mỏng/dài/uốn cong.
- [x] Quality/full-object gate ở nút và capture handler; revalidate frame cuối, không chỉ tin lock.ready frame cũ. Test local pass; tỷ lệ false-ready trên ảnh thật pending.
- [x] Crop theo ROI toàn vật có padding 8% từ mask bbox của frame cuối, không crop theo display EMA bbox. Query crop đi vào encoder và search cùng dữ liệu; test local pass. Padding/segmentation trên ảnh thật pending.
- [x] Upload từ camera modal và Moris input dùng still-image gate bốn quality checks (không giả temporal stability); ảnh fail không gọi embedding/search. Test local pass; false-reject trên ảnh thật pending.
- [x] Truyền capture quality/source frame/crop ROI qua schema server có kiểm tra biên; chỉ là diagnostics untrusted, không dùng làm nhãn GT/ranking. Test local pass.

**Test:** full-object mask có GT; hai đầu, nhiều component, vệt chói, seed sai, chạm biên, stale frame, đổi orientation, module lỗi, nhiều vật và upload.

**Exit:** fixture bắt buộc không cắt đầu/chi tiết; đo completeness/false-ready/false-reject trên ảnh thật và so baseline. Ngưỡng ảnh thật chốt P00; synthetic không là camera pass.

**Rollback:** revert riêng capture/lock, không đổi vector profile; nếu full-subject chưa bảo đảm thì giữ gate chưa GO.

### [ ] P04 — Hậu kỳ và bằng chứng đầu vào encoder

- [ ] Nối capture mask/ROI và optical bằng contract; không hai segmentation độc lập không có consistency check.
- [ ] Xử lý rủi ro specular trước/trong segmentation; p98 clamp sau segmentation chỉ là một bước hỗ trợ.
- [ ] Giữ raw high-resolution crop cho holes/notches; sinh nhánh canonical 224 riêng cho encoder.
- [ ] Kiểm tra mask/biên/lỗ trước-sau clamp/median/CLAHE; không inpaint lỗ đã mất, không bít topology bằng morphological cleanup quá tay.
- [ ] Diagnostic tạm/admin có raw, mask, crop và output đúng frame; ghi status success/fallback/skipped/failed/timing.
- [x] Tách thay đổi capture-only khỏi thay preprocess descriptor. Pixel pipeline catalogue giữ nguyên; nếu đổi sau này cần version mới và gate P07/P12.

**File/test:** optical JS/TS, worker, capture contract, layer1/geometry tests; fixture chói che lỗ, thân sáng, nền trắng, lỗ nhỏ, crop sát mép.

**Exit:** có artifact chứng minh encoder nhận gì; giảm chói không chỉ “đẹp ảnh” mà giữ biên/count; chưa re-index. Thay preprocess chưa tương thích thì thí nghiệm offline, không bật online.

**Rollback:** quay preprocess/profile đã biết, giữ diagnostics; không gán version cũ cho output khác.

### [ ] P05 — Từ điển thị giác, lỗ kín/khoét hở và feature facts

- [ ] Audit sample registry/ảnh và thống nhất taxonomy, alias và count-vs-presence; răng cưa presence/tương đương.
- [ ] Baseline hình học: lỗ kín theo contour bên trong; khoét hở theo outer contour/độ lõm, có rule quality riêng.
- [ ] Tạo instance/crop/contour trên nhánh ảnh đủ nét; count không cộng qua nhiều frame/detector.
- [ ] Matching mẫu có phiên bản, preserve aspect, leaf labels, confidence/margin và unknown; ảnh mẫu chỉ đọc, không tự ghi index.
- [ ] Bổ sung ảnh thực trên linh kiện, không chỉ crop mẫu trắng/đen; phân biệt ảnh minh họa với GT thực tế.
- [ ] Parse identifying_features bằng parser hiện có; adapter facts/count/source/reliability theo field.
- [x] So count tường minh trong metadata, không chỉ tag: query 4 circle phân biệt candidate 2/4/6/unknown; chưa coi count từ ảnh là GT.
- [x] Kiểm tra payload gating khi captureEvidence không reliable; không truyền count như sự thật chỉ vì là số dương.
- [x] Parent oval/bán oval không double-count; metadata không ghi count giữ unknown thay vì zero.
- [ ] Confusing-note hỗ trợ cảnh báo, không tự đổi top1 nếu không đủ evidence.

**File/test:** capture-subject-lock, featureMatcher, holeFormatReference, structuralEvidence, query/geometry schemas; hole-format/features/assignment tests và benchmark perception.

**Exit:** instance/count/presence/confusion metrics thật theo từng nhóm; 3 ví dụ parser tổng lỗ 2/2/3 giữ đúng; output query4circle không còn chỉ tag giống query2circle. Không mở boost cũ hàng loạt khi chưa có ablation.

**Rollback:** tắt perception mới trong ranking; dictionary/UI đọc mẫu vẫn hoạt động. Nếu hình học không đủ, mở P11 có dữ liệu lỗi rõ ràng.

### [ ] P06 — Cạnh dài 5% và shortlist sớm

**Có thể phát triển module sau P00/P01, không chờ width hoặc full coverage.**

- [x] Khóa công thức biên/sàn; mirror client/server và test parity theo nghiệp vụ manual5% owner đã chốt.
- [x] Code path local truy vấn candidate length trước vector matching, giao với catalogue session/usage/view, read-only và bounded pagination; flag mặc định OFF chờ scoped RPC được review/triển khai.
- [x] Length-only đủ dùng, width missing neutral; query missing/invalid và bảng unavailable có status rõ, không error cascade.
- [ ] Phân nhóm within_tolerance / outside_tolerance / missing_length; giữ evidence delta, method và source.
- [ ] Candidate confidence0.9/user không tự được coi caliper; client source không phải quyền xác nhận số đo.
- [ ] Đo coverage length và shortlist recall; không dùng tỷ lệ có cả width làm điều kiện bật.
- [ ] Đề xuất RPC/index/migration nếu cần, local review trước; không db push toàn bộ pending migration.

**Test:** biên đúng5%/vượt rất nhỏ, decimal comma/mm, 180mm và các giá trị biên đã chốt, không width, query blank/NaN, table unavailable, data thiếu, filters, timeout.

**Exit:** trace chứng minh candidate IDs/length shortlist có trước vector match; SELECT length của target không bị mất vì không có legacy/global ANN hit. API/DB lỗi giữ đường xử lý đúng policy, không báo size đã match khi chưa đọc được.

**Rollback:** tắt shortlist path; giữ size evidence/version. Rollback về thuật toán cũ phải ghi degraded/legacy behavior, không tuyên bố đã thỏa manual5%.

### [ ] P07 — Hợp đồng hybrid xuyên browser/server/index

- [ ] Audit browser/worker/model/pooling/preprocess/dimension/variant code path đã ghi tại `docs/moris-v6/evidence/pipeline-p07-hybrid-audit.md`; live health/API/index asset identity còn pending sau rebuild.
- [x] Chứng minh hybrid bằng code path spatial patch + profile contract, không dựa UI; includeGray không mặc định hai probe khi allowMirror=false. Output byte/provenance live còn pending P10.
- [x] Không fallback bằng cách tái dùng vector hybrid trên index CLS. Fallback tên RPC giữ nguyên profile; test đã đổi theo nghiệp vụ hybrid-only.
- [ ] Phân biệt raw CLS nhánh tương thích với legacy cls/v2 trong DB; không suy hai nhãn là cùng pipeline.
- [ ] Nếu P04 thay canonicalizer, freeze profile/version mới trong local thí nghiệm, đánh giá tương thích; chưa ghi production.
- [ ] Cache/service-worker cũ phải bị phát hiện qua version mismatch; không auto-upgrade index từ Editor/login.

**Test:** profile contract, stale browser, wrong model/version/preprocess/profile, zero/NaN vector, đúng384 nhưng khác profile, không âm thầm đổi CLS, default RGB.

**Exit:** trace cùng query đi hết đúng profile hoặc báo mismatch/degraded có lý do; không thể “thành công” bằng nhãn sai. Không tuyên bố hybrid thắng CLS nếu chưa same-query A/B.

**Rollback:** ghép đúng cặp browser/server/index version đã freeze; không đổi riêng env profile khi index chưa sẵn.

### [ ] P08 — Scoped vector matching, candidate union và hydrate

**Phụ thuộc:** P05/P06 có contract, P07 parity, baseline P01.

- [ ] Chọn phương án scoped matching theo shortlist hoặc union + keyed scoring dựa benchmark; xác minh RPC thực tế trước viết caller.
- [x] Code path local: target ngoài global ANN vào pool qua scoped RPC proposal, cùng profile/cosine; không embed lại candidate trong request. Production còn pending RPC.
- [x] Giữ best-view-per-record, dedupe record ID và nguồn truy hồi; không multi-view vote inflation.
- [ ] Bounded per-channel budget/tổng budget, timeout và cancellation; không fanout vô hạn.
- [x] Scoped RPC unavailable trả status và global ANN tiếp tục; không early-return trước scoped channel.
- [x] Code path keyed hydrate theo RPC session-checked, chunk100, filter và orphan guard; fallback scan ghi status. SQL proposal chưa deploy/EXPLAIN, flag mặc định OFF; pool >100 không mất dims âm thầm.
- [x] Đã đóng gói ba RPC scoped/filter/keyed thành migration `20261021051000_moris_scoped_match_keyed_hydration.sql` sau khi đối chiếu cột/index/hàm session production read-only; fixture PostgreSQL 17/pgvector local pass scoped allowlist, filter session/usage, hydrate asset, auth và quyền vector RPC. Migration **đã áp production 2026-10-21** cùng ba V6 migration; scoped RPC thật với shortlist 180±5% trả hai view của `3448000001`, flags scoped/keyed được bật trong `wrangler.toml` cho bản phát hành. End-to-end camera/ranking/latency còn chờ owner test production.
- [ ] Không giả vector score cho candidate metadata-only; ghi available/unknown và score_source.
- [ ] Không mở service-role data ra public; giữ Gatekeeper/2FA/RLS/CSRF/anti-bot và filter parity khi rescue.

**Test:** target ngoài ANN, duplicates, candidate vector thiếu, channel timeout, >100IDs, record deleted/orphan, usage/view filters, hydrate paging và partial data.

**Exit:** recall từng channel/union và latency có số thật; target có evidence nguồn; keyed hydrate không scan toàn catalogue mỗi query mới. Đo cả pool recall và final Recall10.

**Rollback:** tắt path mới bằng config được thiết kế/test, trở về baseline có ghi rõ coverage/behavior cũ; không schema rollback production tự động.

### [ ] P09 — Ranking, top-10 ưu tiên/cứu và Moris presentation

- [ ] Một final-score owner; availability/reliability theo signal, bounded conflict, unknown neutral; không thêm weight đoán.
- [ ] Loại double-count giữa count/structure/hole-format; primary/rescue selection tách khỏi score tính toán.
- [ ] Kiểm tra primary có đủ10 sau quality/ranking, không sau SELECT size đơn thuần.
- [x] Chỉ khi thiếu mới chọn rescue; không lặp ID; ghi lý do/length delta/score vector thật. Bước gọi rescue riêng còn phụ thuộc RPC/keyed hydrate.
- [x] API/presentation/frontend ưu tiên nhóm primary → unknown → outside, trong nhóm theo score; score không bị bóp để hợp thứ tự.
- [ ] Note “chưa có size” và “vượt dung sai” đã có trên ứng viên cứu sinh; “đặc điểm chưa đủ rõ” từ perception còn pending.
- [ ] needs_review khi chất lượng/conflict/thiếu evidence, no_match khi không có ứng viên đạt điều kiện; không hứa chính xác100%.
- [ ] Không đổi text-only exact filter thành fuzzy; không để policy image search làm hỏng lookup code/ID.

**Test:** primary0/7/10/>10, rescue quality thấp, unknown/outside khác nhau, score ties, width absent, API→UI order, hard-negative và exact text path.

**Exit:** 10 primary → 0 rescue; 7 primary → tối đa3 rescue có note+score; không có candidate hợp lệ → không pad. Dev ablation chứng minh đóng góp mỗi signal và không hồi quy theo gate P00.

**Rollback:** quay ranker/selection config baseline và public schema tương thích; điểm/nhãn cũ không giả thành evidence mới.

### [ ] P10 — Evaluation và nghiệm thu thực tế

- [ ] Đóng băng dev/new holdout theo SKU/shot/session trước xem kết quả; không để augment siblings qua split.
- [ ] Bộ regression gồm3448000001, vật dài/to/mỏng/uốn, bóng/chói, nhỏ lỗ, hai vật, lỗ kín/khoét hở, răng cưa, size trong/ngoài5% và thiếu size.
- [ ] Benchmark read-only trên snapshot catalogue production hiện hành; tách self-query khỏi camera thật do owner nghiệm thu trên production. Ghi rõ coverage, profile và mẫu số thực tế.
- [ ] Ablation capture, hậu kỳ, length shortlist, hole facts, fusion riêng; so cùng query/profile/reference coverage.
- [ ] Đo perception độc lập ranking: mask GT, completeness, instance detection/count/classification/presence, unknown và topology trước/sau.
- [ ] Đo Top1, Recall5/10/50 có pool thật, MRR10; false exclusion; primary/rescue counts; false accept với unknown negatives; P50/P95/cold-warm trên thiết bị.
- [ ] Unknown-retention ở candidate stage khác final top10 selection; không dùng metric100% giữ candidate để suy100% vào top10.
- [ ] Android và iPhone Safari thật: rotation, permissions, keyboard, background/resume, RAM, camera cleanup, timeout/model load.
- [ ] Local E2E chạy đầy đủ; staging skipped ghi skipped; offline replay không gọi là production shadow.
- [ ] GO/NO-GO bằng bảng trước/sau và ngưỡng đã chốt. Nếu thiếu data, pending/NO-GO tương ứng, không bịa cải thiện.

**Exit:** manifest/hash, config/Git SHA, logs/metrics/ảnh chẩn đoán được phép, ablation, thiết bị thực và bảng gate. Old holdout đã dùng không dùng để tune/đóng vai unseen.

**Rollback:** kết thúc thử nghiệm, giữ baseline; giữ evidence lịch sử, không sửa nhãn/test để qua gate.

### [ ] P11 — Nhánh có điều kiện: thêm classifier/detector

Chỉ mở khi P05/P10 chỉ ra lỗi perception mà baseline hình học/matching mẫu chưa giải quyết được.

- [ ] Chốt bài toán: sai localization, sai class hay sai count; chọn model theo lỗi, không vì tên mới hơn.
- [ ] Ưu tiên classifier nhỏ trên crop/frozen features hoặc detector/segmenter chuyên hole/notch; SAM có thể hỗ trợ annotation, không là ground truth tự động.
- [ ] Nhãn thật per-instance/closed-open/unknown, negative reflections/stamps; răng cưa chỉ cần tương đương.
- [ ] Benchmark so baseline, RAM/model size/cold/warm trên Android/Safari, privacy/server budget nếu cần fallback.
- [ ] Không coi15 mẫu/11tag là dataset đủ; không chọn số mẫu tối thiểu giả trước coverage/learning curve.
- [ ] Tách model perception khỏi encoder SKU; fine-tune DINOv2 backbone chỉ khi có thí nghiệm và kế hoạch version/index riêng.

**Exit:** model card nhỏ, dataset/provenance, gain theo class và overall, chi phí thực, uncertainty, quyết định áp dụng. Không có gain → không tích hợp; P11 có thể ghi not_needed với lý do, không giả pass.

**Rollback:** trở lại perception baseline; không ảnh hưởng index SKU nếu descriptor giữ nguyên.

### [ ] P12 — Hybrid-only rebuild và release theo phạm vi được duyệt

Owner đã yêu cầu release để thử trên production sau khi agent hoàn tất kiểm thử local. Bốn migration đã áp và code đã lên main; **chưa có authorization xóa sạch/rebuild hàng loạt vector**. Nghiệm thu owner vẫn pending.

- [ ] Freeze capture/preprocess/model/profile cuối; audit toàn asset expected, readiness/freshness theo asset.
- [x] Audit read-only auth/write contract, backup schema+data public, dry-run đúng bốn migration, rehearsal PostgreSQL 17/pgvector; bốn migration đã áp và post-check quyền/coverage pass. Snapshot, main/Pages và nợ 236 zero trong `docs/moris-v6/evidence/pipeline-release-readiness-audit-2026-10-21.md`.
- [x] Backup schema+data public ngoài repo với hash và rehearsal restore/rollback trên fixture local; danh sách 236 asset legacy/152 SKU cần owner review theo CSV P13. Chưa có nhãn GT để chốt danh sách replace chính xác và không tự retire vector.
- [ ] Khi owner yêu cầu thực thi cụ thể: Vector Center confirmed single/batch → server kiểm quyền → idempotent index; không shell script auto-write hoặc Editor làm writer mới.
- [ ] Verify hybrid coverage và query/ranking trên dữ liệu thật trước bỏ legacy; không đánh ready cho asset thiếu/stale chỉ vì sibling có vector.
- [ ] Nếu owner chọn xóa sạch trước, ghi rõ phạm vi downtime/backup/restore và xin quyết định cụ thể; không suy từ ý định tương lai thành lệnh xóa.
- [ ] Kiểm thử rollback/recovery bằng môi trường cô lập; không thử phá production.
- [x] Release main theo chỉ đạo owner: commit `1c159a2` lên `PQVinh99-Glory/Dictionary`, Pages production deployment `f1476641-356f-4f50-aa7c-797efc0796ea` success đúng SHA; production flags scoped/keyed=true. Chưa đo canary/stop condition trên thiết bị thật.
- [ ] Theo dõi runtime parity, lỗi camera/profile, primary/rescue rate và P95; rollback đúng bundle browser/server/index.

**Exit:** owner sign-off đúng phạm vi, đủ asset/index evidence, release log và rollback đã kiểm chứng. Chưa triển khai thì giữ `[ ]`.

### [ ] P13 — Hậu kiểm `catalogue_image_vectors.hole_count = 0` (khảo sát sau cùng)

**Yêu cầu bổ sung của owner:** Nhiều mã có `hole_count = 0` dù ảnh linh kiện có lỗ, trong khi các mã khác được đếm chính xác. Chỉ khảo sát sau các task triển khai/kiểm thử local còn lại và khi owner rebuild hybrid xong; không suy nguyên nhân từ giá trị 0 đơn lẻ.

- [x] Khảo sát mã nguồn và snapshot production chỉ đọc sau các task local: tái hiện hai asset bị `subject_touches_edge` → count `NULL` → RPC legacy `COALESCE` thành 0; số liệu và giới hạn tại `docs/moris-v6/evidence/pipeline-p13-hole-zero-audit.md`. Chưa đóng phase vì index/GT/owner acceptance còn pending.
- [x] Replay read-only cả 236/236 asset zero và 58 đối chứng; xác định 236 alpha cutout bị chặn vì cờ chạm mép dù có khoang kín. Sửa quality gate chỉ cho alpha cutout và ngưỡng lỗ oval lớn; giữ camera opaque nghiêm, giữ topo lỗ kín/khoét hở; CSV và giới hạn accuracy trong bằng chứng P13.
- [x] Bỏ đường ghi fallback RPC legacy làm `NULL → 0`; cảnh báo hình học legacy/thiếu count, ratio, centroids trong Trung tâm Vector AI, fallback đọc schema production cũ. Chỉ Vector Center mới có quyền ghi sau xác nhận và khi RPC V6 sẵn sàng.

- [ ] Chụp snapshot read-only ổn định theo `record_id`, `asset_type`, `object_key`, model/version/preprocess/profile, geometry version, quality/reliable, processed_at và active/stale; báo mẫu số riêng cho mỗi nhóm. Schema production chưa có provenance/processed_at nên chỉ xác minh được phần cột hiện hữu.
- [ ] Phân biệt ground truth không có lỗ, segmentation/foreground thất bại, lỗ quá nhỏ/chói/bị bít, ảnh view/detail không thấy lỗ, `quality` unknown, metadata legacy `COALESCE(...,0)` và vector mới bị ghi 0 thật. Đã xác định cơ chế legacy của 236 hàng snapshot; còn thiếu nhãn GT và V6 provenance production.
- [x] Lấy mẫu có chủ đích cả nhóm đếm đúng và nhóm 0, đối chiếu raw asset với mask/crop/hole diagnostics cùng đúng version; kiểm tra cùng mã nhiều view có kết quả khác nhau (236 zero + 58 đối chứng, 33 raw/canonical lệch; chưa coi DB/text là GT).
- [ ] Đo tỷ lệ false-zero trên tập có nhãn người, theo chất lượng ảnh/kích thước lỗ/view/profile; không gọi tất cả `0` là lỗi nếu chưa có nhãn.
- [x] Nếu phát hiện lỗi code, viết regression fixture trước, sửa tại đúng bước và chạy full suite; nếu thay descriptor/index contract, qua lại P07/P12. Regression gồm lỗ oval lớn, khoét hở, alpha chạm mép, camera opaque, legacy UI; không sửa production row/vector. Không đổi profile embedding.

**Exit:** báo cáo nguyên nhân phân nhóm kèm ví dụ tái lập, mẫu số và query/log read-only; quyết định sửa code hay dữ liệu cần owner duyệt. Nếu index vẫn biến động hoặc thiếu raw asset/nhãn, ghi pending có lý do.

## 7. Quy trình cho từng task implementation

1. Đọc state và scope; chọn một task nhỏ, kiểm tra file/call graph thật.
2. Ghi baseline/contract thay đổi; không lẫn cleanup ngoài phạm vi.
3. Sửa code/tests theo nghiệp vụ đã chốt. Test assertion chỉ thay khi hợp đồng nghiệp vụ đổi và phải ghi lý do.
4. Chạy focused tests; sau thay đổi tích hợp chạy `npm test`, `npx --no-install tsc --noEmit`, `npm run build`.
5. Lưu evidence thật và giới hạn. TypeScript exit0 không chứng minh JS chưa bật checkJs đã được kiểm hết.
6. Cập nhật state, checklist phase/task và plan.md; chưa đạt metric thì không đánh completed.
7. Không commit/deploy/production write nếu chưa được yêu cầu. Không hỏi lại quyền cho read-only/routine scope đã được giao.

Với thay đổi chỉ tài liệu: kiểm tra Markdown/local links/JSON/diff và chạy kiểm thử theo AGENTS; không viết test chỉ soi lại câu chữ của plan.

## 8. Evidence, rollout và tiêu chí hoàn tất

Evidence mới đặt tại `docs/moris-v6/evidence/pipeline-<phase>-<topic>.*`. Ảnh/manifest/private snapshot theo privacy policy hiện có, không đưa vào dist. Mỗi báo cáo ghi input hash, dataset split, nhãn, config/profile, Git SHA/dirty state, sample count, thời điểm, scope và limitations. Không log embedding/secret.

Gate hoàn tất toàn pipeline:

- [ ] Camera landscape dùng được trên Android/iPhone Safari với fallback có kiểm chứng.
- [ ] Full-subject capture và mask/crop đúng frame, không chỉ bám một mảnh.
- [ ] Hậu kỳ có bằng chứng giữ biên/lỗ, không chỉ animation.
- [ ] Sàng lọc length5% xảy ra trước vector matching; width optional không phạt.
- [ ] Count và tên lỗ/khoét khớp facts, răng cưa đúng mức chi tiết nghiệp vụ.
- [ ] Hybrid provenance đúng xuyên suốt, không dùng vector sai không gian.
- [ ] Primary/rescue tuân thủ đủ10/thiếu10, note+score thật, không pad rác.
- [ ] Metric catalogue hiện hành được đo read-only; camera/thiết bị thật do owner nghiệm thu trên production bằng evidence; không tune holdout.
- [ ] Auth/2FA/RLS/CSRF/anti-bot và quyền ghi Vector Center giữ nguyên.
- [ ] Tests/typecheck/build/E2E phù hợp pass; staging skipped không là pass.
- [ ] Migration/rebuild/release chỉ khi có authorization đúng phạm vi, rollback có bằng chứng.
- [ ] state/checklist/docs phản ánh đúng trạng thái; owner sign-off release.

Không đặt trước tỷ lệ accuracy hoặc P95 chưa được đo/duyệt. Không tuyên bố độ chính xác đạt100% từ unit tests. Nếu dữ liệu/thiết bị chưa có, ghi blocker và tiếp tục phần độc lập được phép.

## 9. Việc đầu tiên khi được giao triển khai

**Bắt đầu P00 và P01:** khóa định nghĩa5%, manifest/metric, ghi baseline profile/capture và trace thật. Không bắt đầu bằng xóa vector, đổi env profile, bật geometry hàng loạt hoặc fine-tune model. Có thể chuẩn bị camera mapping/length module độc lập sau contract, nhưng không bật ranking mới trước baseline.

Ghi chú lịch sử: tại thời điểm lập plan ban đầu P00–P12 chưa được triển khai. Trạng thái hiện hành xem checklist và `state.json`; P13 là yêu cầu hậu kiểm bổ sung sau đó.
