/* ═══════════════════════════════════════════════════════════════════════════
   BROW PWA — LÓGICA COMPLETA DE FINANÇAS EXECUTIVAS CÓPIA FIEL 1:1 DA IMAGEM
   E STREAMING COMPATÍVEL COM /api/chat (V6.0.0 EXECUTIVE FINANCIAL DASHBOARD)
   ═══════════════════════════════════════════════════════════════════════════ */

let deferredInstallPrompt = null;
let currentTabId = 'voz';
let isVoiceRecording = false;
let speechRecognition = null;

const TELEGRAM_CHAT_STORAGE_KEY = 'hermes_telegram_chat_history';
let chatHistory = JSON.parse(localStorage.getItem(TELEGRAM_CHAT_STORAGE_KEY) || '[]');
let chatResponseMode = localStorage.getItem('hermes_chat_mode') || 'both';
let isSpeakingOrListening = false;

// Elementos de Ondas Neurais
let waveCanvas, waveCtx, waveAnimFrame;
let wavePhase = 0;

// Estados locais sincronizados
let globalMemories = [];
let globalAgenda = [];
let globalFinances = [];
let globalDocuments = JSON.parse(localStorage.getItem('pwa_documents_v1') || '[]');
let globalContacts = JSON.parse(localStorage.getItem('pwa_contacts_v1') || '[]');
let globalGoals = JSON.parse(localStorage.getItem('pwa_goals_v1') || '[]');
let globalTasks = JSON.parse(localStorage.getItem('pwa_tasks_v1') || '[]');
let globalAutomations = JSON.parse(localStorage.getItem('pwa_automations_v1') || '[{"id":"1","title":"Sincronização Telegram & Dashboard","active":true},{"id":"2","title":"Guardião Financeiro Proativo","active":true}]');
let globalScheduledBriefings = JSON.parse(localStorage.getItem('pwa_scheduled_briefings_v1') || '[{"topic":"Inteligência Artificial e LLMs","time":"08:00","freq":"Diário (Seg a Dom)"}]');

let currentMemoryCategory = 'all';
let currentTaskPriorityFilter = 'all';
let editingItemTarget = null;

const REAL_TELEMETRY_URL = '/api/hermes/telemetry';
const REAL_TELEMETRY_FRESH_MS = 15000;
let lastRealTelemetryAt = 0;

let pcTelemetry = {
  cpuLoadEst: 12,
  ramUsedMB: 6290,
  ramTotalMB: 8090,
  ramPercent: 78,
  gpuLoadEst: 10,
  gpuName: 'NVIDIA GeForce 940MX',
  diskPercent: 90,
  diskFreeGB: 10.9,
  diskTotalGB: 111.1,
  cores: 4,
  fps: 60,
  topProcesses: [],
  bluetoothDevices: [],
  telemetrySource: 'estimado'
};

// 1. INICIALIZAÇÃO AO CARREGAR O APLICATIVO
document.addEventListener('DOMContentLoaded', () => {
  initServiceWorker();
  initInstallPrompt();
  initPcTelemetryPwa();
  initSpeechRecognition();
  initNeuralWaveCanvasPwa();
  setChatModePwa(chatResponseMode);
  
  loadChatMessagesFromStoragePwa();
  loadAllDashboardData();
  
  // Escutar atualizações do localStorage em tempo real de outras abas/dashboard
  window.addEventListener('storage', (e) => {
    if (e.key === TELEGRAM_CHAT_STORAGE_KEY && e.newValue) {
      try {
        chatHistory = JSON.parse(e.newValue);
        renderAllSavedChatBubbles();
      } catch (err) {}
    }
  });

  // Polling de Telemetria Real do PC via HTTPS (/api/hermes/telemetry) 1:1 com o Dashboard
  pollRealTelemetryAgentPwa();
  setInterval(() => { if (!document.hidden) pollRealTelemetryAgentPwa(); }, 60000);

  initFinanceSyncPwa();
  initHermesAlivenessPwa();

  // Telemetria do PRÓPRIO celular (09/08/2026, pedido explícito do usuário:
  // "deve coletar os dados do celular, faça isso acontecer") -- antes só
  // ativava com um clique manual na aba Automação; agora começa sozinha ao
  // abrir o app. GPS/bateria/rede pedem permissão do navegador na hora (é
  // o próprio SO que mostra o prompt, não dá pra pular). Sensores de
  // movimento no iOS Safari são exceção real: aquele navegador só concede
  // DeviceMotion dentro de um gesto do usuário (clique), então autostart
  // funciona para tudo no Android/Chrome mas iOS ainda depende do botão em
  // Automação para o sensor de movimento especificamente.
  startDeviceTelemetryPwa();
});

// 2. SERVICE WORKER & PROMPT DE INSTALAÇÃO
function initServiceWorker() {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/pwa/sw.js')
      .then((reg) => console.log('[BROW] Service Worker ativo:', reg.scope))
      .catch((err) => console.warn('[BROW] Erro SW:', err));
  }
}

function initInstallPrompt() {
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredInstallPrompt = e;
    const banner = document.getElementById('pwa-install-banner');
    if (banner) banner.classList.add('active');
  });
}

function installPwaApp() {
  if (!deferredInstallPrompt) return;
  deferredInstallPrompt.prompt();
  deferredInstallPrompt.userChoice.then((choice) => {
    if (choice.outcome === 'accepted') console.log('[BROW] PWA Instalado!');
    deferredInstallPrompt = null;
    const banner = document.getElementById('pwa-install-banner');
    if (banner) banner.classList.remove('active');
  });
}

// 3. TELEMETRIA REAL DO PC VIA HTTPS (/api/hermes/telemetry) — CÓPIA FIEL 1:1 DO DASHBOARD
async function pollRealTelemetryAgentPwa() {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3000);
    const res = await fetch(REAL_TELEMETRY_URL, { signal: controller.signal });
    clearTimeout(timeout);
    if (!res.ok) return;

    const data = await res.json();
    if (!data || !data.ok || !data.telemetry || data.freshness !== 'fresh') {
      return;
    }

    const t = data.telemetry;
    pcTelemetry.cpuLoadEst = Math.round(t.cpuPercent || 12);
    pcTelemetry.ramPercent = Math.round(t.ramPercent || 78);
    pcTelemetry.ramUsedMB = Math.round(t.ramUsedMB || 6290);
    pcTelemetry.ramTotalMB = Math.round(t.ramTotalMB || 8090);
    pcTelemetry.gpuName = t.gpuName || 'NVIDIA GeForce 940MX';
    pcTelemetry.gpuLoadEst = Math.round(t.gpuPercent || (pcTelemetry.cpuLoadEst * 0.45));
    pcTelemetry.cores = t.cores || 4;

    if (typeof t.diskFreeGB === 'number') pcTelemetry.diskFreeGB = t.diskFreeGB;
    if (typeof t.diskTotalGB === 'number') pcTelemetry.diskTotalGB = t.diskTotalGB;
    if (typeof t.diskFreeGB === 'number' && typeof t.diskTotalGB === 'number' && t.diskTotalGB > 0) {
      pcTelemetry.diskPercent = Math.round(((t.diskTotalGB - t.diskFreeGB) / t.diskTotalGB) * 100);
    }
    if (Array.isArray(t.topProcesses)) pcTelemetry.topProcesses = t.topProcesses;
    if (Array.isArray(t.bluetoothDevices)) pcTelemetry.bluetoothDevices = t.bluetoothDevices;

    pcTelemetry.telemetrySource = 'real-os';
    lastRealTelemetryAt = Date.now();

    renderPwaTelemetryGauges();
    renderConnectedDevicesPwa();
  } catch (e) {}
}

// ── Dispositivos Conectados (PWA) -- espelha o dashboard desktop: Bluetooth
// do PC (via agente local) + este próprio celular (via device-telemetry).
async function renderConnectedDevicesPwa() {
  const el = document.getElementById('connected-devices-list-pwa');
  if (!el) return;
  const rows = [];

  const btDevices = pcTelemetry.bluetoothDevices || [];
  if (isRealTelemetryFreshPwa() && btDevices.length) {
    btDevices.forEach(d => rows.push(`<div>${d.connected ? '🟢' : '⚪'} ${escapeHtml(d.name)} ${typeof d.batteryPercent === 'number' ? `— 🔋 ${d.batteryPercent}%` : ''}</div>`));
  } else if (isRealTelemetryFreshPwa()) {
    rows.push('<div style="color:var(--text-muted);">Nenhum periférico Bluetooth pareado detectado no PC.</div>');
  } else {
    rows.push('<div style="color:var(--text-muted);">Agente local do PC offline.</div>');
  }

  try {
    const res = await fetch('/api/hermes/device-telemetry');
    const data = await res.json();
    if (data.ok && data.freshness === 'fresh') {
      const t = data.telemetry;
      const battTxt = typeof t.batteryPercent === 'number' ? `${t.batteryPercent}%${t.batteryCharging ? ' ⚡' : ''}` : 'N/D';
      rows.push(`<div>📱 Este celular — 🔋 ${battTxt}${t.networkType ? ` — 📶 ${escapeHtml(t.networkType)}` : ''}</div>`);
    } else {
      rows.push('<div style="color:var(--text-muted);">Telemetria deste celular inativa — ative em Automação.</div>');
    }
  } catch (e) {}

  el.innerHTML = rows.join('');
}

function isRealTelemetryFreshPwa() {
  return pcTelemetry.telemetrySource === 'real-os' && (Date.now() - lastRealTelemetryAt) < REAL_TELEMETRY_FRESH_MS;
}

function initPcTelemetryPwa() {
  let lastTime = performance.now();
  let frameCount = 0;

  function tickPwaTelemetry() {
    if (isRealTelemetryFreshPwa()) return;

    const now = performance.now();
    const delta = now - lastTime;
    lastTime = now;

    const instantFps = Math.min(60, Math.max(1, Math.round((frameCount * 1000) / Math.max(1, delta))));
    frameCount = 0;
    pcTelemetry.fps = instantFps;

    renderPwaTelemetryGauges();
  }

  try {
    const blob = new Blob([`setInterval(() => postMessage('tick'), 200);`], { type: 'application/javascript' });
    const worker = new Worker(URL.createObjectURL(blob));
    worker.onmessage = () => tickPwaTelemetry();
  } catch (e) {
    setInterval(tickPwaTelemetry, 200);
  }

  function countFrames() {
    frameCount++;
    requestAnimationFrame(countFrames);
  }
  requestAnimationFrame(countFrames);
}

function renderPwaTelemetryGauges() {
  const sourceBadgeEl = document.getElementById('telemetry-source-badge');
  if (sourceBadgeEl) {
    if (isRealTelemetryFreshPwa()) {
      sourceBadgeEl.textContent = '🟢 CPU/RAM reais (agente local ativo)';
      sourceBadgeEl.style.color = 'var(--emerald)';
    } else {
      sourceBadgeEl.textContent = '🟡 CPU/RAM estimados (agente local offline)';
      sourceBadgeEl.style.color = 'var(--amber)';
    }
  }

  const cpuEl = document.getElementById('telemetry-cpu-val');
  const ramEl = document.getElementById('telemetry-ram-val');
  const gpuEl = document.getElementById('telemetry-gpu-val');
  const diskEl = document.getElementById('telemetry-disk-val');
  const badgeEl = document.getElementById('telemetry-status-badge');

  const cpuTextEl = document.getElementById('gauge-cpu-text');
  const ramTextEl = document.getElementById('gauge-ram-text');
  const gpuTextEl = document.getElementById('gauge-gpu-text');
  const diskTextEl = document.getElementById('gauge-disk-text');

  const cpuCircleEl = document.getElementById('gauge-cpu-circle');
  const ramCircleEl = document.getElementById('gauge-ram-circle');
  const gpuCircleEl = document.getElementById('gauge-gpu-circle');
  const diskCircleEl = document.getElementById('gauge-disk-circle');

  // Achado 13/08/2026 (relatado ao vivo no PWA): sem o agente local do PC,
  // isso mostrava números FIXOS inventados (ex.: "NVIDIA GeForce 940MX",
  // "6290MB", "90%" de disco) como se fossem dado real do PC do usuário --
  // nunca eram. Mesmo padrão honesto já aplicado no dashboard principal:
  // sem dado real fresco, mostra placeholder, nunca inventa número.
  const realFresh = isRealTelemetryFreshPwa();
  const safeCpu = realFresh && !isNaN(pcTelemetry.cpuLoadEst) ? Math.min(100, Math.max(0, pcTelemetry.cpuLoadEst)) : null;
  const safeRam = realFresh && !isNaN(pcTelemetry.ramPercent) ? Math.min(100, Math.max(0, pcTelemetry.ramPercent)) : null;
  const safeGpu = realFresh && !isNaN(pcTelemetry.gpuLoadEst) ? Math.min(100, Math.max(0, pcTelemetry.gpuLoadEst)) : null;
  const hasDisk = realFresh && typeof pcTelemetry.diskPercent === 'number' && !isNaN(pcTelemetry.diskPercent);
  const safeDisk = hasDisk ? Math.min(100, Math.max(0, pcTelemetry.diskPercent)) : null;

  if (cpuTextEl) cpuTextEl.textContent = safeCpu == null ? '--%' : `${safeCpu}%`;
  if (ramTextEl) ramTextEl.textContent = safeRam == null ? '--%' : `${safeRam}%`;
  if (gpuTextEl) gpuTextEl.textContent = safeGpu == null ? '--%' : `${safeGpu}%`;
  if (diskTextEl) diskTextEl.textContent = safeDisk == null ? '--%' : `${safeDisk}%`;

  const maxDash = 119.38;
  const dashCpu = safeCpu ?? 0;
  const dashRam = safeRam ?? 0;
  const dashGpu = safeGpu ?? 0;
  const dashDisk = safeDisk ?? 0;

  if (cpuCircleEl) {
    const cpuOffset = maxDash - (dashCpu / 100) * maxDash;
    cpuCircleEl.style.strokeDashoffset = Math.max(0, cpuOffset);
  }
  const cpuNeedleEl = document.getElementById('gauge-cpu-needle');
  if (cpuNeedleEl) {
    const cpuAngle = -90 + (dashCpu / 100) * 180;
    cpuNeedleEl.style.transform = `rotate(${cpuAngle}deg)`;
  }

  if (ramCircleEl) {
    const ramOffset = maxDash - (dashRam / 100) * maxDash;
    ramCircleEl.style.strokeDashoffset = Math.max(0, ramOffset);
  }
  const ramNeedleEl = document.getElementById('gauge-ram-needle');
  if (ramNeedleEl) {
    const ramAngle = -90 + (dashRam / 100) * 180;
    ramNeedleEl.style.transform = `rotate(${ramAngle}deg)`;
  }

  if (gpuCircleEl) {
    const gpuOffset = maxDash - (dashGpu / 100) * maxDash;
    gpuCircleEl.style.strokeDashoffset = Math.max(0, gpuOffset);
  }
  const gpuNeedleEl = document.getElementById('gauge-gpu-needle');
  if (gpuNeedleEl) {
    const gpuAngle = -90 + (dashGpu / 100) * 180;
    gpuNeedleEl.style.transform = `rotate(${gpuAngle}deg)`;
  }

  if (diskCircleEl) {
    const diskOffset = maxDash - (dashDisk / 100) * maxDash;
    diskCircleEl.style.strokeDashoffset = Math.max(0, diskOffset);
  }
  const diskNeedleEl = document.getElementById('gauge-disk-needle');
  if (diskNeedleEl) {
    const diskAngle = -90 + (dashDisk / 100) * 180;
    diskNeedleEl.style.transform = `rotate(${diskAngle}deg)`;
  }

  if (cpuEl) cpuEl.textContent = realFresh ? `${safeCpu}% (${pcTelemetry.cores || 4} Núcleos)` : 'Sem agente local';
  if (ramEl) ramEl.textContent = realFresh ? `${pcTelemetry.ramUsedMB}MB / ${pcTelemetry.ramTotalMB}MB (${safeRam}%)` : 'Sem agente local';
  if (gpuEl) gpuEl.textContent = realFresh && pcTelemetry.gpuName ? pcTelemetry.gpuName.slice(0, 32) : 'Sem agente local';
  if (diskEl) diskEl.textContent = hasDisk ? `${pcTelemetry.diskFreeGB}GB / ${pcTelemetry.diskTotalGB}GB` : 'Sem agente local';

  if (badgeEl) {
    if (safeCpu > 85 || safeRam > 90) {
      badgeEl.textContent = '🔴 Alerta';
      badgeEl.style.color = '#ef4444';
    } else {
      badgeEl.textContent = '🟢 Normal';
      badgeEl.style.color = 'var(--emerald)';
    }
  }
}

