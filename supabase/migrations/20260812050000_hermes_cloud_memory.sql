-- Memória de longo prazo do Hermes Cloud Free: semântica (embeddings),
-- resumos episódicos (semanal/mensal, gerados sob demanda) e grafo de
-- entidades. A janela de sessão (contexto corrido) já existe em
-- hermes_cloud_messages; esta migration adiciona as camadas restantes.

create extension if not exists vector;

-- Semântica: cada mensagem passa a carregar seu embedding (bge-m3, 1024
-- dimensões), permitindo busca por similaridade além da janela corrida.
alter table public.hermes_cloud_messages
  add column if not exists embedding vector(1024);

create index if not exists hermes_cloud_messages_embedding_idx
  on public.hermes_cloud_messages using ivfflat (embedding vector_cosine_ops)
  with (lists = 100);

-- Episódica: resumos semanais/mensais gerados sob demanda (/resumo) e
-- cacheados — não recalcula o período inteiro toda vez que é pedido.
create table if not exists public.hermes_cloud_summaries (
  id bigint generated always as identity primary key,
  chat_id text not null,
  period text not null check (period in ('week', 'month')),
  period_start date not null,
  period_end date not null,
  content text not null,
  embedding vector(1024),
  message_count integer not null default 0,
  created_at timestamptz not null default now(),
  unique (chat_id, period, period_start)
);

-- Grafo: entidades citadas nas conversas e as relações entre elas,
-- extraídas sob demanda (/grafo) a partir do histórico.
create table if not exists public.hermes_cloud_entities (
  id bigint generated always as identity primary key,
  chat_id text not null,
  name text not null,
  type text not null default 'other',
  mention_count integer not null default 1,
  first_seen timestamptz not null default now(),
  last_seen timestamptz not null default now(),
  unique (chat_id, name)
);

create table if not exists public.hermes_cloud_entity_edges (
  id bigint generated always as identity primary key,
  chat_id text not null,
  source_entity_id bigint not null references public.hermes_cloud_entities (id) on delete cascade,
  target_entity_id bigint not null references public.hermes_cloud_entities (id) on delete cascade,
  relation text not null,
  evidence text,
  created_at timestamptz not null default now()
);

create index if not exists hermes_cloud_entities_chat_idx on public.hermes_cloud_entities (chat_id);
create index if not exists hermes_cloud_entity_edges_chat_idx on public.hermes_cloud_entity_edges (chat_id);

alter table public.hermes_cloud_summaries enable row level security;
alter table public.hermes_cloud_entities enable row level security;
alter table public.hermes_cloud_entity_edges enable row level security;

revoke all on table public.hermes_cloud_summaries from anon, authenticated;
revoke all on table public.hermes_cloud_entities from anon, authenticated;
revoke all on table public.hermes_cloud_entity_edges from anon, authenticated;

grant select, insert, update, delete on table public.hermes_cloud_summaries to service_role;
grant select, insert, update, delete on table public.hermes_cloud_entities to service_role;
grant select, insert, update, delete on table public.hermes_cloud_entity_edges to service_role;
grant usage, select on sequence public.hermes_cloud_summaries_id_seq to service_role;
grant usage, select on sequence public.hermes_cloud_entities_id_seq to service_role;
grant usage, select on sequence public.hermes_cloud_entity_edges_id_seq to service_role;

-- Busca semântica: dado um embedding de consulta, devolve as mensagens mais
-- parecidas de um chat (cosine similarity), fora da janela corrida recente.
create or replace function public.match_hermes_memories(
  query_embedding vector(1024),
  target_chat_id text,
  match_count int default 5,
  exclude_recent int default 20
)
returns table (content text, role text, created_at timestamptz, similarity float)
language sql stable
as $$
  select content, role, created_at,
         1 - (embedding <=> query_embedding) as similarity
  from public.hermes_cloud_messages
  where chat_id = target_chat_id
    and embedding is not null
    and id not in (
      select id from public.hermes_cloud_messages
      where chat_id = target_chat_id
      order by created_at desc
      limit exclude_recent
    )
  order by embedding <=> query_embedding
  limit match_count;
$$;

revoke all on function public.match_hermes_memories from anon, authenticated;
grant execute on function public.match_hermes_memories to service_role;
