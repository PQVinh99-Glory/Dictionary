# Plan Uplevel — Moris DINOv2 Harness & Ranking

> **Trạng thái:** KẾ HOẠCH, chưa thực thi. Tài liệu này không phải authorization để deploy, ghi production, chạy migration hay commit.
>
> **Ngày lập:** 2026-10-20
> **Phạm vi:** nâng cấp kiến trúc Moris thành harness chuẩn hóa xung quanh DINOv2, cải thiện ranking Top-1/Recall@10 nhưng **không khóa cứng** ứng viên.
>
> **Thứ tự ưu tiên khi có mâu thuẫn:** `AGENTS.md` > `Plan_uplevel.md` > `state.json` > tài liệu cũ. Nếu code thực tế khác tài liệu, dừng và kiểm tra code trước khi sửa.

---

## 0. Agent phiên sau đọc gì trước

1. `/workspaces/Dictionary/AGENTS.md` — hiến pháp bắt buộc.
2. `/workspaces/Dictionary/Plan_uplevel.md` — kế hoạch này.
3. `/workspaces/Dictionary/state.json` — trạng thái task và verification gần nhất.
4. `/workspaces/Dictionary/docs/moris-v6/ARCHITECTURE.md` — quyền ghi vector và event ownership.
5. `/workspaces/Dictionary/docs/moris-v6/TECH_DEBT_REGISTER.md` — nợ kỹ thuật, gate và việc bị cấm.
6. Chạy `git status --short --branch && git log --oneline -5` trước khi sửa.

**Lưu ý worktree hiện tại:** `pipeline_moris.md` đang bị xóa trong working tree. Đây là thay đổi của chủ dự án; **không restore, không checkout, không clean**. Nếu cần đọc bản cũ, dùng `git show HEAD:pipeline_moris.md`, chỉ đọc.

**Không đọc/không làm theo số liệu cũ trong `HANDOFF.md` như trạng thái hiện tại.** `HANDOFF.md` cập nhật 2026-10-17 đã cũ; `state.json` và kế hoạch này là nguồn cho nhánh uplevel.

---

## 1. Mục tiêu

### 1.1 Mục tiêu sản phẩm

Moris phải trả lời đúng hơn khi người dùng chụp linh kiện bằng camera, đặc biệt với:

- linh kiện chỉ thấy một phần trên nền giấy trắng;
- ảnh có chói sáng;
- linh kiện giống nhau về hình dạng nhưng khác kích thước;
- linh kiện khác nhau ở số lượng/kiểu lỗ nhưng vector DINOv2 gần nhau;
- catalogue thiếu hoặc chưa đủ `catalogue_part_dimensions` trong giai đoạn hiện tại.

### 1.2 Mục tiêu kỹ thuật

Xây dựng **Moris Harness** bao quanh DINOv2:

```text
Capture Gate
  -> Normalizer (deterministic, không generative)
  -> DINOv2 Encoder (giữ nguyên model/profile)
  -> Multi-channel Recall
       - vector ANN
       - size-compatible candidates (khi đủ dữ liệu)
       - feature-compatible candidates (khi đủ tin cậy)
  -> Evidence Layer
       - size / shape / hole / structure / confusing pairs
  -> Calibrated Ranker
  -> Decision Layer (top-10, needs_review, abstain)
  -> Telemetry + Evaluation
```

**Nguyên tắc trung tâm:** DINOv2 không bị thay đổi trong giai đoạn đầu. Cải thiện ranking đến từ:

1. đầu vào sạch hơn;
2. recall nhiều kênh hơn;
3. evidence có độ tin cậy;
4. fusion được hiệu chỉnh;
5. quyết định có thể abstain thay vì đoán.

### 1.3 Không nằm trong phạm vi

- Không bật Phase 1 DB taxonomy; Phase 1 vẫn là backup local, không có trên main.
- Không deploy Functions/Pages, không ghi production, không chạy migration nếu chưa được chủ dự án duyệt.
- Không tạo vector mới, không re-index, không đổi profile DINOv2 trong giai đoạn U0–U4.
- Không dùng generative inpainting/tái tạo ảnh mới.
- Không hard filter size/shape trong image search khi chưa có dữ liệu và đo lường.
- Không dùng LLM để sinh mã linh kiện hoặc thay thế retrieval.
- Không sửa assertion test để che lỗi; không bịa metric.

---

## 2. Baseline đã xác minh

### 2.1 Git và phiên bản

| Hạng mục | Giá trị |
|---|---|
| Branch | `main` |
| HEAD | `5a9218d` — `feat(moris-v6): thêm mẫu lỗ bán oval (15 ảnh/11 tag); bump v6.6.0` |
| Remote chính | `upstream/main` = `5a9218d` |
| Worktree | Có `D pipeline_moris.md` do chủ dự án xóa; không restore |
| App version | `6.6.0` |
| Tests gần nhất | `62 files / 610 tests pass 100%` |
| TypeScript | `npx tsc --noEmit` exit 0 |
| Build | `npm run build` 47 files, exit 0 |
| Production | `ban_oval` DB/R2 đã có; Functions **chưa deploy** |

