# V5.5 Deploy Order

## Commit 1 — SQL

Review then run:

```text
sql/001_vector_sidecar.sql
sql/002_match_vectors_rpc.sql
sql/003_reindex_support_rpc.sql
```

Check pgvector version first.

## Commit 2 — Server runtime

Add/replace:

```text
functions/_lib/kim/v5/connectors/supabaseService.js
functions/_lib/kim/v5/runtime/config.js
functions/api/kim/health.js
functions/api/kim/reindex-batch.js
functions/api/kim/vector-upsert.js
```

Cloudflare Secret:

```text
SUPABASE_SERVICE_ROLE_KEY
```

Never expose it in frontend.

## Commit 3 — Browser DINOv2

Add:

```text
src/kim/vector/browserDinov2.js
src/kim/vector/dinov2.worker.js
tools/kim-vector-reindex.html
```

## Commit 4 — index.html

Replace root:

```text
index.html
```

## Commit 5 — feature flag

Set:

```text
KIM_ENABLED=true
KIM_VECTOR_SEARCH_ENABLED=true

KIM_GEMINI_RERANK_ENABLED=false
KIM_GEMMA_JUDGE_ENABLED=false
```

First benchmark raw vector Recall@30.

## Commit 6 — Reindex

Open:

```text
/tools/kim-vector-reindex.html
```

Run until complete.

## Commit 7 — AI agents

Only after Recall@30 is acceptable:

```text
KIM_GEMINI_RERANK_ENABLED=true
```

then later:

```text
KIM_GEMMA_JUDGE_ENABLED=true
```
