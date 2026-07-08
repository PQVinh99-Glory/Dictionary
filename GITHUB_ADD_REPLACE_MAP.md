# GitHub Add / Replace Map

## Replace existing

```text
functions/api/kim/health.js
functions/_lib/kim/v5/agents/geminiResolver.js
functions/_lib/kim/v5/agents/gemmaJudge.js
functions/_lib/kim/v5/harness/ambiguityGate.js
functions/_lib/kim/v5/harness/orchestrator.js
functions/_lib/kim/v5/preprocess/contracts.js
functions/_lib/kim/v5/runtime/config.js
functions/_lib/kim/v5/vector/contracts.js
```

## Add

```text
functions/api/kim/search.js
functions/api/kim/vector-search.js
functions/api/kim/reindex-status.js
functions/api/kim/reindex.js

functions/_lib/shared/**

functions/_lib/kim/v5/orchestrator.js
functions/_lib/kim/v5/connectors/**
functions/_lib/kim/v5/providers/**
functions/_lib/kim/v5/prompts/**
functions/_lib/kim/v5/schemas/**
functions/_lib/kim/v5/guards/**
functions/_lib/kim/v5/retrieval/**
functions/_lib/kim/v5/runtime/queryContext.js
functions/_lib/kim/v5/runtime/budget.js
functions/_lib/kim/v5/runtime/trace.js
functions/_lib/kim/v5/preprocess/foregroundGate.js
functions/_lib/kim/v5/preprocess/canonicalize.js
functions/_lib/kim/v5/preprocess/quality.js
functions/_lib/kim/v5/vector/encoder.js
functions/_lib/kim/v5/vector/search.js
functions/_lib/kim/v5/vector/profiles.js

sql/**
docs/00_CURRENT_SYSTEM.md
docs/04_HARNESS.md
docs/09_TEST_MATRIX.md
.env.example
```

## Do not delete yet

```text
functions/_lib/denis/v4/**
functions/api/denis/*-v4.js
```

Keep for rollback until Kim passes production gates.
