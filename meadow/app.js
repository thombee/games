/*
 * Meadow page. Draws the yard and its pieces, handles dragging and the keyboard, shows the
 * result card, and keeps the player's progress in localStorage. The rules (moves, the
 * search behind hints, stars, the schedule, share text, stats) are in logic.js.
 */
(function () {
  'use strict';

  var P = window.Meadow;
  var BANK = window.MEADOW_PUZZLES;
  var FACTS = window.MEADOW_FACTS;

  // The address added to shared results. Empty until the game has a home.
  var SITE_URL = 'https://thombee.github.io/games/meadow/';
  var STORE_KEY = 'meadow:v1';
  var KIND_NAMES = { animal: 'animal', hay: 'Hay bale', log: 'Log', trough: 'Water trough', tractor: 'Tractor' };
  var ARROWS = { left: '←', right: '→', up: '↑', down: '↓' };

  var root = document.documentElement;
  var forcedDay = parseInt(new URLSearchParams(location.search).get('day'), 10);
  // Preview mode plays any day and saves nothing. It is on for ?day=N and for preview builds.
  var PREVIEW = root.hasAttribute('data-preview') || forcedDay > 0;
  var REDUCED = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var TOUCH = window.matchMedia('(pointer: coarse)').matches;

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
  function plural(n, one, many) { return n + ' ' + (n === 1 ? one : many || one + 's'); }

  // ---- saved progress

  function emptyStore() { return { v: 1, stats: P.emptyStats(), game: null, contrast: false }; }
  function count(x) { return Number.isInteger(x) && x >= 0 ? x : null; }
  // The saved progress, or null if this browser will not let the page read localStorage.
  function readStore() {
    var raw;
    try { raw = localStorage.getItem(STORE_KEY); } catch (e) { return null; }
    var s = emptyStore();
    try {
      var d = JSON.parse(raw || 'null');
      if (!d || d.v !== 1) return s;
      var st = d.stats || {};
      ['played', 'streak', 'best', 'lastDay'].forEach(function (k) { if (count(st[k]) !== null) s.stats[k] = st[k]; });
      if (Array.isArray(st.dist) && st.dist.length === 3) s.stats.dist = st.dist.map(function (n) { return count(n) || 0; });
      var g = d.game;
      if (g && count(g.day) && Array.isArray(g.moves)) {
        var r = g.result;
        s.game = {
          day: g.day,
          moves: g.moves.filter(function (m) { return Array.isArray(m) && m.length === 3 && m.every(function (x) { return count(x) !== null; }); }),
          hints: count(g.hints) || 0,
          rev: count(g.rev) || 0,
          result: r && count(r.moves) && count(r.par) ? { moves: r.moves, par: r.par, hinted: r.hinted === true } : null,
        };
      }
      s.contrast = d.contrast === true;
    } catch (e) { /* corrupt: start clean */ }
    return s;
  }
  /*
   * True once a write has failed and not been followed by one that worked. Storage then
   * holds less than this tab does, so this tab's copy stays the truth and is not replaced
   * by reading storage again.
   */
  var unsaved = false;
  function save() {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(store));
      unsaved = false;
    } catch (e) {
      unsaved = true;
      cannotSave();
    }
  }
  // Shown once, under the game, when the browser will not keep the player's progress.
  function cannotSave() {
    var note = $('storage-note');
    if (PREVIEW || !note.hidden) return;
    note.hidden = false;
    $('live').textContent = note.textContent;
  }
  var store = readStore();
  if (!store) { store = emptyStore(); cannotSave(); }

  // ---- the current day's game

  /*
   * S: day, persist (false in preview), par, pz (the parsed board), kinds, animal, name, fact,
   * moves (each [piece, from, to]), hints (hints asked for this run), rev (how many changes
   * have been saved, so tabs can tell whose game is newer), result (the first solve of the
   * day: { moves, par, hinted }, or null), hint (the hint on show), sel (the piece picked for
   * the Move buttons, or null), els (piece buttons).
   */
  var S = null;
  var drag = null;
  // The timer that hides the animal once it has trotted out of the gate.
  var exitTimer = 0;
  // When the last drag that went somewhere ended, so the click that follows it is not taken as picking the piece.
  var draggedAt = -Infinity;

  function today() { return Math.max(1, P.dayNumber()); }
  function position() { return P.replay(S.pz, S.moves); }
  function solved() { return P.isSolved(position()); }
  function untouched() { return S.rev === 0; }
  function who() { return S.name + ' the ' + S.animal.name; }

  function startGame(day, persist) {
    var puzzle = P.puzzleFor(day, BANK), pz = P.parseBoard(puzzle.board);
    S = {
      day: day, persist: persist, par: puzzle.par, pz: pz, kinds: P.pieceKinds(pz),
      animal: P.animalFor(day), name: P.nameFor(day), fact: P.factFor(day, FACTS),
      moves: [], hints: 0, rev: 0, result: null, hint: null, sel: null, els: [],
    };
    var g = persist && store.game;
    if (g && g.day === day) {
      S.moves = P.replay(pz, g.moves) ? g.moves.slice() : [];
      S.hints = g.hints;
      S.rev = g.rev;
      S.result = g.result;
    }
    $('day-tag').textContent = '#' + day;
    $('preview-bar').hidden = !PREVIEW;
    $('preview-day').textContent = 'Day ' + day;
    buildBoard();
    if (solved()) finish(false); else showPlay();
  }

  function snapshot() {
    if (!S.persist) return;
    store.game = { day: S.day, moves: S.moves, hints: S.hints, rev: S.rev, result: S.result };
    save();
  }
  function changed() {
    S.rev++;
    snapshot();
  }

  /*
   * Before acting, read the store again so what another tab has saved is not overwritten.
   * If that tab has moved on to a later day, or changed this day since this tab last saw it,
   * take its game instead of acting. Returns true if the action should be dropped. After a
   * failed write this tab's copy is newer than storage's, so storage is not read.
   */
  function behind() {
    if (!S.persist || unsaved) return false;
    var fresh = readStore();
    if (!fresh) return false;
    store = fresh;
    var g = store.game;
    if (g && g.day > S.day) { startGame(today(), true); return true; }
    if (g && g.day === S.day && g.rev > S.rev) { startGame(S.day, true); return true; }
    return false;
  }

  // ---- the yard

  function buildBoard() {
    drag = null;
    clearTimeout(exitTimer);
    var yard = $('yard');
    yard.textContent = '';
    S.els = S.pz.pieces.map(function (p, i) {
      var kind = S.kinds[i], body;
      if (kind === 'animal') {
        body = el('span', { class: 'body' }, [el('span', { class: 'face', 'aria-hidden': 'true', text: S.animal.emoji }), el('span', { class: 'tag', 'aria-hidden': 'true', text: S.name })]);
      } else if (kind === 'tractor') {
        body = el('span', { class: 'body' }, [el('span', { class: 'emoji', 'aria-hidden': 'true', text: '🚜' })]);
      } else {
        body = el('span', { class: 'body' });
      }
      var b = el('button', {
        type: 'button', class: 'piece ' + kind + (p.horiz ? ' across' : ' upright'), 'data-i': i,
        style: '--w:' + (p.horiz ? p.len : 1) + ';--h:' + (p.horiz ? 1 : p.len),
        onpointerdown: onDown, onpointermove: onMove, onpointerup: onUp, onpointercancel: onUp, onlostpointercapture: onUp,
        onkeydown: onKey, onclick: onPick,
      }, [body]);
      yard.appendChild(b);
      return b;
    });
    yard.appendChild(el('span', { class: 'ghost', id: 'ghost', hidden: true }));
    $('yard-label').textContent = 'The yard, six cells by six. ' + who() + ' is on row 3; the gate to the meadow is at the right-hand end of row 3. ' +
      'Each piece slides only along its length. Use the arrow keys to slide the piece you are on, or select a piece and use the Move buttons under the yard.';
    var res = $('resident');
    res.textContent = S.animal.emoji;
    res.className = 'resident';
    sizeCells();
    place();
  }

  // The pieces' emoji are sized from the cell size, which CSS cannot measure for itself.
  // A long name on the animal is set a little smaller until it fits.
  function sizeCells() {
    var w = $('yard').getBoundingClientRect().width;
    if (!w) return;
    $('board').style.setProperty('--md-cell', (w / 6).toFixed(1) + 'px');
    var tag = $('yard').querySelector('.animal .tag');
    if (!tag) return;
    tag.style.fontSize = '';
    for (var size = parseFloat(getComputedStyle(tag).fontSize); tag.scrollWidth > tag.clientWidth && size > 8; size -= 0.5) tag.style.fontSize = size - 0.5 + 'px';
  }

  function cellsText(p, at) {
    var a = at + 1, b = at + p.len;
    if (p.horiz) return 'row ' + (p.line + 1) + ', columns ' + a + (p.len === 2 ? ' and ' : ' to ') + b;
    return 'column ' + (p.line + 1) + ', rows ' + a + (p.len === 2 ? ' and ' : ' to ') + b;
  }
  // "Hay bale, standing up, column 4, rows 2 and 3. Can move up 1 or down 2."
  function pieceLabel(i, pos) {
    var p = S.pz.pieces[i], r = P.reach(S.pz, pos, i), can = [];
    var back = pos[i] - r.min, on = r.max - pos[i];
    if (back) can.push((p.horiz ? 'left ' : 'up ') + back);
    if (on) can.push((p.horiz ? 'right ' : 'down ') + on);
    var name = i === 0 ? who() : KIND_NAMES[S.kinds[i]] + (p.horiz ? ', lying across' : ', standing up');
    return name + ', ' + cellsText(p, pos[i]) + '. ' + (can.length ? 'Can move ' + can.join(' or ') + '.' : 'Cannot move.');
  }

  function place() {
    var pos = position();
    S.els.forEach(function (b, i) {
      var p = S.pz.pieces[i];
      b.style.setProperty('--x', p.horiz ? pos[i] : p.line);
      b.style.setProperty('--y', p.horiz ? p.line : pos[i]);
      b.setAttribute('aria-label', pieceLabel(i, pos));
      b.classList.toggle('hinted', !!S.hint && S.hint.piece === i);
      b.classList.toggle('selected', S.sel === i);
      var arrow = b.querySelector('.hint-arrow');
      if (arrow) arrow.remove();
      if (S.hint && S.hint.piece === i) b.appendChild(el('span', { class: 'hint-arrow', 'aria-hidden': 'true', text: ARROWS[S.hint.dir] }));
    });
    var ghost = $('ghost');
    if (S.hint) {
      var hp = S.pz.pieces[S.hint.piece];
      ghost.style.cssText = '--x:' + (hp.horiz ? S.hint.to : hp.line) + ';--y:' + (hp.horiz ? hp.line : S.hint.to) +
        ';--w:' + (hp.horiz ? hp.len : 1) + ';--h:' + (hp.horiz ? 1 : hp.len);
    }
    ghost.hidden = !S.hint;
    updateNudge(pos);
    updateStatus();
  }

  // The Move buttons under the yard, for the selected piece.
  function updateNudge(pos) {
    var box = $('nudge');
    if (S.sel === null || P.isSolved(pos)) { box.hidden = true; return; }
    var i = S.sel, p = S.pz.pieces[i], r = P.reach(S.pz, pos, i);
    box.hidden = false;
    $('nudge-what').textContent = 'Selected: ' + (i === 0 ? S.name : KIND_NAMES[S.kinds[i]].toLowerCase());
    [['nudge-back', p.horiz ? 'left' : 'up', pos[i] > r.min], ['nudge-on', p.horiz ? 'right' : 'down', pos[i] < r.max]].forEach(function (b) {
      var btn = $(b[0]);
      var arrow = el('span', { 'aria-hidden': 'true', text: ARROWS[b[1]] }), back = b[0] === 'nudge-back';
      btn.textContent = '';
      if (back) btn.appendChild(arrow);
      btn.appendChild(document.createTextNode((back ? ' ' : '') + 'Move ' + b[1] + (back ? '' : ' ')));
      if (!back) btn.appendChild(arrow);
      btn.setAttribute('aria-disabled', b[2] ? 'false' : 'true');
    });
  }

  function updateStatus() {
    var done = solved();
    var line = $('today');
    line.textContent = '';
    line.appendChild(document.createTextNode('Today: '));
    line.appendChild(el('b', { text: who() }));
    line.appendChild(document.createTextNode(' ' + S.animal.emoji));
    var c = $('count');
    c.textContent = '';
    c.appendChild(document.createTextNode('Moves '));
    c.appendChild(el('b', { text: String(S.moves.length) }));
    c.appendChild(document.createTextNode(' · Par '));
    c.appendChild(el('b', { text: String(S.par) }));
    var prompt = $('prompt');
    if (done) prompt.textContent = '';
    else if (S.result) prompt.textContent = 'Playing again for fun. Your first result is kept.';
    else if (S.moves.length < 3) prompt.textContent = 'Drag each piece along its length. Get ' + S.name + ' through the gate on the right.';
    else prompt.textContent = '';
    if (prompt.textContent) prompt.removeAttribute('data-empty'); else prompt.setAttribute('data-empty', '');
    $('way').hidden = done || S.moves.length > 0;
    $('undo-btn').disabled = !S.moves.length;
    $('restart-btn').disabled = !S.moves.length;
  }

  function showPlay() {
    clearTimeout(exitTimer);
    $('controls').hidden = false;
    $('results').hidden = true;
    $('resident').className = 'resident';
    S.els[0].classList.remove('free');
    S.els[0].hidden = false;
    place();
  }

  // ---- moving pieces

  function say(text) { $('live').textContent = text; }

  // Slide piece i to `to`. Returns true if it moved.
  function move(i, to) {
    if (solved() || behind()) return false;
    var pos = position(), next = P.slide(S.pz, pos, i, to);
    if (!next) return false;
    var p = S.pz.pieces[i], d = to - pos[i];
    S.moves = P.addMove(S.moves, i, pos[i], to);
    S.hint = null;
    changed();
    place();
    if (P.isSolved(next)) { finish(true); return true; }
    say((i === 0 ? S.name : KIND_NAMES[S.kinds[i]]) + ' moved ' + (p.horiz ? (d > 0 ? 'right ' : 'left ') : (d > 0 ? 'down ' : 'up ')) + Math.abs(d) + '. Moves ' + S.moves.length + '.');
    return true;
  }

  function onDown(e) {
    // The same pointer pressing again means its release was never heard (it was let go
    // outside the window, say): drop that drag, putting the piece back, and start this one.
    if (drag && drag.id === e.pointerId) onUp({ type: 'pointercancel', pointerId: e.pointerId });
    if (drag || (e.pointerType === 'mouse' && e.button !== 0) || solved()) return;
    var b = e.currentTarget, i = Number(b.getAttribute('data-i')), p = S.pz.pieces[i], pos = position(), r = P.reach(S.pz, pos, i);
    drag = {
      i: i, b: b, id: e.pointerId, horiz: p.horiz, start: p.horiz ? e.clientX : e.clientY, at: pos[i], now: pos[i],
      min: r.min, max: r.max, cell: $('yard').getBoundingClientRect().width / 6, pushed: 0, travel: 0,
    };
    try { b.setPointerCapture(e.pointerId); } catch (err) { /* the drag still works while the pointer stays on the piece */ }
    b.classList.add('dragging');
    e.preventDefault();
  }
  // Move the dragged piece to follow the pointer event e, as far as it can go along its line.
  function follow(d, e) {
    var want = d.at + ((d.horiz ? e.clientX : e.clientY) - d.start) / d.cell;
    var x = Math.max(d.min, Math.min(d.max, want));
    d.pushed = Math.max(d.pushed, Math.abs(want - x));
    d.travel = Math.max(d.travel, Math.abs(want - d.at));
    d.now = x;
    d.b.style.transform = (d.horiz ? 'translateX(' : 'translateY(') + ((x - d.at) * d.cell).toFixed(1) + 'px)';
  }
  function onMove(e) {
    if (!drag || e.pointerId !== drag.id) return;
    follow(drag, e);
    e.preventDefault();
  }
  // Letting go snaps the piece to the nearest cell to where the pointer was released. A
  // cancelled drag puts it back where it started.
  function onUp(e) {
    // Another piece losing its hold on the pointer is not the end of this drag.
    if (!drag || e.pointerId !== drag.id || (e.currentTarget && e.currentTarget !== drag.b)) return;
    var d = drag;
    drag = null;
    if (e.type === 'pointerup') follow(d, e);
    if (d.travel >= 0.2) draggedAt = Date.now();
    var to = e.type === 'pointerup' ? Math.round(d.now) : d.at;
    var moved = to !== d.at && move(d.i, to);
    var b = S.els[d.i];
    if (b !== d.b) return; // the board was rebuilt for another tab's game
    // Carry on from where the finger let go: put the piece at its new cell, offset by what
    // is left over, then let the transition take the offset away.
    var left = moved ? d.now - to : d.now - d.at;
    b.style.transform = (d.horiz ? 'translateX(' : 'translateY(') + (left * d.cell).toFixed(1) + 'px)';
    void b.offsetWidth;
    b.classList.remove('dragging');
    b.style.transform = '';
    if (!moved && d.pushed > 0.3) bump(b);
  }
  // A short squash on a piece that was pushed against something and could not go.
  function bump(b) {
    b.classList.remove('bump');
    void b.offsetWidth;
    b.classList.add('bump');
    setTimeout(function () { b.classList.remove('bump'); }, 300);
  }

  /*
   * Activating a piece (a tap or click that is not the end of a drag, or Enter or Space)
   * selects it for the Move buttons under the yard. This is how a screen reader on a phone
   * moves pieces.
   */
  function onPick(e) {
    if (Date.now() - draggedAt < 500 || solved()) return;
    var i = Number(e.currentTarget.getAttribute('data-i')), p = S.pz.pieces[i];
    S.sel = i;
    place();
    say(pieceLabel(i, position()) + ' Selected. The Move ' + (p.horiz ? 'left and Move right' : 'up and Move down') + ' buttons under the yard slide it.');
  }
  // A Move button: slide the selected piece one cell back (-1) or on (+1).
  function nudge(step) {
    if (S.sel === null || solved()) return;
    var i = S.sel, pos = position(), to = pos[i] + step, r = P.reach(S.pz, pos, i);
    if (to < r.min || to > r.max) {
      bump(S.els[i]);
      say('Something is in the way.');
      return;
    }
    move(i, to);
  }

  var KEYS = { ArrowLeft: [true, -1], ArrowRight: [true, 1], ArrowUp: [false, -1], ArrowDown: [false, 1] };
  function onKey(e) {
    var k = KEYS[e.key];
    if (!k || e.altKey || e.ctrlKey || e.metaKey) return;
    e.preventDefault();
    if (solved()) return;
    var i = Number(e.currentTarget.getAttribute('data-i')), p = S.pz.pieces[i];
    if (k[0] !== p.horiz) {
      say((i === 0 ? S.name : 'This ' + KIND_NAMES[S.kinds[i]].toLowerCase()) + ' only slides ' + (p.horiz ? 'left and right.' : 'up and down.'));
      return;
    }
    var pos = position(), to = pos[i] + k[1], r = P.reach(S.pz, pos, i);
    if (to < r.min || to > r.max) {
      bump(e.currentTarget);
      say('Something is in the way.');
      return;
    }
    if (move(i, to) && !solved()) {
      var b = S.els[i];
      if (b && document.activeElement !== b) b.focus();
    }
  }

  function undo() {
    if (!S.moves.length || solved() || behind()) return;
    S.moves = S.moves.slice(0, -1);
    S.hint = null;
    changed();
    place();
    say('Took back a move. Moves ' + S.moves.length + '.');
    if (!S.moves.length) $('hint-btn').focus();
  }
  function restart() {
    if (!S.moves.length || solved() || behind()) return;
    S.moves = [];
    S.hint = null;
    changed();
    place();
    say('Back to the start. Moves 0.');
    $('hint-btn').focus();
  }
  function hint() {
    if (solved() || behind()) return;
    var h = P.hint(S.pz, position());
    if (!h) return;
    S.hint = h;
    S.hints++;
    changed();
    place();
    var p = S.pz.pieces[h.piece], name = h.piece === 0 ? S.name : 'the ' + KIND_NAMES[S.kinds[h.piece]].toLowerCase();
    say('Hint: slide ' + name + ' ' + h.dir + ' to ' + cellsText(p, h.to) + '.');
  }
  function playAgain() {
    if (behind()) return;
    S.moves = [];
    S.hints = 0;
    S.hint = null;
    changed();
    showPlay();
    S.els[0].focus({ preventScroll: true });
    if (!REDUCED) $('board').scrollIntoView({ behavior: 'smooth', block: 'center' });
    say('Playing again for fun. Your first result is kept.');
  }

  // ---- the end of a run

  /*
   * The animal has reached the gate. The first solve of the day is recorded; a later one
   * (after Play again) is only shown. `fresh` is true when it has just happened, false when
   * a solved game is opened again.
   */
  function finish(fresh) {
    var run = { moves: S.moves.length, par: S.par, hinted: S.hints > 0 };
    var first = !S.result;
    if (first) {
      S.result = run;
      if (S.persist) {
        store.stats = P.recordResult(store.stats, S.day, P.stars(run.moves, run.par));
        snapshot();
      }
    }
    S.hint = null;
    S.sel = null;
    $('controls').hidden = true;
    place();
    var animal = S.els[0], res = $('resident');
    if (fresh && !REDUCED) {
      animal.classList.add('free');
      res.className = 'resident here arrive';
      clearTimeout(exitTimer);
      exitTimer = setTimeout(function () { if (S.els[0] === animal && solved()) animal.hidden = true; }, 600);
    } else {
      animal.hidden = true;
      res.className = 'resident here';
    }
    renderResults(fresh, first ? null : run);
  }

  function starsRow(n) {
    var row = el('div', { class: 'r-stars', role: 'img', 'aria-label': plural(n, 'star') + ' out of 3' });
    for (var k = 1; k <= 3; k++) row.appendChild(el('span', { class: k <= n ? 'on' : 'off', 'aria-hidden': 'true', text: '⭐' }));
    return row;
  }
  function num(value, label) {
    return el('div', {}, [el('b', { text: String(value) }), el('span', { text: label })]);
  }
  function shownStreak() { return store.stats.lastDay >= today() - 1 ? store.stats.streak : 0; }

  // run is this replay's result when it is not the first solve of the day, else null.
  function renderResults(justFinished, run) {
    var r = S.result, n = P.stars(r.moves, r.par), box = $('results'), f = S.fact;
    box.textContent = '';
    box.hidden = false;
    box.appendChild(el('h2', { class: 'r-title', id: 'result-title', text: S.name + ' is out in the meadow!' }));
    box.appendChild(starsRow(n));
    box.appendChild(el('p', { class: 'r-sub' }, [
      el('b', { text: plural(r.moves, 'move') }), ' · par ' + r.par + (r.hinted ? ' · 💡 with a hint' : ''),
    ]));
    if (run) {
      box.appendChild(el('p', { class: 'r-again', text: 'This time: ' + plural(run.moves, 'move') + '. Your first solve of the day is the one that counts.' }));
    }
    box.appendChild(el('div', { class: 'fact' }, [
      el('h3', { text: 'Did you know?' }),
      el('p', { text: f.text }),
      el('span', { class: 'src' }, ['Source: ', el('a', { href: f.url, target: '_blank', rel: 'noopener', text: f.source })]),
    ]));
    box.appendChild(el('div', { class: 'actions' }, [
      el('button', { class: 'primary', type: 'button', id: 'share-btn', text: 'Share result', onclick: share }),
      el('button', { class: 'secondary', type: 'button', id: 'stats-open', text: 'Stats', onclick: openStats }),
      el('button', { class: 'secondary', type: 'button', id: 'again-btn', text: 'Play again', onclick: playAgain }),
    ]));
    box.appendChild(el('pre', { class: 'share-text', id: 'share-text', hidden: true }));
    if (S.persist) {
      var st = store.stats;
      box.appendChild(el('div', { class: 'nums' }, [num(st.played, 'Played'), num(shownStreak(), 'Day streak'), num(st.best, 'Best streak')]));
      if (st.streak >= 2 && st.lastDay === S.day) box.appendChild(el('p', { class: 'streak', text: '🔥 ' + st.streak + ' days in a row' }));
    }
    box.appendChild(el('p', { class: 'next', id: 'next' }));
    tick();
    if (justFinished) {
      say(who() + ' reached the meadow in ' + plural((run || r).moves, 'move') + '. Par ' + r.par + '. ' +
        (run ? 'Your first result, ' + plural(n, 'star') + ', is kept.' : plural(n, 'star') + '.'));
      if (!run && n === 3) celebrate();
      $('share-btn').focus({ preventScroll: true });
      if (!REDUCED) setTimeout(function () { box.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); }, 450);
    }
  }

  // A short shower of flowers after a three-star day.
  function celebrate() {
    if (REDUCED) return;
    var bits = ['🌼', '🌸', '🌿', '⭐', '🌷'];
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
    var text = P.shareText(S.day, S.result, SITE_URL);
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

  // ---- the clock: countdown to the next puzzle, and moving on when it arrives

  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function tick() {
    if (!S.persist) {
      if ($('next')) $('next').textContent = 'Preview: use the arrows at the top to try another day.';
      return;
    }
    var newDay = today() !== S.day;
    // A day nobody has touched moves on by itself. One in progress can be finished first.
    if (newDay && untouched() && !drag) { startGame(today(), true); return; }
    var box = $('next');
    if (!box || $('results').hidden) return;
    if (newDay) {
      if (box.getAttribute('data-ready')) return;
      box.setAttribute('data-ready', '1');
      box.textContent = 'A new puzzle is ready. ';
      box.appendChild(el('button', { class: 'chip-btn', type: 'button', text: 'Play', onclick: function () { startGame(today(), true); } }));
      return;
    }
    var s = Math.floor(P.msUntilTomorrow() / 1000);
    box.textContent = 'Next puzzle in ';
    box.appendChild(el('b', { text: pad(Math.floor(s / 3600)) + ':' + pad(Math.floor(s / 60) % 60) + ':' + pad(s % 60) }));
  }

  // ---- stats

  function openStats() {
    var st = store.stats, body = $('stats-body');
    var most = Math.max.apply(null, st.dist.concat([1]));
    var todayStars = S.persist && S.result && st.lastDay === S.day ? P.stars(S.result.moves, S.result.par) : 0;
    body.textContent = '';
    body.appendChild(el('div', { class: 'nums' }, [num(st.played, 'Played'), num(shownStreak(), 'Day streak'), num(st.best, 'Best streak')]));
    body.appendChild(el('h3', { text: 'Your stars' }));
    body.appendChild(el('ol', { class: 'hist', 'aria-label': 'How often you earned each number of stars' }, [3, 2, 1].map(function (k) {
      var n = st.dist[k - 1];
      return el('li', { 'aria-label': plural(k, 'star') + ': ' + plural(n, 'day') }, [
        el('span', { class: 'hist-stars', 'aria-hidden': 'true', text: '⭐'.repeat(k) }),
        el('span', { class: 'hist-bar' + (todayStars === k ? ' today' : ''), style: 'width:' + Math.round(n / most * 100) + '%' }),
        el('span', { class: 'hist-count', 'aria-hidden': 'true', text: String(n) }),
      ]);
    })));
    if (PREVIEW) body.appendChild(el('p', { class: 'fine', text: 'This is a preview, so days played here are not counted.' }));
    openDialog('stats');
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

  $('undo-btn').addEventListener('click', undo);
  $('restart-btn').addEventListener('click', restart);
  $('hint-btn').addEventListener('click', hint);
  $('nudge-back').addEventListener('click', function () { nudge(-1); });
  $('nudge-on').addEventListener('click', function () { nudge(1); });
  $('help-btn').addEventListener('click', function () { openDialog('help'); });
  $('stats-btn').addEventListener('click', openStats);
  Array.prototype.forEach.call(document.querySelectorAll('dialog'), function (d) {
    d.addEventListener('click', function (e) {
      if (e.target === d || (e.target.closest && e.target.closest('[data-close]'))) closeDialog(d);
    });
  });
  $('contrast').addEventListener('change', function () {
    // Read the store again first, so this write carries what another tab has saved since.
    var fresh = unsaved ? null : readStore();
    if (fresh) store = fresh;
    store.contrast = $('contrast').checked;
    save();
    applyContrast();
  });
  $('prev-day').addEventListener('click', function () { if (S.day > 1) startGame(S.day - 1, false); });
  $('next-day').addEventListener('click', function () { startGame(S.day + 1, false); });
  // Another tab saved something: take its copy, and redraw if it has changed this day since
  // this tab last saw it, or moved on to a later day.
  window.addEventListener('storage', function (e) {
    if (e.key !== STORE_KEY || unsaved) return;
    var fresh = readStore();
    if (!fresh) return;
    store = fresh;
    applyContrast();
    if (!S.persist) return;
    var g = store.game;
    if (g && g.day > S.day) startGame(today(), true);
    else if (g && g.day === S.day) { if (g.rev > S.rev) startGame(S.day, true); }
    else if (!untouched()) snapshot(); // their copy has no trace of this tab's day: put ours back
  });
  window.addEventListener('resize', sizeCells);
  document.addEventListener('visibilitychange', function () { if (!document.hidden) tick(); });
  setInterval(tick, 1000);

  applyContrast();
  startGame(forcedDay > 0 ? forcedDay : today(), !PREVIEW);
})();
