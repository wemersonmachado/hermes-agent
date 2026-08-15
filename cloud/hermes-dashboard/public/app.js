// BROW Dashboard — talks to /api/hermes/* (FastAPI proxy → Cloudflare Worker
// Dashboard API → the SAME R2/Supabase data the Telegram bot reads/writes).
// No local fake state: every create/edit/delete here is a real network call.
document.addEventListener("DOMContentLoaded", () => {
    fetchCloudStatus();
    setInterval(() => { if (!document.hidden) fetchCloudStatus(); }, 60000);
    initCustomNewsTopics();
    loadDashboardOverview();
    renderScheduledSearches();
    loadScheduledBriefings();
    loadChatMessagesFromStorage();
    initPcTelemetry();
    setTimeout(() => { initNeuralCoreCanvas(); initNeuralWaveCanvas(); }, 300);
    // Sempre direcionar para Cérebro Central ("voz") como a PRIMEIRA página do dashboard!
    switchMainTab('voz');
    initChatHistorySync();
    initFinanceSync();
    initHermesAliveness();
    initPlanningHubDesk();
});

/* ── SYNC DE CHAT ENTRE DASHBOARD / PWA / TELEGRAM (07/08/2026) ──
   Achado: o dashboard e o PWA guardavam a conversa só em localStorage do
   navegador (mesma chave, mas por dispositivo -- nunca sincronizava um com
   o outro, e o Telegram nem aparecia). Agora o Worker (chat-history.ts) é a
   fonte compartilhada; localStorage vira cache local só pra abrir rápido.
   Polling a cada 3s (não WebSocket/SSE/Durable Objects -- decisão de
   escopo: reaproveita o mesmo padrão já testado pela telemetria em vez de
   introduzir infraestrutura nova) -- na prática, mensagem enviada em outro
   canal aparece aqui em até ~3s. */
const CHAT_SYNC_CHANNEL = 'dashboard';
const CHAT_SYNC_LAST_ID_KEY = 'hermes_chat_sync_last_id';
let chatSyncLastId = localStorage.getItem(CHAT_SYNC_LAST_ID_KEY) || null;
let chatSyncPolling = false;

function mapSharedHistoryMessage(m) {
    return {
        id: m.id,
        text: m.text,
        sender: m.role === 'user' ? (m.channel === 'telegram' ? '👤 Você (Telegram)' : '👤 Você (PWA)') : '✈️ BROW',
        isUser: m.role === 'user',
        timestamp: formatTelegramTime(new Date(m.createdAt)),
    };
}

// Achado real 10/08/2026 (print do usuário: resposta fabricada antiga do
// Flamengo, já purgada do histórico compartilhado no Worker, continuava
// aparecendo pra sempre neste PWA): `chatSyncLastId` persiste no
// localStorage ENTRE sessões -- "primeira sincronização" só acontecia uma
// vez na vida daquele navegador. Depois disso, todo load seguinte só
// buscava mensagens NOVAS (?sinceId=) e nunca reconciliava o que já estava
// desenhado na tela com o estado real do servidor -- se o servidor mudou
// por qualquer motivo (purga admin, edição, o usuário abriu de outro canal
// primeiro), o cache local ficava divergente PRA SEMPRE, e essa era a raiz
// real de "PWA/Dashboard/Telegram não são as mesmas conversas". Servidor
// (R2, ver chat-history.ts) é a única fonte de verdade -- toda ABERTURA do
// app agora busca o histórico completo e SUBSTITUI o estado local, em vez
// de só confiar em cache; o polling de 3s continua incremental depois disso.
async function fullReconcileChatHistory() {
    try {
        const res = await fetch('/api/hermes/chat-history');
        if (!res.ok) return;
        const data = await res.json();
        const messages = data.messages || [];
        if (messages.length) {
            voiceChatHistoryMessages = messages.map(mapSharedHistoryMessage);
            saveChatMessagesToStorage();
            renderAllVoiceChatMessages();
            chatSyncLastId = messages[messages.length - 1].id;
            localStorage.setItem(CHAT_SYNC_LAST_ID_KEY, chatSyncLastId);
        }
    } catch (e) { /* servidor fora agora -- mantém cache local, tenta de novo no próximo load */ }
}

async function pollChatHistorySync() {
    if (chatSyncPolling) return;
    chatSyncPolling = true;
    try {
        if (!chatSyncLastId) { await fullReconcileChatHistory(); return; }
        const res = await fetch(`/api/hermes/chat-history?sinceId=${encodeURIComponent(chatSyncLastId)}`);
        if (!res.ok) return;
        const data = await res.json();
        const messages = data.messages || [];
        const incoming = messages.filter(m => m.channel !== CHAT_SYNC_CHANNEL);
        if (incoming.length) {
            voiceChatHistoryMessages.push(...incoming.map(mapSharedHistoryMessage));
            saveChatMessagesToStorage();
            renderAllVoiceChatMessages();
        }
        if (messages.length) {
            chatSyncLastId = messages[messages.length - 1].id;
            localStorage.setItem(CHAT_SYNC_LAST_ID_KEY, chatSyncLastId);
        }
    } catch (e) { /* silencioso -- tenta de novo no próximo tick */ }
    finally { chatSyncPolling = false; }
}

function initChatHistorySync() {
    fullReconcileChatHistory().finally(() => {
        pollChatHistorySync();
        setInterval(() => { if (!document.hidden) pollChatHistorySync(); }, 30000);
    });
}

let globalMemories = [];
let globalFinances = [];
let globalAgenda = [];

let selectedMemoryIds = new Set();
let selectedAgendaKeys = new Set();

/* ── HELPER DE CÁLCULO DE DIAS RELATIVOS (DAQUI A X DIAS) ── */
function setDaysAhead(days, targetInputId) {
    const daysInt = parseInt(days, 10);
    if (isNaN(daysInt) || daysInt < 1) return;
    const d = new Date();
    d.setDate(d.getDate() + daysInt);
    const formatted = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const input = document.getElementById(targetInputId);
    if (input) input.value = formatted;
}

/* ── Mobile Sidebar Drawer ────────────────────────────── */
function toggleMobileSidebar() {
    const sidebar = document.getElementById('sidebar');
    const overlay = document.getElementById('sidebar-overlay');
    if (!sidebar || !overlay) return;
    if (sidebar.classList.contains('mobile-open')) closeMobileSidebar();
    else { sidebar.classList.add('mobile-open'); overlay.classList.add('active'); }
}
function closeMobileSidebar() {
    const sidebar = document.getElementById('sidebar');
    const overlay = document.getElementById('sidebar-overlay');
    if (sidebar) sidebar.classList.remove('mobile-open');
    if (overlay) overlay.classList.remove('active');
}

/* ── Main Tab Switching — loads real data for the tab being opened ── */
function switchMainTab(tabId, el) {
    const requestedTab = tabId;
    if (['agenda', 'metas', 'tarefas', 'planejamento'].includes(tabId)) tabId = 'agenda';
    closeMobileSidebar();
    document.querySelectorAll('.sidebar .nav-item').forEach(item => item.classList.remove('active'));
    if (el) el.classList.add('active');
    else { const nav = document.querySelector(`.sidebar .nav-item[data-tab="${requestedTab}"]`); if (nav) nav.classList.add('active'); }

    document.querySelectorAll('.main-tab-view').forEach(view => view.classList.remove('active'));
    const targetView = document.getElementById(`view-${tabId}`);
    (targetView || document.getElementById('view-dashboard')).classList.add('active');

    const loaders = {
        dashboard: () => { loadDashboardOverview(); loadDashboardNews(); },
        memoria: loadMemories,
        agenda: () => Promise.all([loadAgenda(), loadMetas(), loadTarefas()]),
        financas: loadFinances,
        documentos: loadDocumentsDesk,
        contatos: loadContactsDesk,
        automacao: () => { loadCloudStatusView(); loadLocationSettings(); },
        skills: loadSkills,
    };
    if (loaders[tabId]) loaders[tabId]();
}

function initPlanningHubDesk() {
    const first = document.getElementById('view-agenda');
    if (!first || document.getElementById('planning-hub-ready')) return;
    const parent = first.parentElement;
    const wasActive = first.classList.contains('active');
    first.id = 'view-agenda-source';
    const hub = document.createElement('div');
    hub.id = 'view-agenda';
    hub.className = `main-tab-view${wasActive ? ' active' : ''}`;
    hub.dataset.planningHubReady = 'true';
    hub.innerHTML = '<section class="card"><div class="card-hd"><h2 class="card-title">Planejamento: agenda, tarefas e metas</h2><span class="badge badge-info">Tudo em um só lugar</span></div><p class="text-muted">Compromissos, execução diária e objetivos usam os mesmos dados do BROW e do Telegram.</p></section>';
    for (const [id, legacy] of [['agenda', first], ['tarefas', document.getElementById('view-tarefas')], ['metas', document.getElementById('view-metas')]]) {
        const content = legacy?.querySelector('.tab-grid-2col');
        if (content) {
            const heading = document.createElement('h3');
            heading.className = 'card-title';
            heading.style.margin = '16px 0 10px';
            heading.textContent = id === 'agenda' ? 'Compromissos' : id === 'tarefas' ? 'Tarefas' : 'Metas';
            hub.appendChild(heading);
            hub.appendChild(content);
        }
        legacy?.remove();
    }
    document.querySelectorAll('.nav-item[data-tab="metas"], .nav-item[data-tab="tarefas"]').forEach(item => item.remove());
    parent?.appendChild(hub);
}

/* ── BROW Cloud status ───────────────────────────────────────── */
async function fetchCloudStatus() {
    const badge = document.getElementById('wa-status-badge');
    const box = document.getElementById('wa-qr-container');
    const infoText = document.getElementById('wa-info-text');
    try {
        const res = await fetch('/api/hermes/status');
        if (!res.ok) throw new Error('offline');
        const data = await res.json();
        const providers = Object.keys(data.health || {});
        const ready = providers.filter(p => !data.health[p].cooldownUntil || Date.parse(data.health[p].cooldownUntil) <= Date.now());
        if (badge) { badge.className = 'badge badge-success'; badge.textContent = '🟢 BROW Cloud online'; }
        if (box) box.innerHTML = `
            <div style="display:flex;flex-direction:column;align-items:center;gap:6px;padding:8px;">
                <span style="font-size:28px;">☁️</span>
                <span style="color:#22C55E;font-weight:700;font-size:12px;">Worker de produção ativo</span>
                <span style="font-size:10px;color:#94A3B8;">${ready.length}/${providers.length} provedores prontos</span>
            </div>`;
        const supabase = data.bindings?.supabase;
        const supabaseReady = typeof supabase === 'boolean' ? supabase : Boolean(supabase?.reachable);
        if (infoText) infoText.innerHTML = `R2 · Vectorize${data.bindings?.vectorize ? '' : ' (indisponível)'} · Supabase${supabaseReady ? '' : ' (indisponível)'} — canal real: <strong>Telegram</strong>.`;
    } catch (e) {
        if (badge) { badge.className = 'badge badge-warning'; badge.textContent = '⚪ Sem conexão com o BROW Cloud'; }
        if (box) box.innerHTML = '<p class="qr-hint">Não foi possível alcançar o BROW Cloud. Verifique a chave no Worker de produção.</p>';
        if (infoText) infoText.innerHTML = 'Conectando ao Worker de produção...';
    }
}

async function loadCloudStatusView() {
    try {
        const res = await fetch('/api/hermes/status');
        const data = await res.json();
        const el = document.getElementById('automation-status-box');
        if (el) {
            const rows = Object.entries(data.health || {}).map(([name, h]) => {
                const cooling = h.cooldownUntil && Date.parse(h.cooldownUntil) > Date.now();
                const lat = h.avgLatencyMs ? ` · ${Math.round(h.avgLatencyMs)}ms` : '';
                return `<li><span class="item-text-content">${cooling ? '🔴' : '🟢'} <strong>${name}</strong>${lat}${cooling ? ' — em cooldown' : ''}</span></li>`;
            }).join('');
            el.innerHTML = rows || '<li class="text-muted">Sem dados de provedores ainda.</li>';
        }
    } catch (e) { console.error('Erro ao carregar status', e); }

    // Carregar Lembretes na aba Automação
    try {
        const agRes = await fetch('/api/hermes/agenda');
        const agData = await agRes.json();
        const pending = (agData.items || []).filter(a => !a.sentAt);
        const countBadge = document.getElementById('auto-reminders-count');
        if (countBadge) countBadge.textContent = pending.length;
        const listEl = document.getElementById('auto-reminders-list');
        if (listEl) {
            if (!pending.length) {
                listEl.innerHTML = '<li class="text-muted">Nenhum lembrete pendente no cron.</li>';
            } else {
                listEl.innerHTML = pending.slice(0, 5).map(a => `<li><span class="item-text-content">⏰ <strong>${escapeHtml(a.text)}</strong> — ${a.dueAt ? new Date(a.dueAt).toLocaleString('pt-BR') : 'Lembrete diário'}</span></li>`).join('');
            }
        }
    } catch (e) { console.error(e); }

    // Carregar Guardião Financeiro na aba Automação
    try {
        const finRes = await fetch('/api/hermes/finances');
        const finData = await finRes.json();
        const saldo = finData.summary?.saldo ?? 0;
        const saldoEl = document.getElementById('auto-fin-saldo');
        if (saldoEl) {
            saldoEl.textContent = `R$ ${saldo.toFixed(2).replace('.', ',')}`;
            saldoEl.className = saldo >= 0 ? "kpi-value text-green" : "kpi-value text-red";
        }
    } catch (e) { console.error(e); }
}

async function triggerBriefingAutomacao() {
    const box = document.getElementById('briefing-automacao-box');
    if (box) box.innerHTML = '<p class="text-muted">⚡ Compilando e enviando Briefing Executivo Proativo...</p>';
    try {
        const res = await fetch('/api/hermes/briefing', { method: 'POST' });
        const data = await res.json();
        if (!data.ok) throw new Error('briefing_failed');
        const status = data.telegramSent
            ? '<span class="text-green">✅ Enviado ao Telegram agora.</span>'
            : '<span class="text-red">⚠️ Não consegui enviar ao Telegram (bot configurado?).</span>';
        if (box) {
            box.innerHTML = `<div style="display:flex; flex-direction:column; gap:8px; white-space:pre-wrap;">${escapeHtml(data.text)}</div><p style="margin-top:8px;">${status}</p>`;
        }
    } catch (e) {
        if (box) box.innerHTML = '<p class="text-red">❌ Erro ao compilar briefing.</p>';
    }
}

/* ── Manual refresh button — reloads overview + whichever tab is active ── */
function fetchData() {
    loadDashboardOverview();
    const active = document.querySelector('.main-tab-view.active');
    if (!active) return;
    if (active.id === 'view-memoria') loadMemories();
    else if (active.id === 'view-agenda') Promise.all([loadAgenda(), loadMetas(), loadTarefas()]);
    else if (active.id === 'view-financas') loadFinances();
    else if (active.id === 'view-documentos') loadMemories('documento');
    else if (active.id === 'view-contatos') loadMemories('contato');
    else if (active.id === 'view-metas') loadMetas();
    else if (active.id === 'view-tarefas') loadTarefas();
    else if (active.id === 'view-automacao') loadCloudStatusView();
    else if (active.id === 'view-skills') loadSkills();
}

function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
}

const SKILL_STATE_LABELS = {
    candidate: '🆕 Candidata', testing: '🧪 Em teste', approved: '✅ Aprovada',
    active: '🟢 Ativa', paused: '⏸️ Pausada', deprecated: '⛔ Cancelada'
};

function toggleNewSkillForm() {
    const form = document.getElementById('new-skill-form');
    if (!form) return;
    form.style.display = form.style.display === 'none' ? 'block' : 'none';
}

async function submitNewSkill(event) {
    event.preventDefault();
    const nameEl = document.getElementById('new-skill-name');
    const descEl = document.getElementById('new-skill-desc');
    const name = nameEl.value.trim();
    const description = descEl.value.trim();
    if (!name || !description) return;
    try {
        const res = await fetch('/api/hermes/skills', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, description }) });
        if (!res.ok) throw new Error('create_failed');
        nameEl.value = ''; descEl.value = '';
        toggleNewSkillForm();
        loadSkills();
    } catch (e) { alert('Não consegui criar a skill agora. Tente novamente.'); }
}

async function runSkillAction(skillId, action, confirmMsg) {
    if (confirmMsg && !confirm(confirmMsg)) return;
    try {
        const res = await fetch(`/api/hermes/skills/${skillId}/${action}`, { method: 'POST' });
        if (!res.ok) throw new Error('action_failed');
        loadSkills();
    } catch (e) { alert('Não consegui aplicar essa ação na skill agora.'); }
}

async function editSkillPrompt(skillId, currentName, currentDesc) {
    const name = prompt('Nome da skill:', currentName);
    if (name === null) return;
    const description = prompt('Descrição / diretriz:', currentDesc);
    if (description === null) return;
    try {
        const res = await fetch(`/api/hermes/skills/${skillId}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, description }) });
        if (!res.ok) throw new Error('edit_failed');
        loadSkills();
    } catch (e) { alert('Não consegui editar essa skill agora (skills ativas precisam ser pausadas antes).'); }
}

function skillActionButtons(skill) {
    const btns = [];
    if (skill.state === 'candidate' || skill.state === 'testing' || skill.state === 'approved') {
        btns.push(`<button class="btn btn-primary btn-xs" onclick="runSkillAction('${skill.id}','run')">▶️ Colocar pra rodar</button>`);
    }
    if (skill.state === 'active') {
        btns.push(`<button class="btn btn-ghost btn-xs" onclick="runSkillAction('${skill.id}','pause')">⏸️ Pausar</button>`);
    }
    if (skill.state === 'paused') {
        btns.push(`<button class="btn btn-primary btn-xs" onclick="runSkillAction('${skill.id}','resume')">▶️ Retomar</button>`);
    }
    if (skill.state !== 'deprecated') {
        btns.push(`<button class="btn btn-ghost btn-xs" onclick="editSkillPrompt('${skill.id}', '${escapeHtml(skill.name).replace(/'/g, "\\'")}', '${escapeHtml(skill.description || '').replace(/'/g, "\\'")}')">✏️ Editar</button>`);
        btns.push(`<button class="btn btn-ghost btn-xs" style="color:var(--rose);" onclick="runSkillAction('${skill.id}','cancel','Cancelar esta skill? Ela para de ser usada pelo BROW.')">🗑️ Cancelar</button>`);
    }
    return btns.join(' ');
}

async function loadSkills() {
    const list = document.getElementById('skills-list');
    const summary = document.getElementById('skills-summary');
    if (!list || !summary) return;
    try {
        const res = await fetch('/api/hermes/skills');
        if (!res.ok) throw new Error('skills_failed');
        const data = await res.json();
        const info = data.summary || {};
        summary.textContent = `${info.active || 0} ativas · ${info.testing || 0} em teste · ${info.created || 0} criadas`;
        const items = data.items || [];
        if (!items.length) { list.innerHTML = '<p class="text-muted">Nenhuma skill criada ainda.</p>'; return; }
        list.innerHTML = items.map(skill => {
            const uses = Number(skill.usageCount || 0);
            const lastUsed = skill.lastUsedAt ? new Date(skill.lastUsedAt).toLocaleString('pt-BR') : 'nunca usada';
            const bindingTxt = skill.binding?.kind === 'intent' ? `intent:${skill.binding.target}` : 'diretriz de prompt';
            return `<div class="p-card">
                <div style="display:flex; justify-content:space-between; align-items:center; gap:8px; flex-wrap:wrap;">
                    <p class="font-600">${escapeHtml(skill.name || skill.id)}</p>
                    <span class="badge badge-info">${SKILL_STATE_LABELS[skill.state] || skill.state}</span>
                </div>
                <p class="text-2">Vínculo: ${escapeHtml(bindingTxt)} · Usos reais: <strong>${uses}</strong> · Último uso: ${lastUsed}</p>
                <p class="text-muted">${escapeHtml(skill.description || '')}</p>
                <div style="display:flex; gap:6px; flex-wrap:wrap; margin-top:6px;">${skillActionButtons(skill)}</div>
            </div>`;
        }).join('');
    } catch (error) {
        summary.textContent = 'Indisponível';
        list.innerHTML = '<p class="text-muted">Não foi possível carregar as skills agora.</p>';
        console.error('Erro ao carregar skills', error);
    }
}

/* ── SEGMENTAÇÃO DE MEMÓRIAS DA BROW ───────────────────────────────────── */
function matchMemorySegment(m, segment) {
    if (!segment || segment === 'all') return true;
    const cat = (m.mainCategory || '').toLowerCase();
    const subCat = (m.category || '').toLowerCase();
    const priority = (m.priority || '').toLowerCase();
    const text = (m.title + ' ' + (m.summary || '') + ' ' + (m.tags || []).join(' ')).toLowerCase();

    switch (segment) {
        case 'priorities':
        case 'prioridades':
            return priority === 'alta' || cat === 'trabalho' || /prioridad|urgente|importante|alta|foco|meta/.test(text);

        case 'projects':
        case 'projetos':
            return cat === 'trabalho' || subCat.includes('projeto') || /projeto|desenvolvimento|programação|código|sistema|reunião|trabalho|cliente|empresa|gestão|software/.test(text);

        case 'habits':
        case 'habitos':
            return cat === 'pessoal' || cat === 'lazer' || subCat.includes('hábito') || /hábito|habito|rotina|saúde|exercício|treino|alimentação|diária|lazer|dica|gosto|preferência|preferencia/.test(text);

        case 'people':
        case 'pessoas':
            return cat === 'contato' || cat === 'familiar' || subCat.includes('relacionamento') || subCat.includes('aniversário') || /pessoa|contato|amigo|amiga|familiar|aniversário|aniversario|esposa|marido|filh|irmã|irmão|mãe|pai|namorad/.test(text);

        case 'decisions':
        case 'decisoes':
            return cat === 'anotacao' || subCat.includes('anotacao') || /decisão|decisao|acordo|escolha|definid|conselho|lembrança|resumo|estratégia|nota/.test(text);

        case 'goals':
        case 'metas':
            return cat === 'meta' || subCat.includes('metas') || subCat.includes('compromissos') || /meta|objetivo|planejamento|viagem|conquist|alvo|prazo|futuro/.test(text);

        default:
            return cat === segment || subCat === segment;
    }
}

/* ─── NOTÍCIAS EM TEMPO REAL & KPIS REESTRUTURADOS ─── */
let globalNewsItems = [];
let currentNewsCategory = 'politica';
let customNewsTopics = [];
let newsRotationTimer = null;
let currentNewsSlideIndex = 0;

function initCustomNewsTopics() {
    try {
        const stored = localStorage.getItem('hermes_custom_news_topics');
        if (stored) {
            customNewsTopics = JSON.parse(stored) || [];
            customNewsTopics.forEach(t => renderCustomTopicPill(t));
        }
    } catch (e) {}
}

function toggleAddTopicInput() {
    const box = document.getElementById('add-topic-inline-box');
    const input = document.getElementById('custom-topic-input');
    if (!box) return;
    const isHidden = box.style.display === 'none';
    box.style.display = isHidden ? 'block' : 'none';
    if (isHidden && input) input.focus();
}

function submitCustomNewsTopic(event) {
    event.preventDefault();
    const input = document.getElementById('custom-topic-input');
    const rawName = input?.value.trim();
    if (!rawName) return;

    const cleanQuery = rawName.replace(/^[^a-zA-Z0-9À-ÿ]+/, '').trim();
    const id = 'custom_' + cleanQuery.toLowerCase().replace(/[^a-z0-9]/g, '_');
    const topicObj = { id, name: `✨ ${cleanQuery}`, query: cleanQuery };

    if (!customNewsTopics.some(t => t.id === id)) {
        customNewsTopics.push(topicObj);
        try { localStorage.setItem('hermes_custom_news_topics', JSON.stringify(customNewsTopics)); } catch (e) {}
        renderCustomTopicPill(topicObj);
    }

    input.value = '';
    toggleAddTopicInput();

    const pillBtn = document.querySelector(`.news-cat-pill[data-cat-id="${id}"]`);
    filterNewsCategory(id, pillBtn, cleanQuery);
}

function renderCustomTopicPill(t) {
    const bar = document.getElementById('news-categories-pills-bar');
    const addBtn = bar?.querySelector('.news-cat-add-btn');
    if (!bar || !addBtn) return;

    if (document.querySelector(`.news-cat-pill[data-cat-id="${t.id}"]`)) return;

    const btn = document.createElement('button');
    btn.className = 'news-cat-pill';
    btn.setAttribute('data-cat-id', t.id);
    btn.textContent = t.name;
    btn.onclick = function() { filterNewsCategory(t.id, btn, t.query); };

    bar.insertBefore(btn, addBtn);
}

async function loadDashboardNews(manualRefresh = false) {
    const listEl = document.getElementById('news-items-list');
    const tsEl = document.getElementById('news-last-updated-ts');
    if (!listEl) return;

    if (manualRefresh && tsEl) tsEl.textContent = '🔎 Varrendo sites e portais ao vivo...';

    try {
        const customObj = customNewsTopics.find(t => t.id === currentNewsCategory);
        const activeQuery = customObj ? customObj.query : currentNewsCategory.replace(/^custom_/, '').replace(/_/g, ' ');
        const queryParam = `&query=${encodeURIComponent(activeQuery)}`;
        const refreshParam = manualRefresh ? '&refresh=true' : '';

        const res = await fetch(`/api/hermes/news?category=${encodeURIComponent(currentNewsCategory)}${queryParam}${refreshParam}`);
        const data = await res.json();
        globalNewsItems = data.items || [];
        if (tsEl) tsEl.textContent = data.updatedAtStr ? `Atualizado ${data.updatedAtStr}` : `Atualizado ${new Date().toLocaleTimeString('pt-BR')}`;
        renderNewsTicker();
        startNewsAutoRotation();
    } catch (e) {
        if (listEl) listEl.innerHTML = '<div class="text-muted" style="padding:10px;">⚠️ Não foi possível carregar notícias ao vivo no momento.</div>';
    }
}

