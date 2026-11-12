/*
 * Reunion page. Draws the day's paddock, turns drags, taps and keys into paths, runs the
 * clock, and keeps the player's progress in localStorage. The rules (puzzles, path editing,
 * completion, hints, share text, stats) are in logic.js.
 */
(function () {
  'use strict';

  var P = window.Reunion;
  var BANK = window.REUNION_PUZZLES;

  // The address added to shared results. Empty until the game has a home.
  var SITE_URL = 'https://thombee.github.io/games/reunion/';
  var STORE_KEY = 'reunion:v1';
  // While the clock runs, progress is saved at least this often.
  var SAVE_EVERY = 5000;
  var SVG = 'http://www.w3.org/2000/svg';

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
  function svg(tag, attrs) {
    var n = document.createElementNS(SVG, tag);
    Object.keys(attrs).forEach(function (k) { n.setAttribute(k, attrs[k]); });
    return n;
  }
  function plural(n, one, many) { return n + ' ' + (n === 1 ? one : many); }

  // ---- saved progress

  function emptyStore() { return { v: 1, stats: P.emptyStats(), game: null, contrast: false }; }
  function count(v) { return Number.isFinite(v) && v >= 0 ? Math.floor(v) : 0; }
  function isIndexList(a, max) { return Array.isArray(a) && a.length <= max && a.every(function (x) { return Number.isInteger(x) && x >= 0; }); }
  // The saved progress, or null if this browser will not let the page read localStorage.
  // Paths are only checked for shape here; startGame checks them against the puzzle.
  function readStore() {
    var raw;
    try { raw = localStorage.getItem(STORE_KEY); } catch (e) { return null; }
    var s = emptyStore();
    try {
      var d = JSON.parse(raw || 'null');
      if (!d || d.v !== 1) return s;
      var st = d.stats || {};
      ['played', 'streak', 'best', 'lastDay', 'clean', 'hints'].forEach(function (k) { s.stats[k] = count(st[k]); });
      P.SIZES.forEach(function (n) {
        var b = (st.bySize || {})[n] || {};
        s.stats.bySize[n] = { solved: count(b.solved), total: count(b.total), best: count(b.best) };
      });
      var g = d.game;
      if (g && Number.isInteger(g.day) && g.day > 0 && Array.isArray(g.paths) && g.paths.length <= 12) {
        s.game = {
          day: g.day, paths: g.paths.map(function (p) { return isIndexList(p, 64) ? p.slice() : []; }), locked: isIndexList(g.locked, 12) ? g.locked.slice() : [],
          elapsed: count(g.elapsed), hints: count(g.hints), moves: count(g.moves), solved: g.solved === true,
          started: g.started === true, peek: Number.isInteger(g.peek) && g.peek >= 0 && g.peek < 12 ? g.peek : -1,
        };
      }
      s.contrast = d.contrast === true;
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
   * day, persist (false in preview), puzzle, paths (one list of squares per pair: see
   * logic.js), locked (true for each pair a hint drew), peek (the pair whose first two
   * squares a first press of Hint shows, or -1), moves (changes made, counting undo, clear
   * and hints), hints, solved, started (true once the clock has started, even if a tap
   * changed nothing), elapsed (ms on the clock before runningSince), runningSince (when the
   * clock last started, or 0 while it is stopped), undo (earlier { paths, locked }), focus
   * (the square keyboard focus goes to).
   */
  var S = null;
  /*
   * The path in hand, while a finger, mouse or keyboard is drawing: { by: a pointer id or
   * 'key', base: the paths when drawing began, hold: { pair, path }, x, y: where the pointer
   * last was, in squares }. The paths on screen are withCut(base, hold.pair, hold.path).
   */
  var drag = null;
  var lastSave = 0;

  function today() { return Math.max(1, P.dayNumber()); }

  function startGame(day, persist, carry) {
    var puzzle = P.dailyPuzzle(day, BANK);
    S = {
      day: day, persist: persist, puzzle: puzzle, paths: P.emptyPaths(puzzle.k), locked: new Array(puzzle.k).fill(false),
      peek: -1, moves: 0, hints: 0, solved: false, started: false, elapsed: 0, runningSince: 0, undo: [], focus: 0,
    };
    var g = store.game;
    if (persist && g && g.day === day) {
      var r = restore(puzzle, g);
      S.paths = r.paths;
      S.locked = r.locked;
      S.peek = r.peek;
      S.solved = r.solved;
      S.moves = g.moves;
      S.hints = g.hints;
      // A solved day keeps the time it was saved with; otherwise the longer clock wins.
      S.elapsed = S.solved ? g.elapsed : Math.max(g.elapsed, carry || 0);
      S.started = g.started || g.moves > 0 || S.elapsed > 0;
    }
    drag = null;
    $('preview-bar').hidden = !PREVIEW;
    $('preview-day').textContent = 'Day ' + day;
    var dayTag = $('day-tag');
    dayTag.textContent = '';
    dayTag.appendChild(el('b', { text: '#' + day }));
    dayTag.appendChild(document.createTextNode(' · ' + puzzle.n + '×' + puzzle.n + ' · ' + puzzle.difficulty));
    buildPaddock();
    if (S.started && !S.solved) startClock();
    shownJoined = null;
    render();
    renderTools();
    renderTimer();
    if (S.solved) renderResults(false); else $('results').hidden = true;
  }

  // A saved game's paths, hinted pairs, half-shown hint and solved flag, keeping only what
  // fits the puzzle: paths that could have been drawn, locks on paths that are the solution,
  // a half-shown hint on a pair that is not locked, and solved only if it is.
  function restore(puzzle, g) {
    var paths = P.cleanPaths(puzzle, g.paths), locked = new Array(puzzle.k).fill(false);
    g.locked.forEach(function (q) { if (q < puzzle.k && P.isSolutionPath(puzzle, q, paths[q])) locked[q] = true; });
    var peek = g.peek >= 0 && g.peek < puzzle.k && !locked[g.peek] ? g.peek : -1;
    return { paths: paths, locked: locked, peek: peek, solved: g.solved && P.progress(puzzle, paths).solved };
  }

  function elapsedNow() { return S.elapsed + (S.runningSince ? Date.now() - S.runningSince : 0); }
  function startClock() {
    if (S.solved) return;
    S.started = true;
    if (!S.runningSince && !document.hidden) S.runningSince = Date.now();
  }
  // Time on a day's clock only ever goes up: if the saved game for this day has more on its
  // clock than this tab, this tab's clock moves up to it. A solved day's time stays as it is.
  function catchUpClock() {
    var g = store.game;
    if (!S.persist || S.solved || !g || g.day !== S.day || g.elapsed <= elapsedNow()) return;
    S.elapsed = g.elapsed;
    if (S.runningSince) S.runningSince = Date.now();
    S.started = true;
  }
  function stopClock() {
    if (!S.runningSince) return;
    S.elapsed = elapsedNow();
    S.runningSince = 0;
  }

  function lockedList() {
    var out = [];
    S.locked.forEach(function (on, q) { if (on) out.push(q); });
    return out;
  }
  function snapshot() {
    if (!S.persist) return;
    catchUpClock();
    // A tab still showing an earlier day never replaces a later day's game.
    if (!store.game || store.game.day <= S.day) {
      store.game = {
        day: S.day, paths: S.paths, locked: lockedList(), peek: S.peek, elapsed: elapsedNow(), hints: S.hints, moves: S.moves,
        solved: S.solved, started: S.started,
      };
    }
    lastSave = Date.now();
    save();
  }
  function samePaths(a, b) {
    return a.length === b.length && a.every(function (p, q) { return p.length === b[q].length && p.every(function (i, x) { return i === b[q][x]; }); });
  }
  // True if the saved game is for this tab's day and is solved where this tab is not, or has
  // moved on further than this tab, or as far but differently.
  function savedIsNewer() {
    var theirs = store.game;
    if (!theirs || theirs.day !== S.day) return false;
    var r = restore(S.puzzle, theirs);
    if (r.solved !== S.solved) return r.solved;
    if (theirs.moves !== S.moves) return theirs.moves > S.moves;
    return !samePaths(r.paths, S.paths) || theirs.hints !== S.hints || r.peek !== S.peek || r.locked.join() !== S.locked.join();
  }
  // Before writing, read the store again so another tab's progress is not overwritten. If
  // that tab has moved on further, take its game instead and return false; otherwise this
  // tab's clock catches up with the saved one.
  function syncBeforeWrite() {
    if (!S.persist) return true;
    refresh();
    if (savedIsNewer()) { adopt(); return false; }
    catchUpClock();
    return true;
  }
  // Take the saved game for this day, keeping the longer of the two clocks unless it is solved.
  function adopt() {
    var mine = elapsedNow(), focus = S.focus;
    startGame(S.day, true, mine);
    S.focus = Math.min(focus, S.puzzle.n * S.puzzle.n - 1);
    render();
  }
  // Save the clock while it runs, now and then.
  function saveProgress() {
    if (!S.persist || !S.started || S.solved) return;
    if (syncBeforeWrite()) snapshot();
  }

  // ---- changing the paths

  // Records new paths (and hinted pairs) as one undo step, then the clock, saving and the
  // solved check. A hint always counts as a change, even if it drew a path already there.
  function commit(paths, locked, isHint) {
    if (samePaths(paths, S.paths) && locked.join() === S.locked.join() && !isHint) { render(); return; }
    // A half-shown hint ends once its pair is locked; undoing that step shows it again.
    var ended = S.peek >= 0 && locked[S.peek] ? S.peek : -1;
    S.undo.push({ paths: S.paths, locked: S.locked, peek: ended });
    S.paths = paths;
    S.locked = locked;
    if (ended >= 0) S.peek = -1;
    S.moves++;
    startClock();
    if (P.progress(S.puzzle, S.paths).solved) {
      S.solved = true;
      stopClock();
      if (S.persist) store.stats = P.recordResult(store.stats, S.day, S.puzzle.n, S.elapsed, S.hints);
    }
    snapshot();
    render();
    renderTools();
    renderTimer();
    if (S.solved) {
      announce('Every pair is back together. Solved in ' + spokenTime(S.elapsed) + '.');
      renderResults(true);
    }
  }

  // Picks up the path at square i, by pointer `by` or by the keyboard ('key'). Returns true
  // if there is now a path in hand.
  function pickUp(i, by, x, y) {
    if (S.solved || drag) return false;
    var hold = P.pickUp(S.puzzle, S.paths, S.locked, i);
    if (!hold) {
      var q = S.puzzle.endAt[i] >= 0 ? S.puzzle.endAt[i] : P.owner(S.paths, i);
      if (q >= 0 && S.locked[q]) announce('The ' + animal(q).name + ' path was drawn by a hint and stays put.');
      return false;
    }
    if (!syncBeforeWrite()) return false;
    drag = { by: by, base: S.paths, hold: hold, x: x, y: y };
    S.focus = i;
    startClock();
    render();
    renderTimer();
    return true;
  }
  // Moves the path in hand on to square i. Returns true if it moved.
  function moveTo(i) {
    var next = P.stepTo(S.puzzle, S.locked, drag.base, drag.hold, i);
    if (!next) return false;
    drag.hold.path = next;
    return true;
  }
  // Puts the path in hand down, keeping it as drawn.
  function putDown() {
    if (!drag) return;
    var d = drag;
    drag = null;
    if (!syncBeforeWrite()) return;
    commit(P.withCut(d.base, d.hold.pair, d.hold.path), S.locked);
  }

  function undo() {
    if (drag || !S.undo.length || S.solved || !syncBeforeWrite()) return;
    var last = S.undo.pop();
    S.paths = last.paths;
    S.locked = last.locked;
    if (last.peek >= 0) S.peek = last.peek;
    S.moves++;
    snapshot();
    render();
    renderTools();
    announce('Undone. ' + progressText());
  }
  function clearAll() {
    if (drag || S.solved || !canClear() || !syncBeforeWrite()) return;
    commit(S.paths.map(function (p, q) { return S.locked[q] ? p : []; }), S.locked);
    announce('Paths cleared. Undo brings them back.');
  }
  function canClear() { return S.paths.some(function (p, q) { return p.length && !S.locked[q]; }); }
  // A first press for a pair shows faintly where its path begins: the first two squares from
  // one animal, not locked. A second press for the same pair draws its whole path as in the
  // solution and locks it. The two count as one hint.
  function hint() {
    if (drag || S.solved || P.hintPair(S.puzzle, S.paths, S.locked) < 0 || !syncBeforeWrite()) return;
    var q = P.hintPair(S.puzzle, S.paths, S.locked);
    if (q < 0) return;
    var s = S.puzzle.solution[q];
    S.focus = s[0];
    if (S.peek !== q) {
      S.peek = q;
      S.hints++;
      S.moves++;
      startClock();
      snapshot();
      render();
      renderTools();
      renderTimer();
      announce('Hint: the ' + animal(q).name + ' path goes from ' + squareName(s[0]) + ' to ' + squareName(s[1]) + '. Press Hint again to draw all of it.');
      return;
    }
    var locked = S.locked.slice();
    locked[q] = true;
    commit(P.withCut(S.paths, q, s), locked, true);
    if (!S.solved) announce('Hint: the ' + animal(q).name + ' path is drawn. ' + progressText());
  }
  // Clears the path of the pair at square i (a key press, not a tap).
  function clearPairAt(i) {
    var q = S.puzzle.endAt[i] >= 0 ? S.puzzle.endAt[i] : P.owner(S.paths, i);
    if (q < 0 || S.locked[q] || !S.paths[q].length || S.solved || !syncBeforeWrite()) return;
    var paths = S.paths.slice();
    paths[q] = [];
    commit(paths, S.locked);
    announce('The ' + animal(q).name + ' path is cleared.');
  }

  // ---- drawing the paddock

  var cells = [];
  var lines = null;
  // The pairs joined at the last redraw, so a pair that has just been joined can wiggle.
  var shownJoined = null;

  function animal(q) { return S.puzzle.animals[q]; }
  function animals(q) {
    var name = animal(q).name;
    return name === 'sheep' ? 'sheep' : name === 'goose' ? 'geese' : name + 's';
  }
  function squareName(i) {
    var n = S.puzzle.n;
    return 'row ' + (Math.floor(i / n) + 1) + ', column ' + (i % n + 1);
  }
  function shownPaths() { return drag ? P.withCut(drag.base, drag.hold.pair, drag.hold.path) : S.paths; }

  // Builds the squares for the day's paddock, its animals, and the layer the paths go on.
  function buildPaddock() {
    var p = S.puzzle, n = p.n, box = $('paddock');
    box.textContent = '';
    box.style.setProperty('--n', n);
    box.setAttribute('aria-label', 'Paddock, ' + n + ' by ' + n + '. Arrow keys move. Enter picks up an animal or the end of a path, arrow keys draw, Enter puts it down. Or activate an animal, then each square along its path in turn.');
    cells = [];
    var k = 0;
    for (var r = 0; r < n; r++) {
      var row = el('div', { class: 'row', role: 'row' });
      for (var c = 0; c < n; c++) {
        var i = r * n + c, q = p.endAt[i];
        var cell = el('div', { class: 'cell', role: 'gridcell', tabindex: '-1', 'data-i': String(i) });
        if (q >= 0) {
          cell.appendChild(el('span', { class: 'animal p' + p.colours[q], 'data-pair': String(q), style: '--k:' + k++, 'aria-hidden': 'true' }, [
            el('span', { text: animal(q).emoji }),
          ]));
        }
        row.appendChild(cell);
        cells.push(cell);
      }
      box.appendChild(row);
    }
    lines = svg('svg', { class: 'lines', viewBox: '0 0 ' + n + ' ' + n, 'aria-hidden': 'true' });
    box.appendChild(lines);
  }

  // Brings the paddock up to date: the paths, which squares they cover, joined pairs, a
  // half-shown hint, the line above the paddock and every square's label.
  function render() {
    var p = S.puzzle, n = p.n, paths = shownPaths(), where = new Array(n * n).fill(-1);
    lines.textContent = '';
    var tints = svg('g', {}), casings = svg('g', {}), strokes = svg('g', {}), dots = svg('g', {});
    paths.forEach(function (path, q) {
      if (path.length < 2) return;
      var cls = 'p' + p.colours[q];
      var pts = path.map(function (i) { where[i] = q; return (i % n + 0.5) + ',' + (Math.floor(i / n) + 0.5); }).join(' ');
      path.forEach(function (i) { tints.appendChild(svg('rect', { class: 'tint ' + cls, x: i % n, y: Math.floor(i / n), width: 1, height: 1 })); });
      casings.appendChild(svg('polyline', { class: 'casing', points: pts, style: 'stroke-width:calc(var(--ru-stroke) + .1)' }));
      strokes.appendChild(svg('polyline', { class: cls, 'data-pair': String(q), points: pts, style: 'stroke-width:var(--ru-stroke)' }));
      if (S.locked[q]) dots.appendChild(svg('polyline', { class: 'locked', points: pts, style: 'stroke-width:.09' }));
    });
    // A half-shown hint: the first two squares of its pair's path, faint, until that pair is drawn right.
    var hinted = peekSquares(paths), faint = svg('g', {});
    if (hinted) {
      var pts = hinted.map(function (i) { return (i % n + 0.5) + ',' + (Math.floor(i / n) + 0.5); }).join(' ');
      faint.appendChild(svg('polyline', { class: 'peek p' + p.colours[S.peek], points: pts, style: 'stroke-width:var(--ru-stroke)' }));
    }
    [tints, casings, strokes, dots, faint].forEach(function (g) { lines.appendChild(g); });

    var joined = paths.map(function (path, q) { return P.isComplete(p, q, path); });
    var head = drag ? drag.hold.path[drag.hold.path.length - 1] : -1;
    cells.forEach(function (cell, i) {
      var q = p.endAt[i] >= 0 ? p.endAt[i] : where[i];
      cell.setAttribute('data-pair', q >= 0 && (p.endAt[i] < 0 || where[i] >= 0) ? String(q) : '');
      cell.classList.toggle('held', i === head);
      cell.tabIndex = i === S.focus ? 0 : -1;
      var label = cellLabel(i, paths, where, joined);
      if (i === head) label += ', in hand';
      if (hinted && i === hinted[1] && where[i] !== S.peek) label += ', hint: the ' + animal(S.peek).name + ' path goes here';
      cell.setAttribute('aria-label', label);
      if (S.solved) cell.setAttribute('aria-disabled', 'true'); else cell.removeAttribute('aria-disabled');
      var a = cell.firstChild;
      if (a) {
        a.classList.toggle('joined', joined[q]);
        if (shownJoined && joined[q] && !shownJoined[q] && !S.solved && !reduced()) wiggle(a);
      }
    });
    shownJoined = joined;
    $('paddock').classList.toggle('done', S.solved && !reduced());
    renderStatus(paths);
  }
  // The squares a half-shown hint shows, or null if there is none to show with these paths.
  function peekSquares(paths) {
    var q = S.peek;
    if (q < 0 || S.solved || S.locked[q] || P.isSolutionPath(S.puzzle, q, paths[q])) return null;
    return S.puzzle.solution[q].slice(0, 2);
  }
  function wiggle(a) {
    a.classList.remove('wiggle');
    void a.offsetWidth; // restart the animation if it is already running
    a.classList.add('wiggle');
    a.addEventListener('animationend', function () { a.classList.remove('wiggle'); }, { once: true });
  }
  function cellLabel(i, paths, where, joined) {
    var p = S.puzzle, q = p.endAt[i], at = squareName(i).replace(/^r/, 'R') + ', ';
    if (q >= 0) return at + animal(q).name + (joined[q] ? ', joined' : paths[q].length >= 2 ? ', path started' : '') + (S.locked[q] ? ', from a hint' : '');
    q = where[i];
    if (q < 0) return at + 'empty';
    var path = paths[q];
    return at + animal(q).name + ' path' + (P.looseEnd(p, q, path) === i ? ', loose end' : '');
  }

  function progressText() {
    var pr = P.progress(S.puzzle, S.paths);
    return pr.joined + ' of ' + S.puzzle.k + ' pairs · ' + pr.percent + '% covered';
  }
  // The line above the paddock: how to play before the first move; the pair in hand while
  // drawing; then how far the player has got, or what is still missing.
  function renderStatus(paths) {
    var status = $('status'), p = S.puzzle, pr = P.progress(p, paths);
    status.className = 'status';
    status.textContent = '';
    if (drag && drag.hold.path) {
      var q = drag.hold.pair;
      status.appendChild(el('span', { class: 'chip p' + p.colours[q] }, [el('i', { 'aria-hidden': 'true', text: animal(q).emoji }), animal(q).name]));
      status.appendChild(el('span', { class: 'then', text: P.isComplete(p, q, drag.hold.path) ? 'together again' : 'to its partner' }));
    } else if (S.solved) {
      status.textContent = 'Every pair is back together.';
    } else if (!S.moves && !paths.some(function (x) { return x.length; })) {
      status.className = 'status first';
      status.textContent = 'Drag from an animal to its partner. Fill every square.';
    } else if (pr.allJoined) {
      status.className = 'status warn';
      status.textContent = 'Every square needs a path through it.';
    } else {
      status.textContent = pr.joined + ' of ' + p.k + ' pairs · ' + pr.percent + '% covered';
    }
  }

  function renderTools() {
    $('tools').hidden = S.solved;
    $('undo-btn').disabled = !S.undo.length;
    $('clear-btn').disabled = !canClear();
    $('hint-btn').textContent = '';
    $('hint-btn').appendChild(el('span', { 'aria-hidden': 'true', text: '💡' }));
    $('hint-btn').appendChild(document.createTextNode(S.hints ? ' Hint (' + S.hints + ')' : ' Hint'));
    // A button that has just switched itself off would drop the keyboard focus: send it back to the paddock.
    var active = document.activeElement;
    if (!S.solved && active && active.disabled && active.closest('#tools')) cells[S.focus].focus({ preventScroll: true });
  }
  function renderTimer() { $('timer').textContent = P.formatTime(elapsedNow()); }
  function spokenTime(ms) {
    var s = Math.floor(ms / 1000), m = Math.floor(s / 60);
    return (m ? plural(m, 'minute', 'minutes') + ' ' : '') + plural(s % 60, 'second', 'seconds');
  }

  // ---- pointer: press on an animal or a path, drag to draw, let go to put it down

  // Where a pointer is over the paddock, in squares (x across, y down), and the square under
  // it; outside the paddock the position is held at its edge.
  function pointAt(e) {
    var box = $('paddock'), rect = box.getBoundingClientRect(), n = S.puzzle.n;
    var x = (e.clientX - rect.left - box.clientLeft) / box.clientWidth * n;
    var y = (e.clientY - rect.top - box.clientTop) / box.clientHeight * n;
    var cx = Math.min(n - 1e-6, Math.max(0, x)), cy = Math.min(n - 1e-6, Math.max(0, y));
    return { x: cx, y: cy, i: Math.floor(cy) * n + Math.floor(cx) };
  }
  function onPointerDown(e) {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    if (drag && drag.by !== 'key') return;
    e.preventDefault();
    if (drag) putDown();
    var at = pointAt(e);
    if (!pickUp(at.i, e.pointerId, at.x, at.y)) return;
    try { $('paddock').setPointerCapture(e.pointerId); } catch (err) { /* moves are still followed */ }
  }
  // Carries the path in hand on to where pointer event e is.
  function follow(e) {
    // Every square the pointer passed over since the last event, so a fast finger, or one
    // that cuts a corner, still draws square by square.
    var at = pointAt(e), along = P.cellsAlong(S.puzzle.n, drag.x, drag.y, at.x, at.y), moved = false;
    drag.x = at.x;
    drag.y = at.y;
    for (var k = 1; k < along.length; k++) if (moveTo(along[k])) moved = true;
    if (moved) render();
  }
  function onPointerMove(e) {
    if (!drag || e.pointerId !== drag.by) return;
    follow(e);
  }
  // Letting go counts where the pointer was let go, even with no move before it.
  function onPointerUp(e) {
    if (!drag || e.pointerId !== drag.by) return;
    follow(e);
    putDown();
  }
  // A drag the browser cancels (it took the touch for something else) changes nothing.
  function onPointerCancel(e) {
    if (!drag || e.pointerId !== drag.by) return;
    drag = null;
    render();
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
    var to = { ArrowUp: [r - 1, c], ArrowDown: [r + 1, c], ArrowLeft: [r, c - 1], ArrowRight: [r, c + 1] }[e.key];
    if (to) {
      e.preventDefault();
      if (to[0] < 0 || to[0] >= n || to[1] < 0 || to[1] >= n) return;
      var j = to[0] * n + to[1];
      if (drag && drag.by === 'key') {
        if (!moveTo(j)) {
          var q = S.puzzle.endAt[j];
          announce(q >= 0 ? 'The ' + animal(q).name + ' is in the way.' : P.isComplete(S.puzzle, drag.hold.pair, drag.hold.path) ? 'This pair is joined. Press Enter to put it down.' : 'That path was drawn by a hint.');
          return;
        }
        focusSquare(j);
        render();
        var hold = drag.hold;
        announce(P.isComplete(S.puzzle, hold.pair, hold.path) ? 'The ' + animals(hold.pair) + ' are together again. Press Enter to put the path down.' : squareName(j).replace(/^r/, 'R') + '.');
      } else {
        focusSquare(j);
      }
      return;
    }
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      if (e.repeat) return;
      if (drag && drag.by === 'key') { putDownByKey(); return; }
      if (pickUp(i, 'key', c + 0.5, r + 0.5)) {
        announce('Holding the ' + animal(drag.hold.pair).name + ' path. Arrow keys draw, Enter puts it down.');
      } else if (!S.solved && S.puzzle.endAt[i] < 0 && P.owner(S.paths, i) < 0) {
        announce('Empty square. Pick up an animal to draw from it.');
      }
      afterKey();
    } else if (e.key === 'Escape') {
      if (drag && drag.by === 'key') { e.preventDefault(); putDownByKey(); }
    } else if (e.key === 'Delete' || e.key === 'Backspace') {
      e.preventDefault();
      if (drag) return;
      clearPairAt(i);
      afterKey();
    }
  }

  /*
   * Drawing by activating squares one at a time, as a screen reader on a phone does: an
   * animal or a path's end picks the path up; a free square beside the end carries it on (or
   * one back along it shortens it); the partner completes it and puts it down; the end in
   * hand again puts it down. Each step is announced.
   */
  function activate(i) {
    var n = S.puzzle.n;
    S.focus = i;
    if (!drag) {
      if (pickUp(i, 'key', i % n + 0.5, Math.floor(i / n) + 0.5)) {
        announce('Holding the ' + animal(drag.hold.pair).name + ' path. Activate a square beside its end to draw, or its end again to put it down.');
      } else if (!S.solved && S.puzzle.endAt[i] < 0 && P.owner(S.paths, i) < 0) {
        announce('Empty square. Pick up an animal to draw from it.');
      }
      afterKey();
      return;
    }
    if (drag.by !== 'key') return;
    var hold = drag.hold, end = hold.path[hold.path.length - 1];
    if (i === end) { putDownByKey(); return; }
    if (!P.adjacent(n, end, i)) {
      announce('That square is not beside the end of the path, at ' + squareName(end) + '.');
      afterKey();
      return;
    }
    if (!moveTo(i)) {
      var q = S.puzzle.endAt[i];
      announce(q >= 0 ? 'The ' + animal(q).name + ' is in the way.' : P.isComplete(S.puzzle, hold.pair, hold.path) ? 'This pair is joined.' : 'That path was drawn by a hint.');
      afterKey();
      return;
    }
    if (P.isComplete(S.puzzle, hold.pair, hold.path)) {
      var pair = hold.pair;
      putDown();
      afterKey();
      if (!S.solved) announce('The ' + animals(pair) + ' are together again. ' + progressText());
      return;
    }
    render();
    afterKey();
    announce(squareName(i).replace(/^r/, 'R') + '. Activate the next square, or this one again to put the path down.');
  }
  function putDownByKey() {
    putDown();
    afterKey();
    if (!S.solved) announce('Put down. ' + progressText());
  }
  // After a key changes something, keeps the focus in the paddock, where it may have been
  // lost if another tab's game was taken instead and the squares were rebuilt.
  function afterKey() {
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
        el('h2', { class: 'score-title', text: S.hints ? 'Back together' : 'Everyone’s home' }),
        el('p', { class: 'score-sub', text: p.n + ' by ' + p.n + ', ' + p.difficulty + ' · ' + (S.hints ? plural(S.hints, 'hint', 'hints') : 'no hints') }),
      ]),
    ]));
    box.appendChild(el('p', { class: 'together', 'aria-hidden': 'true' }, p.animals.map(function (a) { return el('span', { text: a.emoji + a.emoji }); })));
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
    if (newDay && !S.started && !drag) { startGame(today(), true); return; }
    if (!box || !S.solved || $('results').hidden) return;
    if (newDay) {
      if (box.getAttribute('data-ready')) return;
      box.setAttribute('data-ready', '1');
      box.textContent = 'A new paddock is ready. ';
      box.appendChild(el('button', { class: 'chip-btn', type: 'button', text: 'Play', onclick: function () { startGame(today(), true); focusSquare(S.focus); } }));
      return;
    }
    var s = Math.floor(P.msUntilTomorrow() / 1000);
    box.textContent = 'Next paddock in ';
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
      num(st.played ? Math.round(st.clean / st.played * 100) + '%' : '–', 'No hints'),
    ]));
    body.appendChild(el('h3', { text: 'Times by paddock size' }));
    var todayN = S.persist && S.solved && st.lastDay === S.day ? S.puzzle.n : 0;
    body.appendChild(el('table', { class: 'times' }, [
      el('thead', {}, [el('tr', {}, [el('th', { scope: 'col', text: 'Paddock' }), el('th', { scope: 'col', text: 'Solved' }), el('th', { scope: 'col', text: 'Best' }), el('th', { scope: 'col', text: 'Average' })])]),
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
    body.appendChild(el('p', { class: 'fine', text: 'Best times count paddocks solved without a hint.' + (st.hints ? ' Hints used so far: ' + st.hints + '.' : '') }));
    if (PREVIEW) body.appendChild(el('p', { class: 'fine', text: 'This is a preview, so paddocks solved here are not counted.' }));
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

  var paddock = $('paddock');
  paddock.addEventListener('pointerdown', onPointerDown);
  window.addEventListener('pointermove', onPointerMove);
  window.addEventListener('pointerup', onPointerUp);
  window.addEventListener('pointercancel', onPointerCancel);
  // The page must not scroll under a finger that is drawing.
  paddock.addEventListener('touchmove', function (e) { e.preventDefault(); }, { passive: false });
  paddock.addEventListener('keydown', onKeyDown);
  // A screen reader's own "activate" sends a click with no pointer behind it.
  paddock.addEventListener('click', function (e) {
    var cell = e.target.closest && e.target.closest('.cell');
    if (!cell || e.detail !== 0) return;
    activate(Number(cell.getAttribute('data-i')));
  });
  paddock.addEventListener('focusin', function (e) {
    var cell = e.target.closest && e.target.closest('.cell');
    if (cell) S.focus = Number(cell.getAttribute('data-i'));
  });
  // Keyboard focus leaving the paddock puts down the path in hand.
  paddock.addEventListener('focusout', function (e) {
    if (drag && drag.by === 'key' && !(e.relatedTarget && paddock.contains(e.relatedTarget))) putDown();
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
  // than this tab, or as far but differently; else only catch up with its clock.
  window.addEventListener('storage', function (e) {
    if (e.key !== STORE_KEY || writeFailed) return;
    if (!refresh()) return;
    applyContrast();
    if (!S.persist || drag) return;
    var theirs = store.game;
    if (theirs && theirs.day > S.day) {
      if (!S.started || S.solved) startGame(today(), true);
    } else if (theirs && theirs.day === S.day) {
      if (savedIsNewer()) adopt();
      else { catchUpClock(); renderTimer(); }
    } else if (S.started) {
      // Their copy has no trace of this tab's day (it was on an earlier one): put ours back.
      snapshot();
    }
  });
  // The clock stops while the page is hidden, and the time so far is saved.
  document.addEventListener('visibilitychange', function () {
    if (document.hidden) {
      if (drag) putDown();
      if (S.runningSince) { stopClock(); saveProgress(); }
    } else {
      if (S.started && !S.solved) startClock();
      tick();
    }
  });
  window.addEventListener('pagehide', function () { if (S.runningSince) saveProgress(); });
  setInterval(tick, 1000);

  applyContrast();
  startGame(forcedDay > 0 ? forcedDay : today(), !PREVIEW);
})();
