# Hermes Cloud Free

Variante gratuita e isolada do Hermes para Cloudflare Workers, Telegram,
Supabase e o bucket R2 `hermes-agent-storage`.

## Garantias

- Não usa Cloudflare Containers nem qualquer plano pago.
- A conta permanece no Workers Free; ao atingir uma franquia gratuita, o
  recurso deve interromper em vez de fazer upgrade.
- Não acessa nem altera `valia-storage`, `valia-worker`,
  `valia-worker-production` ou `valia-dashboard`.
- Segredos são configurados somente com `wrangler secret put`.
- O Worker aceita apenas webhooks Telegram autenticados e usuários permitidos.
- As tabelas Supabase têm RLS habilitado, sem políticas públicas, e acesso
  concedido somente a `service_role`.

## Limitações deliberadas

O runtime gratuito não executa o núcleo Python residente do Hermes. Terminal,
Playwright, Whisper local, cron residente e ferramentas de desktop permanecem
na instalação local. A edição cloud mantém conversa textual, histórico,
Telegram e armazenamento R2.

## Recursos

- Worker: `hermes-cloud-free`
- URL: `https://hermes-cloud-free.clienteswell.workers.dev`
- Supabase: `Brow` (`yfnkfoourakhjydvliuv`)
- R2: `hermes-agent-storage`
- Rotas: `GET /` e `POST /telegram`

## Contratos de comportamento

### Notícias e pesquisa atual

- Pedidos de notícias passam por um atalho determinístico antes do modelo.
- Toda notícia deve trazer conteúdo útil além do título, a fonte editorial e
  uma URL verificável. O usuário não precisa pedir "links" explicitamente.
- A ordem de fallback é: Google Grounding (somente quando devolve fontes),
  RSS editorial com descrição/link e busca web real. Se nenhuma fonte real
  responder, o Hermes informa a falha; não completa com fatos inventados.
- O endpoint do painel é `GET /api/dashboard/news?category=...&query=...`.

Perguntas factuais sobre clubes conhecidos passam antes pelo motor isolado
`src/search_specialist.ts`. Ele pesquisa e sintetiza diretamente placar,
adversário, data, competição, posição e competições em disputa conforme a
pergunta. Páginas agregadoras com texto como "acompanhe as notícias" são
rejeitadas. Se as fontes não confirmarem os dados, o motor declara a falha em
vez de cair na antiga lista de capas/matérias.

Áudios do Telegram são transcritos apenas internamente. A transcrição completa
não é mais enviada como uma mensagem `Entendi: "..."`; o usuário recebe somente
a resposta ao pedido, evitando eco de saudações, repetições e hesitações.

### Memória e fotos

Os comandos abaixo funcionam no Telegram, dashboard e PWA antes do LLM:

- `grave na memória que ...` salva uma memória manual;
- `mostre minhas memórias` lista as memórias manuais recentes e seus IDs;
- `exclua a memória sobre ...` apaga somente quando há um único resultado;
- `/memoria <termo>` pesquisa conversa e memória visual semanticamente;
- `/foto <termo>` (ou `mostre a foto de ...`) recupera até três fotos salvas
  no Telegram usando o `telegram_file_id` persistido.

Pedidos vagos para apagar tudo não são executados pelo chat. Exclusão em lote
fica na aba Memória e exige confirmação. Fotos recebidas são armazenadas no R2;
descrição/OCR, embedding, chave R2 e `telegram_file_id` ficam no Supabase.

Consultas como "qual é a minha agenda amanhã?" nunca são tratadas como comando
de criação. Criação exige verbo explícito, como `agende`, `marque` ou `crie`.

## Validação antes do deploy

Na pasta `cloud/hermes-worker`:

```powershell
npm.cmd test
npm.cmd run check
npx.cmd wrangler deploy --dry-run
```

Os testes em `src/shared.test.ts` cobrem preservação de conteúdo/link do RSS,
fontes obrigatórias nas notícias, consulta de agenda sem criação acidental e
operações seguras de memória. Segredos nunca entram no repositório; configure-os
com `wrangler secret put`.
