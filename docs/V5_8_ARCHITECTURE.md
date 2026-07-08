# Thư ký Kim V5.8

## Core invariant

```text
Thư ký Kim = Harness
```

Không phải model.

## Image query

```text
User image
  -> Query Vector Bridge
  -> Browser DINOv2 Worker
  -> CLS 384D
  -> L2 normalize
  -> POST /api/kim/search
       image_data_url
       query_embedding
       embedding_profile
  -> pgvector HNSW Top30
  -> collapse best view per SKU
  -> hydrate metadata
  -> metadata rank
  -> structural evidence
  -> deterministic fusion
  -> Top8-10
  -> Gemini Resolver conditional
  -> Gemma Critic conditional
  -> Thư ký Kim clean response
```

## Agent evidence

Gemini receives:
- query image
- candidate image
- vector_similarity
- metadata_score
- structural_score
- final_score
- identifying_features
- confusing_note
- usage_side
- matched/conflicts

Gemma receives:
- same score evidence
- identifying features
- Gemini result
- candidate pool only

Agents never add IDs outside vector candidate pool.

## New-image auto embed

```text
Save metadata
  -> save assets
  -> enqueue persistent job
  -> browser DINOv2
  -> chunked vector upsert
  -> Supabase
```

Queue survives reload.

Exhausted jobs move to:

```text
kim_v58_vector_jobs_failed
```

## Existing-image backfill

```text
Batch assets
  -> embed all
  -> chunk 20/20/...
  -> write every chunk
  -> only advance cursor if whole batch is complete
```

## Server integrity

`/api/kim/vector-upsert`:
- max 20 vectors/request
- rejects >20
- never silently truncates
