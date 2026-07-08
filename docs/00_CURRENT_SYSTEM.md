# 00 — Current System

## Stable contracts

- Supabase custom session RPC
- `app_search_catalogue`
- existing metadata fields
- R2 `CATALOGUE_BUCKET`
- same-origin `/api/media/*`
- current upload functions

## Transitional state

- Denis legacy remains for rollback.
- Thư ký Kim V5 becomes the target runtime.
- Vector search stays behind a feature flag until Recall@30 benchmark passes.

## Main Kim endpoints

```text
GET  /api/kim/health
POST /api/kim/search
POST /api/kim/vector-search
GET  /api/kim/reindex-status
POST /api/kim/reindex  (admin token required)
```
