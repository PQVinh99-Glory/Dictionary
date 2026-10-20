-- =============================================================================
-- Migration: Thêm mẫu lỗ "Lỗ bán oval" vào Từ điển mẫu lỗ phổ biến
-- =============================================================================
-- Ảnh nguồn: Simple/lỗ bán oval.png (crop sát vùng lỗ, resize 600px, giữ style
-- trắng-trên-nền-đen như 14 mẫu trước) -> R2 catalogue-images/hole-samples/ban-oval.png.
-- Bảng moris_hole_samples đã tạo ở 20261019180000; migration này chỉ thêm 1 dòng
-- idempotent theo slug, không đổi schema/RLS/policy.
-- Chủ dự án chốt 2026-10-20: "Lỗ bán oval" là định dạng riêng, xếp sau "Lỗ oval cong"
-- (sort_order 45) và trước nhóm "Lỗ dài" (51).
-- =============================================================================

insert into public.moris_hole_samples (slug, name, format_tag, r2_key, sort_order) values
  ('ban-oval', 'Lỗ bán oval', 'ban_oval', 'hole-samples/ban-oval.png', 45)
on conflict (slug) do update set
  name       = excluded.name,
  format_tag = excluded.format_tag,
  r2_key     = excluded.r2_key,
  sort_order = excluded.sort_order,
  active     = true,
  updated_at = now();
