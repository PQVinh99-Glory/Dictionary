# Moris pipeline release review packet — 2026-10-21

This packet is preparation, not deployment authorization or a production pass. Code paths P06/P08 are implemented locally; the owner is rebuilding the hybrid index independently. No vector or database writes were performed for this packet.

## Proposed rollout bundle

1. Freeze Git SHA and exact browser worker/server model, revision, preprocess and hybrid profile. Confirm the owner's rebuild has stopped changing active counts and that expected assets have fresh vectors. A same-key vector with stale source bytes is not ready.
2. Review `docs/moris-v6/sql/pipeline_scoped_match_proposal.sql` against the actual production schema and privileges. It defines only three read-only RPCs: scoped cosine (service role), session-filtered shortlist IDs and session-checked keyed hydration. Run `EXPLAIN (ANALYZE, BUFFERS)` on representative small/large scopes in a safe environment; verify grants, timeouts and indexes before any migration. This SQL is deliberately outside `supabase/migrations/` and has **not** been applied.
3. Deploy the reviewed application and SQL together under owner-approved release process. After the RPCs exist, enable `MORIS_SCOPED_SIZE_SEARCH_ENABLED` and `MORIS_KEYED_HYDRATION_ENABLED` only for a controlled release. `MORIS_SIZE_GATE_ENABLED` remains true; `MORIS_HOLE_FORMAT_BOOST_ENABLED` remains false until real ablation. Do not switch the active index to CLS or relabel an old vector as hybrid.
4. Validate session/usage/view filtering, target 3448000001 at 180 mm, no-size path, >100 keyed hydration, orphan deletion, profile mismatch and scoped-RPC failure. Capture stage traces and P50/P95 on Android/iPhone before broad release. Owner signs off the thresholds and camera GT; the current decision is **NO GO / pending real evidence**.

## Reversible rollback

Turn `MORIS_SCOPED_SIZE_SEARCH_ENABLED` and `MORIS_KEYED_HYDRATION_ENABLED` off; keep the previous browser/server/profile/index bundle together. The fallback may lose size-compatible targets outside global ANN, so label it as degraded behavior. Retain the read-only RPCs until a separately reviewed cleanup; do not drop tables or clear vectors as a rollback shortcut. Database backup/restore procedure and exact asset inventory require the owner’s stable production snapshot and authorized operator; neither can be claimed complete here.

## Conditional P11 decision

No additional classifier/detector is trained or selected now. The 15 dictionary sample images/11 tags do not establish real closed/open instance accuracy, and the owner’s camera GT is pending. Revisit P11 only after P05/P10 show whether the failure is localization, class, count or a reflection/stamp false positive. DINOv2 descriptor changes would require a separate profile/index experiment and controlled rebuild.

## Local checks and gaps

`npm test` passed **69 files/651 tests** at the final local checkpoint; `npx tsc --noEmit`, `npm run build` (47 files) and `git diff --check` exited 0. The isolated Playwright/Postgres E2E script `tools/check-moris-e2e.mjs` was inspected but not run: its required Docker container `moris-v6-test` is absent, and this host lacks Chromium system libraries. Staging, physical camera, Supabase RPC migration, production recall/latency and rollback restore test remain pending; none is represented by the unit suite.
