# BROW PWA — arquitetura e contratos

Atualizado em 13/08/2026.

Produção isolada: `https://brow-dashboard.clienteswell.workers.dev/pwa/`.
O Worker de fachada serve os ativos e executa `/api/*` antes do fallback da
SPA. O projeto Pages legado continua apenas como compatibilidade visual até a
configuração de Functions desse projeto ser substituída.

## Fonte única de dados

O PWA e o dashboard acessam `/api/hermes/*`. A Pages Function mantém o segredo
fora do navegador e encaminha a requisição para `/api/dashboard/*` no Worker.
O Telegram usa diretamente o mesmo Worker. Supabase é a fonte persistente para
mensagens, memórias, agenda, tarefas, metas, contatos, finanças, documentos,
automações e skills; R2 guarda os arquivos.

`localStorage` pode ser usado como cache de apresentação, nunca como fonte
autoritativa para esses domínios.

## Camadas móveis isoladas

- `public/pwa/pwa.css`: estilos legados compartilhados pela interface.
- `public/pwa/pwa-mobile.css`: shell responsivo, viewport única e regras móveis.
- `public/pwa/pwa.js`: recursos de voz, telemetria, chat e renderizadores legados.
- `public/pwa/pwa-sync.js`: ponte de sincronização com a API; substitui CRUDs
  locais sem alterar o cérebro central.

## Contratos principais

| Domínio | Endpoint | Persistência |
| --- | --- | --- |
| Chat | `GET chat-history`, `POST /api/chat` | `hermes_cloud_messages` |
| Memória | `GET/POST/PATCH/DELETE memories` | `hermes_cloud_memories`, fatos e resumos |
| Agenda | `GET/POST/PATCH/DELETE agenda` | `hermes_cloud_agenda` |
| Tarefas | `GET/POST/PATCH/DELETE tasks` | `hermes_cloud_tasks` |
| Metas | `GET/POST/PATCH/DELETE goals` | `hermes_cloud_goals` |
| Contatos | `GET/POST/PATCH/DELETE contacts` | `hermes_cloud_contacts` |
| Documentos | `documents/upload`, `documents/:id/file` | Supabase + R2 |
| Automações | `GET/POST/PATCH/DELETE automations` | `hermes_cloud_automations` |
| Skills | `GET/POST skills`, `PATCH skills/:key` | `hermes_cloud_skills` |

## Travas

- O browser nunca recebe `service_role` nem o segredo do dashboard.
- Toda consulta do Worker é limitada ao `chat_id` proprietário.
- Exclusões exigem confirmação na interface.
- “Limpar chat” limpa somente a projeção local; não apaga a memória compartilhada.
- A exclusão de documento remove primeiro o objeto do R2 e depois o registro.
- A interface não deve exibir dados simulados quando telemetria ou API estiverem indisponíveis.

## Verificação antes do deploy

1. `npm run check` e `npm test` em `cloud/hermes-worker`.
2. `node --check public/pwa/pwa-sync.js`.
3. Testar viewport de 390 × 844 sem overflow horizontal.
4. Abrir cada item do menu e confirmar que somente uma view fica ativa.
5. Confirmar CRUD no PWA e leitura correspondente no dashboard/Telegram.
