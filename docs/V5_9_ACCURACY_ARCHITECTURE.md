# V5.9 Accuracy Architecture

## Root causes addressed

### 1. PNG query vs stored WebP mismatch
V5.8 embedded the query image before applying the same canonical preprocessing used by the catalogue.
V5.9 uses identical browser canonicalization for both sides.

### 2. Generic image prompt artificially lowered final score
Old fixed fusion treated missing metadata as score 0 and unknown structure as 0.5.
V5.9 uses evidence-aware dynamic weights. Missing evidence is omitted, not penalized.

### 3. One global CLS vector is not enough for all capture conditions
V5.9 creates two probes per image:

```text
canon_rgb_v2
canon_gray_v2
```

Results are fused with max similarity + RRF + probe consensus.

### 4. HNSW recall
The secure RPC sets `hnsw.ef_search=100` per query.

## Pipeline

```text
Query photo
  -> EXIF-aware decode
  -> foreground/border estimate
  -> tight square crop + padding
  -> neutral background
  -> RGB canonical probe
  -> grayscale canonical probe
  -> DINOv2 384D x2
  -> secure pgvector search x2
  -> RRF + consensus fusion
  -> Top60 retrieval
  -> evidence-aware fusion
  -> Top10 resolver pool
  -> Gemini if low-confidence/ambiguous
  -> Gemma only if Gemini remains ambiguous
  -> concise Thư ký Kim response
```

## Scaling target

For 1000 SKU x 2 images:

```text
2000 source images
x 2 canonical variants
≈ 4000 vector rows
```

This is intentionally small enough that retrieval quality can be benchmarked exhaustively.

## Required migration

Set:

```text
KIM_PREPROCESS_VERSION=kim_canon_v2
KIM_VECTOR_TOP_K=60
KIM_AMBIGUITY_GAP=0.06
KIM_GEMINI_VECTOR_FLOOR=0.86
```

Then reindex from offset 0. Old `hf_dinov2_224_v1` vectors remain but are ignored by the new profile filter.
