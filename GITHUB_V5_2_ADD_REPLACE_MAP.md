# GitHub V5.2 Add / Replace Map

## Add

```text
functions/_lib/kim/v5/presentation/userMessage.js
functions/_lib/kim/v5/presentation/publicResult.js
functions/_lib/kim/v5/intent/catalogueIntent.js
ui/kim-public-ui.js

docs/V5_2_ARCHITECTURE.md
docs/CLIP_VS_DINO_DECISION.md
docs/INDEX_HTML_CLEAN_UI_PATCH.md
docs/VECTOR_ACTIVATION_CHECKLIST.md
```

## Replace

```text
functions/api/kim/search.js
```

## Patch manually

```text
index.html
```

Follow:
`docs/INDEX_HTML_CLEAN_UI_PATCH.md`

Do not overwrite index.html with a stale copy.

## Keep rollback

```text
functions/_lib/denis/v4/**
functions/api/denis/*-v4.js
```
