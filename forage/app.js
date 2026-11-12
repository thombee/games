/*
 * Forage page. Draws the day's grid, lets the player pick out words by dragging, tapping or
 * with the keyboard, runs the clock, and shows the result card. Keeps the player's progress
 * in localStorage. The rules (the day's puzzle, selection geometry, share text, stats) are in
 * logic.js; the grids are in grids.js.
 */
(function () {
  'use strict';

  var F = window.Forage;
  var DATA = window.FORAGE_DATA;
  var N = F.SIZE;

  // The address added to shared results. Empty until the game has a home.
  var SITE_URL = 'https://thombee.github.io/games/forage/';
  var STORE_KEY = 'forage:v1';
  // While the clock runs, progress is saved this often (and at every find, hint and pause).
  var SAVE_EVERY_MS = 5000;
  var START_LINE = 'Drag across the letters to pick out a word.';

  var root = document.documentElement;
  var forcedDay = parseInt(new URLSearchParams(location.search).get('day'), 10);
  // Preview mode plays any day and saves nothing. It is on for ?day=N and for preview builds.
  var PREVIEW = root.hasAttribute('data-preview') || forcedDay > 0;
  var TOUCH = window.matchMedia('(pointer: coarse)').matches;
  var SVG_NS = 'http://www.w3.org/2000/svg';

  function $(id) { return document.getElementById(id); }
  // Asked each time something is about to move, so a change of setting applies at once.
  function reduced() { return window.matchMedia('(prefers-reduced-motion: reduce)').matches; }
  function now() { return performance.now(); }

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
    var n = document.createElementNS(SVG_NS, tag);
    Object.keys(attrs).forEach(function (k) { n.setAttribute(k, attrs[k]); });
    return n;
  }
  function plural(n, one, many) { return n + ' ' + (n === 1 ? one : many); }
  function same(a, b) { return !!a && !!b && a[0] === b[0] && a[1] === b[1]; }
  function place(cell) { return 'row ' + (cell[0] + 1) + ', column ' + (cell[1] + 1); }

  // ---- saved progress

  function emptyStore() { return { v: 1, stats: F.emptyStats(), game: null, contrast: false }; }
  // Whole numbers 0 to WORDS-1, each once, in the order given.
  function indexList(list) {
    if (!Array.isArray(list)) return [];
    var out = [];
    list.forEach(function (i) { if (Number.isInteger(i) && i >= 0 && i < F.WORDS && out.indexOf(i) < 0) out.push(i); });
    return out;
  }
  // A finished day's result as saved: { ms, hints }, or null if there is none or it is damaged.
  function readResult(r) {
    if (!r || !Number.isFinite(r.ms) || r.ms < 0 || !Number.isInteger(r.hints) || r.hints < 0 || r.hints > F.WORDS) return null;
    return { ms: Math.min(Math.round(r.ms), 864e5), hints: r.hints };
  }
  // The saved progress, or null if this browser will not let the page read localStorage.
  function readStore() {
    var raw;
    try { raw = localStorage.getItem(STORE_KEY); } catch (e) { return null; }
    var s = emptyStore();
    try {
      var d = JSON.parse(raw || 'null');
      if (!d || d.v !== 1) return s;
      var st = d.stats || {};
      Object.keys(s.stats).forEach(function (k) {
        if (Number.isFinite(st[k]) && st[k] >= 0) s.stats[k] = Math.floor(st[k]);
      });
      if (s.stats.clean > s.stats.played) s.stats.clean = s.stats.played;
      if (s.stats.streak > s.stats.best) s.stats.best = s.stats.streak;
      var g = d.game;
      if (g && Number.isInteger(g.day) && g.day > 0) {
        s.game = {
          day: g.day, found: indexList(g.found), hinted: indexList(g.hinted),
          elapsed: Number.isFinite(g.elapsed) && g.elapsed > 0 ? Math.min(g.elapsed, 864e5) : 0,
          result: readResult(g.result),
        };
      }
      s.contrast = d.contrast === true;
    } catch (e) { /* corrupt: start clean */ }
    return s;
  }
  /*
   * Once a write has failed, this tab stops reading the store back: what it holds in memory
   * is the only up-to-date copy, and a read would replace it with what was saved before.
   */
  var writable = true;
  function save() {
    if (!writable) return;
    try { localStorage.setItem(STORE_KEY, JSON.stringify(store)); } catch (e) { writable = false; cannotSave(); }
  }
  // Read the store again, so what another tab saved since is not overwritten. Not after a failed write.
  function refresh() {
    if (!writable) return false;
    var fresh = readStore();
    if (fresh) store = fresh;
    return !!fresh;
  }
  // Shown once, under the game, when the browser will not keep the player's progress.
  function cannotSave() {
    var note = $('storage-note');
    if (PREVIEW || !note.hidden) return;
    note.hidden = false;
    $('live').textContent = note.textContent;
  }
  var store = readStore();
  if (!store) { store = emptyStore(); writable = false; cannotSave(); }

  // ---- the current day's game

  /*
   * day, persist (false in preview), puzzle, found (word indices in the order found),
   * hinted (word indices that have had a hint), elapsed (ms on the clock while it was last
   * stopped), since (performance.now() when the clock last started, or null while stopped),
   * started (the player has touched the grid), anchor (the first letter of a tap or keyboard
   * selection), drag (a drag in progress), lastSave, result ({ ms, hints } once the day is
   * finished: fixed at the first finish in any tab and shown the same everywhere after that).
   */
  var S = null;

  function today() { return Math.max(1, F.dayNumber()); }
  function finished() { return S.found.length >= F.WORDS; }
  function elapsed() { return S.elapsed + (S.since === null ? 0 : now() - S.since); }

  function startGame(day, persist) {
    var puzzle = F.puzzleFor(day, DATA);
    S = {
      day: day, persist: persist, puzzle: puzzle, found: [], hinted: [], elapsed: 0, since: null,
      started: false, anchor: null, drag: null, focus: [0, 0], lastSave: 0, shown: false, result: null,
    };
    if (persist && store.game && store.game.day === day) takeSaved(store.game);
    S.started = S.elapsed > 0 || S.found.length > 0 || S.hinted.length > 0;
    settle();
    $('day-tag').textContent = '#' + day;
    $('preview-bar').hidden = !PREVIEW;
    $('preview-day').textContent = 'Day ' + day;
    $('clue').textContent = puzzle.clue;
    renderGrid();
    renderAll();
    if (finished()) showResults(false);
    else {
      $('results').hidden = true;
      runClock();
    }
  }
  // Take a saved game for this day into this tab, keeping whatever this tab has that it lacks.
  // A saved result was fixed by whichever tab finished first, so it wins over this tab's own.
  function takeSaved(g) {
    g.found.forEach(function (i) { if (S.found.indexOf(i) < 0) S.found.push(i); });
    g.hinted.forEach(function (i) { if (S.hinted.indexOf(i) < 0) S.hinted.push(i); });
    if (g.result) S.result = g.result;
    if (!S.result && g.elapsed > elapsed()) {
      S.elapsed = g.elapsed;
      if (S.since !== null) S.since = now();
    }
  }
  // Once all six are found: fix the result if no tab has yet, stop the clock and show that time.
  function settle() {
    if (!finished()) return;
    if (!S.result) S.result = { ms: Math.round(elapsed()), hints: S.hinted.length };
    S.since = null;
    S.elapsed = S.result.ms;
  }

  /*
   * Save this tab's game. The store is read again first, so what another tab saved since is
   * merged in rather than overwritten, and a tab still showing an earlier day never replaces
   * a later day's game.
   */
  function snapshot() {
    if (!S.persist) return;
    refresh();
    var theirs = store.game;
    if (theirs && theirs.day === S.day) takeSaved(theirs);
    settle();
    // A finished day is counted here, once: recordResult ignores a day already recorded.
    if (S.result) store.stats = F.recordResult(store.stats, S.day, S.result.ms, S.result.hints);
    if (!theirs || theirs.day <= S.day) {
      store.game = { day: S.day, found: S.found.slice(), hinted: S.hinted.slice(), elapsed: Math.round(elapsed()), result: S.result };
    }
    S.lastSave = now();
    save();
  }

  // ---- the clock

  // The clock runs from the first touch until the last word, and only while the page is on screen.
  function runClock() {
    if (S.started && !finished() && !document.hidden && S.since === null) S.since = now();
  }
  function stopClock() {
    if (S.since === null) return;
    S.elapsed = elapsed();
    S.since = null;
  }
  function begin() {
    if (S.started) return;
    S.started = true;
    $('picked').textContent = '';
    runClock();
  }
  function renderTimer() {
    var ms = elapsed();
    $('timer').textContent = F.formatTime(ms);
    $('timer').setAttribute('aria-label', 'Time taken: ' + F.spokenTime(ms));
  }

  // ---- drawing

  function cellEl(cell) { return $('grid').children[cell[0]].children[cell[1]]; }

  function renderGrid() {
    var grid = $('grid'), rows = S.puzzle.rows;
    grid.textContent = '';
    for (var r = 0; r < N; r++) {
      var row = el('div', { class: 'row', role: 'row' });
      for (var c = 0; c < N; c++) {
        row.appendChild(el('div', {
          class: 'cell', role: 'gridcell', tabindex: r === 0 && c === 0 ? '0' : '-1', 'data-r': String(r), 'data-c': String(c),
        }, [el('span', { 'aria-hidden': 'true', text: rows[r].charAt(c) })]));
      }
      grid.appendChild(row);
    }
    S.focus = [0, 0];
  }

  // Which word, if any, covers each square: index -> list of word indices.
  function coverage() {
    var out = {};
    S.found.forEach(function (i) {
      F.wordCells(S.puzzle.words[i]).forEach(function (c) { (out[c[0] * N + c[1]] = out[c[0] * N + c[1]] || []).push(i); });
    });
    return out;
  }

  function renderCells() {
    var cov = coverage(), rows = S.puzzle.rows;
    var firsts = {};
    S.hinted.forEach(function (i) { if (S.found.indexOf(i) < 0) { var s = S.puzzle.words[i].start; firsts[s[0] * N + s[1]] = true; } });
    for (var r = 0; r < N; r++) {
      for (var c = 0; c < N; c++) {
        var cell = cellEl([r, c]), k = r * N + c, words = cov[k] || [];
        var label = rows[r].charAt(c) + ', ' + place([r, c]);
        if (words.length) label += ', in ' + words.map(function (i) { return S.puzzle.words[i].text; }).join(' and ');
        if (firsts[k]) label += ', hint: a word starts here';
        if (same(S.anchor, [r, c])) label += ', start of your selection';
        cell.setAttribute('aria-label', label);
        cell.classList.toggle('found', words.length > 0);
        cell.classList.toggle('hinted', !!firsts[k]);
        cell.classList.toggle('anchor', same(S.anchor, [r, c]));
      }
    }
  }

  // The coloured pills behind found words, and the line of the selection being made.
  function renderPills(fresh) {
    var layer = $('pills');
    Array.prototype.slice.call(layer.querySelectorAll('.pill, .pill-edge')).forEach(function (n) { n.remove(); });
    var sel = layer.querySelector('.sel');
    S.found.forEach(function (i) {
      var w = S.puzzle.words[i];
      var pos = { x1: w.start[1] + 0.5, y1: w.start[0] + 0.5, x2: w.end[1] + 0.5, y2: w.end[0] + 0.5 };
      var edge = svg('line', pos), pill = svg('line', pos);
      edge.setAttribute('class', 'pill-edge');
      pill.setAttribute('class', 'pill w' + (i + 1) + (fresh === i && !reduced() ? ' pop' : ''));
      layer.insertBefore(edge, sel);
      layer.insertBefore(pill, sel);
    });
  }

  // The selection in progress: from the start of a drag or the tapped first letter.
  function currentSelection() {
    if (S.drag && S.drag.moved) return F.lineCells(S.drag.start, S.drag.end);
    if (S.anchor) {
      var to = S.drag ? S.drag.start : S.focus;
      return (to && F.lineCells(S.anchor, to)) || [S.anchor];
    }
    if (S.drag) return [S.drag.start];
    return null;
  }
  function renderSelection() {
    var layer = $('pills'), cells = currentSelection(), line = layer.querySelector('.sel');
    if (!cells) {
      if (line) line.remove();
      return;
    }
    if (!line || line.classList.contains('miss')) {
      if (line) line.remove();
      line = svg('line', {});
      layer.appendChild(line);
    }
    var a = cells[0], b = cells[cells.length - 1];
    line.setAttribute('class', 'sel');
    line.setAttribute('x1', a[1] + 0.5);
    line.setAttribute('y1', a[0] + 0.5);
    line.setAttribute('x2', b[1] + 0.5);
    line.setAttribute('y2', b[0] + 0.5);
    var picked = $('picked');
    picked.className = 'picked';
    picked.textContent = F.textOf(S.puzzle.rows, cells);
  }
  // A selection that was not a word fades away.
  function missSelection(text) {
    var layer = $('pills'), line = layer.querySelector('.sel'), picked = $('picked');
    picked.textContent = text;
    if (reduced()) {
      if (line) line.remove();
      picked.className = 'picked';
      picked.textContent = '';
      return;
    }
    if (line) {
      line.setAttribute('class', 'sel miss');
      setTimeout(function () { if (line.classList.contains('miss')) line.remove(); }, 600);
    }
    picked.className = 'picked miss';
  }

  function renderSlots(fresh) {
    var list = $('slots');
    list.textContent = '';
    S.puzzle.words.forEach(function (w, i) {
      var got = S.found.indexOf(i) >= 0, hinted = S.hinted.indexOf(i) >= 0;
      var label = got ? w.text + ', found' : w.text.length + ' letters' + (hinted ? ', starting with ' + w.text.charAt(0) : '') + ', not found yet';
      var boxes = [];
      for (var k = 0; k < w.text.length; k++) {
        boxes.push(el('span', { class: 'box', text: got || (hinted && k === 0) ? w.text.charAt(k) : '' }));
      }
      list.appendChild(el('li', {
        class: 'slot' + (got ? ' got w' + (i + 1) : '') + (got && fresh === i && !reduced() ? ' pop' : ''), 'aria-label': label,
      }, [el('span', { class: 'swatch', 'aria-hidden': 'true' }), el('span', { class: 'boxes', 'aria-hidden': 'true' }, boxes)]));
    });
  }

  function renderHints() {
    var n = S.hinted.length;
    $('hint-count').textContent = n ? ' ×' + n : '';
    $('hint-btn').setAttribute('aria-label', 'Hint' + (n ? ', ' + plural(n, 'hint', 'hints') + ' used' : ''));
    $('hint-btn').disabled = finished();
  }

  function renderAll(fresh) {
    renderCells();
    renderPills(fresh);
    renderSelection();
    renderSlots(fresh);
    renderHints();
    renderTimer();
    if (!S.started && !currentSelection()) {
      $('picked').className = 'picked intro';
      $('picked').textContent = START_LINE;
    } else if (!currentSelection() && $('picked').classList.contains('intro')) {
      $('picked').className = 'picked';
      $('picked').textContent = '';
    }
  }

  // ---- choosing words

  // Check the letters from cell a to cell b against the day's words.
  function submit(a, b) {
    var cells = F.lineCells(a, b);
    S.anchor = null;
    if (!cells || cells.length < 2) { renderAll(); return; }
    var text = F.textOf(S.puzzle.rows, cells), i = F.wordAt(S.puzzle.words, a, b);
    if (i < 0) {
      renderCells();
      missSelection(text);
      $('live').textContent = text + ' is not one of the words.';
      return;
    }
    // Picked from either end, a word is shown the right way round.
    text = S.puzzle.words[i].text;
    if (S.found.indexOf(i) >= 0) {
      renderAll();
      $('picked').textContent = text + ': already found';
      $('live').textContent = 'You already found ' + text + '.';
      return;
    }
    if (S.persist) {
      // Bring in anything another tab found meanwhile, so the count below is right.
      if (refresh() && store.game && store.game.day === S.day) takeSaved(store.game);
    }
    if (S.found.indexOf(i) < 0) S.found.push(i);
    var done = finished();
    if (done) stopClock();
    settle();
    snapshot();
    renderAll(i);
    $('picked').className = 'picked got w' + (i + 1);
    $('picked').textContent = text + ' ✓';
    $('live').textContent = 'Found ' + text + '. ' + S.found.length + ' of ' + F.WORDS + '.';
    if (done) showResults(true);
  }

  // A tap on a square: the first tap marks the first letter, a second in line with it checks the word.
  function tap(cell) {
    if (same(S.anchor, cell)) {
      S.anchor = null;
      renderAll();
      $('picked').textContent = '';
      return;
    }
    if (S.anchor && F.lineCells(S.anchor, cell)) { submit(S.anchor, cell); return; }
    S.anchor = cell;
    renderAll();
  }

  function hint() {
    if (finished()) return;
    begin();
    var t = F.hintTarget(S.puzzle.words, S.found, S.hinted);
    if (!t) return;
    if (t.counts) {
      S.hinted.push(t.index);
      snapshot();
    }
    renderAll();
    var start = S.puzzle.words[t.index].start, cell = cellEl(start);
    if (!reduced()) {
      cell.classList.remove('pulse');
      void cell.offsetWidth; // restart the animation
      cell.classList.add('pulse');
    }
    $('live').textContent = 'Hint: a ' + S.puzzle.words[t.index].text.length + '-letter word starts with the ' +
      S.puzzle.words[t.index].text.charAt(0) + ' at ' + place(start) + '.';
  }

  // ---- pointer input: drag from the first letter to the last, or tap one then the other

  // The pointer's position in cell units: the middle of square [r, c] is at (r, c).
  function gridPos(e) {
    var rect = $('grid').getBoundingClientRect();
    return { row: (e.clientY - rect.top) / rect.height * N - 0.5, col: (e.clientX - rect.left) / rect.width * N - 0.5 };
  }
  function cellUnder(e) {
    var p = gridPos(e), r = Math.round(p.row), c = Math.round(p.col);
    return r >= 0 && r < N && c >= 0 && c < N ? [r, c] : null;
  }
  function setFocusCell(cell, move) {
    var old = cellEl(S.focus);
    if (old) old.setAttribute('tabindex', '-1');
    S.focus = cell;
    var n = cellEl(cell);
    n.setAttribute('tabindex', '0');
    if (move) n.focus({ preventScroll: true });
  }

  var board = $('board');
  board.addEventListener('pointerdown', function (e) {
    if ((e.pointerType === 'mouse' && e.button !== 0) || finished() || S.drag) return;
    var cell = cellUnder(e);
    if (!cell) return;
    e.preventDefault();
    begin();
    try { board.setPointerCapture(e.pointerId); } catch (err) { /* moves still arrive while over the grid */ }
    S.drag = { id: e.pointerId, start: cell, end: cell, moved: false };
    setFocusCell(cell, false);
    renderSelection();
  });
  board.addEventListener('pointermove', function (e) {
    if (!S.drag || e.pointerId !== S.drag.id) return;
    e.preventDefault();
    var p = gridPos(e), end = F.snapEnd(S.drag.start, p.row, p.col, N);
    if (same(end, S.drag.end)) return;
    S.drag.end = end;
    if (!same(end, S.drag.start)) {
      S.drag.moved = true;
      S.anchor = null;
    }
    renderSelection();
  });
  function endDrag(e, cancelled) {
    if (!S.drag || e.pointerId !== S.drag.id) return;
    lastPointerEnd = now();
    var d = S.drag;
    S.drag = null;
    if (cancelled) { renderAll(); return; }
    if (!d.moved) tap(d.start);
    else if (same(d.start, d.end)) { renderAll(); $('picked').textContent = ''; }
    else submit(d.start, d.end);
  }
  board.addEventListener('pointerup', function (e) { endDrag(e, false); });
  board.addEventListener('pointercancel', function (e) { endDrag(e, true); });
  // Older iOS scrolls the page on a drag unless told not to, whatever touch-action says.
  board.addEventListener('touchmove', function (e) { if (S.drag) e.preventDefault(); }, { passive: false });
  board.addEventListener('contextmenu', function (e) { e.preventDefault(); });

  // ---- keyboard: arrows move, Space or Enter marks the first letter and then the last

  $('grid').addEventListener('keydown', function (e) {
    var t = e.target.closest && e.target.closest('.cell');
    if (!t || e.altKey || e.ctrlKey || e.metaKey) return;
    var cell = [Number(t.getAttribute('data-r')), Number(t.getAttribute('data-c'))];
    var moves = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] };
    if (moves[e.key]) {
      e.preventDefault();
      var r = Math.min(N - 1, Math.max(0, cell[0] + moves[e.key][0])), c = Math.min(N - 1, Math.max(0, cell[1] + moves[e.key][1]));
      setFocusCell([r, c], true);
      if (S.anchor) renderSelection();
      return;
    }
    if (e.key === 'Home' || e.key === 'End') {
      e.preventDefault();
      setFocusCell([cell[0], e.key === 'Home' ? 0 : N - 1], true);
      if (S.anchor) renderSelection();
      return;
    }
    if (e.key === ' ' || e.key === 'Enter') {
      e.preventDefault();
      if (e.repeat) return;
      activate(cell, 'press Space');
      return;
    }
    if (e.key === 'Escape' && S.anchor) {
      e.preventDefault();
      S.anchor = null;
      renderAll();
      $('picked').textContent = '';
      $('live').textContent = 'Selection cleared.';
    }
  });
  /*
   * Mark a letter from the keyboard or a screen reader: the first letter, then the last.
   * A last letter that is not in line with the first is refused and said aloud, rather than
   * quietly starting again from there as a tap does.
   */
  function activate(cell, how) {
    if (finished()) return;
    begin();
    var had = S.anchor;
    if (had && !same(had, cell) && !F.lineCells(had, cell)) {
      $('live').textContent = 'That is not in a straight line from ' + S.puzzle.rows[had[0]].charAt(had[1]) + ' at ' + place(had) + '.';
      return;
    }
    setFocusCell(cell, false);
    tap(cell);
    if (S.anchor) $('live').textContent = 'First letter ' + S.puzzle.rows[cell[0]].charAt(cell[1]) + ' marked. Move to the last letter and ' + how + '.';
    else if (same(had, cell)) $('live').textContent = 'Selection cleared.';
  }

  /*
   * A click on a letter, as a screen reader sends when the player activates it, works like
   * Space. A real tap or click also fires pointer events, which have already handled it, and
   * its click follows within a moment, so a click that soon after a pointer ends is ignored.
   */
  var lastPointerEnd = -Infinity;
  $('grid').addEventListener('click', function (e) {
    var t = e.target.closest && e.target.closest('.cell');
    if (!t || now() - lastPointerEnd < 1000) return;
    activate([Number(t.getAttribute('data-r')), Number(t.getAttribute('data-c'))], 'activate it');
  });
  $('grid').addEventListener('animationend', function (e) {
    if (e.target.classList && e.target.classList.contains('pulse')) e.target.classList.remove('pulse');
  });
  $('grid').addEventListener('focusin', function (e) {
    var t = e.target.closest && e.target.closest('.cell');
    if (t) setFocusCell([Number(t.getAttribute('data-r')), Number(t.getAttribute('data-c'))], false);
  });

  // ---- the result card

  function showResults(justFinished) {
    settle();
    var box = $('results'), ms = S.result.ms, hints = S.result.hints;
    S.shown = true;
    box.hidden = false;
    box.textContent = '';
    box.appendChild(el('p', { class: 'r-label', text: 'Today’s theme' }));
    box.appendChild(el('h2', { class: 'r-theme', id: 'theme-name', text: S.puzzle.name }));
    // Why these animals belong, for the themes that say.
    if (S.puzzle.note) {
      box.appendChild(el('p', { class: 'r-note' }, [
        S.puzzle.note + ' ', el('a', { href: S.puzzle.source, target: '_blank', rel: 'noopener', text: 'Source' }),
      ]));
    }
    box.appendChild(el('p', { class: 'r-line' }, [
      'All six in ', el('b', { class: 'r-time', text: F.formatTime(ms) }), hints ? ' with ' + plural(hints, 'hint', 'hints') : ' with no hints',
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
    renderHints();
    renderTimer();
    $('picked').className = 'picked';
    $('picked').textContent = '';
    tick();
    if (justFinished) {
      $('live').textContent = 'All six found in ' + F.spokenTime(ms) + '. Today’s theme: ' + S.puzzle.name + '.';
      celebrate();
      box.querySelector('.primary').focus({ preventScroll: true });
      box.scrollIntoView({ behavior: reduced() ? 'auto' : 'smooth', block: 'start' });
    }
  }

  // A short shower of leaves when the last word is found.
  function celebrate() {
    if (reduced()) return;
    var bits = ['🌿', '🍃', '🧺', '✨', '🍂'];
    var layer = el('div', { class: 'confetti', 'aria-hidden': 'true' });
    for (var i = 0; i < 18; i++) {
      layer.appendChild(el('span', {
        text: bits[i % bits.length],
        style: '--x:' + (Math.random() * 96).toFixed(1) + '%;--delay:' + (Math.random() * 0.5).toFixed(2) + 's;--spin:' +
          Math.round(Math.random() * 360 - 180) + 'deg;--time:' + (1.5 + Math.random()).toFixed(2) + 's',
      }));
    }
    document.body.appendChild(layer);
    setTimeout(function () { layer.remove(); }, 3500);
  }

  // ---- sharing

  function share() {
    var text = F.shareText(S.day, S.result.ms, S.result.hints, S.puzzle.clue, SITE_URL);
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

  // ---- the clock tick: the timer, the countdown, and moving on at midnight

  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function tick() {
    if (!S.persist) {
      renderTimer();
      if ($('next') && finished()) $('next').textContent = 'Preview: use the arrows at the top to try another day.';
      return;
    }
    var newDay = today() !== S.day;
    // A day nobody has started moves on by itself. One in progress can be finished first.
    if (newDay && !S.started) { startGame(today(), true); return; }
    renderTimer();
    if (S.since !== null && now() - S.lastSave >= SAVE_EVERY_MS) snapshot();
    var box = $('next');
    if (!box || !finished()) return;
    if (newDay) {
      if (box.getAttribute('data-ready')) return;
      box.setAttribute('data-ready', '1');
      box.textContent = 'A new grid is ready. ';
      box.appendChild(el('button', { class: 'chip-btn', type: 'button', text: 'Play', onclick: function () { startGame(today(), true); } }));
      return;
    }
    var s = Math.floor(F.msUntilTomorrow() / 1000);
    box.textContent = 'Next grid in ';
    box.appendChild(el('b', { text: pad(Math.floor(s / 3600)) + ':' + pad(Math.floor(s / 60) % 60) + ':' + pad(s % 60) }));
  }

  // ---- stats

  function openStats() {
    var st = store.stats, body = $('stats-body');
    body.textContent = '';
    body.appendChild(el('div', { class: 'nums' }, [
      num(st.played, 'Played'),
      num(F.currentStreak(st, today()), 'Day streak'),
      num(st.best, 'Best streak'),
      num(st.played ? F.formatTime(st.bestMs) : '–', 'Best time'),
      num(st.played ? F.formatTime(st.totalMs / st.played) : '–', 'Average time'),
      num(st.played ? Math.round(st.clean / st.played * 100) + '%' : '–', 'No hints'),
    ]));
    if (PREVIEW) body.appendChild(el('p', { class: 'fine', text: 'This is a preview, so days played here are not counted.' }));
    openDialog('stats');
  }
  function num(value, label) {
    return el('div', {}, [el('b', { text: String(value) }), el('span', { text: label })]);
  }

  // ---- dialogs, toast, settings

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
  function applyContrast() {
    if (store.contrast) root.setAttribute('data-contrast', 'high'); else root.removeAttribute('data-contrast');
    $('contrast').checked = store.contrast;
  }

  // ---- wiring

  $('hint-btn').addEventListener('click', hint);
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
  // Another tab saved something: take its copy, and catch up with its game for this day.
  window.addEventListener('storage', function (e) {
    if (e.key !== STORE_KEY || !refresh()) return;
    applyContrast();
    if (!S.persist) return;
    var theirs = store.game;
    if (theirs && theirs.day > S.day) {
      // Another tab has moved on to a later day. Follow it only if this tab's clock agrees
      // and its own day is untouched; a day in progress stays until it is finished.
      if (today() > S.day && !S.started) startGame(today(), true);
    } else if (theirs && theirs.day === S.day) {
      var before = S.found.length, hintsBefore = S.hinted.length, result = S.result;
      takeSaved(theirs);
      if (finished()) stopClock();
      settle();
      if (S.found.length !== before || S.hinted.length !== hintsBefore) renderAll();
      var changed = !result || result.ms !== S.result.ms || result.hints !== S.result.hints;
      if (finished() && (!S.shown || changed)) showResults(false);
    } else if (S.started) {
      // Their copy has no trace of this tab's day (it was on an earlier one): put ours back.
      snapshot();
    }
  });
  document.addEventListener('visibilitychange', function () {
    if (document.hidden) {
      stopClock();
      if (S.started) snapshot();
    } else {
      runClock();
      tick();
    }
  });
  window.addEventListener('pagehide', function () { if (S.started) snapshot(); });
  setInterval(tick, 500);

  applyContrast();
  startGame(forcedDay > 0 ? forcedDay : today(), !PREVIEW);
})();
