# Vector Activation Checklist

Image search is not active until all pass.

## Runtime

```text
[ ] functions/api/kim/search.js
[ ] functions/api/kim/vector-search.js
[ ] functions/_lib/kim/v5/vector/encoder.js
[ ] functions/_lib/kim/v5/vector/search.js
[ ] functions/_lib/kim/v5/vector/profiles.js
```

## Database

```text
[ ] pgvector
[ ] catalogue_image_vectors
[ ] HNSW index
[ ] match_catalogue_image_vectors RPC
[ ] active vector rows > 0
```

## Encoder

One of:

```text
[ ] client sends query_embedding with exact profile
```

or:

```text
[ ] KIM_EMBEDDING_ENDPOINT configured
```

## Flags

```text
KIM_ENABLED=true
KIM_VECTOR_SEARCH_ENABLED=true
```

Start with AI off:

```text
KIM_GEMINI_RERANK_ENABLED=false
KIM_GEMMA_JUDGE_ENABLED=false
```

Test Recall@30 first.

## Frontend

```text
[ ] POST /api/kim/search
[ ] no Denis search route
[ ] sends session_token
[ ] sends image_data_url or query_embedding
```
