# Thư ký Kim V5 — GitHub Execution Plan

Repo:
`PQVinh99-Glory/Dictionary`

## Mục tiêu

Không dùng script local.
Mọi file trong gói này giữ đúng đường dẫn repo để upload/replace trực tiếp trên GitHub.

---

## Phase 1 — ACTIVE

### Server-side pagination

File thay:
`index.html`

Behavior:

- `PAGE_LIMIT = 36`
- RPC vẫn là `app_search_catalogue`
- request `PAGE_LIMIT + 1` để xác định `hasMore`
- DOM chỉ giữ tối đa 36 catalogue cards
- không còn `this.parts.concat(rows)`
- có `Trang trước` / `Trang sau`
- filter/search reset về page 1
- stale page response bị reject bằng `catalogueRequestSeq`

### Acceptance

DevTools:

```js
document.querySelectorAll('[data-part-card]').length
```

hoặc kiểm tra DOM thủ công:
không được tăng vô hạn khi đổi trang.

---

## Phase 2 — ACTIVE

### Lazy image

`index.html`:

- `loading="lazy"`
- `decoding="async"`
- `fetchpriority="low"`
- thumbnail card có width/height hints

### Media proxy cache

File thay:
`functions/api/media/[[path]].js`

Preserve:
- R2 binding `CATALOGUE_BUCKET`
- ETag
- conditional request
- range request
- same-origin media route

Add:
- browser cache policy
- `CDN-Cache-Control`
- no `immutable`

---

## Phase 3 — READY, OFF by default

File:
`src/kim/performance/virtualGrid.js`

Không nối vào UI ngay.

Chỉ bật khi:
- 36 cards/page vẫn lag;
- card component nặng;
- benchmark iOS cho thấy layout/paint là bottleneck.

Lý do:
pagination đã giới hạn DOM, nên virtualization có thể chưa cần.

---

## Phase 4 — PLAN ONLY

Không migrate Vite ngay.

Chỉ bắt đầu khi:
- V5 vector retrieval ổn;
- pagination ổn;
- media pipeline ổn;
- regression baseline có;
- schema/RPC/RLS đã rõ.

Xem:
`docs/PHASE4_VITE_VUE_MIGRATION.md`