Không dùng các số liệu test cũ 398/400/475/525/575 làm baseline hiện tại.

### 2.2 Trạng thái dữ liệu và production

- `moris_hole_samples`: 15 rows / 11 định dạng; `ban_oval` sort 45.
- R2 `hole-samples/ban-oval.png` đã upload.
- `MORIS_HOLE_FORMAT_BOOST_ENABLED` đang **OFF**.
- `catalogue_part_dimensions`: mới có **6/545 mã** tại thời điểm chẩn đoán gần nhất. Chủ dự án sẽ bổ sung đầy đủ trong tương lai; kế hoạch phải chịu được cả trạng thái thiếu dữ liệu hiện tại và trạng thái đầy đủ sau này.
- `identifying_features` chưa phủ toàn bộ catalogue; không được coi null là “không khớp”.
- 3 migration Moris V6 (`20261016024931`, `20261016033020`, `20261016040525`) vẫn pending có chủ đích; không tự push.

### 2.3 Ca lỗi tham chiếu

Ca thật đã kiểm tra read-only:

- Mã: `3448000001`
- `image_library.id`: `bba2dead-f9a8-416a-bae4-13b50aa2768c`
- `identifying_features`: `"2 lỗ tròn 1 lỗ to 1 lỗ nhỏ"`
- Dims: dài `180mm`, rộng null, method `user`
- Vector: 2 active hybrid (`front`, `thumb`), không có legacy
- Self-query bằng vector front: target **rank 1**, similarity `1.0000`
- Query thật: target không vào top-10
- Top-10 lỗi: **10/10 không có dims**; target không có legacy; 10/10 có cả legacy + hybrid
- Flags hiện tại: geometry/contour/spatial `false`; `holeFormatBoost` `false`; `sizeGate` `true`; `topK=60`, retrieval limit tối đa `100`, `minSimilarity=0.55`

**Kết luận kỹ thuật:** index/RPC/profile không hỏng. Vấn đề nằm ở chất lượng query/domain gap, recall và cách dùng evidence sau ANN. Không được lấy ca này làm toàn bộ benchmark; chỉ dùng làm regression case.

### 2.4 Pipeline hiện tại

```text
camera capture (center crop 1000:410)
  -> subject lock / mask / tracking evidence
  -> browser layer1 optical:
       - foreground segmentation
       - PCA rotate + 180-degree disambiguation
       - letterbox 224
       - specular clamp + CLAHE
  -> DINOv2-small, 2 probes
  -> server vector RPC top-100
  -> collapse best hit per SKU
  -> hydrate metadata
  -> size gate (sau ANN, fail-open)
  -> metadata rank + optional hole boost
  -> structural + fusion
  -> top-10
```

**Điểm chưa tối ưu:**

- Tracking box hiện là overlay/readiness; capture vẫn cắt khung trung tâm, chưa crop theo bbox.
- Readiness hiện bắt buộc thấy trọn vật, chừa lề ≥10%, không chạm mép (`computeReadiness` trong `src/moris/capture-subject-lock.js`). Nửa linh kiện trên giấy trắng sẽ không ready.
- Layer1 đã segment/canonicalize nhưng chưa có `captureQuality` đầy đủ cho partial/glare/background.
- Size gate chạy sau ANN; không thể cứu target ngoài top-100.
- `identifying_features` gần như chỉ được dùng ở text-only; image branch chưa dùng làm feature channel.
- Geometry/holes signals có dữ liệu nhưng flags đang OFF.
- Chưa có telemetry chuẩn cho `target_rank`, size reject, feature match, stage latency.

---

## 3. Kiến trúc đích

### 3.1 Moris là harness, không phải model mới

```text
┌──────────────────────────────────────────────────────────────┐
│ Moris Harness                                                │
│                                                              │
│  [Capture Gate]                                              │
│   subject state: full | partial | rejected                   │
│   mask reliable / glare risk / clipping / background mode    │
│            │                                                 │
│            ▼                                                 │
│  [Normalizer] deterministic                                  │
│   crop + pad + exposure/highlight clamp + background mask    │
│   canonical profile parity with catalogue                    │
│            │                                                 │
│            ▼                                                 │
│  [DINOv2 Adapter] frozen model/profile                       │
│   multi-probe; no index write                                │
│            │                                                 │
│            ▼                                                 │
│  [Recall Orchestrator]                                       │
│   union: vector top-N + size-compatible + feature-compatible │
│   dedupe by record/SKU; preserve raw vector similarity       │
│            │                                                 │
│            ▼                                                 │
│  [Evidence Layer]                                            │
│   size, feature facts, holes, shape, structure, confusion    │
│   reliability + unknown policy                               │
│            │                                                 │
│            ▼                                                 │
│  [Ranker] single final-score owner                           │
│   calibrated bounded signals; no double counting             │
│            │                                                 │
│            ▼                                                 │
│  [Decision] top-10 | needs_review | no_match                 │
│            │                                                 │
│            ▼                                                 │
│  [Telemetry & Evaluation]                                    │
└──────────────────────────────────────────────────────────────┘
```

