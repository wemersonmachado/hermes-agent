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

  // ── ESQUEMA DE COR (10 OPÇÕES DE CORES NEON VIBRANTES PWA + DASHBOARD) ────
  const THEMES = {
    cyan: { name: "Ciano Cyber", primary: "#00f5ff", secondary: "#a855f7" },
    purple: { name: "Púrpura Imperial", primary: "#a855f7", secondary: "#ec4899" },
    red: { name: "Rubi Plasma", primary: "#ff2a5f", secondary: "#ff9900" },
    green: { name: "Verde Matrix", primary: "#00ff9d", secondary: "#00f5ff" },
    gold: { name: "Ouro Solar", primary: "#ffb700", secondary: "#ff3860" },
    pink: { name: "Rosa Synthwave", primary: "#ff007f", secondary: "#7000ff" },
    blue: { name: "Azul Elétrico", primary: "#0066ff", secondary: "#00f5ff" },
    orange: { name: "Fogo Plasma", primary: "#ff5500", secondary: "#ffe600" },
    teal: { name: "Turquesa Quantum", primary: "#00ffd5", secondary: "#7b2cbf" },
    silver: { name: "Supernova Prata", primary: "#e2e8f0", secondary: "#00f5ff" }
  };
  let activeTheme = THEMES.cyan;

  function applyTheme(name) {
    const t = THEMES[name] || THEMES.cyan;
    activeTheme = t;
    try { localStorage.setItem("browCoreTheme", name); } catch(e){}
    if (view) {
      view.style.setProperty("--cyan", t.primary);
      view.style.setProperty("--purple", t.secondary);
    }
  }

  function setupColorPickers(forceRebuild = false) {
    const savedTheme = localStorage.getItem("browCoreTheme");
    if (savedTheme && THEMES[savedTheme] && !forceRebuild) {
      applyTheme(savedTheme);
    }

    const panels = document.querySelectorAll("#core-color-popover, #hud-theme-panel, #pwa-core-color-menu, .core-color-popover");
    panels.forEach(panel => {
      if (!panel) return;
      if (panel.dataset.colorBound && !forceRebuild) return;
      panel.dataset.colorBound = "true";
      panel.innerHTML = "";
      Object.keys(THEMES).forEach(key => {
        const t = THEMES[key];
        const btn = document.createElement("button");
        btn.type = "button";
        btn.title = t.name;
        btn.style.cssText = `width:26px; height:26px; border-radius:50%; border:2px solid ${activeTheme === t ? '#ffffff' : 'rgba(255,255,255,0.25)'}; cursor:pointer; background:linear-gradient(135deg, ${t.primary}, ${t.secondary}); box-shadow:0 0 8px ${t.primary}; transition:transform 0.15s, border 0.15s; flex-shrink:0; padding:0;`;
        btn.addEventListener("click", (e) => {
          e.stopPropagation();
          e.preventDefault();
          applyTheme(key);
          setupColorPickers(true);
          const p = e.target.closest("#core-color-popover, #hud-theme-panel, #pwa-core-color-menu, .core-color-popover");
          if (p) p.style.display = "none";
        });
        panel.appendChild(btn);
      });
    });
  }

  window.toggleCoreColorMenu = function(e) {
    if (e) {
      if (e.stopPropagation) e.stopPropagation();
      if (e.preventDefault) e.preventDefault();
    }
    const panels = document.querySelectorAll("#core-color-popover, #hud-theme-panel, #pwa-core-color-menu, .core-color-popover");
    panels.forEach(p => {
      if (!p) return;
      const isHidden = p.style.display === "none" || !p.style.display;
      p.style.display = isHidden ? "grid" : "none";
      if (isHidden) {
        p.style.gridTemplateColumns = "repeat(5, 1fr)";
        p.style.gap = "6px";
        p.style.zIndex = "9999";
      }
    });
    setupColorPickers(true);
  };

  document.addEventListener("click", (e) => {
    if (e && e.target && e.target.closest && e.target.closest("#core-color-popover, #hud-theme-panel, #pwa-core-color-menu, .btn-core-color-picker, .core-color-popover")) {
      return;
    }
    const panels = document.querySelectorAll("#core-color-popover, #hud-theme-panel, #pwa-core-color-menu, .core-color-popover");
    panels.forEach(p => {
      if (p) p.style.display = "none";
    });
  });

  setupColorPickers();
  setInterval(() => setupColorPickers(false), 2000);

  // ── FUNDO ESTRELADO (decorativo, não representa dado nenhum) ────
  const bgCanvas = document.getElementById("hud-bg-canvas");
  const bgCtx = bgCanvas ? bgCanvas.getContext("2d") : null;
  const stars = Array.from({ length: 30 }, () => ({
    x: rand(0, 1), y: rand(0, 1), r: rand(0.4, 1.4), alpha: rand(0.08, 0.35), pulse: rand(0, Math.PI * 2),
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
  if (coreCanvas) coreCanvas.dataset.browSharedCore = "true";

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
    }
  }

  if (coreCanvas) {
    coreCanvas.addEventListener("click", () => {
      ensureAudioGraph();
      ensureMicAnalyser();
      if (typeof toggleVoiceInput === "function") toggleVoiceInput();
    });
  }

  // ── REAÇÃO A DIGITAÇÃO, FALA, ESCUTA E MOUSE ─────────────────────
  let typingBoost = 0;
  let hoverBoost = 0;
  let smoothHoverBoost = 0.0;

  const bindInputEvents = () => {
    const selector = '#voice-chat-input, #chat-input-field, .input, input[type="text"], textarea';
    document.querySelectorAll(selector).forEach(el => {
      if (el && !el.dataset.hudBound) {
        el.dataset.hudBound = "true";
        el.addEventListener("input", (e) => {
          if (e && e.isTrusted) typingBoost = 0.5;
        });
        el.addEventListener("keydown", (e) => {
          if (e && e.isTrusted) typingBoost = 0.5;
        });
      }
    });
  };
  bindInputEvents();
  setInterval(bindInputEvents, 1200);

  if (coreCanvas) {
    coreCanvas.addEventListener("mouseenter", () => { hoverBoost = 1.0; });
    coreCanvas.addEventListener("mouseleave", () => { hoverBoost = 0.0; });
    coreCanvas.addEventListener("mousemove", () => {
      hoverBoost = 1.0;
      clearTimeout(coreCanvas.hoverTimer);
      coreCanvas.hoverTimer = setTimeout(() => { hoverBoost = 0.2; }, 1200);
    });
  }

  let smoothLevel = 0.06;
  let smoothHeat = 0;

  // ── COGNITIVE NEURAL CORE (Portado 1:1 de Nucleo Neural.html) ──
  const PI = Math.PI;
  const sin = Math.sin;
  const cos = Math.cos;

  // ── OTIMIZADO PARA MÁXIMA LEVEZA (800 PARTICULAS - ALTA VELOCIDADE EM INTERAÇÃO & ULTRA LEVE) ──
  const PARTICLE_COUNT = 800;
  const particles = [];
  let baseRadius = 90;
  let ringWidth = 40;

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
      // Rotação em repouso serenamente lenta (~70% mais calma)
      this.speed = rand(0.0003, 0.0008);
      this.tFactor = Math.pow(Math.random(), 1.4);
      this.radMultiplier = rand(0.8, 1.4);
      this.waveFreq1 = rand(3, 7);
      this.waveFreq2 = rand(8, 14);
      this.waveAmp1 = rand(6, 16);
      this.waveAmp2 = rand(3, 6);
      this.wavePhase = rand(0, PI * 2);
      this.type = Math.random() < 0.76 ? 'primary' : 'secondary';
      this.size = rand(1.0, 2.8);
      this.baseAlpha = rand(0.28, 0.95);
    }

    update(t, smoothTyping, smoothSpeak, smoothHover) {
      // Acelera fortemente APENAS quando há interação real (fala, digitação ou toque)
      const activeSpeed = this.speed * (1.0 + smoothTyping * 2.2 + smoothSpeak * 3.8 + smoothHover * 1.8);
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
    const speaking = (typeof isSpeakingOrListening !== "undefined" && isSpeakingOrListening) || (typeof isSpeaking !== "undefined" && isSpeaking);
    const listening = (typeof isRecording !== "undefined" && isRecording) || (typeof isListening !== "undefined" && isListening);
    const player = document.getElementById("edge-tts-player");
    const isPlayerActive = player && !player.paused && player.currentTime > 0;
    const trulySpeaking = speaking || isPlayerActive;

    // ESCUTA REAL: move o núcleo APENAS com o som real da voz do usuário saindo da boca!
    if (listening) {
      if (micAnalyser && micDataArray) {
        micAnalyser.getByteFrequencyData(micDataArray);
        let sum = 0;
        for (let i = 0; i < 16; i++) sum += micDataArray[i] || 0;
        const avg = sum / 16 / 255;
        if (avg > 0.05) {
          return { level: Math.min(1.0, (avg - 0.04) * 3.5), listening: true, speaking: false };
        }
      }
      return { level: 0.0, listening: true, speaking: false };
    }

    // FALA REAL (BROW respondendo por áudio/TTS): acelera em tempo real com o som audível!
    if (trulySpeaking && ttsAnalyser && ttsDataArray) {
      ttsAnalyser.getByteFrequencyData(ttsDataArray);
      let sum = 0;
      for (let i = 0; i < 16; i++) sum += ttsDataArray[i] || 0;
      const avg = sum / 16 / 255;
      if (avg > 0.02) {
        return { level: Math.min(1.0, avg * 3.2), listening: false, speaking: true };
      }
    }
    if (trulySpeaking) {
      return { level: 0.35 + Math.abs(Math.sin(Date.now() * 0.01)) * 0.3, listening: false, speaking: true };
    }

    // Repouso calmo por padrão (geração de texto não sacode o núcleo)
    return { level: 0.0, listening: false, speaking: false };
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

    smoothSpeakVolume = lerp(smoothSpeakVolume, isSpeaking ? speakVolume : 0.0, 0.16);
    smoothListenVolume = lerp(smoothListenVolume, isListening ? listenVolume : 0.0, 0.16);
    smoothTypingBoost = lerp(smoothTypingBoost, typingBoost, 0.14);
    smoothHoverBoost = lerp(smoothHoverBoost, hoverBoost, 0.14);
    typingBoost = Math.max(0, typingBoost - 0.025);

    const minDim = Math.min(w, h);
    baseRadius = Math.max(minDim * 0.22, 50);
    ringWidth = Math.max(baseRadius * 0.35, 18);

    const themeRGB = hexToRgb(activeTheme.primary);
    const themeRGBSec = hexToRgb(activeTheme.secondary);

    const glowGrad = coreCtx.createRadialGradient(cx, cy, baseRadius * 0.5, cx, cy, baseRadius + ringWidth * 1.2);
    glowGrad.addColorStop(0, `rgba(${themeRGB.r}, ${themeRGB.g}, ${themeRGB.b}, 0.0)`);
    glowGrad.addColorStop(0.5, `rgba(${themeRGB.r}, ${themeRGB.g}, ${themeRGB.b}, ${0.05 + smoothSpeakVolume * 0.18 + smoothHoverBoost * 0.08})`);
    glowGrad.addColorStop(1, `rgba(${themeRGB.r}, ${themeRGB.g}, ${themeRGB.b}, 0.0)`);
    coreCtx.fillStyle = glowGrad;
    coreCtx.beginPath();
    coreCtx.arc(cx, cy, baseRadius + ringWidth * 1.3, 0, PI * 2);
    coreCtx.fill();

    const opacityBuckets = [0.22, 0.48, 0.72, 0.95];
    const buckets = {
      primary: opacityBuckets.map(() => []),
      secondary: opacityBuckets.map(() => [])
    };

    // Amplitude de ondas suave em repouso (0.3), expandindo dinamicamente com interações
    const waveScale = 0.30 + smoothSpeakVolume * 1.8 + smoothHoverBoost * 0.4 + smoothTypingBoost * 0.6;

    for (let i = 0; i < PARTICLE_COUNT; i++) {
      const p = particles[i];
      p.update(t, smoothTypingBoost, smoothSpeakVolume, smoothHoverBoost);

      const pBaseRad = baseRadius + (p.tFactor * ringWidth * p.radMultiplier) - (ringWidth * 0.25);
      const wave1 = sin(p.theta * p.waveFreq1 - t * 0.0008 + p.wavePhase) * p.waveAmp1 * waveScale;
      const wave2 = cos(p.theta * p.waveFreq2 + t * 0.0012) * p.waveAmp2 * waveScale;

      let r = pBaseRad + wave1 + wave2;

      if (smoothListenVolume > 0.02) {
        const listenWave = sin(p.theta * 24.0 - t * 0.015) * (smoothListenVolume * 28.0);
        r += listenWave;
      }
      if (smoothTypingBoost > 0.02) {
        r += rand(-6, 6) * smoothTypingBoost;
      }

      const x = cx + cos(p.theta) * r;
      const y = cy + sin(p.theta) * r;

      const radialFade = clamp((baseRadius + ringWidth * 1.2 - r) / (ringWidth * 0.8), 0.18, 1.0);
      let alpha = p.baseAlpha * radialFade * (1.0 + smoothTypingBoost * 0.4 + smoothHoverBoost * 0.2);
      alpha = clamp(alpha, 0.08, 0.98);

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

    // ── LEVE POEIRA DE PARTÍCULAS EM ÓRBITA (36 PARTICULAS TOTAL - ULTRA LEVE) ──
    const outerHaloRings = [
      { r: baseRadius - 10, count: 10, speed: 0.0004, color: activeTheme.primary, glow: 10 },
      { r: baseRadius + ringWidth + 6, count: 12, speed: -0.0003, color: activeTheme.secondary, glow: 14 },
      { r: baseRadius + ringWidth + 20, count: 14, speed: 0.0002, color: activeTheme.primary, glow: 18 }
    ];

    outerHaloRings.forEach((ring, idx) => {
      coreCtx.save();
      const count = ring.count;
      for (let i = 0; i < count; i++) {
        const activeHaloSpeed = ring.speed * (1.0 + smoothSpeakVolume * 3.0 + smoothHoverBoost * 1.5);
        const angle = (i / count) * Math.PI * 2 + (t * activeHaloSpeed);
        const wave = sin(angle * (4 + idx) + t * activeHaloSpeed * 2) * (4 * (smoothSpeakVolume * 1.4 + smoothHoverBoost * 0.5 + 0.25));
        const r = ring.r + wave;
        const px = cx + cos(angle) * r;
        const py = cy + sin(angle) * r;

        coreCtx.beginPath();
        const pSize = (i % 3 === 0 ? 2.6 : 1.6) + (smoothSpeakVolume * 0.8);
        coreCtx.arc(px, py, pSize, 0, PI * 2);
        coreCtx.fillStyle = i % 2 === 0 ? ring.color : '#ffffff';
        coreCtx.shadowColor = ring.color;
        coreCtx.shadowBlur = ring.glow + (smoothSpeakVolume * 8);
        coreCtx.globalAlpha = (i % 2 === 0 ? 0.75 : 0.95) * (0.55 + smoothSpeakVolume * 0.45);
        coreCtx.fill();
      }
      coreCtx.restore();
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
  window.BrowNeuralCore = window.BrowCore;

  function resizeCore() {
    if (!coreCanvas || !coreCanvas.parentElement) return;
    const size = Math.min(coreCanvas.parentElement.clientWidth || 360, coreCanvas.parentElement.clientHeight || 360, 360);
    if (size > 0 && (coreCanvas.width !== size || coreCanvas.height !== size)) {
      coreCanvas.width = size;
      coreCanvas.height = size;
    }
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
    const savedTheme = localStorage.getItem("browCoreTheme");
    applyTheme(savedTheme && THEMES[savedTheme] ? savedTheme : "cyan");
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
