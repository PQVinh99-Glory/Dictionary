# V5.9 Cost and Scale

## 1000 SKU / 2 images each

Source images:

```text
2000
```

Dual canonical variants:

```text
~4000 vectors
```

A `halfvec(384)` contains 384 half-precision values, about 768 bytes of raw numeric payload per vector before row/index overhead. Raw embedding payload is therefore only about 3 MB for 4000 vectors. Database and HNSW overhead will be larger, but this scale is still small.

## Cost-control strategy

```text
DINOv2 browser inference = no per-query model API fee
pgvector retrieval        = database usage
Gemini                    = conditional only
Gemma                     = conditional only after Gemini ambiguity
```

Do not send all 1000 SKU images to Gemini. Vector retrieval must reduce the pool first.

## Recommended call policy

- Exact/text deterministic: 0 AI calls
- Clear image retrieval: 0 AI calls
- Low vector confidence or close gap: 1 Gemini call
- Gemini ambiguous: +1 Gemma call

This is the main mechanism preventing AI cost from scaling linearly with SKU count.