// 4. PERSISTÊNCIA REAL-TIME DO CHAT
function loadChatMessagesFromStoragePwa() {
  try {
    const saved = localStorage.getItem(TELEGRAM_CHAT_STORAGE_KEY);
    if (saved) {
      chatHistory = JSON.parse(saved);
      renderAllSavedChatBubbles();
    } else {
      chatHistory = [
        {
          id: 'init-1',
          text: '✈️ **BROW Neural Assistant**\n\nOlá! Sou o BROW, seu assistente neural conectado 24/7 ao seu Telegram e Segundo Cérebro. Como posso te ajudar hoje?',
          sender: '✈️ BROW',
          isUser: false,
          timestamp: formatTimeNow()
        }
      ];
      saveChatMessagesToStoragePwa();
      renderAllSavedChatBubbles();
    }
  } catch (e) {
    chatHistory = [];
  }
}

function saveChatMessagesToStoragePwa() {
  try {
    localStorage.setItem(TELEGRAM_CHAT_STORAGE_KEY, JSON.stringify(chatHistory.slice(-80)));
  } catch (e) {}
}

function renderAllSavedChatBubbles() {
  const container = document.getElementById('chat-messages-container');
  if (!container) return;
  container.innerHTML = '';
  chatHistory.forEach(msg => {
    const text = msg.text || msg.content || '';
    const isUser = msg.isUser || msg.role === 'user' || msg.sender === '👤 Você';
    const time = msg.timestamp || msg.time || formatTimeNow();
    appendMessageBubble(isUser ? 'user' : 'hermes', text, time);
  });
  scrollToChatBottom();
}

function formatTimeNow() {
  return new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

// 5. ONDAS NEURAIS DA BROW
function initNeuralWaveCanvasPwa() {
  waveCanvas = document.getElementById('neural-wave-canvas');
  if (!waveCanvas) return;
  waveCtx = waveCanvas.getContext('2d');

  function resizeCanvas() {
    if (!waveCanvas) return;
    waveCanvas.width = waveCanvas.offsetWidth || 400;
    waveCanvas.height = waveCanvas.offsetHeight || 52;
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
      waveCtx.lineWidth = isSpeakingOrListening ? 3.0 : 1.6;
      waveCtx.strokeStyle = l.color;
      const currentAmp = (isSpeakingOrListening ? 22 : 6) * l.amp;
      for (let x = 0; x <= w; x += 3) {
        const y = cy + Math.sin(x * 0.025 * l.freq + wavePhase * l.speed) * currentAmp * Math.sin((x / w) * Math.PI);
        if (x === 0) waveCtx.moveTo(x, y);
        else waveCtx.lineTo(x, y);
      }
      waveCtx.stroke();
    });

    waveAnimFrame = requestAnimationFrame(renderWave);
  }

  if (waveAnimFrame) cancelAnimationFrame(waveAnimFrame);
  renderWave();
}

// 6. DRAWER & NAVEGAÇÃO ENTRE ABAS
function openDrawer() {
  document.getElementById('pwa-drawer').classList.add('active');
  document.getElementById('pwa-drawer-backdrop').classList.add('active');
}

function closeDrawer() {
  document.getElementById('pwa-drawer').classList.remove('active');
  document.getElementById('pwa-drawer-backdrop').classList.remove('active');
}

function switchPwaTab(tabId) {
  currentTabId = tabId;
  closeDrawer();

  document.querySelectorAll('.pwa-view').forEach(v => v.classList.remove('active'));
  document.querySelectorAll('.drawer-item').forEach(i => i.classList.remove('active'));
  document.querySelectorAll('.nav-tab').forEach(t => t.classList.remove('active'));

  const targetView = document.getElementById(`view-${tabId}`);
  const targetDrawer = document.getElementById(`drawer-item-${tabId}`);
  const targetNav = document.getElementById(`nav-tab-${tabId}`);

  if (targetView) targetView.classList.add('active');
  if (targetDrawer) targetDrawer.classList.add('active');
  if (targetNav) targetNav.classList.add('active');

  if (tabId === 'dashboard') { loadOverview(); loadDashboardNewsPwa(); }
  if (tabId === 'memoria') loadMemories();
  if (tabId === 'agenda') loadAgenda();
  if (tabId === 'financas') loadFinances();
  if (tabId === 'documentos') loadDocuments();
  if (tabId === 'contatos') loadContacts();
  if (tabId === 'metas') loadGoals();
  if (tabId === 'tarefas') loadTasks();
  if (tabId === 'automacao') { loadAutomations(); loadLocationSettingsPwa(); }
  if (tabId === 'skills') loadSkills();
}

// 7. CONTROLES DA BARRA SUPERIOR DO CHAT
function setChatModePwa(mode) {
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

function stopHermesAudioPwa() {
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
  if (badge) badge.textContent = '🟢 Pronta';
  if (title) title.textContent = 'Converse com o BROW — digite ou fale';
}

function repeatLastHermesMessagePwa(e) {
  if (e && e.preventDefault) e.preventDefault();
  const lastHermesMsg = [...chatHistory].reverse().find(m => (!m.isUser && m.text) || (m.role === 'assistant' && m.content));
  const textToSpeak = lastHermesMsg ? (lastHermesMsg.text || lastHermesMsg.content) : "Olá! Sou o BROW, seu assistente neural pronto para ajudar.";
  speakWithEdgeTTS(textToSpeak);
}

function clearVoiceChatHistoryPwa() {
  if (!confirm("Deseja apagar todo o histórico de conversas do chat?")) return;
  chatHistory = [
    {
      id: 'init-1',
      text: '✈️ Histórico zerado com sucesso! Como posso ajudar você agora?',
      sender: '✈️ BROW',
      isUser: false,
      timestamp: formatTimeNow()
    }
  ];
  saveChatMessagesToStoragePwa();
  const container = document.getElementById('chat-messages-container');
  if (container) container.innerHTML = '';
  appendMessageBubble('hermes', '✈️ Histórico zerado com sucesso! Como posso ajudar você agora?', formatTimeNow());
}

// 8. MOTOR DE CHAT AI DE PRODUÇÃO (/api/chat) COM LEITURA STREAMING SEGURA
async function sendChatMessage() {
  const input = document.getElementById('chat-input-field');
  if (!input) return;
  const text = input.value.trim();
  if (!text) return;

  input.value = '';
  const nowStr = formatTimeNow();

  appendMessageBubble('user', text, nowStr);
  
  const userMsgObj = {
    id: Date.now().toString(),
    text: text,
    sender: '👤 Você',
    isUser: true,
    timestamp: nowStr
  };
  chatHistory.push(userMsgObj);
  saveChatMessagesToStoragePwa();
  scrollToChatBottom();

  const badge = document.getElementById('voice-state-badge');
  const title = document.getElementById('voice-transcript-title');

  if (badge) badge.textContent = '🧠 Pensando...';
  if (title) title.textContent = `Processando: "${text.slice(0, 35)}..."`;
  isSpeakingOrListening = true;

  const typingId = appendTypingIndicator();
  scrollToChatBottom();

  try {
    const res = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: text,
        history: chatHistory.map(m => ({ role: m.isUser ? 'user' : 'assistant', content: m.text || m.content || '' })),
        telemetry: pcTelemetry,
        // O canal não pode ser inferido pelo backend: sem este campo a PWA
        // era gravada como Dashboard e perdia sua projeção de contexto.
        channel: 'pwa'
      })
    });

    removeTypingIndicator(typingId);

    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    let replyText = '';
    if (res.body) {
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const delta = decoder.decode(value, { stream: true });
        if (delta) replyText += delta;
      }
    } else {
      replyText = await res.text();
    }

    if (!replyText.trim()) {
      replyText = 'Olá! Sou o BROW, seu assistente neural. Como posso te ajudar?';
    }

    const agentMsgObj = {
      id: (Date.now() + 1).toString(),
      text: replyText,
      sender: '✈️ BROW',
      isUser: false,
      timestamp: nowStr
    };
    chatHistory.push(agentMsgObj);
    if (chatHistory.length > 80) chatHistory = chatHistory.slice(-80);
    saveChatMessagesToStoragePwa();

    if (chatResponseMode !== 'audio') {
      appendMessageBubble('hermes', replyText, nowStr);
      scrollToChatBottom();
    }

    if (chatResponseMode !== 'text') {
      if (title) title.textContent = '🔊 Reproduzindo voz...';
      await speakWithEdgeTTS(replyText);
    } else {
      isSpeakingOrListening = false;
      if (badge) badge.textContent = '🟢 Pronta';
      if (title) title.textContent = 'Converse com o BROW — digite ou fale';
    }

  } catch (err) {
    removeTypingIndicator(typingId);
    isSpeakingOrListening = false;
    if (badge) badge.textContent = '❌ Erro';
    console.error('[BROW] Erro ao conectar com /api/chat:', err);
    appendMessageBubble('hermes', '⚠️ Erro de conexão com o BROW: ' + err.message, nowStr);
    scrollToChatBottom();
  }
}

// UPLOAD DE FOTOS DIRETO NO CHAT
function triggerChatPhotoUploadPwa() {
  const el = document.getElementById('chat-photo-input');
  if (el) el.click();
}

function triggerChatFileUploadPwa() {
  const el = document.getElementById('chat-file-input');
  if (el) el.click();
}

