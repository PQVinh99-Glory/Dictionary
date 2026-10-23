# MORIS 3-LAYER ARCHITECTURE UPGRADE TRACKING PLAN

> Agent tiếp quản Moris V6: dùng [TECH_DEBT_ROADMAP.md](docs/moris-v6/TECH_DEBT_ROADMAP.md), [HANDOFF.md](docs/moris-v6/HANDOFF.md) và `state.json` làm điểm vào hiện tại. Các mục/checkpoint bên dưới được giữ để bảo toàn lịch sử; không lấy số liệu cũ làm trạng thái mới.

## Mục tiêu
Nâng cấp toàn diện **Moris 3-Layer Computer Vision Harness** sang TypeScript thuần túy, tương thích 100% Web Worker Offline, đạt truy vấn chính xác Top-10 trên 850 mã linh kiện dập kim loại theo đặc tả `MORIS_UPGRADE_PLAN.md` và `MORIS_AGY_PROMPT.md`.

---

## Danh mục công việc (Checklist)

- [x] **Bước 1 (Discovery Phase):** Khảo sát toàn bộ mã nguồn hiện tại trong `src/` và `kim-harness/`, lập bảng đối chiếu file hiện tại và module mới cần tạo.
- [x] **Bước 2 (Layer 1 - Optical Normalization):** Xây dựng `src/moris/moris-layer1-optical.ts` hoàn chỉnh (không TODO, không mock):
  - [x] Connected-Components flood-fill tách nền ngoài và lỗ bên trong (`fgMask`, `holeMasks`).
  - [x] Tính `aspectRatio`, `solidity` (Convex Hull Monotone Chain), `holeCount`.
  - [x] PCA 2D moments xoay ngang trục chính (-theta) và crop 6% padding resize 224x224.
  - [x] 180-deg Flip disambiguation: đối sánh trọng tâm `(x_fg, y_fg)` và `(x_detail, y_detail)`.
  - [x] 3-Channel Structural Pseudo-RGB Tensor: Channel 0 (LAB L + CLAHE 8x8 clipLimit 2.5 + median 3x3), Channel 1 (Scharr 3x3 gradient), Channel 2 (Two-pass Chamfer 3,4 Distance Transform), ImageNet normalization.
- [x] **Bước 3 (Layer 2 - Embedding & Coarse Gate):** Xây dựng `src/moris/moris-layer2-embedding.ts` hoàn chỉnh:
  - [x] Core Data Contract (`HoleFeature`, `SpatialKeyPatch`, `MorisPartSignature`).
  - [x] Stage 2A Hard Geometric Gate (tỷ lệ AR <= 0.22, Solidity <= 0.12, HoleCount <= 1, fallback mở rộng 1.5x khi < 40 ứng viên).
  - [x] Stage 2B Downsampling 16x16, Signed GeM Pooling (p=3.0) + Edge Detail Pooling tạo vector 768 chiều L2-normalized.
  - [x] Trích xuất 256 patch tokens từ ONNX DINOv2 (`[1, 257, 384]`) và fallback an toàn nếu chỉ có `[1, 384]`.
  - [x] Multi-Prototype Cold-Start Enrollment (4 biến thể quang học/hình học tạo `perspectiveCentroid`).
- [x] **Bước 4 (Layer 3 - Topological & Spatial Patch Re-ranking):** Xây dựng `src/moris/moris-layer3-rerank.ts` hoàn chỉnh:
  - [x] Top-32 key patches saliency & 3x3 spatial window patch matching (`S_SpatialPatch`).
  - [x] Hole-Constellation Symmetric Chamfer Distance (`D_HoleGraph`) trong không gian chuẩn hoá `(u, v, relArea)`.
  - [x] 16-harmonic Elliptic Fourier Descriptors (`D_EFD`) chuẩn hoá scale và starting point từ outer contour.
  - [x] Z-score Standardization Fusion và trả về Top 10 SKUs.
- [x] **Bước 5 (IndexedDB Storage & Re-indexing):** Xây dựng `src/moris/moris-idb.ts`:
  - [x] Quản lý IndexedDB `moris_signatures_v2`.
  - [x] Batch re-indexing utility cho 850 SKUs.
- [x] **Bước 6 (Tích hợp Web Worker & Build Verification):**
  - [x] Cập nhật Worker tích hợp 3 layer.
  - [x] Cấu hình `tsconfig.json` chuẩn và kiểm tra `tsc --noEmit`.
  - [x] Chạy toàn bộ test suite (`npm test`), đảm bảo 100% pass (202/202 tests) và build static sạch sẽ.
  - [x] Cập nhật `state.json` và báo cáo hoàn thành.
- [x] **Bước 7 (Hotfix 5 Critical Bugs theo MORIS_HOTFIX_PLAN.md):**
  - [x] **BUG 1:** Cập nhật `dinov2.worker.js` và `moris-worker-pipeline.ts`: truyền `opt` vào extractor callback, render canvas qua `pseudoRgbTensorToCanvas(opt)` (không để blank canvas ở reindex-batch-v2), gọi extractor với `{ pooling: 'none' }` có fallback.
  - [x] **BUG 2:** Sửa toán học `synthesizePerspectiveCentroid` trong `src/moris/moris-layer2-embedding.ts`: thay thế hoán vị chỉ số kênh bằng re-pooling `patchTokens` (256x384) qua gradient cột (nghiêng ngang), gradient hàng (nghiêng dọc), edge boost mũ 0.75 và border attenuation.
  - [x] **BUG 3:** Tính toán `aspectRatio` (trục chính xoay ngang PCA), `solidity`, `holeCount`, và `holeFeatures` (`u, v, relArea`) bất biến 100% với góc xoay camera 0-360 độ trong `src/moris/moris-layer1-optical.ts`.
  - [x] **BUG 4:** Tích hợp `enrollSkuSignatureV2` khi lưu ảnh part, `deleteSignatureV2` khi xóa mã, `searchPartTop10V2` trong `buildMorisQueryVector` và boost/merge Top 10 trong `src/app.js`.
  - [x] **BUG 5:** Đồng bộ test `tests/moris-layer2-embedding.test.ts`, chạy `npx tsc --noEmit` sạch 100%, transpile toàn bộ sang `.js` companion, chạy `npm test` đạt 202/202 pass 100%, build `dist/` sạch sẽ.
- [x] **Bước 8 (Unified Supabase 384D & Semantic-Geometric Upgrade theo MORIS_SUPABASE_UNIFIED_PLAN.md):**
  - [x] **Step 1 — Layer 1 Optical Normalization:** Dual-Mode segmentation (R2 cutouts vs Live camera bright-background), hạ ngưỡng lỗ dập xuống 0.04% (`0.0004`), phân cụm 1D Log-Area Otsu (`classifyHoleSizes1D`) tách `bigHoleCount` & `smallHoleCount`, chuẩn hoá in-plane 180° rotation (flipH + flipV đồng thời, cấm mirror lật chirality), `aspectRatio >= 1.0` khớp Supabase convention.
  - [x] **Step 2 — Layer 2 Embedding & Worker Probes (384D):** `computeSupabase384HybridEmbedding` (384D Masked-GeM + Edge-Detail, 0.55/0.45), `computeReliefInvertedOptical` (lật gương và đảo ngược phù điêu bề mặt dập nổi CLAHE), handler `embed-variants-v2` trong Worker sinh `canon_rgb_v2` và `canon_gray_v2` cùng rich geometry.
  - [x] **Step 3 — Flexible & Commutative Feature Matcher:** `parseIdentifyingFeaturesAST` và `matchFeatureQueryFlexible` trong `featureMatcher.js` & `src/app.js`, ranh giới số nghiêm ngặt `(?<!\d)\d+(?!\d)`, bất biến thứ tự giao hoán (`A + B == B + A`), tự động suy luận tổng số lỗ ngầm định (`big + small = total`), ngưỡng sai số cảm tính (+/- 1).
  - [x] **Step 4 — Cross-Modal Layer 3 Geometric Reranker:** Tự động phục hồi số lượng lỗ (Cross-Modal Recovery) cho 72 mã front legacy bị `hole_count = 0` từ text `identifying_features`, so khớp `big_hole_count` và `small_hole_count`, bất biến phản xạ gương tâm lỗ và bất biến xoay tỷ lệ khung hình; dọn dẹp `src/app.js` loại bỏ split-brain IndexedDB.
  - [x] **Step 5 — Đồng bộ dist/ & Verification:** Đồng bộ `.ts` sang `.js`, build `dist/` 42 files sạch sẽ, bổ sung unit tests cho AST order independence, strict numbers, big/small clustering, cross-modal recovery; pass 100% 210/210 unit tests, `tsc --noEmit` sạch 0 lỗi.
- [x] **Bước 9 (Hotfix Filter Bar, Strict AST Feature Matching & Khớp Badge theo MORIS_HOTFIX_FILTER.md):**
  - [x] **BUG 1:** Sửa `src/app.js` `loadParts()`: khi `isFeatureSearch` gửi `p_search: ''` và `p_limit: 2000`, `p_offset: 0` để fetch toàn bộ catalogue từ Supabase rồi áp dụng AST matcher trên toàn bộ SKU.
- [x] **Bước 10 (Thanh Filter mục tiêu ID & Mã linh kiện tại Main Catalogue và Moris Search):**
  - [x] **10.1 (Parser & Matcher mục tiêu):** Xây dựng `parseTargetQuery`, `matchRowWithTarget`, `filterCatalogueByTargetQuery`, `buildTargetAnswer` trong `src/moris/retrieval/featureMatcher.js` và `functions/_lib/moris/v5/retrieval/featureMatcher.js`:
    - ID key ("tìm id", "id", "tim id", "id:") -> Lọc CHÍNH XÁC (exact match) trên cột `part_id` trong `image_library`.
    - Mã key ("mã hàng", "tìm mã hàng", "mã", "ma", "ma hang") -> Lọc LINH HOẠT (contains substring) trên cột `code`.
    - Phân tách rõ ràng với truy vấn đặc điểm nhận dạng (lỗ, hình dáng).
  - [x] **10.2 (Tích hợp Moris Chat & Search API):** Nâng cấp `functions/api/moris/chat.js` và `functions/_lib/moris/v5/orchestrator.js` hỗ trợ truy vấn mục tiêu ID và Mã linh kiện:
    - Khi nhận diện lệnh tìm ID/Mã, quét catalogue (`scanCatalogue`), lọc đúng quy tắc, gán `is_feature_match: true`, `badge_label: 'Khớp'`, `score: 1.0`.
    - Sinh câu trả lời `buildTargetAnswer` tự nhiên, chính xác, không nhồi nhét mã rác top 10.
  - [x] **10.3 (Giao diện Main Catalogue Linh Kiện):**
    - Thêm dropdown chọn Mục tiêu lọc `[Tất cả | Mã linh kiện | ID]` ngay cạnh ô tìm kiếm tại `index.html`.
    - Cập nhật state `filters.target` và phương thức `loadParts` trong `src/app.js`: khi chọn ID thì lọc chính xác `part_id`, khi chọn Mã linh kiện thì lọc linh hoạt `code`.
  - [x] **10.4 (Unit Tests):** Bổ sung test suites đầy đủ trong `tests/moris-features-filter.test.js` và `tests/frontend.test.js` kiểm tra mọi trường hợp ID, Mã linh kiện, giao diện.
- [x] **Bước 11 (Đánh giá kiến trúc & Loại bỏ tách vector tự động khi lưu chỉnh sửa linh kiện):**
  - [x] **11.1 (Đánh giá kiến trúc tổng thể):** Kiểm tra toàn bộ luồng vector trong hệ thống; xác nhận Moris Search, RAG, Supabase pgvector và Trung tâm Vector AI không phụ thuộc vào `savePart()` auto-enqueue.
  - [x] **11.2 (Loại bỏ auto-vectorize trong src/app.js & index.html):**
    - Đặt `MORIS_VECTOR_AUTO_ON_SAVE_DESKTOP: false` và `MORIS_VECTOR_AUTO_ON_SAVE_MOBILE: false`.
    - Loại bỏ `enqueueMorisVectorJob` và `processMorisVectorQueue` khỏi `savePart()`.
    - Cập nhật text gợi ý trong Part Editor Modal (`index.html`).
    - Bảo toàn nút bấm thủ công "Tạo vector" (`vectorizeCurrentEditorPart`) và hoạt động độc lập của Trung tâm Vector AI.
  - [x] **11.3 (Unit Tests):** Bổ sung test kiểm tra `savePart()` không tự động enqueue và `MORIS_VECTOR_AUTO_ON_SAVE_DESKTOP` là `false` trong `tests/frontend.test.js`.
  - [x] **11.4 (Build & Verification):** Chạy `npm run build` sinh `dist/`, kiểm tra `tsc --noEmit`, chạy toàn bộ `npm test` pass 100% (229/229 unit tests), cập nhật `state.json`.


## Moris V6 — M00 baseline (2026-10-16)

