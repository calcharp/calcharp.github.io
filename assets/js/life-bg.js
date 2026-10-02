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
  var FILL = "hsla(136, 89%, 40%, 0.7)";
  var cols = 0;
  var rows = 0;
  var grid = null;
  var next = null;
  var raf = 0;
  var lastStep = 0;
  var stagnant = 0;
  var running = true;

  function seed() {
    var i;
    for (i = 0; i < grid.length; i += 1) {
      grid[i] = Math.random() < 0.14 ? 1 : 0;
    }
    stagnant = 0;
  }

  function resize() {
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
    seed();
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
  }

  var resizeTimer = 0;
  window.addEventListener("resize", function () {
    window.clearTimeout(resizeTimer);
    resizeTimer = window.setTimeout(resize, 150);
  });

  document.addEventListener("visibilitychange", function () {
    if (document.hidden) {
      stop();
    } else {
      start();
    }
  });

  resize();
  start();
})();
