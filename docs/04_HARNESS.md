[Uploading 04_HARNESS.md…]()
# 04 — Kim Harness

## Kim không phải chatbot

```text
Thư ký Kim
= orchestrator + tools + agents + guards
```

## Runtime context

Mỗi query:

```json
{
  "query_id": "...",
  "image_hash": "...",
  "embedding_profile": "...",
  "candidate_pool_hash": "...",
  "vector_top_k": 30,
  "resolver_top_k": 10,
  "ai_calls": {
    "gemini": 0,
    "openrouter": 0
  },
  "stage": "...",
  "warnings": []
}
```

## Hard budgets

```text
max Gemini calls/query = 1
max OpenRouter calls/query = 1
max total AI calls/query = 2
max candidate images to Gemini = 10
```

Không còn 10 request/search.

## Route logic

### Exact

```text
code / ID exact
-> 0 AI
```

### Text strong

```text
metadata filter sufficient
-> 0 AI
```

### Image normal

```text
preprocess
-> vector
-> Top 30
-> fusion
-> Top 5 clear
-> 0 AI
```

### Image hard

```text
vector Top 30
-> fusion Top 10
-> Gemini
-> Top 5
```

### Critical

```text
Gemini top1/top2 too close
or orientation conflict
or visual contradiction
-> Gemma Judge
```

## Ambiguity metrics

Gọi Gemini khi một trong các điều kiện:

```text
top1 - top2 < 0.035
top1 similarity < calibrated_min
Top 10 có nhiều mã cùng family
structural conflicts >= 1
query quality low
angle risk high
lighting risk high
```

Gọi Gemma khi:

```text
Gemini marks ambiguous
top1 - top2 < 0.05 after rerank
left/right conflict
hole-count conflict
Gemini evidence unsupported
```

## Guardrails

- model chỉ chọn ID trong pool;
- stale query rejected;
- embedding profile phải match;
- candidate pool hash phải match;
- no mirror inference;
- no DB write from AI;
- unknown != conflict;
- no result reuse across image hash.
