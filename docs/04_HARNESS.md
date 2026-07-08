[04_HARNESS.md](https://github.com/user-attachments/files/29786399/04_HARNESS.md)
# 04 — Thư ký Kim Harness

## One public entry point

`POST /api/kim/search`

## Routing

```text
exact code/id
  -> deterministic
text metadata
  -> deterministic
image/embedding
  -> vector Top-K
  -> deterministic fusion
  -> Gemini only when ambiguous
  -> Gemma only when still ambiguous/conflicting
```

## Budgets

```text
Gemini <= 1 call/query
OpenRouter <= 1 call/query
```

## Guards

- candidate IDs must stay inside pool
- no mirror-based orientation inference
- stale query/image hash rejected by caller/UI contract
- no AI database writes
- embedding profile must match exactly
