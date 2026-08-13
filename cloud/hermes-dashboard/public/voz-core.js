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

  // ── COGNITIVE NEURAL CORE (Portado 1:1 de Nucleo Neural.html) ──
  const PI = Math.PI;
  const sin = Math.sin;
  const cos = Math.cos;

  const PARTICLE_COUNT = 3200;
  const particles = [];
  let baseRadius = 70;
  let ringWidth = 35;

  function hexToRgb(hex) {
    const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    return result ? {
      r: parseInt(result[1], 16),
      g: parseInt(result[2], 16),
      b: parseInt(result[3], 16)
    } : { r: 0, g: 245, b: 255 };
  }

  class Particle {
    constructor() {
      this.reset();
      this.theta = rand(0, PI * 2);
    }

    reset() {
      this.theta = 0.0;
      this.speed = rand(0.0018, 0.0045);
      this.tFactor = Math.pow(Math.random(), 1.6);
      this.radMultiplier = rand(0.8, 1.4);
      this.waveFreq1 = rand(4, 8);
      this.waveFreq2 = rand(10, 16);
      this.waveAmp1 = rand(8, 18);
      this.waveAmp2 = rand(3, 7);
      this.wavePhase = rand(0, PI * 2);
      this.type = Math.random() < 0.76 ? 'primary' : 'secondary';
      this.size = rand(0.6, 2.2);
      this.baseAlpha = rand(0.18, 0.85);
    }

    update(t, smoothTyping, smoothSpeak) {
      const activeSpeed = this.speed * (1.0 + smoothTyping * 1.5 + smoothSpeak * 0.5);
      this.theta += activeSpeed;
      if (this.theta > PI * 2) this.theta -= PI * 2;
    }
  }

  for (let i = 0; i < PARTICLE_COUNT; i++) {
    particles.push(new Particle());
  }

  let isSpeaking = false;
  let speakVolume = 0.0;
  let isListening = false;
  let listenVolume = 0.0;

  let smoothSpeakVolume = 0.0;
  let smoothListenVolume = 0.0;
  let smoothTypingBoost = 0.0;

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

    const { level, listening, speaking } = currentAudioLevel();
    const heat = currentHeatFactor();
    smoothHeat = lerp(smoothHeat, heat, 0.04);

    isSpeaking = speaking;
    speakVolume = level;
    isListening = listening;
    listenVolume = level;

    smoothSpeakVolume = lerp(smoothSpeakVolume, isSpeaking ? speakVolume : 0.0, 0.12);
    smoothListenVolume = lerp(smoothListenVolume, isListening ? listenVolume : 0.0, 0.12);
    smoothTypingBoost = lerp(smoothTypingBoost, typingBoost, 0.1);
    typingBoost = Math.max(0, typingBoost - 0.015);

    const minDim = Math.min(w, h);
    baseRadius = Math.max(minDim * 0.24, 45);
    ringWidth = Math.max(baseRadius * 0.45, 20);

    const themeRGB = hexToRgb(activeTheme.primary);
    const themeRGBSec = hexToRgb(activeTheme.secondary);

    const glowGrad = coreCtx.createRadialGradient(cx, cy, baseRadius * 0.65, cx, cy, baseRadius + ringWidth * 1.2);
    glowGrad.addColorStop(0, `rgba(${themeRGB.r}, ${themeRGB.g}, ${themeRGB.b}, 0.0)`);
    glowGrad.addColorStop(0.5, `rgba(${themeRGB.r}, ${themeRGB.g}, ${themeRGB.b}, ${0.06 + smoothSpeakVolume * 0.08})`);
    glowGrad.addColorStop(1, `rgba(${themeRGB.r}, ${themeRGB.g}, ${themeRGB.b}, 0.0)`);
    coreCtx.fillStyle = glowGrad;
    coreCtx.beginPath();
    coreCtx.arc(cx, cy, baseRadius + ringWidth * 1.5, 0, PI * 2);
    coreCtx.fill();

    const opacityBuckets = [0.15, 0.35, 0.55, 0.75, 0.95];
    const buckets = {
      primary: opacityBuckets.map(() => []),
      secondary: opacityBuckets.map(() => [])
    };

    for (let i = 0; i < PARTICLE_COUNT; i++) {
      const p = particles[i];
      p.update(t, smoothTypingBoost, smoothSpeakVolume);

      const pBaseRad = baseRadius + (p.tFactor * ringWidth * p.radMultiplier) - (ringWidth * 0.3);
      const speakWaveScale = 1.0 + smoothSpeakVolume * 2.2;
      const wave1 = sin(p.theta * p.waveFreq1 - t * 0.0028 + p.wavePhase) * p.waveAmp1 * speakWaveScale;
      const wave2 = cos(p.theta * p.waveFreq2 + t * 0.0045) * p.waveAmp2 * speakWaveScale;

      let r = pBaseRad + wave1 + wave2;

      if (smoothListenVolume > 0.02) {
        const listenWave = sin(p.theta * 22.0 - t * 0.015) * (smoothListenVolume * 38.0);
        r += listenWave;
      }
      if (smoothTypingBoost > 0.02) {
        r += rand(-5.5, 5.5) * smoothTypingBoost;
      }

      const x = cx + cos(p.theta) * r;
      const y = cy + sin(p.theta) * r;

      const radialFade = clamp((baseRadius + ringWidth * 1.2 - r) / (ringWidth * 0.8), 0.1, 1.0);
      let alpha = p.baseAlpha * radialFade * (1.0 + smoothTypingBoost * 0.3);
      alpha = clamp(alpha, 0.05, 0.98);

      let bucketIdx = 0;
      let minDiff = 999;
      for (let b = 0; b < opacityBuckets.length; b++) {
        const diff = Math.abs(alpha - opacityBuckets[b]);
        if (diff < minDiff) {
          minDiff = diff;
          bucketIdx = b;
        }
      }

      buckets[p.type][bucketIdx].push({ x, y, size: p.size });
    }

    const colorsDef = {
      primary: opacityBuckets.map(a => `rgba(${themeRGB.r}, ${themeRGB.g}, ${themeRGB.b}, ${a})`),
      secondary: opacityBuckets.map(a => `rgba(${themeRGBSec.r}, ${themeRGBSec.g}, ${themeRGBSec.b}, ${a})`)
    };

    ['primary', 'secondary'].forEach(type => {
      for (let b = 0; b < opacityBuckets.length; b++) {
        const points = buckets[type][b];
        if (points.length === 0) continue;

        coreCtx.beginPath();
        coreCtx.fillStyle = colorsDef[type][b];
        const count = points.length;
        for (let i = 0; i < count; i++) {
          const pt = points[i];
          coreCtx.moveTo(pt.x + pt.size, pt.y);
          coreCtx.arc(pt.x, pt.y, pt.size, 0, PI * 2);
        }
        coreCtx.fill();
      }
    });
  }

  // Global Javascript API p/ integracao externa (Nucleo Neural.html API)
  window.BrowCore = {
    setSpeaking: function(active, volume) {
      isSpeaking = !!active;
      speakVolume = clamp(volume || 0.5, 0, 1);
    },
    setListening: function(active, volume) {
      isListening = !!active;
      listenVolume = clamp(volume || 0.5, 0, 1);
    },
    triggerTyping: function() {
      typingBoost = 1.0;
    },
    setTheme: function(themeNameOrHex) {
      applyTheme(themeNameOrHex);
    }
  };

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
