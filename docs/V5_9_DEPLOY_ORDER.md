# V5.9 Deploy Order

1. Upload V5.9 patch.
2. Run reviewed SQL `sql/002_match_vectors_rpc.sql`.
3. Cloudflare variables:

```text
KIM_PREPROCESS_VERSION=kim_canon_v2
KIM_VECTOR_TOP_K=60
KIM_AMBIGUITY_GAP=0.06
KIM_GEMINI_VECTOR_FLOOR=0.86
```

4. Keep agents OFF for baseline:

```text
KIM_GEMINI_RERANK_ENABLED=false
KIM_GEMMA_JUDGE_ENABLED=false
```

5. Redeploy.
6. Reset Vector Center offset to 0.
7. Reindex entire catalogue under `kim_canon_v2`.
8. Test same-image PNG/WebP, angle, lighting, crop.
9. Measure Recall@1 / Recall@5 / Recall@30.
10. Enable Gemini.
11. Enable Gemma only after ambiguous-case review.

Security actions outside code:
- Cloudflare rate limiting rules
- Turnstile on login
- rotate secrets if ever exposed