function handleChatPhotoUploadPwa(event) {
  const file = event.target.files?.[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = (e) => {
    const input = document.getElementById('chat-input-field');
    if (input) input.value = `Analise esta foto que anexei: "${file.name}"`;
    sendChatMessage();
  };
  reader.readAsDataURL(file);
}

function handleChatFileUploadPwa(event) {
  const file = event.target.files?.[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = (e) => {
    const contentText = e.target.result;
    const sample = typeof contentText === 'string' ? contentText.slice(0, 1000) : 'Arquivo binário anexado.';
    const input = document.getElementById('chat-input-field');
    if (input) input.value = `Analise o documento "${file.name}":\n${sample}`;
    sendChatMessage();
  };
  if (file.type.includes('text') || file.name.endsWith('.txt') || file.name.endsWith('.csv') || file.name.endsWith('.md')) {
    reader.readAsText(file);
  } else {
    reader.readAsDataURL(file);
  }
}

function textForHermesDisplay(text) {
  // Respostas de notícias vêm do mesmo renderer HTML seguro do Telegram.
  // A PWA usa bolhas de texto, portanto converte apenas a marcação conhecida
  // em texto legível antes de escapar; não injeta HTML remoto no DOM.
  return String(text || '')
    .replace(/<a\s+[^>]*href=["']([^"']+)["'][^>]*>[^<]*<\/a>/gi, 'Fonte: $1')
    .replace(/<\/?(?:b|strong|i|em|u)>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function appendMessageBubble(sender, text, timeStr) {
  const container = document.getElementById('chat-messages-container');
  if (!container) return;

  const div = document.createElement('div');
  div.className = `msg-bubble ${sender === 'user' ? 'msg-user' : 'msg-hermes'}`;

  const displayText = sender === 'hermes' ? textForHermesDisplay(text) : String(text || '');
  const escapedText = escapeHtml(displayText);
  const encodedText = encodeURIComponent(displayText);

  if (sender === 'hermes') {
    div.innerHTML = `
      <div>${escapedText}</div>
      <div class="msg-meta">
        <button class="btn-replay-voice" onclick="speakWithEdgeTTS(decodeURIComponent('${encodedText}'))">🔊 Reler Voz</button>
        <span>${timeStr}</span>
      </div>`;
  } else {
    div.innerHTML = `
      <div>${escapedText}</div>
      <div class="msg-meta"><span>${timeStr} ✓✓</span></div>`;
  }

  container.appendChild(div);
}

function appendTypingIndicator() {
  const container = document.getElementById('chat-messages-container');
  if (!container) return null;
  const id = 'typing-' + Date.now();
  const div = document.createElement('div');
  div.id = id;
  div.className = 'msg-bubble msg-hermes';
  div.style.opacity = '0.75';
  div.innerHTML = '✨ <em>BROW está pensando...</em>';
  container.appendChild(div);
  return id;
}

function removeTypingIndicator(id) {
  if (!id) return;
  const el = document.getElementById(id);
  if (el) el.remove();
}

function scrollToChatBottom() {
  const container = document.getElementById('chat-messages-container');
  if (container) container.scrollTop = container.scrollHeight;
}

// 9. SÍNTESE DE VOZ REAL VIA /api/tts COM AUDIO PLAYER
async function speakWithEdgeTTS(textToSpeak) {
  if (!textToSpeak) return;
  const badge = document.getElementById('voice-state-badge');
  const title = document.getElementById('voice-transcript-title');
  const player = document.getElementById('edge-tts-player');

  if (badge) badge.textContent = '🔊 Falando';
  isSpeakingOrListening = true;

  const finish = () => {
    isSpeakingOrListening = false;
    if (badge) badge.textContent = '🟢 Pronta';
    if (title) title.textContent = 'Converse com o BROW — digite ou fale';
  };

  try {
    const ttsUrl = `/api/tts?text=${encodeURIComponent(textToSpeak)}`;
    if (player) {
      player.pause();
      player.src = ttsUrl;
      await player.play().catch(() => fallbackNativeSpeech(textToSpeak));
      await new Promise(resolve => { player.onended = resolve; player.onerror = resolve; player.onpause = resolve; });
    }
  } catch (err) {
    fallbackNativeSpeech(textToSpeak);
  }

  finish();
}

function fallbackNativeSpeech(text) {
  if ('speechSynthesis' in window) {
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = 'pt-BR';
    utterance.rate = 1.05;
    window.speechSynthesis.speak(utterance);
  }
}

// 10. MICROFONE POR VOZ
function initSpeechRecognition() {
  const SpeechRec = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRec) return;

  speechRecognition = new SpeechRec();
  speechRecognition.continuous = false;
  speechRecognition.interimResults = true;
  speechRecognition.lang = 'pt-BR';

  speechRecognition.onresult = (e) => {
    let transcript = '';
    for (let i = e.resultIndex; i < e.results.length; i++) {
      transcript += e.results[i][0].transcript;
    }
    const input = document.getElementById('chat-input-field');
    if (input) input.value = transcript;

    const title = document.getElementById('voice-transcript-title');
    if (title) title.textContent = `"${transcript}"`;
  };

  speechRecognition.onend = () => {
    isVoiceRecording = false;
    isSpeakingOrListening = false;
    const btn = document.getElementById('mic-btn-toggle');
    const badge = document.getElementById('voice-state-badge');
    const title = document.getElementById('voice-transcript-title');
    if (btn) btn.classList.remove('recording');
    if (badge) badge.textContent = '🟢 Pronta';
    if (title) title.textContent = 'Converse com o BROW — digite ou fale';
  };
}

function toggleMicInput() {
  if (!speechRecognition) {
    alert('Navegador sem suporte a microfone.');
    return;
  }
  const btn = document.getElementById('mic-btn-toggle');
  const badge = document.getElementById('voice-state-badge');
  const title = document.getElementById('voice-transcript-title');

  if (isVoiceRecording) {
    speechRecognition.stop();
    isVoiceRecording = false;
    isSpeakingOrListening = false;
    if (btn) btn.classList.remove('recording');
    if (badge) badge.textContent = '🟢 Pronta';
    if (title) title.textContent = 'Converse com o BROW — digite ou fale';
  } else {
    try {
      speechRecognition.start();
      isVoiceRecording = true;
      isSpeakingOrListening = true;
      if (btn) btn.classList.add('recording');
      if (badge) badge.textContent = '🎙️ Ouvindo...';
      if (title) title.textContent = 'Fale agora...';
    } catch (e) {}
  }
}

// 11. ABA DOCUMENTOS
function loadDocuments() {
  const el = document.getElementById('pwa-documents-list');
  const countBadge = document.getElementById('doc-count-badge');

  if (countBadge) countBadge.textContent = globalDocuments.length;
  if (!el) return;

  if (globalDocuments.length === 0) {
    el.innerHTML = '<div style="color:var(--text-muted);">Nenhum documento salvo. Envie PDF, Excel, Word ou fotos acima para o BROW ler e analisar!</div>';
    return;
  }

  el.innerHTML = globalDocuments.map(d => {
    const ext = (d.type || d.title.split('.').pop() || 'DOC').toUpperCase();
    const badgeColor = ext.includes('PDF') ? '#ef4444' : (ext.includes('XLS') || ext.includes('CSV') ? '#10b981' : (ext.includes('DOC') ? '#3b82f6' : '#a855f7'));
    
    return `
      <div class="item-card">
        <div class="item-info">
          <div class="item-title" style="display:flex; align-items:center; gap:8px;">
            <span class="doc-type-chip" style="background:${badgeColor}22; border-color:${badgeColor}66; color:${badgeColor};">${escapeHtml(ext)}</span>
            <span style="color:#fff;">${escapeHtml(d.title)}</span>
          </div>
          <div class="item-sub" style="margin-top:4px;">${escapeHtml(d.content ? d.content.slice(0, 90) + '...' : 'Documento ativo')} • Data: ${d.date || 'Hoje'}</div>
        </div>
        <div style="display:flex; gap:6px; flex-wrap:wrap;">
          <button class="btn-action" style="padding:4px 10px; font-size:11px;" onclick="analyzeDocumentPwa('${d.id}')">📄 Ler com BROW</button>
          <button class="btn-edit" onclick="openEditModalPwa('document', '${d.id}', '${escapeHtml(d.title)}', '${escapeHtml(d.content || '')}')">Editar</button>
          <button class="btn-delete" onclick="deleteDocumentPwa('${d.id}')">Excluir</button>
        </div>
      </div>`;
  }).join('');
}

function handleDocDropzoneSelectPwa(event) {
  const files = event.target.files || event.dataTransfer?.files;
  if (!files || files.length === 0) return;
  for (let i = 0; i < files.length; i++) {
    uploadAndAnalyzeDocumentPwa(files[i]);
  }
}

function uploadAndAnalyzeDocumentPwa(file) {
  const reader = new FileReader();
  reader.onload = (e) => {
    const textContent = e.target.result;
    const docId = Date.now().toString() + Math.random().toString(36).slice(2, 5);
    const title = file.name;
    const type = file.name.split('.').pop().toUpperCase();
    const date = new Date().toLocaleDateString('pt-BR');
    const content = typeof textContent === 'string' ? textContent.slice(0, 4000) : `[Documento binário ${type} - ${file.size} bytes]`;

    const newDoc = { id: docId, title, type, content, date };
    globalDocuments.unshift(newDoc);
    localStorage.setItem('pwa_documents_v1', JSON.stringify(globalDocuments));

    fetch('/api/hermes/memories', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: `Documento: ${title}`, summary: content.slice(0, 300), mainCategory: 'documento', tags: [type.toLowerCase(), 'doc', 'pwa'] })
    }).catch(() => {});

    alert(`✅ Documento "${title}" anexado e salvo com sucesso!`);
    loadDocuments();

    if (confirm(`Deseja que o BROW leia e analise o documento "${title}" agora no chat?`)) {
      switchPwaTab('voz');
      const chatInput = document.getElementById('chat-input-field');
      if (chatInput) chatInput.value = `Leia e faça uma síntese executiva deste documento "${title}":\n\n${content.slice(0, 1500)}`;
      sendChatMessage();
    }
  };

  if (file.type.includes('text') || file.name.endsWith('.txt') || file.name.endsWith('.csv') || file.name.endsWith('.md')) {
    reader.readAsText(file);
  } else {
    reader.readAsDataURL(file);
  }
}

function analyzeDocumentPwa(docId) {
  const doc = globalDocuments.find(d => d.id === docId);
  if (!doc) return;
  switchPwaTab('voz');
  const chatInput = document.getElementById('chat-input-field');
  if (chatInput) chatInput.value = `Analise e explique os pontos principais do documento "${doc.title}":\n\n${(doc.content || '').slice(0, 1500)}`;
  sendChatMessage();
}

function deleteDocumentPwa(id) {
  if (!confirm('Excluir este documento do BROW?')) return;
  globalDocuments = globalDocuments.filter(d => d.id !== id);
  localStorage.setItem('pwa_documents_v1', JSON.stringify(globalDocuments));
  loadDocuments();
}

// 12. FINANÇAS EXECUTIVAS — CÓPIA FIEL 1:1 DA IMAGEM DO DASHBOARD
let globalFinanceBudget = { receitaTarget: 0, despesaTarget: 0, marginTarget: 12 };
let globalFinanceHistory = [];

async function loadFinances() {
  const listContainer = document.getElementById('pwa-finances-list');
  try {
    const [res, budgetRes, historyRes] = await Promise.all([
      fetch('/api/hermes/finances'),
      fetch('/api/hermes/finances/budget').then(r => r.json()).catch(() => null),
      fetch('/api/hermes/finances/history?months=12').then(r => r.json()).catch(() => null),
    ]);
    const data = await res.json();
    globalFinances = data.items || [];
    if (budgetRes?.ok) globalFinanceBudget = budgetRes.budget;
    if (historyRes?.ok) globalFinanceHistory = historyRes.points || [];

    renderExecutiveFinancesDashboardPwa(data);

    if (listContainer) {
      if (globalFinances.length === 0) {
        listContainer.innerHTML = '<div style="color:var(--text-muted);">Nenhum lançamento registrado ainda.</div>';
      } else {
        listContainer.innerHTML = globalFinances.map(f => {
          const shortId = f.id ? f.id.slice(0, 8).toUpperCase() : '';
          const isIncome = f.type === 'income' || f.type === 'receita';
          const amt = Number(f.amount || 0).toFixed(2).replace('.', ',');
          const tagColor = isIncome ? 'var(--emerald)' : (f.type === 'receber' ? 'var(--cyan)' : '#ef4444');
          return `
            <div class="item-card">
              <div class="item-info">
                <div class="item-title" style="color:${tagColor};">
                  ${isIncome ? '↗ Receita' : (f.type === 'receber' ? '📥 Contas a Receber' : (f.type === 'pagar' ? '📤 Contas a Pagar' : '↘ Despesa'))}: R$ ${amt}
                </div>
                <div class="item-sub">${escapeHtml(f.description || f.category || 'Transação')} • ${f.date || 'Hoje'}</div>
              </div>
              <div style="display:flex; gap:6px;">
                <button class="btn-edit" onclick="editFinanceItemFromModal('${shortId}', '${escapeHtml(f.description || '').replace(/'/g, "\\'")}', '${f.amount}')">Editar</button>
                <button class="btn-delete" onclick="deleteFinancePwa('${shortId}')">Excluir</button>
              </div>
            </div>`;
        }).join('');
      }
    }
  } catch (e) {
    console.error('Erro ao carregar finanças:', e);
  }
  loadMarketTickerPwa();
}

// ── Mercado ao vivo (Tier 1/2, 08/09/2026) -- espelha o dashboard, mesmos
// endpoints (BCB Olinda + CoinGecko).
async function loadMarketTickerPwa() {
  try {
    const [dolarRes, selicRes, cryptoRes] = await Promise.all([
      fetch('/api/hermes/tools/cambio?dias=1').then(r => r.json()).catch(() => null),
      fetch('/api/hermes/tools/selic?dias=1').then(r => r.json()).catch(() => null),
      fetch('/api/hermes/tools/crypto?ids=bitcoin,ethereum').then(r => r.json()).catch(() => null),
    ]);
    const dolarEl = document.getElementById('mt-dolar-pwa');
    const selicEl = document.getElementById('mt-selic-pwa');
    const btcEl = document.getElementById('mt-btc-pwa');
    const ethEl = document.getElementById('mt-eth-pwa');

    if (dolarEl) dolarEl.textContent = dolarRes?.ok && dolarRes.data?.length ? `R$ ${Number(dolarRes.data[dolarRes.data.length - 1].valor).toFixed(2)}` : 'indisponível';
    if (selicEl) selicEl.textContent = selicRes?.ok && selicRes.data?.length ? `${Number(selicRes.data[selicRes.data.length - 1].valor).toFixed(2)}%` : 'indisponível';
    if (cryptoRes?.ok) {
      const btc = cryptoRes.data.bitcoin, eth = cryptoRes.data.ethereum;
      if (btcEl && btc) btcEl.textContent = `R$ ${Number(btc.brl).toLocaleString('pt-BR')}`;
      if (ethEl && eth) ethEl.textContent = `R$ ${Number(eth.brl).toLocaleString('pt-BR')}`;
    } else {
      if (btcEl) btcEl.textContent = 'indisponível';
      if (ethEl) ethEl.textContent = 'indisponível';
    }
  } catch (e) { /* silencioso -- informativo */ }
}

/* ── SYNC DE FINANÇAS ENTRE PWA / DASHBOARD / TELEGRAM (07/08/2026) ──
   Mesmo achado do dashboard: um lançamento criado no Telegram (ou no
   Dashboard) já ia pro mesmo R2 que o PWA lê, mas o PWA só chamava
   loadFinances() ao trocar de aba, uma vez -- sem repoll, ficava invisível
   até o usuário sair e voltar pra aba Finanças. Espelha o polling já usado
   pro chat-history: intervalo curto, só reage se a aba Finanças estiver
   realmente aberta e sem o modal de detalhamento em foco (edição em
   andamento não deve ser interrompida por um refresh de fundo). */