function filterNewsCategory(cat, btnEl, customQuery) {
    currentNewsCategory = cat;
    document.querySelectorAll('.news-categories-bar .news-cat-pill').forEach(b => b.classList.remove('active'));
    if (btnEl) btnEl.classList.add('active');

    const labelEl = document.getElementById('news-current-category-name');
    const catNames = {
        politica: '🏛️ Política',
        futebol: '⚽ Futebol',
        financas: '💰 Finanças',
        investimentos: '📈 Investimentos',
        tecnologia: '💻 Tecnologia',
        ia: '🤖 Inteligência Artificial',
        negocios: '💼 Dinheiro & Negócios'
    };

    let titleText = catNames[cat];
    if (!titleText && customQuery) titleText = `✨ ${customQuery}`;
    if (!titleText) {
        const found = customNewsTopics.find(t => t.id === cat);
        titleText = found ? found.name : 'Manchetes';
    }

    if (labelEl) labelEl.textContent = titleText;

    loadDashboardNews();
}

function renderNewsTicker() {
    const listEl = document.getElementById('news-items-list');
    if (!listEl) return;

    if (!globalNewsItems || !globalNewsItems.length) {
        listEl.innerHTML = '<div class="text-muted" style="padding:10px;">Nenhuma notícia encontrada neste assunto no momento.</div>';
        return;
    }

    listEl.innerHTML = globalNewsItems.slice(0, 4).map(item => `
        <div class="news-item-card">
            <div class="news-item-header">
                <span class="news-badge">${escapeHtml(item.badge || item.category)}</span>
                <span class="news-time">⏰ ${escapeHtml(item.time || 'Agora')}</span>
            </div>
            <div class="news-title" title="${escapeHtml(item.title)}">${escapeHtml(item.title)}</div>
            ${item.summary ? `<div class="news-summary">${escapeHtml(item.summary)}</div>` : ''}
            <div class="news-source">
                <span>📰 ${escapeHtml(item.source || 'Fonte Externa')}</span>
                <a href="${escapeHtml(item.url || '#')}" target="_blank" rel="noopener" style="color:var(--cyan); font-weight:700; text-decoration:none;">Ler Matéria ↗</a>
            </div>
        </div>`).join('');
}

function startNewsAutoRotation() {
    if (newsRotationTimer) clearInterval(newsRotationTimer);
    newsRotationTimer = setInterval(() => {
        if (!globalNewsItems || globalNewsItems.length <= 3) return;
        currentNewsSlideIndex = (currentNewsSlideIndex + 1) % Math.ceil(globalNewsItems.length / 3);
        const container = document.getElementById('news-ticker-container');
        if (container) {
            container.scrollTop = currentNewsSlideIndex * 80;
        }
    }, 12000);
}

/* ── Dashboard overview (real aggregated data + 4 KPIs) ───────────────────────── */
async function loadDashboardOverview() {
    try {
        const [overviewRes, memRes, agRes, docRes] = await Promise.all([
            fetch('/api/hermes/overview').then(r => r.json()).catch(() => null),
            fetch('/api/hermes/memories').then(r => r.json()).catch(() => null),
            fetch('/api/hermes/agenda').then(r => r.json()).catch(() => null),
            fetch('/api/hermes/documents').then(r => r.json()).catch(() => null)
        ]);

        const data = overviewRes || {};
        const recentMems = data.memories?.recent || memRes?.items || [];
        const memoriesCount = (memRes?.items || []).length || data.memories?.count || 0;
        const agendaItems = agRes?.items || [];
        const docItems = docRes?.items || [];

        renderList('priorities-list', recentMems.filter(m => matchMemorySegment(m, 'priorities')).slice(0, 4).map(m => m.title));
        renderList('projects-list', recentMems.filter(m => matchMemorySegment(m, 'projects')).slice(0, 4).map(m => m.title));
        renderList('habits-list', recentMems.filter(m => matchMemorySegment(m, 'habits')).slice(0, 4).map(m => m.title));
        renderList('people-list', recentMems.filter(m => matchMemorySegment(m, 'people')).slice(0, 4).map(m => m.title));
        renderList('decisions-list', recentMems.filter(m => matchMemorySegment(m, 'decisions')).slice(0, 5).map(m => `${m.title} — ${(m.summary || '').slice(0, 50)}`));

        const saldo = data.finances?.saldo ?? 0;
        const receitas = data.finances?.receitas ?? 0;
        const despesas = data.finances?.despesas ?? 0;
        const formattedSaldo = `R$ ${saldo.toFixed(2).replace('.', ',')}`;

        const summaryEl = document.getElementById('financial-summary');
        if (summaryEl) summaryEl.textContent = formattedSaldo;
        const incEl = document.getElementById('kpi-fin-income');
        if (incEl) incEl.textContent = `R$ ${receitas.toFixed(2).replace('.', ',')}`;
        const expEl = document.getElementById('kpi-fin-expense');
        if (expEl) expEl.textContent = `R$ ${despesas.toFixed(2).replace('.', ',')}`;

        const finSaldoEl = document.getElementById('fin-tab-saldo');
        if (finSaldoEl) { finSaldoEl.textContent = formattedSaldo; finSaldoEl.className = saldo >= 0 ? "kpi-value text-green" : "kpi-value text-red"; }
        const finRecEl = document.getElementById('fin-tab-receitas'); if (finRecEl) finRecEl.textContent = `R$ ${receitas.toFixed(2).replace('.', ',')}`;
        const finDespEl = document.getElementById('fin-tab-despesas'); if (finDespEl) finDespEl.textContent = `R$ ${despesas.toFixed(2).replace('.', ',')}`;

        const memBadge = document.getElementById('kpi-memory-count-badge');
        if (memBadge) memBadge.textContent = `${memoriesCount} Memória${memoriesCount !== 1 ? 's' : ''}`;

        const activeAgenda = agendaItems.filter(a => !a.sentAt);
        const agBadge = document.getElementById('kpi-agenda-count-badge');
        if (agBadge) agBadge.textContent = `${activeAgenda.length} Pendente${activeAgenda.length !== 1 ? 's' : ''}`;

        const agPreview = document.getElementById('kpi-agenda-preview');
        if (agPreview) {
            if (activeAgenda.length === 0) {
                agPreview.innerHTML = `
                    <div class="kpi-agenda-item">
                        <span class="kpi-agenda-time">Hoje</span>
                        <span class="kpi-agenda-text" style="color:var(--text-2);">Nenhum compromisso pendente</span>
                    </div>`;
            } else {
                agPreview.innerHTML = activeAgenda.slice(0, 2).map(a => `
                    <div class="kpi-agenda-item" style="margin-bottom:4px;">
                        <span class="kpi-agenda-time" style="color:var(--amber); font-weight:700;">⏰ ${a.dueAt ? new Date(a.dueAt).toLocaleDateString('pt-BR') : a.time || 'Hoje'}</span>
                        <span class="kpi-agenda-text" style="color:#fff; display:block; font-size:11.5px;">${escapeHtml(a.text)}</span>
                    </div>`).join('');
            }
        }

        const docBadge = document.getElementById('doc-count-badge-desk');
        if (docBadge) docBadge.textContent = `${docItems.length} Arquivo${docItems.length !== 1 ? 's' : ''}`;

        document.getElementById('last-updated').textContent = new Date().toLocaleTimeString('pt-BR');
    } catch (error) {
        console.error("Erro ao carregar overview do BROW:", error);
        document.getElementById('last-updated').textContent = 'erro ao atualizar';
    }
}

function renderList(elementId, items) {
    const el = document.getElementById(elementId);
    if (!el) return;
    el.innerHTML = '';
    if (!items || items.length === 0) { el.innerHTML = '<li class="text-muted">Nenhum item registrado</li>'; return; }
    items.forEach(item => { const li = document.createElement('li'); li.textContent = item; el.appendChild(li); });
}

/* ── Memória: seleção múltipla, exclusão em lote, exclusão por filtro ────── */
let currentMemorySegment = 'all';

async function loadMemories(filterCategory) {
    try {
        const res = await fetch('/api/hermes/memories');
        const data = await res.json();
        globalMemories = data.items || [];
        filterMemories(filterCategory);
    } catch (error) {
        console.error("Erro ao carregar memórias:", error);
    }
}

function updateMemorySelectionUI() {
    const master = document.getElementById('mem-select-all');
    const deleteBtn = document.getElementById('btn-delete-selected-memories');
    const countSpan = document.getElementById('selected-memories-count');
    
    if (countSpan) countSpan.textContent = selectedMemoryIds.size;
    if (deleteBtn) deleteBtn.style.display = selectedMemoryIds.size > 0 ? 'inline-flex' : 'none';
    
    const checkboxes = document.querySelectorAll('.mem-checkbox');
    if (master) {
        master.checked = checkboxes.length > 0 && Array.from(checkboxes).every(cb => cb.checked);
    }
}

function toggleMemorySelection(id) {
    if (selectedMemoryIds.has(id)) selectedMemoryIds.delete(id);
    else selectedMemoryIds.add(id);
    updateMemorySelectionUI();
}

function toggleSelectAllMemories(masterCheckbox) {
    const visibleCheckboxes = document.querySelectorAll('.mem-checkbox');
    visibleCheckboxes.forEach(cb => {
        cb.checked = masterCheckbox.checked;
        if (masterCheckbox.checked) selectedMemoryIds.add(cb.value);
        else selectedMemoryIds.delete(cb.value);
    });
    updateMemorySelectionUI();
}

async function deleteSelectedMemoriesReal() {
    if (selectedMemoryIds.size === 0) return;
    const count = selectedMemoryIds.size;
    if (!confirm(`Excluir permanentemente as ${count} memórias selecionadas do BROW de produção (R2 + Supabase)?`)) return;
    
    const btn = document.getElementById('btn-delete-selected-memories');
    if (btn) btn.disabled = true;
    
    let deletedCount = 0;
    const ids = Array.from(selectedMemoryIds);
    for (const fullId of ids) {
        const shortId = fullId.slice(0, 8).toUpperCase();
        try {
            const res = await fetch(`/api/hermes/memories/${shortId}`, { method: 'DELETE' });
            if (res.ok) deletedCount++;
        } catch (e) {
            console.error("Erro ao apagar memória", fullId, e);
        }
    }
    
    alert(`🗑️ Sucesso! ${deletedCount} memórias foram excluídas permanentemente.`);
    selectedMemoryIds.clear();
    if (btn) btn.disabled = false;
    updateMemorySelectionUI();
    loadMemories();
    loadDashboardOverview();
}

async function deleteAllFilteredMemoriesReal() {
    const visibleCheckboxes = document.querySelectorAll('.mem-checkbox');
    if (visibleCheckboxes.length === 0) {
        alert("Nenhuma memória visível no filtro atual para excluir.");
        return;
    }
    const count = visibleCheckboxes.length;
    if (!confirm(`TEM CERTEZA? Deseja excluir TODAS as ${count} memórias exibidas no filtro atual? Esta ação é permanente.`)) return;
    
    let deletedCount = 0;
    for (const cb of visibleCheckboxes) {
        const shortId = cb.value.slice(0, 8).toUpperCase();
        try {
            const res = await fetch(`/api/hermes/memories/${shortId}`, { method: 'DELETE' });
            if (res.ok) deletedCount++;
        } catch (e) {
            console.error("Erro ao apagar memória", cb.value, e);
        }
    }
    alert(`🗑️ Sucesso! ${deletedCount} memórias do filtro foram removidas.`);
    selectedMemoryIds.clear();
    updateMemorySelectionUI();
    loadMemories();
    loadDashboardOverview();
}

function renderMemoriesList(items, filterCategory) {
    const targetId = filterCategory === 'documento' ? 'tab-documents-list' : filterCategory === 'contato' ? 'tab-contacts-list' : 'memory-full-list';
    const el = document.getElementById(targetId);
    if (!el) return;
    el.innerHTML = '';
    const countBadge = document.getElementById('memory-full-count');
    if (countBadge && targetId === 'memory-full-list') countBadge.textContent = items.length;
    if (!items.length) { el.innerHTML = `<li class="text-muted">Nenhuma ${filterCategory ? 'entrada nesta categoria' : 'memória registrada nesta categoria'} ainda.</li>`; updateMemorySelectionUI(); return; }
    items.forEach((m) => {
        const li = document.createElement('li');
        const isChecked = selectedMemoryIds.has(m.id);
        const catBadge = m.mainCategory ? `<span class="badge badge-info">${escapeHtml(m.mainCategory)}</span>` : '';
        const subBadge = (m.category && m.category !== m.mainCategory) ? ` <span class="badge badge-success">${escapeHtml(m.category)}</span>` : '';
        const checkboxHtml = targetId === 'memory-full-list' ? `<input type="checkbox" class="mem-checkbox item-checkbox" value="${m.id}" onchange="toggleMemorySelection('${m.id}')" ${isChecked ? 'checked' : ''}> ` : '';
        
        li.innerHTML = `
            ${checkboxHtml}
            <span class="item-text-content">🧠 <strong>${escapeHtml(m.title)}</strong> — ${escapeHtml((m.summary || '').slice(0, 100))} ${catBadge}${subBadge}</span>
            <div class="item-actions">
                <button class="btn-item-action btn-item-delete" onclick="deleteMemoryReal('${m.id.slice(0, 8).toUpperCase()}')" title="Excluir do BROW">🗑️ Excluir</button>
            </div>`;
        const editButton = document.createElement('button');
        editButton.type = 'button';
        editButton.className = 'btn-item-action';
        editButton.title = 'Editar memória';
        editButton.textContent = '✏️ Editar';
        editButton.addEventListener('click', () => void editMemoryReal(
            m.id.slice(0, 8).toUpperCase(), m.title || '', m.summary || '', m.mainCategory || '',
        ));
        li.querySelector('.item-actions')?.prepend(editButton);
        el.appendChild(li);
    });
    updateMemorySelectionUI();
}

async function editMemoryReal(id, currentTitle, currentSummary, currentCategory) {
    const title = prompt('Título da memória:', currentTitle);
    if (title === null) return;
    const cleanTitle = title.trim();
    if (!cleanTitle) { alert('O título da memória não pode ficar vazio.'); return; }
    const summary = prompt('Conteúdo da memória:', currentSummary);
    if (summary === null) return;
    const category = prompt('Categoria (ex.: pessoal, trabalho, contato, meta):', currentCategory || 'pessoal');
    if (category === null) return;
    try {
        const res = await fetch(`/api/hermes/memories/${id}`, {
            method: 'PATCH', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ title: cleanTitle, summary: summary.trim(), mainCategory: category.trim() || 'pessoal' }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok || data.ok === false) throw new Error(data.error || data.message || 'update_failed');
        await loadMemories();
        await loadDashboardOverview();
    } catch (error) {
        alert('Não foi possível editar a memória.');
        console.error(error);
    }
}

async function deleteMemoryReal(id) {
    if (!confirm("Excluir esta memória do BROW? Isso remove permanentemente da produção (R2 + índice + vetor)." )) return;
    try {
        const res = await fetch(`/api/hermes/memories/${id}`, { method: 'DELETE' });
        if (!res.ok) throw new Error('delete_failed');
        alert("🗑️ Memória removida do BROW de produção.");
        selectedMemoryIds.delete(id);
        loadMemories();
        loadDashboardOverview();
    } catch (error) {
        alert("❌ Erro ao excluir. Veja o console.");
        console.error(error);
    }
}

async function submitMemoryForm(event) {
    event.preventDefault();
    const input = document.getElementById('memory-input-text');
    const catSelect = document.getElementById('memory-input-category');
    const status = document.getElementById('memory-form-status');
    const button = event.target.querySelector('button[type="submit"]');
    const text = input.value.trim();
    if (!text) return;
    const categoryMap = { priorities: 'trabalho', habits: 'pessoal', people: 'contato', decisions: 'pessoal', goals: 'meta' };
    if (button) button.disabled = true;
    if (status) { status.textContent = 'Salvando...'; status.className = 'form-status form-status-pending'; }
    try {
        const res = await fetch('/api/hermes/memories', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ title: text.slice(0, 60), summary: text, mainCategory: categoryMap[catSelect?.value] || 'pessoal' })
        });
        if (!res.ok) throw new Error('create_failed');
        if (status) { status.textContent = '✅ Memorizado no BROW — já consultável via Telegram.'; status.className = 'form-status form-status-ok'; }
        input.value = '';
        loadMemories();
        loadDashboardOverview();
    } catch (error) {
        if (status) { status.textContent = '❌ Erro ao salvar no BROW. Tente de novo.'; status.className = 'form-status form-status-error'; }
        console.error(error);
    } finally {
        if (button) button.disabled = false;
        if (status) setTimeout(() => { status.textContent = ''; status.className = 'form-status'; }, 5000);
    }
}

function filterMemories(overrideCategory) {
    if (overrideCategory) currentMemorySegment = overrideCategory;
    const query = (document.getElementById('memory-search-input')?.value || '').toLowerCase().trim();
    let filtered = globalMemories.filter(m => matchMemorySegment(m, currentMemorySegment));
    if (query) {
        filtered = filtered.filter(m => (m.title + ' ' + (m.summary || '') + ' ' + (m.tags || []).join(' ')).toLowerCase().includes(query));
    }
    renderMemoriesList(filtered);
}
function filterMemoryCategory(category, btnEl) {
    currentMemorySegment = category || 'all';
    document.querySelectorAll('.memory-filter-pills .tab-btn').forEach(b => b.classList.remove('active'));
    if (btnEl) btnEl.classList.add('active');
    filterMemories();
}

/* ── Agenda: seleção múltipla, exclusão em lote, limpeza de enviados ──── */
async function loadAgenda() {
    try {
        const res = await fetch('/api/hermes/agenda');
        const data = await res.json();
        globalAgenda = data.items || [];
        renderAgendaList(globalAgenda);
    } catch (error) { console.error("Erro ao carregar agenda:", error); }
}

function updateAgendaSelectionUI() {
    const master = document.getElementById('agenda-select-all');
    const deleteBtn = document.getElementById('btn-delete-selected-agenda');
    const countSpan = document.getElementById('selected-agenda-count');
    
    if (countSpan) countSpan.textContent = selectedAgendaKeys.size;
    if (deleteBtn) deleteBtn.style.display = selectedAgendaKeys.size > 0 ? 'inline-flex' : 'none';
    
    const checkboxes = document.querySelectorAll('.agenda-checkbox');
    if (master) {
        master.checked = checkboxes.length > 0 && Array.from(checkboxes).every(cb => cb.checked);
    }
}

function toggleAgendaSelection(key) {
    if (selectedAgendaKeys.has(key)) selectedAgendaKeys.delete(key);
    else selectedAgendaKeys.add(key);
    updateAgendaSelectionUI();
}

function toggleSelectAllAgenda(masterCheckbox) {
    const visibleCheckboxes = document.querySelectorAll('.agenda-checkbox');
    visibleCheckboxes.forEach(cb => {
        cb.checked = masterCheckbox.checked;
        if (masterCheckbox.checked) selectedAgendaKeys.add(cb.value);
        else selectedAgendaKeys.delete(cb.value);
    });
    updateAgendaSelectionUI();
}

async function deleteSelectedAgendaReal() {
    if (selectedAgendaKeys.size === 0) return;
    const count = selectedAgendaKeys.size;
    if (!confirm(`Remover os ${count} compromissos selecionados da agenda do BROW?`)) return;
    
    let deletedCount = 0;
    const keys = Array.from(selectedAgendaKeys);
    for (const key of keys) {
        const shortId = key.slice(0, 8).toUpperCase();
        try {
            const res = await fetch(`/api/hermes/agenda/${shortId}`, { method: 'DELETE' });
            if (res.ok) deletedCount++;
        } catch (e) {
            console.error("Erro ao apagar compromisso", key, e);
        }
    }
    
    alert(`🗑️ Sucesso! ${deletedCount} compromissos foram removidos.`);
    selectedAgendaKeys.clear();
    updateAgendaSelectionUI();
    loadAgenda();
    loadDashboardOverview();
}

async function deleteSentAgendaReal() {
    const sentItems = globalAgenda.filter(a => a.sentAt);
    if (sentItems.length === 0) {
        alert("Nenhum compromisso com status 'Enviado' para limpar.");
        return;
    }
    if (!confirm(`Deseja remover todos os ${sentItems.length} compromissos já notificados/enviados pelo Telegram?`)) return;
    
    let deletedCount = 0;
    for (const item of sentItems) {
        const shortId = item.key.slice(0, 8).toUpperCase();
        try {
            const res = await fetch(`/api/hermes/agenda/${shortId}`, { method: 'DELETE' });
            if (res.ok) deletedCount++;
        } catch (e) {
            console.error("Erro ao apagar compromisso enviado", item.key, e);
        }
    }
    alert(`🗑️ Sucesso! ${deletedCount} compromissos enviados foram limpos da agenda.`);
    selectedAgendaKeys.clear();
    updateAgendaSelectionUI();
    loadAgenda();
    loadDashboardOverview();
}

function renderAgendaList(items) {
    const el = document.getElementById('tab-agenda-list');
    if (!el) return;
    el.innerHTML = '';
    if (!items.length) { el.innerHTML = '<li class="text-muted">Nenhum compromisso ou lembrete no BROW ainda.</li>'; updateAgendaSelectionUI(); return; }
    items.sort((a, b) => (a.sentAt ? 1 : 0) - (b.sentAt ? 1 : 0));
    items.forEach((a) => {
        const when = a.dueAt ? new Date(a.dueAt).toLocaleString('pt-BR') : `todo dia às ${a.time}`;
        const status = a.sentAt ? '<span class="badge badge-info">Enviado</span>' : '<span class="badge badge-success">Pendente</span>';
        const isChecked = selectedAgendaKeys.has(a.key);
        const li = document.createElement('li');
        li.innerHTML = `
            <input type="checkbox" class="agenda-checkbox item-checkbox" value="${a.key}" onchange="toggleAgendaSelection('${a.key}')" ${isChecked ? 'checked' : ''}>
            <span class="item-text-content">📅 <strong>${escapeHtml(a.text)}</strong> — ${when} ${status}</span>
            <div class="item-actions">
                <button class="btn-item-action btn-item-delete" onclick="deleteAgendaReal('${a.key.slice(0, 8).toUpperCase()}')" title="Remover">🗑️ Excluir</button>
            </div>`;
        el.appendChild(li);
    });
    updateAgendaSelectionUI();
}

async function deleteAgendaReal(shortId) {
    if (!confirm("Remover este item da agenda real do BROW?")) return;
    try {
        const res = await fetch(`/api/hermes/agenda/${shortId}`, { method: 'DELETE' });
        if (!res.ok) throw new Error('delete_failed');
        alert("🗑️ Removido da agenda do BROW.");
        selectedAgendaKeys.delete(shortId);
        loadAgenda();
        loadDashboardOverview();
    } catch (error) { alert("❌ Erro ao remover."); console.error(error); }
}

async function submitAgendaForm(event) {
    event.preventDefault();
    const form = event.target;
    const formData = new FormData(form);
    const title = formData.get('title');
    const dueDate = formData.get('due_date');
    const dueTime = formData.get('due_time') || '09:00';
    if (!title || !dueDate) { alert('Preencha título e data.'); return; }
    try {
        const res = await fetch('/api/hermes/agenda', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ text: title, dueAt: new Date(`${dueDate}T${dueTime}:00`).toISOString() })
        });
        if (!res.ok) throw new Error('create_failed');
        alert('✅ Agendado no BROW de produção — o cron real vai entregar no Telegram na hora.');
        form.reset();
        loadAgenda();
        loadDashboardOverview();
    } catch (error) { alert('❌ Erro ao agendar.'); console.error(error); }
}

/* ── Metas & Tarefas: integração com o banco unificado de Memórias/Agenda ── */
async function loadLegacyMetasView() {
    try {
        const [memRes, agRes] = await Promise.all([
            fetch('/api/hermes/memories').then(r => r.json()).catch(() => ({ items: [] })),
            fetch('/api/hermes/agenda').then(r => r.json()).catch(() => ({ items: [] }))
        ]);
        const memories = memRes.items || [];
        const agenda = agRes.items || [];
        
        const goalMemories = memories.filter(m => matchMemorySegment(m, 'goals') || m.mainCategory === 'meta' || (m.category || '').includes('meta'));
        const goalAgenda = agenda.filter(a => /meta|okr|objetivo/i.test(a.text));
        
        const countBadge = document.getElementById('tab-goals-count');
        const totalGoals = goalMemories.length + goalAgenda.length;
        if (countBadge) countBadge.textContent = totalGoals;
        
        const el = document.getElementById('tab-goals-list');
        if (!el) return;
        el.innerHTML = '';
        
        if (totalGoals === 0) {
            el.innerHTML = '<li class="text-muted">Nenhuma meta cadastrada no banco.</li>';
            return;
        }
        
        goalMemories.forEach(m => {
            const li = document.createElement('li');
            li.innerHTML = `
                <span class="item-text-content">🎯 <strong>${escapeHtml(m.title)}</strong> — ${escapeHtml((m.summary || '').slice(0, 80))} <span class="badge badge-info">Memória Meta</span></span>
                <div class="item-actions">
                    <button class="btn-item-action btn-item-delete" onclick="deleteMemoryReal('${m.id.slice(0, 8).toUpperCase()}')">🗑️ Excluir</button>
                </div>`;
            el.appendChild(li);
        });
        
        goalAgenda.forEach(a => {
            const li = document.createElement('li');
            const when = a.dueAt ? new Date(a.dueAt).toLocaleDateString('pt-BR') : 'Sem data';
            li.innerHTML = `
                <span class="item-text-content">🚩 <strong>${escapeHtml(a.text)}</strong> — Prazo: ${when} <span class="badge badge-success">Meta Agendada</span></span>
                <div class="item-actions">
                    <button class="btn-item-action btn-item-delete" onclick="deleteAgendaReal('${a.key.slice(0, 8).toUpperCase()}')">🗑️ Excluir</button>
                </div>`;
            el.appendChild(li);
        });
    } catch (e) { console.error("Erro ao carregar metas:", e); }
}