### 3.2 Các invariant bắt buộc

1. **Fail-open mặc định.**
   - Thiếu size/dims/feature/hole evidence = trung tính, không phạt, không loại.
   - Không để candidate pool rỗng chỉ vì một filter phụ.
   - Nếu hard filter làm pool rỗng, fallback về pool trước filter + warning.

2. **Không hard lock size/shape trong image search ở giai đoạn đầu.**
   - Size/shape là kênh candidate và tín hiệu rerank.
   - Chỉ loại ứng viên khi:
     - query size và candidate dims đều high-confidence;
     - sai khác vượt dung sai đã được chủ dự án duyệt;
     - hoặc người dùng chủ động yêu cầu exact text filter.
   - Không dùng “không có dims” làm lý do loại.

3. **Partial subject là trạng thái hợp lệ, không phải lỗi.**
   - `partial` được chụp nếu vẫn có mask/evidence tối thiểu.
   - `partial` không dùng aspect/contour làm hard evidence.
   - Hole count chỉ dùng khi mask reliable; nếu không, unknown.

4. **DINOv2 giữ nguyên trong U0–U4.**
   - Không đổi model/revision/profile/preprocess trong các phase đầu.
   - Mọi thay đổi canonicalization phải giữ đúng profile parity với catalogue.
   - Nếu đổi preprocess, phải coi là S2 và cần re-index/Gate D riêng.

5. **Feature facts là symbolic channel, không nhét vào vector.**
   - DINOv2 lo appearance.
   - `identifying_features` lo số lỗ/hình dạng/structural keywords.
   - Fusion muộn, có reliability, không để text override vector một cách mù quáng.

6. **Không có kết luận “đã tốt hơn” nếu không có log/metric thật.**
   - Mọi báo cáo phải kèm file evidence và lệnh đã chạy.
   - Không tối ưu trên holdout; không đổi metric sau khi đã xem kết quả.

---

## 4. Data contract đề xuất

Các contract dưới đây là **thiết kế đích**. Agent phải kiểm tra code hiện có trước khi thêm field; không được giả định API đã tồn tại.

### 4.1 Capture quality

```text
captureQuality = {
  version,
  subjectState: "full" | "partial" | "rejected",
  maskReliable: boolean,
  geometryUsable: boolean,
  holeEvidenceUsable: boolean,
  backgroundMode: "white_paper" | "simple" | "complex" | "unknown",
  glareRisk: "low" | "medium" | "high",
  clippedRatio: number,
  specularRatio: number,
  coverage: number,
  touchesBorder: boolean,
  agreement: number,
  warnings: string[]
}
```

Quy tắc:

- `full`: đủ lề, mask reliable, dùng được geometry/hole.
- `partial`: chạm mép hoặc thiếu một phần; cho chụp nếu mask đủ tốt; tắt hard geometry/aspect; hole chỉ dùng khi reliable.
- `rejected`: không có chủ thể, quá mờ, quá chói, mask không dùng được.
- `clippedRatio` cao + lỗ nằm trong vùng chói: `holeEvidenceUsable=false`, không suy đoán.

### 4.2 Size query

```text
sizeQuery = {
  length_mm: number | null,
  width_mm: number | null,
  method: "user" | "caliper" | "marker_photo" | "erp" | "camera_measured",
  confidence: number | null,
  source: string | null
}
```

Quy tắc:

- `length_mm` bắt buộc nếu dùng size; `width_mm` nullable.
- `L >= W` theo PCA convention hiện tại.
- Dung sai hiện tại:
  - verified cả hai bên: `5% / 2mm`;
  - nhập tay/không rõ: `10% / 3mm`.
- Nếu chủ dự án muốn 5% toàn cục, phải đo lại và duyệt; không tự đổi default.
- Không dùng size để loại khi thiếu candidate dims; chỉ dùng làm candidate channel + rerank.

### 4.3 Feature facts

```text
featureFacts = {
  version,
  total_holes: number | null,
  big_holes: number | null,
  small_holes: number | null,
  shapes: {
    tron: number,
    vuong: number,
    oval: number,
    dai: number,
    chu_nhat: number,
    khac: number
  },
  body_shape: "dai" | "tron" | "vuong" | "khac" | null,
  structural_keywords: string[],
  confidence: number,
  source: "user" | "parsed" | "inferred"
}
```

Nguồn:

- Catalogue: parse `identifying_features` bằng logic hiện có (`parseIdentifyingFeaturesAST`, `inferFormatTagsFromText`) và chuẩn hóa.
- Query: lấy từ camera geometry (`hole_count`, `big_hole_count`, `small_hole_count`, shape counts) + text người dùng nếu có + size shape class.
- Không bắt user nhập lại feature đã có trong catalogue.
- Không coi null là conflict.
- Chuỗi mơ hồ phải audit và chuẩn hóa; ví dụ `"2 lỗ tròn 1 lỗ to 1 lỗ nhỏ"` hiện parse thành total 2 / big 1 / small 1 / shape tròn. Phải có test khẳng định semantics này trước khi dùng.

