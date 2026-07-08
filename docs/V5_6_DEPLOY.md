# V5.6 Deploy

## Add

```text
tools/kim-vector-center.html
functions/api/kim/vector-lifecycle.js
docs/V5_6_VECTOR_LIFECYCLE.md
```

## Replace

```text
index.html
```

## Keep from V5.5

```text
src/kim/vector/browserDinov2.js
src/kim/vector/dinov2.worker.js
functions/api/kim/reindex-batch.js
functions/api/kim/vector-upsert.js
functions/api/kim/reindex-status.js
sql/001_vector_sidecar.sql
sql/002_match_vectors_rpc.sql
sql/003_reindex_support_rpc.sql
```

## Cloudflare Secret

```text
SUPABASE_SERVICE_ROLE_KEY
```

## Variables

```text
KIM_ENABLED=true
KIM_VECTOR_SEARCH_ENABLED=true
KIM_GEMINI_RERANK_ENABLED=false
KIM_GEMMA_JUDGE_ENABLED=false
```

Backfill and measure Recall@30 before enabling agents.
