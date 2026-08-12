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