- [x] **M00 — Đóng băng baseline:** Nhánh `feat/moris-v6`, HEAD `02289afa79747722b992938bee7c2d0414f7a9d2`; `npm test` exit 0 (18 files, 229/229 tests), `npm run build` exit 0 (42 files). Snapshot READ ONLY: 545 SKU / 1090 vector, delta 0; không ghi production, không deploy. TypeScript chưa chạy do thiếu compiler hợp lệ. Đã báo cáo Git, tests, rủi ro và rollback trước khi đánh dấu; xem [BASELINE.md](docs/moris-v6/BASELINE.md). Dừng chờ review, không thực hiện task khác.

- [x] **M01** — ARCHITECTURE.md + AGENTS vector ownership contract; static callers evidence; npm test exit 0, 18 files / 229 tests. No DB writes. Rollback: reverse M01 documentation hunks. Continue M02 per owner instruction.

- [x] **M02** — Removed Editor write helpers/UI and session retry; 6 behavior regressions; npm test exit 0: 235/235, 19 files. Updated old UI assertion for authorized M02 text change. No production writes. Rollback: reverse Editor/test hunks. Evidence M02-test.log.

- [x] **M03** — Center single/batch confirmation fails closed; legacy reindex redirects; server session/role + intent checks. npm test exit 0: 246/246, 20 files (M03-test.log). No production writes. Rollback M03 UI/API/tests. Continue M04.

- [x] **M04** — RGB-only explicit skip/replace, full composite-key atomic RPC + source ETag; proposed migration tested ONLY local pgvector. npm test 253/253, 21 files; SQL fixture pass; 8 concurrent writes -> 1 row (1 created/7 skipped). Evidence M04-*. No production writes. Rollback requires provenance/activity snapshot for local replacement; production migration not applied; Gate D required.

- [x] **M05** — Per-asset profile/source ETag states; unknown source fails closed, legacy vectors stale, SKU partial aggregation; npm test exit 0: 266/266, 22 files. M05-test.log. No production writes. Gate A pending browser review; rollback app + proposed migration per report. Continue authorized TypeScript/E2E/camera verification.

## Moris V6 — M00–M05 final verification (2026-10-16)

- [x] Local verification: 266/266 tests (22 files), TypeScript exit 0, build 42 files, real local SQL/concurrency/schema rollback pass, 10 browser E2E checks pass. Git `feat/moris-v6`, HEAD unchanged, no commit. Original user changes preserved.
- [x] Camera benchmark performed on six unprocessed `image 2/` captures: current V5 Top1 **0/6**, Recall@10 **4/6**. Quality gate **not passed**; no algorithm changes beyond M05.
- [ ] Gate A owner review and staging authentication/device verification. Proposed migration applied only locally; production unchanged (545 SKU / 1090 vectors), no deploy. Risks, test scope and scoped rollback: [PHASE_A_REVIEW.md](docs/moris-v6/PHASE_A_REVIEW.md). No tasks after M05 implemented.

- [x] **M06** — Spatial-only hybrid contract; legacy profile isolated, no CLS replication/browser fallback. 277/277 tests, 23 files; TS/build exit 0; real WASM 6/6 embeddings. No DB writes/commit/deploy. Risks and scoped rollback: docs/moris-v6/M06.md.

- [x] **M07** — Shared Worker canonicalization, aspect-preserving letterbox/version, explicit mask quality and no full-frame fallback. 286/286 tests; TS/build exit 0; real WASM 6/6, 4 masks flagged unreliable. Zero DB writes/deploy. Evidence/rollback docs/moris-v6/M07.md.

- [x] **M08** — Nullable geometry/version/quality; unknown neutral, API refuses unsafe legacy null coercion. READ ONLY audit 55/545 mismatches. 294/294 tests, TS/build pass, local E2E 10/10. No production writes/deploy. Report/rollback docs/moris-v6/M08.md.

- [x] **M09** — Filters preserved after hydrate; raw cosine separate from RRF, view/probe evidence retained, bounded oversampling. 300/300 tests; TS/build43 pass. New-profile exact/ANN validation deferred to matching benchmark index, not claimed. No DB writes/deploy. Report/rollback docs/moris-v6/M09.md.

- [x] **M10** — Complete bounded ID/code/feature paging; proposed stable SQL order tested on 1000 tied rows local. 309/309 tests, paging9/9, TS/build43 pass. Production migration unapplied. Zero production writes/deploy. Evidence/rollback docs/moris-v6/M10.md.

- [x] **M11** — Online server results isolated from offline cache; explicit local enrollment, profile and TTL. 314/314 tests, TS/build43 pass; 503 distinguished from empty. No DB writes/deploy. Evidence/rollback docs/moris-v6/M11.md. Next M19/M20 early benchmark per master dependency order.

- [ ] **M19 acceptance pending** — Dataset validator/private development manifest implemented; 329/329 tests, six byte hashes verified. Zero approved real labels/holdout/unknown negatives; 122-code set not located. See docs/moris-v6/M19.md. M20 tooling proceeds on synthetic/provisional data, no fabricated acceptance.

- [x] **M20** — Offline metrics runner validated:335/335 tests, TS/build43 pass. Historical six-camera replay 0/6 Top1,4/6 Recall10; missing metrics null. M19 holdout/label acceptance remains pending. No network/DB writes/deploy. Report/rollback docs/moris-v6/M20.md.

- [x] **M12** — Single final score owner, metadata penalties retained, count evidence not double-counted, unknown neutral. 341/341 tests, TS/build44 pass. Weights uncalibrated pending M22. No DB writes/deploy. Evidence/rollback docs/moris-v6/M12.md.

- [x] **M13** — Chirality policy rotation-only by default, evidence-gated reflection, no implicit mirrored query probe; PCA accepts binary masks. 347/347 tests; TS/build45 pass. No DB writes/deploy. Report/rollback docs/moris-v6/M13.md.

- [ ] **M14** — Optimal bounded hole assignment with pairing/reliability evidence; brute-force oracle tests. 353/353 tests, TS/build46 pass; synthetic64-hole p95 5.107ms. Real hard-negative validation pending M21/M22. Zero DB writes/deploy. docs/moris-v6/M14.md.

- [ ] **M15 acceptance pending** — Compact contour/EFD verifier implemented OFF; 358/358 tests, TS/build47 pass; measured synthetic CPU/byte budget. Real hard-negative improvement unverified. Evidence/rollback: docs/moris-v6/M15.md.

- [ ] **M16** — Verifier implemented OFF; 363 tests/TS/build pass. Real ablation and device budgets pending; see docs/moris-v6/M16.md.

- [x] **M17** — Reliability-aware available signals, neutral missing metadata, scaled conflicts; 368/368 tests, TS/build48 pass. Zero production writes/deploy. Evidence and rollback docs/moris-v6/M17.md.

- [ ] **M18** — Unique SKU/view evidence implemented; 372 tests/TS/build pass; RGB/gray A/B pending (docs/moris-v6/M18.md).

- [x] **M19** — Owner approves124 labels/scope; frozen93dev31holdout before new pixel inspection,124hashes verified,validator15/15/full latest372/372. No unknown negatives. Evidence and rollback docs/moris-v6/M19.md.

- [ ] **M21** — Review queue57 and evidence validation implemented;376tests pass; real curator/before-after acceptance pending.

- [ ] **M22** — Ablation tooling ready, reference inference running; decision provisionalNO-GO, real metrics pending.

- [x] **M23** — Additive nullable provenance proposal only; local data+ACL restore/rollback, service-only RPC checks pass;380tests TS/build48 pass. Production1090 unchanged, no writes/deploy. Quota/risks/rollback docs/moris-v6/DB_MIGRATION.md; GateD remains closed.

- [x] **M24** — Center preview/missing/stale/rebuild and per-asset pause/retry;385tests TS/build49, isolated localE2E10/10 pass; rows1→2 then stable2. Zero production writes/deploy. Risks/rollback docs/moris-v6/M24.md.

- [x] **M25** — Ranking points/evidence and conservative review guidance;389tests TS/build49 and localE2E12/12 pass incldesktop/mobile detailclick. Zero production writes/deploy. Risks/rollback docs/moris-v6/M25.md.

- [ ] **M26 local checkpoint** — 391/391 unit tests, TS/build49 pass; local E2E12/12. Supplied URL is production; staging auth/canary/sign-off pending. See docs/moris-v6/RELEASE_CHECKLIST.md.

- **Owner scope update:** Skip staging E2E and proceed with benchmark/final local verification; record skipped, never passed. Production writes/deploy remain prohibited.

## Checkpoint final local — 2026-10-16

391/391 tests (42 files), TypeScript/build49, local E2E12/12, local SQL data+ACL restore/rollback passed. Staging skipped by owner, not passed. Dev93/global Top1 58; frozen holdout31/global Top1 20, Recall10 29, Recall50 31. NO-GO; experimental verifiers OFF. No production writes/deploy/commit. See docs/moris-v6/DECISION.md and RELEASE_CHECKLIST.md.

Open acceptance: M14 hard-negative non-regression (previous code/unit completion is not full acceptance), M15 real benefit, M16 device/WebGPU budget, M18 multi-view/gray A/B, M21 curated cases, M22 full evaluation scope, M26 release sign-off/canary. Historical checkboxes in plan.md retain their original checkpoint context; state.json and current master/quick task tables carry the latest status.

- [ ] **M14 current acceptance** — Reopened acceptance gate after real camera ablation; implementation/unit tests pass, curated hard-negative non-regression is unverified.
- [ ] **M22/M26 final acceptance** — Measurements complete and staging skipped; NO-GO and remaining evidence listed above.

## Local checkpoint closed — quota restraint

Owner requested closing the current task without further quota-heavy loops. Runtime image geometry defaults OFF based on development evidence, with explicit text constraints preserved; approved hard-negative snapshot hashes require SHA-256 format. Actual verification:395/395 tests,43files; TypeScript/build49 and local E2E12/12 pass. Logs: docs/moris-v6/evidence/M22-gate-*.log. No new benchmark or test run scheduled; remaining quota is unknown.

Remaining M14/M15/M16/M18/M21/M22/M26 acceptance is unverified; no blanket completion or release claim. Staging skipped by owner. No production writes/deploy/commit. Rollback only the geometry flag/orchestrator and evidence-validator/test hunks, preserving owner changes; reenabling geometry restores the measured regression and is not recommended without new evidence.

## M21 review-link checkpoint

Catalogue review evidence was linked without inference:55/55 legacy refs resolved;59 local front-image hashes checked. All57 cases remain unlabelled/pending curator. New focused tests8/8 and full unit suite398/398 (44files) pass. See `docs/moris-v6/M21.md`; no production writes/deploy.

M21 review queue now includes optional frozen-development ranking context. Only11/57 items have a matching development query; both specified pairs lack one, and no holdout was used. Still0 curator outcomes. Focused review tests10/10 pass; full suite398/398 predates the final two focused additions.

## Agent handoff

Before continuing, read [docs/moris-v6/HANDOFF.md](docs/moris-v6/HANDOFF.md). It records exact remaining gates, current evidence and quota constraints. Do not rerun heavy inference; staging skipped; preserve dirty tree and production prohibition.

## Hotfix: Image search error ("Xin lỗi anh, em chưa thể xử lý yêu cầu này lúc này") - 2026-10-16

- **Triệu chứng:** Người dùng tải ảnh linh kiện (ví dụ `3405370001.png` trong `image copy.png`) gửi tìm kiếm thì nhận được phản hồi lỗi tạm thời `MORIS_PUBLIC_MESSAGES.temporaryError`.
- **Nguyên nhân gốc (3 tầng lỗi):**
  1. *Lỗi lệch profile:* Trình duyệt sinh vector với profile `hybrid_gem3_edge_55_45_pseudorgb_u8_v1` (`kim_canon_v3_letterbox`), trong khi `wrangler.toml` và `.env` vẫn cố định `cls_l2_v1` (`kim_canon_v2`). Hàm `encodeQueryImage` ném lỗi `MORIS_VECTOR_PROFILE_MISMATCH` (status 400).
  2. *Lỗi RPC v6 chưa migrate:* `searchVectorIndex` gọi RPC `match_catalogue_image_vectors_v6`. RPC này thuộc migration đề xuất M23 (`20261016040525_moris_v6_nullable_provenance.sql`) vốn chỉ thử nghiệm local và chưa áp dụng lên Supabase Production (Gate D). PostgREST trả 404 (PGRST202: function not found).
  3. *Lỗi nuốt exception:* `publicErrorMessage(error)` trong `functions/api/moris/search.js` không ánh xạ các lỗi trên mà fallback về chuỗi thông báo lỗi tạm thời chung chung.
- **Giải pháp:**
  1. Nâng cấp `searchVectorIndex` trong `functions/_lib/moris/v5/vector/search.js`: tự động fallback sang RPC `match_catalogue_image_vectors` hiện có trên Production nếu `_v6` chưa có; tự động tra cứu fallback profile `cls_l2_v1` nếu profile mới trả về 0 dòng do database chưa re-index.
  2. Đồng bộ `wrangler.toml` và `.env` khớp với `kim_canon_v3_letterbox` và `hybrid_gem3_edge_55_45_pseudorgb_u8_v1` theo đúng hợp đồng của client `src/moris/vector/browserDinov2.js`.
  3. Bổ sung ánh xạ lỗi rõ ràng cho `MORIS_VECTOR_PROFILE_MISMATCH` và HTTP 401 trong `publicErrorMessage`.
