# Brow — Cloud Free

Variante gratuita e isolada do Hermes para Cloudflare Workers, Telegram,
Supabase e o bucket R2 `hermes-agent-storage`.

> **Identidade pública:** o agente se chama **Brow**. `Hermes` permanece apenas
> em nomes técnicos legados (rotas, tabelas, bindings e projeto Cloudflare),
> cuja troca quebraria compatibilidade com dados e clientes existentes.

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

### Identidade e personalidade

A fonte única da identidade é `src/identity.ts`, compartilhada por todas as
chamadas ao modelo. Brow é sereno, elegante, preciso, proativo e usa humor seco
somente quando apropriado. Ele começa pelo resultado, separa fato, inferência e
ação executada, não bajula, não finge capacidades e confirma ações destrutivas.
Essa é uma personalidade original inspirada em qualidades gerais de assistentes
futuristas; Brow não imita personagens, não recita bordões e nunca se apresenta
como JARVIS. O prefixo é determinístico para preservar o cache de prompt.

### Notícias e pesquisa atual

- Pedidos de notícias passam por um atalho determinístico antes do modelo.
- Toda notícia deve trazer conteúdo útil além do título, a fonte editorial e
  uma URL verificável. O usuário não precisa pedir "links" explicitamente.
- O orquestrador isolado `src/research_engine.ts` consulta em paralelo Google
  Grounding, Google News RSS, GDELT, RSS editorial e busca web/comunidades. Cada
  provedor tem orçamento de 4,5 s; falha ou lentidão de uma fonte não bloqueia
  as demais. Resultados são deduplicados, classificados por relevância e
  recência e limitados por domínio para preservar diversidade.
- Respostas só são emitidas quando existe ao menos uma URL HTTP(S) verificável.
  Se nenhuma fonte real responder, o Brow informa a falha; não completa com
  fatos inventados. O dashboard recebe também `researchAudit` com consulta,
  latência, contagem por provedor e número de fontes selecionadas.
- Em modo notícia, recência é requisito, não apenas preferência: resultados
  sem data ou com mais de 14 dias são descartados. Google News recebe janela
  explícita de 7 dias e GDELT usa `timespan=1week`. Isso impede que matérias
  de 2020/2021 sejam apresentadas como atuais.
- O endpoint do painel é `GET /api/dashboard/news?category=...&query=...`.

Todas as pesquisas textuais passam por `src/search_query.ts` antes de chamar
qualquer provedor. O refinador remove saudações, comandos ("busque", "pesquise",
"procure"), pedidos de cortesia, interjeições e ruído comum de transcrição,
preservando o assunto e suas entidades. Consultas são limitadas a 14 termos
para impedir que uma fala inteira vire query literal; pedidos gerais de
notícias não ganham um tópico falso. Exemplos:

- `Busque por desenvolvimento de carros autônomos` →
  `desenvolvimento de carros autônomos`;
- `Bom dia, bro, traz uma notícia pra mim sobre baterias, pô` → `baterias`.
- `Me traga um resumo das da Bolsa de Valores do Brasil da semana passada` →
  `Bolsa de Valores do Brasil da semana passada`.

Toda fonte em respostas conversacionais usa o rótulo compacto
`[Clique aqui para ler](URL)`. O Telegram converte somente esse marcador em
HTML seguro e desativa a prévia longa; o dashboard o converte em link com nova
aba. URLs cruas não devem voltar a ser adicionadas aos formatadores de notícia,
busca geral ou pesquisa esportiva.

Perguntas factuais sobre clubes conhecidos passam antes pelo motor isolado
`src/search_specialist.ts`. Ele pesquisa e sintetiza diretamente placar,
adversário, data, competição, posição e competições em disputa conforme a
pergunta. Páginas agregadoras com texto como "acompanhe as notícias" são
rejeitadas. Se as fontes não confirmarem os dados, o motor declara a falha em
vez de cair na antiga lista de capas/matérias.

