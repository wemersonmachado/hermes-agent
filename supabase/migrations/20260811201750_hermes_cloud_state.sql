create table if not exists public.hermes_cloud_updates (
  update_id bigint primary key,
  status text not null check (status in ('processing', 'done', 'ignored', 'unauthorized', 'error')),
  received_at timestamptz not null default now(),
  finished_at timestamptz
);

create table if not exists public.hermes_cloud_messages (
  id bigint generated always as identity primary key,
  chat_id text not null,
  user_id text not null,
  telegram_message_id bigint,
  role text not null check (role in ('user', 'assistant')),
  content text not null check (char_length(content) <= 20000),
  created_at timestamptz not null default now()
);

create index if not exists hermes_cloud_messages_chat_created_idx
  on public.hermes_cloud_messages (chat_id, created_at desc);

alter table public.hermes_cloud_updates enable row level security;
alter table public.hermes_cloud_messages enable row level security;

revoke all on table public.hermes_cloud_updates from anon, authenticated;
revoke all on table public.hermes_cloud_messages from anon, authenticated;
revoke all on sequence public.hermes_cloud_messages_id_seq from anon, authenticated;

grant select, insert, update, delete on table public.hermes_cloud_updates to service_role;
grant select, insert, update, delete on table public.hermes_cloud_messages to service_role;
grant usage, select on sequence public.hermes_cloud_messages_id_seq to service_role;
