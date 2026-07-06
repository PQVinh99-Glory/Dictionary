# DENIS_HARNESS_ARCHITECTURE.md

## North Star

Denis không phải chatbot gắn thêm vào trang.

Denis là domain harness của Catalogue Linh Kiện.

## Pipeline

```text
User text + optional query image
              |
              v
     Session validation (app_me)
              |
              v
      Deterministic fast path
      | exact code/ID -> direct
      |
      +-- complex text --------------------+
      |                                    |
      v                                    v
Gemma 4 26B Planner                Nemotron Omni
structured intent                  independent image observation
      |                                    |
      +------------------+-----------------+
                         v
              Candidate Retrieval
      app_search_catalogue existing RPC
                         |
                         v
           Missing-aware deterministic score
          MATCH / UNKNOWN / CONFLICT semantics
                         |
                      Top 12
                         |
             image query present?
                | no           | yes
                v              v
          text evidence   Top 4 Vision verify
                               |
                         ambiguous?
                       no      |      yes
                       |       v
                       |  Gemma 4 31B Judge
                       +-------+
                           |
                           v
                 Gemma 4 26B Answer
                           |
                           v
        answer + confidence + evidence + candidates
```

## Why not 3 models every request?

- exact lookup: 0 model calls;
- simple text: bounded retrieval, answer only when needed;
- image: Vision is used;
- Judge only when ambiguous.

This preserves free quota and latency.

## No vector DB

V1 does not create image embeddings.

Candidate reduction happens through:
- exact code/ID;
- existing metadata;
- identifying features;
- usage side;
- view mode;
- query image observation terms;
- deterministic rerank.

Only bounded Top-K images reach Vision verification.

## Trust boundaries

### Trusted orchestration
- server code;
- deterministic gates;
- RPC contracts.

### Untrusted evidence
- metadata text;
- confusing_note;
- filenames;
- image OCR text;
- model outputs.

Model output is validated as structured JSON where possible.

## Future additive AI metadata

Not implemented in V1.

Suggested later:

```text
part_ai_observations
```

Keep separate from human metadata.