async function loadLegacyTasksView() {
    try {
        const [agRes, memRes] = await Promise.all([
            fetch('/api/hermes/agenda').then(r => r.json()).catch(() => ({ items: [] })),
            fetch('/api/hermes/memories').then(r => r.json()).catch(() => ({ items: [] }))
        ]);
        const agenda = agRes.items || [];
        const memories = memRes.items || [];
        
        const pendingTasks = agenda.filter(a => !a.sentAt);
        const taskMemories = memories.filter(m => m.mainCategory === 'trabalho' || (m.category || '').includes('tarefa'));
        
        const countBadge = document.getElementById('tab-tasks-count');
        const totalTasks = pendingTasks.length + taskMemories.length;
        if (countBadge) countBadge.textContent = totalTasks;
        
        const el = document.getElementById('tab-tasks-list');
        if (!el) return;
        el.innerHTML = '';
        
        if (totalTasks === 0) {
            el.innerHTML = '<li class="text-muted">Nenhuma tarefa pendente no banco.</li>';
            return;
        }
        
        pendingTasks.forEach(a => {
            const when = a.dueAt ? new Date(a.dueAt).toLocaleString('pt-BR') : `todo dia às ${a.time}`;
            const li = document.createElement('li');
            li.innerHTML = `
                <span class="item-text-content">✅ <strong>${escapeHtml(a.text)}</strong> — ${when} <span class="badge badge-success">Pendente</span></span>
                <div class="item-actions">
                    <button class="btn-item-action btn-item-delete" onclick="deleteAgendaReal('${a.key.slice(0, 8).toUpperCase()}')">🗑️ Excluir</button>
                </div>`;
            el.appendChild(li);
        });
        
        taskMemories.forEach(m => {
            const li = document.createElement('li');
            li.innerHTML = `
                <span class="item-text-content">📝 <strong>${escapeHtml(m.title)}</strong> — ${escapeHtml((m.summary || '').slice(0, 80))} <span class="badge badge-info">Trabalho</span></span>
                <div class="item-actions">
                    <button class="btn-item-action btn-item-delete" onclick="deleteMemoryReal('${m.id.slice(0, 8).toUpperCase()}')">🗑️ Excluir</button>
                </div>`;
            el.appendChild(li);
        });
    } catch (e) { console.error("Erro ao carregar tarefas:", e); }
}

// Planejamento usa as três tabelas reais. As versões antigas das telas
// inferiam tarefas/metas a partir de texto de memórias e agenda, o que dava
// falsos positivos e escondia itens criados no PWA/Telegram.
async function loadMetas() {
    const list = document.getElementById('tab-goals-list');
    try {
        const data = await fetch('/api/hermes/goals').then((res) => res.json());
        const rows = data.rows || [];
        const badge = document.getElementById('tab-goals-count'); if (badge) badge.textContent = rows.length;
        if (!list) return;
        list.innerHTML = rows.length ? rows.map((goal) => {
            const progress = goal.target_value ? Math.min(100, Math.round((Number(goal.current_value || 0) / Number(goal.target_value)) * 100)) : 0;
            return `<li class="data-item"><span class="item-text-content"><strong>${escapeHtml(goal.title)}</strong> — ${progress}%${goal.due_date ? ` · prazo ${escapeHtml(goal.due_date)}` : ''}</span><div class="item-actions"><button class="btn-item-action" onclick="updateGoalProgressDesk('${goal.id}', ${Math.min(100, progress + 10)})">+10%</button><button class="btn-item-action btn-item-delete" onclick="deleteGoalDesk('${goal.id}')">Excluir</button></div></li>`;
        }).join('') : '<li class="text-muted">Nenhuma meta cadastrada.</li>';
    } catch (error) { if (list) list.innerHTML = '<li class="text-muted">Não foi possível carregar metas.</li>'; console.error(error); }
}

async function submitGoalFormDesk(event) {
    event.preventDefault(); const form = new FormData(event.target); const title = String(form.get('title') || '').trim(); if (!title) return;
    const res = await fetch('/api/hermes/goals', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title, unit: form.get('category') || 'Pessoal', target_value: 100, current_value: 0, due_date: form.get('target_date') || null }) });
    if (!res.ok) { alert('Não foi possível salvar a meta.'); return; } event.target.reset(); await loadMetas();
}
async function updateGoalProgressDesk(id, current_value) { await fetch(`/api/hermes/goals/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ current_value }) }); await loadMetas(); }
async function deleteGoalDesk(id) { if (!confirm('Excluir esta meta?')) return; await fetch(`/api/hermes/goals/${id}`, { method: 'DELETE' }); await loadMetas(); }

async function loadTarefas() {
    const list = document.getElementById('tab-tasks-list');
    try {
        const data = await fetch('/api/hermes/tasks').then((res) => res.json()); const rows = data.rows || [];
        const badge = document.getElementById('tab-tasks-count'); if (badge) badge.textContent = rows.filter((task) => !task.done).length;
        if (!list) return;
        list.innerHTML = rows.length ? rows.map((task) => `<li class="data-item"><span class="item-text-content" style="${task.done ? 'text-decoration:line-through;opacity:.65;' : ''}"><strong>${escapeHtml(task.title)}</strong>${task.due_date ? ` · ${escapeHtml(task.due_date)}` : ''}</span><div class="item-actions"><button class="btn-item-action" onclick="toggleTaskDesk('${task.id}', ${!task.done})">${task.done ? 'Reabrir' : 'Concluir'}</button><button class="btn-item-action btn-item-delete" onclick="deleteTaskDesk('${task.id}')">Excluir</button></div></li>`).join('') : '<li class="text-muted">Nenhuma tarefa cadastrada.</li>';
    } catch (error) { if (list) list.innerHTML = '<li class="text-muted">Não foi possível carregar tarefas.</li>'; console.error(error); }
}
async function submitTaskFormDesk(event) { event.preventDefault(); const form = new FormData(event.target); const title = String(form.get('title') || '').trim(); if (!title) return; const dueDate = form.get('due_date'); const res = await fetch('/api/hermes/tasks', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title, priority: form.get('priority') || 'média', due_date: dueDate || null, done: false }) }); if (!res.ok) { alert('Não foi possível salvar a tarefa.'); return; } event.target.reset(); await loadTarefas(); }
async function toggleTaskDesk(id, done) { await fetch(`/api/hermes/tasks/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ done }) }); await loadTarefas(); }
async function deleteTaskDesk(id) { if (!confirm('Excluir esta tarefa?')) return; await fetch(`/api/hermes/tasks/${id}`, { method: 'DELETE' }); await loadTarefas(); }

/* ── Finanças: painel completo (KPIs, saúde, categoria, vencimentos, upload) ── */
const FIN_CATEGORY_ICON = { alimentacao: '🍽️', transporte: '🚗', saude: '💊', moradia: '🏠', lazer: '🎮', vestuario: '👕', educacao: '📚', salario: '💼', outros: '📦' };
const FIN_CATEGORY_LABEL = { alimentacao: 'Alimentação', transporte: 'Transporte', saude: 'Saúde', moradia: 'Moradia', lazer: 'Lazer', vestuario: 'Vestuário', educacao: 'Educação', salario: 'Salário', outros: 'Outros' };

let globalFinanceBudget = { receitaTarget: 0, despesaTarget: 0, marginTarget: 12 };
let globalFinanceHistory = [];

async function loadFinances() {
    try {
        const [finRes, healthRes, budgetRes, historyRes] = await Promise.all([
            fetch('/api/hermes/finances').then(r => r.json()),
            fetch('/api/hermes/finances/health').then(r => r.json()).catch(() => null),
            fetch('/api/hermes/finances/budget').then(r => r.json()).catch(() => null),
            fetch('/api/hermes/finances/history?months=12').then(r => r.json()).catch(() => null),
        ]);
        globalFinances = finRes.items || [];
        if (budgetRes?.ok) globalFinanceBudget = budgetRes.budget;
        if (historyRes?.ok) globalFinanceHistory = historyRes.points || [];
        renderFinancesExtrato('fin-tab-extrato-list', globalFinances);
        renderDesktopExecutiveFinancesDashboard(finRes);
        if (healthRes?.ok) renderFinancialHealth(healthRes.health);
    } catch (error) { console.error("Erro ao carregar finanças:", error); }
    loadMarketTicker();
}

// ── Mercado ao vivo (Tier 1/2, 08/09/2026): BCB Olinda (dólar/Selic oficiais) +
// CoinGecko (BTC/ETH) -- mesma fonte que o BROW usa no chat, só que exposta
// como card visual pra não precisar perguntar.
async function loadMarketTicker() {
    try {
        const [dolarRes, selicRes, cryptoRes] = await Promise.all([
            fetch('/api/hermes/tools/cambio?dias=1').then(r => r.json()).catch(() => null),
            fetch('/api/hermes/tools/selic?dias=1').then(r => r.json()).catch(() => null),
            fetch('/api/hermes/tools/crypto?ids=bitcoin,ethereum').then(r => r.json()).catch(() => null),
        ]);
        const dolarEl = document.getElementById('mt-dolar');
        const selicEl = document.getElementById('mt-selic');
        const btcEl = document.getElementById('mt-btc');
        const ethEl = document.getElementById('mt-eth');

        if (dolarEl) dolarEl.textContent = dolarRes?.ok && dolarRes.data?.length ? `R$ ${Number(dolarRes.data[dolarRes.data.length - 1].valor).toFixed(2)}` : 'indisponível';
        if (selicEl) selicEl.textContent = selicRes?.ok && selicRes.data?.length ? `${Number(selicRes.data[selicRes.data.length - 1].valor).toFixed(2)}%` : 'indisponível';
        if (cryptoRes?.ok) {
            const btc = cryptoRes.data.bitcoin, eth = cryptoRes.data.ethereum;
            if (btcEl && btc) { btcEl.textContent = `R$ ${Number(btc.brl).toLocaleString('pt-BR')}`; btcEl.className = 'mt-val ' + (btc.brl_24h_change >= 0 ? 'up' : 'down'); }
            if (ethEl && eth) { ethEl.textContent = `R$ ${Number(eth.brl).toLocaleString('pt-BR')}`; ethEl.className = 'mt-val ' + (eth.brl_24h_change >= 0 ? 'up' : 'down'); }
        } else {
            if (btcEl) btcEl.textContent = 'indisponível';
            if (ethEl) ethEl.textContent = 'indisponível';
        }
    } catch (e) { /* silencioso -- ticker é informativo, não crítico */ }
}

/* ── SYNC DE FINANÇAS ENTRE DASHBOARD / PWA / TELEGRAM (07/08/2026) ──
   Achado: lançamento criado no Telegram (ou no PWA) já ia pro mesmo R2 que
   o dashboard lê -- confirmado direto via GET /api/hermes/finances, os dados
   sempre estavam lá -- mas o dashboard só chamava loadFinances() ao abrir a
   aba, uma vez. Sem repoll, um lançamento de outro canal só aparecia depois
   de um reload manual da página inteira. Mesmo padrão de polling já usado
   e testado pelo chat-history (ver pollChatHistorySync acima): intervalo
   curto, só reage se a aba Finanças estiver de fato aberta e sem nenhum
   modal de edição em foco (pra não interromper o usuário editando um
   lançamento no meio de um refresh). */
let financeSyncPolling = false;
async function pollFinancesSync() {
    if (financeSyncPolling) return;
    const activeView = document.querySelector('.main-tab-view.active');
    if (!activeView || activeView.id !== 'view-financas') return;
    const kpiModal = document.getElementById('finance-kpi-modal-overlay');
    if (kpiModal && getComputedStyle(kpiModal).display !== 'none') return;
    financeSyncPolling = true;
    try { await loadFinances(); } catch (e) { /* silencioso -- tenta de novo no próximo tick */ }
    finally { financeSyncPolling = false; }
}
function initFinanceSync() { setInterval(() => { if (!document.hidden) pollFinancesSync(); }, 60000); }

/* ── LOCALIZAÇÃO (aba Automação) — 08/08/2026 ──
   GPS via navigator.geolocation (o navegador pede permissão nativamente) ou
   cidade digitada manualmente, geocodificada no Worker (Open-Meteo). Usada
   pelo briefing diário proativo pra avisar chuva/calor. */
async function loadLocationSettings() {
    const label = document.getElementById('location-current-label');
    try {
        const res = await fetch('/api/hermes/settings/location');
        const data = await res.json();
        if (data?.ok && label) {
            const src = data.location.source === 'gps' ? '📍 GPS' : data.location.source === 'manual' ? '✏️ manual' : '⚙️ padrão';
            label.textContent = `Atual: ${data.location.label} (${src})`;
        }
    } catch (e) { if (label) label.textContent = 'Não consegui carregar a localização atual.'; }
}

function useGpsLocation() {
    const label = document.getElementById('location-current-label');
    if (!navigator.geolocation) { if (label) label.textContent = 'Este navegador não suporta GPS.'; return; }
    if (label) label.textContent = '📍 Obtendo sua localização...';
    navigator.geolocation.getCurrentPosition(async (pos) => {
        const { latitude, longitude } = pos.coords;
        let cityLabel = `${latitude.toFixed(3)}, ${longitude.toFixed(3)}`;
        // Reverse-geocode client-side (BigDataCloud, sem chave) só pra exibir
        // um nome de cidade legível -- o clima em si usa lat/lon diretamente,
        // então uma falha aqui não impede a localização de funcionar.
        try {
            const geo = await fetch(`https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${latitude}&longitude=${longitude}&localityLanguage=pt`).then(r => r.json());
            if (geo?.city || geo?.locality) cityLabel = [geo.city || geo.locality, geo.principalSubdivision].filter(Boolean).join(', ');
        } catch (e) { /* usa lat/lon mesmo */ }
        try {
            const res = await fetch('/api/hermes/settings/location', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ lat: latitude, lon: longitude, label: cityLabel }) });
            const data = await res.json();
            if (data?.ok && label) label.textContent = `Atual: ${data.location.label} (📍 GPS)`;
        } catch (e) { if (label) label.textContent = 'Erro ao salvar localização.'; }
    }, () => { if (label) label.textContent = 'Permissão de GPS negada. Digite sua cidade manualmente abaixo.'; }, { timeout: 8000 });
}

/* ── "VIDA" DA BROW — check-in de ociosidade + saúde/madrugada (08/08/2026) ──
   Pedido do usuário: o BROW deve parecer viva, perguntando se está tudo bem
   quando o usuário passa muito tempo sem interagir, e alertando sobre
   horário tardio -- SEM virar chata/repetitiva. Duas regras seguidas à
   risca: (1) nunca a mesma frase duas vezes seguidas (banco de ~35 frases
   cada, sorteio sem repetição imediata); (2) cooldown longo por tipo (25min
   ociosidade, 45min madrugada) -- interromper o usuário raramente é o que
   faz soar genuíno, não constante. */
const BROW_USER_NAME = 'Well';
const IDLE_THRESHOLD_MS = 12 * 60 * 1000;   // 12min sem nenhuma interação
const IDLE_NUDGE_COOLDOWN_MS = 25 * 60 * 1000;
const LATE_NIGHT_COOLDOWN_MS = 45 * 60 * 1000;

const IDLE_CHECKIN_PHRASES = [
    "Ei, ainda por aí? Faz um tempinho que você não fala comigo.",
    "Tudo bem com você? Notei que ficou quieto por um tempo.",
    "Só checando — precisa de alguma ajuda com algo?",
    "Oi! Deu uma sumida... tá tudo certo?",
    "Continuo por aqui se precisar de algo, viu?",
    "Passando pra saber se está tudo bem por aí.",
    "Fico de olho, mas se precisar de mim é só chamar.",
    "Tudo em ordem? Fiquei um tempinho sem notícias suas.",
    "Se travou em alguma coisa, me chama que eu ajudo.",
    "Só dando um alô — como estão as coisas?",
    "Tá tranquilo? Posso ajudar em algo enquanto isso.",
    "Notei o silêncio... só verificando se está tudo bem.",
    "Se precisar organizar algo ou só desabafar, tô aqui.",
    "Um tempinho parado por aqui — tudo certo com você?",
    "Sem pressa nenhuma, só queria saber se você está bem.",
    "Oi de novo! Se tiver alguma pendência, posso ajudar a resolver.",
    "Tudo tranquilo por aí? Fico à disposição.",
    "Notei que faz um tempo — quer que eu resuma algo enquanto isso?",
    "Se estiver ocupado, sem problema — só queria dar um oi.",
    "Como estão as coisas? Precisa de alguma mão?",
    "Fiquei pensando em como estão indo suas tarefas hoje.",
    "Se quiser revisar sua agenda ou finanças, é só pedir.",
    "Só isso mesmo — passando pra saber se está tudo bem com você.",
    "Presença confirmada aqui. E aí, tudo certo?",
    "Se bateu alguma dúvida nesse tempo, pode perguntar.",
    "Momento de pausa? Aproveito pra saber se precisa de algo.",
    "Tudo calmo? Fico de prontidão caso precise de mim.",
    "Reparei no silêncio — nada demais, só cuidando de você.",
    "Se estiver enrolado com alguma coisa, chama que eu dou uma força.",
    "Ainda aqui, de olho. Precisa de algo?",
    "Vim só perguntar: como você está?",
    "Se precisar organizar o dia, é só falar comigo.",
    "Fico na escuta — qualquer coisa é só chamar.",
    "Passei aqui rapidinho pra saber se está tudo em ordem.",
    "Tudo certo por aí? Não custa nada perguntar.",
];

const LATE_NIGHT_PHRASES = [
    `${BROW_USER_NAME}, já passa da meia-noite — que tal encerrar por hoje e descansar?`,
    `Reparei que já é bem tarde, ${BROW_USER_NAME}. Um bom sono ajuda muito amanhã.`,
    `${BROW_USER_NAME}, cuidado com o sono — o dia de amanhã agradece um descanso agora.`,
    `Já é madrugada, ${BROW_USER_NAME}. Recomendo dar uma pausa e ir dormir.`,
    `Horário tardio por aqui, ${BROW_USER_NAME} — sua saúde agradece um descanso.`,
    `${BROW_USER_NAME}, sei que tem coisa pra fazer, mas dormir bem também é produtivo.`,
    `Já é tarde demais pra continuar sem descanso, ${BROW_USER_NAME}. Que tal parar por aqui?`,
    `${BROW_USER_NAME}, sono de qualidade rende mais que mais uma hora acordado agora.`,
    `Vi que já passou da meia-noite, ${BROW_USER_NAME} — vale considerar ir descansar.`,
    `${BROW_USER_NAME}, seu corpo agradece se você desligar um pouco mais cedo hoje.`,
    `Vida de madrugada acordado cobra caro depois, ${BROW_USER_NAME}. Bora descansar?`,
    `${BROW_USER_NAME}, o que for importante ainda vai estar aqui amanhã cedo, descansado.`,
    `Notei o horário, ${BROW_USER_NAME} — uma boa noite de sono faz muita diferença.`,
    `${BROW_USER_NAME}, só um lembrete gentil: dormir bem também é cuidar de você.`,
    `Já é tarde da noite, ${BROW_USER_NAME}. Recomendo fechar por aqui e descansar a mente.`,
    `${BROW_USER_NAME}, produtividade também vem de dormir direito — considere uma pausa.`,
    `Hora avançada por aqui, ${BROW_USER_NAME}. Vale a pena priorizar o descanso agora.`,
    `${BROW_USER_NAME}, sei que é tentador continuar, mas seu descanso importa mais agora.`,
    `Já virou a madrugada, ${BROW_USER_NAME} — talvez seja hora de recarregar as energias.`,
    `${BROW_USER_NAME}, cuide de você também: um bom sono hoje rende um dia melhor amanhã.`,
];

let lastAnyInteractionAt = Date.now();
let lastIdlePhraseIndex = -1;
let lastLateNightPhraseIndex = -1;
let lastIdleNudgeAt = 0;
let lastLateNightNudgeAt = 0;

function markUserInteraction() { lastAnyInteractionAt = Date.now(); }

function pickPhrase(bank, lastIndexRef) {
    if (bank.length <= 1) return { text: bank[0], index: 0 };
    let idx = Math.floor(Math.random() * bank.length);
    while (idx === lastIndexRef) idx = Math.floor(Math.random() * bank.length);
    return { text: bank[idx], index: idx };
}

function checkHermesAliveness() {
    if (document.visibilityState !== 'visible') return;
    if (isSpeakingOrListening) return; // não interrompe um turno de conversa em andamento
    const now = Date.now();
    const idleFor = now - lastAnyInteractionAt;

    // Check-in de ociosidade: só se realmente ocioso e fora do cooldown.
    if (idleFor >= IDLE_THRESHOLD_MS && (now - lastIdleNudgeAt) >= IDLE_NUDGE_COOLDOWN_MS) {
        lastIdleNudgeAt = now;
        const { text, index } = pickPhrase(IDLE_CHECKIN_PHRASES, lastIdlePhraseIndex);
        lastIdlePhraseIndex = index;
        speakWithEdgeTTS(text);
        return; // não empilha os dois tipos de nudge no mesmo tick
    }

    // Nudge de madrugada: só se o usuário está de fato ATIVO tarde da noite
    // (idle recente < threshold) -- se já está ocioso, o check-in acima cobre.
    const hour = new Date().getHours();
    const isLateNight = hour >= 0 && hour < 5;
    if (isLateNight && idleFor < IDLE_THRESHOLD_MS && (now - lastLateNightNudgeAt) >= LATE_NIGHT_COOLDOWN_MS) {
        lastLateNightNudgeAt = now;
        const { text, index } = pickPhrase(LATE_NIGHT_PHRASES, lastLateNightPhraseIndex);
        lastLateNightPhraseIndex = index;
        speakWithEdgeTTS(text);
    }
}

function initHermesAliveness() {
    ['click', 'keydown', 'touchstart'].forEach((evt) => document.addEventListener(evt, markUserInteraction, { passive: true }));
    setInterval(checkHermesAliveness, 60000); // checa 1x/min -- os cooldowns reais estão nos thresholds acima
}

async function setManualLocation() {
    const input = document.getElementById('location-city-input');
    const label = document.getElementById('location-current-label');
    const city = input?.value.trim();
    if (!city) return;
    if (label) label.textContent = '⏳ Buscando cidade...';
    try {
        const res = await fetch('/api/hermes/settings/location', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ city }) });
        const data = await res.json();
        if (!res.ok || !data.ok) throw new Error(data.message || 'erro');
        if (label) label.textContent = `Atual: ${data.location.label} (✏️ manual)`;
        input.value = '';
    } catch (e) { if (label) label.textContent = `❌ ${e.message || 'Não encontrei essa cidade.'}`; }
}

