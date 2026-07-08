# V5.8 Deploy Order

## 1. Upload patch

Replace/add exact files from V5.8 patch.

## 2. Cloudflare variable

Required:

```text
KIM_VECTOR_SEARCH_ENABLED=true
```

For raw retrieval test, keep:

```text
KIM_GEMINI_RERANK_ENABLED=false
KIM_GEMMA_JUDGE_ENABLED=false
```

Redeploy.

## 3. Health

Open:

```text
/api/kim/health
```

Required:

```text
features.vectorSearch = true
query_vector_bridge.ready = true
vector_write.service_role_configured = true
```

## 4. Backfill again

V5.7 may have embedded more vectors than it wrote because old server/client path used one oversized request.

Run Vector Center again from offset 0.
Upsert is idempotent.

Expected:

```text
embedded == written
```

for a clean batch.

## 5. Test image query

Use an existing catalogue image first.

Expected:

```text
image
-> 384D
-> Top30
-> Top5
```

## 6. Enable Agent A

Only after raw retrieval works:

```text
KIM_GEMINI_RERANK_ENABLED=true
```

## 7. Enable Agent B

After ambiguous-case testing:

```text
KIM_GEMMA_JUDGE_ENABLED=true
```