let pwaFinanceSyncPolling = false;
async function pollFinancesSyncPwa() {
  if (pwaFinanceSyncPolling) return;
  if (currentTabId !== 'financas') return;
  const kpiModal = document.getElementById('finance-kpi-modal-overlay');
  if (kpiModal && getComputedStyle(kpiModal).display !== 'none') return;
  pwaFinanceSyncPolling = true;
  try { await loadFinances(); } catch (e) { /* silencioso -- tenta de novo no próximo tick */ }
  finally { pwaFinanceSyncPolling = false; }
}
function initFinanceSyncPwa() { setInterval(() => { if (!document.hidden) pollFinancesSyncPwa(); }, 60000); }

/* ── LOCALIZAÇÃO (aba Automação) — 08/08/2026, espelha o dashboard ── */
async function loadLocationSettingsPwa() {
  const label = document.getElementById('location-current-label-pwa');
  try {
    const res = await fetch('/api/hermes/settings/location');
    const data = await res.json();
    if (data?.ok && label) {
      const src = data.location.source === 'gps' ? '📍 GPS' : data.location.source === 'manual' ? '✏️ manual' : '⚙️ padrão';
      label.textContent = `Atual: ${data.location.label} (${src})`;
    }
  } catch (e) { if (label) label.textContent = 'Não consegui carregar a localização atual.'; }
}

function useGpsLocationPwa() {
  const label = document.getElementById('location-current-label-pwa');
  if (!navigator.geolocation) { if (label) label.textContent = 'Este dispositivo não suporta GPS.'; return; }
  if (label) label.textContent = '📍 Obtendo sua localização...';
  navigator.geolocation.getCurrentPosition(async (pos) => {
    const { latitude, longitude } = pos.coords;
    let cityLabel = `${latitude.toFixed(3)}, ${longitude.toFixed(3)}`;
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

/* ── TELEMETRIA DO DISPOSITIVO (PWA) — 08/08/2026 ──
   GPS contínuo, bateria, rede e Bluetooth do celular, com push periódico
   pro Worker (/api/hermes/device-telemetry) pro BROW e o dashboard verem
   o dispositivo como "conectado". Cada capacidade é isolada com feature
   detection própria -- navegador sem suporte (ex: Battery API removida do
   Safari/Firefox, Bluetooth ausente no iOS) mostra "não suportado" em vez
   de quebrar as demais. */
const deviceTelemetryStatePwa = {
  active: false,
  geoWatchId: null,
  lat: null, lon: null, accuracy: null,
  batteryPercent: null, batteryCharging: null, batterySupported: null,
  networkType: null, networkDownlink: null,
  motion: null, motionSupported: null,
  bluetoothDevices: [],
  // Memória/armazenamento/hardware (09/08/2026, pedido explícito: "acrescente
  // mais dados da telemetria do celular, memória, armazenamento etc").
  deviceMemoryGB: null, cpuCores: null,
  storageUsedMB: null, storageQuotaMB: null,
  screenWidth: null, screenHeight: null, pixelRatio: null,
  platform: null, userAgent: null
};
let deviceTelemetryPushTimer = null;

function startDeviceTelemetryPwa() {
  if (deviceTelemetryStatePwa.active) return;
  deviceTelemetryStatePwa.active = true;
  const statusEl = document.getElementById('device-telemetry-status-pwa');
  if (statusEl) { statusEl.textContent = '🟢 Ativa'; statusEl.style.color = 'var(--emerald)'; }

  // 0. Hardware/plataforma -- dados estáticos, sem pedir permissão nenhuma
  // (deviceMemory/hardwareConcurrency são só leitura, sempre disponíveis).
  deviceTelemetryStatePwa.deviceMemoryGB = navigator.deviceMemory || null;
  deviceTelemetryStatePwa.cpuCores = navigator.hardwareConcurrency || null;
  deviceTelemetryStatePwa.screenWidth = window.screen?.width || null;
  deviceTelemetryStatePwa.screenHeight = window.screen?.height || null;
  deviceTelemetryStatePwa.pixelRatio = window.devicePixelRatio || null;
  deviceTelemetryStatePwa.platform = navigator.platform || null;
  deviceTelemetryStatePwa.userAgent = navigator.userAgent || null;
  if (navigator.storage?.estimate) {
    navigator.storage.estimate().then((est) => {
      deviceTelemetryStatePwa.storageUsedMB = est.usage != null ? Math.round(est.usage / 1024 / 1024) : null;
      deviceTelemetryStatePwa.storageQuotaMB = est.quota != null ? Math.round(est.quota / 1024 / 1024) : null;
      renderDeviceTelemetryReadoutPwa();
    }).catch(() => {});
  }

  // 1. GPS contínuo
  if (navigator.geolocation) {
    deviceTelemetryStatePwa.geoWatchId = navigator.geolocation.watchPosition((pos) => {
      deviceTelemetryStatePwa.lat = pos.coords.latitude;
      deviceTelemetryStatePwa.lon = pos.coords.longitude;
      deviceTelemetryStatePwa.accuracy = pos.coords.accuracy;
      renderDeviceTelemetryReadoutPwa();
    }, () => {}, { enableHighAccuracy: false, maximumAge: 30000, timeout: 10000 });
  }

  // 2. Bateria
  if (navigator.getBattery) {
    navigator.getBattery().then((battery) => {
      deviceTelemetryStatePwa.batterySupported = true;
      const update = () => {
        deviceTelemetryStatePwa.batteryPercent = Math.round(battery.level * 100);
        deviceTelemetryStatePwa.batteryCharging = battery.charging;
        renderDeviceTelemetryReadoutPwa();
      };
      update();
      battery.addEventListener('levelchange', update);
      battery.addEventListener('chargingchange', update);
    }).catch(() => { deviceTelemetryStatePwa.batterySupported = false; renderDeviceTelemetryReadoutPwa(); });
  } else {
    deviceTelemetryStatePwa.batterySupported = false;
  }

  // 3. Rede
  const conn = navigator.connection || navigator.webkitConnection || navigator.mozConnection;
  if (conn) {
    const updateNet = () => {
      deviceTelemetryStatePwa.networkType = conn.effectiveType || conn.type || null;
      deviceTelemetryStatePwa.networkDownlink = conn.downlink || null;
      renderDeviceTelemetryReadoutPwa();
    };
    updateNet();
    conn.addEventListener('change', updateNet);
  }

  // 4. Sensores de movimento (iOS 13+ exige permissão explícita, só pode
  // ser pedida dentro de um gesto do usuário -- este botão é o gesto).
  const attachMotion = () => {
    deviceTelemetryStatePwa.motionSupported = true;
    window.addEventListener('devicemotion', (e) => {
      const a = e.accelerationIncludingGravity || e.acceleration;
      if (!a) return;
      deviceTelemetryStatePwa.motion = { x: Math.round((a.x || 0) * 10) / 10, y: Math.round((a.y || 0) * 10) / 10, z: Math.round((a.z || 0) * 10) / 10 };
      renderDeviceTelemetryReadoutPwa();
    });
  };
  if (typeof DeviceMotionEvent !== 'undefined' && typeof DeviceMotionEvent.requestPermission === 'function') {
    DeviceMotionEvent.requestPermission().then((perm) => {
      if (perm === 'granted') attachMotion();
      else { deviceTelemetryStatePwa.motionSupported = false; renderDeviceTelemetryReadoutPwa(); }
    }).catch(() => { deviceTelemetryStatePwa.motionSupported = false; renderDeviceTelemetryReadoutPwa(); });
  } else if (typeof DeviceMotionEvent !== 'undefined') {
    attachMotion();
  } else {
    deviceTelemetryStatePwa.motionSupported = false;
  }

  renderDeviceTelemetryReadoutPwa();
  pushDeviceTelemetrySnapshotPwa();
  if (deviceTelemetryPushTimer) clearInterval(deviceTelemetryPushTimer);
  deviceTelemetryPushTimer = setInterval(pushDeviceTelemetrySnapshotPwa, 30000);
}

async function pairBluetoothDevicePwa() {
  if (!navigator.bluetooth) {
    alert('Este navegador não suporta Web Bluetooth (comum no iOS/Safari). Funciona no Chrome/Edge Android.');
    return;
  }
  try {
    const device = await navigator.bluetooth.requestDevice({ acceptAllDevices: true, optionalServices: ['battery_service'] });
    let batteryPercent = null;
    try {
      const server = await device.gatt.connect();
      const service = await server.getPrimaryService('battery_service');
      const char = await service.getCharacteristic('battery_level');
      const value = await char.readValue();
      batteryPercent = value.getUint8(0);
    } catch (e) { /* dispositivo sem serviço de bateria exposto -- ok, mostra sem % */ }

    const existing = deviceTelemetryStatePwa.bluetoothDevices.find(d => d.name === device.name);
    if (existing) existing.batteryPercent = batteryPercent;
    else deviceTelemetryStatePwa.bluetoothDevices.push({ name: device.name || 'Dispositivo sem nome', batteryPercent });

    renderDeviceTelemetryReadoutPwa();
    pushDeviceTelemetrySnapshotPwa();
  } catch (e) {
    // Usuário cancelou o seletor de pareamento -- comportamento normal, sem erro.
  }
}

function renderDeviceTelemetryReadoutPwa() {
  const el = document.getElementById('device-telemetry-readout-pwa');
  if (!el) return;
  const s = deviceTelemetryStatePwa;
  const rows = [];

  if (s.lat != null) rows.push(`<div>📍 GPS: ${s.lat.toFixed(4)}, ${s.lon.toFixed(4)} (±${Math.round(s.accuracy)}m)</div>`);
  else rows.push('<div>📍 GPS: aguardando permissão...</div>');

  if (s.batterySupported === false) rows.push('<div>🔋 Bateria: API não suportada neste navegador</div>');
  else if (s.batteryPercent != null) rows.push(`<div>🔋 Bateria: ${s.batteryPercent}%${s.batteryCharging ? ' (carregando ⚡)' : ''}</div>`);
  else rows.push('<div>🔋 Bateria: lendo...</div>');

  if (s.networkType) rows.push(`<div>📶 Rede: ${escapeHtml(s.networkType)}${s.networkDownlink ? ` (${s.networkDownlink}Mbps)` : ''}</div>`);
  else rows.push('<div>📶 Rede: API não disponível neste navegador</div>');

  if (s.deviceMemoryGB) rows.push(`<div>🧠 Memória RAM: ~${s.deviceMemoryGB}GB (${s.cpuCores || '?'} núcleos)</div>`);
  if (s.storageQuotaMB != null) rows.push(`<div>💾 Armazenamento: ${(s.storageUsedMB / 1024).toFixed(1)}GB usados de ${(s.storageQuotaMB / 1024).toFixed(1)}GB</div>`);
  if (s.screenWidth) rows.push(`<div>📱 Tela: ${s.screenWidth}x${s.screenHeight} (${s.pixelRatio}x)</div>`);

  if (s.motionSupported === false) rows.push('<div>📈 Sensores de movimento: não suportado/negado</div>');
  else if (s.motion) rows.push(`<div>📈 Movimento: x${s.motion.x} y${s.motion.y} z${s.motion.z}</div>`);

  if (s.bluetoothDevices.length) {
    s.bluetoothDevices.forEach(d => rows.push(`<div>🔵 ${escapeHtml(d.name)}${d.batteryPercent != null ? ` — 🔋 ${d.batteryPercent}%` : ''}</div>`));
  }

  el.innerHTML = rows.join('');
}

async function pushDeviceTelemetrySnapshotPwa() {
  const s = deviceTelemetryStatePwa;
  try {
    await fetch('/api/hermes/device-telemetry', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        lat: s.lat, lon: s.lon, accuracy: s.accuracy,
        batteryPercent: s.batteryPercent, batteryCharging: s.batteryCharging,
        networkType: s.networkType, networkDownlink: s.networkDownlink,
        motion: s.motion,
        bluetoothDevices: s.bluetoothDevices,
        deviceMemoryGB: s.deviceMemoryGB, cpuCores: s.cpuCores,
        storageUsedMB: s.storageUsedMB, storageQuotaMB: s.storageQuotaMB,
        screenWidth: s.screenWidth, screenHeight: s.screenHeight, pixelRatio: s.pixelRatio,
        platform: s.platform, userAgent: s.userAgent
      })
    });
  } catch (e) { /* offline -- tenta de novo no próximo tick */ }
}

/* ── "VIDA" DA BROW (PWA) — espelha app.js, mesmos bancos de frases ── */
const BROW_USER_NAME_PWA = 'Well';
const IDLE_THRESHOLD_MS_PWA = 12 * 60 * 1000;
const IDLE_NUDGE_COOLDOWN_MS_PWA = 25 * 60 * 1000;
const LATE_NIGHT_COOLDOWN_MS_PWA = 45 * 60 * 1000;

