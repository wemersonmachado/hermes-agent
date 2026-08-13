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

  function lerpHex(c1, c2, factor) {
    const p1 = parseInt(c1.slice(1), 16);
    const p2 = parseInt(c2.slice(1), 16);
    const r = Math.round(((p1 >> 16) & 255) + (((p2 >> 16) & 255) - ((p1 >> 16) & 255)) * factor);
    const g = Math.round(((p1 >> 8) & 255) + (((p2 >> 8) & 255) - ((p1 >> 8) & 255)) * factor);
    const b = Math.round((p1 & 255) + ((p2 & 255) - (p1 & 255)) * factor);
    return `#${((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1)}`;
  }

  // "Sente a temperatura" real da telemetria — quanto mais perto do
  // limiar de sobrecarga (mesmo PC_OVERLOAD_THRESHOLDS de app.js: CPU 88%,
  // RAM 92%), mais o núcleo pulsa e esquenta de cor. Só com dado REAL
  // fresco (isRealTelemetryFresh) — sem agente local, fica neutro.
  function currentHeatFactor() {
    if (typeof pcTelemetry === "undefined" || typeof isRealTelemetryFresh !== "function" || !isRealTelemetryFresh()) return 0;
    const cpu = isNaN(pcTelemetry.cpuLoadEst) ? 0 : pcTelemetry.cpuLoadEst;
    const ram = isNaN(pcTelemetry.ramPercent) ? 0 : pcTelemetry.ramPercent;
    const cpuHeat = clamp((cpu - 60) / (95 - 60), 0, 1);
    const ramHeat = clamp((ram - 70) / (95 - 70), 0, 1);
    return Math.max(cpuHeat, ramHeat);
  }

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
    // Sem o agente local do PC, CPU/RAM/GPU só têm a estimativa do
    // NAVEGADOR de quem está olhando (heap/WebGL) -- em celular isso é
    // 100% sem relação com o PC real. Achado ao vivo 13/08/2026: barra
    // mostrando "99% CPU" estimado do celular, enganoso. Mesmo padrão
    // honesto que o Disco C já usava: sem dado real, mostra "--%".
    const realFresh = typeof isRealTelemetryFresh === "function" && isRealTelemetryFresh();
    const cpu = realFresh && !isNaN(pcTelemetry.cpuLoadEst) ? clamp(pcTelemetry.cpuLoadEst, 0, 100) : null;
    const ram = realFresh && !isNaN(pcTelemetry.ramPercent) ? clamp(pcTelemetry.ramPercent, 0, 100) : null;
    const gpu = realFresh && !isNaN(pcTelemetry.gpuLoadEst) ? clamp(pcTelemetry.gpuLoadEst, 0, 100) : null;
    const hasDisk = realFresh && typeof pcTelemetry.diskPercent === "number" && !isNaN(pcTelemetry.diskPercent);
    const disk = hasDisk ? clamp(pcTelemetry.diskPercent, 0, 100) : 0;

    const set = (barId, txtId, val) => {
      const bar = document.getElementById(barId);
      const txt = document.getElementById(txtId);
      if (bar) bar.style.width = (val ?? 0) + "%";
      if (txt) txt.textContent = val == null ? "--%" : Math.round(val) + "%";
    };
    set("hud-cpu-bar", "hud-cpu-txt", cpu);
    set("hud-ram-bar", "hud-ram-txt", ram);
    set("hud-gpu-bar", "hud-gpu-txt", gpu);
    set("hud-disk-bar", "hud-disk-txt", hasDisk ? disk : null);

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
  let smoothHeat = 0;

  // ── PARTÍCULAS SUTIS DO NÚCLEO (só 12 pontos para evitar poluição visual) ──
  const orbitParticles = Array.from({ length: 12 }, () => ({
    angle: rand(0, Math.PI * 2),
    radiusOffset: rand(-12, 12),
    speed: rand(0.004, 0.012) * (Math.random() < 0.5 ? 1 : -1),
    size: rand(0.8, 1.6),
    alpha: rand(0.2, 0.6),
    pulsePhase: rand(0, Math.PI * 2),
  }));

  const spherePoints = [];
  for (let lat = 0; lat < 9; lat++) {
    const phi = (lat / 8) * Math.PI;
    for (let lon = 0; lon < 15; lon++) {
      const theta = (lon / 15) * Math.PI * 2;
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
      return { level: (sum / 12 / 255) * 2.4, listening: true, speaking: false };
    }
    if (trulySpeaking && ttsAnalyser) {
      ttsAnalyser.getByteFrequencyData(ttsDataArray);
      let sum = 0;
      for (let i = 0; i < 12; i++) sum += ttsDataArray[i] || 0;
      return { level: (sum / 12 / 255) * 2.4, listening: false, speaking: true };
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
    const heat = currentHeatFactor();

    // Transição ultra suave para o fator de aquecimento da telemetria real do PC
    smoothHeat = lerp(smoothHeat, heat, 0.04);

    // Resposta mais rápida/expressiva ao áudio real (ataque rápido 0.35, queda suave 0.14)
    const reactiveLevel = Math.max(level, typingBoost * 0.5, hoverBoost * 0.18, smoothHeat * 0.4);
    const lerpSpeed = reactiveLevel > smoothLevel ? 0.35 : 0.14;
    smoothLevel = lerp(smoothLevel, reactiveLevel, lerpSpeed);

    const heatColor = lerpHex(activeTheme.primary, "#ff4d2e", smoothHeat);
    const heatSecondary = lerpHex(activeTheme.secondary, "#ff8a00", smoothHeat);

    const titleEl = document.getElementById("voice-transcript-title");
    const stateColors = listening ? "#ef4444" : smoothHeat > 0.5 ? heatColor : activeTheme.primary;
    if (titleEl && !titleEl.dataset.userSet) titleEl.style.color = stateColors;

    // Pequena respiração contínua em repouso
    const idleBreath = Math.sin(t * 0.0022) * 4.5;
    const baseRadius = 82 + smoothLevel * 26 + idleBreath;
    const wavePoints = 90;

    // ── ARCOS NEURAIS EM FORMA DE ONDAS (3 ONDAS CONCÊNTRICAS EXTERNAS) ──
    const arcRadii = [
      { r: baseRadius + 18, speed: 0.002, amp: 5, alpha: 0.45, dash: [6, 4] },
      { r: baseRadius + 38, speed: -0.0015, amp: 8, alpha: 0.35, dash: [] },
      { r: baseRadius + 60, speed: 0.0012, amp: 11, alpha: 0.25, dash: [12, 6] },
      { r: baseRadius + 84, speed: -0.001, amp: 14, alpha: 0.15, dash: [] },
    ];

    arcRadii.forEach((arc, idx) => {
      coreCtx.save();
      coreCtx.beginPath();
      if (arc.dash.length) coreCtx.setLineDash(arc.dash);
      const arcPoints = 100;
      for (let i = 0; i <= arcPoints; i++) {
        const a = (i / arcPoints) * Math.PI * 2;
        const wave = Math.sin(a * (4 + idx) + t * arc.speed) * (arc.amp * (smoothLevel + 0.3));
        const r = arc.r + wave;
        const px = cx + Math.cos(a) * r;
        const py = cy + Math.sin(a) * r;
        i === 0 ? coreCtx.moveTo(px, py) : coreCtx.lineTo(px, py);
      }
      coreCtx.closePath();
      coreCtx.strokeStyle = idx % 2 === 0 ? heatColor : heatSecondary;
      coreCtx.globalAlpha = arc.alpha + smoothLevel * 0.25;
      coreCtx.lineWidth = 1 + (smoothLevel * 1.2);
      coreCtx.stroke();
      coreCtx.restore();
    });

    // Forma fluida do Núcleo Principal
    coreCtx.beginPath();
    for (let i = 0; i <= wavePoints; i++) {
      const a = (i / wavePoints) * Math.PI * 2;
      const amp = (listening || speaking ? 28 : 7) * (smoothLevel + 0.14);
      const noise = Math.sin(a * 2 - t * 0.0025) * amp + Math.cos(a * 3 + t * 0.0012) * amp * 0.6;
      const r = baseRadius + noise;
      const px = cx + Math.cos(a) * r;
      const py = cy + Math.sin(a) * r;
      i === 0 ? coreCtx.moveTo(px, py) : coreCtx.lineTo(px, py);
    }
    coreCtx.closePath();

    const grd = coreCtx.createRadialGradient(cx, cy, 12, cx, cy, baseRadius + 14);
    grd.addColorStop(0, "#01070e");
    grd.addColorStop(0.5, heatSecondary + "66");
    grd.addColorStop(0.82, heatColor);
    grd.addColorStop(1, "transparent");
    coreCtx.fillStyle = grd;
    coreCtx.shadowColor = heatColor;
    coreCtx.shadowBlur = 24 + smoothHeat * 16 + smoothLevel * 18;
    coreCtx.fill();
    coreCtx.shadowBlur = 0;

    // Anel wireframe
    coreCtx.beginPath();
    coreCtx.arc(cx, cy, baseRadius * 0.72, 0, Math.PI * 2);
    coreCtx.strokeStyle = `rgba(255,255,255,${0.12 + smoothLevel * 0.25})`;
    coreCtx.lineWidth = 0.9;
    coreCtx.stroke();

    // Partículas sutis no centro do núcleo (apenas 12)
    orbitParticles.forEach((p) => {
      p.angle += p.speed * (1 + smoothLevel * 1.5);
      const pR = (baseRadius * 0.4) + p.radiusOffset;
      const px = cx + Math.cos(p.angle) * pR;
      const py = cy + Math.sin(p.angle) * pR;
      const alpha = clamp(p.alpha + Math.sin(t * 0.002 + p.pulsePhase) * 0.15, 0.1, 0.7);

      coreCtx.beginPath();
      coreCtx.arc(px, py, p.size, 0, Math.PI * 2);
      coreCtx.fillStyle = "#ffffff";
      coreCtx.globalAlpha = alpha;
      coreCtx.fill();
      coreCtx.globalAlpha = 1.0;
    });

    // Retículo interno 3D
    sphereAngleX += 0.005;
    sphereAngleY += 0.008 + (listening || speaking ? smoothLevel * 0.03 : 0);
    const cosX = Math.cos(sphereAngleX), sinX = Math.sin(sphereAngleX);
    const cosY = Math.cos(sphereAngleY), sinY = Math.sin(sphereAngleY);
    const dynRadius = 34 + (listening || speaking ? smoothLevel * 14 : idleBreath * 0.5);
    spherePoints.forEach((p) => {
      const x1 = p.x * cosY - p.z * sinY;
      const z1 = p.x * sinY + p.z * cosY;
      const y2 = p.y * cosX - z1 * sinX;
      const z2 = p.y * sinX + z1 * cosX;
      const scale = 160 / (160 + z2 * dynRadius);
      const sx = cx + x1 * dynRadius * scale;
      const sy = cy + y2 * dynRadius * scale;
      const ptAlpha = clamp(0.3 + (z2 + 1) * 0.3 + smoothLevel * 0.4, 0.15, 0.95);

      coreCtx.beginPath();
      coreCtx.arc(sx, sy, 1.2 * scale, 0, Math.PI * 2);
      coreCtx.fillStyle = `rgba(255,255,255,${ptAlpha})`;
      coreCtx.fill();
    });

    // Osciloscópio circular ao redor do núcleo
    coreCtx.beginPath();
    coreCtx.lineWidth = 1.2;
    coreCtx.strokeStyle = heatColor + "bb";
    const oscR = baseRadius + 32;
    for (let i = 0; i <= 120; i++) {
      const a = (i / 120) * Math.PI * 2;
      const wobble = Math.sin(a * 20 - t * 0.007) * (6 * smoothLevel + 1.5);
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