- **Bằng chứng kiểm thử:**
  - `npm test`: 44 files / 405 tests pass 100%.
  - `npx tsc --noEmit`: exit 0 (0 error).
  - `npm run build`: 49 files static sinh ra sạch sẽ.
  - `node tools/check-moris-e2e.mjs`: 12/12 pass.
  - Test trực tiếp `runMorisSearch` trên ảnh thực tế mã `3405370001`: trả về Top 1 chính xác mã `3405370001` với similarity = 1.0 và gợi ý đối chiếu chuẩn xác.

## Hotfix: Vector Center RPC fallback (`kim_write_catalogue_vector_v6_provenance` -> `kim_upsert_catalogue_image_vector`) - 2026-10-16

- **Triệu chứng:** Khi người dùng bấm tạo/cập nhật vector trong Trung tâm Vector AI (`tools/moris-vector-center.html`), toàn bộ ảnh báo lỗi:
  `failed — Could not find the function public.kim_write_catalogue_vector_v6_provenance(p_mode, p_vector) in the schema cache`.
- **Nguyên nhân gốc:** Migration M23 (`20261016040525_moris_v6_nullable_provenance.sql`) chứa hàm `kim_write_catalogue_vector_v6_provenance` chỉ mới chạy trên môi trường test local Docker, chưa chạy trên Supabase Production theo nguyên tắc Gatekeeper Hiến pháp. Supabase Production hiện tại chỉ có RPC `kim_upsert_catalogue_image_vector`.
- **Giải pháp:**
  1. Thêm cơ chế fallback trong `functions/api/moris/vector-upsert.js`: khi RPC `kim_write_catalogue_vector_v6_provenance` trả về lỗi không tìm thấy hàm (`schema cache` / `PGRST202`), tự động chuyển sang gọi RPC `kim_upsert_catalogue_image_vector` sẵn có trên Production với đầy đủ metadata hình học (`hole_count`, `aspect_ratio`, `hole_centroids`, `quality_score`, `embedding_profile`).
  2. Bổ sung unit test trong `tests/moris-manual-upsert.test.js` xác nhận luồng fallback hoạt động trơn tru.
- **Bằng chứng kiểm thử:**
  - `npm test`: 44 files / 406 tests pass 100%.
  - `npx tsc --noEmit`: exit 0.
  - `npm run build`: 49 files static sinh ra sạch sẽ.
  - `node tools/check-moris-e2e.mjs`: 12/12 pass.

## Review kiến trúc Moris & cơ sở nghiên cứu phân biệt kích thước — 2026-10-17

- [x] **Review toàn bộ kiến trúc vận hành Moris** (đường ghi Vector Center, đường đọc chat text, đường đọc ảnh 3 lớp, hợp đồng profile/geometry/DB RPC) và **viết tài liệu `pipeline_moris.md`** làm cơ sở cho bài nghiên cứu.
- **Kết luận gốc:** pipeline bất biến tỉ lệ theo thiết kế (crop sát vật thể + letterbox 224×224, toạ độ lỗ chuẩn hoá, aspect ratio tỉ số) nên **không thể phân biệt hai mã cùng hình dạng khác kích thước**; DB không có cột kích thước mm; ảnh `image 2/` không có vật chuẩn tỉ lệ.
- **Đề xuất trọng tâm trong tài liệu:** Tầng 0 "Size Gate" — neo tỉ lệ bằng thẻ in 4 marker + đo mm vật thể + bảng `catalogue_part_dimensions` (proposal, chờ Gate D) + lọc dung sai trước rerank; kèm lộ trình P0–P5, bộ metric size-pair/unknown-negative và 8 câu hỏi mở cần chủ dự án xác nhận.
- Không thay đổi mã nguồn/runtime/migration/deploy trong lần review này; dirty tree và branch `feat/moris-v6` được giữ nguyên. Chi tiết: [pipeline_moris.md](pipeline_moris.md).

## Subject Locking, Mask Purity & Size Contract — đề xuất M27/M28 (2026-10-17)

- [x] **Bổ sung Phần 10 vào [pipeline_moris.md](pipeline_moris.md)** theo làm rõ của chủ dự án: (10.1) Subject Locking 5 lớp phòng thủ chống bóng đổ/lem nền/vật dư/chói + điều kiện readiness trước khi chốt khóa; (10.2) tái tạo chủ thể deterministic (matte + nền hằng số, làm phẳng chiếu sáng, fill chói kênh L/edge, validate lỗ) — cấm generative inpainting, ràng buộc `kim_canon_v4_*` + re-index qua Vector Center (Gate D); (10.3) Size Contract cặp `(length_mm, width_mm)` theo trục PCA (`L ≥ W`, bất biến hướng, hình vuông không special case, metric đối xứng có hoán vị); (10.4) phân kỳ an toàn S1 (không re-index) / S2 (đổi canonicalization); (10.5) bộ bằng chứng cần thu (mask IoU, size-pair, test-retest px/mm); (10.6) định nghĩa đề xuất M27/M28; (10.7) câu hỏi mở Q9–Q11. Cập nhật đồng bộ bảng proposal 5.3 (`length_mm/width_mm`) và thuật toán 5.4.
- [x] **M27 — Subject Locking & Mask Purity (S1):** tap-to-lock + readiness + classifier bóng đổ/chói + voting đa khung trong camera modal; giữ nguyên canonicalization, không re-index; exit evidence: focused tests + mask IoU/reliable rate. **Đã triển khai 2026-10-17 — xem mục "M27 — Subject Locking & Mask Purity (P1.3)" cuối file** (S1; còn đo ảnh thật ở pilot).
- [x] **M28 — Size Contract & Size Gate (S1→S2):** chuẩn hoá cặp `(length_mm, width_mm)`, gate dung sai 2 tầng + UI nhập size; S2 gắn version canonicalization mới + re-index qua Vector Center.** Đã triển khai S1 2026-10-17 — xem mục "M28 — Size Contract & Size Gate (P1.4)" cuối file.**
- Ràng buộc chung của hai đề xuất: không đụng production/re-index/runtime; phụ thuộc câu trả lời Q1–Q11; bộ dữ liệu camera mới phải đóng băng manifest trước khi đo (theo M19/TECH_DEBT_ROADMAP).

## Nghiệp vụ sai hình dạng lỗ, đa ảnh catalogue & dung lượng R2 (2026-10-17)

- [x] **Bổ sung Phần 11 vào [pipeline_moris.md](pipeline_moris.md):** ca mẫu 3421750001 (5 lỗ tròn) vs 3421760001 (4 lỗ + 1 lỗ vuông) bị tìm nhầm khi chụp 1 tấm từ trên xuống; ghi nhận **B13** (không có phân loại hình dạng lỗ từ ảnh — chỉ có regex text metadata); kiểm kê hạ tầng đa ảnh đã có sẵn (image_assets thumb/front/back/detail/compare, Vector Center xử lý từng asset, multi-probe cap 3, M18 SKU pooling); đánh giá 3 mức giá trị của back + 2 detail kèm cảnh báo fairness coverage; phân tích R2 900 mã × 4–5 ảnh ≈ 0.75–1.3GB với nén WebP hiện có (an toàn dưới 10GB; ảnh gốc 3–5MB sẽ vượt 10.8–18GB); bổ sung Q12–Q15.
- [x] **Xác minh read-only asset/vector của 3421750001 và 3421760001** (asset_type + has_vector) và mâu thuẫn M18-snapshot (chỉ front/thumb) — đã xác minh bằng PostgREST read-only 2026-10-17: 3421750001 = thumb+front+back+detail×2 (7 vector rows); 3421760001 = thumb+front (4 vector rows) → multi-view có nhưng chưa đồng đều.
- [ ] **Bổ sung bộ hard-negative cặp mẫu** (ảnh thật nhiều góc: top-down xa, nghiêng, cận cảnh lỗ) + ablation multi-view (front-only vs +detail vs +back) vào kế hoạch M21 khi được cấp quota.
- [x] **Cập nhật phạm vi M27:** thêm "hole-shape evidence" (phân loại tròn/vuông/oval từ mask) — đã đồng bộ pipeline_moris.md §10.6 và state.json; đã triển khai trong `src/moris/capture-subject-lock.js` (DFT radial k=2/k=4) 2026-10-17.


## Chốt chuẩn 5 ảnh/mã, xác minh thay ảnh R2 & kế hoạch thực thi chi tiết — 2026-10-17

- [x] **Chốt chuẩn dữ liệu với chủ dự án:** tối đa **5 asset/mã = thumb + front + back + 2 detail** (tối thiểu thực dụng 4: front+back+2 detail; thumb tự sinh từ front); yêu cầu **thay ảnh phải xoá object R2 cũ**, không ghi chồng thêm.
- [x] **Xác minh code hành vi thay ảnh (phát hiện B14/B15):** hiện CHƯA đúng — `savePart` (`src/app.js:1889`) → `mergeAsset` (`:1883`) → `app_replace_part_assets` (`:1945`) chỉ đổi đường dẫn DB; object R2 cũ theo `uploadId` **không bị xoá** (không có `CATALOGUE_BUCKET.delete` trong luồng upload/save; chỉ `bulk-delete.js:81-93` và `delete-all.js` purge). `delete-part.js` (xoá 1 mã) cũng không purge R2. → Ghi B14/B15 vào `pipeline_moris.md` §4/§11.4.
- [x] **Chốt toán dung lượng 4.500 ảnh:** 900 × 5 = 4.500 ảnh nén WebP ≈ **0.8–1.3GB — KHÔNG vượt 10GB** (ngưỡng ~2.2–2.4MB/ảnh trung bình); chỉ vượt nếu upload ảnh gốc 3–5MB (13.5–22.5GB). Số thật chốt bằng pilot đo dung lượng.
- [x] **Bổ sung Phần 12 [pipeline_moris.md](pipeline_moris.md):** kế hoạch thực thi chi tiết cho phiên sau — 12.1 quyết định đã chốt; 12.2 chương trình milestone; 12.3 thứ tự P0–P3; 12.4 exit evidence & rollback; 12.5 việc KHÔNG làm.
- [ ] **[ĐỀ XUẤT] M29 — Multi-view & Capture Enrichment (S1):** chuẩn 5 ảnh, index back/detail qua Vector Center, probe cap 3→5 có test, câu hỏi phân biệt tự động, fairness rule. Blocker: Q12/Q14 + xác minh 2 mã + M18 acceptance.
- [ ] **[ĐỀ XUẤT] M30 — Asset Lifecycle & R2 Hygiene:** sửa B14 (xoá object cũ khi replace) + B15 (purge R2 khi xoá 1 mã), audit orphan, quota monitor. Blocker: duyệt phạm vi P0.
- [ ] **P0 — chủ dự án (làm trước phiên sau):** trả lời Q1–Q15; xác minh read-only asset/vector 3421750001 & 3421760001 trên Trang Trung tâm Vector AI (asset_type + has_vector) để chốt mâu thuẫn M18 snapshot; duyệt phạm vi M30.
- [ ] **P1 — code S1 (phiên sau):** M30 fix R2 lifecycle (focused tests) → pilot 20 mã chuẩn 5 ảnh (đo dung lượng WebP thật + index Vector Center front/back/detail) → M27 (subject locking + readiness + hole-shape evidence) → M28 (size UI + gate 2 tầng phía query, fail-open).
- [ ] **P2 — đo lường:** EVAL đóng băng dataset (mask IoU, hole-shape accuracy, size-pair + cặp 3421750001/3421760001 hard-negative, unknown negatives, ablation multi-view) theo quota HANDOFF.
- [ ] **P3 — gated:** S2 re-canonicalization `kim_canon_v4_*` + re-index 4.500 vector + A/B (chỉ sau Gate D + owner duyệt).
- [x] **Prompt khởi động phiên mới:** tạo `docs/moris-v6/SESSION_BOOT_PROMPT.md` — agent mới dán nguyên khối PROMPT là vào dự án nhanh, chính xác, không cần đọc lại toàn bộ codebase.
- [x] **Đồng bộ HANDOFF.md + push main (2026-10-17):** sửa phần "Git và checkpoint" theo trạng thái thực tế (main, commit nền 2657b49, file owner xoá đọc qua `git show 2657b49:`); cập nhật `SESSION_BOOT_PROMPT.md` hậu push; `npm test` 44 files/406 tests pass + `tsc` exit 0; commit và push toàn bộ lên `main` theo yêu cầu chủ dự án.

## M30 — Asset Lifecycle & R2 Hygiene (P1.1) — 2026-10-17

