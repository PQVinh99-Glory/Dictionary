# Thư ký Kim V5.5 — Browser DINOv2 Vector Activation

This package activates real browser-side DINOv2 embeddings.

Core:
- DINOv2-small in Web Worker
- WebGPU fp16, WASM q8 fallback
- 384D CLS + L2 normalize
- pgvector HNSW
- admin browser reindex
- secure server-side vector writes
- image query sends `query_embedding`
- text cards show `Khớp đặc điểm`, not fake `0%`
- existing Gemini/Gemma harness remains conditional

Important:
- keep Denis V4 rollback until V5.5 passes gates
- do not delete existing Supabase/R2/upload/session contracts
- `SUPABASE_SERVICE_ROLE_KEY` is Cloudflare Secret only
