-- Kim v6 Provider Config v2: thêm định danh provider + protocol API.
-- Chạy trên Supabase SQL Editor (idempotent).
--
-- Các cột mới:
--   provider_id   : định danh ổn định do admin đặt (slug), dùng làm khóa logic
--   display_name  : tên hiển thị trên UI
--   api_protocol  : openai-completions | openai-responses | anthropic-messages

alter table public.kim_provider_config
  add column if not exists provider_id text,
  add column if not exists display_name text,
  add column if not exists api_protocol text not null default 'openai-completions';

-- provider_id duy nhất (nullable để tương thích dữ liệu cũ)
create unique index if not exists uq_kim_provider_config_provider_id
  on public.kim_provider_config (provider_id)
  where provider_id is not null;

-- Ràng buộc protocol hợp lệ
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'chk_kim_provider_config_protocol'
  ) then
    alter table public.kim_provider_config
      add constraint chk_kim_provider_config_protocol
      check (api_protocol in ('openai-completions','openai-responses','anthropic-messages'));
  end if;
end
$$;

-- Backfill dữ liệu cũ: provider_id = name, display_name = name
update public.kim_provider_config
set provider_id = coalesce(provider_id, name),
    display_name = coalesce(display_name, name)
where provider_id is null or display_name is null;

-- Seed provider mặc định nếu chưa có (giữ tương thích)
insert into public.kim_provider_config (provider_id, name, display_name, base_url, api_protocol, api_key_encrypted, models, priority)
values (
  'xkiro',
  'xkiro',
  'Xkiro Gateway',
  'https://api.xkiro.com/v1',
  'openai-completions',
  'PLACEHOLDER_ENCRYPTED_KEY',
  '[
    {"id":"qwen/qwen3.8-max","roles":["orchestrator","synthesizer"]},
    {"id":"deepseek/deepseek-v4-pro","roles":["orchestrator"]},
    {"id":"xiaomi/mimo-v2.5-pro","roles":["vision"]},
    {"id":"qwen/qwen3-vl-plus","roles":["vision"]},
    {"id":"mistralai/mistral-medium-3.5","roles":["synthesizer"]},
    {"id":"deepseek/deepseek-v4-flash","roles":["fallback","lightweight"]},
    {"id":"mistralai/mistral-large-2512","roles":["fallback"]},
    {"id":"minimax/minimax-m2.7","roles":["lightweight"]}
  ]'::jsonb,
  0
)
on conflict (name) do nothing;