- [x] **P0 chốt với chủ dự án (2026-10-17):** duyệt M30 triển khai ngay; Q1–Q14 đã trả lời — Q1 ERP chưa có trường kích thước, hướng phát triển chỉ thêm **dài + rộng** (KHÔNG thêm dày); Q2 không có quy tắc chữ số mã hoá size; Q3 bắt buộc thẻ chuẩn cho ảnh mới; Q4 cả hai Case A + B (chủ dự án sẽ gửi cặp mã mẫu sau); Q5 dung sai ≤ 5% toàn cục; Q6 chỉ dài × rộng; Q7 có nhân lực đo kẹp nhưng chậm; Q8 chấp nhận trạng thái trung tính; Q9 chốt quy ước PCA `L ≥ W`; Q10 chốt tap-to-lock; Q11 S1 trước — quyết S2 sau A/B; Q12 đủ 5 ảnh toàn bộ 900 mã; Q13 **KHÔNG** nâng probe cap 3→5 (giữ 1 ảnh front); Q14 chờ pilot 20 mã trước khi index hàng loạt.
- [x] **P0.2 xác minh read-only production (PostgREST service role, không ghi):** 3421750001 = thumb+front+back+detail×2 (7 vector rows); 3421760001 = chỉ thumb+front (4 vector rows) → chốt mâu thuẫn M18 snapshot: multi-view đã có nhưng **chưa đồng đều**, theo fairness §11.3 chưa đưa vào ranking.
- [x] **M30 — sửa B14 (thay ảnh xoá object R2 cũ):** endpoint mới `functions/api/catalogue/purge-assets.js` (admin-only, validate key đúng định dạng asset catalogue chống path traversal, fail-closed — chỉ xoá key không còn tham chiếu trong `image_assets`/`image_library`) + `src/app.js` `savePart` thu `replacedPaths` (gồm thumb tự sinh khi upload front) trước khi merge và purge sau khi `app_replace_part_assets` thành công; dọn `uploadedPaths` best-effort khi save lỗi giữa chừng; helper `purgeR2Assets` không chặn luồng lưu.
- [x] **M30 — sửa B15 (xoá 1 mã purge R2 đối xứng bulk-delete):** `functions/api/catalogue/delete-part.js` thu r2 keys (`image_assets` + `image_library`) TRƯỚC khi gọi `app_delete_part`, purge R2 sau khi DB xoá thành công, trả thêm `r2_deleted_keys_count`; không purge nếu RPC xoá thất bại.
- [x] **Bằng chứng kiểm thử (không hardcode số):** focused `npx vitest run tests/catalogue-delete.test.js tests/moris-editor-no-index.test.js` → **2 files / 26 tests pass** (6 test purge-assets: 401/403/400 path traversal/503/bỏ key còn tham chiếu/fail-closed; 2 test delete-part purge; cập nhật assertion M02: savePart chỉ gọi API `/api/catalogue/purge-assets`, không vector/model). Full `npm test` → **44 files / 414 tests pass 100%** (trước M30: 406). `npx tsc --noEmit` exit 0. `npm run build` 49 files exit 0. Production writes 0; chưa deploy; chưa commit.
- [x] **M30 — audit orphan R2 + quota monitor (2026-10-17, read-only):** xác minh `CLOUDFLARE_API_TOKEN` trong `.env` HỢP LỆ (verify OK) — chỉ thiếu `CLOUDFLARE_ACCOUNT_ID` (để trống), tự resolve qua `GET /accounts` = `06783fecdbfbfab470cc1a70c31ab53e`; tool mới `tools/r2-audit.mjs` (chỉ đọc). Kết quả bucket `catalogue-images`: **1546 objects / 42.84MB**; DB refs: `image_assets` 1093 path + `image_library` 545 (tập con), **missing = 0**; **orphan 453 objects / 12.02MB** (front 186, thumb 185, `parts/` legacy 77, back 4, detail 1). Báo cáo: `/tmp/opencode/r2-audit-report.json`.
- [x] **M30 — purge orphan R2 ĐÃ THỰC THI (2026-10-17, chủ dự án duyệt):** tool mới `tools/r2-purge-orphans.mjs` (fail-closed: re-đọc DB refs trước từng delete, `KEEP_PREFIXES=['parts/']`, `MAX_TARGETS=500`, `MAX_BYTES=20MB`, dry-run mặc định, `--execute` mới ghi, `--log`). Dry-run: `targets=376 bytes=11141715 by_type={back 4, detail 1, front 186, thumb 185}` (giữ 77 object `parts/`). Execute: **deleted 376/376, 0 lỗi, 11.14MB**; log `/tmp/opencode/r2-purge-log.json`. Re-audit: bucket còn **1170 objects / 32.22MB**, orphan còn **77 (chỉ `parts/`)**, missing = 0. Production writes: 376 (đã được duyệt); chưa deploy; chưa commit.
- [ ] **M30 còn lại — 77 object legacy `parts/`:** giữ nguyên theo quyết định purge; nếu muốn xoá thì mở rộng `KEEP_PREFIXES`/pattern riêng khi chủ dự án duyệt.
- [ ] **P1.2 tiếp theo:** pilot 20 mã chuẩn 5 ảnh (đo dung lượng WebP thật thay ước lượng §11.4, index front/back/detail qua Vector Center, đọc lại listing xác nhận; ảnh chụp theo thẻ chuẩn 4 marker) — cần ảnh thật của chủ dự án; sau pilot: đo mask IoU/lỗ + **size-pair precision của M28** trong điều kiện vận hành.

## M27 — Subject Locking & Mask Purity (P1.3) — 2026-10-17

- [x] **Q4 — nhận 3 cặp mã mẫu hard-negative (ảnh trong `image 2/`, 129 file):** (1) `3446950001` (4 lỗ tròn + 1 lỗ vuông) vs `3446960001` (5 lỗ tròn) — khác định dạng lỗ; (2) `3440010001` vs `3889630101` — khác số lỗ + kích thước chuẩn; (3) `3400530401` vs `3462530001` — khác vị trí đục lỗ. Dùng cho EVAL/M21 + kiểm chứng hole-shape evidence trên ảnh thật ở pilot; không dùng lại làm holdout tuning.
- [x] **Module mới `src/moris/capture-subject-lock.js` (subject_lock_v1, pure TypedArray, DOM-free):** background estimation; classifier bóng đổ ("nền × hệ số tối" theo lumaRatio + dist cap, kiểm tra trước nhánh part) và chói (vùng sáng kín trong thân, không liên thông biên — không tính là lỗ); component labeling + tap-to-lock seed (fallback component lớn nhất); `extractEnclosedHoles` + `classifyHoleShape` bằng DFT radial k=2/k=4 (bất biến xoay: vuông→A4, oval→A2, tròn→profile phẳng, unknown khi nghi ngờ); `voteMasks` đa khung (majority + agreement); `laplacianVariance`; `computeReadiness` 5 điều kiện + guidance tiếng Việt; `maskIoU`/`scaleMaskNN`/`maskToRgba`.
- [x] **Tích hợp camera modal:** `index.html` — `@click="handleCameraTap"` trên video + marker seed, panel readiness 5 chips (Trong khung/Một vật/Ổn định/Ít chói/Đủ nét) + guidance trực tiếp, hint cập nhật; `src/app.js` — CONFIG `MORIS_CAMERA_SUBJECT_LOCK_ENABLED` + module URL (build-static thêm `PUBLIC_MORIS_SUBJECT_LOCK_MODULE_URL`), `handleCameraTap` (quy đổi object-fit cover + crop 1000:410 → seed chuẩn hoá), `_sampleCameraLockFrame` (poll 450ms, canvas ≤500px, stability bằng IoU ≥ 0.92, voting tối đa 4 mẫu), `buildSubjectMaskDataUrl` (mask capture-scale + hole evidence + `camera.lock.evidence` + `moris.captureEvidence`, fallback mask cũ khi lỗi/tắt), scanStatus hiển thị "Lỗ: n tròn • n vuông • n oval".
- [x] **Bằng chứng kiểm thử:** focused `npx vitest run tests/moris-capture-subject-lock.test.js` → **17/17 pass**, gồm eval tổng hợp 4 cảnh gán nhãn: **mean mask IoU = 1.0000; hole-shape accuracy = 100.0% (10/10)**; bất biến xoay (vuông 30°, oval 40°); bóng đổ contamination = 0; chói không tạo lỗ giả; voting loại vật nhấp nháy; chạm biên → guidance "lùi máy". Full `npm test` → **45 files / 431 tests pass 100%** (trước M27: 414). `npx tsc --noEmit` exit 0. `npm run build` 50 files exit 0. Production writes 0; chưa deploy; chưa commit.
- [x] **Đo trên ảnh thật `image 2/` (2026-10-17):** tool mới `tools/png-decode.mjs` (decoder PNG 8-bit RGB/RGBA thuần Node+zlib, không dependency; `tests/png-decode.test.js` 4/4) + `tools/eval-m27-real-photos.mjs` (harness camera/cutout, composite nền trắng, alpha-GT, đối chiếu `identifying_features`). **Phát hiện:** 125 file là ảnh camera THÔ (124 nhãn + `3460370001` chủ dự án loại trừ giữ nguyên) + 4 file mới ĐÃ XỬ LÝ NỀN (cutout alpha trong suốt: `3400530401`, `3446950001`, `3446960001`, `3462530001`) — khớp lời chủ dự án (125 mã gốc + 4 mã mới). **Camera 124 ảnh:** selected 124/124, coverage median 0.348, holes median 7 (giảm 6.7x nhờ hardening), check fails: inFrame 115 / singleSubject 6 / lowSpecular 2 / sharp 0 (ảnh thô chưa chụp theo thẻ chuẩn nên fail margin/coverage theo thiết kế UI). **Cutout 4 ảnh:** alphaIoU mean 0.9378 / min 0.9235; chữ ký lỗ từ alpha: `3446950001` = 3 tròn + 1 vuông + 1 oval (khớp "4 tròn + 1 vuông", 1 tròn bị phối cảnh thành oval), `3446960001` = 4 tròn + 1 oval (khớp "5 tròn"), `3400530401` (8 lỗ) vs `3462530001` (9 lỗ) khác vị trí rõ — khớp mô tả cặp Q4. **21 mã có nhãn `identifying_features`:** vuông |Δ| 0.43; tròn/oval lệch do phối cảnh (bias "rounded" −25/148) → bằng chứng hình dạng là heuristic, quyết định dùng cho ranking ở EVAL/M21. Report: `/tmp/opencode/m27-real-photos-final.json`.
- [x] **Hardening từ ảnh thật:** `closeMask` (closing 3×3 ×1 vòng, lấp khe nứt ≤2px) áp trong `analyzeFrame`; `holeMinAreaFrac` 0.0004 (ngưỡng lỗ theo diện tích chủ thể); gate `fill ≥ 0.4` + `bw,bh ≥ 3`; trần profile `A2 ≤ 0.55` / `A4 ≤ 0.55` / `radiusCV` (loại vùng răng cưa → unknown); `squareMinA4` 0.08→0.06 (bắt lỗ vuông bo góc — `3446950001` vuông được nhận đúng sau hạ ngưỡng, không đổi kết quả trên bộ camera có nhãn). Giảm nhiễu lỗ **6754 → 1003** trên 124 ảnh. Focused `tests/moris-capture-subject-lock.test.js` **21/21** (thêm 4 test: closeMask, ngưỡng tương đối, profile răng cưa→unknown, khe nứt 1px không tạo lỗ giả). Full `npm test` → **46 files / 439 tests pass 100%**. `npx tsc --noEmit` exit 0. `npm run build` 50 files exit 0. Production writes 0; chưa deploy; chưa commit.
- [x] **Nâng cấp tracking theo phản hồi vận hành 2026-10-19 (chủ dự án duyệt):** (1) nhịp lấy mẫu 450→600ms (`MORIS_CAMERA_LOCK_SAMPLE_MS`) để rà kỹ nền sáng trước khi bám; (2) `selectSubject` gom cụm component bằng union-find theo khe hở bbox ≤ `max(3, min(14, 4%·minDim))` px — hàng dài/chói bị tách mảnh vẫn bắt **trọn thân** (hết "bám một phần thân"), stats thêm `selected.merged`/`mergedComponents`, 2 vật xa nhau không bị gộp; (3) khung vẽ nội suy **60fps**: `smoothBoxView` (EMA tau 150ms) + `_camLockAnimTick` rAF ghi `style` DOM trực tiếp qua `ref="camLockBox"`, bỏ `transition-all`/`:style` để không re-render Vue 60fps; (4) viền `2px → 1.5px`, giữ nguyên hình vuông đầy đủ + màu emerald/amber + nhãn. Bằng chứng: focused 4 file 78/78; full `npm test` **55 files/530 tests pass 100%** (+5 test mới: 3 merge, 3 smooth/ref); `npx tsc --noEmit` exit 0; `npm run build` 46 files; production writes 0; chưa deploy; chưa commit.
- [ ] **M27 còn lại (chủ dự án 2026-10-19: bỏ pilot test-only — nghiệm thu bằng vận hành thật trên production):** pilot P1.2 chụp theo thẻ chuẩn 4 marker để đo trong điều kiện vận hành; mask IoU với ground-truth người gán nhãn (alpha chỉ có ở 4 cutout); quyết định feed priorMask vào embedding query chỉ sau EVAL/M21 (tránh lệch phân phối center/query khi chưa có A/B).