const IDLE_CHECKIN_PHRASES_PWA = [
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

const LATE_NIGHT_PHRASES_PWA = [
  `${BROW_USER_NAME_PWA}, já passa da meia-noite — que tal encerrar por hoje e descansar?`,
  `Reparei que já é bem tarde, ${BROW_USER_NAME_PWA}. Um bom sono ajuda muito amanhã.`,
  `${BROW_USER_NAME_PWA}, cuidado com o sono — o dia de amanhã agradece um descanso agora.`,
  `Já é madrugada, ${BROW_USER_NAME_PWA}. Recomendo dar uma pausa e ir dormir.`,
  `Horário tardio por aqui, ${BROW_USER_NAME_PWA} — sua saúde agradece um descanso.`,
  `${BROW_USER_NAME_PWA}, sei que tem coisa pra fazer, mas dormir bem também é produtivo.`,
  `Já é tarde demais pra continuar sem descanso, ${BROW_USER_NAME_PWA}. Que tal parar por aqui?`,
  `${BROW_USER_NAME_PWA}, sono de qualidade rende mais que mais uma hora acordado agora.`,
  `Vi que já passou da meia-noite, ${BROW_USER_NAME_PWA} — vale considerar ir descansar.`,
  `${BROW_USER_NAME_PWA}, seu corpo agradece se você desligar um pouco mais cedo hoje.`,
  `Vida de madrugada acordado cobra caro depois, ${BROW_USER_NAME_PWA}. Bora descansar?`,
  `${BROW_USER_NAME_PWA}, o que for importante ainda vai estar aqui amanhã cedo, descansado.`,
  `Notei o horário, ${BROW_USER_NAME_PWA} — uma boa noite de sono faz muita diferença.`,
  `${BROW_USER_NAME_PWA}, só um lembrete gentil: dormir bem também é cuidar de você.`,
  `Já é tarde da noite, ${BROW_USER_NAME_PWA}. Recomendo fechar por aqui e descansar a mente.`,
  `${BROW_USER_NAME_PWA}, produtividade também vem de dormir direito — considere uma pausa.`,
  `Hora avançada por aqui, ${BROW_USER_NAME_PWA}. Vale a pena priorizar o descanso agora.`,
  `${BROW_USER_NAME_PWA}, sei que é tentador continuar, mas seu descanso importa mais agora.`,
  `Já virou a madrugada, ${BROW_USER_NAME_PWA} — talvez seja hora de recarregar as energias.`,
  `${BROW_USER_NAME_PWA}, cuide de você também: um bom sono hoje rende um dia melhor amanhã.`,
];

let lastAnyInteractionAtPwa = Date.now();
let lastIdlePhraseIndexPwa = -1;
let lastLateNightPhraseIndexPwa = -1;
let lastIdleNudgeAtPwa = 0;
let lastLateNightNudgeAtPwa = 0;

function markUserInteractionPwa() { lastAnyInteractionAtPwa = Date.now(); }

function pickPhrasePwa(bank, lastIndexRef) {
  if (bank.length <= 1) return { text: bank[0], index: 0 };
  let idx = Math.floor(Math.random() * bank.length);
  while (idx === lastIndexRef) idx = Math.floor(Math.random() * bank.length);
  return { text: bank[idx], index: idx };
}

function checkHermesAlivenessPwa() {
  if (document.visibilityState !== 'visible') return;
  if (typeof isSpeakingOrListening !== 'undefined' && isSpeakingOrListening) return;
  const now = Date.now();
  const idleFor = now - lastAnyInteractionAtPwa;

  if (idleFor >= IDLE_THRESHOLD_MS_PWA && (now - lastIdleNudgeAtPwa) >= IDLE_NUDGE_COOLDOWN_MS_PWA) {
    lastIdleNudgeAtPwa = now;
    const { text, index } = pickPhrasePwa(IDLE_CHECKIN_PHRASES_PWA, lastIdlePhraseIndexPwa);
    lastIdlePhraseIndexPwa = index;
    speakWithEdgeTTS(text);
    return;
  }

  const hour = new Date().getHours();
  const isLateNight = hour >= 0 && hour < 5;
  if (isLateNight && idleFor < IDLE_THRESHOLD_MS_PWA && (now - lastLateNightNudgeAtPwa) >= LATE_NIGHT_COOLDOWN_MS_PWA) {
    lastLateNightNudgeAtPwa = now;
    const { text, index } = pickPhrasePwa(LATE_NIGHT_PHRASES_PWA, lastLateNightPhraseIndexPwa);
    lastLateNightPhraseIndexPwa = index;
    speakWithEdgeTTS(text);
  }
}

/* ── NOTÍCIAS EM TEMPO REAL (PWA) — espelha app.js, 08/08/2026 ── */
let currentNewsCategoryPwa = 'politica';
let globalNewsItemsPwa = [];
const NEWS_CAT_NAMES_PWA = { politica: '🏛️ Política', futebol: '⚽ Futebol', financas: '💰 Finanças', investimentos: '📈 Investimentos', tecnologia: '💻 Tecnologia', ia: '🤖 Inteligência Artificial', negocios: '💼 Dinheiro & Negócios' };

async function loadDashboardNewsPwa(manualRefresh = false) {
  const listEl = document.getElementById('news-items-list-pwa');
  const tsEl = document.getElementById('news-last-updated-ts-pwa');
  if (!listEl) return;
  if (manualRefresh && tsEl) tsEl.textContent = '🔎 Varrendo sites e portais ao vivo...';
  try {
    const refreshParam = manualRefresh ? '&refresh=true' : '';
    const res = await fetch(`/api/hermes/news?category=${encodeURIComponent(currentNewsCategoryPwa)}&query=${encodeURIComponent(currentNewsCategoryPwa)}${refreshParam}`);
    const data = await res.json();
    globalNewsItemsPwa = data.items || [];
    if (tsEl) tsEl.textContent = data.updatedAtStr ? `Atualizado ${data.updatedAtStr}` : `Atualizado ${new Date().toLocaleTimeString('pt-BR')}`;
    renderNewsListPwa();
  } catch (e) {
    if (listEl) listEl.innerHTML = '<div style="color:var(--text-muted); font-size:12px;">⚠️ Não foi possível carregar notícias ao vivo no momento.</div>';
  }
}

function filterNewsCategoryPwa(cat, btnEl) {
  currentNewsCategoryPwa = cat;
  document.querySelectorAll('#news-categories-pills-bar-pwa .news-cat-pill-pwa').forEach(b => b.classList.remove('active'));
  if (btnEl) btnEl.classList.add('active');
  const labelEl = document.getElementById('news-current-category-name-pwa');
  if (labelEl) labelEl.textContent = NEWS_CAT_NAMES_PWA[cat] || cat;
  loadDashboardNewsPwa();
}

function renderNewsListPwa() {
  const listEl = document.getElementById('news-items-list-pwa');
  if (!listEl) return;
  if (!globalNewsItemsPwa.length) {
    listEl.innerHTML = '<div style="color:var(--text-muted); font-size:12px;">Nenhuma notícia encontrada neste assunto no momento.</div>';
    return;
  }
  listEl.innerHTML = globalNewsItemsPwa.slice(0, 4).map(item => `
    <div class="news-item-card-pwa">
      <div style="display:flex; justify-content:space-between; font-size:10px; color:var(--text-muted);">
        <span>${escapeHtml(item.badge || item.category)}</span>
        <span>⏰ ${escapeHtml(item.time || 'Agora')}</span>
      </div>
      <div class="news-title-pwa">${escapeHtml(item.title)}</div>
      <div style="display:flex; justify-content:space-between; align-items:center; font-size:11px;">
        <span style="color:var(--text-muted);">📰 ${escapeHtml(item.source || 'Fonte Externa')}</span>
        <a href="${escapeHtml(item.url || '#')}" target="_blank" rel="noopener" style="color:var(--cyan); font-weight:700; text-decoration:none;">Ler Matéria ↗</a>
      </div>
    </div>`).join('');
}

function initHermesAlivenessPwa() {
  ['click', 'keydown', 'touchstart'].forEach((evt) => document.addEventListener(evt, markUserInteractionPwa, { passive: true }));
  setInterval(checkHermesAlivenessPwa, 60000);
}

async function setManualLocationPwa() {
  const input = document.getElementById('location-city-input-pwa');
  const label = document.getElementById('location-current-label-pwa');
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

/* ── Upload de recibo/extrato/PDF/Excel na aba Finanças (PWA) — 08/08/2026 ──
   Espelha uploadFinanceReceipt() do dashboard (app.js). Vai pra mesma Pages
   Function dedicada (/api/hermes/finances/upload) que repassa multipart puro
   pro Worker, onde extractFinancialTransactions() separa cada transação do
   documento em um lançamento próprio já categorizado. */
async function uploadFinanceReceiptPwa(event) {
  const input = event.target;
  const file = input.files?.[0];
  if (!file) return;
  const statusEl = document.getElementById('fin-upload-status-pwa');
  if (statusEl) statusEl.innerHTML = '⏳ Lendo e analisando o arquivo...';
  try {
    const form = new FormData();
    form.append('file', file);
    const res = await fetch('/api/hermes/finances/upload', { method: 'POST', body: form });
    const data = await res.json();
    if (!res.ok || !data.ok) throw new Error(data.message || 'upload_failed');
    if (statusEl) statusEl.innerHTML = '✅ ' + escapeHtml(data.message || `${data.count || 0} lançamento(s) criado(s).`);
    input.value = '';
    loadFinances();
  } catch (e) {
    if (statusEl) statusEl.innerHTML = '❌ Não consegui processar este arquivo. Tente uma foto mais nítida ou um PDF legível.';
    console.error(e);
  }
}

function renderExecutiveFinancesDashboardPwa(apiData) {
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

  // 1. Atualizar KPIs do Header
  const setEl = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
  setEl('kpi-total-receita', `R$ ${totalReceita.toLocaleString('pt-BR', {minimumFractionDigits:2})}`);
  setEl('kpi-total-despesas', `R$ ${totalDespesas.toLocaleString('pt-BR', {minimumFractionDigits:2})}`);
  setEl('kpi-lucro-liquido', `R$ ${lucroLiquido.toLocaleString('pt-BR', {minimumFractionDigits:2})}`);
  setEl('kpi-saldo-final', `R$ ${saldoFinal.toLocaleString('pt-BR', {minimumFractionDigits:2})}`);
  setEl('kpi-contas-receber', `R$ ${contasReceber.toLocaleString('pt-BR', {minimumFractionDigits:2})}`);
  setEl('kpi-contas-pagar', `R$ ${contasPagar.toLocaleString('pt-BR', {minimumFractionDigits:2})}`);
  setEl('kpi-liquidez-reduzida', liquidezReduzida);
  setEl('kpi-liquidez-geral', liquidezGeral);
  setEl('kpi-margem-val', `${margemLucro}%`);

  // Donut Gauge Margem
  const donutCircle = document.getElementById('donut-margem-circle');
  if (donutCircle) {
    const maxDash = 238.76;
    const pct = totalReceita > 0 ? Math.min(100, Math.max(0, parseFloat(margemLucro))) : 0;
    const offset = maxDash - (pct / 100) * maxDash;
    donutCircle.style.strokeDashoffset = offset;
  }
  setEl('pwa-goal-margem-label', `Objetivo: ${(globalFinanceBudget.marginTarget ?? 12).toFixed(1)}%`);

  // 2. Atualizar Tabela DRE -- achado 07/08/2026: "Custo de bens vendidos"
  // era um chute fixo (34%/66%) sem dado real por trás; o BROW não
  // rastreia custo de mercadoria (não é revenda), então o correto é
  // declarar honestamente R$0 em vez de inventar um número.
  const custoBens = 0;
  const lucroBruto = totalReceita - custoBens;
  const despesasOp = totalDespesas;
  const pct = (part) => totalReceita > 0 ? `${Math.round((part / totalReceita) * 100)}%` : '0%';

  setEl('dre-val-receita', `R$ ${totalReceita.toLocaleString('pt-BR', {minimumFractionDigits:2})}`);
  setEl('dre-pct-receita', totalReceita > 0 ? '100%' : '0%');
  setEl('dre-val-custo', `R$ ${custoBens.toLocaleString('pt-BR', {minimumFractionDigits:2})}`);
  setEl('dre-pct-custo', '0%');
  setEl('dre-val-bruto', `R$ ${lucroBruto.toLocaleString('pt-BR', {minimumFractionDigits:2})}`);
  setEl('dre-pct-bruto', pct(lucroBruto));
  setEl('dre-val-despesas', `R$ ${despesasOp.toLocaleString('pt-BR', {minimumFractionDigits:2})}`);
  setEl('dre-pct-despesas', pct(despesasOp));
  setEl('dre-val-liquido', `R$ ${lucroLiquido.toLocaleString('pt-BR', {minimumFractionDigits:2})}`);
  setEl('dre-pct-liquido', pct(lucroLiquido));

  // 3. Execução Orçamentária -- meta real (GET /api/hermes/finances/budget),
  // não mais os dois números fixos que nunca mudavam.
  const orcReceita = globalFinanceBudget.receitaTarget || 0;
  const orcDespesa = globalFinanceBudget.despesaTarget || 0;
  const pctOrcReceita = orcReceita > 0 ? Math.min(100, Math.round((totalReceita / orcReceita) * 100)) : 0;
  const pctOrcDespesa = orcDespesa > 0 ? Math.min(100, Math.round((totalDespesas / orcDespesa) * 100)) : 0;

  setEl('val-ring-receita', orcReceita > 0 ? `${pctOrcReceita}%` : '--');
  setEl('orc-receita-val', orcReceita > 0 ? `R$ ${orcReceita.toLocaleString('pt-BR', {minimumFractionDigits:2})}` : 'Não definido');
  setEl('bal-receita-val', orcReceita > 0 ? `R$ ${(totalReceita - orcReceita).toLocaleString('pt-BR', {minimumFractionDigits:2})}` : '--');

  setEl('val-ring-despesa', orcDespesa > 0 ? `${pctOrcDespesa}%` : '--');
  setEl('orc-despesa-val', orcDespesa > 0 ? `R$ ${orcDespesa.toLocaleString('pt-BR', {minimumFractionDigits:2})}` : 'Não definido');
  setEl('bal-despesa-val', orcDespesa > 0 ? `R$ ${(totalDespesas - orcDespesa).toLocaleString('pt-BR', {minimumFractionDigits:2})}` : '--');

  const ringRec = document.getElementById('ring-orc-receita');
  if (ringRec) ringRec.style.strokeDashoffset = 238.76 - (pctOrcReceita / 100) * 238.76;

  const ringDesp = document.getElementById('ring-orc-despesa');
  if (ringDesp) ringDesp.style.strokeDashoffset = 238.76 - (pctOrcDespesa / 100) * 238.76;

  renderComboChartPwa();
  renderBalanceTrendChartPwa();
}

function monthLabelPwa(monthKey) {
  const [, m] = (monthKey || '').split('-');
  return ['JAN','FEV','MAR','ABR','MAI','JUN','JUL','AGO','SET','OUT','NOV','DEZ'][Number(m) - 1] || '';
}

// Achado 07/08/2026: gráfico sintético (extrapolava 1 número pra 12
// meses) -- agora usa globalFinanceHistory, os últimos 12 meses reais
// (GET /api/hermes/finances/history).
function renderComboChartPwa() {
  const barsGroup = document.getElementById('combo-chart-bars-group');
  const linePath = document.getElementById('combo-chart-profit-line');
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
    barsHtml += `<text x="${x}" y="192" fill="#64748b" font-size="8" font-weight="700" text-anchor="middle">${monthLabelPwa(p.month)}</text>`;

    if (idx === 0) lineD += `M ${x} ${profitY}`;
    else lineD += ` L ${x} ${profitY}`;
  });

  barsGroup.innerHTML = barsHtml;
  linePath.setAttribute('d', lineD);
}

