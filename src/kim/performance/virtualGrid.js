/**
 * Thư ký Kim V5 — optional virtual grid controller.
 *
 * IMPORTANT:
 * Phase 1 pagination is the production default.
 * Do not enable virtualization until benchmark shows page rendering
 * is still a bottleneck.
 */

export function createVirtualGrid({
  itemCount,
  rowHeight,
  columnCount,
  overscanRows=2
}) {
  const safeColumns = Math.max(1, Number(columnCount || 1));
  const safeRowHeight = Math.max(1, Number(rowHeight || 1));
  const totalRows = Math.ceil(Number(itemCount || 0) / safeColumns);

  return {
    getWindow({scrollTop, viewportHeight}) {
      const firstVisibleRow = Math.floor(
        Math.max(0, Number(scrollTop || 0)) / safeRowHeight
      );

      const visibleRowCount = Math.ceil(
        Math.max(0, Number(viewportHeight || 0)) / safeRowHeight
      );

      const startRow = Math.max(
        0,
        firstVisibleRow - overscanRows
      );

      const endRow = Math.min(
        totalRows,
        firstVisibleRow + visibleRowCount + overscanRows
      );

      return {
        startIndex:startRow * safeColumns,
        endIndex:Math.min(
          Number(itemCount || 0),
          endRow * safeColumns
        ),
        topSpacer:startRow * safeRowHeight,
        bottomSpacer:Math.max(
          0,
          (totalRows - endRow) * safeRowHeight
        )
      };
    }
  };
}