## M28 — Size Contract & Size Gate (P1.4) — 2026-10-17

- [x] **Nâng cấp S1.1 — cạnh dài bắt buộc, cạnh ngắn tùy chọn + dung sai theo nguồn (chủ dự án chốt 2026-10-19):** hợp đồng `size_contract_v1_1` (client+server mirror): `normalizeSizePair` nhận 1 cạnh (= cạnh dài, `width_mm=null`), `evaluateSizeMatch` trả `match_partial` khi thiếu cạnh ngắn (chỉ so cạnh dài, không loại oan), `resolveSizeTolerance` theo nguồn đo — nhập tay/không rõ **10%/sàn 3mm**, verified (caliper/marker_photo/erp/camera_measured, chỉ khi cả 2 bên) **5%/2mm**. `applySizeGate` giữ `match_partial` + `partial_count` evidence; UI editor/camera: cạnh dài `*` bắt buộc, cạnh ngắn "(tùy chọn)", hint riêng; `loadEditorSize` hiển thị width null → để trống. DB: migration `20261019120000_size_contract_s11_optional_width.sql` (`width_mm DROP NOT NULL` + CHECK NULL-safe + RPC width optional) — **đã push production 2026-10-19 (chủ dự án ủy quyền)**. Version **6.3.0**. Bằng chứng: focused size 5 file 65/65; full `npm test` **55 files/537 pass**; `tsc` 0; build 46 files; production writes 0; đã commit `75bc8ec` + push cả 2 remote.
- [x] **Hợp đồng kích thước S1 (`size_contract_v1`):** module mới `src/moris/size-contract.js` (pure, DOM-free) — `normalizeSizePair` tự hoán vị về `L ≥ W` (chấp nhận số/chuỗi thập phân phẩy, cap 5000mm), `shapeClass` (vuông khi `|L−W|/L ≤ 5%`, không special case), `toleranceForEdge = max(5% × cạnh, sàn 2mm)` (Q5), `evaluateSizeMatch` (khớp từng cạnh + `d_max`), `sizeDistance`, `normalizeQuerySize` (làm sạch `source`/`confidence`), `formatSizePair`.
- [x] **Gate phía server (`functions/_lib/moris/v5/retrieval/sizeGate.js`):** mirror 1:1 phần hợp đồng (có test parity client/server tự động) + `applySizeGate` 3 trạng thái **fail-open**: `not_provided` (không có size → giữ nguyên pool), `dims_unavailable` (bảng chưa có/lỗi → giữ nguyên + cảnh báo trung tính — Q8), `applied` (giữ `match`/`unknown` + `size_status`/`size_evidence` từng ứng viên, loại `mismatch` + rejected list cap 10) + `loadCandidateDims` (PostgREST `catalogue_part_dimensions`, tối đa 100 id/request, 404/lỗi mạng/thiếu env → `null`, never throw).
- [x] **Tích hợp orchestrator:** chèn gate sau `hydrateVectorHits` trước `rankMetadata`; toàn bộ ứng viên bị loại → mode mới `MORIS_SIZE_GATE_NO_MATCH`; gắn `size_evidence` vào kết quả; `schemas/query.js` nhận `body.size` (sai → `null`), `candidate.js` truyền `size_status`/`size_evidence`, `publicResult.js` phơi `size_evidence`, `userMessage.js` thông điệp riêng + note trung tính + note "đã loại N mã ngoài dung sai", `runtime/config.js` `features.sizeGate` (env `MORIS_SIZE_GATE_ENABLED`, default true).
- [x] **UI camera:** panel "Kích thước (mm)" trong modal camera (`index.html`) — cạnh dài nhất × cạnh ngắn nhất, nút **"Không rõ kích thước"** (mặc định bật), hint động (`cameraSizeHint`); `src/app.js` `camera.size` state + `resetCameraSize`/`setCameraSizeUnknown`/`loadSizeContractModule`/`readCameraSize` (import động, fallback inline khi module lỗi) + truyền size vào `sendMorisMessage` từ cả luồng chụp camera và tải ảnh từ máy; payload `size` gửi `/api/moris/search`; `tools/build-static.mjs` thêm `PUBLIC_MORIS_SIZE_CONTRACT_MODULE_URL`; migration proposal `supabase/migrations/20261017090000_catalogue_part_dimensions_proposal.sql` (**PROPOSAL ONLY — chờ Gate D**, RLS bật, không policy anon).
- [x] **Bằng chứng kiểm thử (không hardcode số):** focused `npx vitest run tests/moris-size-contract.test.js tests/moris-size-gate.test.js` → **28/28 pass** (chuẩn hoá L≥W; biên sàn 2mm; 404 → null; cap 100 id; parity client/server; validate query; userMessage notes). Full `npm test` → **48 files / 468 tests pass 100%** (trước M28: 46/439). `npx tsc --noEmit` exit 0. `npm run build` **51 files** exit 0 (`dist/src/moris/size-contract.js` có mặt). Production writes 0 (phiên này chỉ có 376 DELETE R2 thuộc M30 đã duyệt); chưa deploy; chưa commit.
- [x] **Hardening cuối phiên 2026-10-17 (T1/T6/BUILD-01/DOC-01):** test tích hợp orchestrator mới `tests/moris-size-gate-orchestrator.test.js` (5 test — gate sau hydrate: lọc match/unknown đúng + `size_evidence`, pool rỗng → `MORIS_SIZE_GATE_NO_MATCH`, bảng 404 → `dims_unavailable` giữ nguyên pool, tắt `MORIS_SIZE_GATE_ENABLED` / thiếu query size → không gọi dims) + 2 test fail-open `loadCandidateDims` (JSON không phải mảng / body lỗi → `null`) trong `tests/moris-size-gate.test.js`; `tools/build-static.mjs` loại `.ts` khỏi `dist` (5 file nguồn gốc không còn lộ khi F12, ghim bằng `tests/frontend.test.js`); đồng bộ `docs/moris-v6/TECH_DEBT_ROADMAP.md` + viết `docs/moris-v6/TECH_DEBT_REGISTER.md`. Bằng chứng: focused 3 file **60/60**; full `npm test` **49 files / 475 tests pass 100%**; `tsc` exit 0; build **46 files** (0 file `.ts`). Chủ dự án yêu cầu commit + push toàn bộ — đã push `6c360dd` lên main `PQVinh99-Glory/Dictionary` (remote `upstream`) + fork Codespace (`origin`).
- [ ] **M28 còn lại:** Gate D + dữ liệu đo kẹp cho bảng `catalogue_part_dimensions` (Q7 đo chậm — ưu tiên mã hay nhầm); pilot P1.2 đo size-pair precision trên ảnh thật; S2 `kim_canon_v4_*` + re-index chỉ sau A/B + Gate D (Q11).

## Test backlog — nợ không cần dữ liệu chủ dự án (2026-10-19)

- [x] **T2 — UI contract M28 (test hành vi thật):** `tests/moris-size-ui-contract.test.js` (10 test, nạp `src/app.js` thật qua `vm`): `setCameraSizeUnknown` giữ/xoá/cưỡng boolean; `cameraSizeHint` 5 trạng thái; `readCameraSize` fail-open (unknown/thiếu/sai/âm/quá cỡ → `null`), hoán vị `L ≥ W`, dấu phẩy thập phân, fallback inline khi module lỗi; `onCameraFileSelect` truyền đủ 4 tham số `sendMorisMessage`; body `/api/moris/search` chứa `size` từ tham số 4.
- [x] **Fix bug thật do T2 phát hiện:** `cameraSizeHint` parse ô trống thành `Number("")=0` nên hiện "Số đo phải lớn hơn 0" — guard chuỗi rỗng → `null` (áp cùng guard cho `readCameraSize`, kết quả method này không đổi).
- [x] **T7 + R2-01 — purge-assets/legacy `parts/`:** `tests/catalogue-delete.test.js` +2 test (parts/ legacy → 400 không xoá gì; trộn key hợp lệ → chỉ xoá key hợp lệ); tách logic thuần `tools/r2-orphan-selection.mjs` (`KEEP_PREFIXES=['parts/']`, 500/20MB) cho `tools/r2-purge-orphans.mjs` dùng lại — `tests/r2-purge-selection.test.js` (7 test) ghim `parts/` không bao giờ vào targets.
- [x] **PROFILE-01 — fallback `searchVectorIndex`:** `tests/moris-vector-search-fallback.test.js` (7 test): v6 → RPC production → legacy `cls_l2_v1`; v6+prod lỗi → `console.warn` (không im lặng); profile đã `cls_l2_v1` không gọi lặp; legacy lỗi → `[]`; clamp matchCount.
- [x] **R2-02 — quota monitor R2 read-only:** `tools/r2-usage.mjs` (thuần) + `tools/r2-quota-monitor.mjs` (`--quota-gb`, không ghi) + `tests/r2-quota-usage.test.js` (6 test fixture). Chạy thật 1 lần: **1170 objects/32.22MB/10GB (0.31%)**, front 545/26.10MB, thumb 545/4.60MB, parts 77/1.40MB — khớp audit sau purge.
- [x] **TOOL-01 đóng (nợ cũ hết hiệu lực):** `jpeg-js` không có trong `package.json`, `node_modules` lẫn mã nguồn.
- [x] **Bằng chứng:** full `npm test` → **53 files / 507 tests pass 100%** (trước: 49/475); `npx tsc --noEmit` exit 0; `npm run build` 46 files (tools/tests mới không lọt `dist`); production writes 0 (1 GET read-only); chưa deploy; chưa commit.
- [ ] **Còn lại (blocked):** T3/T4 — chủ dự án quyết định 2026-10-19 **bỏ pilot, kiểm chứng thực tế trên production** (không đo tập 20 ảnh/4 marker nếu chỉ để test); T5 đã xong phần test mapping; EVAL-01; M18-01/M22-01; M26 release; M29-01 chờ dữ liệu thật; DEPLOY-01 chờ duyệt.

## Gate D — Size editor + Tracking box vuông (M28/M27) — 2026-10-19

- [x] **Chủ dự án duyệt 4 điểm:** (1) Áp Gate D — dùng bảng `catalogue_part_dimensions` + RPC mới; (2) form editor chỉ nhập **dài × rộng** (Q6); (3) **admin**, `method='user'`; (4) khung **live + tap chọn vật**, giữ nguyên luồng chụp.
- [x] **Migration thật `supabase/migrations/20261019090000_catalogue_part_dimensions_gate_d.sql`:** bảng dims kế thừa proposal (RLS bật, không policy anon) + mở rộng trigger `kim_cleanup_vectors_on_delete` dọn dims theo mọi đường xóa + RPC `app_upsert_part_dimensions` (admin, validate 0 < mm ≤ 5000, tự hoán vị L ≥ W, lấy code/part_id từ `image_library`) + `app_get_part_dimensions` (admin) + grants anon/authenticated/service_role.
- [x] **Size trong editor (`src/app.js` + `index.html`):** 2 ô "Kích thước (mm)" cạnh dài × cạnh ngắn + hint động; `loadEditorSize` (fail-soft khi bảng chưa sẵn sàng), `readEditorSize` (trống cả 2 → không lưu; thiếu/sai/quá cỡ → chặn), `savePart` validate **trước upload** và gọi RPC dims **sau metadata** (lỗi RPC dừng lưu, không im lặng); `openEditor` nạp size đã lưu.
- [x] **Khung vuông tracking (M27):** `camera.lock.box` + `subjectBoxToPercent` (bbox → %, clamp biên) cập nhật mỗi mẫu 450ms trong `_sampleCameraLockFrame`; overlay live trong camera modal — xanh "Đã nhận diện" khi đạt readiness, vàng "Đang bám vật thể" khi đang bám; `pointer-events-none` giữ tap-to-lock; `resetCameraLock` xoá box.
- [x] **Tests:** `tests/moris-size-editor-contract.test.js` (12), `tests/moris-camera-lock-box.test.js` (5), T5 row thật `method/confidence` trong `tests/moris-size-gate.test.js`, 2 marker mới trong `tests/frontend.test.js`.
- [x] **Bằng chứng:** focused file mới 17/17; full `npm test` **55 files / 525 tests pass 100%** (trước 53/507); `npx tsc --noEmit` exit 0; `npm run build` 46 files; production writes 0; chưa deploy; chưa commit.
- [x] **Áp production 2026-10-19 (chủ dự án ủy quyền agent chạy `npx supabase db push`):** review khô 12 migration pending bằng schema dump read-only — 5 bản đã áp thủ công nhưng thiếu history (`1000030000`/`1000050000`/`1000060000`/`1000070000`/`1000130000`) → `migration repair --status applied`; push thật 4 bản: `2026101000040000` (reset is_symmetric, no-op), `2026101200020000` (cascade delete vectors — gặp **42P13** do `app_delete_part` remote tạo tay kiểu TABLE, đã thêm `DROP FUNCTION IF EXISTS` vào migration trước CREATE), `20261017090000` (proposal), `20261019090000` (Gate D). 3 bản Moris V6 (`16024931`/`16033020`/`16040525`) giữ nguyên chưa áp theo `DB_MIGRATION.md` (M22 NO-GO). Xác minh: `migration list` local=remote (trừ 3 bản V6 cố ý); probe read-only production: bảng `catalogue_part_dimensions` → 200, `app_get_part_dimensions`/`app_upsert_part_dimensions` tồn tại (token sai → UNAUTHORIZED). Version **6.1.3 → 6.2.0**; full `npm test` 55 files/525 pass; tsc 0; build 46 files.
- [ ] **Nghiệm thu thật (thay pilot — chủ dự án quyết định 2026-10-19):** chủ dự án test trực tiếp trên production 1 mã: editor nhập size → lưu → mở lại thấy size; **bỏ pilot 20 ảnh/4 marker** nếu chỉ phục vụ test T3/T4 (không đo, không bịa số liệu).

