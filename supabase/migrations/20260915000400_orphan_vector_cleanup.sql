-- Kim v5/v6 — Dọn dẹp orphan vectors + ngăn phát sinh trong tương lai.
-- Chạy trên Supabase SQL Editor (idempotent).
--
-- Vấn đề: khi xóa bản ghi catalogue (image_library), các vector tương ứng
-- trong catalogue_image_vectors KHÔNG bị xóa theo → vector search trả về
-- các hit "mồ côi" không có metadata → UI hiển thị "ID: --- · Chưa xác định".
--
-- Fix 1: vô hiệu hóa orphan vectors hiện có.
-- Fix 2: trigger tự xóa vector khi bản ghi catalogue bị xóa.

-- ── Fix 1: vô hiệu hóa orphan vectors ─────────────────────────────────
update public.catalogue_image_vectors v
set is_active = false
where not exists (
  select 1 from public.image_library il
  where il.id::text = v.record_id
);

-- ── Fix 2: trigger cascade khi xóa catalogue ─────────────────────────
create or replace function public.kim_cleanup_vectors_on_delete()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from public.catalogue_image_vectors
  where record_id = old.id::text;
  return old;
end;
$$;

drop trigger if exists trg_kim_cleanup_vectors_on_delete on public.image_library;

create trigger trg_kim_cleanup_vectors_on_delete
  after delete on public.image_library
  for each row
  execute function public.kim_cleanup_vectors_on_delete();