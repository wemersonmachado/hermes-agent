-- Telemetria em tempo real: PC (script local via psutil) e celular (PWA,
-- APIs do navegador). Sempre um snapshot por (chat_id, source) — não é log
-- histórico, é "estado atual", sobrescrito a cada nova leitura.

create table if not exists public.hermes_cloud_telemetry (
  id bigint generated always as identity primary key,
  chat_id text not null,
  source text not null check (source in ('pc', 'phone')),
  payload jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  last_alert_at timestamptz,
  unique (chat_id, source)
);

create index if not exists hermes_cloud_telemetry_chat_idx on public.hermes_cloud_telemetry (chat_id, source);

alter table public.hermes_cloud_telemetry enable row level security;
revoke all on table public.hermes_cloud_telemetry from anon, authenticated;
grant select, insert, update, delete on table public.hermes_cloud_telemetry to service_role;
grant usage, select on sequence public.hermes_cloud_telemetry_id_seq to service_role;