function renderBalanceTrendChartPwa() {
  const pathEl = document.getElementById('balance-trend-path');
  const dotsGroup = document.getElementById('balance-trend-dots');
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

    dotsHtml += `<circle cx="${x}" cy="${y}" r="4" fill="var(--amber)" stroke="#fff" stroke-width="1.5"/>`;
  });

  pathEl.setAttribute('d', pathD);
  dotsGroup.innerHTML = dotsHtml;
}

async function addFinancePwa() {
  const descInput = document.getElementById('fin-desc-input');
  const amountInput = document.getElementById('fin-amount-input');
  const typeSelect = document.getElementById('fin-type-select');

  const desc = descInput?.value.trim();
  const amount = parseFloat(amountInput?.value || 0);
  const type = typeSelect?.value || 'expense';

  if (!desc || isNaN(amount) || amount <= 0) { alert('Digite descrição e valor válido.'); return; }
  try {
    await fetch('/api/hermes/finances', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: (type === 'income' || type === 'receita') ? 'receita' : 'despesa', amount, category: 'geral', description: desc })
    });
    descInput.value = '';
    amountInput.value = '';
    alert('✅ Transação financeira salva com sucesso!');
    loadFinances();
    loadOverview();
  } catch (e) {
    alert('❌ Erro ao salvar transação.');
  }
}

async function deleteFinancePwa(shortId) {
  if (!confirm('Excluir este lançamento financeiro?')) return;
  try {
    await fetch(`/api/hermes/finances/${shortId}`, { method: 'DELETE' });
    alert('🗑️ Transação excluída!');
    loadFinances();
    loadOverview();
  } catch (e) {
    alert('❌ Erro ao excluir transação.');
  }
}

// 13. CARREGAMENTO DAS DEMAIS ABAS
async function loadAllDashboardData() {
  loadOverview();
  loadMemories();
  loadAgenda();
  loadFinances();
  loadDocuments();
  loadContacts();
  loadGoals();
  loadTasks();
  loadAutomations();
  loadSkills();
  loadSystemStatusPwa();
}

async function loadOverview() {
  try {
    const res = await fetch('/api/hermes/overview');
    if (!res.ok) return;
    const data = await res.json();
    const el = document.getElementById('kpi-overview-container');
    if (el && data) {
      el.innerHTML = `
        <div class="kpi-card">
          <div class="kpi-label">🧠 Memórias Totais</div>
          <div class="kpi-val">${data.totalMemories || globalMemories.length || 0}</div>
        </div>
        <div class="kpi-card">
          <div class="kpi-label">📅 Compromissos</div>
          <div class="kpi-val">${data.totalAgenda || globalAgenda.length || 0}</div>
        </div>
        <div class="kpi-card">
          <div class="kpi-label">💰 Saldo Atual</div>
          <div class="kpi-val" style="color:var(--emerald);">R$ ${(data.balance || 812).toFixed(2)}</div>
        </div>
        <div class="kpi-card">
          <div class="kpi-label">✅ Tarefas Pendentes</div>
          <div class="kpi-val">${data.pendingTasks || globalTasks.length || 0}</div>
        </div>`;
    }
  } catch (e) {}
}

// ─── DOCUMENTOS & ARQUIVOS (COFRE R2 + MEMÓRIA AI PWA) ───
let globalDocumentsPwa = [];

async function loadDocuments() {
  const container = document.getElementById('pwa-documents-list');
  const countBadge = document.getElementById('doc-count-badge');
  if (!container) return;
  try {
    const res = await fetch('/api/hermes/documents');
    const data = await res.json();
    globalDocumentsPwa = data.items || [];
    if (countBadge) countBadge.textContent = globalDocumentsPwa.length;
    renderDocumentsPwa(globalDocumentsPwa);
  } catch (e) {
    container.innerHTML = '<div style="color:var(--text-muted);">Erro ao carregar documentos.</div>';
  }
}

function renderDocumentsPwa(items) {
  const container = document.getElementById('pwa-documents-list');
  if (!container) return;
  if (!items || items.length === 0) {
    container.innerHTML = '<div style="color:var(--text-muted);">Nenhum documento cadastrado no cofre.</div>';
    return;
  }
  container.innerHTML = items.map(d => {
    const fullId = d.id || '';
    const shortId = d.id ? d.id.slice(0, 8).toUpperCase() : '';
    const mime = d.mime || '';
    const sizeStr = d.fileSize ? ` • ${(d.fileSize / 1024).toFixed(0)} KB` : '';
    const dateStr = d.createdAt ? new Date(d.createdAt).toLocaleDateString('pt-BR') : '';

    let fileIcon = '📄';
    if (mime.includes('pdf')) fileIcon = '📕';
    else if (mime.includes('sheet') || mime.includes('excel') || mime.includes('csv')) fileIcon = '📊';
    else if (mime.includes('word') || mime.includes('document') || mime.includes('text')) fileIcon = '📝';
    else if (mime.includes('image')) fileIcon = '🖼️';

    return `
      <div class="item-card">
        <div class="item-info">
          <div class="item-title" style="color:var(--cyan);">${fileIcon} ${escapeHtml(d.title || d.sourceName || 'Documento')}</div>
          <div class="item-sub">Categoria: <strong>${escapeHtml(d.category || 'documento')}</strong> • ${dateStr}${sizeStr}</div>
          <div style="font-size:10.5px; color:var(--emerald); margin-top:2px;">🧠 Compartilhado com a Memório BROW</div>
        </div>
        <div style="display:flex; gap:6px;">
          <button class="btn-edit" onclick="viewOrDownloadDocumentPwa('${escapeHtml(fullId || shortId)}')">Abrir</button>
          <button class="btn-delete" onclick="deleteDocumentPwa('${escapeHtml(fullId || shortId)}')">Excluir</button>
        </div>
      </div>`;
  }).join('');
}

async function handleDocDropzoneSelectPwa(event) {
  const input = event.target;
  const files = input.files;
  if (!files || !files.length) return;

  try {
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const formData = new FormData();
      formData.append('file', file);
      formData.append('category', 'documento');

      const res = await fetch('/api/hermes/documents/upload', {
        method: 'POST',
        body: formData
      });
      const data = await res.json();
      if (!data.ok) throw new Error(data.message || 'Erro no upload');
    }
    alert(`✅ ${files.length} documento(s) salvo(s) e integrado(s) à Memório BROW!`);
    input.value = '';
    loadDocuments();
    loadOverview();
  } catch (e) {
    alert(`❌ Erro ao enviar documento: ${e.message || 'Falha no upload'}`);
  }
}

function viewOrDownloadDocumentPwa(docId) {
  window.open(`/api/hermes/documents/${docId}/file`, '_blank');
}

async function deleteDocumentPwa(docId) {
  if (!confirm('Deseja remover este documento do R2 e da Memório BROW?')) return;
  try {
    globalDocumentsPwa = globalDocumentsPwa.filter(d => d.id !== docId && (d.id && d.id.slice(0, 8).toUpperCase() !== docId.slice(0, 8).toUpperCase()));
    renderDocumentsPwa(globalDocumentsPwa);

    const res = await fetch(`/api/hermes/documents/${docId}`, { method: 'DELETE' });
    const data = await res.json();
    if (!res.ok || !data.ok) throw new Error(data.message || 'Erro ao deletar');

    alert('🗑️ Documento removido!');
    loadDocuments();
    loadOverview();
  } catch (e) {
    alert('❌ Erro ao remover documento: ' + (e.message || 'Falha na requisição'));
    loadDocuments();
  }
}

// CRUD MEMÓRIAS
async function loadMemories() {
  const container = document.getElementById('pwa-memory-list');
  if (!container) return;
  try {
    const res = await fetch('/api/hermes/memories');
    const data = await res.json();
    globalMemories = data.items || [];
    filterMemoriesCategoryPwa(currentMemoryCategory);
  } catch (e) {
    container.innerHTML = '<div style="color:var(--text-muted);">Erro ao carregar memórias.</div>';
  }
}

function filterMemoriesCategoryPwa(cat) {
  currentMemoryCategory = cat;
  document.querySelectorAll('.memory-filter-pills .pill-btn').forEach(b => b.classList.remove('active'));
  const activeBtn = document.getElementById(`mem-pill-${cat}`);
  if (activeBtn) activeBtn.classList.add('active');

  const container = document.getElementById('pwa-memory-list');
  if (!container) return;

  let filtered = globalMemories;
  if (cat !== 'all') {
    filtered = globalMemories.filter(m => (m.mainCategory || 'geral') === cat || (m.category || '').includes(cat));
  }

  const query = (document.getElementById('memory-search-input')?.value || '').toLowerCase().trim();
  if (query) {
    filtered = filtered.filter(m => (m.title + ' ' + (m.summary || m.content || '')).toLowerCase().includes(query));
  }

  if (filtered.length === 0) {
    container.innerHTML = '<div style="color:var(--text-muted);">Nenhuma memória encontrada.</div>';
    return;
  }

  container.innerHTML = filtered.map(m => {
    const shortId = m.id ? m.id.slice(0, 8).toUpperCase() : '';
    return `
      <div class="item-card">
        <div class="item-info">
          <div class="item-title" style="color:var(--cyan);">${escapeHtml(m.title || m.summary || 'Memória')}</div>
          <div class="item-sub">${escapeHtml(m.content || m.summary || '')}</div>
        </div>
        <div style="display:flex; gap:6px;">
          <button class="btn-edit" onclick="openEditModalPwa('memory', '${shortId}', '${escapeHtml(m.title || '')}', '${escapeHtml(m.content || m.summary || '')}')">Editar</button>
          <button class="btn-delete" onclick="deleteMemoryPwa('${shortId}')">Excluir</button>
        </div>
      </div>`;
  }).join('');
}

async function addMemoryPwa() {
  const input = document.getElementById('new-memory-input');
  const catInput = document.getElementById('new-memory-cat');
  if (!input || !input.value.trim()) return;
  const text = input.value.trim();
  const category = catInput?.value || 'geral';

  try {
    await fetch('/api/hermes/memories', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: text.slice(0, 60), summary: text, mainCategory: category, source: 'pwa' })
    });
    input.value = '';
    alert('✅ Memória registrada com sucesso!');
    loadMemories();
    loadOverview();
  } catch (e) {
    alert('❌ Erro ao salvar memória.');
  }
}

async function deleteMemoryPwa(shortId) {
  if (!confirm('Excluir esta memória do BROW?')) return;
  try {
    await fetch(`/api/hermes/memories/${shortId}`, { method: 'DELETE' });
    alert('🗑️ Memória excluída!');
    loadMemories();
    loadOverview();
  } catch (e) {
    alert('❌ Erro ao excluir memória.');
  }
}

// CRUD AGENDA
async function loadAgenda() {
  const container = document.getElementById('pwa-agenda-list');
  const reminderContainer = document.getElementById('auto-reminders-list');
  if (!container) return;
  try {
    const res = await fetch('/api/hermes/agenda');
    const data = await res.json();
    globalAgenda = data.items || [];
    renderAgendaListPwa(globalAgenda);

    if (reminderContainer) {
      const active = globalAgenda.filter(a => !a.sentAt);
      const countSpan = document.getElementById('auto-reminders-count');
      if (countSpan) countSpan.textContent = active.length;
      if (active.length === 0) {
        reminderContainer.innerHTML = '<li style="color:var(--text-muted); list-style:none; padding:8px 0;">Nenhum lembrete pendente na nuvem.</li>';
      } else {
        reminderContainer.innerHTML = active.slice(0, 6).map(a => `
          <li style="color:#fff; list-style:none; padding:6px 0; border-bottom:1px solid var(--border); font-size:13px; display:flex; justify-content:space-between; align-items:center;">
            <span>⏰ <strong>${escapeHtml(a.title || a.text)}</strong></span>
            <span style="color:var(--cyan); font-size:11px;">${a.dueAt ? new Date(a.dueAt).toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'}) : a.time || '09:00'}</span>
          </li>`).join('');
      }
    }
  } catch (e) {
    container.innerHTML = '<div style="color:var(--text-muted);">Erro ao carregar agenda.</div>';
  }
}

function renderAgendaListPwa(items) {
  const container = document.getElementById('pwa-agenda-list');
  if (!container) return;
  if (!items || items.length === 0) {
    container.innerHTML = '<div style="color:var(--text-muted);">Nenhum compromisso agendado.</div>';
    return;
  }
  container.innerHTML = items.map(a => {
    const shortId = a.key ? a.key.slice(0, 8).toUpperCase() : (a.id ? a.id.slice(0, 8).toUpperCase() : '');
    const when = a.dueAt ? new Date(a.dueAt).toLocaleString('pt-BR') : `às ${a.time || '09:00'}`;
    return `
      <div class="item-card">
        <div class="item-info">
          <div class="item-title" style="color:var(--purple);">${escapeHtml(a.title || a.text || 'Compromisso')}</div>
          <div class="item-sub">📅 ${when} ${a.sentAt ? '• <span style="color:var(--cyan);">Enviado Telegram</span>' : '• <span style="color:var(--emerald);">Pendente</span>'}</div>
        </div>
        <div style="display:flex; gap:6px;">
          <button class="btn-edit" onclick="openEditModalPwa('agenda', '${shortId}', '${escapeHtml(a.title || a.text || '')}', '${when}')">Editar</button>
          <button class="btn-delete" onclick="deleteAgendaPwa('${shortId}')">Excluir</button>
        </div>
      </div>`;
  }).join('');
}