### 4.4 Candidate evidence

```text
candidate = {
  record_id,
  code,
  vector_similarity_raw,
  vector_rank,
  size_status: "match" | "match_partial" | "mismatch" | "unknown",
  size_delta,
  feature_status: "exact" | "partial" | "conflict" | "unknown",
  feature_matches,
  hole_status,
  structural_status,
  confusion_note,
  reasons[]
}
```

### 4.5 Ranking evidence

- `final_score` chỉ có một owner.
- Không double-count hole count qua cả `holes` và `structural`.
- `unknown` không bị phạt.
- Conflict penalty có giới hạn; không xóa ứng viên khỏi top-10 chỉ vì một tín hiệu yếu.
- Raw vector similarity phải được giữ riêng để debug, không trộn với RRF/fusion score.

---

## 5. Quy trình AI engineering chuẩn

Mỗi thay đổi ranking phải đi qua 6 gate:

| Gate | Việc phải làm | Bằng chứng |
|---|---|---|
| G0 — Problem | Chốt metric, query set, điều kiện chấp nhận | `docs/moris-v6/evidence/uplevel-*.md` |
| G1 — Baseline | Đo baseline trước khi sửa; lưu manifest/hash | JSON/CSV + log |
| G2 — Experiment | Ablation từng tín hiệu; một biến mỗi lần | log, bảng metric |
| G3 — Integration | Unit + integration + E2E local; không regression | test log |
| G4 — Shadow | Chạy song song, không ảnh hưởng production | shadow diff |
| G5 — Release | Owner duyệt, canary, rollback | release checklist |

**Quy tắc:**

- Không tune trên holdout.
- Không đổi nhiều stage cùng lúc nếu chưa có ablation.
- Không dùng số liệu từ test synthetic để tuyên bố cải thiện ảnh thật.
- Không báo “pass” khi staging bị skip; ghi `skipped`.
- Mỗi task cập nhật `state.json` và checklist sau khi có evidence; không đánh dấu xong trước khi chạy test.

---

## 6. Evaluation plan

### 6.1 Tập dữ liệu

- Catalogue reference hiện có: 545 ảnh; không chạy lại inference toàn bộ nếu không được duyệt.
- Ca hồi quy: `3448000001`; dùng để đo `target_rank`, không dùng làm toàn bộ benchmark.
- Ca hard-negative: 57-item queue hiện có; cần nhãn người thật, hiện chưa có.
- Bộ camera mới cần có:
  - full subject trên giấy trắng;
  - partial subject;
  - chói nhẹ / chói mạnh;
  - nhiều góc;
  - ít nhất một nhóm cùng shape khác size;
  - ít nhất một nhóm cùng size khác hole pattern.
- Split theo SKU/session, không split ngẫu nhiên từng frame để tránh leakage.
- Đóng băng manifest/hash trước khi xem kết quả.

### 6.2 Metric

**Ranking:**

- Top-1 accuracy
- Recall@5 / Recall@10 / Recall@50
- MRR@10
- nDCG@10
- `target_rank` cho các ca biết trước mã đúng

**Screening/filter:**

- `false_exclusion_rate` — tỷ lệ mã đúng bị loại oan
- `unknown_retention_rate` — tỷ lệ mã thiếu dims/feature vẫn được giữ
- `empty_result_rate`
- `size_gate_reject_precision`
- `feature_match_precision`
- `needs_review_rate`

**Vận hành:**

- P50/P95 latency theo stage
- tỷ lệ fallback vector/legacy
- tỷ lệ mask unreliable / partial / rejected
- tỷ lệ canonicalization fail
- lỗi API/DB/RPC

### 6.3 Acceptance gate đề xuất

Các ngưỡng dưới đây là đề xuất; chủ dự án phải duyệt trước khi dùng làm gate chính thức.

1. **Không hồi quy:** Recall@10 trên development không giảm so với baseline; Top-1 không giảm quá sai số đo.
2. **Ca hồi quy:** `3448000001` vào top-10 hoặc `target_rank` được cải thiện rõ ràng; không overfit bằng cách hard-code mã.
3. **Không tăng empty result:** `empty_result_rate` không tăng; filter fail-open hoạt động.
4. **Size:** không loại oan ứng viên verified; unknown vẫn được giữ.
5. **Feature:** precision của feature match tăng hoặc giữ nguyên; không có hard filter làm mất ứng viên đúng.
6. **Latency:** không vượt budget do chủ dự án duyệt; ghi P95 thực tế.
7. **Tests:** `npm test`, `npx tsc --noEmit`, `npm run build` pass 100% trước khi báo xong.

---

## 7. Roadmap thực thi

Thứ tự phụ thuộc:

```text
U0 Baseline
 ├── U1 Capture/Partial
 │     └── U2 Canonicalization
 ├── U3 Size channel
 └── U4 Feature facts
        └── U5 Candidate union
              └── U6 Fusion/Decision
                    └── U7 Eval/Rollout
```

