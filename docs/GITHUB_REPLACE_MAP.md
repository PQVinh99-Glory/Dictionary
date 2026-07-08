# GitHub Replace Map

## Replace directly

### 1. Root

```text
index.html
```

### 2. Media proxy

```text
functions/api/media/[[path]].js
```

## Add

```text
src/kim/performance/virtualGrid.js
docs/V5_GITHUB_EXECUTION_PLAN.md
docs/PHASE3_VIRTUAL_GRID.md
docs/PHASE4_VITE_VUE_MIGRATION.md
```

## Keep unchanged

- `functions/api/upload.js`
- `functions/api/upload/**`
- Supabase RPC
- R2 binding
- existing metadata schema
- current Kim V5 vector scaffold
- AI provider secrets

## Recommended GitHub commits

Commit 1:

```text
perf: paginate catalogue and lazy-load card images
```

Files:
- `index.html`

Deploy and test.

Commit 2:

```text
perf: strengthen same-origin media cache policy
```

Files:
- `functions/api/media/[[path]].js`

Deploy and test.

Commit 3:

```text
docs: add virtual-grid and Vite migration phases
```

Files:
- docs
- optional virtual grid scaffold