// Achado 07/08/2026: "Contas a Receber"/"Contas a Pagar" NÃO são um tipo à
// parte no backend -- são receita/despesa normais com status "pendente"
// (o mesmo campo já usado por parcelas). O agregador antigo procurava
// `f.type === 'receber'`, um valor que o backend nunca grava (ele traduz
// receber/pagar pra receita/despesa+pendente antes de salvar) -- por isso
// os cards de Contas a Receber/Pagar sempre mostravam R$0,00. Total
// Receita/Despesas conta TUDO (igual ao resto do painel); Contas a
// Receber/Pagar é o SUBCONJUNTO ainda pendente dentro desse total.
function renderDesktopExecutiveFinancesDashboard(apiData) {
    const items = apiData?.items || [];
    const summary = apiData?.summary || {};

    let totalReceita = 0;
    let totalDespesas = 0;
    let contasReceber = 0;
    let contasPagar = 0;

    items.forEach(f => {
        const amt = Number(f.amount || 0);
        const type = f.type === 'income' ? 'receita' : f.type === 'expense' ? 'despesa' : (f.type || 'despesa');
        if (type === 'receita') {
            totalReceita += amt;
            if (f.status === 'pendente') contasReceber += amt;
        } else {
            totalDespesas += amt;
            if (f.status === 'pendente') contasPagar += amt;
        }
    });

    if (items.length === 0 && summary) {
        if (typeof summary.receitas === 'number') totalReceita = summary.receitas;
        if (typeof summary.despesas === 'number') totalDespesas = summary.despesas;
    }

    const lucroLiquido = totalReceita - totalDespesas;
    const saldoFinal = lucroLiquido;
    const margemLucro = totalReceita > 0 ? ((lucroLiquido / totalReceita) * 100).toFixed(1) : "0,0";

    const liquidezReduzida = contasPagar > 0 ? (contasReceber / contasPagar).toFixed(2) : "0,00";
    const liquidezGeral = totalDespesas > 0 ? (totalReceita / totalDespesas).toFixed(2) : "0,00";

    const setEl = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };

    setEl('desk-kpi-total-receita', `R$ ${totalReceita.toLocaleString('pt-BR', {minimumFractionDigits:2})}`);
    setEl('desk-kpi-total-despesas', `R$ ${totalDespesas.toLocaleString('pt-BR', {minimumFractionDigits:2})}`);
    setEl('desk-kpi-lucro-liquido', `R$ ${lucroLiquido.toLocaleString('pt-BR', {minimumFractionDigits:2})}`);
    setEl('desk-kpi-saldo-final', `R$ ${saldoFinal.toLocaleString('pt-BR', {minimumFractionDigits:2})}`);
    setEl('desk-kpi-contas-receber', `R$ ${contasReceber.toLocaleString('pt-BR', {minimumFractionDigits:2})}`);
    setEl('desk-kpi-contas-pagar', `R$ ${contasPagar.toLocaleString('pt-BR', {minimumFractionDigits:2})}`);
    setEl('desk-kpi-liquidez-reduzida', liquidezReduzida);
    setEl('desk-kpi-liquidez-geral', liquidezGeral);
    setEl('desk-kpi-margem-val', `${margemLucro}%`);

    const donutCircle = document.getElementById('desk-donut-margem-circle');
    if (donutCircle) {
        const maxDash = 238.76;
        const pct = totalReceita > 0 ? Math.min(100, Math.max(0, parseFloat(margemLucro))) : 0;
        const offset = maxDash - (pct / 100) * maxDash;
        donutCircle.style.strokeDashoffset = offset;
    }
    setEl('desk-goal-margem-label', `Objetivo: ${(globalFinanceBudget.marginTarget ?? 12).toFixed(1)}%`);

    // Achado 07/08/2026: "Custo de bens vendidos" e os percentuais 34%/66%
    // eram um CHUTE fixo (`totalReceita * 0.338`) sem nenhum dado real por
    // trás -- o BROW não rastreia custo de mercadoria/produto (não é um
    // negócio de revenda), então o correto é declarar honestamente que não
    // há custo de bens vendidos rastreado (R$0) em vez de inventar um
    // número que parece real mas não é.
    const custoBens = 0;
    const lucroBruto = totalReceita - custoBens;
    const despesasOp = totalDespesas;
    const pct = (part) => totalReceita > 0 ? `${Math.round((part / totalReceita) * 100)}%` : '0%';

    setEl('desk-dre-val-receita', `R$ ${totalReceita.toLocaleString('pt-BR', {minimumFractionDigits:2})}`);
    setEl('desk-dre-pct-receita', totalReceita > 0 ? '100%' : '0%');

    setEl('desk-dre-val-custo', `R$ ${custoBens.toLocaleString('pt-BR', {minimumFractionDigits:2})}`);
    setEl('desk-dre-pct-custo', '0%');

    setEl('desk-dre-val-bruto', `R$ ${lucroBruto.toLocaleString('pt-BR', {minimumFractionDigits:2})}`);
    setEl('desk-dre-pct-bruto', pct(lucroBruto));

    setEl('desk-dre-val-despesas', `R$ ${despesasOp.toLocaleString('pt-BR', {minimumFractionDigits:2})}`);
    setEl('desk-dre-pct-despesas', pct(despesasOp));

    setEl('desk-dre-val-liquido', `R$ ${lucroLiquido.toLocaleString('pt-BR', {minimumFractionDigits:2})}`);
    setEl('desk-dre-pct-liquido', pct(lucroLiquido));

    // Orçamento agora vem de dados reais (GET /api/hermes/finances/budget),
    // persistido por usuário -- antes eram dois números fixos no código
    // (R$5.000/R$3.500) que nunca mudavam, e clicar no card não deixava
    // configurar nada de verdade.
    const orcReceita = globalFinanceBudget.receitaTarget || 0;
    const orcDespesa = globalFinanceBudget.despesaTarget || 0;
    const pctOrcReceita = orcReceita > 0 ? Math.min(100, Math.round((totalReceita / orcReceita) * 100)) : 0;
    const pctOrcDespesa = orcDespesa > 0 ? Math.min(100, Math.round((totalDespesas / orcDespesa) * 100)) : 0;

    setEl('desk-val-ring-receita', orcReceita > 0 ? `${pctOrcReceita}%` : '--');
    setEl('desk-orc-receita-val', orcReceita > 0 ? `R$ ${orcReceita.toLocaleString('pt-BR', {minimumFractionDigits:2})}` : 'Não definido');
    setEl('desk-bal-receita-val', orcReceita > 0 ? `R$ ${(totalReceita - orcReceita).toLocaleString('pt-BR', {minimumFractionDigits:2})}` : '--');

    setEl('desk-val-ring-despesa', orcDespesa > 0 ? `${pctOrcDespesa}%` : '--');
    setEl('desk-orc-despesa-val', orcDespesa > 0 ? `R$ ${orcDespesa.toLocaleString('pt-BR', {minimumFractionDigits:2})}` : 'Não definido');
    setEl('desk-bal-despesa-val', orcDespesa > 0 ? `R$ ${(totalDespesas - orcDespesa).toLocaleString('pt-BR', {minimumFractionDigits:2})}` : '--');

    const ringRec = document.getElementById('desk-ring-orc-receita');
    if (ringRec) ringRec.style.strokeDashoffset = 238.76 - (pctOrcReceita / 100) * 238.76;

    const ringDesp = document.getElementById('desk-ring-orc-despesa');
    if (ringDesp) ringDesp.style.strokeDashoffset = 238.76 - (pctOrcDespesa / 100) * 238.76;

    renderDesktopComboChart();
    renderDesktopBalanceTrendChart();
}

// Achado 07/08/2026: os dois gráficos abaixo eram SINTÉTICOS -- extrapolavam
// uma curva fake (`totalReceita * 0.9, * 0.8...`) a partir de UM único
// número do mês atual, repetido pros 12 meses. Agora usam
// globalFinanceHistory (populado em loadFinances() via GET
// /api/hermes/finances/history), com os últimos 12 meses REAIS vindos do
// backend (financialMonthlyHistory em finance.ts).
function monthLabel(monthKey) {
    const [, m] = (monthKey || '').split('-');
    return ['JAN','FEV','MAR','ABR','MAI','JUN','JUL','AGO','SET','OUT','NOV','DEZ'][Number(m) - 1] || '';
}

function renderDesktopComboChart() {
    const barsGroup = document.getElementById('desk-combo-chart-bars-group');
    const linePath = document.getElementById('desk-combo-chart-profit-line');
    if (!barsGroup || !linePath) return;

    const points = globalFinanceHistory.length ? globalFinanceHistory : [];
    const maxVal = Math.max(6000, ...points.map(p => Math.max(p.receitas || 0, p.despesas || 0)));

    let barsHtml = '';
    let lineD = '';
    const startX = 40, stepX = 38, zeroY = 110;

    points.forEach((p, idx) => {
        const x = startX + (idx * stepX);
        const recVal = p.receitas || 0;
        const despVal = p.despesas || 0;
        const profitVal = recVal - despVal;

        const recH = (recVal / maxVal) * 80;
        const despH = (despVal / maxVal) * 80;
        const profitY = zeroY - ((profitVal / maxVal) * 80);

        barsHtml += `<rect x="${x - 7}" y="${zeroY - recH}" width="6" height="${recH}" fill="var(--cyan)" rx="2"/>`;
        barsHtml += `<rect x="${x + 1}" y="${zeroY}" width="6" height="${despH}" fill="#ef4444" rx="2"/>`;
        barsHtml += `<text x="${x}" y="192" fill="#64748b" font-size="8" font-weight="700" text-anchor="middle">${monthLabel(p.month)}</text>`;

        if (idx === 0) lineD += `M ${x} ${profitY}`;
        else lineD += ` L ${x} ${profitY}`;
    });

    barsGroup.innerHTML = barsHtml;
    linePath.setAttribute('d', lineD);
}

function renderDesktopBalanceTrendChart() {
    const pathEl = document.getElementById('desk-balance-trend-path');
    const dotsGroup = document.getElementById('desk-balance-trend-dots');
    if (!pathEl || !dotsGroup) return;

    const points = globalFinanceHistory.length ? globalFinanceHistory : [];
    const saldos = points.map(p => (p.receitas || 0) - (p.despesas || 0));
    const maxAbs = Math.max(2500, ...saldos.map(v => Math.abs(v)));

    let pathD = '';
    let dotsHtml = '';
    const startX = 40, stepX = 38, zeroY = 150, chartHeight = 130;

    saldos.forEach((val, idx) => {
        const x = startX + (idx * stepX);
        const y = zeroY - ((val / maxAbs) * chartHeight);

        if (idx === 0) pathD += `M ${x} ${y}`;
        else pathD += ` L ${x} ${y}`;

        dotsHtml += `<circle cx="${x}" cy="${y}" r="4" fill="var(--yellow)" stroke="#fff" stroke-width="1.5"/>`;
    });

    pathEl.setAttribute('d', pathD);
    dotsGroup.innerHTML = dotsHtml;
}

function renderFinancialHealth(health) {
    if (!health) return;
    const fmt = (n) => `R$ ${(n ?? 0).toFixed(2).replace('.', ',')}`;
    const saldoEl = document.getElementById('fin-tab-saldo');
    if (saldoEl) { saldoEl.textContent = fmt(health.saldo); saldoEl.className = health.saldo >= 0 ? 'kpi-value text-green' : 'kpi-value text-red'; }
    const recEl = document.getElementById('fin-tab-receitas'); if (recEl) recEl.textContent = fmt(health.receitas);
    const despEl = document.getElementById('fin-tab-despesas'); if (despEl) despEl.textContent = fmt(health.despesas);

    const rateEl = document.getElementById('fin-tab-savings-rate');
    const ratePct = Math.round((health.savingsRate || 0) * 100);
    if (rateEl) { rateEl.textContent = `${ratePct}%`; rateEl.className = ratePct >= 15 ? 'kpi-value text-green' : ratePct >= 0 ? 'kpi-value text-yellow' : 'kpi-value text-red'; }

    const statusEl = document.getElementById('fin-tab-status');
    if (statusEl) {
        const labels = { boa: ['🟢', 'Saúde Financeira: Boa'], atencao: ['🟡', 'Saúde Financeira: Atenção'], critica: ['🔴', 'Saúde Financeira: Crítica'] };
        const [dot, text] = labels[health.healthStatus] || ['⚪', 'Saúde Financeira: --'];
        statusEl.innerHTML = `${dot} ${text}`;
    }

    const compareEl = document.getElementById('fin-tab-prev-compare');
    if (compareEl) {
        const despesaPrev = health.despesasPrevMonth || 0;
        if (!despesaPrev) { compareEl.textContent = 'sem dados do mês anterior'; }
        else {
            const diff = ((health.despesas - despesaPrev) / despesaPrev) * 100;
            compareEl.textContent = `${diff >= 0 ? '+' : ''}${diff.toFixed(0)}% em despesas`;
            compareEl.style.color = diff > 10 ? 'var(--red)' : diff < -10 ? 'var(--green)' : 'inherit';
        }
    }

    renderFinanceCategoryChart(health.byCategory || {});
    renderFinanceUpcoming(health.upcoming || []);
    renderDesktopTrendChips(health);
}

// Achado 07/08/2026: os chips "vs mês anterior" dos 6 cards do painel
// executivo (desk-trend-*) ficavam para sempre em "0,0%"/"+0,0%" -- nada
// no código os atualizava. Agora usam a comparação real com o mês
// anterior que já vem em financialHealthSummary (health.*PrevMonth).
function renderDesktopTrendChips(health) {
    const setTrend = (id, curr, prev, invert) => {
        const el = document.getElementById(id);
        if (!el) return;
        if (!prev) { el.textContent = 'sem dado anterior'; el.className = 'kpi-trend'; return; }
        const diff = ((curr - prev) / prev) * 100;
        const good = invert ? diff <= 0 : diff >= 0;
        el.textContent = `${diff >= 0 ? '+' : ''}${diff.toFixed(1)}%`;
        el.className = `kpi-trend ${good ? 'trend-up' : 'trend-down'}`;
    };
    const lucroAtual = health.receitas - health.despesas;
    const lucroPrev = health.receitasPrevMonth - health.despesasPrevMonth;
    setTrend('desk-trend-receita', health.receitas, health.receitasPrevMonth, false);
    setTrend('desk-trend-despesas', health.despesas, health.despesasPrevMonth, true);
    setTrend('desk-trend-lucro', lucroAtual, lucroPrev, false);
    setTrend('desk-trend-saldo', lucroAtual, lucroPrev, false);
}

function renderFinanceCategoryChart(byCategory) {
    const el = document.getElementById('fin-tab-category-chart');
    if (!el) return;
    const entries = Object.entries(byCategory).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]);
    if (!entries.length) { el.innerHTML = '<p class="text-muted">Nenhum gasto registrado este mês.</p>'; return; }
    const max = entries[0][1];
    el.innerHTML = entries.map(([cat, amount]) => `
        <div class="fin-category-row">
            <span class="fin-category-label">${FIN_CATEGORY_ICON[cat] || '📦'} ${FIN_CATEGORY_LABEL[cat] || cat}</span>
            <span class="fin-category-bar-track"><span class="fin-category-bar-fill" style="width:${Math.max(4, Math.round((amount / max) * 100))}%"></span></span>
            <span class="fin-category-amount">R$ ${amount.toFixed(2).replace('.', ',')}</span>
        </div>`).join('');
}

function renderFinanceUpcoming(upcoming) {
    const el = document.getElementById('fin-tab-upcoming-list');
    if (!el) return;
    if (!upcoming.length) { el.innerHTML = '<li class="text-muted">Nenhum pagamento pendente nos próximos dias.</li>'; return; }
    el.innerHTML = upcoming.map(({ entry, daysUntilDue }) => {
        const when = daysUntilDue <= 0 ? 'hoje' : daysUntilDue === 1 ? 'amanhã' : `em ${daysUntilDue} dias`;
        const urgency = daysUntilDue <= 3 ? 'due-soon' : 'due-later';
        const parcela = entry.installment ? ` <span class="badge badge-info">${entry.installment.current}/${entry.installment.total}</span>` : '';
        return `
            <li>
                <span class="item-text-content fin-upcoming-item">
                    <span>${FIN_CATEGORY_ICON[entry.category] || '📦'} <strong>R$ ${entry.amount.toFixed(2).replace('.', ',')}</strong> — ${escapeHtml(entry.description)}${parcela}</span>
                    <span class="fin-upcoming-when ${urgency}">vence ${when}</span>
                </span>
                <div class="item-actions">
                    <button class="btn-item-action" onclick="markFinanceEntryPaid('${entry.id.slice(0, 8).toUpperCase()}')" title="Marcar como pago">✅ Pago</button>
                </div>
            </li>`;
    }).join('');
}

function renderFinancesExtrato(elementId, items) {
    const el = document.getElementById(elementId);
    if (!el) return;
    el.innerHTML = '';
    if (!items || !items.length) { el.innerHTML = '<li class="text-muted">Nenhum lançamento este mês no BROW.</li>'; return; }
    // Era slice(0,30) — um extrato real importado (upload) facilmente passa
    // disso (achado 14/08/2026: extrato de 1 mês só já trouxe 121
    // lançamentos), escondendo a maior parte sem dar pra saber que tem mais.
    items.slice(0, 150).forEach((e) => {
        const li = document.createElement('li');
        const sign = e.type === 'receita' ? '↗️' : '↘️';
        const cls = e.type === 'receita' ? 'text-green' : 'text-red';
        const statusBadge = e.status === 'pendente' ? '<span class="badge badge-warning">Pendente</span>' : '';
        const parcelaBadge = e.installment ? `<span class="badge badge-info">Parcela ${e.installment.current}/${e.installment.total}</span>` : '';
        const dueBadge = e.dueDate && e.status === 'pendente' ? `<span class="badge badge-info">Vence ${new Date(e.dueDate + 'T12:00:00').toLocaleDateString('pt-BR')}</span>` : '';
        const payAction = e.status === 'pendente' ? `<button class="btn-item-action" onclick="markFinanceEntryPaid('${e.id.slice(0, 8).toUpperCase()}')" title="Marcar como pago">✅</button>` : '';
        const bankBadge = e.bank && e.bank !== 'outro' ? `<span class="badge badge-warning">🏦 ${escapeHtml(e.bank)}</span>` : '';
        li.innerHTML = `
            <span class="item-text-content">${sign} <strong class="${cls}">R$ ${e.amount.toFixed(2).replace('.', ',')}</strong> — ${escapeHtml(e.description || e.category)} <span class="badge badge-info">${escapeHtml(e.category)}</span> ${bankBadge} ${statusBadge} ${parcelaBadge} ${dueBadge}</span>
            <div class="item-actions">
                ${payAction}
                <button class="btn-item-action" onclick="editFinanceItemFromModal('${e.id.slice(0, 8).toUpperCase()}', '${escapeHtml(e.description || '').replace(/'/g, "\\'")}', '${e.amount}')" title="Editar">✏️ Editar</button>
                <button class="btn-item-action btn-item-delete" onclick="deleteFinanceReal('${e.id.slice(0, 8).toUpperCase()}')" title="Excluir">🗑️ Excluir</button>
            </div>`;
        el.appendChild(li);
    });
}

