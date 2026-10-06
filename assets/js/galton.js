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

  var ctx = canvas.getContext("2d");
  var rows = rowsInput ? Math.round(Number(rowsInput.value)) || 12 : 12;
  var binsCount = rows + 1;
  var stageMax = rows + 1;
  var reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  var layout = null;
  var bins = new Array(binsCount).fill(0);
  var balls = [];
  var total = 0;
  var playing = false;
  var spawnAcc = 0;
  var bias = 0.5;
  var ballsPerSec = speedInput ? Number(speedInput.value) || 1 : 1;
  var fallSeconds = fallInput ? Number(fallInput.value) || 1.2 : 1.2;
  var raf = 0;
  var lastTs = 0;

  function syncCount() {
    if (countEl) {
      countEl.textContent = total + (total === 1 ? " ball" : " balls");
    }
  }

  function clearBoard() {
    bins = new Array(binsCount).fill(0);
    balls = [];
    total = 0;
    spawnAcc = 0;
    syncCount();
  }

  function setRows(next) {
    rows = Math.max(4, Math.min(100, Math.round(next)));
    binsCount = rows + 1;
    stageMax = rows + 1;
    if (rowsInput) {
      rowsInput.value = String(rows);
    }
    clearBoard();
    buildLayout();
    drawBoard();
  }

  function pegXY(row, index) {
    var x = layout.cx + (index - row / 2) * layout.gapX;
    var y = layout.top + row * layout.gapY;
    return { x: x, y: y };
  }

  function buildLayout() {
    var dpr = Math.min(window.devicePixelRatio || 1, 2);
    var cssW = canvas.clientWidth || 720;
    var cssH = Math.max(420, Math.round(cssW * 0.9));
    canvas.width = Math.round(cssW * dpr);
    canvas.height = Math.round(cssH * dpr);
    canvas.style.height = cssH + "px";
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    var padX = Math.max(16, cssW * 0.06);
    var gapX = (cssW - padX * 2) / rows;
    var gapY = Math.min(36, (cssH * 0.55) / rows);
    var top = 28;
    var binTop = top + rows * gapY + 18;
    var binH = cssH - binTop - 18;

    layout = {
      w: cssW,
      h: cssH,
      cx: cssW / 2,
      top: top,
      gapX: gapX,
      gapY: gapY,
      pegR: Math.max(2.2, gapX * 0.12),
      ballR: Math.max(3.2, gapX * 0.18),
      binTop: binTop,
      binH: binH,
      binW: gapX
    };
  }

  function spawnBall() {
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
  }

  function settle(ball) {
    bins[ball.bin] += 1;
    total += 1;
    syncCount();
  }

  function ballPos(ball) {
    var stage = ball.t;
    var row = Math.floor(stage);
    var frac = stage - row;
    var from;
    var to;
    var x;
    var y;

    if (row < 0) {
      from = { x: layout.cx, y: 8 };
      to = pegXY(0, 0);
      frac = stage + 1;
      x = from.x + (to.x - from.x) * frac;
      y = from.y + (to.y - from.y) * frac;
      return { x: x, y: y };
    }

    if (row >= rows) {
      from = pegXY(rows - 1, ball.path[rows - 1]);
      to = {
        x: layout.cx + (ball.bin - rows / 2) * layout.gapX,
        y: layout.binTop + 10
      };
      frac = Math.min(1, stage - rows);
      /* ease into the bin */
      var ease = frac * frac;
      x = from.x + (to.x - from.x) * frac;
      y = from.y + (to.y - from.y) * ease;
      return { x: x, y: y };
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

    /* slight arc over each peg */
    var midY = (from.y + to.y) / 2 - layout.gapY * 0.12;
    x = from.x + (to.x - from.x) * frac;
    y =
      (1 - frac) * (1 - frac) * from.y +
      2 * (1 - frac) * frac * midY +
      frac * frac * to.y;
    return { x: x, y: y };
  }

  function drawBoard() {
    var i;
    var r;
    var p;
    var maxBin = 1;
    var barH;
    var bx;
    var curve;

    ctx.clearRect(0, 0, layout.w, layout.h);

    /* funnel */
    ctx.strokeStyle = "hsla(136, 89%, 40%, 0.55)";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(layout.cx - layout.gapX * 0.7, 4);
    ctx.lineTo(layout.cx - layout.pegR, layout.top - 2);
    ctx.moveTo(layout.cx + layout.gapX * 0.7, 4);
    ctx.lineTo(layout.cx + layout.pegR, layout.top - 2);
    ctx.stroke();

    /* pegs */
    ctx.fillStyle = "hsla(136, 89%, 40%, 0.85)";
    for (r = 0; r < rows; r += 1) {
      for (i = 0; i <= r; i += 1) {
        p = pegXY(r, i);
        ctx.beginPath();
        ctx.arc(p.x, p.y, layout.pegR, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    for (i = 0; i < binsCount; i += 1) {
      if (bins[i] > maxBin) {
        maxBin = bins[i];
      }
    }

    /* bin walls + bars */
    for (i = 0; i < binsCount; i += 1) {
      bx = layout.cx + (i - rows / 2) * layout.gapX;
      ctx.strokeStyle = "hsla(136, 89%, 40%, 0.35)";
      ctx.beginPath();
      ctx.moveTo(bx - layout.binW / 2, layout.binTop);
      ctx.lineTo(bx - layout.binW / 2, layout.h - 14);
      ctx.stroke();

      barH = maxBin ? (bins[i] / maxBin) * (layout.binH - 8) : 0;
      if (barH > 0) {
        ctx.fillStyle = "hsla(136, 89%, 40%, 0.55)";
        ctx.fillRect(
          bx - layout.binW / 2 + 2,
          layout.h - 14 - barH,
          layout.binW - 4,
          barH
        );
      }

      if (bins[i] > 0) {
        ctx.fillStyle = "hsla(136, 89%, 55%, 0.9)";
        ctx.font = "11px \"JetBrains Mono\", monospace";
        ctx.textAlign = "center";
        ctx.fillText(String(bins[i]), bx, layout.h - 2);
      }
    }
    ctx.strokeStyle = "hsla(136, 89%, 40%, 0.35)";
    ctx.beginPath();
    bx = layout.cx + (binsCount - 1 - rows / 2) * layout.gapX;
    ctx.moveTo(bx + layout.binW / 2, layout.binTop);
    ctx.lineTo(bx + layout.binW / 2, layout.h - 14);
    ctx.stroke();

    /* binomial reference curve */
    if (total >= 8) {
      curve = [];
      var coeff = 1;
      var sum = 0;
      var probs = [];
      for (i = 0; i < binsCount; i += 1) {
        if (i === 0) {
          coeff = 1;
        } else {
          coeff = (coeff * (rows - i + 1)) / i;
        }
        probs[i] =
          coeff *
          Math.pow(bias, i) *
          Math.pow(1 - bias, rows - i);
        sum += probs[i];
      }
      ctx.strokeStyle = "hsla(136, 89%, 55%, 0.45)";
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      for (i = 0; i < binsCount; i += 1) {
        bx = layout.cx + (i - rows / 2) * layout.gapX;
        barH = ((probs[i] / sum) * total) / maxBin * (layout.binH - 8);
        var cy = layout.h - 14 - barH;
        if (i === 0) {
          ctx.moveTo(bx, cy);
        } else {
          ctx.lineTo(bx, cy);
        }
      }
      ctx.stroke();
    }

    /* balls */
    ctx.fillStyle = "hsla(136, 89%, 62%, 0.95)";
    for (i = 0; i < balls.length; i += 1) {
      p = ballPos(balls[i]);
      ctx.beginPath();
      ctx.arc(p.x, p.y, layout.ballR, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  function syncToggle() {
    if (!toggleBtn) {
      return;
    }
    toggleBtn.setAttribute("aria-label", playing ? "Pause" : "Play");
    toggleBtn.setAttribute("aria-pressed", playing ? "true" : "false");
    toggleBtn.classList.toggle("is-active", playing);
  }

  function tick(ts) {
    if (!lastTs) {
      lastTs = ts;
    }
    var dt = Math.min(0.2, (ts - lastTs) / 1000);
    lastTs = ts;

    if (playing) {
      spawnAcc += dt * ballsPerSec;
      while (spawnAcc >= 1) {
        spawnAcc -= 1;
        spawnBall();
      }

      var next = [];
      var i;
      var ball;
      var stageRate = stageMax / Math.max(0.2, fallSeconds);
      for (i = 0; i < balls.length; i += 1) {
        ball = balls[i];
        ball.t += stageRate * dt;
        if (ball.t >= stageMax) {
          settle(ball);
        } else {
          next.push(ball);
        }
      }
      balls = next;
    }

    drawBoard();
    raf = window.requestAnimationFrame(tick);
  }

  if (toggleBtn) {
    toggleBtn.addEventListener("click", function () {
      playing = !playing;
      if (playing) {
        lastTs = 0;
        spawnAcc = 0;
      }
      syncToggle();
    });
  }

  if (resetBtn) {
    resetBtn.addEventListener("click", function () {
      clearBoard();
      drawBoard();
    });
  }

  if (rowsInput) {
    rowsInput.addEventListener("change", function () {
      setRows(Number(rowsInput.value));
    });
  }

  if (speedInput) {
    speedInput.addEventListener("input", function () {
      var next = Number(speedInput.value);
      if (!isFinite(next)) {
        return;
      }
      ballsPerSec = Math.max(0.1, Math.min(100, next));
      speedInput.value = String(ballsPerSec);
    });
  }

  if (fallInput) {
    fallInput.addEventListener("input", function () {
      var next = Number(fallInput.value);
      if (!isFinite(next)) {
        return;
      }
      fallSeconds = Math.max(0.2, Math.min(10, next));
      fallInput.value = String(fallSeconds);
    });
  }

  if (biasInput) {
    biasInput.addEventListener("input", function () {
      bias = Number(biasInput.value);
      if (biasLabel) {
        biasLabel.textContent = bias.toFixed(2);
      }
    });
  }

  buildLayout();
  syncToggle();
  drawBoard();
  raf = window.requestAnimationFrame(tick);

  window.addEventListener("resize", function () {
    buildLayout();
    drawBoard();
  });

  if (reducedMotion) {
    playing = false;
    syncToggle();
    for (var k = 0; k < 40; k += 1) {
      spawnBall();
      balls[balls.length - 1].t = rows + 1;
      settle(balls.pop());
    }
    drawBoard();
  }
})();
