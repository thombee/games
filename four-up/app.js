/*
 * Four Up page. Draws the day's puzzle, drops the player's discs and Red's replies, rewinds
 * the board after a miss, then shows the winning line and the result card. Keeps the
 * player's progress in localStorage. The rules (judging moves, Red's replies, share text,
 * stats) are in logic.js; the puzzles and the schedule are in puzzles.js.
 */
(function () {
  'use strict';

  var F = window.FourUp;
  var BANK = window.FOUR_UP_BANK;

  // The address added to shared results. Empty until the game has a home.
  var SITE_URL = 'https://thombee.github.io/games/four-up/';
  var STORE_KEY = 'four-up:v1';

  var root = document.documentElement;
  var forcedDay = parseInt(new URLSearchParams(location.search).get('day'), 10);
  // Preview mode plays any day and saves nothing. It is on for ?day=N and for preview builds.
  var PREVIEW = root.hasAttribute('data-preview') || forcedDay > 0;
  var TOUCH = window.matchMedia('(pointer: coarse)').matches;
  // Asked each time something would move, so a change of setting applies straight away.
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
  function wait(ms) { return new Promise(function (ok) { setTimeout(ok, ms); }); }

  // ---- saved progress

  function emptyStore() { return { v: 1, stats: F.emptyStats(), game: null, contrast: false }; }
  // The saved progress, or null if this browser will not let the page read localStorage.
  function readStore() {
    var raw;
    try { raw = localStorage.getItem(STORE_KEY); } catch (e) { return null; }
    var s = emptyStore();
    try {
      var d = JSON.parse(raw || 'null');
      if (!d || d.v !== 1) return s;
      var st = d.stats || {};
      ['played', 'solved', 'streak', 'best', 'lastDay'].forEach(function (k) {
        if (Number.isFinite(st[k]) && st[k] >= 0) s.stats[k] = Math.floor(st[k]);
      });
      if (s.stats.solved > s.stats.played) s.stats.solved = s.stats.played;
      if (Array.isArray(st.dist) && st.dist.length === s.stats.dist.length) {
        s.stats.dist = st.dist.map(function (n) { return Number.isFinite(n) && n >= 0 ? Math.floor(n) : 0; });
      }
      var g = d.game;
      if (g && Number.isInteger(g.day) && g.day > 0 && Array.isArray(g.moves)) {
        s.game = { day: g.day, moves: g.moves.filter(function (c) { return Number.isInteger(c) && c >= 0 && c < F.WIDTH; }).slice(0, 64) };
      }
      s.contrast = d.contrast === true;
    } catch (e) { /* corrupt: start clean */ }
    return s;
  }
  // Once a write has failed, this tab's copy is the truth: what storage holds is out of date.
  var writeFailed = false;
  function save() {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(store)); } catch (e) { writeFailed = true; cannotSave(); }
  }
  // Shown once, under the game, when the browser will not keep the player's progress.
  function cannotSave() {
    var note = $('storage-note');
    if (PREVIEW || !note.hidden) return;
    note.hidden = false;
    $('live').textContent = note.textContent;
  }
  // Take what another tab has saved since, unless this tab's own writes are failing.
  function refresh() {
    if (writeFailed) return;
    var fresh = readStore();
    if (fresh) store = fresh;
  }
  var store = readStore();
  if (!store) { store = emptyStore(); writeFailed = true; cannotSave(); }

  // ---- the current day's game

  // day, persist (false in preview), puzzle, moves (Yellow's columns today, across all
  // tries), result (F.playDay of those), busy (a move is playing out), focusCol (the column
  // the keyboard is on), replay ({ line, at } once the day is over).
  var S = null;

  function today() { return Math.max(1, F.dayNumber()); }

  function startGame(day, persist) {
    var puzzle = F.puzzleFor(day, BANK);
    S = { day: day, persist: persist, puzzle: puzzle, moves: [], result: null, busy: false, focusCol: S ? S.focusCol : 3, replay: null };
    if (persist && store.game && store.game.day === day) S.moves = F.playDay(puzzle, store.game.moves).moves;
    S.result = F.playDay(puzzle, S.moves);
    $('day-tag').textContent = '#' + day;
    $('preview-bar').hidden = !PREVIEW;
    $('preview-day').textContent = 'Day ' + day;
    var task = $('task');
    task.textContent = '';
    task.appendChild(el('span', { class: 'you', 'aria-hidden': 'true' }));
    task.appendChild(document.createTextNode('Yellow to play. Win in ' + puzzle.n + '.'));
    $('sub').textContent = puzzle.n === 1 ? 'Make four in a row with your next disc.' :
      'Make four in a row within ' + puzzle.n + ' of your moves, whatever Red does.';
    render(false);
  }

  function snapshot() {
    // A tab still on an earlier day never replaces a later day's game.
    if (!(store.game && store.game.day > S.day)) store.game = { day: S.day, moves: S.moves.slice() };
    save();
  }
  function sameMoves(a, b) {
    return a.length === b.length && a.every(function (c, i) { return c === b[i]; });
  }
  // True if the saved game is for this tab's day and has played further, or differently.
  function savedIsNewer() {
    var theirs = store.game;
    if (!theirs || theirs.day !== S.day) return false;
    var moves = F.playDay(S.puzzle, theirs.moves).moves;
    return moves.length >= S.moves.length && !sameMoves(moves, S.moves);
  }

  // The try in play, if one is under way.
  function currentTry() {
    var t = S.result.tries[S.result.tries.length - 1];
    return t && t.outcome === 'playing' ? t : null;
  }
  function stepCols(steps) { return steps.map(function (s) { return s.col; }).join(''); }

  // ---- the board

  var board = $('board'), rack = $('rack');
  var cols = [], slots = [];
  for (var c = 0; c < F.WIDTH; c++) {
    var cells = [];
    for (var r = F.HEIGHT - 1; r >= 0; r--) cells.push(el('span', { class: 'cell', 'data-row': r, 'aria-hidden': 'true' }, [el('span', { class: 'hole' })]));
    cols.push(board.appendChild(el('button', { class: 'col', type: 'button', 'data-col': c, tabindex: '-1' }, cells)));
    slots.push($('ghosts').appendChild(el('span', { class: 'slot', 'data-col': c }, [el('span', { class: 'ghost' })])));
  }
  // Show the ghost disc over one column, or none (-1).
  function ghost(col) { slots.forEach(function (s, i) { s.classList.toggle('on', i === col); }); }
  function holeAt(col, row) { return cols[col].querySelector('.cell[data-row="' + row + '"] .hole'); }
  function discAt(col, row) { return holeAt(col, row).querySelector('.disc'); }

  /*
   * Draw the position after `moves` (a string of columns from the empty board). marks:
   * last ([col, row] of a disc to ring), win (cells to pulse).
   */
  var shown = '';
  function paint(moves, marks) {
    marks = marks || {};
    var g = F.grid(moves);
    shown = moves;
    for (var col = 0; col < F.WIDTH; col++) {
      var bottomUp = [];
      for (var row = 0; row < F.HEIGHT; row++) {
        var who = g[row][col], hole = holeAt(col, row), disc = hole.querySelector('.disc');
        if (!who) { if (disc) disc.remove(); continue; }
        bottomUp.push(who);
        if (!disc || disc.getAttribute('data-who') !== who) {
          if (disc) disc.remove();
          disc = hole.appendChild(el('span', { class: 'disc ' + who, 'data-who': who }));
        }
        disc.className = 'disc ' + who;
      }
      var label = 'Column ' + (col + 1) + ': ' + (bottomUp.length ? bottomUp.join(', ') + ' from the bottom' : 'empty');
      label += bottomUp.length === F.HEIGHT ? '. Full.' : bottomUp.length ? ', ' + plural(F.HEIGHT - bottomUp.length, 'space', 'spaces') + ' above.' : '.';
      cols[col].setAttribute('aria-label', label);
      cols[col].setAttribute('aria-disabled', bottomUp.length === F.HEIGHT || S.result.over ? 'true' : 'false');
    }
    if (marks.last) discAt(marks.last[0], marks.last[1]).classList.add('last');
    (marks.win || []).forEach(function (cr) { discAt(cr[0], cr[1]).classList.add('win'); });
    rack.classList.toggle('done', S.result.over);
    setFocusCol(S.focusCol);
  }
  // Where the disc of the last move in `moves` sits: [col, row].
  function lastCell(moves) {
    var col = Number(moves[moves.length - 1]), row = -1;
    for (var i = 0; i < moves.length; i++) if (Number(moves[i]) === col) row++;
    return [col, row];
  }
  function winCells(moves) {
    var at = lastCell(moves);
    return F.lineThrough(F.grid(moves), at[0], at[1]);
  }

  function setFocusCol(col) {
    S.focusCol = col;
    cols.forEach(function (b, i) { b.setAttribute('tabindex', i === col ? '0' : '-1'); });
  }
  function setBusy(on) {
    S.busy = on;
    if (on) board.setAttribute('aria-busy', 'true'); else board.removeAttribute('aria-busy');
    rack.classList.toggle('busy', on);
  }

  // Drop the disc at (col, row) in from above the board, with a little bounce.
  function drop(col, row) {
    var disc = discAt(col, row);
    if (!disc || reduced() || !disc.animate) return Promise.resolve();
    var pitch = holeAt(col, row).closest('.cell').getBoundingClientRect().height;
    var fall = (F.HEIGHT - row) * pitch, bounce = Math.min(pitch * 0.3, 0.1 * fall + 4);
    disc.classList.add('falling');
    var anim = disc.animate([
      { transform: 'translateY(' + -fall + 'px)', easing: 'cubic-bezier(.45, 0, 1, 1)' },
      { transform: 'translateY(0)', offset: 0.66, easing: 'cubic-bezier(0, 0, .55, 1)' },
      { transform: 'translateY(' + -bounce + 'px)', offset: 0.83, easing: 'cubic-bezier(.45, 0, 1, 1)' },
      { transform: 'translateY(0)' },
    ], { duration: 230 + 45 * (F.HEIGHT - row) });
    return anim.finished.then(done, done);
    function done() { disc.classList.remove('falling'); }
  }

  // Lift the discs of a try back out of the board, the last one first.
  function rewind(steps, moves) {
    if (reduced()) return Promise.resolve();
    var heights = [0, 0, 0, 0, 0, 0, 0], cellsOut = [];
    for (var i = 0; i < moves.length; i++) {
      var col = Number(moves[i]);
      if (i >= moves.length - steps.length) cellsOut.push([col, heights[col]]);
      heights[col]++;
    }
    var pitch = holeAt(0, 0).closest('.cell').getBoundingClientRect().height;
    var anims = cellsOut.reverse().map(function (cr, k) {
      var disc = discAt(cr[0], cr[1]);
      if (!disc || !disc.animate) return Promise.resolve();
      disc.classList.add('falling');
      return disc.animate([
        { transform: 'translateY(0)', opacity: 1 },
        { transform: 'translateY(' + -(F.HEIGHT - cr[1]) * pitch + 'px)', opacity: 0 },
      ], { duration: 260, delay: k * 110, easing: 'cubic-bezier(.4, 0, .9, .6)', fill: 'forwards' }).finished.catch(function () {});
    });
    return Promise.all(anims);
  }

  // ---- drawing the day

  function render(justFinished) {
    renderTries();
    if (S.result.over) { showDone(justFinished); return; }
    S.replay = null;
    $('replay').hidden = true;
    $('results').hidden = true;
    var t = currentTry();
    var moves = S.puzzle.moves + (t ? stepCols(t.steps) : '');
    paint(moves, t ? { last: lastCell(moves) } : {});
    var status = $('status');
    status.textContent = '';
    if (!S.moves.length) {
      status.className = 'status hint';
      status.textContent = 'Tap a column to drop your disc';
    } else if (t) {
      status.className = 'status';
      status.textContent = 'Red replied in column ' + (t.steps[t.steps.length - 1].col + 1) + '. ' + leftText(t.budget);
    } else {
      status.className = 'status';
      status.appendChild(el('span', { class: 'bad', text: 'Try ' + (S.result.used + 1) + ' of ' + F.TRIES + '. ' }));
      status.appendChild(document.createTextNode('Back to the start: find the winning move.'));
    }
  }
  function leftText(budget) { return budget === 1 ? 'Now finish it.' : 'Now win in ' + budget + '.'; }

  function renderTries() {
    var box = $('tries'), d = S.result;
    box.textContent = '';
    for (var i = 0; i < F.TRIES; i++) {
      var t = d.tries[i], state = t && t.outcome !== 'playing' ? t.outcome : '';
      var now = !d.over && (t ? t.outcome === 'playing' : i === d.tries.filter(function (x) { return x.outcome !== 'playing'; }).length);
      box.appendChild(el('li', {
        class: (state || '') + (now ? ' now' : ''),
        'aria-label': 'Try ' + (i + 1) + ': ' + (state === 'solved' ? 'solved' : state === 'missed' ? 'missed' : now ? 'now playing' : 'not used'),
      }, [state && el('span', { 'aria-hidden': 'true', text: state === 'solved' ? '✓' : '✕' })]));
    }
  }

  // ---- playing a move

  function onColumn(col) {
    if (!S || S.busy || S.result.over) return;
    var t = currentTry(), pos = t ? t.pos : F.positionFrom(S.puzzle.moves);
    if (!pos.canPlay(col)) { toast('That column is full'); return; }
    if (S.persist) {
      // Read the store again first, so what another tab has saved is not overwritten. If that
      // tab has played this day further, or differently, take its game instead of this move.
      refresh();
      if (savedIsNewer()) { startGame(S.day, true); return; }
    }
    var next = F.playDay(S.puzzle, S.moves.concat([col]));
    if (next.moves.length !== S.moves.length + 1) return;
    S.moves = next.moves;
    S.result = next;
    if (S.persist) {
      if (next.over) store.stats = F.recordResult(store.stats, S.day, next.solved ? next.used : 0);
      snapshot();
    }
    setFocusCol(col);
    playOut();
  }

  // Show the move just made: the drop, Red's reply, and then a solve, a miss or the next turn.
  function playOut() {
    var d = S.result, t = d.tries[d.tries.length - 1], steps = t.steps;
    var mine = steps[t.outcome === 'solved' ? steps.length - 1 : steps.length - 2];
    var red = t.outcome === 'solved' ? null : steps[steps.length - 1];
    var before = S.puzzle.moves + stepCols(steps.slice(0, steps.indexOf(mine)));
    var withMine = before + mine.col;
    var status = $('status');
    setBusy(true);
    renderTries();
    paint(withMine);
    drop.apply(null, lastCell(withMine)).then(function () {
      if (!red) {
        paint(withMine, { win: winCells(withMine) });
        status.className = 'status';
        status.textContent = '';
        status.appendChild(el('span', { class: 'good', text: 'Four in a row! ' }));
        status.appendChild(document.createTextNode(d.used === 1 ? 'Solved on the first try.' : 'Solved on try ' + d.used + '.'));
        $('live').textContent = 'You: column ' + (mine.col + 1) + '. Four in a row. Solved on try ' + d.used + '.';
        return wait(reduced() ? 300 : 1100).then(function () { setBusy(false); render(true); });
      }
      return wait(reduced() ? 120 : 260).then(function () {
        var all = withMine + red.col;
        paint(all, { last: lastCell(all) });
        return drop.apply(null, lastCell(all)).then(function () {
          var redWon = winCells(all).length > 0;
          if (t.outcome === 'playing') {
            status.className = 'status';
            status.textContent = '';
            status.appendChild(el('span', { class: 'good', text: 'Good. ' }));
            status.appendChild(document.createTextNode('Red replies in column ' + (red.col + 1) + '. ' + leftText(t.budget)));
            $('live').textContent = 'You: column ' + (mine.col + 1) + '. Red: column ' + (red.col + 1) + '. ' + leftText(t.budget);
            setBusy(false);
            return null;
          }
          if (redWon) paint(all, { last: lastCell(all), win: winCells(all) });
          status.className = 'status';
          status.textContent = '';
          // What the miss comes to with perfect play, and Red's proved best reply (see logic.js).
          var what = { slow: 'That still wins, but not in time. ', draw: 'That lets Red off the hook. ', lost: 'That hands it to Red. ' }[t.miss];
          var how = { slow: 'Red holds on with column ', draw: 'Red escapes with column ', lost: 'Red plays column ' }[t.miss] + (red.col + 1) + '.';
          status.appendChild(el('span', { class: 'bad', text: what }));
          status.appendChild(document.createTextNode(how));
          $('live').textContent = 'You: column ' + (mine.col + 1) + '. ' + what + how;
          return wait(1700).then(function () {
            if (d.over) { setBusy(false); render(true); return null; }
            return rewind(steps, all).then(function () {
              setBusy(false);
              render(false);
              $('live').textContent = 'Try ' + (d.used + 1) + ' of ' + F.TRIES + '. The board is back at the start.';
            });
          });
        });
      });
    });
  }

  // ---- the day is over: the winning line on the board, and the result card

  function showDone(justFinished) {
    var d = S.result, solvedTry = d.tries.filter(function (t) { return t.outcome === 'solved'; })[0];
    var line = solvedTry ? solvedTry.steps.map(function (s) { return s.col; }) : S.puzzle.line.split('').map(Number);
    S.replay = { line: line, at: line.length, mine: !!solvedTry };
    var status = $('status');
    status.className = 'status';
    status.textContent = '';
    if (d.solved) {
      status.appendChild(el('span', { class: 'good', text: 'Four in a row! ' }));
      status.appendChild(document.createTextNode('Step through your winning line.'));
    } else {
      status.appendChild(el('span', { class: 'bad', text: 'Out of tries. ' }));
      status.appendChild(document.createTextNode('Here is the winning line.'));
    }
    $('replay').hidden = false;
    renderReplay();
    renderResults(justFinished);
  }

  function renderReplay() {
    var R = S.replay, moves = S.puzzle.moves + R.line.slice(0, R.at).join('');
    var marks = {};
    if (R.at > 0) marks.last = lastCell(moves);
    if (R.at === R.line.length) marks.win = winCells(moves);
    paint(moves, marks);
    var text;
    if (R.at === 0) text = 'The puzzle, Yellow to play.';
    else {
      var who = R.at % 2 === 1 ? 'Yellow' : 'Red';
      text = 'Move ' + R.at + ' of ' + R.line.length + ': ' + who + ', column ' + (R.line[R.at - 1] + 1) + (R.at === R.line.length ? '. Four in a row.' : '.');
    }
    $('replay-text').textContent = text;
    $('replay-back').disabled = R.at === 0;
    $('replay-next').disabled = R.at === R.line.length;
  }
  function stepReplay(by) {
    var R = S.replay;
    if (!R) return;
    var at = Math.max(0, Math.min(R.line.length, R.at + by));
    if (at === R.at) return;
    R.at = at;
    renderReplay();
    if (by > 0) drop.apply(null, lastCell(S.puzzle.moves + R.line.slice(0, at).join('')));
    $('live').textContent = $('replay-text').textContent;
  }

  function renderResults(justFinished) {
    var box = $('results'), d = S.result;
    box.hidden = false;
    box.textContent = '';
    var title = d.solved ? (d.used === 1 ? 'Solved on the first try' : 'Solved on try ' + d.used) : 'Not solved today';
    box.appendChild(el('div', { class: 'score-head' }, [
      el('div', { class: 'score ' + (d.solved ? 'solved' : 'missed'), 'aria-hidden': 'true', text: d.solved ? '✓' : '✕' }),
      el('div', {}, [
        el('h2', { class: 'score-title', text: title }),
        el('p', { class: 'score-sub', text: 'Win in ' + S.puzzle.n + ' · puzzle #' + S.day }),
        el('ol', { class: 'squares', 'aria-label': 'Your tries' }, d.tries.map(function (t, i) {
          var ok = t.outcome === 'solved';
          return el('li', { class: ok ? 'solved' : 'missed', 'aria-label': 'Try ' + (i + 1) + ': ' + (ok ? 'solved' : 'missed') }, [
            el('span', { 'aria-hidden': 'true', text: ok ? '✓' : '✕' }),
          ]);
        })),
      ]),
    ]));
    box.appendChild(el('div', { class: 'actions' }, [
      el('button', { class: 'primary', type: 'button', id: 'share-btn', text: 'Share result', onclick: share }),
      el('button', { class: 'secondary', type: 'button', text: 'Stats', onclick: openStats }),
    ]));
    box.appendChild(el('pre', { class: 'share-text', id: 'share-text', hidden: true }));
    if (S.persist && store.stats.streak >= 2 && store.stats.lastDay === S.day) {
      box.appendChild(el('p', { class: 'streak', text: '🔥 ' + store.stats.streak + ' days in a row' }));
    }
    box.appendChild(el('p', { class: 'next', id: 'next' }));
    tick();
    if (justFinished) {
      $('live').textContent = title + '. ' + $('replay-text').textContent;
      $('share-btn').focus({ preventScroll: true });
      if (!reduced()) box.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  }

  // ---- sharing

  function share() {
    var text = F.shareText(S.day, S.result, SITE_URL);
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

  // ---- the clock: countdown to the next day, and moving on when it arrives

  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function tick() {
    if (!S.persist) {
      if ($('next')) $('next').textContent = 'Preview: use the arrows at the top to try another day.';
      return;
    }
    var newDay = today() !== S.day;
    // A day nobody has touched moves on by itself. One in progress can be finished first.
    if (newDay && !S.moves.length && !S.busy) { startGame(today(), true); return; }
    var box = $('next');
    if (!box || !S.result.over || $('results').hidden) return;
    if (newDay) {
      if (box.getAttribute('data-ready')) return;
      box.setAttribute('data-ready', '1');
      box.textContent = 'A new puzzle is ready. ';
      box.appendChild(el('button', { class: 'chip-btn', type: 'button', text: 'Play', onclick: function () { startGame(today(), true); } }));
      return;
    }
    var s = Math.floor(F.msUntilTomorrow() / 1000);
    box.textContent = 'Next puzzle in ';
    box.appendChild(el('b', { text: pad(Math.floor(s / 3600)) + ':' + pad(Math.floor(s / 60) % 60) + ':' + pad(s % 60) }));
  }

  // ---- stats

  function openStats() {
    var st = store.stats, body = $('stats-body');
    var most = Math.max.apply(null, st.dist.concat([1]));
    var todayTry = S.persist && S.result.solved && st.lastDay === S.day ? S.result.used : 0;
    body.textContent = '';
    body.appendChild(el('div', { class: 'nums' }, [
      num(st.played, 'Played'),
      num(st.played ? Math.round(st.solved / st.played * 100) : 0, 'Solved %'),
      num(st.lastDay >= today() - 1 ? st.streak : 0, 'Day streak'),
      num(st.best, 'Best streak'),
    ]));
    body.appendChild(el('h3', { text: 'Solved on' }));
    body.appendChild(el('ol', { class: 'hist' }, st.dist.map(function (n, i) {
      return el('li', { 'aria-label': 'Try ' + (i + 1) + ': ' + plural(n, 'time', 'times') }, [
        el('span', { 'aria-hidden': 'true', text: 'Try ' + (i + 1) }),
        el('span', { class: 'hist-bar' + (todayTry === i + 1 ? ' today' : ''), 'aria-hidden': 'true', style: 'width:' + Math.max(8, Math.round(n / most * 100)) + '%', text: String(n) }),
      ]);
    })));
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
  function dialogOpen() { return !!document.querySelector('dialog[open]'); }
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

  // A tap on a column, or on the space above it, drops a disc there.
  rack.addEventListener('click', function (e) {
    var b = e.target.closest && e.target.closest('.col, .slot');
    if (b) onColumn(Number(b.getAttribute('data-col')));
  });
  // The ghost disc follows a mouse or pen; a finger just taps.
  rack.addEventListener('pointermove', function (e) {
    if (e.pointerType === 'touch') return;
    var b = e.target.closest && e.target.closest('.col, .slot');
    ghost(b ? Number(b.getAttribute('data-col')) : -1);
  });
  rack.addEventListener('pointerleave', function () {
    ghost(board.contains(document.activeElement) && keyboardUsed ? S.focusCol : -1);
  });
  // The column the keyboard is on shows the ghost too.
  var keyboardUsed = false;
  board.addEventListener('focusin', function () { if (keyboardUsed) ghost(S.focusCol); });
  board.addEventListener('focusout', function (e) { if (!board.contains(e.relatedTarget)) ghost(-1); });
  document.addEventListener('keydown', function () { keyboardUsed = true; }, true);
  document.addEventListener('pointerdown', function () { keyboardUsed = false; }, true);
  // Left and right arrows move along the columns, Home and End jump to the ends; Enter or
  // Space on a column drops the disc (it is a button).
  board.addEventListener('keydown', function (e) {
    if (e.altKey || e.ctrlKey || e.metaKey) return;
    var to = { ArrowLeft: S.focusCol - 1, ArrowRight: S.focusCol + 1, Home: 0, End: F.WIDTH - 1 }[e.key];
    if (to === undefined) return;
    e.preventDefault();
    to = Math.max(0, Math.min(F.WIDTH - 1, to));
    setFocusCol(to);
    cols[to].focus();
    ghost(to);
  });
  // With nothing in particular focused, the arrow keys go to the board.
  document.addEventListener('keydown', function (e) {
    if (dialogOpen() || e.altKey || e.ctrlKey || e.metaKey || S.result.over) return;
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    var t = e.target;
    if (t !== document.body && t !== root) return;
    e.preventDefault();
    cols[S.focusCol].focus();
  });
  // A held Enter or Space key repeats, and the board is ready again after Red's reply, so each
  // repeat would drop another disc. Only the first press of a key counts.
  document.addEventListener('keydown', function (e) {
    if (!e.repeat || (e.key !== 'Enter' && e.key !== ' ')) return;
    if (e.target.closest && e.target.closest('button')) e.preventDefault();
  }, true);
  $('replay-back').addEventListener('click', function () { stepReplay(-1); });
  $('replay-next').addEventListener('click', function () { stepReplay(1); });
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
  $('prev-day').addEventListener('click', function () { if (S.day > 1 && !S.busy) startGame(S.day - 1, false); });
  $('next-day').addEventListener('click', function () { if (!S.busy) startGame(S.day + 1, false); });
  // Another tab saved something: take its copy, and redraw if it has played this day further
  // than this tab, or as far but differently.
  window.addEventListener('storage', function (e) {
    if (e.key !== STORE_KEY || writeFailed) return;
    var fresh = readStore();
    if (!fresh) return;
    store = fresh;
    applyContrast();
    if (!S.persist || S.busy) return;
    var theirs = store.game;
    if (theirs && theirs.day > S.day) {
      if (!S.moves.length || S.result.over) startGame(today(), true);
    } else if (theirs && theirs.day === S.day) {
      if (savedIsNewer()) startGame(S.day, true);
    } else if (S.moves.length) {
      // Their copy has no trace of this tab's day (it was on an earlier one): put ours back.
      snapshot();
    }
  });
  document.addEventListener('visibilitychange', function () { if (!document.hidden) tick(); });
  setInterval(tick, 1000);

  applyContrast();
  startGame(forcedDay > 0 ? forcedDay : today(), !PREVIEW);
})();