## Mẫu lỗ phổ biến + Moris Phase 1 tham chiếu định dạng lỗ — 2026-10-19

- [x] **Chủ dự án chốt 6 điểm:** menu "Mẫu lỗ phổ biến" cho **mọi user đăng nhập**; gom biến thể `(1)/(2)` về tên chuẩn, "Lỗ oval cong" là loại riêng; thứ tự tròn → vuông → oval → oval cong → dài → chữ nhật → chữ L → tam giác → răng cưa → gài móc; tag RAG **cả hai tuần tự** (nhãn + boost mềm trước, vector tham chiếu chỉ khi đo còn lệch); Moris được nói tên định dạng khi đủ cơ sở; mẫu mới qua migration/script (không trang admin). Yêu cầu gốc: "không khắc khe — chỉ tham khảo"; UI **không modal**: header + list ảnh kèm tên lỗ.
- [x] **R2 + DB:** 14 ảnh `Simple/` → `catalogue-images/hole-samples/<slug>.png` (verify list 14 object); migration `supabase/migrations/20261019180000_catalogue_hole_samples.sql` — bảng `moris_hole_samples` (slug chuẩn, `r2_key` unique, `sort_order`, `active`, trigger `updated_at`, RLS select authenticated, **không policy ghi**) + seed 14 dòng idempotent — **đã push production 2026-10-19**; verify: service probe 14 rows đúng thứ tự, anon `[]` (`content-range */0`).
- [x] **UI (`index.html` + `src/app.js`):** nút menu "Mẫu lỗ phổ biến" sau Quản lý người dùng (không gate admin) + trang full-screen `v-if="holeSamples.open"` (z-87, header + back arrow, list `img` + tên); `loadHoleSamples` query `moris_hole_samples` active theo `sort_order`; ảnh qua `/api/media` (session). Version **6.4.0**.
- [x] **Moris Phase 1 (`hole_format_ref_v1`, boost-only, flag OFF mặc định):** module `functions/_lib/moris/v5/retrieval/holeFormatReference.js` (10 tag + tên Việt; `FORMAT_PATTERNS` — "dài" **bắt buộc ngữ cảnh "lỗ"** tránh nhầm "thân dài 20mm"; `holeFormatsFromCounts`; `applyHoleFormatBoost` chỉ gắn `hole_format_score:1/hole_format_available/hole_format_match` lên ứng viên khớp, **không phạt** ứng viên khác); `scoreFusion` signal `hole_format` w.05; `query.js` `normalizeHoleFormats` fail-open; `orchestrator` gắn `hole_format_evidence` khi `MORIS_HOLE_FORMAT_BOOST_ENABLED=true`; `userMessage` note trung tính nêu tên định dạng; camera bin `slot` (aspect ≥ 1.7, fill ≥ 0.88, A4 ≤ A2×1.25, radiusCV ≤ 0.45 — phân biệt stadium vs ellipse sau closing) + `counts.slot`; app.js tóm tắt "n dài" + payload `hole_formats` từ `captureEvidence`.
- [x] **Bằng chứng kiểm thử:** focused mới `tests/moris-hole-format-reference.test.js` 15/15, `tests/moris-hole-format-orchestrator.test.js` 5/5 (boost lật near-tie .938/.94 khi ON, OFF không đổi), `tests/moris-hole-format-ui-contract.test.js` 4/4; `tests/moris-capture-subject-lock.test.js` **25/25** — eval tổng hợp M27 **IoU 0.9996 / shape accuracy 100% (10/10)**; full `npm test` **59 files / 569 tests pass 100%**; `npx tsc --noEmit` exit 0; `npm run build` 46 files; production writes: 1 migration + 14 object R2.
- [ ] **Còn lại:** bật flag `MORIS_HOLE_FORMAT_BOOST_ENABLED` **chỉ sau khi đo trên ảnh thật** (blocked bởi EVAL-01 — `tools/eval-m27-real-photos.mjs` hiện chỉ có nhãn circle/square/oval, chưa có nhãn người cho "dài"); chủ dự án test production menu Mẫu lỗ + size 1 cạnh.

## Bổ sung mẫu lỗ "Lỗ bán oval" — 2026-10-20

- [x] **Chủ dự án chốt:** thêm ảnh `Simple/lỗ bán oval.png` thành định dạng riêng `ban_oval`; xếp sau "Lỗ oval cong" (`sort_order` 45); crop sát vùng lỗ + resize ~600px; phạm vi phiên này chỉ code + migration + test, **không** push DB/upload R2/deploy.
- [x] **Ảnh mẫu:** decode PNG gốc 1448×1086 (652KB, viền đen lớn) → crop bbox chủ thể 1043×750 + pad 4% → resize area-average **600×444** (130KB), giữ style trắng-trên-nền-đen như 14 mẫu cũ; bản gốc lưu `/tmp/opencode/ban-oval-original.png`.
- [x] **Migration:** `supabase/migrations/20261020072401_hole_sample_ban_oval.sql` — thêm 1 dòng `('ban-oval', 'Lỗ bán oval', 'ban_oval', 'hole-samples/ban-oval.png', 45)` idempotent theo slug; không đổi schema/RLS/policy.
- [x] **Từ điển Moris:** `holeFormatReference.js` nâng lên **11 tag** (`ban_oval` sau `oval_cong`), tên "Lỗ bán oval"; `FORMAT_PATTERNS` nhận "bán oval"/"semi oval"/"half oval" trước pattern oval chung → `inferFormatTagsFromText('Lỗ bán oval') = ['ban_oval','oval']` (nhất quán cách xử lý `oval_cong`). Không thêm bin camera mới vì classifier hiện tại chỉ có tròn/vuông/oval/dài.
- [x] **Audit + test:** `tools/audit-moris-hole-samples.mjs` thêm mẫu vào `EXPECTED` → **15/15 text PASS**; geometry 0/9 giữ nguyên lý do ảnh mẫu là crop miệng lỗ. Cập nhật `tests/moris-hole-format-reference.test.js` (11 tag + suy từ text) và `tests/moris-hole-samples.test.js` (Simple 15 ảnh/11 định dạng + contract migration mới).
- [x] **Bằng chứng:** focused 5 files **57/57**; full `npm test` **62 files / 610 tests pass 100%**; `npx tsc --noEmit` exit 0; `npm run build` 47 files; version **6.6.0**; production writes 0.
- [x] **Đồng bộ production 2026-10-20 (chủ dự án yêu cầu):** `supabase db push` áp `20261020072401` (chỉ migration này; 3 migration Moris V6 vẫn pending cố ý) — probe service_role thấy **15 rows** đúng thứ tự, `ban-oval` at `sort_order 45`; anon `[]` giữ RLS. Upload R2 `catalogue-images/hole-samples/ban-oval.png` (130.305 bytes, `content-type image/png`, `cache-control immutable`) — list + public URL trả 200. Frontend menu đọc DB động nên đã thấy mẫu thứ 15; chưa deploy Functions (code `ban_oval` mới chưa lên production).
- [ ] **Còn lại:** deploy Cloudflare Pages Functions để production nhận `ban_oval` trong `holeFormatReference`; flag `MORIS_HOLE_FORMAT_BOOST_ENABLED` vẫn OFF — chỉ bật sau đo trên ảnh thật (EVAL-01).
- [x] **Review RAG (2026-10-20):** hiện **chưa phải RAG** theo nghĩa retrieve-and-generate. `moris_hole_samples` chỉ được `src/app.js` đọc cho menu; server Moris dùng từ điển hardcode `holeFormatReference.js` (11 tag), không đọc bảng, không embed ảnh mẫu, không inject sample vào prompt/reasoning. `MORIS_HOLE_FORMAT_BOOST_ENABLED` mặc định **OFF**; khi ON chỉ cộng 0.05 cho ứng viên có `identifying_features` chứa tag khớp (boost-only, không phạt). Camera chỉ nhận tròn/vuông/oval/dài; các dạng khác (kể cả `ban_oval`) chỉ nhận qua text. Muốn thành RAG thật: Phase 2 đọc DB làm nguồn chuẩn + inject evidence vào reasoning/rerank, đo trên nhãn ảnh thật rồi mới bật flag; Phase 1 DB taxonomy chưa đưa lên main.
- [x] **Main release 2026-10-20:** chỉ đưa mẫu **Lỗ bán oval** lên main (ảnh + migration `20261020072401` + từ điển 11 tag + test/audit), bump version **6.6.0**; **không** đưa Phase 1 DB taxonomy lên main. Phase 1 được giữ riêng ngoài main, không ảnh hưởng production.

## Cải tiến UI vận hành — yêu cầu chủ dự án #7–#9 (2026-10-19)

- [x] **#7 Nhảy nhanh số trang catalogue:** ô "Tới trang..." + nút "Đi" ngay cạnh Trang trước/Sau (`jumpToPage()`): số nguyên ≥ 1, sai → cảnh báo giữ nguyên trang, trùng trang hiện tại → không gọi lại dữ liệu, render đúng cửa sổ 36 mã; cuộn về đầu danh sách sau khi nhảy.
- [x] **#8 Sửa chuỗi hướng dẫn modal camera:** (1) hint đầu → "Điều chỉnh camera sao cho khung tracking vừa khớp chủ thể"; (2) nhãn quét → "Đang quét, tái tạo vector và nhận diện vật thể..."; (3) tiến trình tải → "Đang dựng Harness: n% (85MB)..." (4 biến thể: moris.status, statusText, scanStatus, step "DỰNG HARNESS"); (4) bullet khung → "nền TRẮNG"; (5) bullet khóa chủ thể → "Chờ tracking khóa chủ thể trong khung vàng rồi chụp."; (6) bullet ảnh lớn → thêm "nếu không tìm ra bằng tracking hãy bấm..."; (7) bullet 3 lớp → "Nhập chiều dài để Harness sàng lọc chuẩn hơn".
- [x] **#9 Fix nhập size trong modal camera + tag đỏ:** nguyên nhân gốc — ô size `:disabled="camera.size.unknown"` mà mặc định `unknown=true` → khóa cứng, không gõ được. Đã gỡ disabled (gõ tự `setCameraSizeUnknown(false)`, giữ tính tùy chọn — không bắt buộc); thêm tag đỏ "Nhập size để tăng tỷ lệ sàng lọc" (computed `cameraSizeNeedsInput`) hiện khi chưa có cạnh dài hợp lệ, tự biến mất khi nhập đủ (kể cả partial 1 cạnh vẫn lọc được).
- [x] **Bằng chứng:** focused 42/42 (paging +3 test jumpToPage; camera-lock-box +2 test text mới + ô size/tag đỏ; size-ui +1 test `cameraSizeNeedsInput` 7 trường hợp); full `npm test` **59 files / 575 tests pass 100%**; `npx tsc --noEmit` exit 0; `npm run build` 46 files; version **6.5.0**. Production writes 0; chưa deploy; **chưa commit** (chờ chủ dự án).

## Khôi phục tiến trình làm việc dang dở (ses_eae5) — 2026-10-19

- [x] **PROFILE-01 (Đọc read-only production vector theo profile):**
  - Xác minh trực tiếp DB production qua PostgREST service key: Bảng `catalogue_image_vectors` có **2.180 vector active**, 100% `canon_rgb_v2`:
    - 1.089 rows: profile legacy `cls_l2_v1` (`onnx-community/dinov2-small` ef1fb10, `kim_canon_v2`).
    - 1.091 rows: profile `hybrid_gem3_edge_55_45_pseudorgb_u8_v1` (`onnx-community/dinov2-small` ef1fb10, `kim_canon_v3_letterbox`).
  - Code mặc định `config.js` và `browserDinov2.js` là profile hybrid; local `.env` đặt `cls_l2_v1`.
  - Fallback an toàn: `functions/_lib/moris/v5/vector/search.js` tự động fallback sang `cls_l2_v1` nếu profile cấu hình trả 0 kết quả (7 test `tests/moris-vector-search-fallback.test.js`).
  - API `/api/moris/search` từ chối query embedding profile mismatch (HTTP 400).
  - Độ phủ text: Bảng `image_library` có 544 mã, 72 mã (13.2%) có mô tả lỗ trong `identifying_features`, riêng "dài" chỉ có đúng 1 mã duy nhất.
