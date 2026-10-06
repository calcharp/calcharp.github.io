(function () {
  var root = document.querySelector("[data-galton]");
  if (!root) {
    return;
  }

  var canvas = root.querySelector(".galton__canvas");
  var countEl = root.querySelector("[data-galton-count]");
  var biasInput = root.querySelector("[data-galton-bias]");
  var biasLabel = root.querySelector("[data-galton-bias-label]");
  var speedInput = root.querySelector("[data-galton-speed]");
  var fallInput = root.querySelector("[data-galton-fall]");
  var rowsInput = root.querySelector("[data-galton-rows]");
  var toggleBtn = root.querySelector('[data-galton-action="toggle"]');
  var resetBtn = root.querySelector('[data-galton-action="reset"]');
  if (!canvas || !canvas.getContext) {
    return;
  }

  var ctx = canvas.getContext("2d", { alpha: false });
  var staticCanvas = document.createElement("canvas");
  var staticCtx = staticCanvas.getContext("2d");

  var rows = rowsInput ? Math.round(Number(rowsInput.value)) || 12 : 12;
  var binsCount = rows + 1;
  var stageMax = rows + 1;
  var reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  var layout = null;
  var pegs = [];
  var bins = new Array(binsCount).fill(0);
  var balls = [];
  var total = 0;
  var playing = false;
  var spawnAcc = 0;
  var bias = biasInput ? Number(biasInput.value) : 0.5;
  if (!isFinite(bias)) {
    bias = 0.5;
  }
  var ballsPerSec = speedInput ? Number(speedInput.value) || 1 : 1;
  var fallSeconds = fallInput ? Number(fallInput.value) || 1.2 : 1.2;
  var timer = 0;
  var lastTs = 0;
  var countDirty = false;
  var MAX_IN_FLIGHT = 400;
  var MAX_SPAWNS_PER_FRAME = 48;
  var MAX_CATCH_UP = 0.25;
  var FIXED_DT = 1 / 60;
  var TICK_MS = 1000 / 60;

  function syncCount() {
    if (countEl) {
      countEl.textContent = total + (total === 1 ? " ball" : " balls");
    }
    countDirty = false;
  }

  function clearBoard() {
    bins = new Array(binsCount).fill(0);
    balls = [];
    total = 0;
    spawnAcc = 0;
    syncCount();
    paint();
  }

  function setRows(next) {
    var value = Math.max(4, Math.min(100, Math.round(next)));
    if (value === rows && bins.length === value + 1) {
      if (rowsInput) {
        rowsInput.value = String(value);
      }
      return;
    }
    rows = value;
    binsCount = rows + 1;
    stageMax = rows + 1;
    if (rowsInput) {
      rowsInput.value = String(rows);
    }
    bins = new Array(binsCount).fill(0);
    balls = [];
    total = 0;
    spawnAcc = 0;
    syncCount();
    buildLayout();
    paint();
  }

  function pegXY(row, index) {
    return {
      x: layout.cx + (index - row / 2) * layout.gapX,
      y: layout.top + row * layout.gapY
    };
  }

  function buildLayout() {
    var dpr = Math.min(window.devicePixelRatio || 1, 2);
    var cssW = canvas.clientWidth || 720;
    var pegBand = Math.min(0.58, 0.35 + rows * 0.01);
    var cssH = Math.max(440, Math.round(cssW * (0.75 + Math.min(rows, 40) * 0.008)));
    canvas.width = Math.round(cssW * dpr);
    canvas.height = Math.round(cssH * dpr);
    canvas.style.height = cssH + "px";
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    staticCanvas.width = canvas.width;
    staticCanvas.height = canvas.height;
    staticCtx.setTransform(dpr, 0, 0, dpr, 0, 0);

    var padX = Math.max(16, cssW * 0.06);
    var gapX = (cssW - padX * 2) / Math.max(rows, 1);
    var gapY = Math.min(34, (cssH * pegBand) / Math.max(rows, 1));
    var top = 28;
    var binTop = top + rows * gapY + 18;
    var binH = Math.max(48, cssH - binTop - 18);

    layout = {
      w: cssW,
      h: cssH,
      cx: cssW / 2,
      top: top,
      gapX: gapX,
      gapY: gapY,
      pegR: Math.max(1.6, Math.min(4.5, gapX * 0.14)),
      ballR: Math.max(2.4, Math.min(5.5, gapX * 0.2)),
      binTop: binTop,
      binH: binH,
      binW: gapX,
      dpr: dpr
    };

    pegs = [];
    var r;
    var i;
    for (r = 0; r < rows; r += 1) {
      for (i = 0; i <= r; i += 1) {
        pegs.push(pegXY(r, i));
      }
    }

    rebuildStatic();
  }

  function rebuildStatic() {
    var i;
    var p;
    var bx;

    staticCtx.fillStyle = "hsl(0, 0%, 2%)";
    staticCtx.fillRect(0, 0, layout.w, layout.h);

    staticCtx.strokeStyle = "hsla(136, 89%, 40%, 0.55)";
    staticCtx.lineWidth = 1.5;
    staticCtx.beginPath();
    staticCtx.moveTo(layout.cx - layout.gapX * 0.7, 4);
    staticCtx.lineTo(layout.cx - layout.pegR, layout.top - 2);
    staticCtx.moveTo(layout.cx + layout.gapX * 0.7, 4);
    staticCtx.lineTo(layout.cx + layout.pegR, layout.top - 2);
    staticCtx.stroke();

    staticCtx.fillStyle = "hsla(136, 89%, 40%, 0.85)";
    if (pegs.length > 2500) {
      /* Dense boards: one path, fewer state changes */
      staticCtx.beginPath();
      for (i = 0; i < pegs.length; i += 1) {
        p = pegs[i];
        staticCtx.moveTo(p.x + layout.pegR, p.y);
        staticCtx.arc(p.x, p.y, layout.pegR, 0, Math.PI * 2);
      }
      staticCtx.fill();
    } else {
      for (i = 0; i < pegs.length; i += 1) {
        p = pegs[i];
        staticCtx.beginPath();
        staticCtx.arc(p.x, p.y, layout.pegR, 0, Math.PI * 2);
        staticCtx.fill();
      }
    }

    staticCtx.strokeStyle = "hsla(136, 89%, 40%, 0.35)";
    staticCtx.beginPath();
    for (i = 0; i < binsCount; i += 1) {
      bx = layout.cx + (i - rows / 2) * layout.gapX;
      staticCtx.moveTo(bx - layout.binW / 2, layout.binTop);
      staticCtx.lineTo(bx - layout.binW / 2, layout.h - 14);
    }
    bx = layout.cx + (binsCount - 1 - rows / 2) * layout.gapX;
    staticCtx.moveTo(bx + layout.binW / 2, layout.binTop);
    staticCtx.lineTo(bx + layout.binW / 2, layout.h - 14);
    staticCtx.stroke();
  }

  function spawnBall() {
    if (balls.length >= MAX_IN_FLIGHT) {
      return false;
    }
    var path = [];
    var col = 0;
    var i;
    for (i = 0; i < rows; i += 1) {
      path.push(col);
      if (Math.random() < bias) {
        col += 1;
      }
    }
    balls.push({
      path: path,
      bin: col,
      t: 0
    });
    return true;
  }

  function settle(ball) {
    bins[ball.bin] += 1;
    total += 1;
    countDirty = true;
  }

  function ballPos(ball) {
    var stage = ball.t;
    var row = Math.floor(stage);
    var frac = stage - row;
    var from;
    var to;
    var midY;
    var ease;

    if (row >= rows) {
      from = pegXY(rows - 1, ball.path[rows - 1]);
      to = {
        x: layout.cx + (ball.bin - rows / 2) * layout.gapX,
        y: layout.binTop + 10
      };
      frac = Math.min(1, stage - rows);
      ease = frac * frac;
      return {
        x: from.x + (to.x - from.x) * frac,
        y: from.y + (to.y - from.y) * ease
      };
    }

    from = pegXY(row, ball.path[row]);
    if (row + 1 >= rows) {
      to = {
        x: layout.cx + (ball.bin - rows / 2) * layout.gapX,
        y: layout.binTop - 4
      };
    } else {
      to = pegXY(row + 1, ball.path[row + 1]);
    }

    midY = (from.y + to.y) / 2 - layout.gapY * 0.12;
    return {
      x: from.x + (to.x - from.x) * frac,
      y:
        (1 - frac) * (1 - frac) * from.y +
        2 * (1 - frac) * frac * midY +
        frac * frac * to.y
    };
  }

  function paint() {
    var i;
    var p;
    var maxBin = 1;
    var barH;
    var bx;
    var sum = 0;
    var probs;
    var cy;
    var pRight;
    var pLeft;

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(staticCanvas, 0, 0);
    ctx.setTransform(layout.dpr, 0, 0, layout.dpr, 0, 0);

    for (i = 0; i < binsCount; i += 1) {
      if (bins[i] > maxBin) {
        maxBin = bins[i];
      }
    }

    ctx.fillStyle = "hsla(136, 89%, 40%, 0.55)";
    for (i = 0; i < binsCount; i += 1) {
      bx = layout.cx + (i - rows / 2) * layout.gapX;
      barH = maxBin ? (bins[i] / maxBin) * (layout.binH - 8) : 0;
      if (barH > 0) {
        ctx.fillRect(
          bx - layout.binW / 2 + 2,
          layout.h - 14 - barH,
          Math.max(1, layout.binW - 4),
          barH
        );
      }
    }

    if (rows <= 40) {
      ctx.fillStyle = "hsla(136, 89%, 55%, 0.9)";
      ctx.font = "11px \"JetBrains Mono\", monospace";
      ctx.textAlign = "center";
      for (i = 0; i < binsCount; i += 1) {
        if (bins[i] > 0) {
          bx = layout.cx + (i - rows / 2) * layout.gapX;
          ctx.fillText(String(bins[i]), bx, layout.h - 2);
        }
      }
    }

    if (total >= 8 && rows <= 48) {
      probs = new Array(binsCount);
      pRight = Math.min(0.999, Math.max(0.001, bias));
      pLeft = 1 - pRight;
      probs[0] = Math.pow(pLeft, rows);
      sum = probs[0];
      for (i = 1; i < binsCount; i += 1) {
        probs[i] = probs[i - 1] * ((rows - i + 1) / i) * (pRight / pLeft);
        sum += probs[i];
      }
      if (sum > 0 && isFinite(sum)) {
        ctx.strokeStyle = "hsla(136, 89%, 55%, 0.45)";
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        for (i = 0; i < binsCount; i += 1) {
          bx = layout.cx + (i - rows / 2) * layout.gapX;
          barH = ((probs[i] / sum) * total) / maxBin * (layout.binH - 8);
          cy = layout.h - 14 - barH;
          if (i === 0) {
            ctx.moveTo(bx, cy);
          } else {
            ctx.lineTo(bx, cy);
          }
        }
        ctx.stroke();
      }
    }

    ctx.fillStyle = "hsla(136, 89%, 62%, 0.95)";
    for (i = 0; i < balls.length; i += 1) {
      p = ballPos(balls[i]);
      ctx.beginPath();
      ctx.arc(p.x, p.y, layout.ballR, 0, Math.PI * 2);
      ctx.fill();
    }

    if (countDirty) {
      syncCount();
    }
  }

  function simulate(dt) {
    spawnAcc += dt * ballsPerSec;
    var spawns = 0;
    while (spawnAcc >= 1 && spawns < MAX_SPAWNS_PER_FRAME) {
      if (!spawnBall()) {
        spawnAcc = Math.min(spawnAcc, 1);
        break;
      }
      spawnAcc -= 1;
      spawns += 1;
    }
    if (balls.length >= MAX_IN_FLIGHT) {
      spawnAcc = Math.min(spawnAcc, 1);
    }

    var next = [];
    var i;
    var ball;
    var step = (stageMax / Math.max(0.2, fallSeconds)) * dt;
    for (i = 0; i < balls.length; i += 1) {
      ball = balls[i];
      ball.t += step;
      if (ball.t >= stageMax) {
        settle(ball);
      } else {
        next.push(ball);
      }
    }
    balls = next;
  }

  function syncToggle() {
    if (!toggleBtn) {
      return;
    }
    toggleBtn.setAttribute("aria-label", playing ? "Pause" : "Play");
    toggleBtn.setAttribute("aria-pressed", playing ? "true" : "false");
    toggleBtn.classList.toggle("is-active", playing);
  }

  function stopLoop() {
    if (timer) {
      window.clearInterval(timer);
      timer = 0;
    }
    lastTs = 0;
  }

  function tick() {
    if (!playing) {
      stopLoop();
      return;
    }
    var now = performance.now();
    if (!lastTs) {
      lastTs = now;
    }
    var elapsed = Math.min(MAX_CATCH_UP, (now - lastTs) / 1000);
    lastTs = now;

    if (elapsed > 0) {
      var left = elapsed;
      while (left > 0.0001) {
        var dt = Math.min(FIXED_DT, left);
        left -= dt;
        simulate(dt);
      }
    }

    paint();
  }

  function ensureLoop() {
    if (timer) {
      return;
    }
    lastTs = performance.now();
    timer = window.setInterval(tick, TICK_MS);
  }

  if (toggleBtn) {
    toggleBtn.addEventListener("click", function () {
      playing = !playing;
      if (playing) {
        ensureLoop();
      } else {
        stopLoop();
        paint();
      }
      syncToggle();
    });
  }

  if (resetBtn) {
    resetBtn.addEventListener("click", function () {
      clearBoard();
    });
  }

  function readNumber(input) {
    var raw = String(input.value).trim();
    if (raw === "" || raw === "." || raw === "-" || raw === "-." || raw === "+") {
      return null;
    }
    if (/\.$/.test(raw)) {
      return null;
    }
    var next = Number(raw);
    if (!isFinite(next)) {
      return null;
    }
    return next;
  }

  function bindNumeric(input, onLive, onCommit) {
    if (!input) {
      return;
    }
    input.addEventListener("focus", function () {
      input.select();
    });
    input.addEventListener("input", function () {
      var next = readNumber(input);
      if (next == null) {
        return;
      }
      onLive(next);
    });
    function commit() {
      onCommit();
    }
    input.addEventListener("change", commit);
    input.addEventListener("blur", commit);
    input.addEventListener("keydown", function (event) {
      if (event.key === "Enter") {
        event.preventDefault();
        input.blur();
      }
    });
  }

  bindNumeric(
    speedInput,
    function (next) {
      ballsPerSec = Math.max(0.1, Math.min(100, next));
    },
    function () {
      var next = readNumber(speedInput);
      ballsPerSec = Math.max(0.1, Math.min(100, next == null ? ballsPerSec : next));
      if (speedInput.value !== String(ballsPerSec)) {
        speedInput.value = String(ballsPerSec);
      }
    }
  );

  bindNumeric(
    fallInput,
    function (next) {
      fallSeconds = Math.max(0.2, Math.min(10, next));
    },
    function () {
      var next = readNumber(fallInput);
      fallSeconds = Math.max(0.2, Math.min(10, next == null ? fallSeconds : next));
      if (fallInput.value !== String(fallSeconds)) {
        fallInput.value = String(fallSeconds);
      }
    }
  );

  if (rowsInput) {
    rowsInput.addEventListener("focus", function () {
      rowsInput.select();
    });
    rowsInput.addEventListener("change", function () {
      var next = readNumber(rowsInput);
      setRows(next == null ? rows : next);
    });
    rowsInput.addEventListener("blur", function () {
      var next = readNumber(rowsInput);
      setRows(next == null ? rows : next);
    });
    rowsInput.addEventListener("keydown", function (event) {
      if (event.key === "Enter") {
        event.preventDefault();
        rowsInput.blur();
      }
    });
  }

  if (biasInput) {
    biasInput.addEventListener("input", function () {
      bias = Number(biasInput.value);
      if (!isFinite(bias)) {
        return;
      }
      if (biasLabel) {
        biasLabel.textContent = bias.toFixed(2);
      }
      if (!playing) {
        paint();
      }
    });
  }

  var resizeTimer = 0;
  window.addEventListener("resize", function () {
    window.clearTimeout(resizeTimer);
    resizeTimer = window.setTimeout(function () {
      buildLayout();
      paint();
    }, 100);
  });

  buildLayout();
  syncToggle();
  paint();

  if (reducedMotion) {
    playing = false;
    syncToggle();
    for (var k = 0; k < 40; k += 1) {
      spawnBall();
      balls[balls.length - 1].t = stageMax;
      settle(balls.pop());
    }
    paint();
  }
})();
