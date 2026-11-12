/*
 * Bolt's play area, drawn on a canvas. It only draws: app.js tells it where the runaway is
 * and what just happened, and it adds the look and feel (layered scenery, squash and stretch,
 * dust, the crash tumble). Nothing here changes the run.
 *
 * Reduced motion is checked as each frame is drawn: then there is no screen shake, the
 * scenery behind the track stands still, and there are no particles.
 */
(function () {
  'use strict';

  var B = window.Bolt;
  var EMOJI_FONT = '"Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", sans-serif';
  var TUMBLE_MS = 1000; // how long the crash tumble lasts before the card shows
  var reducedQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
  var darkQuery = window.matchMedia('(prefers-color-scheme: dark)');

  // Colours for light and dark, and the extra high-contrast settings for each.
  var PALETTES = {
    light: {
      sky: ['#8fd0f2', '#e4f5fd'], sun: '#ffd25e', far: '#a7cdb1', farTop: '#8fbf9c', near: '#7db66c', tree: '#5d9b52', trunk: '#7a5634',
      cloud: 'rgba(255,255,255,.92)', grass: '#74bd52', grassDark: '#5aa23f', path: '#dcb985', pathDark: '#c79f68',
      wood: '#a8713f', woodDark: '#6b4423', hay: '#eabf4f', hayDark: '#b98a25', water: '#4aa5e0', waterLight: '#a6dcfa',
      red: '#d8432f', redDark: '#9b2a1c', metal: '#33302c', leaf: '#4f9a43', leafDark: '#357530', sign: '#f6e7c8', signInk: '#4a3420',
      shadow: 'rgba(40,30,10,.22)', dust: 'rgba(160,125,80,', outline: null, edge: 'rgba(70,40,10,.55)',
    },
    dark: {
      sky: ['#0e1830', '#2b3a5f'], sun: '#f2ecd8', far: '#2d4840', farTop: '#36574b', near: '#29492f', tree: '#1f3a25', trunk: '#4a3622',
      cloud: 'rgba(170,185,215,.28)', grass: '#3f7a36', grassDark: '#2f622a', path: '#7d6446', pathDark: '#6a5339',
      wood: '#9a6a3f', woodDark: '#5a3a1f', hay: '#d4a845', hayDark: '#9c7524', water: '#3b86c4', waterLight: '#87c4ec',
      red: '#d0503c', redDark: '#8e2d20', metal: '#1d1b19', leaf: '#3f8436', leafDark: '#2a5e25', sign: '#e9d9b8', signInk: '#3a2817',
      shadow: 'rgba(0,0,0,.35)', dust: 'rgba(190,160,120,', outline: null, edge: 'rgba(0,0,0,.6)',
    },
  };
  // High contrast: the scenery fades back and every obstacle gets a heavy outline.
  var HIGH = {
    light: { far: '#d5e4d8', farTop: '#cbdccf', near: '#c4dcbc', tree: '#b5d1ac', cloud: 'rgba(255,255,255,.6)', outline: '#000', water: '#0b6fc2' },
    dark: { far: '#1e2b27', farTop: '#223029', near: '#1d2c20', tree: '#18261b', cloud: 'rgba(170,185,215,.12)', outline: '#fff', water: '#56b4ff' },
  };

  // A repeatable pseudo-random number from an integer, for placing scenery.
  function hash(n) {
    var t = Math.imul(n ^ 0x9e3779b9, 0x85ebca6b);
    t ^= t >>> 13;
    t = Math.imul(t, 0xc2b2ae35);
    return ((t ^ (t >>> 16)) >>> 0) / 4294967296;
  }
  function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }

  function Scene(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.w = 0;
    this.h = 0;
    this.dpr = 1;
    this.parts = []; // particles: { x, y (world metres), vx, vy (m/s), born, life (ms), kind, size }
    this.fx = { jump: -1e9, land: -1e9, hop: -1e9, crash: -1e9, shake: -1e9, finale: -1e9 };
    this.lastDust = 0;
    this.lastFrame = 0;
    this.crashKind = '';
  }

  Scene.prototype.resize = function () {
    var r = this.canvas.getBoundingClientRect(), dpr = Math.min(window.devicePixelRatio || 1, 3);
    var w = Math.max(1, Math.round(r.width * dpr)), h = Math.max(1, Math.round(r.height * dpr));
    if (w !== this.canvas.width || h !== this.canvas.height) {
      this.canvas.width = w;
      this.canvas.height = h;
    }
    this.w = r.width;
    this.h = r.height;
    this.dpr = w / Math.max(1, r.width);
  };

  // Forget the effects of the last run, for a fresh start.
  Scene.prototype.reset = function () {
    this.parts = [];
    for (var k in this.fx) this.fx[k] = -1e9;
    this.crashKind = '';
  };

  // Something happened in the run (an event from logic.js).
  Scene.prototype.event = function (e, now) {
    var calm = reducedQuery.matches;
    if (e.type === 'jump') {
      this.fx.jump = now;
      if (!calm) this.puff(e.x, 0, 5, 0.9);
    } else if (e.type === 'hop') {
      this.fx.hop = now;
      if (!calm) this.ring(e.x, e.y + 0.2);
    } else if (e.type === 'land') {
      this.fx.land = now;
      if (!calm) this.puff(e.x, 0, 8, 1.4);
    } else if (e.type === 'crash') {
      this.fx.crash = now;
      this.fx.shake = now;
      this.crashKind = e.kind;
      if (!calm && e.kind === 'puddle') this.splash(e.x, 0);
      else if (!calm) this.puff(e.x + 0.3, Math.max(0, e.y), 10, 2);
    } else if (e.type === 'landmark' && e.index === B.LANDMARKS.length - 1) {
      this.fx.finale = now;
      if (!calm) this.confetti(now);
    }
  };

  Scene.prototype.puff = function (x, y, n, power) {
    for (var i = 0; i < n; i++) {
      this.parts.push({ kind: 'dust', x: x - 0.1 + Math.random() * 0.3, y: y + 0.05, vx: -(1 + Math.random() * 2.5) * power * 0.6, vy: (0.4 + Math.random()) * power * 0.7, born: this.lastFrame, life: 380 + Math.random() * 260, size: 0.1 + Math.random() * 0.12 });
    }
  };
  Scene.prototype.ring = function (x, y) {
    for (var i = 0; i < 8; i++) {
      var a = i / 8 * Math.PI * 2;
      this.parts.push({ kind: 'dust', x: x, y: y, vx: Math.cos(a) * 2.2, vy: Math.sin(a) * 1.4 - 0.4, born: this.lastFrame, life: 320, size: 0.08 });
    }
  };
  Scene.prototype.splash = function (x, y) {
    for (var i = 0; i < 16; i++) {
      this.parts.push({ kind: 'drop', x: x + Math.random() * 0.4, y: y + 0.05, vx: -2 + Math.random() * 5, vy: 2.5 + Math.random() * 3.5, born: this.lastFrame, life: 700, size: 0.07 + Math.random() * 0.06, g: true });
    }
  };
  Scene.prototype.confetti = function (now) {
    var bits = ['🌼', '🌸', '🍀', '✨', '🌻'];
    for (var i = 0; i < 26; i++) {
      this.parts.push({ kind: 'screen', ch: bits[i % bits.length], sx: Math.random(), sy: -0.1 - Math.random() * 0.3, vy: 0.25 + Math.random() * 0.25, spin: (Math.random() - 0.5) * 6, born: now, life: 2200 });
    }
  };

  /*
   * Draw a frame. v = {
   *   now: ms, x, y: the runaway (world metres), phase: 'gate' | 'run' | 'paused' | 'tumble' | 'between',
   *   emoji, course, dead: true once the run has ended, contrast: true for high contrast
   * }
   */
  Scene.prototype.draw = function (v) {
    var ctx = this.ctx, now = v.now, calm = reducedQuery.matches;
    var dt = this.lastFrame ? Math.min(0.05, (now - this.lastFrame) / 1000) : 0;
    this.lastFrame = now;
    if (!this.w) this.resize();
    var W = this.w, H = this.h, theme = darkQuery.matches ? 'dark' : 'light';
    var pal = PALETTES[theme];
    if (v.contrast) { var hi = HIGH[theme], merged = {}, k; for (k in pal) merged[k] = pal[k]; for (k in hi) merged[k] = hi[k]; pal = merged; }

    var speed = B.speedAt(Math.max(0, v.x));
    // The view widens and the runaway sits further left as the pace rises (see Bolt.view), so
    // there is always time to see what is coming.
    var view = B.view(Math.max(0, v.x), W > H * 1.3), viewM = view.metres;
    var k = W / viewM; // pixels per metre
    var groundY = Math.round(H * 0.74);
    var camX = v.x - view.behind * viewM;
    var sx = function (wx) { return (wx - camX) * k; };
    var sy = function (wy) { return groundY - wy * k; };

    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);

    // A brief shake on a crash.
    var shakeT = (now - this.fx.shake) / 320;
    if (!calm && shakeT >= 0 && shakeT < 1) {
      var amp = 7 * (1 - shakeT);
      ctx.translate((Math.random() - 0.5) * 2 * amp, (Math.random() - 0.5) * 2 * amp);
    }

    // ---- the sky and the scenery behind the track. With reduced motion it does not drift.
    var drift = calm ? 0 : 1;
    var sky = ctx.createLinearGradient(0, 0, 0, groundY);
    sky.addColorStop(0, pal.sky[0]);
    sky.addColorStop(1, pal.sky[1]);
    ctx.fillStyle = sky;
    ctx.fillRect(-20, -20, W + 40, groundY + 20);
    this.sunAndStars(ctx, W, H, pal, theme);
    this.clouds(ctx, W, groundY, k, pal, (camX * 0.06 + now / 1000 * 0.35) * drift);

    // The hills ahead grow as the runaway gets nearer to them.
    var near = clamp(v.x / 2000, 0, 1);
    this.ridge(ctx, W, groundY - 0.6 * k, H * (0.1 + 0.2 * near), pal.far, pal.farTop, camX * 0.03 * drift, 0.004, 7);
    this.treeLine(ctx, W, groundY, k, pal, camX * 0.3 * drift);

    // ---- the track: grass and a dirt path, moving at the runaway's own pace.
    ctx.fillStyle = pal.grass;
    ctx.fillRect(-20, groundY - 0.18 * k, W + 40, H - groundY + 30);
    ctx.fillStyle = pal.path;
    ctx.fillRect(-20, groundY + 0.12 * k, W + 40, H);
    ctx.fillStyle = pal.grassDark;
    var first = Math.floor(camX / 0.9) - 1, last = Math.ceil((camX + viewM * 1.3) / 0.9) + 1, i;
    for (i = first; i <= last; i++) {
      var tx = sx(i * 0.9 + hash(i) * 0.5), th = (0.12 + hash(i + 77) * 0.14) * k;
      ctx.beginPath();
      ctx.moveTo(tx - 0.06 * k, groundY - 0.15 * k);
      ctx.lineTo(tx, groundY - 0.15 * k - th);
      ctx.lineTo(tx + 0.06 * k, groundY - 0.15 * k);
      ctx.fill();
    }
    ctx.fillStyle = pal.pathDark;
    for (i = first; i <= last; i++) {
      var px = sx(i * 0.9 + hash(i + 5) * 0.8), py = groundY + (0.35 + hash(i + 9) * 0.9) * k;
      if (py < H - 3) { ctx.beginPath(); ctx.ellipse(px, py, 0.07 * k, 0.04 * k, 0, 0, Math.PI * 2); ctx.fill(); }
    }

    // ---- signposts at the landmarks, and the open gate at the start.
    var self = this;
    B.LANDMARKS.forEach(function (m) {
      var x = sx(m.m);
      if (x > -3 * k && x < W + 3 * k) self.signpost(ctx, x, groundY, k, m.m + ' m', m.name, pal);
    });
    if (sx(-1.4) > -3 * k) this.gate(ctx, sx(-1.4), groundY, k, pal);

    // ---- obstacles
    var items = v.course.items, lo = camX - 2, hi = camX + viewM + 4;
    for (i = 0; i < items.length && items[i].x0 < hi; i++) {
      if (items[i].x1 < lo) continue;
      this.obstacle(ctx, items[i], sx, sy, k, groundY, pal);
    }

    // ---- particles in the world (dust, drops)
    this.parts = this.parts.filter(function (p) { return now - p.born < p.life; });
    this.parts.forEach(function (p) {
      if (p.kind === 'screen') return;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      if (p.g) p.vy -= 14 * dt; else p.vy -= 1.5 * dt;
      var a = 1 - (now - p.born) / p.life;
      ctx.fillStyle = p.kind === 'drop' ? pal.waterLight : pal.dust + (0.55 * a).toFixed(3) + ')';
      ctx.beginPath();
      ctx.arc(sx(p.x), sy(Math.max(0, p.y)), Math.max(1, p.size * k * (p.kind === 'drop' ? 1 : 0.6 + a * 0.6)), 0, Math.PI * 2);
      ctx.fill();
    });

    // A little dust kicked up while running fast.
    if (!calm && v.phase === 'run' && v.y === 0 && speed > 9.5 && now - this.lastDust > 110) {
      this.lastDust = now;
      this.parts.push({ kind: 'dust', x: v.x - 0.25, y: 0.04, vx: -1.5, vy: 0.5, born: now, life: 300, size: 0.07 });
    }

    this.runaway(ctx, v, sx, sy, k, groundY, pal, calm);

    // Confetti over everything, for reaching the hills.
    this.parts.forEach(function (p) {
      if (p.kind !== 'screen') return;
      var t = (now - p.born) / 1000;
      ctx.save();
      ctx.globalAlpha = clamp(1 - (now - p.born) / p.life, 0, 1) * 1.4;
      ctx.translate(p.sx * W, (p.sy + p.vy * t) * H);
      ctx.rotate(p.spin * t);
      ctx.font = Math.round(H * 0.06) + 'px ' + EMOJI_FONT;
      ctx.fillStyle = '#000';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(p.ch, 0, 0);
      ctx.restore();
    });
  };

  Scene.prototype.sunAndStars = function (ctx, W, H, pal, theme) {
    var r = Math.max(14, Math.min(W, H) * 0.055), cx = W * 0.62, cy = H * 0.3;
    if (theme === 'dark') {
      ctx.fillStyle = 'rgba(255,255,255,.7)';
      for (var i = 0; i < 40; i++) {
        ctx.fillRect(hash(i) * W, hash(i + 100) * H * 0.55, 1.5, 1.5);
      }
    }
    // The sun, or by night a crescent moon: the overlap of two circles is left out.
    ctx.fillStyle = pal.sun;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    if (theme === 'dark') {
      ctx.moveTo(cx + r * 1.3, cy - r * 0.25);
      ctx.arc(cx + r * 0.45, cy - r * 0.25, r * 0.85, 0, Math.PI * 2);
      ctx.fill('evenodd');
    } else {
      ctx.fill();
    }
  };

  Scene.prototype.clouds = function (ctx, W, groundY, k, pal, offset) {
    var spacing = 7, first = Math.floor(offset / spacing) - 1;
    ctx.fillStyle = pal.cloud;
    for (var i = first; i < first + Math.ceil(W / k / spacing) + 3; i++) {
      var cx = (i * spacing + hash(i) * 3 - offset) * k, cy = groundY * (0.12 + hash(i + 31) * 0.38), s = (0.5 + hash(i + 7) * 0.5) * k;
      blobs(ctx, [[cx, cy, s * 0.9], [cx + s, cy + s * 0.15, s * 0.7], [cx - s, cy + s * 0.2, s * 0.6], [cx + s * 0.3, cy - s * 0.4, s * 0.6]]);
    }
  };

  // A rolling ridge of hills along the horizon.
  Scene.prototype.ridge = function (ctx, W, baseY, height, colour, top, offset, freq, seed) {
    var grad = ctx.createLinearGradient(0, baseY - height, 0, baseY);
    grad.addColorStop(0, top);
    grad.addColorStop(1, colour);
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.moveTo(-20, baseY + 2);
    for (var x = -20; x <= W + 20; x += 6) {
      var u = (x + offset * 60) * freq * 6;
      var y = baseY - height * (0.62 + 0.25 * Math.sin(u + seed) + 0.13 * Math.sin(u * 2.3 + seed * 3));
      ctx.lineTo(x, y);
    }
    ctx.lineTo(W + 20, baseY + 2);
    ctx.closePath();
    ctx.fill();
  };

  // Low green fields with round trees, nearer than the hills.
  Scene.prototype.treeLine = function (ctx, W, groundY, k, pal, offset) {
    var base = groundY - 0.15 * k, rise = 1.5;
    ctx.fillStyle = pal.near;
    ctx.beginPath();
    ctx.moveTo(-20, base + 2);
    for (var x = -20; x <= W + 20; x += 8) {
      var u = (x / k + offset) * 0.35;
      ctx.lineTo(x, base - (rise + 0.35 * Math.sin(u) + 0.2 * Math.sin(u * 2.7)) * k);
    }
    ctx.lineTo(W + 20, base + 2);
    ctx.closePath();
    ctx.fill();
    var spacing = 4.5, first = Math.floor(offset / spacing) - 1;
    for (var i = first; i < first + Math.ceil(W / k / spacing) + 3; i++) {
      if (hash(i + 3) < 0.35) continue;
      var tx = (i * spacing + hash(i) * 2.5 - offset) * k, s = (0.4 + hash(i + 11) * 0.35) * k;
      var u2 = (tx / k + offset) * 0.35, ty = base - (rise + 0.35 * Math.sin(u2) + 0.2 * Math.sin(u2 * 2.7)) * k + s * 0.15;
      ctx.fillStyle = pal.trunk;
      ctx.fillRect(tx - s * 0.08, ty - s * 0.9, s * 0.16, s * 0.95);
      ctx.fillStyle = pal.tree;
      blobs(ctx, [[tx, ty - s * 1.15, s * 0.62], [tx - s * 0.4, ty - s * 0.85, s * 0.42], [tx + s * 0.42, ty - s * 0.88, s * 0.45]]);
    }
  };

  Scene.prototype.signpost = function (ctx, x, groundY, k, top, name, pal) {
    var y = groundY - 0.15 * k;
    ctx.fillStyle = pal.woodDark;
    ctx.fillRect(x - 0.05 * k, y - 1.9 * k, 0.1 * k, 1.9 * k);
    ctx.font = '800 ' + Math.max(10, Math.round(0.3 * k)) + 'px ' + 'ui-rounded, system-ui, sans-serif';
    var w = Math.max(ctx.measureText(name).width, ctx.measureText(top).width) + 0.4 * k, h = 0.85 * k;
    ctx.fillStyle = pal.sign;
    ctx.strokeStyle = pal.woodDark;
    ctx.lineWidth = Math.max(1.5, 0.05 * k);
    roundRect(ctx, x - w / 2, y - 2.6 * k, w, h, 0.12 * k);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = pal.signInk;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(top, x, y - 2.6 * k + h * 0.3);
    ctx.fillText(name, x, y - 2.6 * k + h * 0.72);
  };

  // The farm gate, swung open, where every run starts.
  Scene.prototype.gate = function (ctx, x, groundY, k, pal) {
    var y = groundY - 0.1 * k;
    ctx.fillStyle = pal.woodDark;
    ctx.fillRect(x - 0.09 * k, y - 1.35 * k, 0.18 * k, 1.35 * k);
    ctx.fillStyle = pal.wood;
    // The gate itself, seen swung back towards the viewer: narrower than it is long.
    for (var i = 0; i < 4; i++) ctx.fillRect(x - 0.95 * k, y - (0.25 + i * 0.27) * k, 0.9 * k, 0.09 * k);
    ctx.fillRect(x - 0.95 * k, y - 1.15 * k, 0.1 * k, 1.05 * k);
    ctx.save();
    ctx.strokeStyle = pal.wood;
    ctx.lineWidth = 0.08 * k;
    ctx.beginPath();
    ctx.moveTo(x - 0.9 * k, y - 0.2 * k);
    ctx.lineTo(x - 0.1 * k, y - 1.05 * k);
    ctx.stroke();
    ctx.restore();
  };

  Scene.prototype.obstacle = function (ctx, it, sx, sy, k, groundY, pal) {
    var x0 = sx(it.x0), x1 = sx(it.x1), w = x1 - x0, line = pal.outline || pal.edge, lw = pal.outline ? Math.max(2.5, 0.07 * k) : 1.5;
    ctx.save();
    ctx.lineJoin = 'round';
    var outline = function () { if (line) { ctx.strokeStyle = line; ctx.lineWidth = lw; ctx.stroke(); } };
    if (it.kind === 'fence') {
      var top = sy(it.h), post = 0.13 * k;
      ctx.fillStyle = pal.wood;
      [[x0, top - 0.05 * k, post, groundY - top + 0.05 * k], [x1 - post, top - 0.05 * k, post, groundY - top + 0.05 * k],
        [x0, sy(it.h * 0.82), w, 0.11 * k], [x0, sy(it.h * 0.42), w, 0.11 * k]].forEach(function (r) {
        ctx.beginPath();
        ctx.rect(r[0], r[1], r[2], r[3]);
        ctx.fill();
        outline();
      });
      ctx.fillStyle = pal.woodDark;
      ctx.fillRect(x0, top - 0.05 * k, post, 0.05 * k);
      ctx.fillRect(x1 - post, top - 0.05 * k, post, 0.05 * k);
    } else if (it.kind === 'hay' || it.kind === 'stack') {
      var rows = it.kind === 'stack' ? 2 : 1, bh = it.kind === 'stack' ? it.h / 2 : it.h;
      for (var r = 0; r < rows; r++) {
        var by = sy(bh * (r + 1));
        ctx.fillStyle = pal.hay;
        ctx.beginPath();
        roundRect(ctx, x0 + 0.02 * k, by, w - 0.04 * k, bh * k, 0.28 * k);
        ctx.fill();
        outline();
        ctx.strokeStyle = pal.hayDark;
        ctx.lineWidth = Math.max(1, 0.035 * k);
        for (var s = 1; s < 4; s++) {
          ctx.beginPath();
          ctx.moveTo(x0 + 0.15 * k, by + bh * k * s / 4);
          ctx.lineTo(x1 - 0.15 * k, by + bh * k * s / 4);
          ctx.stroke();
        }
      }
    } else if (it.kind === 'puddle') {
      ctx.fillStyle = pal.water;
      ctx.beginPath();
      ctx.ellipse((x0 + x1) / 2, groundY + 0.02 * k, w / 2, 0.17 * k, 0, 0, Math.PI * 2);
      ctx.fill();
      outline();
      ctx.fillStyle = pal.waterLight;
      ctx.beginPath();
      ctx.ellipse((x0 + x1) / 2 - w * 0.12, groundY - 0.02 * k, w * 0.22, 0.04 * k, 0, 0, Math.PI * 2);
      ctx.fill();
    } else if (it.kind === 'tractor') {
      var g = groundY;
      // The cab, the bonnet and the exhaust, then the wheels.
      ctx.fillStyle = pal.red;
      ctx.beginPath();
      roundRect(ctx, x0 + 0.1 * k, sy(it.h), 0.95 * k, (it.h - 0.4) * k, 0.1 * k);
      ctx.fill();
      outline();
      ctx.fillStyle = pal.waterLight;
      ctx.fillRect(x0 + 0.25 * k, sy(it.h - 0.12), 0.65 * k, 0.4 * k);
      ctx.fillStyle = pal.red;
      ctx.beginPath();
      roundRect(ctx, x0 + 0.9 * k, sy(0.95), w - 0.95 * k, 0.55 * k, 0.12 * k);
      ctx.fill();
      outline();
      ctx.fillStyle = pal.metal;
      ctx.fillRect(x0 + 1.75 * k, sy(1.25), 0.08 * k, 0.32 * k);
      wheel(ctx, x0 + 0.55 * k, g - 0.55 * k, 0.55 * k, pal, line, lw);
      wheel(ctx, x1 - 0.38 * k, g - 0.3 * k, 0.3 * k, pal, line, lw);
    } else if (it.kind === 'trailer') {
      ctx.fillStyle = pal.metal;
      ctx.fillRect(x0 - 0.1 * k, sy(0.32), 0.2 * k, 0.06 * k);
      ctx.fillStyle = pal.redDark;
      ctx.beginPath();
      ctx.rect(x0 + 0.05 * k, sy(0.45), w - 0.1 * k, 0.15 * k);
      ctx.fill();
      outline();
      ctx.fillStyle = pal.hay;
      ctx.beginPath();
      roundRect(ctx, x0 + 0.1 * k, sy(it.h), w - 0.2 * k, (it.h - 0.45) * k, 0.12 * k);
      ctx.fill();
      outline();
      wheel(ctx, (x0 + x1) / 2, groundY - 0.22 * k, 0.22 * k, pal, line, lw);
    } else if (it.kind === 'branch') {
      // A leafy bough hanging down from a tree beyond the top of the view.
      var bottom = sy(it.y0), cx = (x0 + x1) / 2;
      ctx.strokeStyle = pal.trunk;
      ctx.lineWidth = 0.22 * k;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(x1 + 1.2 * k, -10);
      ctx.quadraticCurveTo(x1, bottom - 1.6 * k, cx, bottom - 0.6 * k);
      ctx.stroke();
      ctx.fillStyle = pal.leafDark;
      ctx.beginPath();
      roundRect(ctx, x0, bottom - 1.1 * k, w, 1.1 * k, 0.5 * k);
      ctx.fill();
      outline();
      ctx.fillStyle = pal.leaf;
      for (var j = 0; j < 5; j++) {
        ctx.beginPath();
        ctx.arc(x0 + w * (0.15 + j * 0.175), bottom - (0.45 + (j % 2) * 0.25) * k, 0.26 * k, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.restore();
  };

  // Overlapping circles [x, y, r] filled as one shape (for clouds and treetops).
  function blobs(ctx, circles) {
    ctx.beginPath();
    circles.forEach(function (c) {
      ctx.moveTo(c[0] + c[2], c[1]);
      ctx.arc(c[0], c[1], c[2], 0, Math.PI * 2);
    });
    ctx.fill();
  }

  function wheel(ctx, x, y, r, pal, line, lw) {
    ctx.fillStyle = pal.metal;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
    if (line) { ctx.strokeStyle = line; ctx.lineWidth = lw; ctx.stroke(); }
    ctx.fillStyle = pal.hay;
    ctx.beginPath();
    ctx.arc(x, y, r * 0.4, 0, Math.PI * 2);
    ctx.fill();
  }

  function roundRect(ctx, x, y, w, h, r) {
    r = Math.max(0, Math.min(r, w / 2, h / 2));
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  // The runaway, with its shadow, its running bob, squash and stretch, and the crash tumble.
  Scene.prototype.runaway = function (ctx, v, sx, sy, k, groundY, pal, calm) {
    var now = v.now, x = v.x, y = v.y, angle = 0, scaleX = 1, scaleY = 1, size = 1.35 * k;
    var tumble = v.dead ? clamp((now - this.fx.crash) / TUMBLE_MS, 0, 1) : -1;
    if (tumble >= 0) {
      if (calm) {
        // Tip over and drop to the ground, without the spin.
        angle = -Math.PI / 2 * Math.min(1, tumble * 4);
        y *= 1 - Math.min(1, tumble * 2);
      } else {
        // Up, backwards and over, landing on its back.
        var e = 1 - Math.pow(1 - tumble, 2);
        x -= 1.3 * e;
        y = Math.max(0, y * (1 - tumble) + 1.7 * 4 * tumble * (1 - tumble) * (this.crashKind === 'branch' ? 0.4 : 1));
        angle = -Math.PI * 3 * e;
      }
    } else {
      var since = function (t) { return now - t; };
      if (v.phase === 'run' && !v.y) {
        // Running: a little bounce in each stride.
        var stride = Math.abs(Math.sin(x * 2.3));
        y += stride * 0.08;
        angle = Math.sin(x * 2.3) * 0.06;
      } else if (v.phase === 'gate') {
        scaleY = 1 + Math.sin(now / 380) * 0.025;
      }
      var land = since(this.fx.land);
      if (land < 170) {
        var a = (1 - land / 170) * 0.28;
        scaleX = 1 + a;
        scaleY = 1 - a;
      } else if (v.y > 0) {
        var jumpT = since(this.fx.jump);
        var stretch = jumpT < 140 ? (1 - jumpT / 140) * 0.22 : 0.06;
        scaleX = 1 - stretch * 0.8;
        scaleY = 1 + stretch;
      }
      var hopT = since(this.fx.hop);
      if (!calm && hopT < 340 && v.y > 0) angle += Math.PI * 2 * (1 - Math.pow(1 - hopT / 340, 2));
    }

    // The shadow shrinks as the runaway rises.
    var lift = clamp(y / 3, 0, 0.7);
    ctx.fillStyle = pal.shadow;
    ctx.beginPath();
    ctx.ellipse(sx(x), groundY + 0.02 * k, 0.45 * k * (1 - lift), 0.09 * k * (1 - lift), 0, 0, Math.PI * 2);
    ctx.fill();

    ctx.save();
    ctx.translate(sx(x), sy(y));
    if (angle) {
      // Turn about the middle of the body rather than the feet.
      ctx.translate(0, -size * 0.4);
      ctx.rotate(angle);
      ctx.translate(0, size * 0.4);
    }
    ctx.scale(-scaleX, scaleY); // the emoji face left; the runaway runs right
    // Colour emoji take the alpha of the fill colour, so it must be opaque. A soft dark edge
    // keeps a pale animal clear against the sky.
    ctx.fillStyle = '#000';
    ctx.shadowColor = v.contrast ? pal.outline : 'rgba(30,20,5,.55)';
    ctx.shadowBlur = v.contrast ? 0 : 3;
    if (v.contrast) { ctx.shadowOffsetX = 2; ctx.shadowOffsetY = 2; }
    ctx.font = Math.round(size) + 'px ' + EMOJI_FONT;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    ctx.fillText(v.emoji, 0, -size * 0.08);
    ctx.restore();

    if (tumble > 0.55) {
      ctx.save();
      ctx.font = Math.round(0.6 * k) + 'px ' + EMOJI_FONT;
      ctx.fillStyle = '#000';
      ctx.textAlign = 'center';
      ctx.globalAlpha = clamp((tumble - 0.55) * 4, 0, 1);
      ctx.fillText('💫', sx(x) + (calm ? 0 : Math.sin(now / 200) * 0.15 * k), sy(y) - 1.35 * k);
      ctx.restore();
    }
  };

  window.BoltScene = { Scene: Scene, TUMBLE_MS: TUMBLE_MS };
})();