Không bắt đầu U5/U6 trước khi U0 có baseline. U3 có thể chạy song song U1/U2 nhưng chỉ ở chế độ đo, không hard filter.

---

### [ ] U0 — Baseline, telemetry và regression case

**Mục tiêu:** biết hiện tại kém ở đâu trước khi sửa.

**Việc làm:**

- Thêm debug nội bộ (admin/session-gated) để trả `target_rank`, `topN`, `vector_rank`, size status, feature status, stage timings.
- Không đưa debug ra public response; không log embedding/ảnh/secret.
- Tạo script/tool đọc-only để chạy một query với target code; lưu JSON.
- Đo baseline cho ca `3448000001` và tập development hiện có.
- Ghi rõ giới hạn: ảnh query thật của ca này chưa có trong repo; nếu chưa có ảnh, chỉ đo được self-query và không được gọi là “đã tái lập”.

**File dự kiến:**

- `functions/_lib/moris/v5/runtime/trace.js`
- `functions/_lib/moris/v5/orchestrator.js`
- `functions/api/moris/search.js`
- `tools/` (script read-only mới)
- `tests/moris-uplevel-telemetry.test.js`

**Exit evidence:**

- baseline JSON + log;
- test telemetry không lộ dữ liệu nhạy cảm;
- không thay đổi ranking behavior;
- full/focused tests pass.

**Rollback:** revert telemetry/debug changes; không đụng DB.

---

### [ ] U1 — Capture Gate: full / partial / rejected

**Mục tiêu:** cho phép chụp nửa linh kiện trên giấy trắng mà không phá readiness nghiêm ngặt hiện tại.

**Việc làm:**

- Tách `readinessProfile`: `strict` (mặc định hiện tại) và `partial_allowed` (flag, mặc định OFF).
- Thêm `captureQuality` vào evidence:
  - `subjectState`, `maskReliable`, `geometryUsable`, `holeEvidenceUsable`, `glareRisk`, `clippedRatio`, `backgroundMode`.
- `partial_allowed` chỉ cho capture khi:
  - có chủ thể;
  - mask không rỗng;
  - không quá mờ/quá chói;
  - phần bị cắt được đánh dấu rõ.
- Không dùng tracking bbox làm số đo; crop chỉ để hiển thị/embedding.
- UI hiển thị cảnh báo “chỉ thấy một phần linh kiện”; không chặn nếu người dùng vẫn muốn tìm.
- Giữ nguyên strict path cho đến khi có eval.

**File dự kiến:**

- `src/moris/capture-subject-lock.js`
- `src/app.js`
- `index.html`
- `tests/moris-camera-lock-box.test.js`
- `tests/moris-uplevel-capture.test.js`

**Exit evidence:**

- strict path không đổi;
- partial path có test cho chạm mép, mask rỗng, chói, mờ;
- ảnh partial không làm crash canonicalization;
- không tăng false-ready.

**Rollback:** tắt flag `partial_allowed`; giữ strict behavior.

---

### [ ] U2 — Canonicalization: crop, glare, background parity

**Mục tiêu:** giảm domain gap giữa ảnh camera và ảnh catalogue mà không tái tạo sinh ảnh.

**Việc làm:**

- Dùng crop theo mask/bbox + padding; giữ full frame để hiển thị.
- Thêm `clippedRatio`/`specularMask`; nếu chói che vùng lỗ, đánh dấu hole evidence unknown.
- Giữ specular clamp + CLAHE hiện có; không thêm generative inpainting.
- Kiểm tra profile/preprocess parity:
  - query và catalogue cùng `kim_canon_v3_letterbox`;
  - không tự đổi profile khi chưa re-index/Gate D.
- Với nền giấy trắng:
  - ưu tiên mask-based foreground;
  - không bắt buộc external foreground endpoint;
  - fallback original nếu mask không đủ tin cậy.
- Không dùng `canonicalizeImage` external endpoint như bước bắt buộc.

**File dự kiến:**

- `src/moris/moris-layer1-optical.js`
- `functions/_lib/moris/v5/preprocess/canonicalize.js`
- `functions/_lib/moris/v5/preprocess/foregroundGate.js`
- `src/moris/vector/dinov2.worker.js`
- `tests/moris-uplevel-canonicalization.test.js`

**Exit evidence:**

- cùng profile giữa query/catalogue;
- test glare/clipping/partial;
- không có dependency mới nếu không được duyệt;
- ảnh query chuẩn hóa không làm giảm chất lượng trên fixture.

**Rollback:** revert canonicalization changes; giữ profile cũ.

---

### [ ] U3 — Size channel (chuẩn bị cho dims đầy đủ)

**Mục tiêu:** dùng size để tăng recall/precision mà không hard lock.

**Việc làm:**

