# P04–P09 local checkpoint — 2026-10-21

No production database write, vector rebuild, migration apply, or deployment was performed. Production index counts are unstable while the owner rebuilds hybrid vectors, so no live recall or improvement percentage is claimed.

| Area | Verified locally | Still pending |
| --- | --- | --- |
| P04 | Capture/optical closed-hole count consistency is recorded as `agree`, `mismatch`, or `unknown`; descriptor preprocess/profile unchanged. | Real raw/mask/crop/output artifacts, specular and mask GT evaluation. |
| P05 | Explicit `identifying_features` counts: query 4 round holes boosts only explicit 4, not 2/6/unknown; oval leaf labels do not double count; unreliable camera evidence is gated. | Open-notch instances, dictionary visual matching and perception GT. Boost remains OFF by default. |
| P06 | Query 180 mm uses exact 171–189 mm range; bounded read-only pagination reports incomplete budget; size loader chunks all IDs instead of silently dropping >100. | Live coverage and shortlist recall on a frozen index. |
| P08 | Scoped RPC proposal uses the same hybrid identity and cosine, unioned with global ANN; local target absent from global ANN enters candidate pool. Session-filtered ID and keyed hydration RPC proposals avoid full-scan on the new path; 101-ID chunk/orphan test passes. Flags OFF by default because RPCs are proposals, not deployed. | RPC review/EXPLAIN, production recall/latency. |
| P09 | Primary candidates fill Top10 before rescue unknown then outside5%; outside candidates carry real score, delta and warning; API and UI preserve group order. | Real hard negatives and ablation. |

Commands: `npm test` → **67 files, 642 tests passed**; `npx tsc --noEmit` → exit 0; `npm run build` → 47 files. Focused P06/P08 test: `tests/moris-scoped-size-search.test.js` 1/1 passed. These are local fixture results, not a claim of camera or production accuracy.
