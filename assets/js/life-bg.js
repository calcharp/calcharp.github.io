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

  var scanlines = document.createElement("div");
  scanlines.className = "life-scanlines";
  scanlines.setAttribute("aria-hidden", "true");
  canvas.insertAdjacentElement("afterend", scanlines);

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
  var userPaused = false;
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

  function clearGrid() {
    var i;
    for (i = 0; i < grid.length; i += 1) {
      grid[i] = 0;
    }
  }

  /* Classic B3/S23 motifs (public mathematical patterns from LifeWiki / Life lexicon) */
  function cellsFromAscii(rows) {
    var out = [];
    var y;
    var x;
    var line;
    var ch;
    for (y = 0; y < rows.length; y += 1) {
      line = rows[y];
      for (x = 0; x < line.length; x += 1) {
        ch = line.charAt(x);
        if (ch === "O" || ch === "#" || ch === "*") {
          out.push([x, y]);
        }
      }
    }
    return out;
  }

  var PATTERN_LIBRARY = [
    {
      name: "glider",
      cells: cellsFromAscii([".O.", "..O", "OOO"]),
    },
    {
      name: "lwss",
      cells: cellsFromAscii([".O..O", "O....", "O...O", "OOOO."]),
    },
    {
      name: "mwss",
      cells: cellsFromAscii(["...O.", ".O...O", "O....", "O....O", "OOOOO"]),
    },
    {
      name: "hwss",
      cells: cellsFromAscii(["...OO.", ".O....O", "O.....", "O.....O", "OOOOOO"]),
    },
    {
      name: "pulsar",
      cells: cellsFromAscii([
        "..OOO...OOO..",
        ".............",
        "O....O.O....O",
        "O....O.O....O",
        "O....O.O....O",
        "..OOO...OOO..",
        ".............",
        "..OOO...OOO..",
        "O....O.O....O",
        "O....O.O....O",
        "O....O.O....O",
        ".............",
        "..OOO...OOO..",
      ]),
    },
    {
      name: "pentadecathlon",
      cells: cellsFromAscii([
        "..O....O..",
        "OO.OOOO.OO",
        "..O....O..",
      ]),
    },
    {
      name: "rpentomino",
      cells: cellsFromAscii([".OO", "OO.", ".O."]),
    },
    {
      name: "acorn",
      cells: cellsFromAscii([".O.....", "...O...", "OO..OOO"]),
    },
    {
      name: "diehard",
      cells: cellsFromAscii(["......O.", "OO......", ".O...OOO"]),
    },
    {
      name: "queenbee",
      cells: cellsFromAscii([
        "...O...",
        "..O.O..",
        ".O...O.",
        "..OOO..",
        "O.....O",
      ]),
    },
    {
      name: "gosper",
      cells: cellsFromAscii([
        "........................O...........",
        "......................O.O...........",
        "............OO......OO............OO",
        "...........O...O....OO............OO",
        "OO........O.....O...OO..............",
        "OO........O...O.OO....O.O...........",
        "..........O.....O.......O...........",
        "...........O...O....................",
        "............OO......................",
      ]),
    },
    {
      name: "switchengine",
      cells: cellsFromAscii([".O..O.O", "O......", ".O...O.", "...OO.."]),
    },
  ];

  function patternBounds(cells) {
    var maxX = 0;
    var maxY = 0;
    var i;
    for (i = 0; i < cells.length; i += 1) {
      if (cells[i][0] > maxX) {
        maxX = cells[i][0];
      }
      if (cells[i][1] > maxY) {
        maxY = cells[i][1];
      }
    }
    return { w: maxX + 1, h: maxY + 1 };
  }

  function stampPattern(cells, ox, oy, flipX, flipY, rot90) {
    var bounds = patternBounds(cells);
    var i;
    var x;
    var y;
    var nx;
    var ny;
    var tx;
    var ty;
    for (i = 0; i < cells.length; i += 1) {
      x = cells[i][0];
      y = cells[i][1];
      if (flipX) {
        x = bounds.w - 1 - x;
      }
      if (flipY) {
        y = bounds.h - 1 - y;
      }
      if (rot90) {
        tx = y;
        ty = bounds.w - 1 - x;
        x = tx;
        y = ty;
      }
      nx = (ox + x + cols) % cols;
      ny = (oy + y + rows) % rows;
      grid[ny * cols + nx] = 1;
    }
  }

  function pick(arr) {
    return arr[Math.floor(Math.random() * arr.length)];
  }

  function findPattern(name) {
    var i;
    for (i = 0; i < PATTERN_LIBRARY.length; i += 1) {
      if (PATTERN_LIBRARY[i].name === name) {
        return PATTERN_LIBRARY[i];
      }
    }
    return PATTERN_LIBRARY[0];
  }

  function stampNamed(name, ox, oy, opts) {
    var pat = findPattern(name);
    opts = opts || {};
    stampPattern(
      pat.cells,
      ox,
      oy,
      !!opts.flipX,
      !!opts.flipY,
      !!opts.rot90
    );
  }

  function randomOrigin(w, h, preferGutter) {
    var el = document.querySelector(".container");
    var leftCols = 2;
    var rightStart = cols - 2;
    var x;
    var y = Math.floor(Math.random() * Math.max(1, rows - h));
    if (el) {
      var r = el.getBoundingClientRect();
      leftCols = Math.max(2, Math.floor(r.left / CELL));
      rightStart = Math.min(cols - 2, Math.ceil(r.right / CELL));
    }
    if (preferGutter && leftCols > w + 1 && Math.random() < 0.5) {
      x = Math.floor(Math.random() * Math.max(1, leftCols - w));
    } else if (preferGutter && cols - rightStart > w + 1) {
      x = rightStart + Math.floor(Math.random() * Math.max(1, cols - rightStart - w));
    } else {
      x = Math.floor(Math.random() * Math.max(1, cols - w));
    }
    return { x: x, y: y };
  }

  function seedFleet(kind, count) {
    var i;
    var bounds;
    var origin;
    var pat = findPattern(kind);
    bounds = patternBounds(pat.cells);
    for (i = 0; i < count; i += 1) {
      origin = randomOrigin(bounds.w, bounds.h, true);
      stampNamed(kind, origin.x, origin.y, {
        flipX: Math.random() < 0.5,
        flipY: Math.random() < 0.5,
        rot90: kind === "glider" && Math.random() < 0.5,
      });
    }
  }

  function seedInteresting() {
    var roll = Math.random();
    var origin;
    var bounds;
    var pat;
    var n;
    var i;
    clearGrid();

    if (roll < 0.15) {
      /* Occasional random soup (~15%); interesting presets otherwise */
      seed();
      if (Math.random() < 0.55) {
        seedFleet("glider", 2 + Math.floor(Math.random() * 4));
      }
      return;
    }

    if (roll < 0.37) {
      /* Glider / spaceship traffic in the gutters */
      seedFleet("glider", 4 + Math.floor(Math.random() * 6));
      if (Math.random() < 0.65) {
        seedFleet(pick(["lwss", "mwss", "hwss"]), 1 + Math.floor(Math.random() * 3));
      }
      stagnant = 0;
      return;
    }

    if (roll < 0.59) {
      /* Oscillators + a traveler */
      n = 2 + Math.floor(Math.random() * 3);
      for (i = 0; i < n; i += 1) {
        pat = findPattern(pick(["pulsar", "pentadecathlon", "queenbee"]));
        bounds = patternBounds(pat.cells);
        origin = randomOrigin(bounds.w, bounds.h, true);
        stampPattern(pat.cells, origin.x, origin.y, Math.random() < 0.5, false, false);
      }
      seedFleet(pick(["glider", "lwss"]), 2 + Math.floor(Math.random() * 3));
      stagnant = 0;
      return;
    }

    if (roll < 0.79) {
      /* Methuselahs — long chaotic rebirths */
      n = 2 + Math.floor(Math.random() * 4);
      for (i = 0; i < n; i += 1) {
        pat = findPattern(pick(["rpentomino", "acorn", "diehard"]));
        bounds = patternBounds(pat.cells);
        origin = randomOrigin(bounds.w + 2, bounds.h + 2, Math.random() < 0.7);
        stampPattern(pat.cells, origin.x, origin.y, Math.random() < 0.5, Math.random() < 0.5, false);
      }
      stagnant = 0;
      return;
    }

    /* Guns / infinite growth — streams eventually light the gutters */
    if (Math.random() < 0.55) {
      pat = findPattern("gosper");
      bounds = patternBounds(pat.cells);
      origin = randomOrigin(bounds.w, bounds.h, false);
      stampPattern(pat.cells, origin.x, origin.y, Math.random() < 0.5, false, false);
      if (Math.random() < 0.4) {
        origin = randomOrigin(bounds.w, bounds.h, false);
        stampPattern(pat.cells, origin.x, origin.y, true, true, false);
      }
    } else {
      n = 2 + Math.floor(Math.random() * 3);
      for (i = 0; i < n; i += 1) {
        pat = findPattern("switchengine");
        bounds = patternBounds(pat.cells);
        origin = randomOrigin(bounds.w + 4, bounds.h + 4, Math.random() < 0.6);
        stampPattern(pat.cells, origin.x, origin.y, Math.random() < 0.5, Math.random() < 0.5, false);
      }
      seedFleet("glider", 2);
    }
    stagnant = 0;
  }

  function updateClip() {
    var el = document.querySelector(".container");
    if (!el) {
      canvas.style.clipPath = "";
      scanlines.style.clipPath = "";
      return;
    }
    var r = el.getBoundingClientRect();
    var l = Math.max(0, Math.round(r.left));
    var t = Math.max(0, Math.round(r.top));
    var ri = Math.min(window.innerWidth, Math.round(r.right));
    var b = Math.min(window.innerHeight, Math.round(r.bottom));
    if (ri <= l || b <= t) {
      canvas.style.clipPath = "";
      scanlines.style.clipPath = "";
      return;
    }
    /* evenodd: full viewport minus content column (so PDF/YouTube can't hide the margins) */
    var path =
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
    canvas.style.clipPath = path;
    scanlines.style.clipPath = path;
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
        seedInteresting();
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
        seedInteresting();
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
    /* Gutter painting shouldn't leave a stuck text selection */
    var sel = window.getSelection && window.getSelection();
    if (sel && sel.rangeCount) {
      sel.removeAllRanges();
    }
  }

  function onPointerMove(event) {
    if (inSideGutter(event.clientX)) {
      document.documentElement.style.cursor = "var(--cursor-paint)";
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

  function pauseLoop() {
    running = false;
    if (raf) {
      window.cancelAnimationFrame(raf);
      raf = 0;
    }
  }

  function startLoop() {
    if (raf) {
      return;
    }
    running = true;
    lastStep = 0;
    raf = window.requestAnimationFrame(tick);
  }

  function userPlay() {
    userPaused = false;
    startLoop();
    syncControls();
  }

  function userPause() {
    userPaused = true;
    pauseLoop();
    saveState();
    syncControls();
  }

  function randomize() {
    seedInteresting();
    draw();
    saveState();
    syncControls();
  }

  var controlsRoot = null;

  function syncControls() {
    if (!controlsRoot) {
      return;
    }
    var toggleBtn = controlsRoot.querySelector('[data-life-action="toggle"]');
    if (!toggleBtn) {
      return;
    }
    toggleBtn.setAttribute("aria-label", userPaused ? "Play" : "Pause");
    toggleBtn.setAttribute("aria-pressed", userPaused ? "false" : "true");
  }

  function placeControlsUnderLogo() {
    var logo = document.querySelector(".header__logo .logo");
    var headerLogo = document.querySelector(".header__logo");
    if (!logo || !headerLogo || !controlsRoot) {
      return;
    }
    /* Pin to the left edge of the name plate */
    controlsRoot.style.left = logo.offsetLeft + "px";
    controlsRoot.style.width = "";
  }

  function mountControls() {
    controlsRoot = document.createElement("div");
    controlsRoot.className = "life-controls";
    controlsRoot.setAttribute("aria-label", "Game of Life controls");

    /* Classic Life glider — more recognizable than a bare disclosure triangle */
    controlsRoot.innerHTML =
      '<div class="life-controls__tab" aria-hidden="true" title="Game of Life">' +
      '<svg class="life-controls__glider" viewBox="0 0 11 11" aria-hidden="true">' +
      '<rect x="0" y="0" width="3" height="3"/>' +
      '<rect x="4" y="0" width="3" height="3"/>' +
      '<rect x="8" y="0" width="3" height="3"/>' +
      '<rect x="0" y="4" width="3" height="3"/>' +
      '<rect x="4" y="8" width="3" height="3"/>' +
      "</svg></div>" +
      '<div class="life-controls__panel" role="toolbar" aria-label="Life simulation">' +
      '<button type="button" class="life-controls__btn" data-life-action="toggle" aria-label="Pause" aria-pressed="true">' +
      '<svg class="life-controls__icon life-controls__icon--playpause" viewBox="0 0 24 24" aria-hidden="true">' +
      '<path d="M3 6h2.5v12H3V6zm4 0h2.5v12H7V6z" fill="currentColor"/>' +
      '<path d="M12.5 6v12l9-6-9-6z" fill="currentColor"/>' +
      "</svg></button>" +
      '<button type="button" class="life-controls__btn life-controls__btn--randomize" data-life-action="randomize" aria-label="Randomize">' +
      '<svg class="life-controls__icon life-controls__icon--spin" viewBox="0 0 24 24" aria-hidden="true">' +
      '<path d="M12 4V1L8 5l4 4V6c3.31 0 6 2.69 6 6 0 1.01-.25 1.97-.7 2.8l1.46 1.46A7.93 7.93 0 0 0 20 12c0-4.42-3.58-8-8-8zm0 14c-3.31 0-6-2.69-6-6 0-1.01.25-1.97.7-2.8L5.24 7.74A7.93 7.93 0 0 0 4 12c0 4.42 3.58 8 8 8v3l4-4-4-4v3z" fill="currentColor"/>' +
      "</svg></button>" +
      '<a class="life-controls__btn" href="https://en.wikipedia.org/wiki/Conway%27s_Game_of_Life" target="_blank" rel="noopener" aria-label="About Conway’s Game of Life" title="About Conway’s Game of Life">' +
      '<svg class="life-controls__icon" viewBox="0 0 24 24" aria-hidden="true">' +
      '<circle cx="12" cy="17.25" r="1.35" fill="currentColor"/>' +
      '<path d="M12 6.2c-1.85 0-3.15 1.15-3.15 2.7 0 .45.1.85.3 1.15l1.45-.55c-.08-.2-.15-.4-.15-.65 0-.7.55-1.2 1.55-1.2s1.55.5 1.55 1.25c0 .75-.4 1.15-1.15 1.7-.85.6-1.4 1.25-1.4 2.25V14h1.7v-.55c0-.7.3-1.1 1.15-1.7.95-.65 1.55-1.4 1.55-2.55C14.9 7.4 13.7 6.2 12 6.2z" fill="currentColor"/>' +
      "</svg></a>" +
      "</div>";

    controlsRoot.addEventListener("click", function (event) {
      var btn = event.target.closest("[data-life-action]");
      if (!btn || !controlsRoot.contains(btn)) {
        return;
      }
      var action = btn.getAttribute("data-life-action");
      if (action === "toggle") {
        if (userPaused) {
          userPlay();
        } else {
          userPause();
        }
      } else if (action === "randomize") {
        randomize();
      }
    });

    var logo = document.querySelector(".header__logo .logo");
    var headerLogo = document.querySelector(".header__logo");
    if (logo && headerLogo) {
      headerLogo.insertBefore(controlsRoot, logo.nextSibling);
      placeControlsUnderLogo();
      window.addEventListener("resize", placeControlsUnderLogo);
      if (document.fonts && document.fonts.ready) {
        document.fonts.ready.then(placeControlsUnderLogo);
      }
    } else {
      document.body.appendChild(controlsRoot);
    }
    syncControls();
  }

  var resizeTimer = 0;
  window.addEventListener("resize", function () {
    window.clearTimeout(resizeTimer);
    resizeTimer = window.setTimeout(resize, 150);
  });

  window.addEventListener("scroll", updateClip, { passive: true });

  document.addEventListener("visibilitychange", function () {
    if (document.hidden) {
      pauseLoop();
    } else {
      updateClip();
      if (!userPaused) {
        startLoop();
      }
    }
  });

  window.addEventListener("pagehide", saveState);

  /* Paint in the side gutters only — content column stays fully clickable */
  window.addEventListener("pointerdown", onPointerDown, { passive: false });
  window.addEventListener("pointermove", onPointerMove, { passive: false });
  window.addEventListener("pointerup", onPointerUp);
  window.addEventListener("pointercancel", onPointerUp);

  mountControls();
  resize();
  startLoop();
})();