async function markFinanceEntryPaid(shortId) {
    try {
        const res = await fetch(`/api/hermes/finances/${shortId}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: 'pago' }) });
        if (!res.ok) throw new Error('pay_failed');
        loadFinances();
        loadDashboardOverview();
    } catch (error) { alert('❌ Erro ao marcar como pago.'); console.error(error); }
}

async function deleteFinanceReal(shortId) {
    if (!confirm("Excluir este lançamento do BROW de produção?")) return;
    try {
        const res = await fetch(`/api/hermes/finances/${shortId}`, { method: 'DELETE' });
        if (!res.ok) throw new Error('delete_failed');
        loadFinances();
        loadDashboardOverview();
    } catch (error) { alert("❌ Erro ao excluir."); console.error(error); }
}

async function submitFinanceForm(event) {
    event.preventDefault();
    const form = event.target;
    const formData = new FormData(form);
    const body = {
        type: formData.get('type'), amount: parseFloat(formData.get('amount')), category: formData.get('category'),
        description: formData.get('description') || '',
        dueDate: formData.get('dueDate') || undefined,
        installments: parseInt(formData.get('installments'), 10) || 1,
        status: formData.get('pendente') ? 'pendente' : 'pago',
    };
    if (!body.amount || !body.category) { alert('Preencha valor e categoria.'); return; }
    try {
        const res = await fetch('/api/hermes/finances', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
        if (!res.ok) throw new Error('create_failed');
        form.reset();
        loadFinances();
        loadDashboardOverview();
    } catch (error) { alert('❌ Erro ao registrar lançamento.'); console.error(error); }
}

/* ── Upload de recibo/PDF na aba Finanças (07/08/2026) ──
   Vai direto pra uma Pages Function dedicada (finances-upload.js) em vez do
   proxy genérico /api/hermes/[[path]].js -- esse proxy lê o body como TEXTO
   e força Content-Type: application/json, o que corromperia um upload
   multipart/form-data. A função dedicada só repassa os bytes crus com o
   Content-Type original (com o boundary do multipart) pro Worker. */
async function uploadFinanceReceipt(event) {
    const input = event.target;
    const files = Array.from(input.files || []);
    if (!files.length) return;
    const statusEl = document.getElementById('fin-upload-status');
    if (statusEl) statusEl.innerHTML = `⏳ Lendo e analisando ${files.length} arquivo(s)...`;
    try {
        const form = new FormData();
        files.forEach(f => form.append('file', f));
        const res = await fetch('/api/hermes/finances/upload', { method: 'POST', body: form });
        const data = await res.json();
        if (!res.ok || !data.ok) throw new Error(data.message || 'upload_failed');
        if (statusEl) statusEl.innerHTML = '✅ ' + escapeHtml(data.message || `${data.count || 0} lançamento(s) criado(s).`);
        input.value = '';
        loadFinances();
        loadDashboardOverview();
    } catch (error) {
        if (statusEl) statusEl.innerHTML = '❌ Não consegui processar este arquivo. Tente uma foto mais nítida ou um PDF legível.';
        console.error(error);
    }
}

/* ── Automação: ações reais consultando o BROW de produção ──────────── */
async function testFinancialGuard() {
    try {
        const res = await fetch('/api/hermes/finances');
        const data = await res.json();
        const saldo = data.summary?.saldo ?? 0;
        if (saldo < 0) alert(`⚠️ ALERTA REAL:\nSaldo do mês negativo: R$ ${saldo.toFixed(2).replace('.', ',')}`);
        else alert(`✅ Saúde financeira real:\nSaldo do mês: R$ ${saldo.toFixed(2).replace('.', ',')} (${data.items?.length || 0} lançamentos)`);
    } catch (error) { alert('❌ Não consegui consultar as finanças reais.'); console.error(error); }
}

async function showGraphOverview() {
    try {
        const res = await fetch('/api/hermes/graph');
        const data = await res.json();
        alert(data.overview || `Grafo: ${data.nodeCount} entidades, ${data.edgeCount} conexões.`);
    } catch (error) { alert('❌ Não consegui consultar o grafo real.'); console.error(error); }
}

/* ── Pesquisa Web real ───────────────────────────────────────────────── */
async function executeWebSearch(event) {
    if (event) event.preventDefault();
    const input = document.getElementById('search-query-input');
    const resultsBox = document.getElementById('search-results-box');
    const query = input.value.trim();
    if (!query) return;
    resultsBox.innerHTML = '<p class="text-muted">🔎 Rodando Deep Research real... pode levar ~15s.</p>';
    try {
        const response = await fetch('/api/hermes/research', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ query }) });
        const data = await response.json();
        if (!data.ok) throw new Error(data.message || 'Erro na pesquisa');
        const r = data.report;
        const sources = (r.sources || []).map(s => `<li><a href="${s.url}" target="_blank">[${s.n}] ${escapeHtml(s.title)}</a></li>`).join('');
        resultsBox.innerHTML = `
            <div style="display:flex;flex-direction:column;gap:10px;">
                <div style="border-bottom:1px solid var(--border);padding-bottom:6px;"><span class="badge badge-info">🔍 ${escapeHtml(r.query)}</span></div>
                <div class="message agent-message" style="white-space: pre-wrap; margin:0;">${escapeHtml(r.synthesis)}</div>
                ${sources ? `<div><strong>Fontes:</strong><ul style="margin:4px 0 0 18px;">${sources}</ul></div>` : ''}
            </div>`;
    } catch (error) {
        resultsBox.innerHTML = `<p class="text-red">❌ ${escapeHtml(error.message || 'Erro ao pesquisar')}</p>`;
        console.error(error);
    }
}
function quickSearchTopic(topicQuery) {
    const input = document.getElementById('search-query-input');
    if (input) input.value = topicQuery;
    executeWebSearch(new Event('submit'));
}

async function triggerBriefing() {
    try {
        const res = await fetch('/api/hermes/briefing', { method: 'POST' });
        const data = await res.json();
        if (!data.ok) throw new Error('briefing_failed');
        const status = data.telegramSent ? '✅ Enviado ao Telegram agora.' : '⚠️ Gerado, mas não consegui enviar ao Telegram (verifique o bot).';
        alert(`✨ Briefing Executivo\n\n${data.text}\n\n${status}`);
    } catch (error) {
        alert('❌ Não consegui gerar o briefing agora.');
        console.error(error);
    }
}

/* ── Documentos/Contatos/Metas: memórias reais com a categoria certa ───── */
async function submitCategoryMemoryForm(event, mainCategory) {
    event.preventDefault();
    const form = event.target;
    const formData = new FormData(form);
    const title = formData.get('title') || formData.get('name');
    if (!title) return;
    const parts = [];
    for (const [key, value] of formData.entries()) if (value) parts.push(`${key}: ${value}`);
    try {
        const res = await fetch('/api/hermes/memories', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ title, summary: parts.join('; '), mainCategory, category: mainCategory })
        });
        if (!res.ok) throw new Error('create_failed');
        alert('✅ Registrado no BROW de produção.');
        form.reset();
        if (mainCategory === 'meta') loadMetas();
        else loadMemories(mainCategory);
        loadDashboardOverview();
    } catch (error) { alert('❌ Erro ao registrar.'); console.error(error); }
}

async function submitForm(event, endpoint) {
    event.preventDefault();
    if (endpoint === 'finances') return submitFinanceForm(event);
    if (endpoint === 'documents') return submitCategoryDocumentFormDesk(event);
    if (endpoint === 'contacts') return submitContactFormDesk(event);
    if (endpoint === 'goals') return submitGoalFormDesk(event);
    alert('Este módulo (' + endpoint + ') usa a inteligência unificada de Memória e Agenda do BROW.');
}

let extractedContactsDesk = [];

async function loadContactsDesk() {
    const list = document.getElementById('tab-contacts-list');
    if (!list) return;
    try {
        const res = await fetch('/api/hermes/contacts');
        const data = await res.json();
        const rows = data.rows || [];
        list.innerHTML = rows.length ? rows.map((contact) => `<li class="data-item"><span class="item-text-content"><strong>${escapeHtml(contact.name)}</strong> — ${escapeHtml(contact.phone || 'Sem telefone')}${contact.email ? ` · ${escapeHtml(contact.email)}` : ''}</span><div class="item-actions"><button class="btn-item-action btn-item-delete" onclick="deleteContactDesk('${contact.id}')">Excluir</button></div></li>`).join('') : '<li class="text-muted">Nenhum contato cadastrado.</li>';
    } catch (error) { list.innerHTML = '<li class="text-muted">Não foi possível carregar os contatos.</li>'; console.error(error); }
}

async function submitContactFormDesk(event) {
    event.preventDefault();
    const data = new FormData(event.target);
    const name = String(data.get('name') || '').trim();
    if (!name) return;
    const res = await fetch('/api/hermes/contacts', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, phone: data.get('phone') || '', notes: data.get('relationship') || '' }) });
    const result = await res.json().catch(() => ({}));
    if (!res.ok || result.ok === false) { alert('Não foi possível salvar o contato.'); return; }
    event.target.reset();
    await loadContactsDesk();
}

async function deleteContactDesk(id) {
    if (!confirm('Excluir este contato?')) return;
    const res = await fetch(`/api/hermes/contacts/${id}`, { method: 'DELETE' });
    if (!res.ok) { alert('Não foi possível excluir o contato.'); return; }
    await loadContactsDesk();
}

function renderExtractedContactsDesk() {
    const preview = document.getElementById('contacts-extract-preview');
    const save = document.getElementById('contacts-save-extracted');
    if (!preview || !save) return;
    const selectable = extractedContactsDesk.filter((contact) => !contact.duplicate);
    preview.innerHTML = extractedContactsDesk.length ? extractedContactsDesk.map((contact, index) => `<li class="data-item"><label style="display:flex;gap:8px;align-items:center;"><input type="checkbox" class="extracted-contact-checkbox" value="${index}" ${contact.duplicate ? 'disabled' : 'checked'}><span><strong>${escapeHtml(contact.name)}</strong> — ${escapeHtml(contact.phone || contact.email || '')}${contact.duplicate ? ' (já existe)' : ''}</span></label></li>`).join('') : '<li class="text-muted">Nenhum contato reconhecido no arquivo.</li>';
    save.style.display = selectable.length ? 'inline-flex' : 'none';
}

async function extractContactsDesk(event) {
    const file = event.target.files?.[0];
    if (!file) return;
    const status = document.getElementById('contacts-extract-status');
    if (status) status.textContent = 'Extraindo contatos; nada será salvo sem sua confirmação.';
    try {
        const form = new FormData(); form.append('file', file);
        const res = await fetch('/api/hermes/contacts/extract', { method: 'POST', body: form });
        const data = await res.json();
        if (!res.ok || data.ok === false) throw new Error(data.error || 'extract_failed');
        extractedContactsDesk = data.contacts || [];
        renderExtractedContactsDesk();
        if (status) status.textContent = `${extractedContactsDesk.length} contato(s) encontrado(s). Revise a seleção antes de salvar.`;
    } catch (error) { if (status) status.textContent = 'Falha ao extrair contatos.'; console.error(error); }
}

async function saveExtractedContactsDesk() {
    const chosen = [...document.querySelectorAll('.extracted-contact-checkbox:checked')].map((box) => extractedContactsDesk[Number(box.value)]).filter(Boolean);
    if (!chosen.length) { alert('Selecione pelo menos um contato.'); return; }
    const res = await fetch('/api/hermes/contacts', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ contacts: chosen }) });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data.ok === false) { alert('Não foi possível salvar os contatos.'); return; }
    extractedContactsDesk = [];
    renderExtractedContactsDesk();
    await loadContactsDesk();
    alert(`${data.created || 0} contato(s) salvo(s).`);
}

/* ── MÓDULO DE DOCUMENTOS & ARQUIVOS (COFRE R2 + MEMÓRIA AI) ── */
let globalDocumentsDesk = [];

async function loadDocumentsDesk() {
    const listEl = document.getElementById('tab-documents-list');
    const badgeEl = document.getElementById('doc-count-badge-tab');
    if (!listEl) return;
    try {
        const res = await fetch('/api/hermes/documents');
        const data = await res.json();
        globalDocumentsDesk = data.items || [];
        if (badgeEl) badgeEl.textContent = `${globalDocumentsDesk.length} Arquivo${globalDocumentsDesk.length !== 1 ? 's' : ''}`;
        filterDocumentsDesk();
    } catch (e) {
        listEl.innerHTML = '<li class="text-muted">❌ Erro ao carregar documentos.</li>';
    }
}

function filterDocumentsDesk() {
    const listEl = document.getElementById('tab-documents-list');
    const badgeEl = document.getElementById('doc-count-badge-tab');
    if (!listEl) return;

    const query = (document.getElementById('doc-search-input')?.value || '').toLowerCase().trim();
    const cat = document.getElementById('doc-category-filter')?.value || 'all';

    let filtered = globalDocumentsDesk;
    if (cat !== 'all') {
        filtered = filtered.filter(d => (d.category || '').toLowerCase() === cat.toLowerCase() || (d.mainCategory || '').toLowerCase() === cat.toLowerCase());
    }
    if (query) {
        filtered = filtered.filter(d => (d.title + ' ' + (d.summary || '') + ' ' + (d.category || '')).toLowerCase().includes(query));
    }

    if (badgeEl) badgeEl.textContent = `${filtered.length} Arquivo${filtered.length !== 1 ? 's' : ''}`;

    if (!filtered.length) {
        listEl.innerHTML = '<li class="text-muted" style="padding:16px 0; text-align:center;">Nenhum documento encontrado no cofre.</li>';
        return;
    }

    listEl.innerHTML = filtered.map(d => {
        const fullId = d.id || '';
        const shortId = d.id ? d.id.slice(0, 8).toUpperCase() : '';
        const mime = d.mime || d.mime_type || '';
        const sizeStr = d.fileSize ? ` • ${(d.fileSize / 1024).toFixed(0)} KB` : '';
        const dateStr = (d.createdAt || d.created_at) ? new Date(d.createdAt || d.created_at).toLocaleDateString('pt-BR') : '';
        
        let fileIcon = '📄';
        if (mime.includes('pdf')) fileIcon = '📕';
        else if (mime.includes('sheet') || mime.includes('excel') || mime.includes('csv')) fileIcon = '📊';
        else if (mime.includes('word') || mime.includes('document') || mime.includes('text')) fileIcon = '📝';
        else if (mime.includes('image')) fileIcon = '🖼️';

        return `
            <li class="data-item" style="display:flex; justify-content:space-between; align-items:center; padding:10px 12px; background:rgba(15,23,42,0.6); border:1px solid var(--border); border-radius:10px; margin-bottom:8px;">
                <div style="display:flex; align-items:center; gap:10px;">
                    <div style="font-size:24px;">${fileIcon}</div>
                    <div>
                        <strong style="color:#fff; font-size:13px; display:block;">${escapeHtml(d.title || d.display_name || d.filename || d.sourceName || 'Documento')}</strong>
                        <div style="font-size:11px; color:var(--text-2); margin-top:2px;">
                            <span class="badge badge-info" style="font-size:9.5px;">${escapeHtml(d.category || 'documento')}</span>
                            <span>${dateStr}${sizeStr}</span>
                            <span style="color:var(--cyan); margin-left:6px;">🧠 Memória AI Ativa</span>
                        </div>
                    </div>
                </div>
                <div style="display:flex; gap:6px;">
                    <button class="btn btn-sm" style="background:rgba(6,182,212,0.15); color:var(--cyan); border:1px solid rgba(6,182,212,0.3);" onclick="viewOrDownloadDocument('${escapeHtml(fullId || shortId)}', '${escapeHtml(d.mime || '')}', '${escapeHtml(d.title || '')}')">👁️ Abrir</button>
                    <button class="btn btn-sm btn-item-delete" onclick="deleteDocumentDesk('${escapeHtml(fullId || shortId)}')">🗑️ Excluir</button>
                </div>
            </li>`;
    }).join('');
}

async function uploadDocumentFileDesk(event) {
    const input = event.target;
    const files = input.files;
    const statusEl = document.getElementById('doc-upload-status-desk');
    if (!files || !files.length) return;

    const titleInput = document.getElementById('doc-form-title');
    const catInput = document.getElementById('doc-form-category');
    const valInput = document.getElementById('doc-form-validity');

    // O nome digitado prevalece; sem ele, antecipamos o nome-base do arquivo
    // antes do upload para persistir e exibir o mesmo título.
    if (files.length === 1 && titleInput && !titleInput.value.trim()) {
        titleInput.value = files[0].name.replace(/\.[^.]+$/, '') || files[0].name;
    }
    const customTitle = titleInput?.value.trim() || '';
    const customCat = catInput?.value.trim() || 'documento';
    const customVal = valInput?.value || '';

    if (statusEl) statusEl.innerHTML = `⏳ Enviando ${files.length} arquivo(s) e integrando com OCR à Memório BROW...`;

    try {
        for (let i = 0; i < files.length; i++) {
            const file = files[i];
            const formData = new FormData();
            formData.append('file', file);
            if (customTitle) formData.append('title', customTitle);
            if (customCat) formData.append('category', customCat);
            if (customVal) formData.append('validity', customVal);

            const res = await fetch('/api/hermes/documents/upload', {
                method: 'POST',
                body: formData
            });
            const data = await res.json();
            if (!data.ok) throw new Error(data.message || 'Erro no upload');
        }

        if (statusEl) statusEl.innerHTML = `✅ ${files.length} arquivo(s) salvo(s) no R2 e sincronizado(s) com a Mente BROW!`;
        input.value = '';
        if (titleInput) titleInput.value = '';
        if (valInput) valInput.value = '';
        loadDocumentsDesk();
        loadDashboardOverview();
    } catch (e) {
        if (statusEl) statusEl.innerHTML = `❌ Erro no upload: ${escapeHtml(e.message || 'Falha ao enviar arquivo')}`;
        console.error(e);
    }
}

async function submitCategoryDocumentFormDesk(event) {
    if (event) event.preventDefault();
    const titleInput = document.getElementById('doc-form-title');
    const catInput = document.getElementById('doc-form-category');
    const valInput = document.getElementById('doc-form-validity');
    const fileInput = document.getElementById('doc-file-upload-input');

    if (fileInput && fileInput.files && fileInput.files.length > 0) {
        return uploadDocumentFileDesk({ target: fileInput });
    }

    const title = titleInput?.value.trim();
    if (!title) { alert('Digite o nome do documento ou selecione um arquivo.'); return; }

    try {
        const res = await fetch('/api/hermes/documents', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                title,
                category: catInput?.value.trim() || 'documento',
                validity: valInput?.value || null,
                mainCategory: 'documento',
                summary: `Documento registrado: ${title} (${catInput?.value || 'geral'})`
            })
        });
        if (!res.ok) throw new Error('create_failed');
        alert('✅ Documento cadastrado e compartilhado com a Memório BROW!');
        if (titleInput) titleInput.value = '';
        if (valInput) valInput.value = '';
        loadDocumentsDesk();
        loadDashboardOverview();
    } catch (error) { alert('❌ Erro ao cadastrar documento.'); console.error(error); }
}

function viewOrDownloadDocument(docId, mime, title) {
    const fileUrl = `/api/hermes/documents/${docId}/file`;
    window.open(fileUrl, '_blank');
}

async function deleteDocumentDesk(docId) {
    if (!confirm('Deseja excluir este documento do R2 e da Memória AI do BROW?')) return;
    try {
        // Atualização instantânea da UI: remove localmente o item antes da requisição HTTP
        globalDocumentsDesk = globalDocumentsDesk.filter(d => d.id !== docId && (d.id && d.id.slice(0, 8).toUpperCase() !== docId.slice(0, 8).toUpperCase()));
        filterDocumentsDesk();

        const res = await fetch(`/api/hermes/documents/${docId}`, { method: 'DELETE' });
        const data = await res.json();
        if (!res.ok || !data.ok) throw new Error(data.message || 'delete_failed');
        alert('🗑️ Documento e arquivo excluídos com sucesso!');
        loadDocumentsDesk();
        loadDashboardOverview();
    } catch (e) {
        alert('❌ Erro ao excluir documento: ' + (e.message || 'Falha na conexão'));
        loadDocumentsDesk();
    }
}

function closeEditModal() { const modal = document.getElementById('edit-modal'); if (modal) modal.classList.remove('active'); }
function saveEditModal(event) { if (event) event.preventDefault(); closeEditModal(); }

/* ── Pesquisas programadas ────────────────────────────────────────────── */
let globalScheduledSearches = [];
function renderScheduledSearches() {
    const el = document.getElementById('scheduled-searches-list');
    if (!el) return;
    el.innerHTML = '';
    if (!globalScheduledSearches.length) { el.innerHTML = '<li class="text-muted">Nenhuma pesquisa programada localmente.</li>'; return; }
    globalScheduledSearches.forEach((item, idx) => {
        const li = document.createElement('li');
        li.innerHTML = `<span class="item-text-content">📡 <strong>${escapeHtml(item.topic)}</strong> <span class="badge badge-info">${escapeHtml(item.frequency)} @ ${escapeHtml(item.hour)}</span></span>
            <div class="item-actions"><button class="btn-item-action btn-item-delete" onclick="deleteScheduledSearch(${idx})">🗑️ Excluir</button></div>`;
        el.appendChild(li);
    });
}
function addScheduledSearch(event) {
    event.preventDefault();
    const topic = document.getElementById('sch-topic').value.trim();
    if (!topic) return;
    globalScheduledSearches.push({ topic, frequency: document.getElementById('sch-freq').value, hour: document.getElementById('sch-hour').value });
    document.getElementById('sch-topic').value = '';
    renderScheduledSearches();
    alert('✅ Adicionado à lista local.');
}
function deleteScheduledSearch(index) { globalScheduledSearches.splice(index, 1); renderScheduledSearches(); }

/* ── Theme Toggle ─────────────────────────────────────── */
function toggleTheme() {
    const body = document.body;
    const isDark = !body.classList.contains('light-theme');
    body.classList.toggle('light-theme', isDark);
    localStorage.setItem('theme', isDark ? 'light' : 'dark');
}
(function() {
    if (localStorage.getItem('theme') === 'light') document.body.classList.add('light-theme');
})();

function drawSparkline() {
    const canvas = document.getElementById('sparkline');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
}

/* ── PROGRAMADOR DE BRIEFINGS DIÁRIOS DE NOTÍCIAS POR ASSUNTO ── */
// Agendamento real desde 14/08/2026: cada briefing programado é uma linha
// em hermes_cloud_automations com next_run_at — o cron fixo do Worker
// (*/5min, automation_dispatch.ts) dispara sozinho quando chega a hora e
// reagenda pro próximo ciclo. Nada mais em localStorage.
let globalScheduledBriefings = [];

const FREQUENCY_LABELS = { daily: 'Diário (Seg a Dom)', weekdays: 'Dias Úteis (Seg a Sex)', weekends: 'Finais de Semana' };
const FREQUENCY_VALUES = { 'Diário (Seg a Dom)': 'daily', 'Dias Úteis (Seg a Sex)': 'weekdays', 'Finais de Semana': 'weekends' };

function selectBriefingTopic(topicText) {
    const input = document.getElementById('briefing-topic-input');
    if (input) input.value = topicText;
}

async function loadScheduledBriefings() {
    try {
        const res = await fetch('/api/hermes/automations');
        const data = await res.json();
        globalScheduledBriefings = (data.rows || []).filter(r => r.payload && r.payload.topic);
    } catch (e) {
        globalScheduledBriefings = [];
    }
    renderScheduledBriefings();
}

function renderScheduledBriefings() {
    const el = document.getElementById('scheduled-briefings-list');
    const countSpan = document.getElementById('scheduled-briefings-count');
    if (countSpan) countSpan.textContent = `${globalScheduledBriefings.length} ativos`;
    if (!el) return;
    el.innerHTML = '';
    if (!globalScheduledBriefings.length) {
        el.innerHTML = '<li class="text-muted">Nenhum briefing de notícias programado ainda. Escolha um tópico acima para cadastrar!</li>';
        return;
    }
    globalScheduledBriefings.forEach((b) => {
        const hour = b.next_run_at ? new Date(b.next_run_at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo' }) : '—';
        const freqLabel = FREQUENCY_LABELS[b.frequency] || b.frequency || 'Diário';
        const li = document.createElement('li');
        li.innerHTML = `
            <div class="form-col gap-1" style="flex:1;">
                <span class="item-text-content">📡 <strong>${escapeHtml(b.payload.topic)}</strong></span>
                <div style="display:flex; gap:6px; flex-wrap:wrap; font-size:11px;">
                    <span class="badge badge-info">⏰ ${escapeHtml(hour)}</span>
                    <span class="badge badge-success">${escapeHtml(freqLabel)}</span>
                    <span class="badge badge-warning">🟢 Ativo no Cron</span>
                </div>
            </div>
            <div class="item-actions">
                <button class="btn btn-primary btn-xs" onclick="testBriefingNow(${b.id})" title="Pesquisar e exibir resumo agora">⚡ Executar Agora</button>
                <button class="btn-item-action btn-item-delete" onclick="deleteScheduledBriefing(${b.id})" title="Excluir agendamento">🗑️ Excluir</button>
            </div>`;
        el.appendChild(li);
    });
}

function computeNextRunAt(hour, frequency) {
    const [h, m] = hour.split(':').map(Number);
    const now = new Date();
    // Calcula em horário de Brasília, convertendo de volta pra UTC — mesmo
    // padrão usado no resto do dashboard pra horários informados pelo usuário.
    const brNow = new Date(now.toLocaleString('en-US', { timeZone: 'America/Sao_Paulo' }));
    const offsetMs = now.getTime() - brNow.getTime();
    let candidate = new Date(brNow);
    candidate.setHours(h, m, 0, 0);
    if (candidate <= brNow) candidate = new Date(candidate.getTime() + 24 * 60 * 60 * 1000);
    while (
        (frequency === 'weekdays' && (candidate.getDay() === 0 || candidate.getDay() === 6)) ||
        (frequency === 'weekends' && candidate.getDay() !== 0 && candidate.getDay() !== 6)
    ) {
        candidate = new Date(candidate.getTime() + 24 * 60 * 60 * 1000);
    }
    return new Date(candidate.getTime() + offsetMs).toISOString();
}

async function addScheduledBriefing(event) {
    if (event) event.preventDefault();
    const topicInput = document.getElementById('briefing-topic-input');
    const timeInput = document.getElementById('briefing-time-input');
    const freqInput = document.getElementById('briefing-freq-input');
    const topic = topicInput?.value.trim();
    if (!topic) return;

    const hour = timeInput?.value || '08:00';
    const frequencyLabel = freqInput?.value || 'Diário (Seg a Dom)';
    const frequency = FREQUENCY_VALUES[frequencyLabel] || 'daily';

    try {
        const res = await fetch('/api/hermes/automations', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                name: `Briefing: ${topic}`,
                frequency,
                next_run_at: computeNextRunAt(hour, frequency),
                payload: { topic },
            })
        });
        const data = await res.json();
        if (!data.ok) throw new Error('create_failed');
        if (topicInput) topicInput.value = '';
        await loadScheduledBriefings();
        alert(`✅ Briefing programado!\nA BROW pesquisará sobre "${topic}" e entregará no Telegram automaticamente, diariamente às ${hour}.`);
    } catch (e) {
        alert('❌ Não consegui programar esse briefing agora.');
    }
}

async function deleteScheduledBriefing(id) {
    if (!confirm("Deseja remover este agendamento?")) return;
    try {
        await fetch(`/api/hermes/automations/${id}`, { method: 'DELETE' });
        await loadScheduledBriefings();
    } catch (e) { alert('❌ Não consegui remover agora.'); }
}

async function testBriefingNow(id) {
    const briefing = globalScheduledBriefings.find(b => b.id === id);
    if (!briefing) return;
    const topic = briefing.payload.topic;

    const briefingBox = document.getElementById('briefing-automacao-box');
    if (briefingBox) briefingBox.innerHTML = `<p class="text-muted">🔎 Pesquisando sobre <strong>${escapeHtml(topic)}</strong>...</p>`;

    try {
        const res = await fetch('/api/hermes/news-briefing', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ topic })
        });
        const data = await res.json();
        if (!data.ok) throw new Error('briefing_failed');
        const status = data.telegramSent ? '✅ Enviado ao Telegram.' : '⚠️ Não consegui enviar ao Telegram.';
        if (briefingBox) {
            briefingBox.innerHTML = `<div style="white-space:pre-wrap;">${escapeHtml(data.text)}</div><p style="margin-top:8px;">${status}</p>`;
            briefingBox.scrollIntoView({ behavior: 'smooth' });
        }
    } catch (e) {
        if (briefingBox) briefingBox.innerHTML = `<p class="text-red">❌ Erro ao executar briefing: ${escapeHtml(e.message)}</p>`;
    }
}

/* ── TELEGRAM PERSISTENT CHAT & RESPONSE MODE ENGINE ── */
let voiceChatHistoryMessages = [];
let chatResponseMode = localStorage.getItem('hermes_chat_mode') || 'both';

function setChatMode(mode) {
    chatResponseMode = mode;
    localStorage.setItem('hermes_chat_mode', mode);
    ['both', 'text', 'audio'].forEach(m => {
        const btn = document.getElementById(`mode-btn-${m}`);
        if (btn) {
            if (m === mode) btn.classList.add('active');
            else btn.classList.remove('active');
        }
    });
}

function loadChatMessagesFromStorage() {
    try {
        const saved = localStorage.getItem('hermes_telegram_chat_history');
        if (saved) {
            voiceChatHistoryMessages = JSON.parse(saved);
        } else {
            voiceChatHistoryMessages = [
                {
                    id: 'init-1',
                    text: '✈️ **BROW Telegram Assistant**\n\nOlá! Sou o BROW, seu assistente neural conectado 24/7 ao seu Telegram e Segundo Cérebro. Como posso te ajudar hoje?',
                    sender: '✈️ BROW',
                    isUser: false,
                    timestamp: formatTelegramTime(new Date())
                }
            ];
        }
    } catch (e) {
        voiceChatHistoryMessages = [];
    }
    renderAllVoiceChatMessages();
    setChatMode(chatResponseMode);
}

function repeatLastHermesMessage(e) {
    if (e && e.preventDefault) { e.preventDefault(); e.stopPropagation(); }
    const lastMsg = [...voiceChatHistoryMessages].reverse().find(m => !m.isUser && m.text);
    if (lastMsg && lastMsg.text) {
        speakWithEdgeTTS(lastMsg.text);
    } else {
        speakWithEdgeTTS("Olá! Sou o BROW, seu assistente neural conectado e pronto para ajudar.");
    }
    return false;
}

function speakMessageText(btn, e) {
    if (e && e.preventDefault) { e.preventDefault(); e.stopPropagation(); }
    const msgId = btn ? btn.getAttribute('data-msg-id') : null;
    const targetMsg = voiceChatHistoryMessages.find(m => m.id === msgId);
    if (targetMsg && targetMsg.text) {
        speakWithEdgeTTS(targetMsg.text);
    }
    return false;
}

function saveChatMessagesToStorage() {
    try {
        localStorage.setItem('hermes_telegram_chat_history', JSON.stringify(voiceChatHistoryMessages.slice(-50)));
    } catch (e) {}
}

function clearVoiceChatHistory() {
    if (!confirm("Deseja apagar todo o histórico de conversas do chat?")) return;
    voiceChatHistoryMessages = [
        {
            id: 'init-1',
            text: '✈️ Histórico zerado com sucesso! Como posso ajudar você agora?',
            sender: '✈️ BROW',
            isUser: false,
            timestamp: formatTelegramTime(new Date())
        }
    ];
    saveChatMessagesToStorage();
    renderAllVoiceChatMessages();
}

function formatTelegramTime(dateObj) {
    const d = dateObj || new Date();
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function parseMarkdownToHtml(text) {
    if (!text) return '';
    let html = escapeHtml(text);
    html = html.replace(/\[Clique aqui para ler\]\((https?:\/\/[^)\s]+)\)/g, '<a href="$1" target="_blank" rel="noopener noreferrer" style="color:var(--cyan); font-weight:700;">Clique aqui para ler ↗</a>');
    html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    html = html.replace(/\*([^*]+)\*/g, '<strong>$1</strong>');
    html = html.replace(/`([^`]+)`/g, '<code style="background:rgba(0,0,0,0.3); padding:2px 6px; border-radius:4px; font-family:monospace;">$1</code>');
    html = html.replace(/^• /gm, '&bull; ');
    html = html.replace(/\n/g, '<br>');
    return html;
}

function renderAllVoiceChatMessages() {
    const container = document.getElementById('voice-chat-messages');
    if (!container) return;
    container.innerHTML = '';
    
    voiceChatHistoryMessages.forEach(msg => {
        const msgDiv = document.createElement('div');
        msgDiv.id = `chat-msg-${msg.id}`;
        
        if (msg.isUser) {
            msgDiv.style.cssText = 'align-self:flex-end; max-width:82%; background:#2b5278; color:#ffffff; padding:10px 14px; border-radius:12px 12px 2px 12px; box-shadow:0 1px 3px rgba(0,0,0,0.3); font-size:14px; line-height:1.45; position:relative; word-break:break-word; margin-left:auto;';
            msgDiv.innerHTML = `
                <div style="font-weight:600; font-size:12px; color:#85b3db; margin-bottom:3px; display:flex; justify-content:space-between; align-items:center;">
                    <span>Você</span>
                    <span style="font-size:10px; color:rgba(255,255,255,0.6); margin-left:8px;">${escapeHtml(msg.timestamp || '')} ✓✓</span>
                </div>
                <div>${parseMarkdownToHtml(msg.text)}</div>`;
        } else {
            msgDiv.style.cssText = 'align-self:flex-start; max-width:85%; background:#182533; color:#e1e9f0; padding:10px 14px; border-radius:12px 12px 12px 2px; border-left:3px solid var(--purple); box-shadow:0 1px 3px rgba(0,0,0,0.3); font-size:14px; line-height:1.5; position:relative; word-break:break-word;';
            msgDiv.innerHTML = `
                <div style="font-weight:700; font-size:12px; color:var(--cyan); margin-bottom:4px; display:flex; justify-content:space-between; align-items:center;">
                    <span>✈️ BROW Cloud</span>
                    <div style="display:flex; align-items:center; gap:8px;">
                        <button type="button" onclick="speakMessageText(this, event); return false;" data-msg-id="${msg.id}" title="Ouvir / Reler esta mensagem por voz" style="background:rgba(168,85,247,0.2); border:1px solid rgba(168,85,247,0.4); color:#c084fc; font-size:10px; border-radius:10px; padding:2px 8px; cursor:pointer; font-weight:600; transition:all 0.2s ease;">🔊 Reler</button>
                        <span style="font-size:10px; color:rgba(255,255,255,0.5);">${escapeHtml(msg.timestamp || '')}</span>
                    </div>
                </div>
                <div>${parseMarkdownToHtml(msg.text)}</div>`;
        }
        container.appendChild(msgDiv);
    });
    container.scrollTop = container.scrollHeight;
}

/* ── PAINEL NEURAL VIVO — ASSISTENTE COMPLETA COM CHAT + VOICE ── */
let waveCanvas, waveCtx, waveAnimFrame;
let wavePhase = 0;
let isSpeakingOrListening = false;

// Shared neural nucleus: the Dashboard keeps its own shell/sidebar while this
// canvas mirrors the dark cyan/violet visual language of the desktop core.
function initNeuralCoreCanvas() {
    const canvas = document.getElementById('hud-core-canvas');
    if (canvas && (window.BrowCore || window.BrowNeuralCore || canvas.dataset.browSharedCore === "true")) {
        return; // voz-core.js já renderiza o núcleo de 3.600 partículas no canvas
    }
    if (!canvas || canvas.dataset.neuralReady) return;
    canvas.dataset.neuralReady = 'true';
    const ctx = canvas.getContext('2d');
    const points = Array.from({ length: 620 }, () => ({
        a: Math.random() * Math.PI * 2,
        r: 0.28 + Math.random() * 0.68,
        s: 0.2 + Math.random() * 1.1,
        hue: Math.random() > .48 ? 190 : 275,
    }));
    let phase = 0;
    function draw() {
        const rect = canvas.getBoundingClientRect();
        const size = Math.max(1, Math.round(Math.min(rect.width || 360, rect.height || 360) * (window.devicePixelRatio || 1)));
        if (canvas.width !== size || canvas.height !== size) { canvas.width = size; canvas.height = size; }
        const dpr = window.devicePixelRatio || 1, w = size / dpr, c = w / 2;
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, w, w);
        const pulse = 1 + Math.sin(phase * 1.8) * (isSpeakingOrListening ? .055 : .018);
        for (let i = 1; i <= 3; i++) {
            ctx.beginPath(); ctx.arc(c, c, w * (.18 + i * .11) * pulse, 0, Math.PI * 2);
            ctx.strokeStyle = i % 2 ? 'rgba(168,85,247,.42)' : 'rgba(6,182,212,.38)'; ctx.lineWidth = 1.2; ctx.stroke();
        }
        points.forEach((p, i) => {
            const a = p.a + phase * p.s * .16;
            const r = p.r * w * .42 * pulse;
            const x = c + Math.cos(a) * r, y = c + Math.sin(a) * r;
            const alpha = .2 + .65 * (1 - p.r);
            ctx.fillStyle = `hsla(${p.hue}, 94%, 66%, ${alpha})`;
            ctx.fillRect(x, y, i % 6 ? 1.6 : 2.6, i % 6 ? 1.6 : 2.6);
            if (i % 4 === 0) { ctx.beginPath(); ctx.moveTo(c + Math.cos(a - .18) * (r * .42), c + Math.sin(a - .18) * (r * .42)); ctx.lineTo(x, y); ctx.strokeStyle = `hsla(${p.hue},90%,65%,.10)`; ctx.stroke(); }
        });
        const glow = ctx.createRadialGradient(c, c, w * .04, c, c, w * .26);
        glow.addColorStop(0, '#040812'); glow.addColorStop(.65, 'rgba(3,7,18,.90)'); glow.addColorStop(1, 'rgba(3,7,18,0)');
        ctx.fillStyle = glow; ctx.beginPath(); ctx.arc(c, c, w * .28, 0, Math.PI * 2); ctx.fill();
        ctx.beginPath(); ctx.arc(c, c, w * .19 * pulse, 0, Math.PI * 2); ctx.strokeStyle = 'rgba(226,232,240,.78)'; ctx.lineWidth = 2; ctx.shadowBlur = 15; ctx.shadowColor = '#a855f7'; ctx.stroke(); ctx.shadowBlur = 0;
        phase += isSpeakingOrListening ? .05 : .018; requestAnimationFrame(draw);
    }
    draw();
}

function initNeuralWaveCanvas() {
    waveCanvas = document.getElementById('neural-wave-canvas');
    if (!waveCanvas) return;
    waveCtx = waveCanvas.getContext('2d');
    function resizeCanvas() {
        if (!waveCanvas) return;
        waveCanvas.width = waveCanvas.offsetWidth || 800;
        waveCanvas.height = waveCanvas.offsetHeight || 110;
    }
    resizeCanvas();
    window.addEventListener('resize', resizeCanvas);
    function renderWave() {
        if (!waveCtx || !waveCanvas) return;
        const w = waveCanvas.width, h = waveCanvas.height, cy = h / 2;
        waveCtx.clearRect(0, 0, w, h);
        wavePhase += isSpeakingOrListening ? 0.08 : 0.025;
        const layers = [
            { color: 'rgba(168,85,247,0.75)', amp: 1.0, freq: 1.0, speed: 1.0 },
            { color: 'rgba(6,182,212,0.6)', amp: 0.65, freq: 1.5, speed: -0.85 },
            { color: 'rgba(236,72,153,0.5)', amp: 0.4, freq: 0.75, speed: 1.3 }
        ];
        layers.forEach(l => {
            waveCtx.beginPath();
            waveCtx.lineWidth = isSpeakingOrListening ? 3.2 : 1.8;
            waveCtx.strokeStyle = l.color;
            const currentAmp = (isSpeakingOrListening ? 38 : 10) * l.amp;
            for (let x = 0; x <= w; x += 3) {
                const y = cy + Math.sin(x * 0.02 * l.freq + wavePhase * l.speed) * currentAmp * Math.sin((x / w) * Math.PI);
                if (x === 0) waveCtx.moveTo(x, y);
                else waveCtx.lineTo(x, y);
            }
            waveCtx.stroke();
        });
        waveAnimFrame = requestAnimationFrame(renderWave);
    }
    if (waveAnimFrame) cancelAnimationFrame(waveAnimFrame);
    renderWave();

    const chatInput = document.getElementById('voice-chat-input');
    if (chatInput && !chatInput.dataset.boundEnter) {
        chatInput.dataset.boundEnter = "true";
        chatInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                sendVoiceChatMessage();
            }
        });
    }
}

