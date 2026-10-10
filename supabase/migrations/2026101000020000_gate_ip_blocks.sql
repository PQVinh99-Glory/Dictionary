-- =============================================================================
-- Migration: 2026101000020000_gate_ip_blocks.sql
-- Bảng lưu trữ IP bị khóa vĩnh viễn ở Cổng Ngụy Trang (để Admin có thể mở khóa)
-- =============================================================================

begin;

create table if not exists public.gate_ip_blocks (
  ip text primary key,
  failed_count integer not null default 0,
  is_blocked boolean not null default true,
  blocked_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- RLS: Service role only (không cấp cho client/anon)
alter table public.gate_ip_blocks enable row level security;
revoke all on table public.gate_ip_blocks from public;
revoke all on table public.gate_ip_blocks from anon;
revoke all on table public.gate_ip_blocks from authenticated;
grant all on table public.gate_ip_blocks to service_role;

commit;