- Giữ size gate hiện tại sau ANN, fail-open.
- Thêm telemetry: `size_status`, `size_delta`, `dims_available`, `gate_rejected`.
- Khi dims coverage đủ (chủ dự án bổ sung full):
  - thêm kênh `size_compatible` để **union** với vector top-N;
  - không thay thế vector recall;
  - chỉ dùng candidate dims khi query size hợp lệ.
- Khi coverage chưa đủ:
  - không hard filter;
  - size chỉ dùng rerank/telemetry.
- Dung sai:
  - giữ `5%/2mm` cho verified;
  - giữ `10%/3mm` cho manual cho đến khi chủ dự án duyệt đổi;
  - nếu muốn 5% toàn cục, phải có quyết định và đo false-exclusion.
- Nếu gate làm pool rỗng: fallback pool trước gate + warning, không trả empty.

**File dự kiến:**

- `functions/_lib/moris/v5/retrieval/sizeGate.js`
- `functions/_lib/moris/v5/orchestrator.js`
- `functions/_lib/moris/v5/connectors/catalogue.js`
- `tests/moris-size-gate.test.js`
- `tests/moris-size-gate-orchestrator.test.js`
- `tests/moris-uplevel-size-channel.test.js`

**Exit evidence:**

- unknown retention 100% trong test;
- không false-exclusion trên fixture verified;
- empty-pool fallback hoạt động;
- nếu thêm DB query/index: migration chỉ proposal, chưa áp production.

**Rollback:** tắt size channel; giữ gate cũ.

---

### [ ] U4 — Feature facts và identifying_features

**Mục tiêu:** tận dụng dữ liệu user đã nhập trong catalogue, không bắt nhập lại.

**Việc làm:**

- Tạo module chuẩn hóa `featureFacts` từ `identifying_features`:
  - dùng parser hiện có, không viết lại logic;
  - shape counts, total/big/small, keywords;
  - `confidence` và `source`.
- Audit semantics các mẫu mơ hồ:
  - `"2 lỗ tròn 1 lỗ to 1 lỗ nhỏ"` → total 2 / big 1 / small 1 / tròn;
  - `"2 lỗ tròn, 1 lỗ to, 1 lỗ nhỏ"` phải cho cùng kết quả;
  - `"2 lỗ tròn to 1 lỗ nhỏ"` phải cho kết quả khác nếu đúng nghĩa.
- Query facts:
  - lấy từ camera geometry nếu `maskReliable` và `holeEvidenceUsable`;
  - lấy từ text nếu người dùng nhập;
  - lấy từ size cho shape class (square/rect) nhưng không suy diễn quá mức.
- Thêm **feature recall channel** (union) chỉ khi query facts high-confidence và dữ liệu đủ; không hard filter.
- Thêm **feature rerank mềm**:
  - match/partial/conflict/unknown;
  - unknown neutral;
  - conflict penalty bounded;
  - không double-count với structural/holes.
- Hiển thị lý do khớp/không khớp trong candidate; dùng `confusing_note` để cảnh báo.
- Không dùng null/thiếu field làm conflict.

**File dự kiến:**

- `functions/_lib/moris/v5/retrieval/featureMatcher.js`
- `functions/_lib/moris/v5/retrieval/metadataFilter.js`
- `functions/_lib/moris/v5/retrieval/holeFormatReference.js`
- `functions/_lib/moris/v5/retrieval/structuralEvidence.js`
- `functions/_lib/moris/v5/orchestrator.js`
- module mới đề xuất: `functions/_lib/moris/v5/retrieval/featureFacts.js`
- `tests/moris-features-filter.test.js`
- `tests/moris-uplevel-feature-facts.test.js`

**Exit evidence:**

- parser cases pass;
- feature match không làm mất candidate đúng;
- target case có feature evidence đúng (2 lỗ, 1 to, 1 nhỏ, tròn);
- feature channel có thể tắt/bật bằng flag;
- không hard filter image search.

**Rollback:** tắt feature recall/rerank; parser vẫn pure.

---

### [ ] U5 — Recall Orchestrator: union nhiều kênh

**Mục tiêu:** tăng recall trước khi rerank, đặc biệt khi vector bỏ sót target.

**Việc làm:**

- Tạo `retrieveCandidateUnion` (hoặc tương đương) trong orchestrator:
  - vector top-N;
  - size-compatible (nếu bật và coverage đủ);
  - feature-compatible (nếu high-confidence);
  - dedupe theo `record_id`/SKU;
  - giữ `vector_rank`/`raw_vector_similarity` cho từng nguồn.
- Bounded oversampling; không tăng vô hạn.
- Nếu một kênh lỗi: log warning, tiếp tục kênh khác; không làm hỏng query.
- Không gọi full-table scan mỗi request nếu không có giới hạn/index.
- Giữ collapse best vector hit per SKU hiện tại; không để multi-view làm trôi ranking.
- `topK`/`retrievalLimit` chỉ đổi sau ablation.

**File dự kiến:**

- `functions/_lib/moris/v5/orchestrator.js`
- `functions/_lib/moris/v5/retrieval/multiProbeSearch.js`
- `functions/_lib/moris/v5/vector/search.js`
- `functions/_lib/moris/v5/retrieval/vectorHitCollapse.js`
- `tests/moris-uplevel-candidate-union.test.js`
- `tests/moris-vector-search-fallback.test.js`