/* ── CHAT: Enviar Mensagem (Enter ou Botão) ──
   A mensagem some pra fila de turnos (queueUserTurn) em vez de disparar a
   requisição na hora -- se o usuário mandar texto E áudio quase juntos (ou
   duas mensagens de texto em sequência antes do BROW responder a
   primeira), tudo isso empilha num único turno coerente em vez de duas
   respostas/dois áudios concorrentes brigando pelo mesmo player. Ver
   Ver queueUserTurn()/runNextTurn()/processTurn(). */
async function sendVoiceChatMessage() {
    const input = document.getElementById('voice-chat-input');
    const text = input?.value.trim();
    if (!text) return;
    input.value = '';
    input.focus();

    const timestamp = formatTelegramTime(new Date());
    voiceChatHistoryMessages.push({
        id: Date.now().toString(),
        text: text,
        sender: '👤 Você',
        isUser: true,
        timestamp: timestamp
    });
    saveChatMessagesToStorage();
    renderAllVoiceChatMessages();

    queueUserTurn(text);
}

/* ── TELEMETRIA REAL DO PC DA BROW (CPU, RAM, GPU, OVERLOAD) ── */
const PC_TELEMETRY_STORAGE_KEY = 'hermes_pc_telemetry_v1';

function loadPersistedTelemetry() {
    try {
        const raw = localStorage.getItem(PC_TELEMETRY_STORAGE_KEY);
        if (!raw) return null;
        const saved = JSON.parse(raw);
        // Leitura salva há mais de 5 minutos não representa mais a carga
        // atual da máquina -- melhor começar limpo do que mostrar um número
        // congelado antigo como se fosse o estado agora.
        if (!saved || (Date.now() - (saved.savedAt || 0)) > 5 * 60 * 1000) return null;
        return saved;
    } catch (e) { return null; }
}

const persistedTelemetry = loadPersistedTelemetry();

// Continua de onde parou em vez de reiniciar em 14%/10% toda vez que o
// dashboard é reaberto -- essa era a origem do "os dados são atualizados/
// resetados toda vez que abro" relatado pelo usuário.
let pcTelemetry = {
    cpuLoadEst: null,
    ramUsedMB: 0,
    ramTotalMB: 0,
    ramPercent: null,
    gpuLoadEst: null,
    cores: null,
    deviceRamGB: null,
    gpuName: null,
    fps: 60,
    diskFreeGB: null,
    diskTotalGB: null,
    diskPercent: null,
    topProcesses: [],
    bluetoothDevices: [],
    overloaded: false,
    lastOverloadAlertAt: 0,
    lastDiskAlertAt: 0,
    lastAnyAlertAt: 0, // gate compartilhado entre TODOS os tipos de alerta -- ver PC_ALERT_MIN_GAP_MS
    overloadStreak: 0,
    telemetrySource: 'offline'
};

// ── Telemetria real do PC via Worker (v3, 07/08/2026) ──
// As v1/v2 tentavam ler direto de http://127.0.0.1:8765 -- Chrome bloqueia
// Mixed Content (fetch de http:// a partir de uma pagina https://) e o
// badge ficava eternamente em "offline" mesmo com o agente rodando. v3
// inverte: o agente local envia (POST) telemetria para o Worker, e o
// dashboard consulta o Worker (HTTPS pra HTTPS, sem restricao de mixed
// content). Ver scripts/telemetry-agent/agent.ps1.
const REAL_TELEMETRY_URL = '/api/hermes/telemetry';
const REAL_TELEMETRY_FRESH_MS = 15000; // dado com >15s considera-se offline
let lastRealTelemetryAt = 0;

async function pollRealTelemetryAgent() {
    try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 3000);
        const res = await fetch(REAL_TELEMETRY_URL, { signal: controller.signal });
        clearTimeout(timeout);
        if (!res.ok) throw new Error(`worker_${res.status}`);
        const data = await res.json();
        if (!data || !data.ok || !data.telemetry || data.freshness !== 'fresh') {
            // Sem dado ou dado velho -- volta para o estado offline.
            return;
        }
        const t = data.telemetry;
        pcTelemetry.cpuLoadEst = t.cpuPercent;
        pcTelemetry.ramPercent = t.ramPercent;
        pcTelemetry.ramUsedMB = t.ramUsedMB;
        pcTelemetry.ramTotalMB = t.ramTotalMB;
        if (typeof t.cores === 'number') pcTelemetry.cores = t.cores;
        if (typeof t.gpuPercent === 'number') pcTelemetry.gpuLoadEst = t.gpuPercent;
        if (t.gpuName) pcTelemetry.gpuName = t.gpuName;
        if (typeof t.diskFreeGB === 'number') pcTelemetry.diskFreeGB = t.diskFreeGB;
        if (typeof t.diskTotalGB === 'number') pcTelemetry.diskTotalGB = t.diskTotalGB;
        if (typeof t.diskFreeGB === 'number' && typeof t.diskTotalGB === 'number' && t.diskTotalGB > 0) {
            pcTelemetry.diskPercent = Math.round(((t.diskTotalGB - t.diskFreeGB) / t.diskTotalGB) * 100);
        }
        if (Array.isArray(t.topProcesses)) pcTelemetry.topProcesses = t.topProcesses;
        if (Array.isArray(t.bluetoothDevices)) pcTelemetry.bluetoothDevices = t.bluetoothDevices;
        pcTelemetry.telemetrySource = 'real-os';
        lastRealTelemetryAt = Date.now();
        renderConnectedDevicesCard();
    } catch (e) {
        // Sem rede/agente/token: silencioso. Cai para a estimativa antiga.
    }
}

function isRealTelemetryFresh() {
    return pcTelemetry.telemetrySource === 'real-os' && (Date.now() - lastRealTelemetryAt) < REAL_TELEMETRY_FRESH_MS;
}

// ── Telemetria do celular via PWA (08/08/2026) — mesmo padrão push/pull
// do telemetry/pc: o PWA envia GPS/bateria/rede a cada 30s pro Worker
// (/api/hermes/device-telemetry), e o dashboard lê daqui pra mostrar o
// celular como "dispositivo conectado" junto do Bluetooth do PC.
let mobileDeviceTelemetry = null;
async function pollMobileDeviceTelemetry() {
    try {
        const res = await fetch('/api/hermes/device-telemetry');
        const data = await res.json();
        mobileDeviceTelemetry = (data.ok && data.freshness === 'fresh') ? data.telemetry : null;
    } catch (e) {
        mobileDeviceTelemetry = null;
    } finally {
        renderConnectedDevicesCard();
    }
}

function renderConnectedDevicesCard() {
    const el = document.getElementById('connected-devices-list');
    if (!el) return;

    const rows = [];

    const btDevices = pcTelemetry.bluetoothDevices || [];
    if (isRealTelemetryFresh() && btDevices.length) {
        btDevices.forEach(d => {
            const batt = (typeof d.batteryPercent === 'number') ? `${d.batteryPercent}%` : 'N/D';
            rows.push(`<div class="device-row"><span>${d.connected ? '🟢' : '⚪'} ${escapeHtml(d.name)}</span><strong>🔋 ${batt}</strong></div>`);
        });
    } else if (isRealTelemetryFresh()) {
        rows.push('<div class="device-row text-muted">Nenhum periférico Bluetooth pareado detectado no PC.</div>');
    } else {
        rows.push('<div class="device-row text-muted">Agente local do PC offline — sem leitura de Bluetooth.</div>');
    }

    if (mobileDeviceTelemetry) {
        const t = mobileDeviceTelemetry;
        const battTxt = (typeof t.batteryPercent === 'number') ? `${t.batteryPercent}%${t.batteryCharging ? ' ⚡' : ''}` : 'N/D';
        rows.push(`<div class="device-row"><span>📱 Celular (PWA)</span><strong>🔋 ${battTxt}</strong></div>`);
        if (t.lat && t.lon) rows.push(`<div class="device-row text-muted"><span>📍 GPS</span><span>${Number(t.lat).toFixed(3)}, ${Number(t.lon).toFixed(3)} (±${Math.round(t.accuracy || 0)}m)</span></div>`);
        if (t.networkType) rows.push(`<div class="device-row text-muted"><span>📶 Rede</span><span>${escapeHtml(t.networkType)}</span></div>`);
    } else {
        rows.push('<div class="device-row text-muted">Celular (PWA) offline — abra o app e ative a telemetria em Automação.</div>');
    }

    el.innerHTML = rows.join('');
}

function initPcTelemetry() {
    try {
        const canvas = document.createElement('canvas');
        const gl = canvas.getContext('webgl') || canvas.getContext('experimental-webgl');
        if (gl) {
            const debugInfo = gl.getExtension('WEBGL_debug_renderer_info');
            if (debugInfo) {
                let rawGpu = gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL) || 'GPU Ativa';
                rawGpu = rawGpu.replace(/ANGLE\s*\(/gi, '').replace(/\s*Direct3D\d+.*$/gi, '').replace(/\)/g, '').trim();
                if (rawGpu.includes(',')) {
                    const parts = rawGpu.split(',').map(p => p.trim());
                    rawGpu = parts[parts.length - 1] || parts[0];
                }
                pcTelemetry.gpuName = rawGpu || 'Intel(R) HD Graphics';
            }
        }
    } catch (e) {
        pcTelemetry.gpuName = 'GPU Ativa';
    }

    let glBenchCanvas = document.createElement('canvas');
    glBenchCanvas.width = 16; glBenchCanvas.height = 16;
    let glCtx = glBenchCanvas.getContext('webgl') || glBenchCanvas.getContext('experimental-webgl');

    function benchmarkGpuTime() {
        if (!glCtx) return 14;
        try {
            const t0 = performance.now();
            glCtx.clearColor(0.1, 0.2, 0.3, 1.0);
            glCtx.clear(glCtx.COLOR_BUFFER_BIT);
            glCtx.finish();
            const t1 = performance.now();
            const timeMs = Math.max(0.1, t1 - t0);
            return Math.min(100, Math.max(8, Math.round(timeMs * 25)));
        } catch (e) {
            return 14;
        }
    }

    // Micro-benchmark para medir carga REAL do processador (CPU Load dinâmico em tempo real)
    function measureRealCpuLoad(threadLag, fpsPenalty) {
        const t0 = performance.now();
        let val = 0;
        for (let i = 0; i < 4000; i++) {
            val += Math.sin(i) * Math.cos(i);
        }
        const t1 = performance.now();
        const duration = t1 - t0;
        
        // Duração proporcional: 0.15ms = 18-20% CPU | 0.8ms = 45% CPU | 1.5ms+ = 80%+ CPU
        const calculatedCpu = Math.round((duration * 38) + (threadLag * 1.8) + (fpsPenalty * 2) + 12);
        return Math.min(100, Math.max(8, calculatedCpu));
    }

    let lastTime = performance.now();
    let frameCount = 0;
    const deviceRamGB = navigator.deviceMemory || 8;
    const baseSystemRamPercent = deviceRamGB <= 4 ? 82 : (deviceRamGB <= 8 ? 79 : 65);
    let lastPersistAt = 0;

    function tickTelemetry() {
        const now = performance.now();
        const delta = now - lastTime;
        lastTime = now;

        const instantFps = Math.min(60, Math.max(1, Math.round((frameCount * 1000) / Math.max(1, delta))));
        frameCount = 0;
        pcTelemetry.fps = instantFps;

        const usingRealOs = isRealTelemetryFresh();

        // GPU% real não existe sem NVML/WMI específico do fabricante (ver
        // scripts/telemetry-agent/server.js) -- o benchmark WebGL continua
        // sendo a única fonte pra GPU, com ou sem agente local ativo.
        const threadLag = Math.max(0, delta - 200);
        const fpsPenalty = Math.max(0, 60 - pcTelemetry.fps) * 1.5;

        if (usingRealOs) {
            // pollRealTelemetryAgent() já escreveu cpuLoadEst/ramPercent
            // reais diretamente em pcTelemetry -- não sobrescrever com
            // estimativa por cima de um dado real, e não gastar CPU rodando
            // o microbenchmark de CPU à toa quando já sabemos o valor real.
            const realGpu = Math.min(100, Math.max(8, Math.round((pcTelemetry.cpuLoadEst * 0.35) + (benchmarkGpuTime() * 0.4))));
            pcTelemetry.gpuLoadEst = Math.round(pcTelemetry.gpuLoadEst * 0.75 + realGpu * 0.25);
        } else {
            // Sem agente local ativo: cai para a estimativa por microbenchmark.
            let realRam;
            if (performance.memory) {
                pcTelemetry.ramUsedMB = Math.round(3400 + (performance.memory.usedJSHeapSize / (1024 * 1024)));
                pcTelemetry.ramTotalMB = deviceRamGB * 1024;
                const heapRatio = (performance.memory.usedJSHeapSize / performance.memory.jsHeapSizeLimit);
                realRam = Math.min(98, Math.max(50, Math.round(baseSystemRamPercent + (heapRatio * 14))));
            } else {
                realRam = Math.min(95, Math.max(50, Math.round(baseSystemRamPercent)));
            }

            const realCpu = measureRealCpuLoad(threadLag, fpsPenalty);
            const realGpu = Math.min(100, Math.max(8, Math.round((realCpu * 0.35) + (benchmarkGpuTime() * 0.4))));

            // Amortecimento por EMA em TODAS as métricas -- achado 06/08/2026:
            // ramPercent não era suavizado como cpu/gpu, então um pico de UM
            // tick isolado (ex.: coleta de lixo do heap) já disparava o alarme
            // de sobrecarga em checkPcOverload(), enquanto o gauge na tela --
            // que o usuário via -- já tinha passado para o próximo valor calmo.
            // Alarme e gauge agora leem exatamente o mesmo número suavizado.
            pcTelemetry.cpuLoadEst = Math.round(pcTelemetry.cpuLoadEst * 0.75 + realCpu * 0.25);
            pcTelemetry.gpuLoadEst = Math.round(pcTelemetry.gpuLoadEst * 0.75 + realGpu * 0.25);
            pcTelemetry.ramPercent = Math.round(pcTelemetry.ramPercent * 0.75 + realRam * 0.25);
            pcTelemetry.telemetrySource = 'estimado';
        }

        renderTelemetryWidget();
        checkPcOverload();

        // Persiste no máximo a cada 5s (não a cada tick) -- só pra dar
        // continuidade visual na próxima abertura do dashboard, não é um
        // log de série temporal.
        if (now - lastPersistAt > 5000) {
            lastPersistAt = now;
            try {
                localStorage.setItem(PC_TELEMETRY_STORAGE_KEY, JSON.stringify({
                    cpuLoadEst: pcTelemetry.cpuLoadEst,
                    ramPercent: pcTelemetry.ramPercent,
                    gpuLoadEst: pcTelemetry.gpuLoadEst,
                    savedAt: Date.now(),
                }));
            } catch (e) { /* localStorage indisponível (modo privado, cota) -- sem persistência, sem problema */ }
        }
    }

    // WEB WORKER EM SEGUNDO PLANO -- posta um tick leve (só um timer) a cada
    // 200ms; o trabalho pesado de verdade (loop trigonométrico + WebGL
    // clear/finish pra estimar CPU/GPU) só roda a cada N tiques, e N cresce
    // MUITO quando a aba está oculta (visibilitychange). Antes rodava o
    // benchmark completo 5x/segundo o tempo todo, inclusive em segundo
    // plano -- gasto real de CPU/GPU só para MEDIR "carga", ironicamente
    // contribuindo pra carga real da máquina. Achado 06/08/2026.
    let tickSkipCounter = 0;
    let ticksPerMeasurement = document.hidden ? 20 : 3; // 200ms base: ~4s oculto, ~600ms visível
    document.addEventListener('visibilitychange', () => {
        ticksPerMeasurement = document.hidden ? 20 : 3;
    });
    function onBackgroundTick() {
        tickSkipCounter++;
        if (tickSkipCounter < ticksPerMeasurement) return;
        tickSkipCounter = 0;
        tickTelemetry();
    }
    try {
        const workerBlob = new Blob([`
            setInterval(function() {
                postMessage('tick');
            }, 200);
        `], { type: 'application/javascript' });
        const bgWorker = new Worker(URL.createObjectURL(workerBlob));
        bgWorker.onmessage = onBackgroundTick;
    } catch (e) {
        setInterval(onBackgroundTick, 200);
    }

    // Tenta o agente local a cada 1.5s, independente do tick de benchmark --
    // é só um fetch leve pra localhost, sem custo de CPU relevante. Primeira
    // tentativa imediata pra não esperar 1.5s pro dashboard "descobrir" que
    // o agente já está rodando.
    pollRealTelemetryAgent();
    setInterval(() => { if (!document.hidden) pollRealTelemetryAgent(); }, 10000);

    pollMobileDeviceTelemetry();
    setInterval(() => { if (!document.hidden) pollMobileDeviceTelemetry(); }, 60000);

    function countFrames() {
        frameCount++;
        requestAnimationFrame(countFrames);
    }
    requestAnimationFrame(countFrames);
}

