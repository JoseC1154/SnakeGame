// FILE: app.js
(() => {
  "use strict";

  // -----------------------------
  // Elements
  // -----------------------------
  const elCanvas = document.getElementById("game");
  const ctx = elCanvas.getContext("2d", { alpha: false });

  const elOverlay = document.getElementById("overlay");
  const elOverlayTitle = document.getElementById("overlayTitle");
  const elOverlayText = document.getElementById("overlayText");

  const elScore = document.getElementById("score");
  const elBest = document.getElementById("best");
  const elSpeed = document.getElementById("speed");
  const elModeLabel = document.getElementById("modeLabel");
  const elStatus = document.getElementById("status");

  const btnStart = document.getElementById("btnStart");
  const btnRestart = document.getElementById("btnRestart");
  const btnPause = document.getElementById("btnPause");
  const btnMenu = document.getElementById("btnMenu");

  const dlgMenu = document.getElementById("menu");
  const btnCloseMenu = document.getElementById("btnCloseMenu");
  const btnCloseMenu2 = document.getElementById("btnCloseMenu2");

  const btnMode = document.getElementById("btnMode");
  const btnSound = document.getElementById("btnSound");
  const btnVibrate = document.getElementById("btnVibrate");
  const btnDpad = document.getElementById("btnDpad");

  const dpadWrap = document.getElementById("dpadWrap");
  const toggleDpad = document.getElementById("toggleDpad");
  const toggleSound = document.getElementById("toggleSound");
  const toggleHaptics = document.getElementById("toggleHaptics");
  const toggleContrast = document.getElementById("toggleContrast");

  // Layout helpers (fix "off-screen" controls on short viewports)
  const elApp = document.querySelector(".app");
  const elTopbar = document.querySelector(".topbar");
  const elStage = document.querySelector(".stage");
  const elGameShell = document.querySelector(".gameShell");
  const elControls = document.querySelector(".controls");

  // -----------------------------
  // Storage keys
  // -----------------------------
  const LS = {
    bestClassic: "snakeplus_best_classic",
    bestNoWalls: "snakeplus_best_nowalls",
    sound: "snakeplus_sound",
    haptics: "snakeplus_haptics",
    dpad: "snakeplus_dpad",
    contrast: "snakeplus_contrast",
    mode: "snakeplus_mode",
  };

  // -----------------------------
  // Config
  // -----------------------------
  const GRID = 24; // 24x24 cells
  const START_LEN = 4;
  const BASE_TICK_MS = 150; // starting speed (lower = faster)
  const SPEEDUP_EVERY = 5; // foods per speed step
  const MIN_TICK_MS = 70;

  // Food quality-of-life: if you don't reach food for a while, it respawns.
  // This prevents rare cases where food becomes effectively unreachable.
  const FOOD_TTL_MS = 9000; // 9 seconds

  const MODES = {
    classic: { id: "classic", name: "Classic", wrap: false },
    noWalls: { id: "noWalls", name: "No Walls", wrap: true },
  };

  // -----------------------------
  // State
  // -----------------------------
  let mode = MODES.classic;
  let running = false;
  let paused = false;
  let gameOver = false;

  let snake = [];
  let dir = { x: 1, y: 0 };
  let queuedDir = null;

  let food = { x: 10, y: 10 };
  let foodSpawnedAt = 0;
  let score = 0;
  let foodsEaten = 0;

  let tickMs = BASE_TICK_MS;
  let lastTick = 0;

  // Options
  let optSound = true;
  let optHaptics = true;
  let optDpad = false;
  let optContrast = false;

  // Audio (tiny, optional)
  let audioCtx = null;

  // Resize
  let dpr = 1;
  let cell = 20; // pixels per cell (computed)

  // -----------------------------
  // Helpers
  // -----------------------------
  const clamp = (n, a, b) => Math.max(a, Math.min(b, n));
  const sameCell = (a, b) => a.x === b.x && a.y === b.y;

  function setStatus(msg) {
    if (elStatus) elStatus.textContent = msg;
  }

  function readBool(key, fallback) {
    const v = localStorage.getItem(key);
    if (v === null) return fallback;
    return v === "1";
  }

  function writeBool(key, value) {
    localStorage.setItem(key, value ? "1" : "0");
  }

  function readMode() {
    const v = localStorage.getItem(LS.mode);
    if (v === MODES.noWalls.id) return MODES.noWalls;
    return MODES.classic;
  }

  function writeMode(m) {
    localStorage.setItem(LS.mode, m.id);
  }

  function bestKeyForMode(m) {
    return m.id === MODES.noWalls.id ? LS.bestNoWalls : LS.bestClassic;
  }

  function getBest() {
    const key = bestKeyForMode(mode);
    const v = Number(localStorage.getItem(key) || "0");
    return Number.isFinite(v) ? v : 0;
  }

  function setBest(v) {
    const key = bestKeyForMode(mode);
    localStorage.setItem(key, String(v));
  }

  function speedMultiplier() {
    return BASE_TICK_MS / tickMs;
  }

  function updateHud() {
    elScore.textContent = String(score);
    elBest.textContent = String(getBest());
    elSpeed.textContent = `${speedMultiplier().toFixed(1)}x`;
    elModeLabel.textContent = mode.name;
  }

  function vibrate(ms = 20) {
    if (!optHaptics) return;
    if (navigator.vibrate) navigator.vibrate(ms);
  }

  function ensureAudio() {
    if (!optSound) return null;
    if (!window.AudioContext && !window.webkitAudioContext) return null;
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    return audioCtx;
  }

  function beep(freq = 440, dur = 0.04, type = "sine", gain = 0.03) {
    if (!optSound) return;
    const ac = ensureAudio();
    if (!ac) return;
    if (ac.state === "suspended") ac.resume().catch(() => {});

    const o = ac.createOscillator();
    const g = ac.createGain();
    o.type = type;
    o.frequency.value = freq;
    g.gain.value = gain;
    o.connect(g);
    g.connect(ac.destination);
    o.start();
    o.stop(ac.currentTime + dur);
  }

  // -----------------------------
  // Canvas sizing
  // -----------------------------
  function resizeCanvas() {
    // Use the *actual CSS box size* of the canvas.
    // This avoids rectangular scaling issues on some mobile browsers.
    const cw = Math.floor(elCanvas.clientWidth || elCanvas.getBoundingClientRect().width);
    const ch = Math.floor(elCanvas.clientHeight || elCanvas.getBoundingClientRect().height);
    const cssSize = Math.floor(Math.min(cw, ch));

    dpr = window.devicePixelRatio || 1;

    // Backing buffer must match CSS size * DPR for crisp, square pixels
    elCanvas.width = Math.floor(cssSize * dpr);
    elCanvas.height = Math.floor(cssSize * dpr);

    // Draw in CSS pixel coordinates
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    cell = Math.floor(cssSize / GRID);
    cell = clamp(cell, 10, 40);
  }

  // Keep the whole UI within the visible viewport on short screens.
  function fitLayout() {
    if (!elApp || !elTopbar || !elStage || !elGameShell || !elControls) return;

    // Prefer VisualViewport height on mobile (handles address bar / keyboard better)
    const vv = window.visualViewport;
    const vh = Math.floor((vv && vv.height) ? vv.height : window.innerHeight);

    // Lock the app container to the visible viewport height
    elApp.style.height = `${vh}px`;
    elApp.style.minHeight = "0";

    // Compute how tall the gameShell can be so controls never get pushed off-screen
    const topH = elTopbar.getBoundingClientRect().height;
    const controlsH = elControls.getBoundingClientRect().height;

    // app padding (top/bottom)
    const cs = getComputedStyle(elApp);
    const padT = parseFloat(cs.paddingTop) || 0;
    const padB = parseFloat(cs.paddingBottom) || 0;

    // Approximate gaps between sections (matches CSS gap: 10px)
    const gaps = 20;

    const availableForShell = Math.max(220, vh - padT - padB - topH - controlsH - gaps);

    // Ensure stage doesn't overflow
    elStage.style.minHeight = "0";
    elStage.style.height = `${Math.max(260, vh - padT - padB - topH - 10)}px`;

    // Pin the game board to the computed height
    elGameShell.style.height = `${availableForShell}px`;

    // IMPORTANT: Keep the *canvas element* perfectly square.
    // If the canvas is stretched by CSS into a rectangle, grid squares look skewed.
    // We size the canvas box to a square that fits within the shell.
    const shellRect = elGameShell.getBoundingClientRect();
    const boardSize = Math.floor(Math.min(shellRect.width, availableForShell));

    // Center the canvas within the shell
    elGameShell.style.display = "grid";
    elGameShell.style.placeItems = "center";

    elCanvas.style.width = `${boardSize}px`;
    elCanvas.style.height = `${boardSize}px`;
  }

  function boardOffset() {
    const rect = elCanvas.getBoundingClientRect();
    const size = Math.floor(Math.min(rect.width, rect.height));
    const used = cell * GRID;
    const ox = Math.floor((size - used) / 2);
    const oy = Math.floor((size - used) / 2);
    return { ox, oy, used };
  }

  // -----------------------------
  // Game setup
  // -----------------------------
  function spawnFood() {
    const occupied = new Set(snake.map((s) => `${s.x},${s.y}`));

    // Try a bunch of random spots first.
    for (let attempts = 0; attempts < 2000; attempts++) {
      const x = Math.floor(Math.random() * GRID);
      const y = Math.floor(Math.random() * GRID);
      const key = `${x},${y}`;
      if (!occupied.has(key)) {
        food = { x, y };
        foodSpawnedAt = performance.now();
        return;
      }
    }

    // Fallback: deterministic scan (guarantees a result if any empty cell exists)
    for (let y = 0; y < GRID; y++) {
      for (let x = 0; x < GRID; x++) {
        const key = `${x},${y}`;
        if (!occupied.has(key)) {
          food = { x, y };
          foodSpawnedAt = performance.now();
          return;
        }
      }
    }

    // Board is full (you win!)
    food = { x: -1, y: -1 };
    foodSpawnedAt = performance.now();
  }

  function showOverlay(show, title, text) {
    if (!elOverlay) return;
    if (show) {
      elOverlay.hidden = false;
      elOverlayTitle.textContent = title;
      elOverlayText.textContent = text;
    } else {
      elOverlay.hidden = true;
    }
  }

  function resetGame() {
    running = false;
    paused = false;
    gameOver = false;

    score = 0;
    foodsEaten = 0;
    tickMs = BASE_TICK_MS;
    lastTick = 0;

    dir = { x: 1, y: 0 };
    queuedDir = null;

    const startX = Math.floor(GRID / 2);
    const startY = Math.floor(GRID / 2);
    snake = [];
    for (let i = 0; i < START_LEN; i++) {
      snake.push({ x: startX - i, y: startY });
    }

    spawnFood();
    updateHud();
    showOverlay(true, "Snake+", "Swipe to move. Eat the dot. Don’t hit yourself.");
    setStatus("Ready.");
    draw();
  }

  function start() {
    if (gameOver) resetGame();
    running = true;
    paused = false;
    showOverlay(false);
    setStatus("Running.");
    ensureAudio();
  }

  function endRun(reasonText) {
    running = false;
    paused = false;
    gameOver = true;

    const best = getBest();
    if (score > best) setBest(score);

    updateHud();
    showOverlay(true, "Game Over", reasonText || "Tap Restart to try again.");
    setStatus("Game over.");
    beep(160, 0.08, "sawtooth", 0.025);
    vibrate(45);
  }

  function togglePause() {
    if (!running && !gameOver) return;
    if (gameOver) return;

    paused = !paused;
    if (paused) {
      showOverlay(true, "Paused", "Tap ⏸ to resume. Tap Restart to reset.");
      setStatus("Paused.");
    } else {
      showOverlay(false);
      setStatus("Running.");
      ensureAudio();
      lastTick = performance.now();
    }
  }

  // -----------------------------
  // Movement + rules
  // -----------------------------
  function setDirection(next) {
    if (!next) return;
    if (next.x === -dir.x && next.y === -dir.y) return;
    queuedDir = next;
  }

  function step() {
    if (!running || paused || gameOver) return;

    // Safety: if food is missing/invalid or sitting on the snake, respawn it.
    if (!food || !Number.isFinite(food.x) || !Number.isFinite(food.y)) {
      spawnFood();
    } else {
      const onSnake = snake.some((s) => s.x === food.x && s.y === food.y);
      if (onSnake) spawnFood();
    }

    if (queuedDir) {
      dir = queuedDir;
      queuedDir = null;
    }

    const head = snake[0];
    let nx = head.x + dir.x;
    let ny = head.y + dir.y;

    if (mode.wrap) {
      nx = (nx + GRID) % GRID;
      ny = (ny + GRID) % GRID;
    } else {
      if (nx < 0 || nx >= GRID || ny < 0 || ny >= GRID) {
        endRun("You hit the wall.");
        return;
      }
    }

    const newHead = { x: nx, y: ny };

    // collision with body (ignore tail)
    const hitsBody = snake.some((seg, i) => {
      if (i === snake.length - 1) return false;
      return seg.x === newHead.x && seg.y === newHead.y;
    });

    if (hitsBody) {
      endRun("You ran into yourself.");
      return;
    }

    snake.unshift(newHead);

    if (sameCell(newHead, food)) {
      score += 10;
      foodsEaten += 1;

      if (foodsEaten % SPEEDUP_EVERY === 0) {
        tickMs = Math.max(MIN_TICK_MS, tickMs - 10);
      }

      beep(740, 0.035, "square", 0.02);
      vibrate(15);

      spawnFood();
    } else {
      snake.pop();
    }

    // Update best
    if (score > getBest()) setBest(score);

    updateHud();
  }

  // -----------------------------
  // Drawing
  // -----------------------------
  function roundRect(x, y, w, h, r) {
    const rr = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + rr, y);
    ctx.arcTo(x + w, y, x + w, y + h, rr);
    ctx.arcTo(x + w, y + h, x, y + h, rr);
    ctx.arcTo(x, y + h, x, y, rr);
    ctx.arcTo(x, y, x + w, y, rr);
    ctx.closePath();
  }

  function drawGrid(ox, oy) {
    ctx.save();
    ctx.translate(ox, oy);

    ctx.fillStyle = "#0a0d10";
    ctx.fillRect(0, 0, cell * GRID, cell * GRID);

    ctx.globalAlpha = 0.16;
    ctx.strokeStyle = "#ffffff";
    ctx.lineWidth = 1;

    for (let i = 1; i < GRID; i++) {
      const p = i * cell + 0.5;
      ctx.beginPath();
      ctx.moveTo(p, 0);
      ctx.lineTo(p, cell * GRID);
      ctx.stroke();

      ctx.beginPath();
      ctx.moveTo(0, p);
      ctx.lineTo(cell * GRID, p);
      ctx.stroke();
    }

    ctx.restore();
  }

  function draw() {
    const rect = elCanvas.getBoundingClientRect();
    const size = Math.floor(Math.min(rect.width, rect.height));
    ctx.clearRect(0, 0, size, size);

    const { ox, oy } = boardOffset();

    drawGrid(ox, oy);

    ctx.save();
    ctx.translate(ox, oy);

    // Food (if board isn't full)
    if (food.x >= 0 && food.y >= 0) {
      ctx.globalAlpha = 1;
      ctx.fillStyle = "#34d399";
      roundRect(food.x * cell + 3, food.y * cell + 3, cell - 6, cell - 6, 6);
      ctx.fill();
    }

    // Snake
    for (let i = snake.length - 1; i >= 0; i--) {
      const s = snake[i];
      const x = s.x * cell;
      const y = s.y * cell;
      const isHead = i === 0;

      ctx.fillStyle = isHead ? "#eafff6" : "#a7f3d0";
      if (!isHead) {
        const t = i / Math.max(1, snake.length - 1);
        ctx.globalAlpha = 0.75 + 0.25 * (1 - t);
      } else {
        ctx.globalAlpha = 1;
      }

      roundRect(x + 2, y + 2, cell - 4, cell - 4, 7);
      ctx.fill();

      if (isHead) {
        ctx.globalAlpha = 0.85;
        ctx.fillStyle = "#0c0f12";
        const ex1 = x + cell * 0.35;
        const ex2 = x + cell * 0.65;
        const ey = y + cell * 0.38;
        ctx.beginPath();
        ctx.arc(ex1, ey, Math.max(1.4, cell * 0.06), 0, Math.PI * 2);
        ctx.fill();
        ctx.beginPath();
        ctx.arc(ex2, ey, Math.max(1.4, cell * 0.06), 0, Math.PI * 2);
        ctx.fill();
      }
    }

    ctx.restore();

    // Frame
    ctx.save();
    ctx.globalAlpha = 0.18;
    ctx.strokeStyle = "#ffffff";
    ctx.lineWidth = 2;
    ctx.strokeRect(ox + 1, oy + 1, cell * GRID - 2, cell * GRID - 2);
    ctx.restore();
  }

  // -----------------------------
  // Loop
  // -----------------------------
  function loop(ts) {
    requestAnimationFrame(loop);

    draw();

    if (!running || paused || gameOver) return;

    // If food has been on-screen too long, respawn it.
    if (foodSpawnedAt && ts - foodSpawnedAt > FOOD_TTL_MS) {
      spawnFood();
      setStatus("Food respawned.");
      beep(420, 0.03, "triangle", 0.015);
    }

    if (!lastTick) lastTick = ts;
    const dt = ts - lastTick;
    if (dt >= tickMs) {
      lastTick = ts;
      step();
    }
  }

  // -----------------------------
  // Input
  // -----------------------------
  function setupInput() {
    // Keyboard
    window.addEventListener("keydown", (e) => {
      const k = e.key;
      if (k === " " || k === "Spacebar") {
        e.preventDefault();
        togglePause();
        return;
      }
      if (k === "Enter") {
        e.preventDefault();
        if (!running && !paused) start();
        return;
      }

      if (k === "ArrowUp") setDirection({ x: 0, y: -1 });
      else if (k === "ArrowDown") setDirection({ x: 0, y: 1 });
      else if (k === "ArrowLeft") setDirection({ x: -1, y: 0 });
      else if (k === "ArrowRight") setDirection({ x: 1, y: 0 });
    });

    // Swipe
    let touchStart = null;

    const onPointerDown = (e) => {
      ensureAudio();
      touchStart = { x: e.clientX, y: e.clientY };
    };

    const onPointerMove = (e) => {
      if (!touchStart) return;
      const dx = e.clientX - touchStart.x;
      const dy = e.clientY - touchStart.y;
      const dist = Math.hypot(dx, dy);
      if (dist < 18) return;

      if (Math.abs(dx) > Math.abs(dy)) {
        setDirection({ x: dx > 0 ? 1 : -1, y: 0 });
      } else {
        setDirection({ x: 0, y: dy > 0 ? 1 : -1 });
      }

      touchStart = null;
    };

    const onPointerUp = () => {
      touchStart = null;
    };

    elCanvas.addEventListener("pointerdown", onPointerDown, { passive: true });
    elCanvas.addEventListener("pointermove", onPointerMove, { passive: true });
    elCanvas.addEventListener("pointerup", onPointerUp, { passive: true });
    elCanvas.addEventListener("pointercancel", onPointerUp, { passive: true });

    // D-pad buttons
    document.querySelectorAll(".dpadBtn").forEach((b) => {
      b.addEventListener("click", () => {
        const d = b.getAttribute("data-dir");
        if (d === "up") setDirection({ x: 0, y: -1 });
        if (d === "down") setDirection({ x: 0, y: 1 });
        if (d === "left") setDirection({ x: -1, y: 0 });
        if (d === "right") setDirection({ x: 1, y: 0 });
      });
    });
  }

  // -----------------------------
  // UI
  // -----------------------------
  function applyOptionsToUI() {
    btnSound.textContent = `Sound: ${optSound ? "On" : "Off"}`;
    btnVibrate.textContent = `Haptics: ${optHaptics ? "On" : "Off"}`;
    btnDpad.textContent = `D-pad: ${optDpad ? "On" : "Off"}`;

    dpadWrap.hidden = !optDpad;
    toggleDpad.checked = optDpad;
    toggleSound.checked = optSound;
    toggleHaptics.checked = optHaptics;
    toggleContrast.checked = optContrast;

    document.body.classList.toggle("contrast", optContrast);
  }

  function setMode(nextMode) {
    mode = nextMode;
    writeMode(mode);
    updateHud();
    resetGame();
  }

  function openMenu() {
    dlgMenu.showModal();
  }

  function closeMenu() {
    dlgMenu.close();
  }

  function setupUI() {
    btnStart.addEventListener("click", () => start());
    btnRestart.addEventListener("click", () => resetGame());
    btnPause.addEventListener("click", () => togglePause());

    btnMenu.addEventListener("click", () => openMenu());
    btnCloseMenu.addEventListener("click", () => closeMenu());
    btnCloseMenu2.addEventListener("click", () => closeMenu());

    btnMode.addEventListener("click", () => {
      setMode(mode.id === MODES.classic.id ? MODES.noWalls : MODES.classic);
      beep(520, 0.04, "triangle", 0.02);
      vibrate(12);
    });

    btnSound.addEventListener("click", () => {
      optSound = !optSound;
      writeBool(LS.sound, optSound);
      applyOptionsToUI();
      beep(660, 0.03, "triangle", 0.02);
    });

    btnVibrate.addEventListener("click", () => {
      optHaptics = !optHaptics;
      writeBool(LS.haptics, optHaptics);
      applyOptionsToUI();
      vibrate(16);
    });

    btnDpad.addEventListener("click", () => {
      optDpad = !optDpad;
      writeBool(LS.dpad, optDpad);
      applyOptionsToUI();
      vibrate(10);
    });

    dlgMenu.querySelectorAll(".segBtn").forEach((b) => {
      b.addEventListener("click", () => {
        const m = b.getAttribute("data-mode");
        if (m === "classic") setMode(MODES.classic);
        if (m === "noWalls") setMode(MODES.noWalls);
        beep(520, 0.04, "triangle", 0.02);
        vibrate(12);
      });
    });

    toggleDpad.addEventListener("change", () => {
      optDpad = toggleDpad.checked;
      writeBool(LS.dpad, optDpad);
      applyOptionsToUI();
      vibrate(10);
    });

    toggleSound.addEventListener("change", () => {
      optSound = toggleSound.checked;
      writeBool(LS.sound, optSound);
      applyOptionsToUI();
      beep(660, 0.03, "triangle", 0.02);
    });

    toggleHaptics.addEventListener("change", () => {
      optHaptics = toggleHaptics.checked;
      writeBool(LS.haptics, optHaptics);
      applyOptionsToUI();
      vibrate(16);
    });

    toggleContrast.addEventListener("change", () => {
      optContrast = toggleContrast.checked;
      writeBool(LS.contrast, optContrast);
      applyOptionsToUI();
      vibrate(10);
    });
  }

  // -----------------------------
  // Init
  // -----------------------------
  function init() {
    optSound = readBool(LS.sound, true);
    optHaptics = readBool(LS.haptics, true);
    optDpad = readBool(LS.dpad, false);
    optContrast = readBool(LS.contrast, false);

    mode = readMode();

    applyOptionsToUI();
    updateHud();

    fitLayout();
    resizeCanvas();
    const ro = new ResizeObserver(() => {
      fitLayout();
      resizeCanvas();
      draw();
    });
    ro.observe(elCanvas);

    window.addEventListener("orientationchange", () => {
      setTimeout(() => {
        fitLayout();
        resizeCanvas();
        draw();
      }, 250);
    });

    // Mobile browser UI (address bar) changes can shrink the visible viewport
    if (window.visualViewport) {
      window.visualViewport.addEventListener("resize", () => {
        fitLayout();
        resizeCanvas();
        draw();
      });
    }

    window.addEventListener("resize", () => {
      fitLayout();
      resizeCanvas();
      draw();
    });

    setupInput();
    setupUI();
    resetGame();

    requestAnimationFrame(loop);
  }

  init();
})();
