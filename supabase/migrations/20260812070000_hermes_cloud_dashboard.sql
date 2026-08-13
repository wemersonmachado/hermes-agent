-- Backend do dashboard/PWA do Hermes: 8 domínios que ainda não existiam
-- (tasks, goals, agenda, contacts, finance, documents, automations, skills).
-- Mesmo padrão de isolamento das tabelas hermes_cloud_* existentes: RLS on,
-- sem acesso anon/authenticated, só service_role (usado pelo Worker).

create table if not exists public.hermes_cloud_tasks (
  id bigint generated always as identity primary key,
  chat_id text not null,
  title text not null,
  done boolean not null default false,
  due_date date,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

create table if not exists public.hermes_cloud_goals (
  id bigint generated always as identity primary key,
  chat_id text not null,
  title text not null,
  unit text not null default '',
  target_value numeric not null default 0,
  current_value numeric not null default 0,
  due_date date,
  created_at timestamptz not null default now()
);

create table if not exists public.hermes_cloud_agenda (
  id bigint generated always as identity primary key,
  chat_id text not null,
  title text not null,
  description text not null default '',
  starts_at timestamptz not null,
  ends_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.hermes_cloud_contacts (
  id bigint generated always as identity primary key,
  chat_id text not null,
  name text not null,
  phone text not null default '',
  email text not null default '',
  notes text not null default '',
  created_at timestamptz not null default now()
);

create table if not exists public.hermes_cloud_finance_entries (
  id bigint generated always as identity primary key,
  chat_id text not null,
  kind text not null check (kind in ('income', 'expense')),
  category text not null default 'geral',
  amount_cents bigint not null,
  description text not null default '',
  occurred_at date not null default current_date,
  created_at timestamptz not null default now()
);

create table if not exists public.hermes_cloud_documents (
  id bigint generated always as identity primary key,
  chat_id text not null,
  r2_key text not null,
  filename text not null,
  mime_type text not null default 'application/octet-stream',
  extracted_text text not null default '',
  embedding vector(1024),
  created_at timestamptz not null default now()
);

create table if not exists public.hermes_cloud_automations (
  id bigint generated always as identity primary key,
  chat_id text not null,
  name text not null,
  trigger_type text not null default 'manual',
  trigger_config jsonb not null default '{}'::jsonb,
  action_type text not null default 'notify',
  action_config jsonb not null default '{}'::jsonb,
  enabled boolean not null default true,
  last_run_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.hermes_cloud_skills (
  id bigint generated always as identity primary key,
  chat_id text not null,
  key text not null,
  label text not null,
  description text not null default '',
  enabled boolean not null default true,
  updated_at timestamptz not null default now(),
  unique (chat_id, key)
);

create index if not exists hermes_cloud_tasks_chat_idx on public.hermes_cloud_tasks (chat_id, done);
create index if not exists hermes_cloud_goals_chat_idx on public.hermes_cloud_goals (chat_id);
create index if not exists hermes_cloud_agenda_chat_idx on public.hermes_cloud_agenda (chat_id, starts_at);
create index if not exists hermes_cloud_contacts_chat_idx on public.hermes_cloud_contacts (chat_id);
create index if not exists hermes_cloud_finance_chat_idx on public.hermes_cloud_finance_entries (chat_id, occurred_at desc);
create index if not exists hermes_cloud_documents_chat_idx on public.hermes_cloud_documents (chat_id, created_at desc);
create index if not exists hermes_cloud_documents_embedding_idx
  on public.hermes_cloud_documents using ivfflat (embedding vector_cosine_ops) with (lists = 100);
create index if not exists hermes_cloud_automations_chat_idx on public.hermes_cloud_automations (chat_id);
create index if not exists hermes_cloud_skills_chat_idx on public.hermes_cloud_skills (chat_id);

do $$
declare
  t text;
begin
  foreach t in array array[
    'hermes_cloud_tasks', 'hermes_cloud_goals', 'hermes_cloud_agenda',
    'hermes_cloud_contacts', 'hermes_cloud_finance_entries',
    'hermes_cloud_documents', 'hermes_cloud_automations', 'hermes_cloud_skills'
  ]
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on table public.%I from anon, authenticated', t);
    execute format('grant select, insert, update, delete on table public.%I to service_role', t);
    execute format('grant usage, select on sequence public.%I_id_seq to service_role', t);
  end loop;
end $$;

create or replace function public.match_hermes_documents(
  query_embedding vector(1024),
  target_chat_id text,
  match_count int default 5
)
returns table (filename text, extracted_text text, created_at timestamptz, similarity float)
language sql stable
as $$
  select filename, extracted_text, created_at,
         1 - (embedding <=> query_embedding) as similarity
  from public.hermes_cloud_documents
  where chat_id = target_chat_id
    and embedding is not null
  order by embedding <=> query_embedding
  limit match_count;
$$;

revoke all on function public.match_hermes_documents from anon, authenticated;
grant execute on function public.match_hermes_documents to service_role;
