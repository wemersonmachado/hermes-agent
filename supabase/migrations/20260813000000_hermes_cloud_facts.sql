-- Memória de fatos estáveis (nome, preferências, dados pessoais declarados).
-- Diferente da memória semântica (busca por similaridade, pode falhar
-- quando a pergunta é parecida com outra pergunta antiga em vez da
-- resposta) -- fatos ficam sempre disponíveis no contexto, sem depender de
-- ranking de similaridade.

create table if not exists public.hermes_cloud_facts (
  id bigint generated always as identity primary key,
  chat_id text not null,
  key text not null,
  value text not null,
  updated_at timestamptz not null default now(),
  unique (chat_id, key)
);

create index if not exists hermes_cloud_facts_chat_idx on public.hermes_cloud_facts (chat_id);

alter table public.hermes_cloud_facts enable row level security;
revoke all on table public.hermes_cloud_facts from anon, authenticated;
grant select, insert, update, delete on table public.hermes_cloud_facts to service_role;
grant usage, select on sequence public.hermes_cloud_facts_id_seq to service_role;
