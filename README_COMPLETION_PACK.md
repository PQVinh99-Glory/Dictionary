# Thư ký Kim V5 Runtime Completion Pack

This pack fills the missing runtime layers found in the current public repository.

Important:
- It does not pretend Cloudflare Pages can run DINOv2 without a model runtime.
- Query embedding is supplied by either:
  1. client `query_embedding`, or
  2. `KIM_EMBEDDING_ENDPOINT`.
- Foreground removal is optional through `KIM_FOREGROUND_ENDPOINT`.
- Vector search remains OFF by default.
- Gemini/Gemma remain OFF by default.
- Denis V4 is not deleted.

Deploy in separate commits:
1. shared + Kim runtime
2. SQL after review
3. API endpoints
4. feature flags
5. shadow vector benchmark
