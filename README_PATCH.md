# V5.7 Exact Patch

Apply after V5.6.

Replace/add exact paths:

```text
functions/api/kim/reindex-batch.js
functions/api/kim/vector-upsert.js
tools/kim-vector-center.html
docs/V5_7_HYBRID_AGENT_PIPELINE.md
```

After deploy:
1. Reset cursor
2. Load DINOv2
3. Test model
4. Start 1 batch
5. Confirm Supabase `catalogue_image_vectors` > 0
6. Only then test image search
