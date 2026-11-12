/*
 * Unearth page. Draws the day's grid and clues, turns taps, drags and keys into filled and
 * crossed squares, runs the clock, colours the picture in when it is solved, and keeps the
 * player's progress in localStorage. On a first visit it runs the guided example and then a
 * warm-up picture. It keeps the album of pictures uncovered, shown with the stats. The rules
 * (pictures, clues, hints, share text, stats) are in logic.js.
 */
(function () {
  'use strict';

  var P = window.Unearth;
  var BANK = window.UNEARTH_PICTURES;

  // The address added to shared results. Empty until the game has a home.
  var SITE_URL = 'https://thombee.github.io/games/unearth/';
  var STORE_KEY = 'unearth:v1';
  // While the clock runs, progress is saved at least this often.
  var SAVE_EVERY = 5000;
  // How long Check keeps the wrong squares marked.
  var CHECK_SHOW = 2600;
  // How many blank squares the album shows for pictures still to find.
  var ALBUM_BLANKS = 3;
  var FILL = P.FILL, CROSS = P.CROSS, EMPTY = P.EMPTY;

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

  var GRID_RE = /^[.#x]+$/;
  // The daily pictures by id, for the album.
  var BY_ID = {};
  BANK.pictures.forEach(function (p) { BY_ID[p.id] = p; });
  /*
   * v, stats, game (the latest day played, see readStore), contrast, seen (the guided example
   * has been shown), warmed (the warm-up after it is done or skipped), album (the ids of the
   * daily pictures uncovered, in the order they were).
   */
  function emptyStore() { return { v: 1, stats: P.emptyStats(), game: null, contrast: false, seen: false, warmed: false, album: [] }; }
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
      ['played', 'streak', 'best', 'lastDay', 'clean'].forEach(function (k) { s.stats[k] = count(st[k]); });
      P.SIZES.forEach(function (n) {
        var b = (st.bySize || {})[n] || {};
        s.stats.bySize[n] = { solved: count(b.solved), total: count(b.total), best: count(b.best) };
      });
      var g = d.game;
      if (g && Number.isInteger(g.day) && g.day > 0 && typeof g.grid === 'string' && GRID_RE.test(g.grid)) {
        s.game = {
          day: g.day, grid: g.grid, elapsed: count(g.elapsed), checks: count(g.checks), hints: count(g.hints),
          moves: count(g.moves), solved: g.solved === true,
        };
      }
      s.contrast = d.contrast === true;
      s.seen = d.seen === true;
      // A store from before the warm-up existed belongs to a player who is past it.
      s.warmed = d.warmed === true || (d.warmed === undefined && s.seen);
      (Array.isArray(d.album) ? d.album : []).forEach(function (id) {
        if (BY_ID[id] && s.album.indexOf(id) < 0) s.album.push(id);
      });
      // A store from before the album existed still has its last solved picture.
      if (!Array.isArray(d.album) && s.game && s.game.solved) {
        var last = P.dailyPicture(s.game.day, BANK).id;
        if (s.album.indexOf(last) < 0) s.album.push(last);
      }
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
   * day, persist (false in preview and the warm-up), warmup (true while the warm-up picture is
   * played), pic (the day's picture, see logic.js), grid (a string,
   * one character a square: '.', '#' or 'x'), moves (changes made, counting undo, clear,
   * checks and hints), checks, hints, solved, elapsed (ms on the clock before runningSince),
   * runningSince (when the clock last started, or 0 while it is stopped), undo (earlier
   * grids), focus (the square that keyboard focus goes to).
   */
  var S = null;
  var mode = FILL;
  var drag = null;
  var lastSave = 0;
  // Squares Check has marked wrong, until CHECK_SHOW has passed or the grid changes.
  var wrongShown = {};
  var wrongTimer = 0;
  // A line a hint has just filled, for its flash: { kind, index }.
  var hinted = null;
  // The message under the grid after a check, until the next change.
  var said = '';

  function today() { return Math.max(1, P.dayNumber()); }

  /*
   * Shows a day's picture, taking its saved game if `persist`. `carry` is a time already on this
   * tab's clock for the day, kept if it is longer than the saved one, unless the day is solved:
   * then its recorded finishing time is the time everywhere. `warmup` plays the warm-up picture
   * instead, which is never saved.
   */
  function startGame(day, persist, carry, warmup) {
    var pic = warmup ? P.WARMUP : P.dailyPicture(day, BANK), n = pic.n;
    S = {
      day: day, persist: persist && !warmup, warmup: !!warmup, pic: pic, grid: P.emptyGrid(n), moves: 0, checks: 0, hints: 0, solved: false,
      elapsed: 0, runningSince: 0, undo: [], focus: 0,
    };
    var g = store.game;
    if (S.persist && g && g.day === day && g.grid.length === n * n) {
      S.grid = g.grid;
      S.moves = g.moves;
      S.checks = g.checks;
      S.hints = g.hints;
      S.solved = g.solved && P.isSolved(pic, g.grid);
      S.elapsed = S.solved ? g.elapsed : Math.max(g.elapsed, carry || 0);
    }
    drag = null;
    wrongShown = {};
    hinted = null;
    said = '';
    $('preview-bar').hidden = !PREVIEW || S.warmup;
    $('warmup-bar').hidden = !S.warmup;
    $('preview-day').textContent = 'Day ' + day;
    var dayTag = $('day-tag');
    dayTag.textContent = '';
    dayTag.appendChild(el('b', { text: S.warmup ? 'Warm-up' : '#' + day }));
    dayTag.appendChild(document.createTextNode(' · ' + n + '×' + n));
    board = buildBoard($('board'), pic);
    $('board').setAttribute('aria-label', 'Picture grid, ' + n + ' by ' + n + '. Arrow keys move, Space fills, X crosses.');
    if (S.moves && !S.solved) startClock();
    render(false);
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

  // The time for a day only ever goes up: if the saved game for this day has a longer time than
  // this tab's clock, the clock jumps forward to it. A solved day's time is final.
  function catchUpClock() {
    var g = store.game;
    if (!S.persist || S.solved || !g || g.day !== S.day) return;
    var ahead = g.elapsed - elapsedNow();
    if (ahead > 0) S.elapsed += ahead;
  }
  // Writes this tab's game to the store and saves it. Callers read the store again first
  // (syncBeforeWrite), so the saved time compared here is the latest.
  function snapshot() {
    if (!S.persist) return;
    catchUpClock();
    // A tab still showing an earlier day never replaces a later day's game.
    if (!store.game || store.game.day <= S.day) {
      store.game = { day: S.day, grid: S.grid, elapsed: elapsedNow(), checks: S.checks, hints: S.hints, moves: S.moves, solved: S.solved };
    }
    lastSave = Date.now();
    save();
  }
  // True if the saved game is for this tab's day and is solved while this tab's is not, or has
  // moved on further than this tab, or as far but differently.
  function savedIsNewer() {
    var theirs = store.game;
    if (!theirs || theirs.day !== S.day) return false;
    if (theirs.solved && !S.solved) return true;
    return theirs.moves > S.moves || (theirs.moves === S.moves &&
      (theirs.grid !== S.grid || theirs.hints !== S.hints || theirs.checks !== S.checks || theirs.solved !== S.solved));
  }
  // Before writing, read the store again so another tab's progress is not overwritten. If
  // that tab has moved on further, take its game instead and return false.
  function syncBeforeWrite() {
    if (!S.persist) return true;
    refresh();
    if (savedIsNewer()) { adopt(); return false; }
    return true;
  }
  // Take the saved game for this day, keeping the longer of the two clocks.
  function adopt() {
    var mine = elapsedNow(), focus = S.focus;
    startGame(S.day, true, mine);
    S.focus = Math.min(focus, S.grid.length - 1);
    render(false);
  }
  // Save the clock while it runs, now and then. Never in the middle of a drag: the grid is
  // half-way through a stroke then, and the stroke is saved when it ends.
  function saveProgress() {
    if (!S.persist || !S.moves || S.solved || drag) return;
    if (syncBeforeWrite()) snapshot();
  }

  // ---- changing the grid

  // Checks that a change may be made now; false if the picture is solved, a drag is under way,
  // or another tab had moved on (this tab then shows that game instead of making the change).
  function canChange() {
    return !S.solved && !drag && syncBeforeWrite();
  }
  function setSquare(i, state) {
    S.grid = S.grid.slice(0, i) + state + S.grid.slice(i + 1);
  }
  /*
   * Record a change made since `before`: one undo step, the clock, saving and the solve.
   * `what` is 'hint' or 'drag' for changes that count even if the grid ends up as it was.
   */
  function commit(before, what) {
    if (before === S.grid && !what) return;
    if (before !== S.grid) S.undo.push(before);
    S.moves++;
    wrongShown = {};
    said = '';
    startClock();
    if (P.isSolved(S.pic, S.grid)) {
      // The finishing time is recorded once, and is the time everywhere from now on.
      catchUpClock();
      S.solved = true;
      stopClock();
      if (S.persist) {
        store.stats = P.recordResult(store.stats, S.day, S.pic.n, S.elapsed, S.checks, S.hints);
        if (store.album.indexOf(S.pic.id) < 0) store.album = store.album.concat(S.pic.id);
      }
    }
    snapshot();
    render(S.solved);
    renderTools();
    renderTimer();
    if (S.solved) {
      announce('Solved in ' + spokenTime(S.elapsed) + '. The picture is ' + S.pic.name.toLowerCase() + '.');
      renderResults(true);
    }
  }

  // What a tap with mark `m` does to square i: puts the mark there, or takes it away again.
  function tapResult(i, m) { return S.grid[i] === m ? EMPTY : m; }
  function tapSquare(i, m) {
    if (!canChange()) return false;
    var before = S.grid;
    setSquare(i, tapResult(i, m));
    commit(before);
    describeChange(i);
    return true;
  }
  function clearSquare(i) {
    if (S.grid[i] === EMPTY || !canChange()) return;
    var before = S.grid;
    setSquare(i, EMPTY);
    commit(before);
    describeChange(i);
  }
  function undo() {
    if (!S.undo.length || !canChange()) return;
    S.grid = S.undo.pop();
    S.moves++;
    wrongShown = {};
    said = '';
    snapshot();
    render(false);
    renderTools();
    announce('Undone.');
  }
  function clearAll() {
    if (S.grid === P.emptyGrid(S.pic.n) || !canChange()) return;
    var before = S.grid;
    S.grid = P.emptyGrid(S.pic.n);
    commit(before);
    announce('Grid cleared. Undo brings it back.');
  }
  // Marks every filled square that the picture leaves empty, for a moment. Counted.
  function check() {
    if (S.solved || !P.filledCount(S.grid) || !canChange()) return;
    var wrong = P.wrongSquares(S.pic, S.grid);
    S.checks++;
    S.moves++;
    startClock();
    wrongShown = {};
    wrong.forEach(function (i) { wrongShown[i] = true; });
    clearTimeout(wrongTimer);
    wrongTimer = setTimeout(function () { wrongShown = {}; render(false); }, CHECK_SHOW);
    said = wrong.length ? (wrong.length === 1 ? '1 filled square is wrong. It’s marked for a moment.' : wrong.length + ' filled squares are wrong. They’re marked for a moment.')
      : 'No mistakes so far.';
    snapshot();
    render(false);
    renderTools();
    announce(said);
  }
  // Fills in one whole row or column as the picture has it. Counted.
  function hint() {
    if (!canChange()) return;
    var line = P.hintLine(S.pic, S.grid);
    if (!line) return;
    var before = S.grid;
    S.grid = P.fillLine(S.pic, S.grid, line.kind, line.index);
    S.hints++;
    hinted = line;
    commit(before, 'hint');
    if (!S.solved) announce('Hint: ' + (line.kind === 'row' ? 'row ' : 'column ') + (line.index + 1) + ' filled in.');
  }

  // ---- drawing the grid

  // The parts of the main grid: { cells, rows (row clue elements), cols (column clue elements) }.
  var board = null;

  function squareName(i, n) {
    return 'row ' + (Math.floor(i / n) + 1) + ', column ' + (i % n + 1);
  }
  function clueText(clue) { return clue.length ? clue.join(', ') : '0, empty'; }

  /*
   * Builds a grid with its clues inside `box`: a corner, then a clue above each column, then
   * for each row its clue and squares. Squares get the outer frame and the heavier line every
   * 5 squares (every 4 on an 8 by 8 grid). Returns { cells, rows, cols }.
   */
  function buildBoard(box, p) {
    var n = p.n, group = n === 10 ? 5 : n === 8 ? 4 : 0, parts = { cells: [], rows: [], cols: [] };
    box.textContent = '';
    box.className = box.className.replace(/\s*\bn\d+\b|\s*\bdone\b|\s*\banimate\b/g, '') + ' n' + n;
    box.style.setProperty('--n', n);
    var head = el('div', { class: 'row', role: 'row' }, [el('div', { class: 'corner', 'aria-hidden': 'true' })]);
    p.clues.cols.forEach(function (clue, c) {
      var h = el('div', { class: 'clue col-clue', role: 'columnheader', 'data-col': String(c) }, (clue.length ? clue : [0]).map(function (x) { return el('span', { text: String(x) }); }));
      parts.cols.push(h);
      head.appendChild(h);
    });
    box.appendChild(head);
    for (var r = 0; r < n; r++) {
      var clue = p.clues.rows[r];
      var rh = el('div', { class: 'clue row-clue', role: 'rowheader', 'data-row': String(r) }, (clue.length ? clue : [0]).map(function (x) { return el('span', { text: String(x) }); }));
      parts.rows.push(rh);
      var row = el('div', { class: 'row', role: 'row' }, [rh]);
      for (var c = 0; c < n; c++) {
        var i = r * n + c;
        var edges = (r === 0 ? ' et' : '') + (c === n - 1 ? ' er' : '') + (r === n - 1 ? ' eb' : '') + (c === 0 ? ' el' : '') +
          (group && c < n - 1 && (c + 1) % group === 0 ? ' sr' : '') + (group && r < n - 1 && (r + 1) % group === 0 ? ' sb' : '');
        var cell = el('div', { class: 'cell' + edges, role: 'gridcell', tabindex: '-1', 'data-i': String(i) });
        cell.setAttribute('data-base', cell.className);
        cell.style.setProperty('--k', String(r + c));
        cell.style.setProperty('--c', P.colourAt(p, i) || p.bg);
        row.appendChild(cell);
        parts.cells.push(cell);
      }
      box.appendChild(row);
    }
    return parts;
  }

  // The line of the square that has the keyboard focus or the mouse, for highlighting clues.
  var lit = -1;

  // Brings every square and clue up to date. `justSolved` plays the colouring-in.
  function render(justSolved) {
    var p = S.pic, n = p.n, box = $('board');
    var hintCells = {};
    if (hinted) P.lineCells(n, hinted.kind, hinted.index).forEach(function (i) { hintCells[i] = true; });
    board.cells.forEach(function (cell, i) {
      var state = S.grid[i], cls = cell.getAttribute('data-base');
      if (state === FILL) cls += ' f';
      else if (state === CROSS) cls += ' x';
      if (wrongShown[i] && state === FILL) cls += ' wrong';
      if (hintCells[i] && !reduced()) cls += ' hinted';
      cell.className = cls;
      cell.tabIndex = i === S.focus ? 0 : -1;
      var what = S.solved ? (p.cells[i] === EMPTY ? 'empty' : 'part of the picture')
        : state === FILL ? (wrongShown[i] ? 'filled, wrong' : 'filled') : state === CROSS ? 'crossed' : 'empty';
      cell.setAttribute('aria-label', squareName(i, n).replace(/^r/, 'R') + ', ' + what);
      if (S.solved) cell.setAttribute('aria-disabled', 'true'); else cell.removeAttribute('aria-disabled');
    });
    hinted = null;
    var litRow = lit >= 0 ? Math.floor(lit / n) : -1, litCol = lit >= 0 ? lit % n : -1;
    board.rows.forEach(function (h, r) {
      var done = P.lineMatches(S.grid, n, 'row', r, p.clues.rows[r]);
      h.className = 'clue row-clue' + (done ? ' done' : '') + (r === litRow && !S.solved ? ' cur' : '');
      h.setAttribute('aria-label', 'Row ' + (r + 1) + ' clue: ' + clueText(p.clues.rows[r]) + (done ? ', matches' : ''));
    });
    board.cols.forEach(function (h, c) {
      var done = P.lineMatches(S.grid, n, 'col', c, p.clues.cols[c]);
      h.className = 'clue col-clue' + (done ? ' done' : '') + (c === litCol && !S.solved ? ' cur' : '');
      h.setAttribute('aria-label', 'Column ' + (c + 1) + ' clue: ' + clueText(p.clues.cols[c]) + (done ? ', matches' : ''));
    });
    var animate = justSolved && !reduced();
    box.classList.toggle('done', S.solved);
    box.classList.toggle('animate', animate);
    var reveal = $('reveal');
    reveal.hidden = !S.solved;
    reveal.textContent = S.solved ? p.name : '';
    reveal.className = 'reveal' + (animate ? ' animate' : '');
    reveal.style.setProperty('--after', ((2 * n - 2) * 40 + 250) + 'ms');
    $('controls').hidden = S.solved;
    renderStatus();
  }

  // The line under the grid: how clues work before the first move, then what Check found.
  function renderStatus() {
    var status = $('status');
    status.className = 'status' + (said ? ' say' : '');
    if (S.solved) status.textContent = '';
    else if (said) status.textContent = said;
    else if (!S.moves || S.grid === P.emptyGrid(S.pic.n)) status.textContent = 'Each number is a run of filled squares, in order.';
    else status.textContent = '';
  }
  // Tells screen readers what a change did to a square, and whether its lines now match.
  function describeChange(i) {
    if (S.solved) return;
    var n = S.pic.n, r = Math.floor(i / n), c = i % n, state = S.grid[i];
    var msg = (state === FILL ? 'Filled' : state === CROSS ? 'Crossed' : 'Cleared') + ', ' + squareName(i, n) + '.';
    if (state === FILL && P.lineMatches(S.grid, n, 'row', r, S.pic.clues.rows[r])) msg += ' Row ' + (r + 1) + ' matches.';
    if (state === FILL && P.lineMatches(S.grid, n, 'col', c, S.pic.clues.cols[c])) msg += ' Column ' + (c + 1) + ' matches.';
    announce(msg);
  }

  function renderTools() {
    var empty = S.grid === P.emptyGrid(S.pic.n);
    $('undo-btn').disabled = !S.undo.length;
    $('clear-btn').disabled = empty;
    $('check-btn').disabled = !P.filledCount(S.grid);
    $('check-btn').querySelector('.lb').textContent = S.checks ? 'Check (' + S.checks + ')' : 'Check';
    $('hint-btn').querySelector('.lb').textContent = S.hints ? 'Hint (' + S.hints + ')' : 'Hint';
    // A button that has just switched itself off would drop the keyboard focus: send it back to the grid.
    var active = document.activeElement;
    if (!S.solved && active && active.disabled && active.closest('#tools')) board.cells[S.focus].focus({ preventScroll: true });
  }
  function renderTimer() { $('timer').textContent = P.formatTime(elapsedNow()); }
  function spokenTime(ms) {
    var s = Math.floor(ms / 1000), m = Math.floor(s / 60);
    return (m ? plural(m, 'minute', 'minutes') + ' ' : '') + plural(s % 60, 'second', 'seconds');
  }
  function setMode(m) {
    mode = m;
    $('mode-fill').setAttribute('aria-pressed', String(m === FILL));
    $('mode-cross').setAttribute('aria-pressed', String(m === CROSS));
  }

  // ---- pointer: a tap marks a square, a drag marks a straight line of them

  function cellAt(x, y) {
    var t = document.elementFromPoint(x, y), cell = t && t.closest ? t.closest('.cell') : null;
    return cell && $('board').contains(cell) ? Number(cell.getAttribute('data-i')) : -1;
  }
  function onPointerDown(e) {
    if (e.pointerType === 'mouse' && e.button !== 0 && e.button !== 2) return;
    var i = cellAt(e.clientX, e.clientY);
    if (i < 0) return;
    e.preventDefault();
    if (drag) return;
    // The right mouse button always crosses.
    var m = e.button === 2 ? CROSS : mode, before = S.grid;
    S.focus = i;
    // The tap acts at once; if the pointer then moves along a row or column, it becomes a drag.
    if (!tapSquare(i, m) || S.solved) return;
    // `tapped` is the grid as the first tap saved it, which is what storage should still hold
    // when the drag ends.
    drag = { id: e.pointerId, start: i, before: before, tapped: S.grid, from: before[i], to: S.grid[i], axis: null, last: i, moved: false };
    try { $('board').setPointerCapture(e.pointerId); } catch (err) { /* moves are still followed */ }
  }
  /*
   * A drag does to every square from where it started to where the pointer is, along the
   * first direction it moved in, what the first tap did: marking only squares that were
   * empty, or clearing only squares that held the same mark as the first one.
   */
  function onPointerMove(e) {
    if (!drag || e.pointerId !== drag.id || S.solved) return;
    var j = cellAt(e.clientX, e.clientY);
    if (j < 0 || j === drag.last) return;
    drag.last = j;
    var n = S.pic.n, r0 = Math.floor(drag.start / n), c0 = drag.start % n, r1 = Math.floor(j / n), c1 = j % n;
    if (!drag.axis) {
      drag.axis = Math.abs(c1 - c0) >= Math.abs(r1 - r0) ? 'row' : 'col';
      // The first tap's undo step is replaced by one for the whole drag.
      drag.moved = true;
      S.undo.pop();
    }
    var g = drag.before.split(''), lo, hi, k;
    if (drag.axis === 'row') { lo = Math.min(c0, c1); hi = Math.max(c0, c1); } else { lo = Math.min(r0, r1); hi = Math.max(r0, r1); }
    for (var t = lo; t <= hi; t++) {
      k = drag.axis === 'row' ? r0 * n + t : t * n + c0;
      if (k === drag.start || (drag.to === EMPTY ? g[k] === drag.from : g[k] === EMPTY)) g[k] = drag.to;
    }
    S.grid = g.join('');
    render(false);
  }
  function onPointerUp(e) {
    if (!drag || e.pointerId !== drag.id) return;
    var d = drag;
    drag = null;
    if (!d.moved || S.solved) return;
    // If another tab has saved more progress since the first tap, take it rather than
    // overwriting it with this stroke. The check compares the grid the first tap saved.
    var stroke = S.grid;
    S.grid = d.tapped;
    if (!syncBeforeWrite()) return;
    S.grid = stroke;
    // The whole drag is one step: undo takes it back to before the first square was touched.
    commit(d.before, 'drag');
    if (S.solved) return;
    var changed = 0;
    for (var i = 0; i < S.grid.length; i++) if (S.grid[i] !== d.before[i]) changed++;
    announce((d.to === FILL ? 'Filled ' : d.to === CROSS ? 'Crossed ' : 'Cleared ') + plural(changed, 'square', 'squares') + '.');
  }
  function onPointerOver(e) {
    if (e.pointerType !== 'mouse' || drag) return;
    var cell = e.target.closest && e.target.closest('.cell');
    var i = cell ? Number(cell.getAttribute('data-i')) : -1;
    if (i !== lit) { lit = i; render(false); }
  }

  // ---- keyboard

  function focusSquare(i) {
    S.focus = i;
    board.cells.forEach(function (c, k) { c.tabIndex = k === i ? 0 : -1; });
    board.cells[i].focus({ preventScroll: false });
  }
  function onKeyDown(e) {
    var cell = e.target.closest && e.target.closest('.cell');
    if (!cell || e.altKey || e.ctrlKey || e.metaKey) return;
    var i = Number(cell.getAttribute('data-i')), n = S.pic.n, r = Math.floor(i / n), c = i % n;
    var to = { ArrowUp: [r - 1, c], ArrowDown: [r + 1, c], ArrowLeft: [r, c - 1], ArrowRight: [r, c + 1], Home: [r, 0], End: [r, n - 1] }[e.key];
    if (to) {
      e.preventDefault();
      if (to[0] >= 0 && to[0] < n && to[1] >= 0 && to[1] < n) focusSquare(to[0] * n + to[1]);
      return;
    }
    var key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
    if (key === ' ' || key === 'x' || key === 'Enter') {
      e.preventDefault();
      if (e.repeat) return;
      S.focus = i;
      tapSquare(i, key === ' ' ? FILL : key === 'x' ? CROSS : mode);
    } else if (key === 'Delete' || key === 'Backspace') {
      e.preventDefault();
      S.focus = i;
      clearSquare(i);
    } else {
      return;
    }
    // If another tab's game was taken instead, the squares were rebuilt: keep the focus.
    if (!S.solved && document.activeElement !== board.cells[S.focus]) board.cells[S.focus].focus({ preventScroll: true });
  }

  // ---- the result card

  function helpText() {
    if (!S.checks && !S.hints) return 'no checks or hints';
    return [S.checks && plural(S.checks, 'check', 'checks'), S.hints && plural(S.hints, 'hint', 'hints')].filter(Boolean).join(', ');
  }
  function renderResults(justSolved) {
    var box = $('results'), n = S.pic.n;
    box.hidden = false;
    box.textContent = '';
    if (S.warmup) {
      var next = P.dailyPicture(today(), BANK).n;
      box.appendChild(el('div', { class: 'score-head' }, [
        el('div', { class: 'score', 'aria-label': 'Solved in ' + spokenTime(S.elapsed) }, [P.formatTime(S.elapsed)]),
        el('div', {}, [
          el('h2', { class: 'score-title', text: 'Warmed up!' }),
          el('p', { class: 'score-sub', text: 'That one didn’t count. Today’s picture is ' + next + ' by ' + next + '.' }),
        ]),
      ]));
      box.appendChild(el('div', { class: 'actions' }, [el('button', { class: 'primary', type: 'button', text: 'Play today’s picture', onclick: endWarmup })]));
      if (justSolved) box.querySelector('.primary').focus({ preventScroll: true });
      return;
    }
    box.appendChild(el('div', { class: 'score-head' }, [
      el('div', { class: 'score', 'aria-label': 'Solved in ' + spokenTime(S.elapsed) }, [P.formatTime(S.elapsed)]),
      el('div', {}, [
        el('h2', { class: 'score-title', text: !S.checks && !S.hints ? 'Unearthed!' : 'Uncovered' }),
        el('p', { class: 'score-sub', text: n + ' by ' + n + ' · ' + helpText() }),
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
    var text = P.shareText(S.pic, S.elapsed, S.checks, S.hints, SITE_URL);
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
    if (S.warmup) return;
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
      box.textContent = 'A new picture is ready. ';
      box.appendChild(el('button', { class: 'chip-btn', type: 'button', text: 'Play', onclick: function () { startGame(today(), true); focusSquare(0); } }));
      return;
    }
    var s = Math.floor(P.msUntilTomorrow() / 1000);
    box.textContent = 'Next picture in ';
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
      num(st.played ? Math.round(100 * st.clean / st.played) + '%' : '–', 'No help'),
    ]));
    body.appendChild(el('h3', { text: 'Times by size' }));
    var todayN = S.persist && S.solved && st.lastDay === S.day ? S.pic.n : 0;
    body.appendChild(el('table', { class: 'times' }, [
      el('thead', {}, [el('tr', {}, [el('th', { scope: 'col', text: 'Size' }), el('th', { scope: 'col', text: 'Solved' }), el('th', { scope: 'col', text: 'Best' }), el('th', { scope: 'col', text: 'Average' })])]),
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
    body.appendChild(el('p', { class: 'fine', text: '“No help” is the share of pictures solved without a check or a hint. Best times count only those.' }));
    body.appendChild(el('h3', { text: 'Your album' }));
    var album = store.album, total = BANK.pictures.length;
    body.appendChild(el('p', { class: 'album-count' }, [el('b', { text: album.length + ' of ' + total }), ' pictures uncovered']));
    var list = el('ul', { class: 'album', 'aria-label': 'Pictures you have uncovered' });
    album.forEach(function (id) { list.appendChild(el('li', {}, [thumbnail(BY_ID[id])])); });
    for (var k = 0; k < Math.min(ALBUM_BLANKS, total - album.length); k++) list.appendChild(el('li', { class: 'blank', 'aria-hidden': 'true' }));
    body.appendChild(list);
    if (PREVIEW) body.appendChild(el('p', { class: 'fine', text: 'This is a preview, so pictures solved here are not counted.' }));
    openDialog('stats');
  }
  function num(value, label) {
    return el('div', {}, [el('b', { text: String(value) }), el('span', { text: label })]);
  }
  // A small picture in its colours, for the album: one square of the SVG a square of the grid.
  function thumbnail(p) {
    var NS = 'http://www.w3.org/2000/svg', svg = document.createElementNS(NS, 'svg');
    var rect = function (x, y, size, colour) {
      var r = document.createElementNS(NS, 'rect');
      r.setAttribute('x', x); r.setAttribute('y', y); r.setAttribute('width', size); r.setAttribute('height', size); r.setAttribute('fill', colour);
      svg.appendChild(r);
    };
    svg.setAttribute('viewBox', '0 0 ' + p.n + ' ' + p.n);
    svg.setAttribute('role', 'img');
    svg.setAttribute('aria-label', p.name);
    svg.setAttribute('shape-rendering', 'crispEdges');
    var title = document.createElementNS(NS, 'title');
    title.textContent = p.name;
    svg.appendChild(title);
    rect(0, 0, p.n, p.bg);
    for (var i = 0; i < p.cells.length; i++) if (p.cells[i] !== EMPTY) rect(i % p.n, Math.floor(i / p.n), 1, P.colourAt(p, i));
    return svg;
  }

  // ---- the guided example

  /*
   * { step, grid, parts, finished, focus, say, firstRun, next }, while the example is open.
   * `say` is a nudge shown in place of the step's text after a wrong tap. `firstRun` is set
   * when it opened by itself on a first visit, and `next` is 'warmup' once the player has
   * chosen to go on to the warm-up.
   */
  var EX = null;
  var X = P.EXAMPLE;

  function openExample(firstRun) {
    closeDialog($('help'));
    EX = { step: 0, grid: P.emptyGrid(X.n), parts: buildBoard($('ex-board'), X), finished: false, focus: 0, say: '', firstRun: firstRun === true, next: '' };
    EX.parts.cells.forEach(function (cell, i) {
      cell.addEventListener('click', function () { exTap(i); });
      cell.addEventListener('keydown', function (e) { exKey(e, i); });
    });
    $('ex-skip').textContent = EX.firstRun ? 'Skip to today’s picture' : 'Skip';
    $('ex-play').textContent = EX.firstRun ? 'Try a warm-up picture' : 'Back to the game';
    $('ex-skip').hidden = false;
    $('ex-play').hidden = true;
    EX.focus = exTargets()[0];
    renderExample();
    openDialog('example');
    EX.parts.cells[EX.focus].focus({ preventScroll: true });
  }
  function exStep() { return EX.finished ? null : X.steps[EX.step]; }
  function exMark(st) { return st.mark === CROSS ? CROSS : FILL; }
  // The squares the current step asks for that are not marked yet.
  function exTargets() {
    var st = exStep();
    return st ? st.cells.filter(function (i) { return EX.grid[i] !== exMark(st); }) : [];
  }
  // Arrow keys move between the squares; Space or Enter taps.
  function exKey(e, i) {
    var n = X.n, r = Math.floor(i / n), c = i % n;
    var to = { ArrowUp: [r - 1, c], ArrowDown: [r + 1, c], ArrowLeft: [r, c - 1], ArrowRight: [r, c + 1] }[e.key];
    if (to) {
      e.preventDefault();
      if (to[0] < 0 || to[0] >= n || to[1] < 0 || to[1] >= n) return;
      EX.focus = to[0] * n + to[1];
      renderExample();
      EX.parts.cells[EX.focus].focus({ preventScroll: true });
    } else if (e.key === ' ' || e.key === 'Enter') {
      e.preventDefault();
      if (!e.repeat) exTap(i);
    }
  }
  /*
   * A tap on a square the step asks for marks it; the step is done when all its squares are.
   * Any other tap marks nothing and says what to look for instead.
   */
  function exTap(i) {
    if (!EX || EX.finished) return;
    var st = exStep(), targets = exTargets();
    EX.focus = i;
    if (targets.indexOf(i) < 0) {
      EX.say = st.find ? st.nudge : st.text + (targets.length === 1 ? ' Tap the outlined square.' : ' Tap the outlined squares.');
      renderExample();
      return;
    }
    EX.grid = EX.grid.slice(0, i) + exMark(st) + EX.grid.slice(i + 1);
    EX.say = '';
    if (targets.length === 1) {
      EX.step++;
      if (EX.step === X.steps.length) EX.finished = true;
    }
    var next = exTargets()[0];
    if (next !== undefined && !exStep().find) EX.focus = next;
    renderExample();
    if (EX.finished) $('ex-play').focus({ preventScroll: true });
    else EX.parts.cells[EX.focus].focus({ preventScroll: true });
  }
  function renderExample() {
    var st = exStep(), targets = st && !st.find ? exTargets() : [], line = {};
    if (st && !st.find) P.lineCells(X.n, st.kind, st.index).forEach(function (i) { line[i] = true; });
    EX.parts.cells.forEach(function (cell, i) {
      var state = EX.grid[i], target = targets.indexOf(i) >= 0;
      cell.className = cell.getAttribute('data-base') + (state === FILL ? ' f' : state === CROSS ? ' x' : '') + (line[i] ? ' lit' : '') + (target ? ' target' : '');
      cell.tabIndex = i === EX.focus ? 0 : -1;
      cell.setAttribute('aria-label', squareName(i, X.n).replace(/^r/, 'R') + ', ' + (state === FILL ? 'filled' : state === CROSS ? 'crossed' : 'empty') +
        (target ? (exMark(st) === CROSS ? ', cross this one' : ', fill this one') : ''));
    });
    EX.parts.rows.forEach(function (h, r) {
      var done = P.lineMatches(EX.grid, X.n, 'row', r, X.clues.rows[r]);
      h.className = 'clue row-clue' + (st && !st.find && st.kind === 'row' && st.index === r ? ' cur' : '') + (done ? ' done' : '');
      h.setAttribute('aria-label', 'Row ' + (r + 1) + ' clue: ' + clueText(X.clues.rows[r]) + (done ? ', matches' : ''));
    });
    EX.parts.cols.forEach(function (h, c) {
      var done = P.lineMatches(EX.grid, X.n, 'col', c, X.clues.cols[c]);
      h.className = 'clue col-clue' + (st && !st.find && st.kind === 'col' && st.index === c ? ' cur' : '') + (done ? ' done' : '');
      h.setAttribute('aria-label', 'Column ' + (c + 1) + ' clue: ' + clueText(X.clues.cols[c]) + (done ? ', matches' : ''));
    });
    var box = $('ex-board');
    box.classList.toggle('done', EX.finished);
    box.classList.toggle('animate', EX.finished && !reduced());
    if (EX.finished) {
      $('ex-step').textContent = 'Done';
      $('ex-text').textContent = 'It’s a snail! Every picture works like this: read a clue, fill the squares it settles, and cross out the ones it rules out.';
      // On a first visit the player can still go straight to today's picture.
      $('ex-skip').hidden = !EX.firstRun;
      $('ex-play').hidden = false;
    } else {
      $('ex-step').textContent = 'Step ' + (EX.step + 1) + ' of ' + X.steps.length;
      $('ex-text').textContent = EX.say || st.text;
    }
  }
  /*
   * The example has been seen (finished, skipped or closed with Escape): it does not open by
   * itself again. On a first visit, the warm-up comes next if the player chose it; otherwise
   * the warm-up counts as skipped too, and the focus goes back to today's grid.
   */
  function exampleClosed() {
    if (!EX) return;
    var first = EX.firstRun, warm = first && EX.next === 'warmup';
    EX = null;
    if (!PREVIEW) {
      refresh();
      var skipWarmup = first && !warm && !store.warmed;
      if (!store.seen || skipWarmup) {
        store.seen = true;
        if (skipWarmup) store.warmed = true;
        save();
      }
    }
    if (warm) startWarmup();
    else if (!S.solved) board.cells[S.focus].focus({ preventScroll: true });
  }

  // ---- the warm-up: an easy picture between the example and a first visit's daily picture

  function startWarmup() {
    startGame(today(), false, 0, true);
    focusSquare(0);
  }
  // Done or skipped: it does not come back, and today's picture takes its place.
  function endWarmup() {
    if (!PREVIEW) {
      refresh();
      if (!store.warmed) { store.warmed = true; save(); }
    }
    startGame(today(), !PREVIEW);
    if (S.solved) $('results').querySelector('.primary').focus({ preventScroll: true });
    else focusSquare(S.focus);
  }

  // ---- dialogs, toast, live region, settings

  function openDialog(id) {
    var d = $(id);
    try { if (!d.open) d.showModal(); } catch (e) { d.setAttribute('open', ''); }
  }
  function closeDialog(d) {
    if (!d.open) return;
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

  var grid = $('board');
  grid.addEventListener('pointerdown', onPointerDown);
  window.addEventListener('pointermove', onPointerMove);
  window.addEventListener('pointerup', onPointerUp);
  window.addEventListener('pointercancel', onPointerUp);
  grid.addEventListener('pointerover', onPointerOver);
  grid.addEventListener('pointerleave', function () { if (lit >= 0) { lit = -1; render(false); } });
  grid.addEventListener('contextmenu', function (e) { e.preventDefault(); });
  // The page must not scroll under a finger that is marking squares.
  grid.addEventListener('touchmove', function (e) { e.preventDefault(); }, { passive: false });
  grid.addEventListener('keydown', onKeyDown);
  // A screen reader's own "activate" sends a click with no pointer behind it.
  grid.addEventListener('click', function (e) {
    var cell = e.target.closest && e.target.closest('.cell');
    if (cell && e.detail === 0) { S.focus = Number(cell.getAttribute('data-i')); tapSquare(S.focus, mode); }
  });
  grid.addEventListener('focusin', function (e) {
    var cell = e.target.closest && e.target.closest('.cell');
    if (!cell) return;
    S.focus = Number(cell.getAttribute('data-i'));
    if (lit !== S.focus) { lit = S.focus; render(false); cell.focus({ preventScroll: true }); }
  });
  $('mode-fill').addEventListener('click', function () { setMode(FILL); });
  $('mode-cross').addEventListener('click', function () { setMode(CROSS); });
  $('undo-btn').addEventListener('click', undo);
  $('clear-btn').addEventListener('click', clearAll);
  $('check-btn').addEventListener('click', check);
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
  $('example-btn').addEventListener('click', function () { openExample(false); });
  $('ex-skip').addEventListener('click', function () { closeDialog($('example')); exampleClosed(); });
  $('ex-play').addEventListener('click', function () {
    if (EX && EX.firstRun) EX.next = 'warmup';
    closeDialog($('example'));
    exampleClosed();
  });
  $('warmup-skip').addEventListener('click', endWarmup);
  $('example').addEventListener('close', exampleClosed);
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
      else { catchUpClock(); renderTimer(); }
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
  // The very first visit starts with the guided example, then the warm-up; a reload part-way
  // through goes back to whichever of the two was not finished.
  if (!PREVIEW && !store.seen) openExample(true);
  else if (!PREVIEW && !store.warmed) startWarmup();
})();
