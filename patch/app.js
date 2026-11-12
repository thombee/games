/*
 * Patch page. Draws the day's garden, turns taps, drags and keys into marks, shows broken
 * rules, runs the clock, and keeps the player's progress in localStorage. The rules
 * (puzzles, rule checks, hints, share text, stats) are in logic.js.
 */
(function () {
  'use strict';

  var P = window.Patch;
  var BANK = window.PATCH_PUZZLES;

  // The address added to shared results. Empty until the game has a home.
  var SITE_URL = 'https://thombee.github.io/games/patch/';
  var STORE_KEY = 'patch:v1';
  // While the clock runs, progress is saved at least this often.
  var SAVE_EVERY = 5000;

  var root = document.documentElement;
  var forcedDay = parseInt(new URLSearchParams(location.search).get('day'), 10);
  // Preview mode plays any day and saves nothing. It is on for ?day=N and for preview builds.
  var PREVIEW = root.hasAttribute('data-preview') || forcedDay > 0;
  var TOUCH = window.matchMedia('(pointer: coarse)').matches;
  // Checked at the moment of animating, so a change of setting applies straight away.
  function reduced() { return window.matchMedia('(prefers-reduced-motion: reduce)').matches; }

  function $(id) { return document.getElementById(id); }

  // Build an element. props: class, text, on<event> handlers, anything else is an attribute.
  function el(tag, props, kids) {
    var n = document.createElement(tag);
    Object.keys(props || {}).forEach(function (k) {
      var v = props[k];
      if (v === null || v === undefined || v === false) return;
      if (k === 'class') n.className = v;
      else if (k === 'text') n.textContent = v;
      else if (k.slice(0, 2) === 'on') n.addEventListener(k.slice(2), v);
      else n.setAttribute(k, v === true ? '' : v);
    });
    (kids || []).forEach(function (c) {
      if (c === null || c === undefined || c === false) return;
      n.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
    });
    return n;
  }
  function plural(n, one, many) { return n + ' ' + (n === 1 ? one : many); }

  // ---- saved progress

  var GARDEN_RE = /^[.xs]+$/;
  function emptyStore() { return { v: 1, stats: P.emptyStats(), game: null, contrast: false, seen: false }; }
  function count(v) { return Number.isFinite(v) && v >= 0 ? Math.floor(v) : 0; }
  // The saved progress, or null if this browser will not let the page read localStorage.
  function readStore() {
    var raw;
    try { raw = localStorage.getItem(STORE_KEY); } catch (e) { return null; }
    var s = emptyStore();
    try {
      var d = JSON.parse(raw || 'null');
      if (!d || d.v !== 1) return s;
      var st = d.stats || {};
      ['played', 'streak', 'best', 'lastDay', 'hints'].forEach(function (k) { s.stats[k] = count(st[k]); });
      P.SIZES.forEach(function (n) {
        var b = (st.bySize || {})[n] || {};
        s.stats.bySize[n] = { solved: count(b.solved), total: count(b.total), best: count(b.best) };
      });
      var g = d.game;
      if (g && Number.isInteger(g.day) && g.day > 0 && typeof g.garden === 'string' && GARDEN_RE.test(g.garden)) {
        s.game = { day: g.day, garden: g.garden, elapsed: count(g.elapsed), hints: count(g.hints), moves: count(g.moves), solved: g.solved === true, pb: g.pb === true };
      }
      s.contrast = d.contrast === true;
      s.seen = d.seen === true;
    } catch (e) { /* corrupt: start clean */ }
    return s;
  }
  // True after a write has failed: from then on this tab's copy is the truth, and is not
  // replaced by the older one still in storage.
  var writeFailed = false;
  function save() {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(store));
      writeFailed = false;
    } catch (e) {
      writeFailed = true;
      cannotSave();
    }
  }
  // Shown once, under the game, when the browser will not keep the player's progress.
  function cannotSave() {
    var note = $('storage-note');
    if (PREVIEW || !note.hidden) return;
    note.hidden = false;
    announce(note.textContent);
  }
  // Takes another tab's saved copy, unless this tab's own copy is the truth.
  function refresh() {
    if (writeFailed) return false;
    var fresh = readStore();
    if (!fresh) return false;
    store = fresh;
    return true;
  }
  var store = readStore();
  if (!store) { store = emptyStore(); writeFailed = true; cannotSave(); }

  // ---- the current day's game

  /*
   * day, persist (false in preview), puzzle, garden (a string, one character a square: see
   * logic.js), moves (changes made, counting undo, clear and hints), hints, solved,
   * elapsed (ms on the clock before runningSince), runningSince (when the clock last
   * started, or 0 while it is stopped), undo (earlier gardens), focus (the square that
   * keyboard focus goes to), pb (solved faster than the best time before it for this size).
   */
  var S = null;
  var drag = null;
  var lastSave = 0;

  function today() { return Math.max(1, P.dayNumber()); }

  function startGame(day, persist, carry) {
    var puzzle = P.dailyPuzzle(day, BANK);
    S = {
      day: day, persist: persist, puzzle: puzzle, garden: P.emptyGarden(puzzle.n), moves: 0, hints: 0, solved: false,
      elapsed: 0, runningSince: 0, undo: [], focus: 0, pb: false,
    };
    var g = store.game;
    if (persist && g && g.day === day && g.garden.length === puzzle.n * puzzle.n) {
      S.garden = g.garden;
      S.moves = g.moves;
      S.hints = g.hints;
      S.solved = g.solved && P.isSolved(puzzle, g.garden);
      // A solved game keeps the time it was finished in. Otherwise the longer clock wins.
      S.elapsed = S.solved ? g.elapsed : Math.max(g.elapsed, carry || 0);
      S.pb = S.solved && g.pb;
    }
    drag = null;
    $('preview-bar').hidden = !PREVIEW;
    $('preview-day').textContent = 'Day ' + day;
    var dayTag = $('day-tag');
    dayTag.textContent = '';
    dayTag.appendChild(el('b', { text: '#' + day }));
    dayTag.appendChild(document.createTextNode(' · ' + puzzle.n + '×' + puzzle.n + ' · ' + puzzle.difficulty));
    buildGarden();
    if (S.moves && !S.solved) startClock();
    renderGarden();
    renderTools();
    renderTimer();
    if (S.solved) renderResults(false); else $('results').hidden = true;
  }

  function elapsedNow() { return S.elapsed + (S.runningSince ? Date.now() - S.runningSince : 0); }
  function startClock() {
    if (!S.runningSince && !S.solved && !document.hidden) S.runningSince = Date.now();
  }
  function stopClock() {
    if (!S.runningSince) return;
    S.elapsed = elapsedNow();
    S.runningSince = 0;
  }

  // The time on a day's clock only goes up: if the saved game for this day has more time on
  // it than this tab (another tab has been open longer), this tab's clock catches up with it.
  function mergeClock() {
    var theirs = store.game;
    if (S.solved || !S.persist || !theirs || theirs.day !== S.day) return;
    var behind = theirs.elapsed - elapsedNow();
    if (behind > 0) S.elapsed += behind;
  }
  function snapshot() {
    if (!S.persist) return;
    mergeClock();
    // A tab still showing an earlier day never replaces a later day's game.
    if (!store.game || store.game.day <= S.day) {
      store.game = { day: S.day, garden: S.garden, elapsed: elapsedNow(), hints: S.hints, moves: S.moves, solved: S.solved, pb: S.pb };
    }
    lastSave = Date.now();
    save();
  }
  // True if the saved game is for this tab's day and has moved on further than this tab, or
  // as far but differently.
  function savedIsNewer() {
    var theirs = store.game;
    if (!theirs || theirs.day !== S.day) return false;
    return theirs.moves > S.moves || (theirs.moves === S.moves && (theirs.garden !== S.garden || theirs.hints !== S.hints || theirs.solved !== S.solved));
  }
  // Before writing, read the store again so another tab's progress is not overwritten. If
  // that tab has moved on further, take its game instead and return false.
  function syncBeforeWrite() {
    if (!S.persist) return true;
    refresh();
    if (savedIsNewer()) { adopt(); return false; }
    return true;
  }
  // Take the saved game for this day, keeping the longer of the two clocks (or, if it is
  // solved, the time it was solved in).
  function adopt() {
    var mine = elapsedNow(), focus = S.focus;
    startGame(S.day, true, mine);
    S.focus = Math.min(focus, S.garden.length - 1);
    renderGarden();
  }
  // Save the clock while it runs, now and then.
  function saveProgress() {
    if (!S.persist || !S.moves || S.solved) return;
    if (syncBeforeWrite()) snapshot();
  }

  // ---- changing the garden

  // Checks that a change may be made now; false if the garden is solved, or another tab had
  // moved on (this tab then shows that game instead of making the change).
  function canChange() {
    return !S.solved && syncBeforeWrite();
  }
  function withSquare(garden, i, state) { return garden.slice(0, i) + state + garden.slice(i + 1); }
  function setSquare(i, state) { S.garden = withSquare(S.garden, i, state); }
  // Record a change made since `before`: one undo step, the clock, saving and the rules.
  function commit(before, what) {
    if (before === S.garden && what !== 'hint') return;
    if (before !== S.garden) S.undo.push(before);
    S.moves++;
    if (!store.seen && S.persist) store.seen = true;
    startClock();
    if (P.isSolved(S.puzzle, S.garden)) {
      mergeClock();
      S.solved = true;
      stopClock();
      if (S.persist) {
        // A personal best beats an earlier best time for this size; a first one does not count.
        var n = S.puzzle.n, was = store.stats.bySize[n].best, stats = P.recordResult(store.stats, S.day, n, S.elapsed, S.hints);
        S.pb = stats !== store.stats && !S.hints && was > 0 && stats.bySize[n].best < was;
        store.stats = stats;
      }
    }
    snapshot();
    renderGarden();
    renderTools();
    renderTimer();
    if (S.solved) {
      announce('The garden is in bloom. Solved in ' + spokenTime(S.elapsed) + '.');
      renderResults(true);
    }
  }

  function tapSquare(i) {
    if (!canChange()) return false;
    var before = S.garden;
    setSquare(i, P.nextState(S.garden[i]));
    pops[i] = S.garden[i] === P.SEED;
    commit(before);
    describeChange(i);
    return true;
  }
  function clearSquare(i) {
    if (S.garden[i] === P.EMPTY || !canChange()) return;
    var before = S.garden;
    setSquare(i, P.EMPTY);
    commit(before);
    describeChange(i);
  }
  function undo() {
    if (!S.undo.length || !canChange()) return;
    S.garden = S.undo.pop();
    S.moves++;
    snapshot();
    renderGarden();
    renderTools();
    announce('Undone.');
  }
  function clearAll() {
    if (S.garden === P.emptyGarden(S.puzzle.n) || !canChange()) return;
    var before = S.garden;
    S.garden = P.emptyGarden(S.puzzle.n);
    commit(before);
    announce('Garden cleared. Undo brings it back.');
  }
  // Plants a seedling the player is missing. If every right one is in already, the extra
  // seedlings are the problem, so it digs one of those up instead.
  function hint() {
    if (!canChange()) return;
    var i = P.hintSquare(S.puzzle, S.garden), before = S.garden, n = S.puzzle.n;
    if (i < 0) {
      for (var k = 0; k < S.garden.length && i < 0; k++) if (S.garden[k] === P.SEED && S.puzzle.solution[Math.floor(k / n)] !== k % n) i = k;
      if (i < 0) return;
      setSquare(i, P.CROSS);
    } else {
      setSquare(i, P.SEED);
      hinted = i;
    }
    S.hints++;
    S.focus = i;
    commit(before, 'hint');
    if (!S.solved) announce(S.garden[i] === P.SEED ? 'Hint: a seedling goes in ' + squareName(i) + '.' : 'Hint: the seedling in ' + squareName(i) + ' does not belong there.');
  }

  // ---- drawing the garden

  var cells = [];
  var pops = {};
  var hinted = -1;
  var clueShown = -1;

  function squareName(i) {
    var n = S.puzzle.n;
    return 'row ' + (Math.floor(i / n) + 1) + ', column ' + (i % n + 1);
  }
  function bedName(i) { return P.PALETTE[S.puzzle.colours[S.puzzle.beds[i]]].name + ' bed'; }

  // Builds the squares for the day's garden, with the edges of each bed.
  function buildGarden() {
    var p = S.puzzle, n = p.n, box = $('garden');
    box.textContent = '';
    box.style.setProperty('--n', n);
    box.setAttribute('aria-label', 'Garden, ' + n + ' by ' + n + '. Arrow keys move, Space changes a square.');
    cells = [];
    for (var r = 0; r < n; r++) {
      var row = el('div', { class: 'row', role: 'row' });
      for (var c = 0; c < n; c++) {
        var i = r * n + c, b = p.beds[i];
        var edges = (r === 0 || p.beds[i - n] !== b ? ' et' : '') + (c === n - 1 || p.beds[i + 1] !== b ? ' er' : '') +
          (r === n - 1 || p.beds[i + n] !== b ? ' eb' : '') + (c === 0 || p.beds[i - 1] !== b ? ' el' : '');
        var cell = el('div', { class: 'cell c' + p.colours[b] + edges, role: 'gridcell', tabindex: '-1', 'data-i': String(i) });
        cell.setAttribute('data-base', cell.className);
        cell.appendChild(el('span', { class: 'sq', 'aria-hidden': 'true' }));
        row.appendChild(cell);
        cells.push(cell);
      }
      box.appendChild(row);
    }
  }

  // Brings every square up to date: its mark, broken rules, the solved state and its label.
  function renderGarden() {
    var g = shownGarden(), p = S.puzzle, n = p.n, bad = P.conflicts(p, g), box = $('garden');
    var clash = {}, badBeds = {};
    bad.seeds.forEach(function (i) { clash[i] = true; });
    bad.beds.forEach(function (b) { badBeds[b] = true; });
    var clue = clueShown = !S.moves && !store.seen && S.persist ? P.firstClue(p) : -1;
    var k = 0;
    cells.forEach(function (cell, i) {
      var state = g[i], cls = cell.getAttribute('data-base');
      if (clash[i]) cls += ' clash';
      if (badBeds[p.beds[i]]) cls += ' bad';
      if (i === clue) cls += ' clue';
      if (pops[i] && !reduced()) cls += ' pop';
      if (i === hinted && !reduced()) cls += ' hinted';
      cell.className = cls;
      cell.tabIndex = i === S.focus ? 0 : -1;
      var mark = cell.firstChild, want = state + (S.solved ? 'bloom' : '');
      if (mark.getAttribute('data-state') !== want) {
        mark.setAttribute('data-state', want);
        mark.textContent = '';
        if (state === P.CROSS) mark.appendChild(el('span', { class: 'x', text: '✕' }));
        if (state === P.SEED) {
          var plant = S.solved ? P.PALETTE[p.colours[p.beds[i]]].veg : '🌱';
          mark.appendChild(el('span', { class: 'soil' }, [el('span', { text: plant, style: '--k:' + (S.solved ? k : 0) })]));
        }
      }
      if (state === P.SEED) k++;
      var what = state === P.SEED ? (S.solved ? 'in bloom' : clash[i] ? 'seedling, breaks a rule' : 'seedling') : state === P.CROSS ? 'marked not here' : 'empty';
      cell.setAttribute('aria-label', squareName(i).replace(/^r/, 'R') + ', ' + bedName(i) + ', ' + what);
      if (S.solved) cell.setAttribute('aria-disabled', 'true'); else cell.removeAttribute('aria-disabled');
    });
    pops = {};
    hinted = -1;
    box.classList.toggle('done', S.solved);
    // Outlines round each row and column holding more than one seedling.
    Array.prototype.slice.call(box.querySelectorAll('.line-bad')).forEach(function (x) { x.remove(); });
    var size = 100 / n;
    bad.rows.forEach(function (r) {
      box.appendChild(el('div', { class: 'line-bad', 'data-row': String(r), style: 'left:0;right:0;top:' + r * size + '%;height:' + size + '%' }));
    });
    bad.cols.forEach(function (c) {
      box.appendChild(el('div', { class: 'line-bad', 'data-col': String(c), style: 'top:0;bottom:0;left:' + c * size + '%;width:' + size + '%' }));
    });
    renderStatus(bad, g);
  }

  // The line under the garden: how to play before the first move, then what breaks a rule
  // or how many seedlings are in.
  function renderStatus(bad, g) {
    var status = $('status'), planted = 0, n = S.puzzle.n;
    for (var i = 0; i < g.length; i++) if (g[i] === P.SEED) planted++;
    status.className = 'status';
    status.textContent = '';
    if (S.solved) {
      status.textContent = 'Every rule kept.';
    } else if (bad.seeds.length) {
      status.className = 'status bad';
      status.textContent = problemText(bad);
    } else if (!S.moves && clueShown >= 0) {
      status.textContent = 'Tap once for ✕, twice for 🌱';
      status.appendChild(el('span', { class: 'tip', text: 'Start with the pulsing square: it can’t hold a seedling.' }));
    } else if (!S.moves || g === P.emptyGarden(n)) {
      status.textContent = 'Tap once for ✕, twice for 🌱';
      status.appendChild(el('span', { class: 'more', text: 'Drag across squares to mark them all ✕' }));
    } else {
      status.textContent = planted + ' of ' + n + ' seedlings planted';
    }
  }
  function problemText(bad) {
    if (bad.rows.length) return 'Two seedlings in row ' + (bad.rows[0] + 1);
    if (bad.cols.length) return 'Two seedlings in column ' + (bad.cols[0] + 1);
    if (bad.beds.length) return 'Two seedlings in the ' + P.PALETTE[S.puzzle.colours[bad.beds[0]]].name + ' bed';
    return 'Seedlings can’t touch, not even at corners';
  }
  // Tells screen readers what a change did to a square, and any rule it broke.
  function describeChange(i) {
    if (S.solved) return;
    var state = S.garden[i], what = state === P.SEED ? 'Seedling' : state === P.CROSS ? '✕' : 'Cleared';
    var bad = P.conflicts(S.puzzle, S.garden);
    announce(what + ', ' + squareName(i) + '.' + (state === P.SEED && bad.seeds.indexOf(i) >= 0 ? ' ' + problemText(bad) + '.' : ''));
  }

  function renderTools() {
    $('tools').hidden = S.solved;
    $('undo-btn').disabled = !S.undo.length;
    $('clear-btn').disabled = S.garden === P.emptyGarden(S.puzzle.n);
    $('hint-btn').textContent = '';
    $('hint-btn').appendChild(el('span', { 'aria-hidden': 'true', text: '💡' }));
    $('hint-btn').appendChild(document.createTextNode(S.hints ? ' Hint (' + S.hints + ')' : ' Hint'));
    // A button that has just switched itself off would drop the keyboard focus: send it back to the garden.
    var active = document.activeElement;
    if (!S.solved && active && active.disabled && active.closest('#tools')) cells[S.focus].focus({ preventScroll: true });
  }
  function renderTimer() { $('timer').textContent = P.formatTime(elapsedNow()); }
  function spokenTime(ms) {
    var s = Math.floor(ms / 1000), m = Math.floor(s / 60);
    return (m ? plural(m, 'minute', 'minutes') + ' ' : '') + plural(s % 60, 'second', 'seconds');
  }

  // ---- pointer: tap to change a square, drag to mark squares ✕
  //
  // Nothing changes when the pointer goes down. Released on the same square without having
  // left it, the gesture is a tap. Once it leaves that square it is a drag, which marks the
  // empty squares it crosses ✕ (never planting or clearing), shows them as it goes, and is
  // recorded as one step when the pointer is released. A cancelled gesture changes nothing.

  function cellAt(x, y) {
    var t = document.elementFromPoint(x, y), cell = t && t.closest ? t.closest('.cell') : null;
    return cell && $('garden').contains(cell) ? Number(cell.getAttribute('data-i')) : -1;
  }
  // A garden with ✕ on those of the marked squares that are empty.
  function withMarks(garden, marks) {
    Object.keys(marks).forEach(function (i) { if (garden[i] === P.EMPTY) garden = withSquare(garden, Number(i), P.CROSS); });
    return garden;
  }
  // The garden as drawn: this tab's game, with the ✕ marks of a drag in progress.
  function shownGarden() { return drag && drag.moved ? withMarks(S.garden, drag.marks) : S.garden; }
  // Which of the [start, end) spans holds v, or -1.
  function spanAt(spans, v) {
    for (var k = 0; k < spans.length; k++) if (v >= spans[k][0] && v < spans[k][1]) return k;
    return -1;
  }
  // Every square the straight line from (x0, y0) to (x1, y1) passes through, in order, with
  // -1 for any stretch outside the squares. The line is cut wherever it crosses the edge of a
  // column or row, and each piece is placed by its middle. A piece shorter than a sixth of a
  // square (the line just clipping a corner) is skipped, but the square the line ends in
  // always counts.
  function squaresAlong(x0, y0, x1, y1) {
    var n = S.puzzle.n, cols = [], rows = [], k;
    for (k = 0; k < n; k++) {
      var a = cells[k].getBoundingClientRect(), b = cells[k * n].getBoundingClientRect();
      cols.push([a.left, a.right]);
      rows.push([b.top, b.bottom]);
    }
    var dx = x1 - x0, dy = y1 - y0, len = Math.sqrt(dx * dx + dy * dy), cuts = [0, 1], out = [];
    for (k = 0; k < n; k++) {
      if (dx) cuts.push((cols[k][0] - x0) / dx, (cols[k][1] - x0) / dx);
      if (dy) cuts.push((rows[k][0] - y0) / dy, (rows[k][1] - y0) / dy);
    }
    cuts = cuts.filter(function (t) { return t >= 0 && t <= 1; }).sort(function (s, t) { return s - t; });
    var at = function (t) {
      var r = spanAt(rows, y0 + dy * t), c = spanAt(cols, x0 + dx * t);
      return r < 0 || c < 0 ? -1 : r * n + c;
    };
    var least = (cols[0][1] - cols[0][0]) / 6;
    for (k = 1; k < cuts.length; k++) if ((cuts[k] - cuts[k - 1]) * len >= least) out.push(at((cuts[k - 1] + cuts[k]) / 2));
    out.push(at(1));
    return out;
  }
  function onPointerDown(e) {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    var i = cellAt(e.clientX, e.clientY);
    if (i < 0) return;
    e.preventDefault();
    if (drag || S.solved) return;
    S.focus = i;
    drag = { id: e.pointerId, start: i, x: e.clientX, y: e.clientY, marks: {}, moved: false };
    try { $('garden').setPointerCapture(e.pointerId); } catch (err) { /* moves are still followed */ }
  }
  // Follow the pointer to (x, y). Once it has left the first square, every square on the way
  // is marked, the first square included.
  function follow(x, y) {
    var path = squaresAlong(drag.x, drag.y, x, y), was = drag.moved;
    drag.x = x;
    drag.y = y;
    path.forEach(function (i) { if (i !== drag.start) drag.moved = true; });
    if (!drag.moved) return;
    if (!was) path.unshift(drag.start);
    path.forEach(function (i) { if (i >= 0) drag.marks[i] = true; });
    renderGarden();
  }
  function onPointerMove(e) {
    if (!drag || e.pointerId !== drag.id) return;
    follow(e.clientX, e.clientY);
  }
  function onPointerUp(e) {
    if (!drag || e.pointerId !== drag.id) return;
    follow(e.clientX, e.clientY);
    var d = drag;
    drag = null;
    if (!d.moved) {
      S.focus = d.start;
      tapSquare(d.start);
      return;
    }
    // Another tab may have moved on while the drag was held: then its game is taken instead.
    if (!canChange()) { renderGarden(); return; }
    var before = S.garden;
    S.garden = withMarks(before, d.marks);
    commit(before);
    renderGarden();
    var marked = 0;
    for (var i = 0; i < S.garden.length; i++) if (S.garden[i] === P.CROSS && before[i] !== P.CROSS) marked++;
    if (marked) announce('Marked ' + plural(marked, 'square', 'squares') + ' ✕.');
  }
  function onPointerCancel(e) {
    if (!drag || e.pointerId !== drag.id) return;
    drag = null;
    renderGarden();
  }

  // ---- keyboard

  function focusSquare(i) {
    S.focus = i;
    cells.forEach(function (c, k) { c.tabIndex = k === i ? 0 : -1; });
    cells[i].focus({ preventScroll: false });
  }
  function onKeyDown(e) {
    var cell = e.target.closest && e.target.closest('.cell');
    if (!cell || e.altKey || e.ctrlKey || e.metaKey) return;
    var i = Number(cell.getAttribute('data-i')), n = S.puzzle.n, r = Math.floor(i / n), c = i % n;
    var to = { ArrowUp: [r - 1, c], ArrowDown: [r + 1, c], ArrowLeft: [r, c - 1], ArrowRight: [r, c + 1], Home: [r, 0], End: [r, n - 1] }[e.key];
    if (to) {
      e.preventDefault();
      if (to[0] >= 0 && to[0] < n && to[1] >= 0 && to[1] < n) focusSquare(to[0] * n + to[1]);
      return;
    }
    if (e.key === ' ' || e.key === 'Enter') {
      e.preventDefault();
      if (e.repeat) return;
      S.focus = i;
      tapSquare(i);
    } else if (e.key === 'Delete' || e.key === 'Backspace') {
      e.preventDefault();
      S.focus = i;
      clearSquare(i);
    } else {
      return;
    }
    // If another tab's game was taken instead, the squares were rebuilt: keep the focus.
    if (!S.solved && document.activeElement !== cells[S.focus]) cells[S.focus].focus({ preventScroll: true });
  }

  // ---- the result card

  function renderResults(justSolved) {
    var box = $('results'), p = S.puzzle;
    box.hidden = false;
    box.textContent = '';
    box.appendChild(el('div', { class: 'score-head' }, [
      el('div', { class: 'score', 'aria-label': 'Solved in ' + spokenTime(S.elapsed) }, [P.formatTime(S.elapsed)]),
      el('div', {}, [
        el('h2', { class: 'score-title', text: S.hints ? 'Garden grown' : 'In full bloom' }),
        el('p', { class: 'score-sub', text: p.n + ' by ' + p.n + ', ' + p.difficulty + ' · ' + (S.hints ? plural(S.hints, 'hint', 'hints') : 'no hints') }),
        S.pb ? el('p', { class: 'pb', text: 'Personal best!' }) : null,
      ]),
    ]));
    box.appendChild(el('div', { class: 'actions' }, [
      el('button', { class: 'primary', type: 'button', text: 'Share result', onclick: share }),
      el('button', { class: 'secondary', type: 'button', text: 'Stats', onclick: openStats }),
    ]));
    box.appendChild(el('pre', { class: 'share-text', id: 'share-text', hidden: true }));
    if (S.persist && store.stats.streak >= 2 && store.stats.lastDay === S.day) {
      box.appendChild(el('p', { class: 'streak', text: '🔥 ' + store.stats.streak + ' days in a row' }));
    }
    box.appendChild(el('p', { class: 'next', id: 'next' }));
    tick();
    if (justSolved) {
      box.querySelector('.primary').focus({ preventScroll: true });
      if (!reduced()) box.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  }

  // ---- sharing

  function share() {
    var text = P.shareText(S.puzzle, S.elapsed, S.hints, SITE_URL);
    var showText = function () {
      var pre = $('share-text');
      pre.textContent = text;
      pre.hidden = false;
      try { window.getSelection().selectAllChildren(pre); } catch (e) { /* the text is still there to copy by hand */ }
      toast('Select the text below to copy it');
    };
    var copy = function () {
      if (!navigator.clipboard || !navigator.clipboard.writeText) { showText(); return; }
      navigator.clipboard.writeText(text).then(function () { toast('Copied. Paste it to a friend'); }, showText);
    };
    if (TOUCH && navigator.share) {
      navigator.share({ text: text }).catch(function (err) { if (!err || err.name !== 'AbortError') copy(); });
    } else {
      copy();
    }
  }

  // ---- the clock: the timer, the countdown to the next day, and moving on when it arrives

  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function tick() {
    renderTimer();
    if (S.runningSince && Date.now() - lastSave >= SAVE_EVERY) saveProgress();
    var box = $('next');
    if (!S.persist) {
      if (box) box.textContent = 'Preview: use the arrows at the top to try another day.';
      return;
    }
    var newDay = today() !== S.day;
    // A day nobody has started moves on by itself. One in progress can be finished first.
    if (newDay && !S.moves) { startGame(today(), true); return; }
    if (!box || !S.solved || $('results').hidden) return;
    if (newDay) {
      if (box.getAttribute('data-ready')) return;
      box.setAttribute('data-ready', '1');
      box.textContent = 'A new garden is ready. ';
      box.appendChild(el('button', { class: 'chip-btn', type: 'button', text: 'Play', onclick: function () { startGame(today(), true); focusSquare(0); } }));
      return;
    }
    var s = Math.floor(P.msUntilTomorrow() / 1000);
    box.textContent = 'Next garden in ';
    box.appendChild(el('b', { text: pad(Math.floor(s / 3600)) + ':' + pad(Math.floor(s / 60) % 60) + ':' + pad(s % 60) }));
  }

  // ---- stats

  function openStats() {
    var st = store.stats, body = $('stats-body');
    body.textContent = '';
    body.appendChild(el('div', { class: 'nums' }, [
      num(st.played, 'Played'),
      num(st.lastDay >= today() - 1 ? st.streak : 0, 'Day streak'),
      num(st.best, 'Best streak'),
    ]));
    body.appendChild(el('h3', { text: 'Times by garden size' }));
    var todayN = S.persist && S.solved && st.lastDay === S.day ? S.puzzle.n : 0;
    body.appendChild(el('table', { class: 'times' }, [
      el('thead', {}, [el('tr', {}, [el('th', { scope: 'col', text: 'Garden' }), el('th', { scope: 'col', text: 'Solved' }), el('th', { scope: 'col', text: 'Best' }), el('th', { scope: 'col', text: 'Average' })])]),
      el('tbody', {}, P.SIZES.map(function (n) {
        var b = st.bySize[n];
        return el('tr', { class: n === todayN ? 'today' : null }, [
          el('th', { scope: 'row', text: n + '×' + n }),
          el('td', { text: String(b.solved) }),
          el('td', { text: b.best ? P.formatTime(b.best) : '–' }),
          el('td', { text: b.solved ? P.formatTime(b.total / b.solved) : '–' }),
        ]);
      })),
    ]));
    body.appendChild(el('p', { class: 'fine', text: 'Best times count gardens solved without a hint.' + (st.hints ? ' Hints used so far: ' + st.hints + '.' : '') }));
    if (PREVIEW) body.appendChild(el('p', { class: 'fine', text: 'This is a preview, so gardens solved here are not counted.' }));
    openDialog('stats');
  }
  function num(value, label) {
    return el('div', {}, [el('b', { text: String(value) }), el('span', { text: label })]);
  }

  // ---- dialogs, toast, live region, settings

  function openDialog(id) {
    var d = $(id);
    try { if (!d.open) d.showModal(); } catch (e) { d.setAttribute('open', ''); }
  }
  function closeDialog(d) {
    try { d.close(); } catch (e) { d.removeAttribute('open'); }
  }
  var toastTimer = 0;
  function toast(msg) {
    var t = $('toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.classList.remove('show'); }, 2200);
  }
  function announce(msg) { $('live').textContent = msg; }
  function applyContrast() {
    if (store.contrast) root.setAttribute('data-contrast', 'high'); else root.removeAttribute('data-contrast');
    $('contrast').checked = store.contrast;
  }

  // ---- wiring

  var garden = $('garden');
  garden.addEventListener('pointerdown', onPointerDown);
  window.addEventListener('pointermove', onPointerMove);
  window.addEventListener('pointerup', onPointerUp);
  window.addEventListener('pointercancel', onPointerCancel);
  // The page must not scroll under a finger that is marking squares.
  garden.addEventListener('touchmove', function (e) { e.preventDefault(); }, { passive: false });
  garden.addEventListener('keydown', onKeyDown);
  // A screen reader's own "activate" sends a click with no pointer behind it.
  garden.addEventListener('click', function (e) {
    var cell = e.target.closest && e.target.closest('.cell');
    if (cell && e.detail === 0) { S.focus = Number(cell.getAttribute('data-i')); tapSquare(S.focus); }
  });
  garden.addEventListener('focusin', function (e) {
    var cell = e.target.closest && e.target.closest('.cell');
    if (cell) S.focus = Number(cell.getAttribute('data-i'));
  });
  $('undo-btn').addEventListener('click', undo);
  $('clear-btn').addEventListener('click', clearAll);
  $('hint-btn').addEventListener('click', hint);
  // Ctrl+Z or Cmd+Z undoes, unless a dialog is open.
  document.addEventListener('keydown', function (e) {
    if ((e.ctrlKey || e.metaKey) && !e.shiftKey && (e.key === 'z' || e.key === 'Z') && !document.querySelector('dialog[open]')) {
      e.preventDefault();
      undo();
    }
  });
  // A held Enter or Space on a button repeats; only the first press counts.
  document.addEventListener('keydown', function (e) {
    if (e.repeat && (e.key === 'Enter' || e.key === ' ') && e.target.closest && e.target.closest('button')) e.preventDefault();
  }, true);
  $('help-btn').addEventListener('click', function () { openDialog('help'); });
  $('stats-btn').addEventListener('click', openStats);
  Array.prototype.forEach.call(document.querySelectorAll('dialog'), function (d) {
    d.addEventListener('click', function (e) {
      if (e.target === d || (e.target.closest && e.target.closest('[data-close]'))) closeDialog(d);
    });
  });
  $('contrast').addEventListener('change', function () {
    // Read the store again first, so this write carries what another tab has saved since.
    refresh();
    store.contrast = $('contrast').checked;
    save();
    applyContrast();
  });
  $('prev-day').addEventListener('click', function () { if (S.day > 1) startGame(S.day - 1, false); });
  $('next-day').addEventListener('click', function () { startGame(S.day + 1, false); });
  // Another tab saved something: take its copy, and redraw if it has played this day further
  // than this tab, or as far but differently.
  window.addEventListener('storage', function (e) {
    if (e.key !== STORE_KEY || writeFailed) return;
    if (!refresh()) return;
    applyContrast();
    if (!S.persist || drag) return;
    var theirs = store.game;
    if (theirs && theirs.day > S.day) {
      if (!S.moves || S.solved) startGame(today(), true);
    } else if (theirs && theirs.day === S.day) {
      if (savedIsNewer()) adopt();
      else { mergeClock(); renderTimer(); }
    } else if (S.moves) {
      // Their copy has no trace of this tab's day (it was on an earlier one): put ours back.
      snapshot();
    }
  });
  // The clock stops while the page is hidden, and the time so far is saved.
  document.addEventListener('visibilitychange', function () {
    if (document.hidden) {
      if (S.runningSince) { stopClock(); saveProgress(); }
    } else {
      if (S.moves && !S.solved) startClock();
      tick();
    }
  });
  window.addEventListener('pagehide', function () { if (S.runningSince) saveProgress(); });
  setInterval(tick, 1000);

  applyContrast();
  startGame(forcedDay > 0 ? forcedDay : today(), !PREVIEW);
})();
