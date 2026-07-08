# Thư ký Kim V5.2 — Clean UX + Harness

## Identity

`Thư ký Kim = Harness`, không phải một model.

```text
User
  |
  v
[Kim Harness]
  |
  +-- Hook: beforeQuery
  |     query_id / image_hash / domain guard
  |
  +-- Tool: catalogue.search
  |     exact code / ID / metadata
  |
  +-- Tool: foreground.prepare
  |     remove.bg khi cần
  |
  +-- Tool: vector.encode
  |     primary visual encoder
  |
  +-- Tool: vector.search
  |     HNSW Top 30
  |
  +-- Hook: afterRetrieval
  |     dedupe / pool hash / fusion
  |
  +-- Agent A: Gemini Resolver
  |     chỉ Top 8–10
  |
  +-- Hook: ambiguityGate
  |
  +-- Agent B: Gemma Critic
  |     chỉ khi mơ hồ/conflict
  |
  +-- Hook: beforeRespond
        candidate guard / clean Vietnamese / hide internals
```

## Tools

```text
catalogue.exactLookup
catalogue.search
catalogue.hydrate
media.fetch
foreground.remove
vector.encode
vector.search
metadata.rank
structure.analyze
candidate.fuse
```

## Hooks

```text
beforeQuery
afterIntent
beforeVector
afterRetrieval
beforeAgentA
afterAgentA
beforeAgentB
afterAgentB
beforeRespond
onError
```

## Agent A — Gemini

Input:
- query image
- Top 8–10 candidate images
- vector scores
- metadata
- structural evidence

Task:
- angle
- lighting
- perspective
- occlusion
- hole placement
- silhouette
- mounting geometry

## Agent B — Gemma

Runs only when:
- Top1/Top2 too close
- orientation conflict
- hole conflict
- Gemini ambiguous
- unsupported confidence

Never:
- add IDs
- rerun retrieval
- write DB

## Public response

Production UI gets only:
- `user_message`
- `candidates`
- `decision`

Debug appears only with:
`KIM_DEBUG_EXPOSE_INTERNAL=true`.
