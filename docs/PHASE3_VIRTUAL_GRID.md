# Phase 3 — Virtual Grid

## Khi nào thật sự cần

Vue chính thức khuyến nghị virtualize các list lớn khi render rất nhiều node.
Nhưng hệ thống V5 đã giới hạn 36 card/trang, vì vậy virtual grid không nên bật chỉ vì "có 1000 SKU".

Bật khi benchmark cho thấy:

- 36 card vẫn làm FPS thấp;
- card chứa nhiều effect/DOM;
- iOS Safari có memory pressure;
- layout/paint chiếm thời gian lớn.

## Strategy

```text
server pagination
  -> one page only
  -> optional virtual window inside current page
```

Không:

```text
1000 rows client-side
  -> virtualize all 1000
```

vì như vậy vẫn tải metadata quá nhiều.

## Scaffold

`src/kim/performance/virtualGrid.js`

Default:
OFF.
