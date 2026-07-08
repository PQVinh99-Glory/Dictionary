# Codex Prompt — Implement Thư ký Kim V5

Activate the current Dictionary project.

This is a major additive migration from Denis V4 to Thư ký Kim V5.

Read:
- AGENTS.md
- docs/CURRENT_SYSTEM_MAP.md
- docs/LEGACY_DATA_CONTRACTS.md
- docs/MIGRATION_BLOCKERS.md
- this V5 pack

Use:
- Serena for current repo discovery
- $code-review
- $supabase-architect
- $ai-vision
- $security-review

Do not:
- rewrite the whole app
- change existing metadata fields
- change current R2 upload/media behavior
- change existing RPC signatures
- delete the working text filter
- remove rollback path

Goal:
Implement a hybrid vector + AI image search under a feature flag.

Architecture:
1. exact/text filter first
2. image foreground/canonicalization
3. DINOv2 384D embedding
4. pgvector HNSW Top 30
5. deterministic score fusion
6. Gemini only on hard Top 10
7. Gemma only on ambiguity
8. Top 5 applies to catalogue UI

Required:
- rename user-facing Denis to Thư ký Kim
- create vector sidecar table only after schema review
- never mix embedding profiles
- query_id/image_hash/candidate_pool_hash
- stale response rejection
- max Gemini calls = 1
- max OpenRouter calls = 1
- no AI database writes
- no mirror-based orientation inference

Phase order:
A. Add SQL migration draft and review
B. Add vector contracts
C. Build admin reindex tool
D. Build query vector retrieval without AI
E. Benchmark retrieval
F. Add Gemini reranker
G. Add Gemma critic
H. Rename UI
I. Add debug drawer

Stop if physical schema/RLS/RPC details are unknown.
Do not guess.