**Exit evidence:**

- union/dedupe test với candidate trùng;
- một kênh fail không làm mất kết quả;
- Recall@10 dev không giảm;
- target rank đo được trước/sau;
- latency P95 được ghi.

**Rollback:** tắt union flags; quay lại vector-only path.

---

### [ ] U6 — Fusion, calibration và decision

**Mục tiêu:** xếp hạng top-10 tốt hơn, không chỉ “thêm điểm”.

**Việc làm:**

- Giữ một owner duy nhất cho `final_score`.
- Thêm feature/size/hole signals với reliability; không double-count.
- Conflict penalty bounded; unknown neutral.
- Calibrate trên development:
  - vector score vs fusion score;
  - top-K thresholds;
  - `needs_review`/abstain.
- Không đổi weight trước khi có baseline và ablation.
- Dùng `confusingPairs`/`confusing_note` để cảnh báo cặp dễ nhầm; không tự động đảo top-1 nếu không đủ bằng chứng.
- Kiểm tra top-10 trên hard negatives; không chỉ top-1.

**File dự kiến:**

- `functions/_lib/moris/v5/retrieval/scoreFusion.js`
- `functions/_lib/moris/v5/presentation/imageDecision.js`
- `functions/_lib/moris/v5/presentation/publicResult.js`
- `functions/_lib/moris/v5/orchestrator.js`
- `tests/moris-score-fusion.test.js`
- `tests/moris-uplevel-ranking.test.js`

**Exit evidence:**

- ablation từng signal;
- không giảm Recall@10;
- top-1/target rank cải thiện trên development;
- `needs_review` không tăng bừa;
- score breakdown giải thích được.

**Rollback:** tắt toàn bộ signal mới; quay baseline weights.

---

### [ ] U7 — Evaluation, shadow, rollout

**Mục tiêu:** chứng minh cải thiện bằng dữ liệu thật trước khi phát hành.

**Việc làm:**

- Đóng băng manifest/hash cho development và holdout mới.
- Chạy ablation U1–U6 trên development.
- Chỉ chạy holdout một lần sau khi chốt cấu hình.
- Shadow mode: chạy pipeline mới song song, so sánh top-10, không ảnh hưởng người dùng.
- Canary chỉ khi chủ dự án duyệt; ghi rõ staging skipped nếu bị skip.
- Lưu evidence: `docs/moris-v6/evidence/uplevel-*.log`, JSON metric.
- Cập nhật `state.json`, `plan.md`, tài liệu kiến trúc.
- Không deploy nếu chưa có authorization riêng.

**Exit evidence:**

- bảng metric trước/sau;
- quyết định GO/NO-GO;
- rollback plan đã test;
- owner sign-off.

---

## 8. Thiết kế ranking chi tiết

### 8.1 Candidate generation

Thứ tự ưu tiên:

1. Vector ANN top-N (luôn chạy nếu có ảnh).
2. Size-compatible union (khi query size hợp lệ + coverage đủ).
3. Feature-compatible union (khi query facts high-confidence + data coverage đủ).
4. Fallback metadata/legacy theo policy hiện có.

Không dùng size/feature để thay thế vector. Không trả top-10 chỉ từ một kênh nếu kênh đó chưa được đo.

### 8.2 Signal reliability

| Signal | Available khi | Unknown policy |
|---|---|---|
| Vector | có embedding/profile hợp lệ | không có vector → fallback path |
| Size | query size + candidate dims | thiếu một bên → neutral |
| Feature | facts query + facts candidate | thiếu field → neutral |
| Holes | mask reliable + không chói che lỗ | không reliable → neutral |
| Structure | geometry usable | partial/rejected → neutral |
| Confusing pair | có `confusing_note`/khai báo | không có → neutral |

### 8.3 Fusion rules

- `final_score` chỉ do `scoreFusion.js` (hoặc module thay thế được duyệt) tính.
- Không cộng điểm cho cùng một bằng chứng hai lần.
- Conflict penalty tối đa bị giới hạn; không loại khỏi top-10.
- `unknown` không bị phạt.
- Feature match chỉ được boost khi query facts đủ tin cậy.
- Size mismatch chỉ hard reject khi cả hai bên high-confidence và vượt dung sai.
- Nếu top-10 có cặp hard-negative đã khai báo: cảnh báo, không tự chọn bừa.

### 8.4 Decision

- `top-10` khi có ứng viên đủ điểm.
- `needs_review` khi confidence thấp, có conflict lớn, hoặc cặp dễ nhầm.
- `no_match` khi không có ứng viên; không nhồi mã rác.
- Không hứa “chính xác 100%”; UI ghi rõ cần đối chiếu.

---

## 9. Rủi ro và giảm thiểu