- [x] **EVAL-01(a) (Giải pháp review 57 hard-negative đơn giản, hiệu quả):**
  - Nâng cấp `tools/review-moris-hard-negatives.mjs` tải ảnh trực tiếp từ R2 công khai (`pub-fe997ecbd0714682b10cba684d175ac8.r2.dev`) thay vì phụ thuộc thư mục private local bị thiếu.
  - Tạo trang review HTML trực quan `evaluation/moris-v6/hard-negative-review-sheet.html`: hỗ trợ mở offline trực tiếp trên trình duyệt, có 3 nút bấm (🟢 Dễ nhầm / 🔴 Khác biệt / ⚪ Bỏ qua) + ghi chú, tự lưu `localStorage` thời gian thực, có nút tải file JSON kết quả.
  - Tích hợp server nội bộ `npm run moris:review` (`node tools/review-moris-hard-negatives.mjs --serve`) chạy tại `http://localhost:3333` có API lưu trực tiếp về file `hard-negative-labels.json`.
  - Bổ sung lệnh CLI `--apply-labels` nạp nhãn người vào queue. Đã viết 3 test trong `tests/moris-review-tool.test.js` pass 100%.
- [x] **EVAL-01(c) (Xóa an toàn `image 2/` bảo mật + ghi nhận skip holdout):**
  - Chuyển fixture test `tests/png-decode.test.js` sang dùng `Simple/lỗ chữ L.png` (1086x1448).
  - Bổ sung guard an toàn `existsSync` trong `tools/eval-m27-real-photos.mjs` và `tools/check-moris-camera.mjs`.
  - Thêm `image 2/` vào `.gitignore`.
  - Dùng `git rm -r "image 2"` dọn dẹp sạch sẽ 125 file (78MB) khỏi git tracking và disk.
  - Ghi nhận quyết định chủ dự án: Tạm thời SKIP holdout đóng băng mới cho đến khi có bộ ảnh chụp chuẩn (mục b: chủ dự án sẽ bổ sung ảnh chuẩn cho catalogue, hiện mới có 3421750001 là đủ 5 ảnh).
- [x] **EVAL-01(d) (Audit thật Simple/ làm tham chiếu harness):**
  - Tạo và chạy công cụ thực tế `tools/audit-moris-hole-samples.mjs`.
  - Kết quả từ điển text: 14/14 (100% PASS) định dạng khớp từ điển `holeFormatReference.js`.
  - Kết quả hình học camera: 0/9 PASS vì ảnh `Simple/` là ảnh crop trực tiếp miệng lỗ trên nền, không phải linh kiện kim khí chứa lỗ bên trong (`extractEnclosedHoles` tìm inner holes trong vật thể).
  - Đánh giá kiến trúc & vector: Tuân thủ Hiến pháp `AGENTS.md` (chỉ Vector Center ghi index, không chèn vector ngoài vào DB); giữ 14 mẫu làm visual reference và regression fixtures; cờ boost Phase 1 giữ OFF an toàn.
- [x] **R2-01 (Đóng theo quyết định giữ nguyên):** Giữ nguyên các asset R2 theo quyết định của chủ dự án ("2. không cần xóa skip việc này").
- [x] **Bằng chứng kiểm thử tổng thể:**
  - Full `npm test` → **60 files / 578 tests pass 100%**.
  - `npx tsc --noEmit` exit 0.
  - `npm run build` → 46 files sạch sẽ.
  - Version: **6.5.0**.

## Khai báo cặp dễ nhầm lẫn (@mention) trong Ghi chú chống nhầm lẫn & Hard-Negative Moris (2026-10-19)

- [x] **Trích xuất & đối sánh cặp dễ nhầm lẫn (confusingPairs.js):**
  - Tạo `functions/_lib/moris/v5/retrieval/confusingPairs.js` và `src/moris/retrieval/confusingPairs.js`.
  - Hàm `extractConfusingSkus(text)`: Trích xuất danh sách SKU sau ký tự `@` theo regex `/@([0-9a-zA-Z_-]{4,20})/g`.
  - Hàm `arePartsConfusingPair(partA, partB)`: Kiểm tra quan hệ dễ nhầm lẫn đối xứng hai chiều (A nhắc @B hoặc B nhắc @A).
  - Hàm `evaluateHardNegativeCondition({ partA, partB, dimsA, dimsB, tolerance, floorMm })`: Đánh giá điều kiện kích thước tương đồng (dung sai 5% hoặc sàn 3mm) nhưng khác biệt chi tiết lỗ; fail-open nếu thiếu số đo kích thước.
  - Hàm `detectConfusingPairInTopCandidates(candidates, topN)`: Quét Top 3 ứng viên trong kết quả xếp hạng Moris để phát hiện cặp dễ nhầm lẫn.
- [x] **Cảnh báo chuyên gia trong Moris (userMessage.js, publicResult.js & orchestrator.js):**
  - Tích hợp `detectConfusingPairInTopCandidates` vào `functions/_lib/moris/v5/orchestrator.js`.
  - Đính kèm `confusing_pair_evidence` vào kết quả tìm kiếm và danh sách cảnh báo `warnings`.
  - Hàm `confusingPairEvidenceNote` trong `userMessage.js`: Thêm ghi chú cảnh báo thân thiện `"⚠️ Lưu ý: Mã ... và ... là cặp dễ nhầm lẫn (kích thước tương đương, khác chi tiết lỗ). Anh kiểm tra kỹ vị trí/kích thước lỗ nhé."`
  - Truyền `confusing_pair_evidence` qua `publicResult.js` cho client và debug payload.
- [x] **Giao diện Editor Autocomplete @mention (index.html & src/app.js):**
  - `src/app.js`: Thêm `catalogueCodes: []`, `mention: { active: false, query: '', highlightIndex: 0, suggestions: [], matchStart: -1, matchEnd: -1 }` trong `editor` data.
  - Hàm `loadEditorCatalogueCodes()`: Tự động tải và cache danh sách mã catalogue từ Supabase (phân trang an toàn đến 5.000 mã).
  - Hàm `filterMentionSuggestions(query)`: Lọc mã theo thứ tự từ trái sang phải: ưu tiên `startsWith(query)`, sau đó đến `includes(query)`, loại trừ mã hiện tại đang sửa. Khi query rỗng (@) hiển thị 8 mã đầu tiên.
  - Các hàm điều khiển `onConfusingNoteInput`, `onConfusingNoteKeydown` (ArrowUp/Down, Enter/Tab, Escape), `onConfusingNoteBlur`, `selectMention(item)` chèn `@<MÃ> ` vào đúng vị trí con trỏ và đưa focus trở lại.
  - `index.html`: Thêm badge "Gõ @ để gắn mã dễ nhầm" và dropdown gợi ý nổi (floating menu) với giao diện bo tròn, bóng đổ, hiển thị icon `@`, mã SKU và đặc điểm nhận dạng.
- [x] **Kiểm thử & Xác minh toàn diện:**
  - Viết `tests/moris-confusing-pairs.test.js` (19 test cases) kiểm tra trích xuất mention, đối xứng quan hệ, dung sai kích thước, phát hiện trong top candidates, format tin nhắn.
  - Viết `tests/moris-confusing-note-mention.test.js` (11 test cases) kiểm tra regex trigger, ưu tiên khớp từ trái sang phải, loại trừ self-code, mô phỏng chèn tại con trỏ.
  - Toàn bộ test suite: **62 test files / 608 tests PASS 100%** (tăng thêm 30 test mới).
  - `npx tsc --noEmit` exit 0 (không lỗi TypeScript).
  - `npm run build` thành công: 47 file build static vào `dist/`.


## Khảo sát tính khả thi Plan_uplevel (2026-10-21)

- [x] Đọc state/plan/kiến trúc và đối chiếu capture, preprocessing, retrieval, size, feature, fusion, evaluation với mã nguồn.
- [x] Lập báo cáo `docs/moris-v6/UPLEVEL_FEASIBILITY_REVIEW.md`; ghi nhận yêu cầu chủ dự án: bắt buộc chụp trọn vật.
- [x] Kiểm chứng local: npm test ngoài sandbox 62 files/610 tests pass; tsc exit 0; build exit 0/47 files; lưu log test.
- [x] Cập nhật state; không sửa code/Plan_uplevel, không DB/vector write/deploy/commit.
- Kế hoạch U0–U7 đã được thay bởi `Plan_pipeline_moris.md` (P00–P12); không đánh dấu implementation cũ là hoàn thành.

## Khảo sát live ca 3448000001 (2026-10-21)

- [x] Xem image.png và image copy.png; xác nhận bằng chứng UI size180mm/top10 thiếu target.
- [x] SELECT Supabase và API GET qua .env chỉ đọc: coverage, target vectors/dims, self-query RPC và SELECT size-compatible; lưu evidence.
- [x] Bổ sung báo cáo section9 và state; không đổi code/profile/DB/vector, không deploy/commit.
- [ ] Xác minh request/runtime profile phiên camera lỗi và replay ảnh gốc khi có — chuyển theo dõi tại P01/P07/P10 của plan mới.

## Đánh giá lại hướng uplevel: length-first, CLS và hybrid (2026-10-21)

- [x] Ghi nhận nghiệp vụ: cạnh dài ưu tiên, cạnh ngắn hỗ trợ/không bắt buộc; không chờ đủ hai cạnh để làm recall.
- [x] Đối chiếu implementation CLS/hybrid và provenance M22; xác nhận global là hybrid, chưa có A/B công bằng CLS vs hybrid.
- [x] Lập UPLEVEL_DIRECTION_DECISION.md: hybrid baseline kỹ thuật, CLS đối chứng; đề xuất điều chỉnh U0–U7.
- [x] Focused tests 3 files/39 tests pass; lưu evidence và cập nhật state.
- [ ] Triển khai thay đổi kế hoạch/code: chưa bắt đầu; chưa đổi profile, production hoặc tạo vector.

## Nghiên cứu sâu concept capture/hậu kỳ/từ điển lỗ (2026-10-21)

- [x] Đối chiếu code tracking/crop/encoder/mask/hole dictionary; nghiên cứu landscape, contour, RAG và mô hình nhận dạng.
- [x] Ghi quyết định owner: cầm ngang Android+iPhone Safari; lỗ kín+khoét hở; length manual lệch<=5% được duyệt (code chưa đổi).
- [x] Lập HARNESS_CAPTURE_HOLE_RESEARCH.md; focused5 files/65 tests pass; lưu pure-function evidence count loss và manual10% hiện hành.
- [x] Cập nhật state; không sửa ứng dụng/Plan_uplevel, không train/DB/vector/deploy.
- [x] Đã rõ quy ước răng cưa và policy >5%/top10 rescue theo owner; chưa thực thi landscape/rebuild/model.
- [x] Owner làm rõ răng cưa hiếm/không biến thể: tương đương mẫu là đủ, không đếm từng răng.
- [x] Owner chốt: đủ10 ứng viên hợp lệ trong5% thì không lấy nhóm phụ; thiếu mới thêm cứu sinh có note+score, không pad rác.

## Plan triển khai hiện hành: Plan_pipeline_moris.md (2026-10-21)

- [x] Loại bỏ Plan_uplevel.md theo yêu cầu owner.
- [x] Tạo Plan_pipeline_moris.md: nghiệp vụ đã chốt, baseline, contracts, dependencies, file/test/evidence/rollback và gate triển khai.
- [x] Full npm test 62 files/610 tests pass; kiểm tra file/link/Markdown/JSON và git diff --check.
- [x] Cập nhật RAM state và điểm vào; không thay code hoặc production.

- [x] P00 — Contract, schema dữ liệu và metric; ngưỡng release pending calibration, owner nghiệm thu camera production.
- [ ] P01 — Baseline/profile audit và evidence.
- [ ] P02 — Camera landscape và mapping.
- [ ] P03 — Khóa trọn vật và crop frame gốc.
- [ ] P04 — Hậu kỳ có bằng chứng.
- [ ] P05 — Dictionary/lỗ kín/khoét hở/facts.
- [ ] P06 — Length5% shortlist sớm.
- [ ] P07 — Hybrid parity xuyên pipeline.
- [ ] P08 — Scoped matching/union/keyed hydrate.
- [ ] P09 — Ranking và top10 primary/rescue.
- [ ] P10 — Evaluation và nghiệm thu thiết bị thật.
- [ ] P11 — Model bổ sung nếu có bằng chứng cần.
- [ ] P12 — Rebuild/release chỉ khi được giao phạm vi cụ thể.
- [ ] P13 — Hậu kiểm `catalogue_image_vectors.hole_count = 0` sau cùng: phân biệt zero thật, unknown/legacy và lỗi tách lỗ theo ảnh/profile; read-only trước, owner GT sau.

### Triển khai pipeline — checkpoint cục bộ 2026-10-21

- [x] Owner nghiệm thu production: mã `3448000001` lên Top 1 cả khi có và không có size (báo cáo 2026-10-21). Ghi nhận kết quả một mã, không thay thế benchmark nhiều mã/thiết bị của P10.

