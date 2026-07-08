# Thư ký Kim V5.5 — Browser DINOv2 Vector Activation

## Runtime

```text
Browser
  -> Web Worker
  -> Transformers.js 3.8.1
  -> onnx-community/dinov2-small
     revision ef1fb10
  -> WebGPU fp16
     fallback WASM q8
  -> CLS 384D
  -> L2 normalize
```

## Query image

```text
Ảnh query
  -> prepare JPEG hiện tại
  -> DINOv2 browser embedding
  -> POST /api/kim/search
     image_data_url
     query_embedding[384]
     embedding_profile
  -> pgvector HNSW Top30
  -> deterministic fusion
  -> Gemini conditional
  -> Gemma conditional
```

## Catalogue reindex

Open:

```text
/tools/kim-vector-reindex.html
```

Requirements:
- login Catalogue first
- current user role = admin
- SQL 001, 002, 003 already applied
- Cloudflare secret `SUPABASE_SERVICE_ROLE_KEY`

The page:
- fetches catalogue batch
- loads each image through `/api/media/*`
- embeds in browser worker
- writes vectors through `/api/kim/vector-upsert`

## New SKU

Desktop save:
- metadata/assets save first
- background vectorization runs non-blocking
- failure never rolls back the business save

Mobile:
- auto-vector-on-save OFF by default
- run admin reindex later

## Profile invariant

Library and query must match exactly:

```text
model=onnx-community/dinov2-small
model_version=ef1fb10
preprocess_version=hf_dinov2_224_v1
profile=cls_l2_v1
dimension=384
```

Never compare vectors from different profiles.