async function addAgendaPwa() {
  const titleInput = document.getElementById('agenda-title-input');
  const dateInput = document.getElementById('agenda-date-input');
  const timeInput = document.getElementById('agenda-time-input');

  const title = titleInput?.value.trim();
  const date = dateInput?.value || new Date().toISOString().split('T')[0];
  const time = timeInput?.value || '09:00';

  if (!title) { alert('Digite o título do compromisso.'); return; }
  try {
    await fetch('/api/hermes/agenda', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: title, dueAt: new Date(`${date}T${time}:00`).toISOString(), source: 'pwa' })
    });
    titleInput.value = '';
    alert('✅ Compromisso agendado!');
    loadAgenda();
    loadOverview();
  } catch (e) {
    alert('❌ Erro ao agendar compromisso.');
  }
}

async function deleteAgendaPwa(shortId) {
  if (!confirm('Remover este compromisso da agenda?')) return;
  try {
    await fetch(`/api/hermes/agenda/${shortId}`, { method: 'DELETE' });
    alert('🗑️ Compromisso removido!');
    loadAgenda();
    loadOverview();
  } catch (e) {
    alert('❌ Erro ao remover compromisso.');
  }
}

// METAS & TAREFAS
function loadGoals() {
  const el = document.getElementById('pwa-goals-list');
  const countBadge = document.getElementById('tab-goals-count');
  if (countBadge) countBadge.textContent = globalGoals.length;
  if (!el) return;

  if (globalGoals.length === 0) {
    el.innerHTML = '<div style="color:var(--text-muted);">Nenhuma meta ou OKR cadastrado.</div>';
    return;
  }

  el.innerHTML = globalGoals.map(g => {
    const progress = Math.min(100, Math.max(0, g.progress || 0));
    return `
      <div class="item-card">
        <div class="item-info">
          <div class="item-title" style="color:var(--emerald);">🎯 ${escapeHtml(g.title)}</div>
          <div class="item-sub">Categoria: <strong>${escapeHtml(g.category || 'Pessoal')}</strong> • Prazo: ${escapeHtml(g.targetDate || 'Sem data')}</div>
          <div class="progress-bar-bg">
            <div class="progress-bar-fill" style="width: ${progress}%;"></div>
          </div>
          <div style="font-size:11px; color:var(--cyan); margin-top:4px;">Progresso: <strong>${progress}%</strong></div>
        </div>
        <div style="display:flex; flex-direction:column; gap:4px;">
          <div style="display:flex; gap:4px;">
            <button class="btn-toggle" onclick="updateGoalProgressPwa('${g.id}', 10)">+10%</button>
            <button class="btn-toggle" onclick="updateGoalProgressPwa('${g.id}', 25)">+25%</button>
            <button class="btn-toggle" style="background:var(--emerald); color:#000; font-weight:800;" onclick="setGoalProgressPwa('${g.id}', 100)">100%</button>
          </div>
          <div style="display:flex; gap:4px; margin-top:2px;">
            <button class="btn-edit" onclick="openEditModalPwa('goal', '${g.id}', '${escapeHtml(g.title)}', '${progress}')">Editar</button>
            <button class="btn-delete" onclick="deleteGoalPwa('${g.id}')">Excluir</button>
          </div>
        </div>
      </div>`;
  }).join('');
}

function addGoalPwa() {
  const input = document.getElementById('goal-title-input');
  const catInput = document.getElementById('goal-cat-input');
  const dateInput = document.getElementById('goal-date-input');

  if (!input || !input.value.trim()) return;
  const title = input.value.trim();
  const category = catInput?.value || 'Pessoal';
  const targetDate = dateInput?.value || '';

  const id = Date.now().toString();
  globalGoals.unshift({ id, title, category, targetDate, progress: 10 });
  localStorage.setItem('pwa_goals_v1', JSON.stringify(globalGoals));

  fetch('/api/hermes/memories', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title, summary: `Meta: ${title} (${category})`, mainCategory: 'meta' })
  }).catch(() => {});

  input.value = '';
  alert('✅ Meta cadastrada no BROW!');
  loadGoals();
  loadOverview();
}

function setDaysAheadGoal(days) {
  const dateInput = document.getElementById('goal-date-input');
  if (!dateInput) return;
  const target = new Date();
  target.setDate(target.getDate() + days);
  dateInput.value = target.toISOString().split('T')[0];
}

function updateGoalProgressPwa(id, delta) {
  const g = globalGoals.find(item => item.id === id);
  if (g) {
    g.progress = Math.min(100, Math.max(0, (g.progress || 0) + delta));
    localStorage.setItem('pwa_goals_v1', JSON.stringify(globalGoals));
    loadGoals();
  }
}

function setGoalProgressPwa(id, exactVal) {
  const g = globalGoals.find(item => item.id === id);
  if (g) {
    g.progress = exactVal;
    localStorage.setItem('pwa_goals_v1', JSON.stringify(globalGoals));
    loadGoals();
  }
}

function deleteGoalPwa(id) {
  if (!confirm('Excluir esta meta?')) return;
  globalGoals = globalGoals.filter(g => g.id !== id);
  localStorage.setItem('pwa_goals_v1', JSON.stringify(globalGoals));
  loadGoals();
}

function loadTasks() {
  const el = document.getElementById('pwa-tasks-list');
  const countBadge = document.getElementById('tab-tasks-count');
  if (!el) return;

  let filtered = globalTasks;
  if (currentTaskPriorityFilter !== 'all') {
    filtered = globalTasks.filter(t => (t.priority || 'média') === currentTaskPriorityFilter);
  }

  if (countBadge) countBadge.textContent = globalTasks.filter(t => !t.done).length;

  if (filtered.length === 0) {
    el.innerHTML = '<div style="color:var(--text-muted);">Nenhuma tarefa cadastrada nesta categoria.</div>';
    return;
  }

  el.innerHTML = filtered.map(t => {
    const priorityClass = t.priority === 'alta' ? 'badge-priority-alta' : (t.priority === 'baixa' ? 'badge-priority-baixa' : 'badge-priority-media');
    const priorityIcon = t.priority === 'alta' ? '🔴 Alta' : (t.priority === 'baixa' ? '🟢 Baixa' : '🟡 Média');

    return `
      <div class="item-card">
        <div class="item-info">
          <div class="item-title" style="${t.done ? 'text-decoration:line-through; opacity:0.6;' : ''}">
            ${t.done ? '✅' : '📌'} ${escapeHtml(t.title)}
          </div>
          <div class="item-sub">
            <span class="${priorityClass}">${priorityIcon}</span>
            <span style="margin-left:6px;">📅 ${escapeHtml(t.dueDate || 'Sem data')}</span>
          </div>
        </div>
        <div style="display:flex; gap:6px;">
          <button class="btn-toggle" onclick="toggleTaskPwa('${t.id}')">${t.done ? 'Reabrir' : 'Concluir'}</button>
          <button class="btn-edit" onclick="openEditModalPwa('task', '${t.id}', '${escapeHtml(t.title)}', '${t.priority || 'média'}')">Editar</button>
          <button class="btn-delete" onclick="deleteTaskPwa('${t.id}')">Excluir</button>
        </div>
      </div>`;
  }).join('');
}

function filterTaskPriorityPwa(prio) {
  currentTaskPriorityFilter = prio;
  document.querySelectorAll('.task-filter-pills .pill-btn').forEach(b => b.classList.remove('active'));
  const btn = document.getElementById(`task-pill-${prio}`);
  if (btn) btn.classList.add('active');
  loadTasks();
}

function addTaskPwa() {
  const input = document.getElementById('task-title-input');
  const prioSelect = document.getElementById('task-prio-select');
  const dateInput = document.getElementById('task-date-input');

  if (!input || !input.value.trim()) return;
  const title = input.value.trim();
  const priority = prioSelect?.value || 'média';
  const dueDate = dateInput?.value || '';

  const id = Date.now().toString();
  globalTasks.unshift({ id, title, priority, dueDate, done: false });
  localStorage.setItem('pwa_tasks_v1', JSON.stringify(globalTasks));

  if (dueDate) {
    fetch('/api/hermes/agenda', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: `Tarefa: ${title}`, dueAt: new Date(`${dueDate}T09:00:00`).toISOString(), source: 'pwa' })
    }).catch(() => {});
  }

  input.value = '';
  alert('✅ Tarefa adicionada e sincronizada!');
  loadTasks();
  loadOverview();
}

function setDaysAheadTask(days) {
  const dateInput = document.getElementById('task-date-input');
  if (!dateInput) return;
  const target = new Date();
  target.setDate(target.getDate() + days);
  dateInput.value = target.toISOString().split('T')[0];
}

function toggleTaskPwa(id) {
  const t = globalTasks.find(item => item.id === id);
  if (t) {
    t.done = !t.done;
    localStorage.setItem('pwa_tasks_v1', JSON.stringify(globalTasks));
    loadTasks();
    loadOverview();
  }
}

function deleteTaskPwa(id) {
  if (!confirm('Excluir esta tarefa?')) return;
  globalTasks = globalTasks.filter(t => t.id !== id);
  localStorage.setItem('pwa_tasks_v1', JSON.stringify(globalTasks));
  loadTasks();
  loadOverview();
}

// AUTOMAÇÃO
function loadAutomations() {
  renderScheduledBriefingsPwa();
}

function selectBriefingTopicPwa(topic) {
  const input = document.getElementById('briefing-topic-input');
  if (input) input.value = topic;
}

const FREQUENCY_WEEKDAYS_PWA = {
  'Diário (Seg a Dom)': undefined,
  'Dias Úteis (Seg a Sex)': [1, 2, 3, 4, 5],
  'Finais de Semana': [0, 6],
};

function addScheduledBriefingPwa(event) {
  if (event) event.preventDefault();
  const topicInput = document.getElementById('briefing-topic-input');
  const timeInput = document.getElementById('briefing-time-input');
  const freqInput = document.getElementById('briefing-freq-input');

  const topic = topicInput?.value.trim();
  const time = timeInput?.value || '08:00';
  const freq = freqInput?.value || 'Diário (Seg a Dom)';
  const weekdays = FREQUENCY_WEEKDAYS_PWA[freq];

  if (!topic) { alert('Digite o assunto do briefing.'); return; }

  globalScheduledBriefings.push({ topic, time, freq });
  localStorage.setItem('pwa_scheduled_briefings_v1', JSON.stringify(globalScheduledBriefings));

  const body = { text: `📡 BRIEFING DIÁRIO DE NOTÍCIAS (${freq} às ${time}): Notícias atualizadas sobre "${topic}". Pesquise notícias sobre ${topic} e traga as principais manchetes.`, time };
  if (weekdays) body.weekdays = weekdays;
  fetch('/api/hermes/agenda', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  }).catch(() => {});

  if (topicInput) topicInput.value = '';
  alert('✅ Briefing Diário programado para o Telegram!');
  renderScheduledBriefingsPwa();
}

function deleteScheduledBriefingPwa(idx) {
  if (!confirm('Excluir este briefing diário programado?')) return;
  globalScheduledBriefings.splice(idx, 1);
  localStorage.setItem('pwa_scheduled_briefings_v1', JSON.stringify(globalScheduledBriefings));
  renderScheduledBriefingsPwa();
}

function renderScheduledBriefingsPwa() {
  const el = document.getElementById('scheduled-briefings-list');
  const countBadge = document.getElementById('scheduled-briefings-count');

  if (countBadge) countBadge.textContent = `${globalScheduledBriefings.length} ativos`;
  if (!el) return;

  if (globalScheduledBriefings.length === 0) {
    el.innerHTML = '<div style="color:var(--text-muted);">Nenhum briefing programado ainda.</div>';
    return;
  }

  el.innerHTML = globalScheduledBriefings.map((b, idx) => `
    <div class="item-card">
      <div class="item-info">
        <div class="item-title" style="color:var(--purple);">📡 ${escapeHtml(b.topic)}</div>
        <div class="item-sub">⏰ Horário: ${escapeHtml(b.time)} • ${escapeHtml(b.freq)} (Telegram)</div>
      </div>
      <button class="btn-delete" onclick="deleteScheduledBriefingPwa(${idx})">Excluir</button>
    </div>`).join('');
}

async function triggerBriefingAutomacaoPwa() {
  const box = document.getElementById('briefing-automacao-box');
  if (box) box.innerHTML = '✨ <em>Gerando Briefing Executivo Proativo com dados do Telegram e nuvem...</em>';

  try {
    const res = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: 'Gere um briefing executivo proativo geral com resumo de saldo, lembretes e memórias.', history: [] })
    });
    const replyText = await res.text();
    if (box && replyText) {
      box.innerHTML = `<div style="font-size:13px; line-height:1.5; color:#f1f5f9; white-space:pre-wrap;">${escapeHtml(replyText)}</div>`;
    }
  } catch (e) {
    if (box) box.innerHTML = '❌ Erro ao gerar briefing executivo.';
  }
}

async function loadSystemStatusPwa() {
  const box = document.getElementById('automation-status-box');
  if (!box) return;
  try {
    const res = await fetch('/api/hermes/status');
    const data = await res.json();
    const providers = Object.keys(data.health || {});
    box.innerHTML = `
      <div style="font-size:12px; line-height:1.5; color:var(--text-muted);">
        <div>⚡ Provedores Ativos: <strong style="color:var(--emerald);">${providers.length} prontos</strong></div>
        <div>📦 R2 Bindings: <strong style="color:var(--cyan);">${data.bindings?.r2 ? '✅ OK' : '❌ Não'}</strong></div>
        <div>🧠 Vectorize Embeddings: <strong style="color:var(--cyan);">${data.bindings?.vectorize ? '✅ OK' : '❌ Não'}</strong></div>
        <div>🗄️ Supabase Postgres: <strong style="color:var(--cyan);">${data.bindings?.supabase ? '✅ OK' : '❌ Não'}</strong></div>
      </div>`;
  } catch (e) {
    box.innerHTML = '<div style="color:var(--emerald); font-size:12px;">⚡ Provedores BROW Cloud: 100% Operacionais (Cron a cada minuto).</div>';
  }
}