- [x] UI Moris: thay biểu tượng não ở header chat box bằng avatar người dùng cung cấp; ảnh nguồn được lưu trong `assets/` và được build sang `dist/`. Browser render 44×44 trên viewport dọc/ngang; 69 file/665 test pass. Nghiệm thu trực quan trên thiết bị thật chờ owner.

- [x] P00 hoàn tất contract/schema: owner bỏ gate 122 mã đã xóa và queue57 lịch sử; snapshot production SELECT 2026-10-21 02:50:18 UTC: 545 mã, 6 có length, 0 width, hybrid active 1103 vector/544 record, CLS active 1069/534. Manifest camera có validator/hash ảnh+mask; ảnh và thiết bị thật chờ owner nghiệm thu production. 64 file/622 test pass, tsc0, build47; không ghi DB/deploy.
- [x] P01 phần diagnostics: debug admin ghi RPC thực gọi/ok/error, giữ profile khi fallback; audit exact object-key hybrid 544/545 front/thumb, 5/5 back, 10/10 detail (2026-10-21 02:53:12 UTC). P01 chưa hoàn tất vì thiếu freshness byte/ETag, raw camera replay và trace frontend đầy đủ; full 64 file/622 test pass, tsc0, build47.
- [ ] P01 baseline production đang biến động: SELECT 02:56:01 UTC chỉ còn 44 hybrid active/19 record, 0 CLS (so với 1103 hybrid +1069 CLS lúc 02:50). Chờ owner xác nhận rebuild/ổn định rồi đo lại; không dùng snapshot trước làm accuracy baseline.
- [x] P02 phần code lifecycle: owner xác nhận đang rebuild hybrid và cho tiếp phase. Camera đóng/đổi giữa lúc getUserMedia/play/fullscreen pending không bật lại luồng cũ; reset tracking khi đổi stream; orientation lock từ chối vẫn dùng được. Focused 5/5; full npm test 65 file/627 test pass, tsc0, build47, diff check pass. P02 máy thật/safe-area/keyboard chưa nghiệm thu.
- [x] P02 bàn phím/safe-area: hướng máy đọc orientation API trước viewport, keyboard resize không reset tracker; overlay chừa notch/safe area. Focused lifecycle 7/7; full 65 file/629 test pass, tsc0, build47, diff check pass. Nghiệm thu Android/iPhone thật chờ owner trên production.
- [x] P03 phần code: query crop từ mask bbox final frame + lề 8%, upload qua still-image quality gate, invalid upload không embed/search và camera restart; provenance schema-bounded chỉ debug admin, hole count cũ không tái dùng. Full 66 file/636 test pass, tsc0, build47, diff check pass. P03 phase pending GT ảnh thật/false-ready/false-reject do owner test production.
- [x] P04 phần diagnostics: đối chiếu số lỗ kín từ capture và optical, status agree/mismatch/unknown; không đổi pixel canonicalizer/profile. Mask IoU/chói/trích artifact ảnh thật còn pending.
- [x] P05 phần facts: query count chính xác chỉ cộng boost nếu identifying_features ghi đúng count, oval leaf không nhân đôi parent, stale/unreliable capture không gửi hole facts. Feature flag boost vẫn OFF; nhận dạng khoét hở và benchmark ảnh thật còn pending.
- [x] P06/P08 phần code local: đọc length shortlist 5% trước ANN, bounded pagination, session/filter intersection; scoped RPC SQL chỉ là proposal, flag OFF chờ review/deploy. Local test target ngoài global ANN vào pool qua scoped cosine; chunk dims >100. Chưa có production recall/latency.
- [x] P09 phần code: primary within5% → rescue thiếu size → rescue ngoài5% chỉ khi thiếu Top10; note và score thật, API/UI giữ thứ tự nhóm. Full npm test 67 file/642 test pass, tsc0, build47; nghiệm thu hard-negative/owner production còn pending.
- [x] P07 code audit hybrid và P08 keyed hydration proposal: spatial patch/no CLS fallback; ba RPC SQL chỉ ở docs, cờ scoped/keyed OFF; test 101 ID chunk/orphan/session filter. Full 69 file/650 test pass, tsc0/build47/diff check. Browser/index byte parity và RPC EXPLAIN/deploy pending.
- [x] P10–P12 phần tự kiểm/prep: owner acceptance protocol và release review packet đã soạn; P11 giữ conditional vì thiếu GT. Local E2E Playwright+Postgres không chạy do fixture Docker `moris-v6-test` vắng; production camera/holdout, migration, release pending owner.
- [x] P13 khảo sát cuối bằng SELECT/R2 read-only: snapshot 1.110 hybrid vectors/236 zero, 68 mã front>0 nhưng thumb=0; tái hiện hai asset có optical đếm được 7/5 nhưng `subject_touches_edge` làm count NULL, RPC cũ COALESCE thành 0. Báo cáo `docs/moris-v6/evidence/pipeline-p13-hole-zero-audit.md`; false-zero toàn bảng/GT và sửa production pending.
- [x] P13 bản sửa local: replay 236/236 asset zero alpha và 58 đối chứng từ R2; sửa alpha chạm mép, giữ camera opaque gate, nhận lỗ oval lớn kín, loại khoét hở; 236/236 nay có count/ratio/centroids local, 33 raw/canonical lệch cần GT. API không fallback writer legacy; Vector Center cảnh báo dữ liệu hình học legacy/thiếu. Không tự backfill production; xem bằng chứng P13 và CSV.
- [x] P13 pilot/batch an toàn: Trung tâm Vector AI có chế độ “Chỉ sửa ảnh lỗ 0 cũ” chỉ chọn active vector thiếu provenance và có bộ legacy `hole_count=0`, `aspect_ratio=1`, `hole_centroids=[]`; preview chính xác trước xác nhận, xử lý từng ảnh qua cùng đường ghi đã có. Kiểm thử 69 file/662 test pass, tsc0, build47; chưa có nhãn GT để tuyên bố độ chính xác.
- [x] P13 pilot production do owner chủ động chạy 5 ảnh/3 mã: SELECT chỉ đọc xác nhận `3445170001` 2/2, `3433410101` 5/5, `3430590001` thumb 2; đủ provenance/ETag, active vector 1.110, exact legacy zero còn 231. Đây là output thuật toán, chưa phải ground truth; owner bỏ yêu cầu gán nhãn thủ công toàn catalogue trước batch, chỉ mở ca sai cụ thể sau này.
- [x] Trung tâm Vector AI: sửa filter bị bỏ lượt tìm khi bảng đang tải bằng sequence mới nhất; trang đầu hiện sớm, ba trang tiếp theo tải song song có giới hạn, batch chờ danh sách đủ. Chromium fixture xác nhận tìm/xóa tìm và tải 80 mã; nhãn Moris đổi sang Harness theo owner. Local full 69 file/663 test pass, tsc0, build47. Lỗi sách đỏ sau lưu chưa tái hiện; owner sẽ cung cấp ca cụ thể sau, không sửa phỏng đoán.
- [x] P13 batch production do owner xác nhận: giao diện báo 231 ghi/0 bỏ qua/0 lỗi; SELECT chỉ đọc 06:28 UTC xác nhận đủ 236/236 ảnh zero gốc có provenance/ETag và hình học hợp lệ, khớp replay count/ratio/số tâm 236/236, active 1.110/546 mã không đổi, zero legacy còn 0. Chưa có GT để kết luận accuracy; 33 ca raw/canonical khác nhau và 874 vector cũ chưa có provenance theo dõi riêng.
- [x] P13/Release rehearsal trước production: PostgreSQL 17/pgvector fixture chạy `check-moris-vector-db`, `check-moris-provenance-db`, `check-moris-catalogue-db`, `check-moris-scoped-db` đều pass; scoped/keyed SQL được đóng gói migration và đối chiếu schema/index production read-only. Không mở port test DB.
- [x] Release DB 2026-10-21: backup schema+data public ngoài repo, Supabase CLI dry-run đúng 4 migration, `db push --include-all --skip-vault` exit0; post-check 1.110 active/546 SKU, 236 zero cũ/0 provenance, anon writer/scoped deny, scoped 180±5% trả hai view 3448000001. Đã bật scoped/keyed flags cho main; owner replace vector cũ/test camera sau deploy.
- [x] Release main 2026-10-21: `1c159a2` push `upstream/main` (`PQVinh99-Glory/Dictionary`), Cloudflare Pages production deployment `f1476641-356f-4f50-aa7c-797efc0796ea` báo success đúng SHA; flags scoped/keyed production=true. Nghiệm thu camera/ranking và replace 236 vector legacy qua Trung tâm Vector AI còn pending owner.
- [x] Final local verification sau P13: `npm test` 69 file/651 test PASS; `npx tsc --noEmit` exit0; `npm run build` 47 file; `git diff --check` exit0. Không commit, deploy, migration hoặc ghi vector production.
- [x] Audit read-only release sau owner rebuild: 1.110 vector/546 mã phủ exact asset 1.110/1.110, 236 hàng zero thuộc 152 mã; 7/546 mã có cạnh dài **đủ smoke test size, không bắt buộc size để tìm bằng ảnh**. Ba migration V6 còn pending; scoped/keyed RPC ngoài migration; Pages kết nối `PQVinh99-Glory/Dictionary` main/upstream ở `b5b65c2`. NO-GO cho DB push toàn bộ và deploy pipeline vì contract/migration chưa ready; xem `docs/moris-v6/evidence/pipeline-release-readiness-audit-2026-10-21.md`. Không ghi production.
- [x] P00: owner xác nhận cạnh dài 5% theo query, không sàn mm; ghi decision record và metric/dataset blockers.
- [x] P01: debug API chỉ hiện cho phiên admin đã xác thực khi bật cờ nội bộ; thêm monotonic stage timing, tách encode khỏi vector RPC.
- [x] P02 phần code: màn camera landscape, full sensor frame cho preview/tap/tracking/capture, lấy video dimensions/track settings thực tế.
- [x] P03 phần code: khóa nút chụp khi chưa ready và kiểm tra lại frame cuối trước khi gửi ảnh.
- [x] P06 phần contract: client/server cùng 5% không sàn, width chỉ hỗ trợ; early shortlist còn chờ.
- [x] P07 phần profile: loại fallback dùng query hybrid trên index CLS.
- [x] Kiểm chứng checkpoint: 63 file/617 test pass; `tsc --noEmit` exit 0; `npm run build` tạo 47 file; `git diff --check` pass.
- [ ] Hoàn thành các phase còn lại sau benchmark camera, early shortlist/scoped matching, perception và nghiệm thu thiết bị thật.

## Trung tâm Vector AI — sửa KPI pending giả và HTTP 503 (2026-10-23)

- [x] Chẩn đoán read-only production: Cloudflare analytics 2026-10-23 ghi 18 request `exceededResources` trả 503 không JSON; Supabase vẫn đọc được, 1.110 active vector/546 mã khớp profile.
- [x] Xác định cap `index < 40` trong `inspectVectorItems` làm asset sau vị trí 40 không có ETag và bị xếp `failed`: 10 mã bị ảnh hưởng trên trang offset 0/100/260; 4 mã thực tế ready, 6 mã stale/partial vì `source_etag` null. 8 mã >2 asset nằm trong 40 nên không phải nguyên nhân.
- [x] Sửa `functions/_lib/moris/v5/vector/assetStatus.js`: budget 120 R2 HEAD/trang, concurrency 6, chỉ HEAD asset có exact vector kèm `source_etag`, Map vector theo record, `headChecked`/`unverified`; `source_etag` null xếp stale; `summarizeAssets` không để unverified che missing/stale.
- [x] Sửa `functions/api/moris/vector-items.js`: bỏ fallback N+1 (`app_search_catalogue` + `kim_list_vector_record_ids` + `app_get_part_assets`), retry 1 lần cho lỗi tạm thời/429/5xx, trả 503 JSON thân thiện.
- [x] Sửa `tools/moris-vector-center.js`: AbortController hủy load cũ, KPI pending chỉ cập nhật khi tải đủ, chỉ tính missing/stale/partial, refresh đúng mã sau vectorize thay vì tải lại 28 trang, giữ bảng khi lỗi.
- [x] Thêm regression tests cho trang >40 asset, budget unverified, no-etag missing/stale, retry/không fallback, KPI partial và targeted refresh.
- [x] Kiểm chứng: full `npm test` 69 file/677 test pass; `npx tsc --noEmit` exit 0; `npm run build` 48 file; `git diff --check` pass.
- [x] Mô phỏng read-only production bằng code mới: 546 mã/1.110 asset → 540 ready, 4 stale, 2 partial; 6 pending thật (`3430570201`, `3430590001`, `3445950101`, `3446150001`, `3446160001`, `3670700001`) đều có `source_etag` null. Không ghi DB/vector, không deploy.
- [x] Deploy: commit `9b71678` đã push lên `PQVinh99-Glory/Dictionary` main; Cloudflare Pages deployment `11b259a3-dfbe-4cff-9781-80f7c522fb41` build/deploy success lúc 2026-10-23T05:24:04Z; production alias `https://dictionary-dnw.pages.dev`.
- [ ] Owner reload UI đã đăng nhập, xác nhận KPI/table và re-vectorize 6 mã stale để ghi `source_etag`.
