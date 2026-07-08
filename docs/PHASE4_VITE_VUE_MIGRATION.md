# Phase 4 — Vite/Vue Migration Plan

## Không migrate ngay

Single `index.html + Vue CDN` vẫn được giữ trong Phase 1–3 để giảm regression risk.

## Trigger để bắt đầu

Chỉ migrate khi:

- V5 vector search có benchmark;
- Supabase contracts ổn định;
- R2/media ổn định;
- Thư ký Kim flow ổn định;
- test matrix đủ.

## Target

```text
src/
├─ app/
│  ├─ App.vue
│  └─ router.ts
├─ catalogue/
│  ├─ components/
│  │  ├─ CatalogueCard.vue
│  │  ├─ CatalogueGrid.vue
│  │  └─ CataloguePagination.vue
│  ├─ composables/
│  │  ├─ useCatalogueQuery.ts
│  │  └─ useImageLazyLoad.ts
│  └─ api/
│     └─ catalogue.api.ts
├─ kim/
│  ├─ components/
│  ├─ store/
│  ├─ api/
│  └─ vector/
├─ storage/
│  ├─ media.ts
│  └─ upload.ts
└─ shared/
   ├─ ui/
   ├─ types/
   └─ utils/
```

## Stack

```text
Vite
Vue 3
TypeScript
Pinia
TanStack Vue Query
Zod
```

## Migration sequence

1. Freeze legacy behavior.
2. Create Vite shell.
3. Move API adapters first.
4. Move catalogue list.
5. Move detail viewer.
6. Move editor/upload.
7. Move Thư ký Kim.
8. Delete legacy code only after parity.

## Non-negotiable

- no schema rewrite;
- no RPC rename;
- no R2 path change;
- no big-bang rewrite.
