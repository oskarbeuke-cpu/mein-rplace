(() => {
  const canvas = document.getElementById("canvas");
  const ctx = canvas.getContext("2d");
  const stage = document.getElementById("stage");
  const statusEl = document.getElementById("status");
  const paletteEl = document.getElementById("palette");
  const cooldownWrap = document.getElementById("cooldownWrap");
  const cooldownBar = document.getElementById("cooldownBar");
  const cooldownLabel = document.getElementById("cooldownLabel");
  const toastEl = document.getElementById("toast");

  let SIZE = 200;
  let PALETTE = [];
  let grid = [];
  let selectedColor = 0;
  let nextAllowedAt = 0;
  let ws = null;

  let scale = 1;
  let offsetX = 0;
  let offsetY = 0;

  function showToast(text, ms = 1800) {
    toastEl.textContent = text;
    toastEl.hidden = false;
    clearTimeout(toastEl._t);
    toastEl._t = setTimeout(() => (toastEl.hidden = true), ms);
  }

  function drawGrid() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    for (let y = 0; y < SIZE; y++) {
      for (let x = 0; x < SIZE; x++) {
        const colorIdx = grid[y * SIZE + x];
        ctx.fillStyle = PALETTE[colorIdx] || "#FFFFFF";
        ctx.fillRect(x, y, 1, 1);
      }
    }
  }

  function drawPixel(x, y, colorIdx) {
    ctx.fillStyle = PALETTE[colorIdx] || "#FFFFFF";
    ctx.fillRect(x, y, 1, 1);
  }

  function applyTransform() {
    canvas.style.transform = `translate(${offsetX}px, ${offsetY}px) scale(${scale})`;
  }

  function fitToStage() {
    const stageRect = stage.getBoundingClientRect();
    const margin = 24;
    const fitScale = Math.min(
      (stageRect.width - margin) / SIZE,
      (stageRect.height - margin) / SIZE
    );
    scale = Math.max(fitScale, 1);
    offsetX = (stageRect.width - SIZE * scale) / 2;
    offsetY = (stageRect.height - SIZE * scale) / 2;
    canvas.style.transformOrigin = "0 0";
    applyTransform();
  }

  function connect() {
    const proto = location.protocol === "https:" ? "wss:" : "ws:";
    ws = new WebSocket(`${proto}//${location.host}`);

    ws.onopen = () => {
      statusEl.textContent = "verbunden";
    };

    ws.onclose = () => {
      statusEl.textContent = "Verbindung verloren – versuche erneut…";
      setTimeout(connect, 2000);
    };

    ws.onerror = () => {
      statusEl.textContent = "Verbindungsfehler";
    };

    ws.onmessage = (event) => {
      const msg = JSON.parse(event.data);
      if (msg.type === "init") {
        SIZE = msg.size;
        PALETTE = msg.palette;
        grid = msg.grid;
        canvas.width = SIZE;
        canvas.height = SIZE;
        buildPalette();
        drawGrid();
        fitToStage();
        statusEl.textContent = "live";
      } else if (msg.type === "pixel") {
        grid[msg.y * SIZE + msg.x] = msg.colorIndex;
        drawPixel(msg.x, msg.y, msg.colorIndex);
      } else if (msg.type === "placed") {
        nextAllowedAt = msg.nextAllowedAt;
        startCooldownUI();
      } else if (msg.type === "cooldown") {
        nextAllowedAt = Date.now() + msg.remainingMs;
        startCooldownUI();
        showToast("Noch kurz warten…");
      }
    };
  }

  function buildPalette() {
    paletteEl.innerHTML = "";
    PALETTE.forEach((color, idx) => {
      const sw = document.createElement("button");
      sw.className = "swatch";
      sw.style.background = color;
      sw.setAttribute("aria-label", `Farbe ${idx + 1}`);
      if (idx === selectedColor) sw.classList.add("selected");
      sw.addEventListener("click", () => {
        selectedColor = idx;
        document.querySelectorAll(".swatch").forEach((el) => el.classList.remove("selected"));
        sw.classList.add("selected");
      });
      paletteEl.appendChild(sw);
    });
  }

  let cooldownRAF = null;
  function startCooldownUI() {
    cooldownWrap.hidden = false;
    if (cooldownRAF) cancelAnimationFrame(cooldownRAF);

    function tick() {
      const remaining = nextAllowedAt - Date.now();
      if (remaining <= 0) {
        cooldownWrap.hidden = true;
        cooldownBar.style.transform = "scaleX(0)";
        return;
      }
      const totalMs = 30000;
      const frac = Math.min(remaining / totalMs, 1);
      cooldownBar.style.transform = `scaleX(${frac})`;
      cooldownLabel.textContent = `${Math.ceil(remaining / 1000)}s`;
      cooldownRAF = requestAnimationFrame(tick);
    }
    tick();
  }

  function canPlaceNow() {
    return Date.now() >= nextAllowedAt;
  }

  function placePixelAt(clientX, clientY) {
    if (!canPlaceNow()) {
      showToast("Bitte kurz warten, bevor du das nächste Pixel setzt");
      return;
    }
    const rect = canvas.getBoundingClientRect();
    const x = Math.floor(((clientX - rect.left) / rect.width) * SIZE);
    const y = Math.floor(((clientY - rect.top) / rect.height) * SIZE);
    if (x < 0 || x >= SIZE || y < 0 || y >= SIZE) return;

    drawPixel(x, y, selectedColor);
    grid[y * SIZE + x] = selectedColor;
    ws.send(JSON.stringify({ type: "place", x, y, colorIndex: selectedColor }));
  }

  let pointers = new Map();
  let didPan = false;
  let pinchStartDist = 0;
  let pinchStartScale = 1;

  function dist(a, b) {
    return Math.hypot(a.x - b.x, a.y - b.y);
  }

  stage.addEventListener("pointerdown", (e) => {
    stage.setPointerCapture(e.pointerId);
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    didPan = false;
    if (pointers.size === 2) {
      const vals = [...pointers.values()];
      pinchStartDist = dist(vals[0], vals[1]);
      pinchStartScale = scale;
    }
  });

  stage.addEventListener("pointermove", (e) => {
    if (!pointers.has(e.pointerId)) return;
    const prev = pointers.get(e.pointerId);
    const curr = { x: e.clientX, y: e.clientY };
    pointers.set(e.pointerId, curr);

    if (pointers.size === 1) {
      const dx = curr.x - prev.x;
      const dy = curr.y - prev.y;
      if (Math.abs(dx) > 2 || Math.abs(dy) > 2) didPan = true;
      offsetX += dx;
      offsetY += dy;
      applyTransform();
    } else if (pointers.size === 2) {
      const vals = [...pointers