| Rủi ro | Tác động | Giảm thiểu |
|---|---|---|
| Dims chưa đủ | Size channel không hiệu quả, hard filter làm mất recall | Fail-open; union; chỉ bật khi coverage đủ |
| Partial subject | Mask/geometry sai, embedding lệch | `partial` state; tắt aspect/contour; hole unknown |
| Chói làm mất lỗ | Hole count sai | `clippedRatio`/`specularMask`; không suy đoán; yêu cầu chụp lại |
| Domain gap camera/catalogue | Vector gần sai | Canonicalization parity; test trên ảnh thật |
| Feature text mơ hồ | Match sai | Chuẩn hóa grammar; test semantics; confidence |
| Feature coverage thấp | Boost không đều | Unknown neutral; không coi thiếu là conflict |
| Hard filter quá tay | Mất target/recall | Không hard lock; fallback pool |
| Overfit ca `3448000001` | Tối ưu một mã, hỏng tổng thể | Regression case + frozen dev; không hard-code |
| Latency tăng | UX kém | Bounded oversampling; cache; đo P95 |
| Deploy sớm | Rủi ro production | Flags OFF; shadow/canary; owner approval |

---

## 10. Câu hỏi cần chủ dự án chốt

Các câu dưới đây không chặn U0, nhưng phải chốt trước khi bật behavior tương ứng.

1. **Partial subject:** cho phép chụp khi chỉ thấy một phần linh kiện, hay chỉ cảnh báo? Đề xuất: cho phép ở flag `partial_allowed`, mặc định OFF đến khi đo.
2. **Dung sai size:** giữ `5%` cho verified và `10%/3mm` cho manual, hay áp `5%` toàn cục? Đề xuất: giữ hiện tại đến khi có dữ liệu đo.
3. **White paper:** bắt buộc hay chỉ khuyến nghị? Đề xuất: khuyến nghị, không chặn các nền trơn khác.
4. **Feature hard filter:** chỉ dùng cho text-only exact search, hay cả image search? Đề xuất: text-only hard; image search soft.
5. **Dims đầy đủ:** khi nào có? Có cần migration/index mới không? Nếu có, phải qua Gate D.
6. **Latency budget:** P95 mục tiêu trên thiết bị thật là bao nhiêu?
7. **Dataset/nhãn:** ai cung cấp ảnh query thật và nhãn cho hard-negative? Không được bịa.
8. **Deploy:** có cho phép shadow/canary trên production không? Nếu không, dừng ở local + owner review.

---

## 11. Việc tuyệt đối không được làm

1. Không ghi/xóa vector, không re-index, không deploy, không migration production khi chưa được chủ dự án cho phép.
2. Không tạo vector từ Editor; chỉ Trung tâm Vector AI khi người dùng xác nhận.
3. Không hard-code mã, score, rank hoặc số liệu để “qua” test.
4. Không sửa test assertion để che lỗi.
5. Không restore `pipeline_moris.md` đang bị xóa; không `git reset --hard`, `git clean`, `git checkout --` hàng loạt.
6. Không đưa secret, token, service role key vào log/chat/public config.
7. Không bật `geometryVerification`/`contourVerification`/`spatialVerification`/`holeFormatBoost` khi chưa có ablation.
8. Không đổi profile/preprocess DINOv2 nếu chưa có kế hoạch re-index và Gate D.
9. Không gọi kết quả synthetic là “ảnh thật”; không ghi staging pass khi bị skip.
10. Không commit khi chưa được yêu cầu.

---

## 12. Definition of Done cho nhánh uplevel

Một task chỉ được đánh dấu xong khi:

- [ ] Code thay đổi đúng phạm vi, không phá auth/2FA/RLS/CSRF/anti-bot.
- [ ] Có test unit/integration tương ứng; test cũ vẫn pass.
- [ ] `npm test` pass 100%.
- [ ] `npx tsc --noEmit` exit 0.
- [ ] `npm run build` exit 0.
- [ ] Có evidence log/JSON thật, không bịa số.
- [ ] Không có production writes/deploy ngoài authorization.
- [ ] `state.json` và checklist được cập nhật.
- [ ] Rollback đã ghi rõ.
- [ ] Nếu metric chưa đạt: giữ `[ ]`, ghi blocker, không tuyên bố thành công.

---

## 13. Lệnh khởi động cho agent phiên sau

```bash
cd /workspaces/Dictionary
git status --short --branch
git log --oneline -5

# Đọc theo thứ tự
# AGENTS.md
# Plan_uplevel.md
# state.json
# docs/moris-v6/ARCHITECTURE.md
# docs/moris-v6/TECH_DEBT_REGISTER.md

# Chỉ chạy test khi đã xác định phạm vi thay đổi:
npm test
npx tsc --noEmit
npm run build
```

**Task đầu tiên:** U0 — Baseline & telemetry. Không bắt đầu U1–U6 trước khi U0 có baseline và chủ dự án xác nhận phạm vi.

**Khi báo cáo:** nêu rõ file đã đổi, lệnh đã chạy, output thật, metric trước/sau, việc chưa làm, rollback. Không dùng câu “đã hoạt động bình thường” nếu chưa có log.
