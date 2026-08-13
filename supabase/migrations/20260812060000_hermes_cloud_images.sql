-- Memória visual: toda imagem recebida é descrita (visão + OCR) por Workers
-- AI, o arquivo original vai pro R2, e a descrição+texto extraído ganham
-- embedding pra virar pesquisável junto com o resto da memória.

create table if not exists public.hermes_cloud_images (
  id bigint generated always as identity primary key,
  chat_id text not null,
  user_id text not null,
  telegram_file_id text not null,
  r2_key text not null,
  description text not null,
  ocr_text text not null default '',
  embedding vector(1024),
  created_at timestamptz not null default now()
);

create index if not exists hermes_cloud_images_chat_idx on public.hermes_cloud_images (chat_id, created_at desc);
create index if not exists hermes_cloud_images_embedding_idx
  on public.hermes_cloud_images using ivfflat (embedding vector_cosine_ops)
  with (lists = 100);

alter table public.hermes_cloud_images enable row level security;
revoke all on table public.hermes_cloud_images from anon, authenticated;
grant select, insert, update, delete on table public.hermes_cloud_images to service_role;
grant usage, select on sequence public.hermes_cloud_images_id_seq to service_role;

create or replace function public.match_hermes_images(
  query_embedding vector(1024),
  target_chat_id text,
  match_count int default 4
)
returns table (description text, ocr_text text, created_at timestamptz, similarity float)
language sql stable
as $$
  select description, ocr_text, created_at,
         1 - (embedding <=> query_embedding) as similarity
  from public.hermes_cloud_images
  where chat_id = target_chat_id
    and embedding is not null
  order by embedding <=> query_embedding
  limit match_count;
$$;

revoke all on function public.match_hermes_images from anon, authenticated;
grant execute on function public.match_hermes_images to service_role;
