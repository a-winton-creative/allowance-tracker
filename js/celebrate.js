/* Payday celebration: a themed burst over one kid's half, plus a banner.
 * No sound. Plays for about 3 seconds; a tap ends it early.
 * People who've turned on "Reduce Motion" get the banner without flying bits.
 */
(function () {
  var DURATION = 3200;
  var reduce = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;

  // ---------------------------------------------------------------- shapes

  function star4(c, s) {
    c.beginPath();
    for (var i = 0; i < 8; i++) {
      var r = i % 2 ? s * 0.32 : s, a = i * Math.PI / 4;
      c.lineTo(Math.cos(a) * r, Math.sin(a) * r);
    }
    c.closePath(); c.fill();
  }
  function heart(c, s) {
    c.beginPath();
    c.moveTo(0, s * 0.35);
    c.bezierCurveTo(-s * 1.1, -s * 0.35, -s * 0.45, -s * 1.05, 0, -s * 0.45);
    c.bezierCurveTo(s * 0.45, -s * 1.05, s * 1.1, -s * 0.35, 0, s * 0.35);
    c.fill();
  }
  function paw(c, s) {
    c.beginPath(); c.ellipse(0, s * 0.25, s * 0.5, s * 0.42, 0, 0, Math.PI * 2); c.fill();
    [[-0.55, -0.35], [-0.2, -0.65], [0.2, -0.65], [0.55, -0.35]].forEach(function (p) {
      c.beginPath(); c.arc(p[0] * s, p[1] * s, s * 0.2, 0, Math.PI * 2); c.fill();
    });
  }
  function feather(c, s, color) {
    c.beginPath(); c.ellipse(0, 0, s * 0.32, s, 0, 0, Math.PI * 2); c.fill();
    c.strokeStyle = 'rgba(60,40,20,.55)'; c.lineWidth = Math.max(1, s * 0.08);
    c.beginPath(); c.moveTo(0, -s); c.lineTo(0, s * 1.35); c.stroke();
  }
  function coin(c, s, color, p) {
    var squash = Math.abs(Math.cos(p.spin));
    c.scale(Math.max(0.15, squash), 1);
    c.beginPath(); c.arc(0, 0, s, 0, Math.PI * 2); c.fill();
    c.strokeStyle = 'rgba(120,80,10,.7)'; c.lineWidth = s * 0.18;
    c.beginPath(); c.arc(0, 0, s * 0.68, 0, Math.PI * 2); c.stroke();
    c.fillStyle = 'rgba(255,255,255,.55)';
    c.beginPath(); c.arc(-s * 0.3, -s * 0.3, s * 0.22, 0, Math.PI * 2); c.fill();
  }
  function bolt(c, s) {
    c.lineWidth = Math.max(2, s * 0.25); c.lineJoin = 'round';
    c.beginPath(); c.moveTo(-s * 0.2, -s); c.lineTo(s * 0.25, -s * 0.15); c.lineTo(-s * 0.15, s * 0.05); c.lineTo(s * 0.2, s); c.stroke();
  }
  function streak(c, s) {
    var g = c.createLinearGradient(-s * 3, 0, 0, 0);
    g.addColorStop(0, 'rgba(255,255,255,0)'); g.addColorStop(1, c.fillStyle);
    c.strokeStyle = g; c.lineWidth = Math.max(2, s * 0.3); c.lineCap = 'round';
    c.beginPath(); c.moveTo(-s * 3, 0); c.lineTo(0, 0); c.stroke();
    c.beginPath(); c.arc(0, 0, s * 0.35, 0, Math.PI * 2); c.fill();
  }

  function drawShape(c, p) {
    c.fillStyle = p.color; c.strokeStyle = p.color;
    switch (p.shape) {
      case 'spark': c.shadowColor = p.color; c.shadowBlur = p.size * 2; c.beginPath(); c.arc(0, 0, p.size * 0.5, 0, Math.PI * 2); c.fill(); break;
      case 'star': c.shadowColor = p.color; c.shadowBlur = p.size; star4(c, p.size); break;
      case 'square': c.fillRect(-p.size / 2, -p.size / 2, p.size, p.size); break;
      case 'coin': coin(c, p.size, p.color, p); break;
      case 'heart': heart(c, p.size); break;
      case 'paw': paw(c, p.size); break;
      case 'feather': feather(c, p.size, p.color); break;
      case 'bolt': c.shadowColor = p.color; c.shadowBlur = p.size; bolt(c, p.size); break;
      case 'streak': streak(c, p.size); break;
    }
  }

  // ---------------------------------------------------------------- theme recipes

  function rnd(a, b) { return a + Math.random() * (b - a); }
  var originY = 200;   // where sparks burst from (the balance card), set by play()
  function pick(a) { return a[Math.floor(Math.random() * a.length)]; }

  /** Each recipe makes one particle. (w, h) is the half's size. */
  var RECIPES = {
    'fire-dragon': { count: 150, gravity: -60, make: burstUp(['spark'], ['#ffd28f', '#ffb347', '#ff7a2b', '#ff4d1a']) },
    'storm-dragon': { count: 140, gravity: -40, make: mix(burstUp(['spark', 'spark', 'bolt'], ['#e6d6ff', '#c9a2ff', '#9b6bff'])) },
    'sea-dragon': { count: 140, gravity: -50, make: burstUp(['star', 'spark'], ['#b8fff3', '#7ff0dc', '#2fd1c0']) },
    'block-world': { count: 90, gravity: 900, make: fountain(['square', 'square', 'coin'], ['#9be15d', '#ffb03b', '#8fd3ff', '#ffd34d']) },
    'bird-field-guide': { count: 60, gravity: 60, make: drift(['feather'], ['#a0522d', '#c9a27a', '#8b6542', '#f6eddc', '#6f8c63']) },
    'kitty-cafe': { count: 80, gravity: 220, make: drift(['heart', 'paw', 'heart'], ['#ff8fbf', '#ffb3cf', '#a678e0', '#ff7aa8']) },
    'moon-crows': { count: 100, gravity: 0, make: shooting(['streak', 'star', 'star'], ['#ffffff', '#e8e6d8', '#c8ccff']) },
    'quest': { count: 70, gravity: 700, make: rain(['coin'], ['#ffd34d', '#e3bf62', '#f1d38a']) }
  };

  // sparks bursting up and out from near the balance
  function burstUp(shapes, colors) {
    return function (w, h) {
      var a = rnd(-Math.PI, 0.2), sp = rnd(300, 900);
      return { x: w * rnd(0.3, 0.7), y: originY, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, delay: rnd(0, 0.5),
               shape: pick(shapes), color: pick(colors), size: rnd(6, 14), life: rnd(1.6, 2.8), drag: 0.975 };
    };
  }
  function mix(f) { return f; }
  // blocks pop up from the bottom and tumble down
  function fountain(shapes, colors) {
    return function (w, h) {
      return { x: w * rnd(0.15, 0.85), y: h + 20, vx: rnd(-160, 160), vy: rnd(-1250, -800), spin: rnd(0, 6), vspin: rnd(-8, 8),
               rot: 0, vr: rnd(-4, 4), shape: pick(shapes), color: pick(colors), size: rnd(12, 22), life: rnd(2.2, 3.1), drag: 0.99 };
    };
  }
  // gentle falling and swaying
  function drift(shapes, colors) {
    return function (w, h) {
      return { x: rnd(0, w), y: rnd(-h * 0.45, h * 0.15), vx: rnd(-30, 30), vy: rnd(130, 230), sway: rnd(0.8, 2), phase: rnd(0, 6),
               rot: rnd(-0.6, 0.6), vr: rnd(-1, 1), shape: pick(shapes), color: pick(colors), size: rnd(12, 22), life: 3.3, drag: 1 };
    };
  }
  // streaks across the sky plus twinkles
  function shooting(shapes, colors) {
    return function (w, h) {
      var s = pick(shapes);
      if (s === 'streak') return { x: rnd(-w * 0.3, w * 0.6), y: rnd(-40, h * 0.4), vx: rnd(500, 900), vy: rnd(150, 320), rot: 0.3,
                                   shape: s, color: pick(colors), size: rnd(5, 9), life: rnd(1, 2), delay: rnd(0, 1.2), drag: 1, aim: true };
      return { x: rnd(0, w), y: rnd(0, h * 0.8), vx: 0, vy: 0, shape: s, color: pick(colors), size: rnd(4, 9), life: rnd(0.8, 1.8), delay: rnd(0, 2), drag: 1, twinkle: true };
    };
  }
  // coins falling from the top
  function rain(shapes, colors) {
    return function (w, h) {
      return { x: rnd(0, w), y: rnd(-h * 0.8, -20), vx: rnd(-40, 40), vy: rnd(100, 260), spin: rnd(0, 6), vspin: rnd(5, 12),
               shape: pick(shapes), color: pick(colors), size: rnd(10, 16), life: 3.4, drag: 1 };
    };
  }

  // ---------------------------------------------------------------- play

  /**
   * half: the kid's <section>; slug: theme slug; banner: {title, line}
   * Resolves when finished.
   */
  function play(half, slug, banner, opts) {
    opts = opts || {};
    return new Promise(function (resolve) {
      var layer = document.createElement('div');
      layer.className = 'celebrate';
      layer.innerHTML = '<canvas aria-hidden="true"></canvas>' +
        '<div class="celebrate-banner glass" role="status"><div class="celebrate-title">' + banner.title + '</div>' +
        '<div class="celebrate-line">' + banner.line + '</div></div>';
      if (opts.bannerTop) layer.style.paddingTop = opts.bannerTop + 'px';
      half.appendChild(layer);
      originY = opts.burstY || 200;
      var canvas = layer.querySelector('canvas');
      var w = half.clientWidth, h = Math.min(half.clientHeight, window.innerHeight * 1.2);
      var dpr = Math.min(2, window.devicePixelRatio || 1);
      canvas.width = w * dpr; canvas.height = h * dpr;
      canvas.style.width = w + 'px'; canvas.style.height = h + 'px';
      var c = canvas.getContext('2d');
      c.scale(dpr, dpr);

      var recipe = RECIPES[slug] || RECIPES['fire-dragon'];
      var parts = [];
      if (!reduce) for (var i = 0; i < recipe.count; i++) { var p = recipe.make(w, h); p.age = 0; p.rot = p.rot || 0; parts.push(p); }

      var start = performance.now(), last = start, done = false;
      function finish() {
        if (done) return;
        done = true;
        layer.classList.add('is-leaving');
        setTimeout(function () { layer.remove(); resolve(); }, 450);
      }
      layer.addEventListener('pointerdown', finish);

      function frame(now) {
        if (done) return;
        var dt = Math.min(0.05, (now - last) / 1000); last = now;
        c.clearRect(0, 0, w, h);
        parts.forEach(function (p) {
          if (p.delay > 0) { p.delay -= dt; return; }
          p.age += dt;
          if (p.age > p.life) return;
          p.vy += recipe.gravity * dt;
          p.vx *= Math.pow(p.drag, dt * 60); p.vy *= Math.pow(p.drag, dt * 60);
          if (p.sway) p.x += Math.sin(p.age * p.sway * 2 + p.phase) * 40 * dt;
          p.x += p.vx * dt; p.y += p.vy * dt;
          if (p.vr) p.rot += p.vr * dt;
          if (p.vspin) p.spin += p.vspin * dt;
          var fade = Math.min(1, (p.life - p.age) / 0.5) * Math.min(1, p.age / 0.12);
          if (p.twinkle) fade *= 0.5 + 0.5 * Math.sin(p.age * 12);
          c.save();
          c.globalAlpha = Math.max(0, fade);
          c.translate(p.x, p.y);
          c.rotate(p.aim ? Math.atan2(p.vy, p.vx) : p.rot);
          drawShape(c, p);
          c.restore();
        });
        if (now - start > DURATION) finish(); else requestAnimationFrame(frame);
      }
      requestAnimationFrame(frame);
    });
  }

  window.Celebrate = { play: play };
})();