function renderTelemetryWidget() {
    const sourceBadgeEl = document.getElementById('telemetry-source-badge');
    if (sourceBadgeEl) {
        if (isRealTelemetryFresh()) {
            sourceBadgeEl.textContent = '🟢 CPU/RAM reais (agente local ativo)';
            sourceBadgeEl.title = 'Lido diretamente do sistema operacional pelo agente em scripts/telemetry-agent/.';
        } else {
            sourceBadgeEl.textContent = '⚪ aguardando telemetria real do PC';
            sourceBadgeEl.title = 'Abra o BROW Desktop nesta máquina para publicar a leitura real do sistema.';
        }
    }

    const cpuEl = document.getElementById('telemetry-cpu-val');
    const ramEl = document.getElementById('telemetry-ram-val');
    const gpuEl = document.getElementById('telemetry-gpu-val');
    const badgeEl = document.getElementById('telemetry-status-badge');

    const cpuTextEl = document.getElementById('gauge-cpu-text');
    const ramTextEl = document.getElementById('gauge-ram-text');
    const gpuTextEl = document.getElementById('gauge-gpu-text');
    const diskTextEl = document.getElementById('gauge-disk-text');

    const cpuCircleEl = document.getElementById('gauge-cpu-circle');
    const ramCircleEl = document.getElementById('gauge-ram-circle');
    const gpuCircleEl = document.getElementById('gauge-gpu-circle');
    const diskCircleEl = document.getElementById('gauge-disk-circle');

    const realFresh = isRealTelemetryFresh();
    const safeCpu = realFresh && Number.isFinite(pcTelemetry.cpuLoadEst) ? Math.min(100, Math.max(0, pcTelemetry.cpuLoadEst)) : null;
    const safeRam = realFresh && Number.isFinite(pcTelemetry.ramPercent) ? Math.min(100, Math.max(0, pcTelemetry.ramPercent)) : null;
    const safeGpu = realFresh && Number.isFinite(pcTelemetry.gpuLoadEst) ? Math.min(100, Math.max(0, pcTelemetry.gpuLoadEst)) : null;
    // Disco só existe com o agente local real -- sem dado, mostra "--%" em
    // vez de inventar um número (diferente de CPU/RAM/GPU que têm fallback
    // por estimativa de navegador).
    const hasDisk = realFresh && typeof pcTelemetry.diskPercent === 'number' && !isNaN(pcTelemetry.diskPercent);
    const safeDisk = hasDisk ? Math.min(100, Math.max(0, pcTelemetry.diskPercent)) : null;

    if (cpuTextEl) cpuTextEl.textContent = safeCpu == null ? '--%' : `${safeCpu}%`;
    if (ramTextEl) ramTextEl.textContent = safeRam == null ? '--%' : `${safeRam}%`;
    if (gpuTextEl) gpuTextEl.textContent = safeGpu == null ? '--%' : `${safeGpu}%`;
    if (diskTextEl) diskTextEl.textContent = hasDisk ? `${safeDisk}%` : '--%';

    const maxDash = 119.38;
    if (cpuCircleEl) {
        const cpuOffset = maxDash - (safeCpu / 100) * maxDash;
        cpuCircleEl.style.strokeDashoffset = Math.max(0, cpuOffset);
    }
    const cpuNeedleEl = document.getElementById('gauge-cpu-needle');
    if (cpuNeedleEl) {
        const cpuAngle = -90 + (safeCpu / 100) * 180;
        cpuNeedleEl.style.transform = `rotate(${cpuAngle}deg)`;
    }

    if (ramCircleEl) {
        const ramOffset = maxDash - (safeRam / 100) * maxDash;
        ramCircleEl.style.strokeDashoffset = Math.max(0, ramOffset);
    }
    const ramNeedleEl = document.getElementById('gauge-ram-needle');
    if (ramNeedleEl) {
        const ramAngle = -90 + (safeRam / 100) * 180;
        ramNeedleEl.style.transform = `rotate(${ramAngle}deg)`;
    }

    if (gpuCircleEl) {
        const gpuOffset = maxDash - (safeGpu / 100) * maxDash;
        gpuCircleEl.style.strokeDashoffset = Math.max(0, gpuOffset);
    }
    const gpuNeedleEl = document.getElementById('gauge-gpu-needle');
    if (gpuNeedleEl) {
        const gpuAngle = -90 + (safeGpu / 100) * 180;
        gpuNeedleEl.style.transform = `rotate(${gpuAngle}deg)`;
    }

    if (diskCircleEl) {
        const diskOffset = maxDash - (safeDisk / 100) * maxDash;
        diskCircleEl.style.strokeDashoffset = Math.max(0, diskOffset);
    }
    const diskNeedleEl = document.getElementById('gauge-disk-needle');
    if (diskNeedleEl) {
        const diskAngle = -90 + (safeDisk / 100) * 180;
        diskNeedleEl.style.transform = `rotate(${diskAngle}deg)`;
    }

    // Achado 13/08/2026 (relatado ao vivo pelo PWA no celular): sem o
    // agente local do PC, os campos caíam pra estimativa via WebGL/heap do
    // PRÓPRIO NAVEGADOR de quem está olhando o dashboard -- em celular
    // isso mostrava "Placa de vídeo: OpenGL ES 3.2" e RAM do telefone como
    // se fosse hardware do PC, confuso e sem sentido. Mesmo padrão honesto
    // que o Disco C já usava: sem dado real, mostra placeholder, não finge.
    if (cpuEl) cpuEl.textContent = realFresh ? `${safeCpu}% (${pcTelemetry.cores} Núcleos)` : 'Sem agente local';
    if (ramEl) ramEl.textContent = realFresh ? `${pcTelemetry.ramUsedMB}MB / ${pcTelemetry.ramTotalMB}MB (${safeRam}%)` : 'Sem agente local';
    if (gpuEl) gpuEl.textContent = realFresh ? pcTelemetry.gpuName.slice(0, 32) : 'Sem agente local';

    const diskValEl = document.getElementById('telemetry-disk-val');
    if (diskValEl) {
        diskValEl.textContent = hasDisk
            ? `${pcTelemetry.diskFreeGB}GB / ${pcTelemetry.diskTotalGB}GB`
            : 'Sem agente local';
    }

    // Mesmo critério de "sobrecarga" do badge visual e do alarme falado em
    // checkPcOverload() -- PC_OVERLOAD_THRESHOLDS é a única fonte de verdade.
    // GPU e FPS NÃO entram no critério (ver nota em checkPcOverload) --
    // achado 07/08/2026: o critério antigo incluía "FPS < 15" e isso disparava
    // alarme falso toda vez que o usuário trocava de aba (Chrome throttla
    // requestAnimationFrame em abas em segundo plano, FPS medido despenca
    // pra perto de zero mesmo com o PC ocioso).
    if (badgeEl) {
        const t = PC_OVERLOAD_THRESHOLDS;
        if (safeCpu > t.cpu || safeRam > t.ram) {
            badgeEl.className = 'badge badge-danger';
            badgeEl.textContent = '⚠️ Alta Carga';
        } else {
            badgeEl.className = 'badge badge-success';
            badgeEl.textContent = '🟢 Normal';
        }
    }
}

// Limiares altos de propósito: só é "sobrecarga" de verdade quando passa
// bem do normal (uso comum de navegador+apps fica na faixa de 20-60%).
// GPU e FPS foram REMOVIDOS do critério -- GPU nunca é medição real (é
// sempre estimativa por benchmark WebGL, mesmo com o agente local ativo)
// e FPS reflete a aba do navegador, não a carga real do PC. Achado
// 07/08/2026: usuário reportou alarme disparando com CPU/RAM/GPU todos
// em ~10%, rastreado até o critério "FPS < 15" pegando o throttle de aba
// em segundo plano do Chrome como se fosse sobrecarga.
const PC_OVERLOAD_THRESHOLDS = { ram: 92, cpu: 88 };
const DISK_LOW_THRESHOLD_GB = 5;
// Nº de tiques SEGUIDOS acima do limiar antes de soar o alarme. Sem isso,
// um único tick suavizado que passa raspando o limiar (raro, mas possível
// mesmo com EMA) já disparava o alarme por voz -- histerese evita alarme
// por um pico de meio segundo que nunca chega a ser "sobrecarga real".
const PC_OVERLOAD_STREAK_REQUIRED = 4;
// Achado 08/08/2026: usuário reportou alertas disparando com frequência
// alta demais (percebido como "até 3 por minuto"). Cada tipo de alerta já
// tinha SEU PRÓPRIO cooldown de 3min, mas eram independentes -- sobrecarga
// e disco cheio podiam disparar em sequência (2 alertas em segundos) sem
// nenhum gate entre tipos diferentes. Agora: cooldown por tipo sobe pra
// 5min (pedido explícito do usuário) E nenhum alerta de nenhum tipo pode
// disparar antes de 5min do ÚLTIMO alerta de QUALQUER tipo.
const PC_ALERT_COOLDOWN_MS = 300000;
function pcAlertGateOpen(now) {
    return (now - pcTelemetry.lastAnyAlertAt) > PC_ALERT_COOLDOWN_MS;
}

function checkPcOverload() {
    const safeCpu = isNaN(pcTelemetry.cpuLoadEst) ? 14 : pcTelemetry.cpuLoadEst;
    const safeRam = isNaN(pcTelemetry.ramPercent) ? 0 : pcTelemetry.ramPercent;

    const t = PC_OVERLOAD_THRESHOLDS;
    // Critério de sobrecarga usa SÓ cpu/ram -- os dois únicos valores que
    // vêm de fato do sistema operacional via o agente local (Win32_Processor
    // / Win32_OperatingSystem), não de estimativa de navegador.
    const tickOverloaded = safeRam > t.ram || safeCpu > t.cpu;
    pcTelemetry.overloadStreak = tickOverloaded ? (pcTelemetry.overloadStreak + 1) : 0;
    // O alarme FALADO só pode soar com dado real do agente local
    // (scripts/telemetry-agent/) -- a estimativa por benchmark no navegador
    // não tem correlação confiável o bastante com a carga real da máquina
    // pra justificar interromper o usuário com voz. Achado 06/08/2026: o
    // usuário comparou ao vivo com o Gerenciador de Tarefas e a estimativa
    // divergia muito (ex.: CPU 99% estimado vs 73% real).
    const isOverloaded = isRealTelemetryFresh() && pcTelemetry.overloadStreak >= PC_OVERLOAD_STREAK_REQUIRED;
    const now = Date.now();

    if (isOverloaded && (now - pcTelemetry.lastOverloadAlertAt > PC_ALERT_COOLDOWN_MS) && pcAlertGateOpen(now)) {
        pcTelemetry.lastOverloadAlertAt = now;
        pcTelemetry.lastAnyAlertAt = now;
        pcTelemetry.overloaded = true;

        const timeStr = formatTelegramTime(new Date());
        const worstProc = (pcTelemetry.topProcesses || [])[0];
        const worstName = worstProc?.name || 'um processo não identificado';
        const detailText = `CPU em ${safeCpu}%, RAM em ${safeRam}%. Maior consumidor: ${escapeHtml(worstName)}.`;

        const alertsContainer = document.getElementById('telemetry-alerts-container');
        if (alertsContainer) {
            const alertDiv = document.createElement('div');
            alertDiv.className = 'alert-item';
            alertDiv.style.cssText = 'background:rgba(239, 68, 68, 0.12); border-left:3px solid #ef4444; padding:8px 10px; border-radius:6px; font-size:11px; color:#fca5a5; line-height:1.4; animation:fadeInUp 0.3s ease;';
            alertDiv.innerHTML = `
                <div style="font-weight:700; color:#ef4444; margin-bottom:2px; display:flex; justify-content:space-between;">
                    <span>⚠️ SOBRECARGA DETECTADA</span>
                    <span style="font-size:9px; opacity:0.8;">${timeStr}</span>
                </div>
                <div>${detailText} Feche abas/processos inativos para liberar recursos do computador.</div>
            `;
            alertsContainer.prepend(alertDiv);
        }

        // Não fala por cima de um turno de conversa em andamento -- o
        // card visual do alerta já foi inserido acima de qualquer forma;
        // a voz do alarme só entra quando o BROW não está no meio de uma
        // resposta, pra não colidir no mesmo <audio> com processTurn().
        // Várias frases pro mesmo aviso (pedido do usuário 13/08/2026: soava
        // sempre igual/robótico) -- cada uma cita o dado real (CPU/RAM/processo).
        const overloadPhrases = [
            `Atenção! CPU em ${safeCpu} por cento e RAM em ${safeRam} por cento. O ${worstName} está pesando bastante. Recomendo fechar ele ou outras abas inativas.`,
            `Opa, seu PC está pesado agora: CPU ${safeCpu} por cento, RAM ${safeRam} por cento. O maior consumidor é o ${worstName}. Dá pra fechar ele um instante?`,
            `Fiquei de olho na máquina e notei sobrecarga: CPU em ${safeCpu} por cento, RAM em ${safeRam} por cento, puxado principalmente pelo ${worstName}.`,
            `Seu computador está trabalhando pesado. CPU a ${safeCpu} por cento e RAM a ${safeRam} por cento, com o ${worstName} consumindo mais recurso. Vale uma pausa nele.`,
        ];
        const spoken = overloadPhrases[Math.floor(Math.random() * overloadPhrases.length)];
        if (!isSpeakingOrListening) speakWithEdgeTTS(spoken);
    }

    checkDiskLowAlert();
}

// Alerta de disco cheio: sinal binário e real (vem direto do agente local,
// sem estimativa) -- não precisa de histerese de 4 tiques como cpu/ram
// porque espaço em disco não oscila tick a tick, só cai devagar.
function checkDiskLowAlert() {
    if (!isRealTelemetryFresh() || typeof pcTelemetry.diskFreeGB !== 'number') return;
    if (pcTelemetry.diskFreeGB >= DISK_LOW_THRESHOLD_GB) return;

    const now = Date.now();
    if (now - pcTelemetry.lastDiskAlertAt < PC_ALERT_COOLDOWN_MS) return;
    if (!pcAlertGateOpen(now)) return;
    pcTelemetry.lastDiskAlertAt = now;
    pcTelemetry.lastAnyAlertAt = now;

    const timeStr = formatTelegramTime(new Date());
    const top = (pcTelemetry.topProcesses || []).slice(0, 3);
    const topText = top.length
        ? top.map(p => `${p.name} (${p.memMB}MB)`).join(', ')
        : 'sem dados de processos';

    const alertsContainer = document.getElementById('telemetry-alerts-container');
    if (alertsContainer) {
        const alertDiv = document.createElement('div');
        alertDiv.className = 'alert-item';
        alertDiv.style.cssText = 'background:rgba(239, 68, 68, 0.12); border-left:3px solid #ef4444; padding:8px 10px; border-radius:6px; font-size:11px; color:#fca5a5; line-height:1.4; animation:fadeInUp 0.3s ease;';
        alertDiv.innerHTML = `
            <div style="font-weight:700; color:#ef4444; margin-bottom:2px; display:flex; justify-content:space-between;">
                <span>💾 DISCO C QUASE CHEIO</span>
                <span style="font-size:9px; opacity:0.8;">${timeStr}</span>
            </div>
            <div>Só ${pcTelemetry.diskFreeGB}GB livres. Maiores consumidores de memória agora: ${topText}.</div>
        `;
        alertsContainer.prepend(alertDiv);
    }

    const diskPhrases = [
        `Atenção! O disco C está com só ${pcTelemetry.diskFreeGB} gigabytes livres. Os processos que mais consomem memória agora são: ${topText}.`,
        `Seu disco C está quase cheio: só ${pcTelemetry.diskFreeGB} gigabytes de sobra. Vale liberar espaço — os maiores consumidores de memória agora são ${topText}.`,
        `Espaço apertado no disco C, ${pcTelemetry.diskFreeGB} gigabytes livres. De olho em ${topText}, que estão consumindo mais memória no momento.`,
    ];
    if (!isSpeakingOrListening) speakWithEdgeTTS(diskPhrases[Math.floor(Math.random() * diskPhrases.length)]);
}

/* ── IA: Rota REAL do BROW Cloud (Groq LLaMA 3.1 8B + Contexto Real-time) ──
   v2 (07/08/2026) -- streaming + fila de turnos. Dois problemas resolvidos:
   1) DELAY DE VOZ: antes, speakWithEdgeTTS só começava depois da resposta
      INTEIRA chegar e do texto inteiro ser sintetizado em frases. Agora o
      texto chega token a token (/api/chat retorna um stream de texto puro,
      ver chat.js) e cada frase é falada assim que fecha (ponto/interrogação/
      exclamação), enquanto o resto da resposta ainda está sendo gerado --
      geração de texto e síntese de voz acontecem em paralelo, não em série.
   2) MENSAGENS SIMULTÂNEAS: se o usuário manda texto e depois já dispara
      áudio (ou duas mensagens em sequência) antes do BROW responder a
      primeira, as duas NÃO podem virar duas respostas/dois áudios brigando
      pelo mesmo <audio>. queueUserTurn() empilha tudo que chegar enquanto
      um turno está em andamento e processa como um turno único assim que o
      anterior terminar -- ordem preservada, sem race, sem áudio sobreposto. */
let chatHistory = [];
let pendingUserInputs = [];
let turnActive = false;
let currentSpeechPlayer = null;

function queueUserTurn(text) {
    if (!text) return;
    pendingUserInputs.push(text);
    if (!turnActive) runNextTurn();
}

async function runNextTurn() {
    if (!pendingUserInputs.length) { turnActive = false; return; }
    turnActive = true;
    // Drena tudo que chegou até agora num turno só -- isso é o "empilhar
    // contextos": se 2-3 mensagens (texto e/ou voz) chegaram quase juntas,
    // o BROW vê e responde todas de uma vez, em vez de disparar respostas
    // concorrentes.
    const batch = pendingUserInputs.splice(0);
    const combinedText = batch.join('\n');
    try {
        await processTurn(combinedText);
    } catch (e) {
        console.error('Erro processando turno do BROW:', e);
    }
    runNextTurn();
}

// Remove pontuação/acentos pra comparar contra os mesmos padrões usados
// pelos guards oficiais do Worker (normalizeIntentText em
// message-envelope.ts) -- precisa ser idêntico pro guard local pegar
// exatamente os mesmos casos que o guard de rede pegaria.
function normalizeForLocalGuard(value) {
    return value.toLowerCase().normalize('NFD').replace(/\p{Diacritic}/gu, '')
        .replace(/[^\p{L}\p{N}\s/]/gu, ' ').replace(/\s+/g, ' ').trim();
}

// Versão local e instantânea (sem round-trip de rede) dos 3 guards de
// verdade aplicados no Worker (enforcePersistentMemoryTruth/
// enforceNoFabricatedModeClaim/enforceRealSearchCapabilityTruth em
// cloudflare/worker/src/index.ts) -- mesmas regras, aplicadas frase a frase
// ANTES de falar. O guard oficial com round-trip ainda roda no servidor
// sobre o texto completo só pra corrigir o que fica salvo no histórico;
// rodá-lo em tempo real atrasaria cada frase falada.
function applyLocalTruthGuards(text) {
    const plain = normalizeForLocalGuard(text);
    if (/nao (?:tenho|possuo).{0,35}(?:memoria persistente|capacidade de armazenar|capacidade de apagar)|nao consigo.{0,35}(?:armazenar|apagar|excluir|remover).{0,35}(?:memoria|lembranca)|nao consigo.{0,35}(?:apagar|excluir|remover).{0,70}(?:dados pessoais|dados|informacoes|o que voce compartilhou|sistema)|isso nao esta em meu controle/.test(plain)) {
        return "A BROW possui memória persistente e exclusão real de dados salvos. Para apagar um item, use o dashboard ou peça a exclusão diretamente.";
    }
    if (/\bestou em modo\b/.test(plain)) {
        const stripped = text.replace(/estou em modo [^.!\n]*[.!]?\s*/gi, '').trim();
        return stripped || 'Pode continuar, estou acompanhando a conversa normalmente.';
    }
    if (/nao (?:tenho|possuo|consigo) .{0,40}(?:acesso a internet|acesso a dados atuais|buscar informacoes atuais|pesquisar na internet|informacoes em tempo real)/.test(plain)) {
        return "A BROW tem acesso real a pesquisa na web e notícias por ferramentas dedicadas.";
    }
    return text;
}

// Extrai frases já fechadas (terminam em . ! ou ?) do início do buffer,
// devolvendo o que sobrou (ainda sem pontuação, esperando mais texto do
// stream). Cada frase extraída já pode ser falada -- não precisa esperar a
// resposta inteira.
function extractCompleteSentences(buffer) {
    const matches = buffer.match(/[^.!?]*[.!?]+(?:\s+|$)/g);
    if (!matches) return { sentences: [], remainder: buffer };
    let consumed = 0;
    const sentences = [];
    for (const m of matches) {
        const trimmed = m.trim();
        if (trimmed) sentences.push(trimmed);
        consumed += m.length;
    }
    return { sentences, remainder: buffer.slice(consumed) };
}

async function playAudioBlob(blobUrl) {
    const player = document.getElementById('edge-tts-player');
    if (!player) { URL.revokeObjectURL(blobUrl); return; }
    player.pause();
    player.src = blobUrl;
    try {
        await player.play();
        // onpause também resolve: stopHermesAudio() chama player.pause() no
        // meio de uma frase, e isso nunca dispara 'ended'/'error' -- sem
        // isso o await travaria com o badge preso em "Falando".
        await new Promise((resolve) => { player.onended = resolve; player.onerror = resolve; player.onpause = resolve; });
    } catch (e) { /* autoplay bloqueado ou interrompido -- segue pra próxima frase */ }
    URL.revokeObjectURL(blobUrl);
}

// Player de fila: cada push() já dispara o fetch do áudio na hora (a
// síntese de voz da frase 1 roda EM PARALELO com a geração de texto da
// frase 2+ pelo LLM), e um loop separado toca tudo em ordem assim que cada
// fetch resolve -- overlap total entre geração de texto e síntese de voz.
function createSpeechQueuePlayer() {
    const queue = [];
    let playing = false;
    let stopped = false;

    async function pump() {
        if (playing) return;
        playing = true;
        while (queue.length && !stopped) {
            const blobPromise = queue.shift();
            try {
                const blobUrl = await blobPromise;
                if (stopped) { URL.revokeObjectURL(blobUrl); break; }
                await playAudioBlob(blobUrl);
            } catch (e) { /* essa frase falhou ao sintetizar -- segue pra próxima */ }
        }
        playing = false;
    }

    return {
        push(text) {
            if (stopped || !text) return;
            queue.push(fetchTtsBlobUrl(text));
            pump();
        },
        stop() { stopped = true; queue.length = 0; },
        async waitUntilDone() {
            while (playing || queue.length) {
                await new Promise((r) => setTimeout(r, 60));
            }
        },
    };
}

async function processTurn(combinedText) {
    const badge = document.getElementById('voice-state-badge');
    const title = document.getElementById('voice-transcript-title');
    if (badge) { badge.className = 'badge badge-purple'; badge.textContent = '🧠 BROW Pensando...'; }
    if (title) title.textContent = `Processando: "${combinedText.slice(0, 50)}..."`;
    isSpeakingOrListening = true;

    const wantsAudio = chatResponseMode !== 'text';
    const wantsText = chatResponseMode !== 'audio';
    const player = wantsAudio ? createSpeechQueuePlayer() : null;
    currentSpeechPlayer = player;

    let fullText = '';
    let sentBuffer = '';
    let spokeAny = false;

    try {
        const response = await fetch('/api/chat', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ message: combinedText, history: chatHistory, telemetry: pcTelemetry, channel: 'dashboard' })
        });

        if (response.body) {
            const reader = response.body.getReader();
            const decoder = new TextDecoder();
            while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                const delta = decoder.decode(value, { stream: true });
                if (!delta) continue;
                fullText += delta;
                sentBuffer += delta;

                const { sentences, remainder } = extractCompleteSentences(sentBuffer);
                sentBuffer = remainder;
                for (const s of sentences) {
                    if (player) {
                        player.push(applyLocalTruthGuards(s));
                        spokeAny = true;
                        if (title) title.textContent = '🔊 Respondendo em voz...';
                    }
                }
            }
            if (sentBuffer.trim() && player) {
                player.push(applyLocalTruthGuards(sentBuffer.trim()));
                spokeAny = true;
            }
        } else {
            fullText = await response.text();
            if (player && fullText.trim()) { player.push(applyLocalTruthGuards(fullText.trim())); spokeAny = true; }
        }

        if (!fullText.trim()) {
            fullText = 'Olá! Sou o BROW, sua assistente executivo. Estou 100% online e pronto para ajudar.';
            if (player) { player.push(fullText); spokeAny = true; }
        }

        chatHistory.push({ role: 'user', content: combinedText });
        chatHistory.push({ role: 'assistant', content: fullText });
        if (chatHistory.length > 12) chatHistory = chatHistory.slice(-12);

        if (wantsText) {
            voiceChatHistoryMessages.push({
                id: (Date.now() + 1).toString(),
                text: fullText,
                sender: '✈️ BROW',
                isUser: false,
                timestamp: formatTelegramTime(new Date())
            });
            saveChatMessagesToStorage();
            renderAllVoiceChatMessages();
        }

        if (player) {
            if (title) title.textContent = spokeAny ? '🔊 Reproduzindo resposta em voz...' : 'Converse com o BROW — digite ou fale';
            await player.waitUntilDone();
        }
    } catch (e) {
        console.error('Erro ao processar turno do BROW:', e);
        if (badge) { badge.className = 'badge badge-danger'; badge.textContent = '❌ Erro'; }
    } finally {
        isSpeakingOrListening = false;
        if (currentSpeechPlayer === player) currentSpeechPlayer = null;
        if (badge) { badge.className = 'badge badge-info'; badge.textContent = '🟢 Pronta'; }
        if (title) title.textContent = 'Converse com o BROW — digite ou fale';
    }
}

/* ── Resumos conectados ao dashboard real ── */
async function buildLocalBriefing() {
    try {
        const [memRes, finRes, agRes] = await Promise.all([
            fetch('/api/hermes/memories').then(r => r.json()).catch(() => ({ items: [] })),
            fetch('/api/hermes/finances').then(r => r.json()).catch(() => ({ items: [], summary: {} })),
            fetch('/api/hermes/agenda').then(r => r.json()).catch(() => ({ items: [] }))
        ]);
        const mems = memRes.items || []; const ags = agRes.items || [];
        const s = finRes.summary || {};
        let brief = `📊 BRIEFING EXECUTIVO DA BROW\n\n`;
        brief += `🧠 Memórias: ${mems.length} registros salvos\n`;
        brief += `💰 Finanças: Saldo ${s.balance != null ? 'R$' + Number(s.balance).toFixed(2) : 'N/D'} | Receitas R$${Number(s.totalIncome || 0).toFixed(2)} | Despesas R$${Number(s.totalExpenses || 0).toFixed(2)}\n`;
        brief += `📅 Agenda: ${ags.length} compromissos registrados\n`;
        if (ags.length) {
            const proximos = ags.slice(0, 3).map(a => `  • ${a.title || a.text || 'Sem título'}`).join('\n');
            brief += `\nPróximos compromissos:\n${proximos}`;
        }
        return brief;
    } catch (e) { return 'Não consegui gerar o briefing. Tente recarregar o dashboard.'; }
}

async function buildFinanceSummary() {
    try {
        const res = await fetch('/api/hermes/finances');
        const data = await res.json();
        const s = data.summary || {};
        const items = (data.items || []).slice(0, 5);
        let txt = `💰 RESUMO FINANCEIRO\n\nSaldo: R$${Number(s.balance || 0).toFixed(2)}\nReceitas: R$${Number(s.totalIncome || 0).toFixed(2)}\nDespesas: R$${Number(s.totalExpenses || 0).toFixed(2)}`;
        if (items.length) { txt += '\n\nÚltimos registros:\n' + items.map(i => `  • ${i.description || i.category}: R$${Number(i.amount || 0).toFixed(2)}`).join('\n'); }
        return txt;
    } catch (e) { return 'Não consegui acessar as finanças agora.'; }
}