Para o Flamengo, o motor prioriza dados esportivos estruturados. A fonte
primária usa o host server-to-server da Sofascore; se o datacenter bloquear a
consulta, o fallback independente TheSportsDB combina os endpoints de últimos
e próximos eventos, promove jogos recém-encerrados que ainda estejam na fila de
"próximos" e consulta a tabela da temporada. Somente depois vêm mecanismos de
pesquisa textual para entidades futuras sem provedor estruturado. Para times já
mapeados, falha dos dois provedores encerra com mensagem honesta: snippets de
portais nunca podem inventar placar ou posição.

Áudios do Telegram são transcritos apenas internamente. A transcrição completa
não é mais enviada como uma mensagem `Entendi: "..."`; o usuário recebe somente
a resposta ao pedido, evitando eco de saudações, repetições e hesitações.
O STT usa Whisper Large V3 Turbo no Workers AI e, quando configurado, uma
segunda transcrição independente no Groq. Versões divergentes passam por uma
reconciliação restrita que pode corrigir palavras, mas não acrescentar pedidos
ou intenções. Telegram, dashboard e PWA compartilham exatamente esse pipeline.

Pedidos como `gere o áudio`, `manda em áudio`, `responda por voz` e `quero
ouvir` são reconhecidos deterministicamente em `src/voice_intent.ts`. Um pedido
curto de repetição transforma diretamente a última resposta em voz, sem nova
pesquisa, reconstrução de contexto ou chamada ao modelo. O TTS usa primeiro o
binding nativo Workers AI e mantém Edge/Gemini como fallbacks; cada resultado
carrega seu MIME e extensão reais para o Telegram não receber WAV rotulado como
MP3. A modalidade é exclusiva: quando voz é solicitada, a resposta é enviada
somente como mensagem de voz, nunca duplicada em texto. Falhas nunca são
escondidas atrás de uma promessa textual de áudio.

O webhook aguarda a confirmação final do Telegram antes de responder. O
processamento não fica mais pendurado em `waitUntil`, cuja janela podia terminar
depois do texto e antes do TTS. Reentregas continuam idempotentes por
`claimUpdate`.

Para manter a voz responsiva no plano gratuito, respostas solicitadas em áudio
priorizam o fato principal e são limitadas a 25 palavras/150 caracteres antes
da síntese. Isso evita que a geração de uma fala longa mantenha o usuário sem
qualquer resposta por 30–45 segundos. O evento estruturado `tts_delivered`
registra separadamente tempos de síntese e entrega ao Telegram.

### Latência

O contexto recente e os fatos estáveis continuam presentes em toda conversa.
A recuperação semântica de longo prazo — embedding mais duas consultas RPC —
só roda quando a mensagem se refere a memória, conversa anterior, fotos ou
documentos (`src/context_policy.ts`). Quando necessária, memória textual e
visual reutilizam um único embedding. Isso preserva o cérebro central e remove
inferências e I/O desnecessários do caminho comum de resposta.

### Agenda e lembretes

Um Cron Trigger executa a cada cinco minutos e entrega no Telegram eventos que
chegaram ao horário e tarefas com prazo no dia. A idempotência fica isolada no
R2 (`reminders/sent/...`): o registro só é criado depois que o Telegram aceita
a mensagem, sem alterar tabelas, memória ou o cérebro central.

### Telemetria

Telemetria de PC e telefone é armazenada para visualização exclusiva no PWA e
dashboard. O endpoint de ingestão não envia alertas, métricas ou sugestões ao
Telegram. Essa separação é um contrato: futuras notificações de telemetria não
devem ser adicionadas a adaptadores de mensageria.

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

Os testes em `src/shared.test.ts`, `src/search_query.test.ts` e
`src/research_engine.test.ts` cobrem preservação de conteúdo/link do RSS,
fontes obrigatórias, refinamento de fala, auditoria multi-fonte, rejeição de
URLs inseguras, agenda e memória. Segredos nunca entram no repositório;
configure-os com `wrangler secret put`.
