# Thư ký Kim V5.3 — Full Index Integrated

## Replace on GitHub

Replace only:

```text
/index.html
```

with the `index.html` in this package.

## Main changes

- Calls `POST /api/kim/search`
- Uses `user_message` + `candidates`
- Hides provider/debug internals
- Short welcome
- Removes Filter / Analyst / Resolver pills
- Removes Mode / AI calls / Trace from production UI
- Removes simulated 3D viewer
- Keeps real front/back/detail images
- Keeps server-side pagination at 36 cards/page
- Keeps lazy images + async decode
- Preserves Supabase/R2/upload/session logic

## Recommended commit

```text
feat: integrate Thu ky Kim V5.3 clean UI
```

## Important

Internal legacy variable names like `denisSearch` remain temporarily.
This is intentional to reduce regression risk.
User-facing UI no longer uses Denis.