async function buildAgendaSummary() {
    try {
        const res = await fetch('/api/hermes/agenda');
        const data = await res.json();
        const items = (data.items || []).slice(0, 8);
        if (!items.length) return '📅 Nenhum compromisso ou lembrete cadastrado na sua agenda.';
        return '📅 SUA AGENDA\n\n' + items.map(a => `  • ${a.title || a.text || 'Sem título'}${a.dueAt ? ' — ' + new Date(a.dueAt).toLocaleDateString('pt-BR') : ''}`).join('\n');
    } catch (e) { return 'Não consegui acessar a agenda agora.'; }
}

async function buildMemorySummary() {
    try {
        const res = await fetch('/api/hermes/memories');
        const data = await res.json();
        const items = (data.items || []).slice(0, 8);
        if (!items.length) return '🧠 Nenhuma memória salva ainda.';
        return '🧠 SUAS MEMÓRIAS\n\n' + items.map(m => `  • [${m.mainCategory || 'geral'}] ${m.title || m.summary || 'Sem título'}`).join('\n');
    } catch (e) { return 'Não consegui acessar as memórias agora.'; }
}

async function buildGoalsSummary() {
    try {
        const res = await fetch('/api/hermes/tasks');
        const data = await res.json();
        const items = (data.items || []).slice(0, 8);
        if (!items.length) return '🎯 Nenhuma meta ou tarefa registrada.';
        return '🎯 METAS E TAREFAS\n\n' + items.map(t => `  • ${t.title || t.description || 'Sem título'} [${t.status || 'pendente'}]`).join('\n');
    } catch (e) { return 'Não consegui acessar as tarefas agora.'; }
}

async function buildStatusSummary() {
    try {
        const res = await fetch('/api/hermes/status');
        const data = await res.json();
        const providers = Object.keys(data.health || {});
        const ready = providers.filter(p => !data.health[p].cooldownUntil || Date.parse(data.health[p].cooldownUntil) <= Date.now());
        return `⚡ STATUS DO SISTEMA BROW\n\nProvedores ativos: ${ready.length}/${providers.length}\nR2: ${data.bindings?.r2 ? '✅' : '❌'}\nVectorize: ${data.bindings?.vectorize ? '✅' : '❌'}\nSupabase: ${data.bindings?.supabase ? '✅' : '❌'}\n\nProvedores prontos: ${ready.join(', ') || 'nenhum'}`;
    } catch (e) { return 'Não consegui verificar o status do sistema.'; }
}

/* ── CONTROLE DE INTERRUPÇÃO E PARADA DE ÁUDIO ── */
function stopHermesAudio() {
    // Além de parar o <audio> em si, avisa a fila de frases pendentes do
    // turno atual pra parar de empurrar mais áudio -- sem isso, a próxima
    // frase já pré-buscada tocaria sozinha logo depois do "Parar Áudio".
    if (currentSpeechPlayer) { currentSpeechPlayer.stop(); currentSpeechPlayer = null; }
    const player = document.getElementById('edge-tts-player');
    if (player) {
        player.pause();
        player.currentTime = 0;
    }
    if ('speechSynthesis' in window) {
        window.speechSynthesis.cancel();
    }
    isSpeakingOrListening = false;
    const badge = document.getElementById('voice-state-badge');
    const title = document.getElementById('voice-transcript-title');
    if (badge) { badge.className = 'badge badge-info'; badge.textContent = '🟢 Pronta'; }
    if (title) title.textContent = 'Converse com o BROW — digite ou fale';
}

/* ── EDGE-TTS REAL: voz pt-BR-ThalitaNeural via /api/tts ──
   Fala em pedaços por frase, não a resposta inteira de uma vez: a primeira
   frase (curta) chega e começa a tocar rápido, enquanto a próxima já está
   sendo buscada em paralelo — sincronismo bem mais próximo do texto que
   acabou de aparecer do que esperar o áudio de tudo ser sintetizado antes
   de começar a tocar. */
// Achado 13/08/2026: cada pedaço abre uma conexão WSS nova com o Edge TTS
// -- mais pedaços = mais pontos de transição onde tom/timbre podem variar
// levemente entre eles (relatado como "voz oscilando"). Limite subiu de
// 220 pra 420 chars pra reduzir o número de handshakes sem estourar o
// teto de 900 chars por chamada em synthesizeEdgeVoice (shared.ts).
function splitIntoSpeechChunks(cleanText) {
    const sentences = cleanText.match(/[^.!?]+[.!?]+|[^.!?]+$/g) || [cleanText];
    const chunks = [];
    let current = '';
    for (const sentence of sentences) {
        if ((current + sentence).length > 420 && current) { chunks.push(current.trim()); current = ''; }
        current += sentence;
    }
    if (current.trim()) chunks.push(current.trim());
    return chunks.length ? chunks : [cleanText];
}

async function fetchTtsBlobUrl(chunkText) {
    const res = await fetch(`/api/tts?text=${encodeURIComponent(chunkText)}`);
    if (!res.ok) throw new Error(`tts_${res.status}`);
    const blob = await res.blob();
    return URL.createObjectURL(blob);
}

async function speakWithEdgeTTS(text) {
    const badge = document.getElementById('voice-state-badge');
    const title = document.getElementById('voice-transcript-title');
    const player = document.getElementById('edge-tts-player');

    if (badge) { badge.className = 'badge badge-success'; badge.textContent = '🔊 Falando'; }
    isSpeakingOrListening = true;

    const cleanText = text
        .replace(/[📊💰📅🧠🎯⚡📚📌📰📝🔗👉✅❌🟢⏰💡🌅✈️👤]/g, '')
        .replace(/\*\*([^*]+)\*\*/g, '$1')
        .replace(/\n{2,}/g, '. ')
        .replace(/\n/g, '. ')
        .replace(/  +/g, ' ')
        .trim()
        .slice(0, 1000);

    const finish = () => {
        isSpeakingOrListening = false;
        if (badge) { badge.className = 'badge badge-info'; badge.textContent = '🟢 Pronta'; }
        if (title) title.textContent = 'Converse com o BROW — digite ou fale';
    };

    if (!cleanText || !player) { finish(); return; }

    const chunks = splitIntoSpeechChunks(cleanText);
    try {
        let nextBlobPromise = fetchTtsBlobUrl(chunks[0]);
        for (let i = 0; i < chunks.length; i++) {
            const blobUrl = await nextBlobPromise;
            // Começa a buscar o próximo pedaço já durante a reprodução do atual.
            if (i + 1 < chunks.length) nextBlobPromise = fetchTtsBlobUrl(chunks[i + 1]);
            player.pause();
            player.src = blobUrl;
            await player.play();
            // onpause também resolve: stopHermesAudio() chama player.pause()
            // no meio de um pedaço, e isso NUNCA dispara 'ended'/'error' —
            // sem isso o await travaria pra sempre com o badge preso em
            // "Falando" (bug pré-existente na versão de pedaço único).
            await new Promise((resolve) => { player.onended = resolve; player.onerror = resolve; player.onpause = resolve; });
            URL.revokeObjectURL(blobUrl);
            if (!isSpeakingOrListening) break; // usuário mandou parar (stopHermesAudio)
        }
    } catch (edgeErr) {
        console.warn("Edge-TTS audio play notice:", edgeErr);
    }

    finish();
}

/* ── RECONHECIMENTO DE VOZ REAL (Whisper via Cloudflare Workers AI) ──
   Trocado em 13/08/2026: antes usava a SpeechRecognition nativa do
   navegador (bem menos precisa, "não reconhecia bem os comandos" foi o
   relatado). Agora grava o áudio de verdade e manda pro MESMO Whisper
   que já transcreve as mensagens de voz do Telegram — mesma precisão
   nos 3 canais. */
let mediaRecorder = null;
let recordedChunks = [];
let isRecording = false;

function toggleVoiceInput() {
    if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) {
        alert("Seu navegador não suporta gravação de áudio. Digite no campo abaixo para conversar com o BROW!");
        return;
    }
    if (isRecording) {
        if (mediaRecorder && mediaRecorder.state !== 'inactive') mediaRecorder.stop();
        return;
    }
    startRealVoiceRecording();
}

async function startRealVoiceRecording() {
    const badge = document.getElementById('voice-state-badge');
    const title = document.getElementById('voice-transcript-title');
    const micIcon = document.getElementById('mic-icon');

    let stream;
    try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (e) {
        if (badge) { badge.className = 'badge badge-danger'; badge.textContent = '❌ Sem mic'; }
        alert("Não consegui acessar o microfone. Verifique a permissão do navegador.");
        return;
    }

    recordedChunks = [];
    const mimeType = MediaRecorder.isTypeSupported('audio/webm') ? 'audio/webm' : '';
    mediaRecorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);

    mediaRecorder.ondataavailable = (e) => { if (e.data.size > 0) recordedChunks.push(e.data); };

    mediaRecorder.onstart = () => {
        isRecording = true;
        isSpeakingOrListening = true;
        if (badge) { badge.className = 'badge badge-warning'; badge.textContent = '🎙️ Ouvindo...'; }
        if (title) title.textContent = 'Fale agora...';
        if (micIcon) micIcon.textContent = '⏹️';
    };

    mediaRecorder.onstop = async () => {
        isRecording = false;
        isSpeakingOrListening = false;
        if (micIcon) micIcon.textContent = '🎙️';
        stream.getTracks().forEach((t) => t.stop());

        const blob = new Blob(recordedChunks, { type: mediaRecorder.mimeType || 'audio/webm' });
        if (!blob.size) {
            if (badge) { badge.className = 'badge badge-info'; badge.textContent = '🟢 Pronta'; }
            return;
        }
        if (badge) { badge.className = 'badge badge-info'; badge.textContent = '🧠 Transcrevendo...'; }
        if (title) title.textContent = 'Transcrevendo áudio real...';

        try {
            const form = new FormData();
            form.append('audio', blob, 'voice.webm');
            const res = await fetch('/api/hermes/stt', { method: 'POST', body: form });
            const data = await res.json();
            const transcript = (data?.text || '').trim();
            if (badge) { badge.className = 'badge badge-info'; badge.textContent = '🟢 Pronta'; }
            if (title) title.textContent = 'Converse com o BROW — digite ou fale';
            if (!transcript) {
                alert("Não consegui entender o áudio. Tente falar de novo, mais perto do microfone.");
                return;
            }
            const input = document.getElementById('voice-chat-input');
            if (input) input.value = transcript;
            sendVoiceChatMessage();
        } catch (e) {
            console.error('Erro na transcrição real:', e);
            if (badge) { badge.className = 'badge badge-danger'; badge.textContent = '❌ Erro STT'; }
            setTimeout(() => {
                if (badge) { badge.className = 'badge badge-info'; badge.textContent = '🟢 Pronta'; }
                if (title) title.textContent = 'Converse com o BROW — digite ou fale';
            }, 2000);
        }
    };

    mediaRecorder.start();
}

/* ── Compat: manter speakTextInput para referências antigas ── */
function speakTextInput() {
    const input = document.getElementById('voice-text-input') || document.getElementById('voice-chat-input');
    const text = input?.value.trim();
    if (!text) return;
    const chatInput = document.getElementById('voice-chat-input');
    if (chatInput) chatInput.value = text;
    sendVoiceChatMessage();
}
function processVoiceQuery(t) { const i = document.getElementById('voice-chat-input'); if (i) i.value = t; sendVoiceChatMessage(); }
function speakTextWithFrancisca(t) { speakWithEdgeTTS(t); }

/* ═══════════════════════════════════════════════════════════════════════════
   GERENCIAMENTO DE MODAL DETALHADO DOS CARDS DE FINANÇAS (KPIS CLICÁVEIS)
   ═══════════════════════════════════════════════════════════════════════════ */
let currentKpiModalType = 'receita';

function openFinanceKpiDetailModal(kpiType) {
    currentKpiModalType = kpiType;
    const overlay = document.getElementById('finance-kpi-modal-overlay');
    const titleEl = document.getElementById('fkpi-modal-title');
    const subTitleEl = document.getElementById('fkpi-modal-subtitle');
    const formTitleEl = document.getElementById('fkpi-modal-form-title');
    const formBox = document.getElementById('fkpi-modal-form-box');

    if (!overlay || !titleEl || !subTitleEl) return;

    if (formBox) formBox.style.display = 'block';

    const modalConfig = {
        receita: {
            title: '📈 Detalhamento & Gestão de Receitas',
            sub: 'Adicione, edite ou exclua entradas e receitas financeiras',
            formTitle: '➕ Adicionar Nova Receita (+)',
            defaultType: 'receita'
        },
        despesa: {
            title: '📉 Detalhamento & Gestão de Despesas',
            sub: 'Adicione, edite ou exclua saídas e despesas financeiras',
            formTitle: '➕ Adicionar Nova Despesa (-)',
            defaultType: 'despesa'
        },
        lucro: {
            title: '💰 Análise de Lucro Líquido',
            sub: 'Balanço entre receitas acumuladas e despesas operacionais',
            formTitle: '➕ Lançamento Rápido no Lucro',
            defaultType: 'receita'
        },
        saldo: {
            title: '🏦 Fluxo de Caixa & Saldo Final',
            sub: 'Histórico de disponibilidade financeira no final do mês',
            formTitle: '➕ Lançamento de Saldo',
            defaultType: 'receita'
        },
        margem: {
            title: '🎯 Meta de Margem de Lucro Líquido',
            sub: 'Digite a meta (%) no campo Valor abaixo e clique em Salvar',
            formTitle: '⚙️ Nova Meta de Margem — % no campo "Valor"',
            defaultType: 'margem_goal'
        },
        receber: {
            title: '📥 Contas a Receber (Pendentes)',
            sub: 'Adicione clientes, valores a receber e marque como pago quando receber',
            formTitle: '➕ Cadastrar Conta a Receber (+)',
            defaultType: 'receber'
        },
        pagar: {
            title: '📤 Contas a Pagar (Vencimentos)',
            sub: 'Adicione boletos e fornecedores a pagar e marque como pago quando quitar',
            formTitle: '➕ Cadastrar Conta a Pagar (-)',
            defaultType: 'pagar'
        },
        liquidez_reduzida: {
            title: '⚡ Análise de Liquidez Reduzida',
            sub: 'Relação entre Contas a Receber e Contas a Pagar (Objetivo: 1,00 ou mais)',
            formTitle: '➕ Cadastrar Lançamento de Liquidez',
            defaultType: 'receber'
        },
        liquidez_geral: {
            title: '🛡️ Análise de Liquidez Geral',
            sub: 'Relação entre Total Receitas e Total Despesas (Objetivo: 3,05 ou mais)',
            formTitle: '➕ Cadastrar Lançamento de Liquidez Geral',
            defaultType: 'receita'
        },
        combo_chart: {
            title: '📊 Detalhamento Mensal de Receitas vs Despesas',
            sub: 'Histórico consolidado mensal de receitas, despesas e resultado líquido',
            formTitle: '➕ Adicionar Transação Mensal',
            defaultType: 'receita'
        },
        orc_receita: {
            title: '🎯 Orçamento de Receita (Meta Mensal)',
            sub: `Meta atual: ${globalFinanceBudget.receitaTarget > 0 ? 'R$ ' + globalFinanceBudget.receitaTarget.toLocaleString('pt-BR', {minimumFractionDigits:2}) : 'não definida'} — digite a nova meta no campo Valor`,
            formTitle: '⚙️ Nova Meta de Receita — R$ no campo "Valor"',
            defaultType: 'receita'
        },
        orc_despesa: {
            title: '🎯 Teto Orçamentário de Despesas (Limite)',
            sub: `Limite atual: ${globalFinanceBudget.despesaTarget > 0 ? 'R$ ' + globalFinanceBudget.despesaTarget.toLocaleString('pt-BR', {minimumFractionDigits:2}) : 'não definido'} — digite o novo limite no campo Valor`,
            formTitle: '⚙️ Novo Teto de Despesas — R$ no campo "Valor"',
            defaultType: 'despesa'
        },
        trend_saldo: {
            title: '📈 Trajetória de Saldo no Final do Mês',
            sub: 'Projeção contínua de disponibilidade e reserva de caixa',
            formTitle: '➕ Lançamento de Projeção de Caixa',
            defaultType: 'receita'
        },
        dre_table: {
            title: '📋 Demonstração do Resultado do Exercício (DRE)',
            sub: 'Visão contábil detalhada: Receita Bruta, Custos, Lucro Bruto e Operacional',
            formTitle: '➕ Lançamento de Ajuste DRE',
            defaultType: 'receita'
        }
    };

    const cfg = modalConfig[kpiType] || modalConfig.receita;
    titleEl.textContent = cfg.title;
    subTitleEl.textContent = cfg.sub;
    if (formTitleEl) formTitleEl.textContent = cfg.formTitle;

    renderFinanceKpiModalItems(kpiType);
    overlay.style.display = 'flex';
}

function closeFinanceKpiDetailModal() {
    const overlay = document.getElementById('finance-kpi-modal-overlay');
    if (overlay) overlay.style.display = 'none';
}

function renderFinanceKpiModalItems(kpiType) {
    const listEl = document.getElementById('fkpi-modal-items-list');
    const statsBarEl = document.getElementById('fkpi-modal-stats-bar');
    const badgeEl = document.getElementById('fkpi-modal-count-badge');
    if (!listEl) return;

    let filtered = [];
    if (kpiType === 'receita') {
        filtered = globalFinances.filter(f => f.type === 'income' || f.type === 'receita');
    } else if (kpiType === 'despesa') {
        filtered = globalFinances.filter(f => f.type === 'expense' || f.type === 'despesa');
    } else if (kpiType === 'receber') {
        // "Contas a Receber" = receita com status pendente, não um type à parte (ver registerFinancialEntry/dashboard.ts).
        filtered = globalFinances.filter(f => f.status === 'pendente' && (f.type === 'receita' || f.type === 'income'));
    } else if (kpiType === 'pagar') {
        filtered = globalFinances.filter(f => f.status === 'pendente' && (f.type === 'despesa' || f.type === 'expense'));
    } else {
        filtered = globalFinances;
    }

    if (badgeEl) badgeEl.textContent = filtered.length;

    const totalSum = filtered.reduce((acc, f) => acc + Number(f.amount || 0), 0);

    if (statsBarEl) {
        statsBarEl.innerHTML = `
            <span>Total Acumulado nesta Categoria:</span>
            <strong style="font-size:14px; color:${kpiType === 'despesa' || kpiType === 'pagar' ? '#ef4444' : 'var(--cyan)'};">R$ ${totalSum.toLocaleString('pt-BR', {minimumFractionDigits:2})}</strong>
        `;
    }

    if (filtered.length === 0) {
        listEl.innerHTML = '<div style="color:var(--text-2); font-size:12px; padding:10px 0;">Nenhum lançamento encontrado nesta categoria. Adicione um novo lançamento acima!</div>';
        return;
    }

    listEl.innerHTML = filtered.map(f => {
        const shortId = f.id ? f.id.slice(0, 8).toUpperCase() : '';
        const isInc = f.type === 'income' || f.type === 'receita';
        const isPendingReceivable = isInc && f.status === 'pendente';
        const isPendingPayable = !isInc && f.status === 'pendente';
        const color = isInc ? 'var(--green)' : '#ef4444';
        const tagText = isPendingReceivable ? 'Contas a Receber' : isPendingPayable ? 'Contas a Pagar' : isInc ? 'Receita' : 'Despesa';

        return `
            <div class="item-card" style="background:rgba(15,23,42,0.8); border:1px solid var(--border); border-radius:12px; padding:10px 12px; display:flex; align-items:center; justify-content:space-between;">
                <div class="item-info" style="display:flex; flex-direction:column; gap:2px;">
                    <div class="item-title" style="font-weight:700; font-size:13px; color:${color};">
                        ${isInc ? '↗' : '↘'} R$ ${Number(f.amount || 0).toLocaleString('pt-BR', {minimumFractionDigits:2})} — ${escapeHtml(f.description || f.category || 'Lançamento')}
                    </div>
                    <div class="item-sub" style="font-size:11px; color:var(--text-2);">
                        <span style="background:${color}22; color:${color}; padding:1px 6px; border-radius:6px; font-weight:700;">${tagText}</span>
                        <span style="margin-left:6px;">${f.date || 'Hoje'}</span>
                    </div>
                </div>
                <div style="display:flex; gap:6px; align-items:center;">
                    ${f.status === 'pendente' ? `<button class="btn btn-ghost btn-xs" style="background:var(--green); color:#fff; font-weight:700;" onclick="markFinancePaidFromModal('${shortId}')">✅ ${isInc ? 'Recebido' : 'Pago'}</button>` : ''}
                    <button class="btn btn-ghost btn-xs" style="color:#93c5fd;" onclick="editFinanceItemFromModal('${shortId}', '${escapeHtml(f.description || '')}', '${f.amount}')">Editar</button>
                    <button class="btn btn-ghost btn-xs" style="color:#fca5a5;" onclick="deleteFinanceItemFromModal('${shortId}')">Excluir</button>
                </div>
            </div>`;
    }).join('');
}

async function saveFinanceFromKpiModal() {
    // Cards de Orçamento/Meta não criam um lançamento -- salvam a meta em
    // si (achado 07/08/2026: antes esses cards abriam o formulário normal
    // de lançamento, mas os valores de orçamento eram hardcoded no código
    // e não tinham NENHUM jeito real de serem configurados).
    if (currentKpiModalType === 'orc_receita' || currentKpiModalType === 'orc_despesa' || currentKpiModalType === 'margem') {
        return saveFinanceBudgetFromModal();
    }

    const descEl = document.getElementById('fkpi-input-desc');
    const amtEl = document.getElementById('fkpi-input-amount');
    const catEl = document.getElementById('fkpi-input-cat');
    const dateEl = document.getElementById('fkpi-input-date');

    const desc = descEl?.value.trim() || 'Lançamento via Card';
    const amount = parseFloat(amtEl?.value || 0);
    const category = catEl?.value || 'outros';
    const date = dateEl?.value || new Date().toISOString().split('T')[0];

    if (isNaN(amount) || amount <= 0) { alert('Digite um valor válido maior que zero.'); return; }

    let type = 'despesa';
    if (currentKpiModalType === 'receita' || currentKpiModalType === 'lucro' || currentKpiModalType === 'saldo') type = 'receita';
    else if (currentKpiModalType === 'receber') type = 'receber';
    else if (currentKpiModalType === 'pagar') type = 'pagar';

    try {
        const res = await fetch('/api/hermes/finances', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ type, amount, category, description: desc, dueDate: date })
        });
        if (!res.ok) { const err = await res.json().catch(() => ({})); throw new Error(err.message || 'create_failed'); }

        if (descEl) descEl.value = '';
        if (amtEl) amtEl.value = '';

        await loadFinances();
        renderFinanceKpiModalItems(currentKpiModalType);
    } catch (e) {
        alert('❌ Erro ao salvar lançamento: ' + (e.message || ''));
    }
}

// Salva meta de orçamento (receita/despesa) ou meta de margem de lucro --
// reaproveita o campo "Valor" do form do modal como o valor da meta.
async function saveFinanceBudgetFromModal() {
    const amtEl = document.getElementById('fkpi-input-amount');
    const value = parseFloat(amtEl?.value || 0);
    if (isNaN(value) || value < 0) { alert('Digite um valor válido para a meta.'); return; }

    const patch = {};
    if (currentKpiModalType === 'orc_receita') patch.receitaTarget = value;
    else if (currentKpiModalType === 'orc_despesa') patch.despesaTarget = value;
    else if (currentKpiModalType === 'margem') patch.marginTarget = value;

    try {
        const res = await fetch('/api/hermes/finances/budget', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(patch) });
        if (!res.ok) throw new Error('budget_save_failed');
        if (amtEl) amtEl.value = '';
        await loadFinances();
        closeFinanceKpiDetailModal();
    } catch (e) {
        alert('❌ Erro ao salvar meta.');
    }
}

async function deleteFinanceItemFromModal(shortId) {
    if (!confirm('Excluir este lançamento financeiro?')) return;
    try {
        await fetch(`/api/hermes/finances/${shortId}`, { method: 'DELETE' });
        await loadFinances();
        renderFinanceKpiModalItems(currentKpiModalType);
    } catch (e) {
        alert('❌ Erro ao excluir.');
    }
}

async function markFinancePaidFromModal(shortId) {
    try {
        await fetch(`/api/hermes/finances/${shortId}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ status: 'pago' })
        });
        await loadFinances();
        renderFinanceKpiModalItems(currentKpiModalType);
    } catch (e) {
        alert('❌ Erro ao atualizar status.');
    }
}

function editFinanceItemFromModal(shortId, oldDesc, oldAmount) {
    const newDesc = prompt('Editar Descrição:', oldDesc);
    if (newDesc === null) return;
    const newAmt = prompt('Editar Valor (R$):', oldAmount);
    if (newAmt === null) return;

    const parsedAmt = parseFloat(newAmt);
    if (isNaN(parsedAmt) || parsedAmt <= 0) { alert('Valor inválido.'); return; }

    fetch(`/api/hermes/finances/${shortId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ description: newDesc, amount: parsedAmt })
    }).then(async () => {
        await loadFinances();
        renderFinanceKpiModalItems(currentKpiModalType);
    }).catch(() => alert('Erro ao editar item.'));
}
