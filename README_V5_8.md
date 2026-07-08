# Thư ký Kim V5.8

Build goals:
- Query Vector Bridge
- Auto Embed Queue
- Chunked Backfill
- best-view-per-SKU retrieval
- richer evidence for Gemini/Gemma
- no silent vector truncation

Important:
- set `KIM_VECTOR_SEARCH_ENABLED=true`
- backfill again from offset 0 because earlier oversized writes may have lost vectors
- validate raw vector retrieval before enabling agents
