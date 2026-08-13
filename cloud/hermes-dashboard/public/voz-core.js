// HUD visual da aba "Cérebro Central" — layout portado de jarvis.html
// (D:\PROJETOS\AGENTES\DASHBOARD\jarvis.html, pedido do usuário 13/08/2026).
// Arquivo isolado de propósito: só desenha/anima; NENHUM dado aqui é
// inventado — tudo lido do estado real que app.js já mantém
// (pcTelemetry, isSpeakingOrListening, isRecording) e do <audio
// id="edge-tts-player"> real da HERMES. Se este arquivo falhar por
// qualquer motivo, o chat/telemetria/voz reais (em app.js) continuam
// funcionando normalmente — só a decoração visual para.
(function () {
  "use strict";

  const view = document.getElementById("view-voz");
  if (!view) return;

  const rand = (a, b) => Math.random() * (b - a) + a;
  const lerp = (a, b, t) => a + (b - a) * t;
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

  // ── RELÓGIO REAL ────────────────────────────────────────────
  const clockEl = document.getElementById("hud-clock");
  setInterval(() => {
    if (clockEl) clockEl.textContent = new Date().toLocaleTimeString("pt-BR");
  }, 1000);

  // ── ESQUEMA DE COR (cosmético, escopado só a #view-voz — não mexe
  // no tema do resto do dashboard) ────────────────────────────────
  const THEMES = {
    cyan: { primary: "#2dd4ff", secondary: "#a855f7" },
    red: { primary: "#ff3860", secondary: "#ffd700" },
    green: { primary: "#00ff9f", secondary: "#2dd4ff" },
    gold: { primary: "#ffd700", secondary: "#a855f7" },
    pink: { primary: "#ff00aa", secondary: "#2dd4ff" },
  };
  let activeTheme = THEMES.cyan;

  function applyTheme(name) {
    const t = THEMES[name];
    if (!t) return;
    activeTheme = t;
    view.style.setProperty("--cyan", t.primary);
    view.style.setProperty("--purple", t.secondary);
  }

  const themeToggle = document.getElementById("hud-theme-toggle");
  const themePanel = document.getElementById("hud-theme-panel");
  if (themeToggle && themePanel) {
    Object.keys(THEMES).forEach((name) => {
      const btn = document.createElement("button");
      btn.title = name;
      btn.style.cssText = `aspect-ratio:1; border-radius:4px; border:1px solid rgba(255,255,255,0.2); cursor:pointer; background:${THEMES[name].primary};`;
      btn.addEventListener("click", () => applyTheme(name));
      themePanel.appendChild(btn);
    });
    themeToggle.addEventListener("click", () => {
      const isHidden = themePanel.style.display === "none";
      themePanel.style.display = isHidden ? "grid" : "none";
    });
  }

  // ── FUNDO ESTRELADO (decorativo, não representa dado nenhum) ────
  const bgCanvas = document.getElementById("hud-bg-canvas");
  const bgCtx = bgCanvas ? bgCanvas.getContext("2d") : null;
  const stars = Array.from({ length: 40 }, () => ({
    x: rand(0, 1), y: rand(0, 1), r: rand(0.4, 1.6), alpha: rand(0.08, 0.4), pulse: rand(0, Math.PI * 2),
  }));

  function resizeBg() {
    if (!bgCanvas) return;
    const rect = bgCanvas.parentElement.getBoundingClientRect();
    bgCanvas.width = rect.width;
    bgCanvas.height = rect.height;
  }
  window.addEventListener("resize", resizeBg);

  function drawBg(t) {
    if (!bgCtx || !bgCanvas.width) return;
    bgCtx.clearRect(0, 0, bgCanvas.width, bgCanvas.height);
    stars.forEach((s) => {
      const a = s.alpha + Math.sin(t * 0.0015 + s.pulse) * 0.1;
      bgCtx.beginPath();
      bgCtx.arc(s.x * bgCanvas.width, s.y * bgCanvas.height, s.r, 0, Math.PI * 2);
      bgCtx.fillStyle = `rgba(45,212,255,${Math.max(0, a)})`;
      bgCtx.fill();
    });
  }

  // ── TELEMETRIA: lê pcTelemetry (já real, atualizado por
  // pollRealTelemetryAgent em app.js a cada 3s) — só desenha. ──────
  function renderHudTelemetry() {
    if (typeof pcTelemetry === "undefined") return;
    const cpu = isNaN(pcTelemetry.cpuLoadEst) ? 0 : clamp(pcTelemetry.cpuLoadEst, 0, 100);
    const ram = isNaN(pcTelemetry.ramPercent) ? 0 : clamp(pcTelemetry.ramPercent, 0, 100);
    const gpu = isNaN(pcTelemetry.gpuLoadEst) ? 0 : clamp(pcTelemetry.gpuLoadEst, 0, 100);
    const hasDisk = typeof pcTelemetry.diskPercent === "number" && !isNaN(pcTelemetry.diskPercent);
    const disk = hasDisk ? clamp(pcTelemetry.diskPercent, 0, 100) : 0;

    const set = (barId, txtId, val, label) => {
      const bar = document.getElementById(barId);
      const txt = document.getElementById(txtId);
      if (bar) bar.style.width = val + "%";
      if (txt) txt.textContent = label;
    };
    set("hud-cpu-bar", "hud-cpu-txt", cpu, Math.round(cpu) + "%");
    set("hud-ram-bar", "hud-ram-txt", ram, Math.round(ram) + "%");
    set("hud-gpu-bar", "hud-gpu-txt", gpu, Math.round(gpu) + "%");
    set("hud-disk-bar", "hud-disk-txt", disk, hasDisk ? Math.round(disk) + "%" : "--%");

    const procList = document.getElementById("hud-process-list");
    if (procList) {
      const procs = Array.isArray(pcTelemetry.topProcesses) ? pcTelemetry.topProcesses.slice(0, 5) : [];
      if (!procs.length) {
        procList.innerHTML = '<div style="color:var(--text-muted);">Aguardando agente local (tools/pc_telemetry_reporter.py)...</div>';
      } else {
        procList.innerHTML = procs
          .map((p) => {
            const name = (p.name || "?").toString().slice(0, 20);
            const pct = Math.round(p.cpuPercent ?? p.ramPercent ?? 0);
            return `<div style="display:flex; justify-content:space-between; background:rgba(45,212,255,0.03); border:1px dashed rgba(45,212,255,0.1); padding:3px 6px; border-radius:3px;"><span>${name}</span><span style="color:var(--cyan);">${pct}%</span></div>`;
          })
          .join("");
      }
    }
  }
  setInterval(renderHudTelemetry, 1000);

  // ── NÚCLEO CENTRAL: esfera animada em canvas, reage ao estado
  // REAL de voz (isSpeakingOrListening / isRecording já existem em
  // app.js) e ao nível de áudio REAL — mic real durante escuta,
  // análise do próprio <audio id="edge-tts-player"> durante fala. ──
  const coreCanvas = document.getElementById("hud-core-canvas");
  const coreCtx = coreCanvas ? coreCanvas.getContext("2d") : null;

  let micAnalyser = null;
  let micDataArray = null;
  let ttsAnalyser = null;
  let ttsDataArray = null;
  let audioCtx = null;

  // Precisa de gesto do usuário pra criar/retomar AudioContext (política
  // de autoplay do navegador) — chamado no clique do núcleo e no envio
  // de mensagem, que já são gestos reais do usuário.
  function ensureAudioGraph() {
    if (audioCtx) {
      if (audioCtx.state === "suspended") audioCtx.resume();
      return;
    }
    try {
      audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      const player = document.getElementById("edge-tts-player");
      if (player && !player.dataset.hudAnalyserBound) {
        player.dataset.hudAnalyserBound = "true";
        const src = audioCtx.createMediaElementSource(player);
        ttsAnalyser = audioCtx.createAnalyser();
        ttsAnalyser.fftSize = 64;
        src.connect(ttsAnalyser);
        ttsAnalyser.connect(audioCtx.destination); // mantém o áudio audível
        ttsDataArray = new Uint8Array(ttsAnalyser.frequencyBinCount);
      }
    } catch (e) {
      console.warn("HUD: não foi possível montar análise de áudio real.", e);
    }
  }

  async function ensureMicAnalyser() {
    if (micAnalyser) return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const ctx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
      audioCtx = ctx;
      micAnalyser = ctx.createAnalyser();
      micAnalyser.fftSize = 64;
      const src = ctx.createMediaStreamSource(stream);
      src.connect(micAnalyser);
      micDataArray = new Uint8Array(micAnalyser.frequencyBinCount);
    } catch (e) {
      // Sem microfone acessível — núcleo usa nível estimado em vez de real
      // quando estiver "ouvindo" (raro: só acontece se o usuário negar
      // permissão depois de já ter clicado no mic real do app.js).
    }
  }

  if (coreCanvas) {
    coreCanvas.addEventListener("click", () => {
      ensureAudioGraph();
      ensureMicAnalyser();
      if (typeof toggleVoiceInput === "function") toggleVoiceInput();
    });
  }

  // ── REAÇÃO A DIGITAÇÃO E MOUSE (pedido do usuário 13/08/2026) ───
  // Sem dado real por trás disso (é reação de UI, não telemetria) — só
  // faz o núcleo "vivo" ao passar o mouse ou digitar, como no jarvis.html.
  let typingBoost = 0;
  let hoverBoost = 0;

  const chatInputEl = document.getElementById("voice-chat-input");
  if (chatInputEl) {
    chatInputEl.addEventListener("input", () => {
      typingBoost = Math.min(1.2, typingBoost + 0.3);
    });
  }

  if (coreCanvas) {
    coreCanvas.addEventListener("mouseenter", () => { hoverBoost = 1; });
    coreCanvas.addEventListener("mouseleave", () => { hoverBoost = 0; });
    coreCanvas.addEventListener("mousemove", () => { hoverBoost = 1; });
  }

  let smoothLevel = 0.06;
  const spherePoints = [];
  for (let lat = 0; lat < 8; lat++) {
    const phi = (lat / 7) * Math.PI;
    for (let lon = 0; lon < 14; lon++) {
      const theta = (lon / 14) * Math.PI * 2;
      spherePoints.push({ x: Math.sin(phi) * Math.cos(theta), y: Math.sin(phi) * Math.sin(theta), z: Math.cos(phi) });
    }
  }
  let sphereAngleX = 0;
  let sphereAngleY = 0;

  function currentAudioLevel() {
    const speaking = typeof isSpeakingOrListening !== "undefined" && isSpeakingOrListening;
    const listening = typeof isRecording !== "undefined" && isRecording;
    const player = document.getElementById("edge-tts-player");
    const trulySpeaking = speaking && player && !player.paused;

    if (listening && micAnalyser) {
      micAnalyser.getByteFrequencyData(micDataArray);
      let sum = 0;
      for (let i = 0; i < 12; i++) sum += micDataArray[i] || 0;
      return { level: (sum / 12 / 255) * 2.2, listening: true, speaking: false };
    }
    if (trulySpeaking && ttsAnalyser) {
      ttsAnalyser.getByteFrequencyData(ttsDataArray);
      let sum = 0;
      for (let i = 0; i < 12; i++) sum += ttsDataArray[i] || 0;
      return { level: (sum / 12 / 255) * 2.2, listening: false, speaking: true };
    }
    if (listening) return { level: 0.35 + Math.abs(Math.sin(Date.now() * 0.006)) * 0.4, listening: true, speaking: false };
    if (trulySpeaking) return { level: 0.25 + Math.abs(Math.sin(Date.now() * 0.01)) * 0.35, listening: false, speaking: true };
    return { level: 0.05, listening: false, speaking: false };
  }

  function drawCore(t) {
    if (!coreCtx) return;
    const w = coreCanvas.width;
    const h = coreCanvas.height;
    const cx = w / 2;
    const cy = h / 2;
    coreCtx.clearRect(0, 0, w, h);

    typingBoost = Math.max(0, typingBoost - 0.02);

    const { level, listening, speaking } = currentAudioLevel();
    const reactiveLevel = Math.max(level, typingBoost * 0.5, hoverBoost * 0.18);
    smoothLevel = lerp(smoothLevel, reactiveLevel, 0.18);

    const titleEl = document.getElementById("voice-transcript-title");
    const stateColors = listening ? "#ef4444" : speaking ? activeTheme.primary : activeTheme.primary;
    if (titleEl && !titleEl.dataset.userSet) titleEl.style.color = stateColors;

    const baseRadius = 82 + smoothLevel * 22;
    const wavePoints = 90;

    coreCtx.beginPath();
    for (let i = 0; i <= wavePoints; i++) {
      const a = (i / wavePoints) * Math.PI * 2;
      const amp = (listening || speaking ? 26 : 6) * smoothLevel;
      const noise = Math.sin(a * 2 - t * 0.002) * amp + Math.cos(a * 3 + t * 0.001) * amp * 0.6;
      const r = baseRadius + noise;
      const px = cx + Math.cos(a) * r;
      const py = cy + Math.sin(a) * r;
      i === 0 ? coreCtx.moveTo(px, py) : coreCtx.lineTo(px, py);
    }
    coreCtx.closePath();

    const grd = coreCtx.createRadialGradient(cx, cy, 15, cx, cy, baseRadius + 10);
    grd.addColorStop(0, "#01070e");
    grd.addColorStop(0.55, activeTheme.secondary + "55");
    grd.addColorStop(0.85, activeTheme.primary);
    grd.addColorStop(1, "transparent");
    coreCtx.fillStyle = grd;
    coreCtx.shadowColor = activeTheme.primary;
    coreCtx.shadowBlur = 24;
    coreCtx.fill();
    coreCtx.shadowBlur = 0;

    // Anel wireframe
    coreCtx.beginPath();
    coreCtx.arc(cx, cy, baseRadius * 0.7, 0, Math.PI * 2);
    coreCtx.strokeStyle = "rgba(255,255,255,0.15)";
    coreCtx.lineWidth = 0.8;
    coreCtx.stroke();

    // Retículo interno 3D
    sphereAngleX += 0.005;
    sphereAngleY += 0.008 + (listening || speaking ? smoothLevel * 0.02 : 0);
    const cosX = Math.cos(sphereAngleX), sinX = Math.sin(sphereAngleX);
    const cosY = Math.cos(sphereAngleY), sinY = Math.sin(sphereAngleY);
    const dynRadius = 34 + (listening || speaking ? smoothLevel * 10 : 0);
    spherePoints.forEach((p) => {
      const x1 = p.x * cosY - p.z * sinY;
      const z1 = p.x * sinY + p.z * cosY;
      const y2 = p.y * cosX - z1 * sinX;
      const z2 = p.y * sinX + z1 * cosX;
      const scale = 160 / (160 + z2 * dynRadius);
      const sx = cx + x1 * dynRadius * scale;
      const sy = cy + y2 * dynRadius * scale;
      coreCtx.beginPath();
      coreCtx.arc(sx, sy, 1, 0, Math.PI * 2);
      coreCtx.fillStyle = "rgba(255,255,255,0.4)";
      coreCtx.fill();
    });

    // Osciloscópio circular ao redor do núcleo
    coreCtx.beginPath();
    coreCtx.lineWidth = 1;
    coreCtx.strokeStyle = activeTheme.primary + "99";
    const oscR = baseRadius + 30;
    for (let i = 0; i <= 120; i++) {
      const a = (i / 120) * Math.PI * 2;
      const wobble = Math.sin(a * 20 - t * 0.007) * 6 * smoothLevel;
      const r = oscR + wobble;
      const px = cx + Math.cos(a) * r;
      const py = cy + Math.sin(a) * r;
      i === 0 ? coreCtx.moveTo(px, py) : coreCtx.lineTo(px, py);
    }
    coreCtx.closePath();
    coreCtx.stroke();
  }

  function resizeCore() {
    if (!coreCanvas) return;
    const size = Math.min(coreCanvas.parentElement.clientWidth, coreCanvas.parentElement.clientHeight, 360);
    coreCanvas.width = size;
    coreCanvas.height = size;
  }
  window.addEventListener("resize", resizeCore);

  // ── LOOP ──────────────────────────────────────────────────
  function loop(t) {
    requestAnimationFrame(loop);
    if (!document.getElementById("view-voz")?.classList.contains("active")) return;
    drawBg(t);
    drawCore(t);
  }

  function boot() {
    resizeBg();
    resizeCore();
    renderHudTelemetry();
    applyTheme("cyan");
    requestAnimationFrame(loop);
  }

  // Ativa o áudio real (analyser da TTS) no primeiro clique/envio de
  // mensagem do usuário — obrigatório pra política de autoplay.
  document.addEventListener("click", ensureAudioGraph, { once: true });

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
