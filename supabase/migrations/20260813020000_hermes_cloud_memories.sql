-- Memórias manuais criadas pela aba "Memória" do dashboard (além das
-- memórias automáticas: fatos extraídos da conversa e resumos periódicos,
-- que continuam vivendo em hermes_cloud_facts / hermes_cloud_summaries).
create table if not exists hermes_cloud_memories (
  id uuid primary key default gen_random_uuid(),
  chat_id text not null,
  title text not null,
  summary text,
  main_category text,
  category text,
  priority text,
  tags jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);

alter table hermes_cloud_memories enable row level security;
revoke all on hermes_cloud_memories from anon, authenticated;
grant all on hermes_cloud_memories to service_role;

create index if not exists hermes_cloud_memories_chat_id_idx on hermes_cloud_memories (chat_id, created_at desc);
