(function () {
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    return;
  }

  var canvas = document.querySelector(".life-bg");
  if (!canvas || !canvas.getContext) {
    return;
  }

  var ctx = canvas.getContext("2d", { alpha: true });
  if (!ctx) {
    return;
  }

  var CELL = 6;
  var STEP_MS = 180;
  var SEED_DENSITY = 0.14;
  var FILL = "hsla(136, 89%, 40%, 0.7)";
  var STORAGE_KEY = "calcharp-life-bg-v1";
  var cols = 0;
  var rows = 0;
  var grid = null;
  var next = null;
  var raf = 0;
  var lastStep = 0;
  var stagnant = 0;
  var running = true;
  var stepsSinceSave = 0;

  function configureForViewport() {
    var mobile = window.matchMedia("(max-width: 42.74em)").matches;
    /* Larger, sparser cells on phones so margins stay readable instead of noisy */
    CELL = mobile ? 12 : 6;
    STEP_MS = mobile ? 240 : 180;
    SEED_DENSITY = mobile ? 0.06 : 0.14;
  }

  function saveState() {
    if (!grid || !cols || !rows) {
      return;
    }
    try {
      sessionStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({
          cell: CELL,
          cols: cols,
          rows: rows,
          stagnant: stagnant,
          grid: Array.from(grid),
        })
      );
    } catch (err) {
      /* ignore quota / private mode */
    }
  }

  function loadState() {
    try {
      var raw = sessionStorage.getItem(STORAGE_KEY);
      if (!raw) {
        return false;
      }
      var data = JSON.parse(raw);
      if (
        !data ||
        data.cell !== CELL ||
        data.cols !== cols ||
        data.rows !== rows ||
        !data.grid ||
        data.grid.length !== cols * rows
      ) {
        return false;
      }
      grid.set(data.grid);
      stagnant = data.stagnant || 0;
      return true;
    } catch (err) {
      return false;
    }
  }

  function copyOverlap(prevCols, prevRows, prevGrid) {
    if (!prevGrid || !prevCols || !prevRows) {
      return false;
    }
    var copyCols = Math.min(cols, prevCols);
    var copyRows = Math.min(rows, prevRows);
    var y;
    var x;
    for (y = 0; y < copyRows; y += 1) {
      for (x = 0; x < copyCols; x += 1) {
        grid[y * cols + x] = prevGrid[y * prevCols + x];
      }
    }
    return copyCols > 0 && copyRows > 0;
  }

  function seed() {
    var i;
    for (i = 0; i < grid.length; i += 1) {
      grid[i] = Math.random() < SEED_DENSITY ? 1 : 0;
    }
    stagnant = 0;
  }

  function updateClip() {
    var el = document.querySelector(".container");
    if (!el) {
      canvas.style.clipPath = "";
      return;
    }
    var r = el.getBoundingClientRect();
    var l = Math.max(0, Math.round(r.left));
    var t = Math.max(0, Math.round(r.top));
    var ri = Math.min(window.innerWidth, Math.round(r.right));
    var b = Math.min(window.innerHeight, Math.round(r.bottom));
    if (ri <= l || b <= t) {
      canvas.style.clipPath = "";
      return;
    }
    /* evenodd: full viewport minus content column (so PDF/YouTube can't hide the margins) */
    canvas.style.clipPath =
      "polygon(evenodd, 0% 0%, 100% 0%, 100% 100%, 0% 100%, 0% 0%, " +
      l +
      "px " +
      t +
      "px, " +
      l +
      "px " +
      b +
      "px, " +
      ri +
      "px " +
      b +
      "px, " +
      ri +
      "px " +
      t +
      "px, " +
      l +
      "px " +
      t +
      "px)";
  }

  function resize() {
    var prevCols = cols;
    var prevRows = rows;
    var prevGrid = grid;
    var prevCell = CELL;
    configureForViewport();
    var dpr = Math.min(window.devicePixelRatio || 1, 2);
    var w = window.innerWidth;
    var h = window.innerHeight;
    canvas.width = Math.floor(w * dpr);
    canvas.height = Math.floor(h * dpr);
    canvas.style.width = w + "px";
    canvas.style.height = h + "px";
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    cols = Math.max(8, Math.ceil(w / CELL));
    rows = Math.max(8, Math.ceil(h / CELL));
    grid = new Uint8Array(cols * rows);
    next = new Uint8Array(cols * rows);

    if (!loadState()) {
      if (prevCell === CELL && copyOverlap(prevCols, prevRows, prevGrid)) {
        /* keep going */
      } else {
        seed();
      }
      saveState();
    }
    updateClip();
    draw();
  }

  function neighbors(x, y) {
    var n = 0;
    var dy;
    var dx;
    var nx;
    var ny;
    for (dy = -1; dy <= 1; dy += 1) {
      for (dx = -1; dx <= 1; dx += 1) {
        if (dx === 0 && dy === 0) {
          continue;
        }
        nx = (x + dx + cols) % cols;
        ny = (y + dy + rows) % rows;
        n += grid[ny * cols + nx];
      }
    }
    return n;
  }

  function step() {
    var changed = 0;
    var y;
    var x;
    var i;
    var alive;
    var n;
    var v;
    for (y = 0; y < rows; y += 1) {
      for (x = 0; x < cols; x += 1) {
        i = y * cols + x;
        alive = grid[i];
        n = neighbors(x, y);
        v = alive ? (n === 2 || n === 3 ? 1 : 0) : n === 3 ? 1 : 0;
        next[i] = v;
        if (v !== alive) {
          changed += 1;
        }
      }
    }
    var swap = grid;
    grid = next;
    next = swap;
    if (changed < 3) {
      stagnant += 1;
      if (stagnant > 40) {
        seed();
      }
    } else {
      stagnant = 0;
    }
    stepsSinceSave += 1;
    if (stepsSinceSave >= 8) {
      saveState();
      stepsSinceSave = 0;
    }
  }

  function draw() {
    var w = window.innerWidth;
    var h = window.innerHeight;
    var y;
    var x;
    var i;
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = FILL;
    for (y = 0; y < rows; y += 1) {
      for (x = 0; x < cols; x += 1) {
        i = y * cols + x;
        if (grid[i]) {
          ctx.fillRect(x * CELL, y * CELL, CELL, CELL);
        }
      }
    }
  }

  function inSideGutter(clientX) {
    var el = document.querySelector(".container");
    if (!el) {
      return false;
    }
    var r = el.getBoundingClientRect();
    return clientX < r.left || clientX > r.right;
  }

  function paintAt(clientX, clientY) {
    if (!grid || !cols || !rows) {
      return;
    }
    var col = Math.floor(clientX / CELL);
    var row = Math.floor(clientY / CELL);
    var mobile = window.matchMedia("(max-width: 42.74em)").matches;
    var radius = mobile ? 1 : 0;
    var dy;
    var dx;
    var nx;
    var ny;
    var painted = false;
    for (dy = -radius; dy <= radius; dy += 1) {
      for (dx = -radius; dx <= radius; dx += 1) {
        nx = col + dx;
        ny = row + dy;
        if (nx >= 0 && nx < cols && ny >= 0 && ny < rows) {
          grid[ny * cols + nx] = 1;
          painted = true;
        }
      }
    }
    if (painted) {
      stagnant = 0;
      draw();
      saveState();
    }
  }

  var drawing = false;

  function onPointerDown(event) {
    if (event.button != null && event.button !== 0) {
      return;
    }
    if (!inSideGutter(event.clientX)) {
      return;
    }
    drawing = true;
    try {
      event.target.setPointerCapture && event.target.setPointerCapture(event.pointerId);
    } catch (err) {
      /* ignore */
    }
    paintAt(event.clientX, event.clientY);
    event.preventDefault();
  }

  function onPointerMove(event) {
    if (inSideGutter(event.clientX)) {
      document.documentElement.style.cursor = "crosshair";
    } else if (!drawing) {
      document.documentElement.style.cursor = "";
    }
    if (!drawing) {
      return;
    }
    if (!inSideGutter(event.clientX)) {
      return;
    }
    paintAt(event.clientX, event.clientY);
    event.preventDefault();
  }

  function onPointerUp() {
    drawing = false;
    document.documentElement.style.cursor = "";
  }

  function tick(ts) {
    if (!running) {
      return;
    }
    if (ts - lastStep >= STEP_MS) {
      step();
      draw();
      lastStep = ts;
    }
    raf = window.requestAnimationFrame(tick);
  }

  function start() {
    if (raf) {
      return;
    }
    running = true;
    lastStep = 0;
    raf = window.requestAnimationFrame(tick);
  }

  function stop() {
    running = false;
    if (raf) {
      window.cancelAnimationFrame(raf);
      raf = 0;
    }
    saveState();
  }

  var resizeTimer = 0;
  window.addEventListener("resize", function () {
    window.clearTimeout(resizeTimer);
    resizeTimer = window.setTimeout(resize, 150);
  });

  window.addEventListener("scroll", updateClip, { passive: true });

  document.addEventListener("visibilitychange", function () {
    if (document.hidden) {
      stop();
    } else {
      updateClip();
      start();
    }
  });

  window.addEventListener("pagehide", saveState);

  /* Paint in the side gutters only — content column stays fully clickable */
  window.addEventListener("pointerdown", onPointerDown, { passive: false });
  window.addEventListener("pointermove", onPointerMove, { passive: false });
  window.addEventListener("pointerup", onPointerUp);
  window.addEventListener("pointercancel", onPointerUp);

  resize();
  start();
})();
