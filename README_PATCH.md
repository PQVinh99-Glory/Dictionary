# V5.8 Exact Patch

Apply after V5.7.

This patch:
- sends image query embedding 384D through Query Vector Bridge
- keeps persistent auto-embed queue for new images
- sends vector writes in chunks of 20
- rejects oversized server writes instead of truncating
- collapses multi-view vector hits to best view per SKU
- enriches Gemini/Gemma evidence

After deploy:
1. set KIM_VECTOR_SEARCH_ENABLED=true
2. redeploy
3. verify /api/kim/health
4. reset backfill cursor to 0
5. re-run backfill
6. test image query with agents OFF
7. enable Gemini
8. enable Gemma