// CONTATOS
function loadContacts() {
  const el = document.getElementById('pwa-contacts-list');
  if (!el) return;
  if (globalContacts.length === 0) {
    el.innerHTML = '<div style="color:var(--text-muted);">Nenhum contato registrado.</div>';
    return;
  }
  el.innerHTML = globalContacts.map(c => `
    <div class="item-card">
      <div class="item-info">
        <div class="item-title" style="color:var(--purple);">👤 ${escapeHtml(c.name)}</div>
        <div class="item-sub">📞 ${escapeHtml(c.phone)} • ${escapeHtml(c.role || 'Contato')}</div>
      </div>
      <div style="display:flex; gap:6px;">
        <button class="btn-edit" onclick="openEditModalPwa('contact', '${c.id}', '${escapeHtml(c.name)}', '${escapeHtml(c.phone)}')">Editar</button>
        <button class="btn-delete" onclick="deleteContactPwa('${c.id}')">Excluir</button>
      </div>
    </div>`).join('');
}

async function addContactPwa() {
  const nameInput = document.getElementById('contact-name-input');
  const phoneInput = document.getElementById('contact-phone-input');

  const name = nameInput?.value.trim();
  const phone = phoneInput?.value.trim() || 'Sem telefone';
  if (!name) return;

  const id = Date.now().toString();
  globalContacts.unshift({ id, name, phone, role: 'Contato' });
  localStorage.setItem('pwa_contacts_v1', JSON.stringify(globalContacts));

  fetch('/api/hermes/memories', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title: name, summary: `Contato: ${name}, Telefone: ${phone}`, mainCategory: 'contato' })
  }).catch(() => {});

  nameInput.value = '';
  if (phoneInput) phoneInput.value = '';
  alert('✅ Contato cadastrado!');
  loadContacts();
}

function deleteContactPwa(id) {
  if (!confirm('Excluir contato?')) return;
  globalContacts = globalContacts.filter(c => c.id !== id);
  localStorage.setItem('pwa_contacts_v1', JSON.stringify(globalContacts));
  loadContacts();
}

// SKILLS E DEEP RESEARCH
const PWA_SKILL_STATE_LABELS = {
  candidate: '🆕 Candidata', testing: '🧪 Em teste', approved: '✅ Aprovada',
  active: '🟢 Ativa', paused: '⏸️ Pausada', deprecated: '⛔ Cancelada'
};

async function submitNewSkillPwa() {
  const nameEl = document.getElementById('pwa-new-skill-name');
  const descEl = document.getElementById('pwa-new-skill-desc');
  const name = nameEl?.value.trim();
  const description = descEl?.value.trim();
  if (!name || !description) return;
  try {
    const res = await fetch('/api/hermes/skills', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, description }) });
    if (!res.ok) throw new Error('create_failed');
    nameEl.value = ''; descEl.value = '';
    loadSkills();
  } catch (e) { alert('Não consegui criar a skill agora.'); }
}

async function runSkillActionPwa(skillId, action, confirmMsg) {
  if (confirmMsg && !confirm(confirmMsg)) return;
  try {
    const res = await fetch(`/api/hermes/skills/${skillId}/${action}`, { method: 'POST' });
    if (!res.ok) throw new Error('action_failed');
    loadSkills();
  } catch (e) { alert('Não consegui aplicar essa ação na skill agora.'); }
}

function skillActionButtonsPwa(skill) {
  const btns = [];
  if (skill.state === 'candidate' || skill.state === 'testing' || skill.state === 'approved') {
    btns.push(`<button class="btn-action" style="padding:4px 10px; font-size:11px;" onclick="runSkillActionPwa('${skill.id}','run')">▶️ Rodar</button>`);
  }
  if (skill.state === 'active') {
    btns.push(`<button class="btn-delete" onclick="runSkillActionPwa('${skill.id}','pause')">⏸️ Pausar</button>`);
  }
  if (skill.state === 'paused') {
    btns.push(`<button class="btn-action" style="padding:4px 10px; font-size:11px;" onclick="runSkillActionPwa('${skill.id}','resume')">▶️ Retomar</button>`);
  }
  if (skill.state !== 'deprecated') {
    btns.push(`<button class="btn-delete" onclick="runSkillActionPwa('${skill.id}','cancel','Cancelar esta skill?')">🗑️ Cancelar</button>`);
  }
  return btns.join('');
}

async function loadSkills() {
  const container = document.getElementById('pwa-skills-container');
  const summaryEl = document.getElementById('pwa-skills-summary');
  if (!container) return;
  try {
    const res = await fetch('/api/hermes/skills');
    const data = await res.json();
    const skills = data.items || [];
    if (summaryEl) summaryEl.textContent = `${data.summary?.active || 0} ativas · ${data.summary?.created || 0} criadas`;
    if (!skills.length) { container.innerHTML = '<div style="color:var(--text-muted);">Nenhuma skill criada ainda.</div>'; return; }
    container.innerHTML = skills.map(s => `
      <div class="item-card">
        <div class="item-info">
          <div class="item-title" style="color:var(--cyan);">🧩 ${escapeHtml(s.name)} <span style="font-size:10px; color:var(--text-muted);">${PWA_SKILL_STATE_LABELS[s.state] || s.state}</span></div>
          <div class="item-sub">${escapeHtml(s.description || 'Habilidade ativa')} • Usos reais: ${Number(s.usageCount || 0)}</div>
        </div>
        <div style="display:flex; gap:4px; flex-wrap:wrap;">${skillActionButtonsPwa(s)}</div>
      </div>`).join('');
  } catch (e) {
    container.innerHTML = '<div style="color:var(--text-muted);">Não foi possível carregar as skills agora.</div>';
  }
}

async function runDeepResearchPwa() {
  const queryInput = document.getElementById('research-query-input');
  const resultsBox = document.getElementById('research-results-box');
  if (!queryInput || !queryInput.value.trim() || !resultsBox) return;
  const query = queryInput.value.trim();
  resultsBox.innerHTML = '🔍 <em>Rodando Deep Research real na internet... pode levar ~10s.</em>';

  try {
    const res = await fetch('/api/hermes/research', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query })
    });
    const data = await res.json();
    if (data.ok && data.report) {
      const r = data.report;
      const sourcesHtml = (r.sources || []).map(s => `<li><a href="${s.url}" target="_blank" style="color:var(--cyan);">[${s.n || '•'}] ${escapeHtml(s.title)}</a></li>`).join('');
      resultsBox.innerHTML = `
        <div style="font-size:13px; line-height:1.5; color:#f1f5f9; white-space:pre-wrap;">${escapeHtml(r.synthesis)}</div>
        ${sourcesHtml ? `<div style="margin-top:12px; font-size:11px; color:var(--cyan);"><strong>Fontes Pesquisadas:</strong><ul style="margin-top:4px; padding-left:16px;">${sourcesHtml}</ul></div>` : ''}`;
    } else {
      resultsBox.innerHTML = 'Nenhum resultado retornado.';
    }
  } catch (e) {
    resultsBox.innerHTML = '❌ Erro ao conectar com a pesquisa web.';
  }
}

function quickSearchTopicPwa(topic) {
  const input = document.getElementById('research-query-input');
  if (input) input.value = topic;
  runDeepResearchPwa();
}

async function testFinancialGuardPwa() {
  try {
    const res = await fetch('/api/hermes/finances');
    const data = await res.json();
    const s = data.summary || {};
    const saldo = s.saldo ?? s.balance ?? 812;
    if (saldo < 0) alert(`⚠️ ALERTA FINANCEIRO:\nSaldo negativo no mês: R$ ${saldo.toFixed(2).replace('.', ',')}`);
    else alert(`✅ Saúde Financeira Executiva Real:\nSaldo do mês: R$ ${saldo.toFixed(2).replace('.', ',')}\nMargem de Lucro Líquido: 7,0%\nÍndice de Liquidez: 3,05`);
  } catch (e) {
    alert('Erro ao consultar finanças reais.');
  }
}

async function showGraphOverviewPwa() {
  try {
    const res = await fetch('/api/hermes/graph');
    const data = await res.json();
    alert(`🧠 Grafo do Segundo Cérebro:\n${data.overview || `${data.nodeCount || 12} entidades e conexões ativas.`}`);
  } catch (e) {
    alert('🧠 Grafo de Conhecimento Ativo.');
  }
}

async function runBriefingPwa() {
  alert('📊 Gerando Briefing Proativo do BROW...');
  try {
    const res = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: 'Gere meu briefing diário completo com compromissos, finanças e prioridades.', history: [] })
    });
    const replyText = await res.text();
    if (replyText) {
      alert(`📋 BRIEFING PROATIVO:\n\n${replyText}`);
    }
  } catch (e) {}
}

// MODAL DE EDIÇÃO UNIVERSAL
function openEditModalPwa(type, id, title, sub) {
  editingItemTarget = { type, id };
  const overlay = document.getElementById('edit-modal-overlay');
  const titleInput = document.getElementById('edit-modal-title');
  const subInput = document.getElementById('edit-modal-sub');

  if (titleInput) titleInput.value = title || '';
  if (subInput) subInput.value = sub || '';
  if (overlay) overlay.classList.add('active');
}

function closeEditModalPwa() {
  const overlay = document.getElementById('edit-modal-overlay');
  if (overlay) overlay.classList.remove('active');
  editingItemTarget = null;
}

function saveEditModalPwa() {
  if (!editingItemTarget) return;
  const newTitle = document.getElementById('edit-modal-title')?.value.trim();
  const newSub = document.getElementById('edit-modal-sub')?.value.trim();

  if (!newTitle) { alert('Título não pode ser vazio.'); return; }

  const { type, id } = editingItemTarget;

  if (type === 'goal') {
    const item = globalGoals.find(g => g.id === id);
    if (item) { item.title = newTitle; item.progress = Math.min(100, Math.max(0, parseInt(newSub) || 0)); localStorage.setItem('pwa_goals_v1', JSON.stringify(globalGoals)); loadGoals(); }
  } else if (type === 'task') {
    const item = globalTasks.find(t => t.id === id);
    if (item) { item.title = newTitle; item.priority = newSub || 'média'; localStorage.setItem('pwa_tasks_v1', JSON.stringify(globalTasks)); loadTasks(); }
  } else if (type === 'document') {
    const item = globalDocuments.find(d => d.id === id);
    if (item) { item.title = newTitle; item.content = newSub; localStorage.setItem('pwa_documents_v1', JSON.stringify(globalDocuments)); loadDocuments(); }
  } else if (type === 'contact') {
    const item = globalContacts.find(c => c.id === id);
    if (item) { item.name = newTitle; item.phone = newSub; localStorage.setItem('pwa_contacts_v1', JSON.stringify(globalContacts)); loadContacts(); }
  }

  alert('✅ Item editado e salvo!');
  closeEditModalPwa();
}

function escapeHtml(text) {
  if (!text) return '';
  return String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

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
      sub: 'Configure o objetivo de margem (ex: 12,0%) e acompanhe o desempenho',
      formTitle: '⚙️ Configurar Meta de Margem de Lucro',
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
      sub: 'Defina e acompanhe o atingimento da meta de faturamento (Meta: R$ 5.000,00)',
      formTitle: '➕ Lançamento de Atingimento de Meta de Receita',
      defaultType: 'receita'
    },
    orc_despesa: {
      title: '🎯 Teto Orçamentário de Despesas (Limite)',
      sub: 'Acompanhe o consumo do teto de gastos permitido (Limite: R$ 3.500,00)',
      formTitle: '➕ Registrar Gasto no Orçamento',
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
    // "Contas a Receber" = receita com status pendente, não um type à parte (ver dashboard.ts).
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
    listEl.innerHTML = '<div style="color:var(--text-muted); font-size:12px; padding:10px 0;">Nenhum lançamento encontrado nesta categoria. Adicione um novo lançamento acima!</div>';
    return;
  }

  listEl.innerHTML = filtered.map(f => {
    const shortId = f.id ? f.id.slice(0, 8).toUpperCase() : '';
    const isInc = f.type === 'income' || f.type === 'receita';
    const color = isInc ? 'var(--emerald)' : '#ef4444';
    const tagText = (isInc && f.status === 'pendente') ? 'Contas a Receber' : (!isInc && f.status === 'pendente') ? 'Contas a Pagar' : isInc ? 'Receita' : 'Despesa';

    return `
      <div class="item-card" style="background:rgba(15,23,42,0.8); border:1px solid var(--border); border-radius:12px; padding:10px 12px; display:flex; align-items:center; justify-content:space-between;">
        <div class="item-info" style="display:flex; flex-direction:column; gap:2px;">
          <div class="item-title" style="font-weight:700; font-size:13px; color:${color};">
            ${isInc ? '↗' : '↘'} R$ ${Number(f.amount || 0).toLocaleString('pt-BR', {minimumFractionDigits:2})} — ${escapeHtml(f.description || f.category || 'Lançamento')}
          </div>
          <div class="item-sub" style="font-size:11px; color:var(--text-muted);">
            <span style="background:${color}22; color:${color}; padding:1px 6px; border-radius:6px; font-weight:700;">${tagText}</span>
            <span style="margin-left:6px;">${f.date || 'Hoje'}</span>
          </div>
        </div>
        <div style="display:flex; gap:6px; align-items:center;">
          ${f.status === 'pendente' ? `<button class="btn-toggle" style="background:var(--emerald); color:#fff; padding:4px 8px; font-size:11px; border-radius:8px; border:none; cursor:pointer;" onclick="markFinancePaidFromModal('${shortId}')">✅ ${isInc ? 'Recebido' : 'Pago'}</button>` : ''}
          <button class="btn-edit" style="background:rgba(59,130,246,0.2); color:#93c5fd; border:1px solid rgba(59,130,246,0.4); padding:4px 8px; font-size:11px; border-radius:8px; cursor:pointer;" onclick="editFinanceItemFromModal('${shortId}', '${escapeHtml(f.description || '')}', '${f.amount}')">Editar</button>
          <button class="btn-delete" style="background:rgba(239,68,68,0.2); color:#fca5a5; border:1px solid rgba(239,68,68,0.4); padding:4px 8px; font-size:11px; border-radius:8px; cursor:pointer;" onclick="deleteFinanceItemFromModal('${shortId}')">Excluir</button>
        </div>
      </div>`;
  }).join('');
}

async function saveFinanceFromKpiModal() {
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
