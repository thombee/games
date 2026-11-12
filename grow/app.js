/*
 * Grow page. Draws the garden and slides its plants, takes swipes, arrow keys and the
 * arrow buttons, shows the card between rounds and the result at the end, and keeps the
 * player's progress in localStorage. The rules (sliding, merging, spawns, scoring, stats,
 * share text) are in logic.js.
 */
(function () {
  'use strict';

  var G = window.Grow;

  // The address added to shared results. Empty until the game has a home.
  var SITE_URL = 'https://thombee.github.io/games/grow/';
  var STORE_KEY = 'grow:v1';
  // How long a plant takes to slide, in ms; shorter while more swipes are waiting.
  var GLIDE = 100;
  var GLIDE_QUEUED = 45;
  // How far a finger or mouse must travel, in px, for a swipe. It counts as soon as it has
  // gone this far, without waiting for the finger to lift.
  var SWIPE_MIN = 18;
  // From this stage up, a new best plant in a round gets a flourish.
  var FLOURISH = 4;
  // The pause between the last move of a round and its card, so the last merge is seen.
  var END_PAUSE = 500;

  var root = document.documentElement;
  // The preview build (dist/grow-preview.html) plays any day with ?day=N.
  var PREVIEW_BUILD = root.hasAttribute('data-preview');
  var forcedDay = parseInt(new URLSearchParams(location.search).get('day'), 10);
  // The normal page takes ?day=N only for a day before today, so today's garden cannot be
  // rehearsed there before it is played; today and later days are for the preview build.
  if (!PREVIEW_BUILD && !(forcedDay < today())) forcedDay = NaN;
  // Preview mode plays a day with as many rounds as you like, and saves nothing. It is on
  // for preview builds and for ?day=N.
  var PREVIEW = PREVIEW_BUILD || forcedDay > 0;
  var TOUCH = window.matchMedia('(pointer: coarse)').matches;
  var STAGES = G.STAGES;

  function $(id) { return document.getElementById(id); }
  // Whether the player asks for less motion, asked afresh each time something is about to move.
  function reducedMotion() { return window.matchMedia('(prefers-reduced-motion: reduce)').matches; }

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
  function plural(name) { return name + 's'; }
  function a(name) { return (/^[aeiou]/.test(name) ? 'an ' : 'a ') + name; }
  function plant(level) { return STAGES[level].emoji + ' ' + STAGES[level].name; }

  // ---- saved progress

  function emptyStore() { return { v: 1, stats: G.emptyStats(), game: null, contrast: false, pad: false }; }
  function cleanBoard(b) {
    if (!Array.isArray(b) || b.length !== G.CELLS) return null;
    return b.every(function (v) { return Number.isInteger(v) && v >= 0 && v <= G.TOP; }) ? b.slice() : null;
  }
  // A day's rounds as saved, keeping only well-formed ones. A round whose board, score or
  // best plant is damaged is rebuilt from its moves.
  function cleanRounds(list, day) {
    if (!Array.isArray(list)) return [];
    var seen = {}, out = [];
    list.forEach(function (r) {
      if (out.length >= G.ROUNDS || !r || typeof r.id !== 'string' || !r.id || r.id.length > 40 || seen[r.id]) return;
      if (typeof r.moves !== 'string' || r.moves.length > G.MOVES || !/^[LRUD]*$/.test(r.moves)) return;
      seen[r.id] = true;
      var c = { id: r.id, moves: r.moves, board: cleanBoard(r.board), score: r.score, top: r.top, done: r.done === true };
      if (!c.board || !Number.isInteger(c.score) || c.score < 0 || !Number.isInteger(c.top) || c.top < 0 || c.top > G.TOP) {
        var p = G.replay(day, r.moves);
        c.moves = p.moves;
        c.board = p.board;
        c.score = p.score;
        c.top = p.top;
      }
      out.push(c);
    });
    return out;
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
      ['played', 'total', 'streak', 'bestStreak', 'best', 'lastDay'].forEach(function (k) {
        if (Number.isFinite(st[k]) && st[k] >= 0) s.stats[k] = Math.floor(st[k]);
      });
      if (Array.isArray(st.plants) && st.plants.length === s.stats.plants.length) {
        s.stats.plants = st.plants.map(function (n) { return Number.isFinite(n) && n >= 0 ? Math.floor(n) : 0; });
      }
      if (st.days && typeof st.days === 'object') {
        Object.keys(st.days).forEach(function (k) {
          var f = st.days[k];
          if (/^[1-9]\d*$/.test(k) && f && Number.isInteger(f.score) && f.score >= 0 && Number.isInteger(f.top) && f.top >= 0 && f.top <= G.TOP) {
            s.stats.days[k] = { score: f.score, top: f.top };
          }
        });
      }
      var g = d.game;
      if (g && Number.isInteger(g.day) && g.day > 0) s.game = { day: g.day, rounds: cleanRounds(g.rounds, g.day), done: g.done === true };
      s.contrast = d.contrast === true;
      s.pad = d.pad === true;
    } catch (e) { /* corrupt: start clean */ }
    return s;
  }
  // After a write has failed, what is in memory is the truth: reads no longer replace it.
  var memoryIsTruth = false;
  // Write the store. Returns whether it was written.
  function save() {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(store)); return true; } catch (e) { memoryIsTruth = true; cannotSave(); return false; }
  }
  // Take what is saved (another tab may have written since), unless a write has failed.
  function reread() {
    if (memoryIsTruth) return;
    var fresh = readStore();
    if (fresh) store = fresh;
  }
  // Shown once, under the game, when the browser will not keep the player's progress.
  function cannotSave() {
    var note = $('storage-note');
    if (PREVIEW || !note.hidden) return;
    note.hidden = false;
    $('live').textContent = note.textContent;
  }
  var store = readStore();
  if (!store) { store = emptyStore(); memoryIsTruth = true; cannotSave(); }

  function played(rounds) { return rounds.some(function (r) { return r.moves.length > 0; }); }
  function recordDay(s, day, rounds) {
    var b = G.best(rounds);
    s.stats = G.recordResult(s.stats, day, b.score, b.top);
  }
  function roundOverOn(r) { return r.moves.length >= G.MOVES || !G.canMove(r.board); }

  // A saved day as it stands now: a round with no moves left is finished, a day with all its
  // rounds finished is done, and a done or past day that was played goes into the stats
  // (counted once; its figures there only ever improve).
  function settle(s, day) {
    var g = s.game;
    if (!g) return false;
    var changed = false, stats = s.stats;
    g.rounds.forEach(function (r) { if (!r.done && roundOverOn(r)) { r.done = true; changed = true; } });
    if (!g.done && g.rounds.length >= G.ROUNDS && g.rounds.every(function (r) { return r.done; })) { g.done = true; changed = true; }
    if ((g.done || g.day < day) && played(g.rounds)) recordDay(s, g.day, g.rounds);
    return changed || s.stats !== stats;
  }

  // ---- the current day

  /*
   * S: day, persist (false in preview), rounds (the day's rounds as saved: { id, moves,
   * board, score, top, done }), done (the day is over), phase ('play', 'ending' while the
   * last move of a round settles, 'between' rounds, 'done'), round (the round on screen, as
   * in logic.js), id (its id, or null until its first move), tiles (the plant element in each
   * cell), busy (a move is animating), queue (swipes waiting for it), timer.
   */
  var S = null;

  function today() { return Math.max(1, G.dayNumber()); }
  // Whether preview mode may show this day: any day in the preview build, else only past days.
  function canPreview(day) { return day >= 1 && (PREVIEW_BUILD || day < today()); }
  function roundsLeft() { return PREVIEW ? Infinity : G.ROUNDS - S.rounds.length; }
  function entry() { return S.rounds.filter(function (r) { return r.id === S.id; })[0]; }
  function untouched() { return !S.rounds.length && S.phase === 'play' && !S.round.moves.length && !S.busy; }

  function stopAnimation() {
    if (S) {
      clearTimeout(S.timer);
      S.queue = [];
      S.busy = false;
    }
    $('bed').removeAttribute('data-busy');
  }
  // The garden carries data-busy while a move is animating, swipes wait, or a round is ending.
  function markBusy() {
    if (S.busy || S.queue.length || S.phase === 'ending') $('bed').setAttribute('data-busy', '');
    else $('bed').removeAttribute('data-busy');
  }

  function startGame(day, persist) {
    stopAnimation();
    S = { day: day, persist: persist, rounds: [], done: false, phase: 'play', round: null, id: null, tiles: [], busy: false, queue: [], timer: 0 };
    if (persist && store.game && store.game.day === day) {
      S.rounds = store.game.rounds.map(G.copyRound);
      S.done = store.game.done;
    }
    $('day-tag').textContent = '#' + day;
    $('preview-bar').hidden = !PREVIEW;
    $('preview-day').textContent = 'Day ' + day;
    $('next-day').disabled = !canPreview(day + 1);
    var last = S.rounds[S.rounds.length - 1];
    if (last && !last.done && roundOverOn(last)) last.done = true;
    if (!PREVIEW && S.rounds.length >= G.ROUNDS && last.done) S.done = true;
    if (S.done) showResults(false);
    else if (last && !last.done) resumeRound(last);
    else if (last) showBetween(last, false);
    else newRound();
  }

  // A fresh round. It is saved from its first move.
  function newRound() {
    S.round = G.newRound(S.day);
    S.id = null;
    showPlay();
    drawBoard('spawn');
  }
  function resumeRound(e) {
    S.round = { day: S.day, board: e.board.slice(), score: e.score, top: e.top, moves: e.moves, over: false };
    S.id = e.id;
    showPlay();
    drawBoard('');
  }
  function showPlay() {
    S.phase = 'play';
    $('play').hidden = false;
    $('results').hidden = true;
    $('between').hidden = true;
    $('bed').classList.remove('carded');
    var first = !S.rounds.length && !S.round.moves.length;
    $('hint').hidden = !first;
    $('hint').textContent = (TOUCH ? 'Swipe' : 'Swipe or press an arrow key') + ' to slide everything. Matching plants merge and grow.';
    updateHud();
  }

  /*
   * Write this tab's day into the store, merged with what another tab has saved: the saved
   * rounds keep their places, and a round of this tab's that no longer fits (another tab
   * has taken the last round meanwhile) is dropped. A store already on a later day keeps
   * that day's progress, and this day's figures still go into the stats. After writing it
   * reads the store back, in case another tab without Web Locks wrote at the same moment.
   * Returns false if this tab's round gave way to another tab's; the saved day is then on
   * screen instead.
   */
  function commit() {
    if (!S.persist) return true;
    reread();
    var theirs = store.game, later = !!theirs && theirs.day > S.day;
    if (theirs && theirs.day === S.day) {
      S.rounds = G.mergeRounds(theirs.rounds, S.rounds);
      S.done = S.done || theirs.done;
    }
    if (!later) {
      if (theirs && theirs.day < S.day) settle(store, S.day);
      store.game = { day: S.day, rounds: S.rounds.map(G.copyRound), done: S.done };
    }
    if (played(S.rounds) && (S.done || later)) recordDay(store, S.day, S.rounds);
    if (save() && !later) {
      reread();
      var now = store.game;
      if (now && now.day === S.day && S.id && !now.rounds.some(function (r) { return r.id === S.id; })) {
        S.rounds = G.mergeRounds(now.rounds, S.rounds);
        if (entry()) {
          // The round still fits: put it back.
          store.game = { day: S.day, rounds: S.rounds.map(G.copyRound), done: S.done || now.done };
          save();
        }
      }
    }
    if (S.id && !entry()) {
      startGame(S.day, true);
      $('live').textContent = 'Another tab started this round first. Carry on from there.';
      return false;
    }
    return true;
  }

  /*
   * Run fn holding the browser's lock on the saved progress (Web Locks), so that reading,
   * checking and writing it is one step no other tab can come between. Where the browser
   * has no Web Locks, or refuses them (some do for file:// pages), fn runs straight away and
   * commit() reads its write back instead.
   */
  function guarded(fn) {
    var ran = false;
    var run = function () { ran = true; fn(); };
    var locks = S.persist && navigator.locks;
    if (!locks || !locks.request) { run(); return; }
    try {
      locks.request(STORE_KEY, run).catch(function (err) {
        if (!ran) run();
        else setTimeout(function () { throw err; }, 0);
      });
    } catch (e) {
      if (!ran) run();
    }
  }

  function sameRounds(x, y) {
    return x.length === y.length && x.every(function (r, i) { return r.id === y[i].id && r.moves === y[i].moves && r.done === y[i].done; });
  }

  /*
   * Before a move: if another tab has played this day further (this round further, a round
   * this tab has not seen, or the day finished), take its progress and redraw instead of
   * making the move. Returns false when it did that.
   */
  function catchUp() {
    reread();
    var theirs = store.game;
    if (!theirs || theirs.day !== S.day) return true;
    var known = {};
    S.rounds.forEach(function (r) { known[r.id] = true; });
    var mine = S.id && theirs.rounds.filter(function (r) { return r.id === S.id; })[0];
    var behind = theirs.done ||
      theirs.rounds.some(function (r) { return !known[r.id]; }) ||
      (!S.id && theirs.rounds.length >= G.ROUNDS) ||
      (mine && (mine.done || (mine.moves !== S.round.moves && mine.moves.length >= S.round.moves.length)));
    if (!behind) return true;
    store.game = { day: S.day, rounds: G.mergeRounds(theirs.rounds, S.rounds), done: theirs.done || S.done };
    startGame(S.day, true);
    $('live').textContent = 'Updated with your moves from another tab.';
    return false;
  }

  // ---- making a move

  // A swipe joins the queue of moves to make.
  function request(dir) {
    if (!S || S.phase !== 'play') return;
    S.queue.push(dir);
    nextMove();
  }

  /*
   * Make the next move in the queue, one at a time: a move waits while the one before it
   * animates, while this tab waits for the lock on the saved progress, and while a dialog
   * is open (the queue carries on when it closes).
   */
  function nextMove() {
    if (!S) return;
    if (!S.busy && S.phase === 'play' && S.queue.length && !dialogOpen()) {
      var dir = S.queue.shift(), game = S;
      S.busy = true;
      guarded(function () {
        // The garden was redrawn (from another tab, or for a new day) while the move waited.
        if (S !== game || S.phase !== 'play') return;
        S.busy = false;
        play(dir);
        markBusy();
      });
    }
    markBusy();
  }

  function play(dir) {
    if (S.persist && !catchUp()) return;
    var res = G.move(S.round, dir);
    if (!res) { nothingMoved(dir); nextMove(); return; }
    var r = S.round;
    if (!S.id) {
      S.id = Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
      S.rounds.push({ id: S.id, moves: '', board: [], score: 0, top: 0, done: false });
    }
    var e = entry();
    e.moves = r.moves;
    e.board = r.board.slice();
    e.score = r.score;
    e.top = r.top;
    e.done = r.over;
    if (r.over && !PREVIEW && S.rounds.length >= G.ROUNDS) S.done = true;
    if (!commit()) return;
    animate(res);
  }

  // A swipe that moves nothing: the bed gives a little nudge that way, and it does not count.
  function nothingMoved(dir) {
    $('live').textContent = 'Nothing can slide ' + G.DIR_NAMES[dir] + '. That swipe does not count.';
    if (reducedMotion()) return;
    var bed = $('bed'), d = { L: [-5, 0], R: [5, 0], U: [0, -5], D: [0, 5] }[dir];
    bed.style.setProperty('--nx', d[0] + 'px');
    bed.style.setProperty('--ny', d[1] + 'px');
    bed.classList.remove('nudge');
    void bed.offsetWidth;
    bed.classList.add('nudge');
  }

  // ---- drawing the garden

  function place(t, cell, glide) {
    t.style.setProperty('--gr-glide', glide + 'ms');
    t.style.setProperty('--c', cell % G.SIZE);
    t.style.setProperty('--r', Math.floor(cell / G.SIZE));
    t.setAttribute('data-cell', cell);
  }
  function makeTile(level, cell, cls) {
    var t = el('div', { class: 'tile lv' + level + (cls ? ' ' + cls : ''), 'data-level': level }, [
      el('div', { class: 'tile-in' }, [
        el('span', { class: 't-emoji', text: STAGES[level].emoji }),
        el('span', { class: 't-name', text: STAGES[level].name }),
      ]),
    ]);
    place(t, cell, 0);
    $('tiles').appendChild(t);
    return t;
  }
  // Draw the round's garden afresh, each plant with the class `cls` ('spawn' fades them in).
  function drawBoard(cls) {
    var box = $('tiles');
    box.textContent = '';
    S.tiles = [];
    var anim = cls && !reducedMotion() ? cls : '';
    S.round.board.forEach(function (level, cell) { S.tiles[cell] = level ? makeTile(level, cell, anim) : null; });
    updateGrid();
  }

  // Slide the plants as a move says, then grow the merged ones and bring up the new one.
  function animate(res) {
    var reduced = reducedMotion();
    var glide = reduced ? 0 : S.queue.length ? GLIDE_QUEUED : GLIDE;
    S.busy = true;
    $('hint').hidden = true;
    var merged = {}, next = [], gone = [];
    res.merges.forEach(function (m) { merged[m.cell] = m.level; });
    res.paths.forEach(function (p) {
      var t = S.tiles[p.from];
      if (!t) return;
      place(t, p.to, glide);
      if (merged[p.to] !== undefined) { gone.push(t); t.classList.add('gone'); } else next[p.to] = t;
    });
    S.tiles = next;
    var finish = function () {
      S.timer = 0;
      gone.forEach(function (t) { t.remove(); });
      var top = S.round.top, grew = res.newTop && top >= FLOURISH;
      res.merges.forEach(function (m) {
        var cls = reduced ? '' : grew && m.level === top ? 'flourish' : 'pop';
        next[m.cell] = makeTile(m.level, m.cell, cls);
      });
      if (res.spawn) next[res.spawn.cell] = makeTile(res.spawn.level, res.spawn.cell, reduced ? '' : 'spawn');
      updateHud();
      updateGrid();
      floatPoints(res.points + (res.tidy ? res.tidy.points : 0));
      if (grew) newBestPlant(top);
      announce(res, grew);
      S.busy = false;
      if (S.round.over) {
        S.queue = [];
        S.phase = 'ending';
        S.timer = setTimeout(roundOver, reduced ? 0 : END_PAUSE);
        markBusy();
        return;
      }
      nextMove();
    };
    if (glide) S.timer = setTimeout(finish, glide); else finish();
  }

  // "+16" rising from the score. A new one replaces any still rising.
  function floatPoints(n) {
    var box = $('floats');
    box.textContent = '';
    if (!n || reducedMotion()) return;
    var f = el('span', { class: 'float', text: '+' + G.grouped(n) });
    box.appendChild(f);
    setTimeout(function () { f.remove(); }, 850);
  }
  function hideBanner() {
    clearTimeout(bannerTimer);
    $('banner').classList.remove('show');
  }

  // A new best plant this round: a banner over the garden (the plant itself glows).
  var bannerTimer = 0;
  function newBestPlant(level) {
    var others = S.rounds.filter(function (r) { return r.id !== S.id; });
    var beat = others.length > 0 && level > G.best(others).top, b = $('banner');
    b.textContent = beat ? 'Best today: ' + plant(level) + '!' : 'You grew ' + a(STAGES[level].name) + ' ' + STAGES[level].emoji;
    b.classList.add('show');
    clearTimeout(bannerTimer);
    bannerTimer = setTimeout(function () { b.classList.remove('show'); }, 1600);
  }

  // What a move did, for screen readers.
  function announce(res, grew) {
    var parts = [G.DIR_NAMES[res.dir].charAt(0).toUpperCase() + G.DIR_NAMES[res.dir].slice(1) + '.'];
    var byLevel = {};
    res.merges.forEach(function (m) { byLevel[m.level] = (byLevel[m.level] || 0) + 1; });
    Object.keys(byLevel).forEach(function (lv) {
      var n = byLevel[lv], from = STAGES[lv - 1].name, to = STAGES[lv].name;
      parts.push(n === 1 ? 'Two ' + plural(from) + ' merged into ' + a(to) + '.' : n + ' pairs of ' + plural(from) + ' merged into ' + plural(to) + '.');
    });
    if (res.points) parts.push('Plus ' + res.points + ', score ' + S.round.score + '.');
    if (grew) parts.push('Your best plant this round is now ' + a(STAGES[S.round.top].name) + '.');
    if (res.spawn) parts.push(cap(a(STAGES[res.spawn.level].name)) + ' came up in row ' + (Math.floor(res.spawn.cell / G.SIZE) + 1) + ', column ' + (res.spawn.cell % G.SIZE + 1) + '.');
    var left = G.movesLeft(S.round);
    parts.push(res.over ? (left ? 'The bed is full. Round over.' : 'No moves left. Round over.') : left + (left === 1 ? ' move left.' : ' moves left.'));
    if (res.tidy && res.tidy.points) parts.push(tidyText(res.tidy) + '.');
    $('live').textContent = parts.join(' ');
  }
  function cap(s) { return s.charAt(0).toUpperCase() + s.slice(1); }
  // "9 empty squares: +180", the bonus for a tidy garden at the end of a round.
  function tidyText(t) { return t.empty + (t.empty === 1 ? ' empty square' : ' empty squares') + ': +' + G.grouped(t.points); }
  // The tidy bonus a finished round earned, or null if it earned none.
  function tidyOf(e) {
    var t = roundOverOn(e) ? G.tidyBonus(e.board) : null;
    return t && t.points ? t : null;
  }

  function updateHud() {
    var r = S.round, left = G.movesLeft(r);
    $('score').textContent = G.grouped(r.score);
    $('moves-left').textContent = left + (left === 1 ? ' move left' : ' moves left');
    $('moves-fill').style.width = (left / G.MOVES * 100).toFixed(2) + '%';
    $('moves').classList.toggle('low', left <= 10);
    $('moves').setAttribute('aria-label', left + ' of ' + G.MOVES + ' moves left');
    var n = S.id ? S.rounds.map(function (x) { return x.id; }).indexOf(S.id) + 1 : S.rounds.length + 1;
    if (S.phase === 'between' || S.phase === 'done') n = Math.max(1, S.rounds.length);
    $('round-no').textContent = PREVIEW ? 'Round ' + n : 'Round ' + Math.min(n, G.ROUNDS) + ' of ' + G.ROUNDS;
    var bed = $('bed');
    bed.setAttribute('data-moves', r.moves.length);
    bed.setAttribute('data-score', r.score);
    Array.prototype.forEach.call($('ladder').children, function (li, i) {
      li.classList.toggle('got', i + 1 <= r.top);
      li.classList.toggle('top', i + 1 === r.top);
    });
    $('ladder-text').textContent = r.top ? 'Best plant this round: ' + STAGES[r.top].name + '.' : '';
  }

  // The garden as a grid for screen readers: each cell says what grows there.
  function buildGrid() {
    var grid = $('grid');
    for (var i = 0; i < G.SIZE; i++) {
      var row = el('div', { class: 'row', role: 'row' });
      for (var j = 0; j < G.SIZE; j++) row.appendChild(el('div', { class: 'cell', role: 'gridcell' }, [el('span', { class: 'sr-only' })]));
      grid.appendChild(row);
    }
  }
  function updateGrid() {
    var spans = $('grid').querySelectorAll('.cell span');
    S.round.board.forEach(function (level, i) { spans[i].textContent = level ? STAGES[level].name : 'empty'; });
  }

  // ---- between rounds

  function roundOver() {
    S.timer = 0;
    $('bed').removeAttribute('data-busy');
    var e = entry();
    if (S.done) showResults(true, e);
    else showBetween(e, true);
  }

  // The card after a round: its score, best plant and tidy bonus, the best so far, that each
  // round is the same garden, and another go or stop.
  function showBetween(e, fresh) {
    S.phase = 'between';
    S.id = e.id;
    if (!fresh) {
      S.round = { day: S.day, board: e.board.slice(), score: e.score, top: e.top, moves: e.moves, over: true };
      drawBoard('');
    }
    $('play').hidden = false;
    $('results').hidden = true;
    $('hint').hidden = true;
    var number = S.rounds.indexOf(e) + 1, left = roundsLeft();
    var others = S.rounds.filter(function (r) { return r.id !== e.id; });
    var newBest = others.length > 0 && e.score > G.best(others).score, best = G.best(S.rounds).score;
    var full = e.moves.length < G.MOVES;
    $('b-what').textContent = (fresh && full ? 'The bed is full! ' : '') + 'Round ' + number + (PREVIEW ? '' : ' of ' + G.ROUNDS);
    $('b-score').textContent = G.grouped(e.score);
    $('b-plant').textContent = 'Best plant: ' + plant(Math.max(1, e.top));
    var tidy = tidyOf(e);
    $('b-tidy').hidden = !tidy;
    $('b-tidy').textContent = tidy ? tidyText(tidy) : '';
    $('b-best').textContent = newBest ? 'A new best!' : others.length ? 'Best so far: ' + G.grouped(best) : 'Your best round counts.';
    $('again-btn').textContent = left === Infinity ? 'Go again' : 'Go again · ' + left + ' left';
    $('between').hidden = false;
    $('bed').classList.add('carded');
    hideBanner();
    updateHud();
    $('live').textContent = (fresh ? 'Round over. ' : '') + 'Round ' + number + ': ' + e.score + ' points, best plant ' + a(STAGES[Math.max(1, e.top)].name) +
      '. Best so far ' + best + '. ' + (left === Infinity ? '' : left + (left === 1 ? ' round left.' : ' rounds left.'));
    $('again-btn').focus({ preventScroll: true });
  }

  function goAgain() {
    if (S.phase !== 'between') return;
    if (S.persist) {
      reread();
      // If the store has moved on to a later day, this tab is finishing an earlier one: it
      // goes on from what it has in memory, and commit() leaves the later day alone.
      var theirs = store.game;
      if (theirs && theirs.day === S.day) {
        S.rounds = G.mergeRounds(theirs.rounds, S.rounds);
        S.done = S.done || theirs.done;
      }
      // Another tab has used up the day, or has a round going, meanwhile.
      if (S.done || S.rounds.length >= G.ROUNDS || S.rounds.some(function (r) { return !r.done; })) {
        if (theirs && theirs.day === S.day) store.game = { day: S.day, rounds: S.rounds.map(G.copyRound), done: S.done };
        startGame(S.day, true);
        return;
      }
    }
    newRound();
    $('bed').focus({ preventScroll: true });
  }

  // ---- the result card

  // The result of the day. `ended`, the round that has just finished the day, gets its tidy
  // bonus shown.
  function showResults(justFinished, ended) {
    stopAnimation();
    hideBanner();
    S.phase = 'done';
    S.done = true;
    var b = G.best(S.rounds), top = Math.max(1, b.top), box = $('results');
    $('play').hidden = true;
    box.hidden = false;
    box.textContent = '';
    var nextStage = top < G.TOP ? STAGES[top + 1] : null;
    box.appendChild(el('div', { class: 'score-head' }, [
      el('span', { class: 'score-emoji', 'aria-hidden': 'true', text: STAGES[top].emoji }),
      el('div', {}, [
        el('div', { class: 'score', 'aria-label': 'Best score: ' + b.score }, [G.grouped(b.score)]),
        el('h2', { class: 'score-title', text: 'Best plant: ' + STAGES[top].name }),
        el('p', { class: 'score-sub', text: nextStage ? 'Next stage up: ' + nextStage.emoji + ' ' + nextStage.name + '.' : 'The whole way to a forest!' }),
      ]),
    ]));
    var tidy = ended && tidyOf(ended);
    if (tidy) box.appendChild(el('p', { class: 'tidy', text: 'Round ' + (S.rounds.indexOf(ended) + 1) + ' ended with ' + tidyText(tidy) }));
    box.appendChild(el('ol', { class: 'rounds', 'aria-label': 'Today’s rounds' }, S.rounds.map(function (r, i) {
      return el('li', { class: r.score === b.score ? 'top' : '' }, [
        el('span', { class: 'r-label', text: 'Round ' + (i + 1) }),
        el('span', { class: 'r-bar', 'aria-hidden': 'true' }, [el('i', { style: 'width:' + (b.score ? Math.max(3, r.score / b.score * 100) : 3).toFixed(1) + '%' })]),
        el('span', { class: 'r-score' }, [G.grouped(r.score) + ' ', el('span', { 'aria-label': ', best plant ' + STAGES[Math.max(1, r.top)].name, text: STAGES[Math.max(1, r.top)].emoji })]),
      ]);
    })));
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
    if (justFinished) {
      $('live').textContent = 'Day over. Best score ' + b.score + '. Best plant: ' + STAGES[top].name + '.';
      if (top >= 7) celebrate(STAGES[top].emoji);
      box.querySelector('.primary').focus({ preventScroll: true });
    }
  }

  // A short shower of leaves when the day's best plant is a palm or better.
  function celebrate(emoji) {
    if (reducedMotion()) return;
    var bits = [emoji, '🍃', '🌱', '🌿', emoji];
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
    var text = G.shareText(S.day, S.rounds, SITE_URL);
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
    if (!S) return;
    if (!S.persist) {
      if ($('next')) $('next').textContent = 'Preview: use the arrows at the top to try another day.';
      return;
    }
    var newDay = today() !== S.day;
    // A day nobody has started moves on by itself. One in progress can be finished first.
    if (newDay && untouched()) { startGame(today(), true); return; }
    var box = $('next');
    if (!box || S.phase !== 'done' || $('results').hidden) return;
    if (newDay) {
      if (box.getAttribute('data-ready')) return;
      box.setAttribute('data-ready', '1');
      box.textContent = 'A new garden is ready. ';
      box.appendChild(el('button', { class: 'chip-btn', type: 'button', text: 'Play', onclick: function () { startGame(today(), true); } }));
      return;
    }
    var s = Math.floor(G.msUntilTomorrow() / 1000);
    box.textContent = 'Tomorrow’s garden in ';
    box.appendChild(el('b', { text: pad(Math.floor(s / 3600)) + ':' + pad(Math.floor(s / 60) % 60) + ':' + pad(s % 60) }));
  }

  // ---- stats

  function openStats() {
    var st = store.stats, body = $('stats-body');
    var most = Math.max(1, st.played);
    body.textContent = '';
    body.appendChild(el('div', { class: 'nums' }, [
      num(st.played, 'Days played'),
      num(st.lastDay >= today() - 1 ? st.streak : 0, 'Day streak'),
      num(st.bestStreak, 'Best streak'),
      num(G.grouped(st.best), 'Best score'),
      num(G.grouped(st.played ? Math.round(st.total / st.played) : 0), 'Average best'),
    ]));
    body.appendChild(el('h3', { text: 'Best plant of the day' }));
    // The stages from the seedling to the tree, and any other that has been a day's best.
    var shown = STAGES.map(function (s, lv) { return lv; }).filter(function (lv) { return lv && ((lv >= 3 && lv <= 8) || st.plants[lv]); });
    body.appendChild(el('ol', { class: 'plants' }, shown.map(function (lv) {
      var n = st.plants[lv];
      return el('li', { 'aria-label': cap(STAGES[lv].name) + ': the best plant on ' + n + (n === 1 ? ' day' : ' days') }, [
        el('span', { 'aria-hidden': 'true', text: plant(lv) }),
        el('span', { class: 'p-bar', 'aria-hidden': 'true' }, [el('i', { style: 'width:' + Math.round(n / most * 100) + '%' })]),
        el('span', { class: 'p-n', 'aria-hidden': 'true', text: String(n) }),
      ]);
    })));
    if (PREVIEW) body.appendChild(el('p', { class: 'fine', text: 'This is a preview, so rounds here are not counted.' }));
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
    try { d.close(); } catch (e) { d.removeAttribute('open'); nextMove(); }
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
  function applySettings() {
    if (store.contrast) root.setAttribute('data-contrast', 'high'); else root.removeAttribute('data-contrast');
    $('contrast').checked = store.contrast;
    $('pad').classList.toggle('on', store.pad);
    $('pad-on').checked = store.pad;
  }
  function setting(key, value) {
    // Read the store again first, so this write carries what another tab has saved since.
    reread();
    store[key] = value;
    if (!PREVIEW) save();
    applySettings();
  }

  // ---- wiring

  // The stages, for the help and the row under the garden.
  var chain = $('chain');
  STAGES.forEach(function (s, lv) {
    if (!lv) return;
    if (lv > 1) chain.appendChild(el('i', { 'aria-hidden': 'true', text: '→' }));
    chain.appendChild(el('span', { title: s.name }, [el('span', { 'aria-hidden': 'true', text: s.emoji }), el('span', { class: 'sr-only', text: s.name + (lv < G.TOP ? ',' : '') })]));
    $('ladder').appendChild(el('li', { title: s.name, text: s.emoji }));
  });
  $('moves-tag').textContent = G.MOVES + ' moves.';
  $('help-moves').textContent = String(G.MOVES);
  $('help-tidy').textContent = String(G.TIDY);
  buildGrid();

  // A swipe anywhere on the garden. It counts as soon as the finger has travelled far
  // enough, and the rest of that touch is ignored. The card between rounds has its own buttons.
  var bed = $('bed'), swipe = null;
  function direction(dx, dy) { return Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'R' : 'L') : (dy > 0 ? 'D' : 'U'); }
  bed.addEventListener('pointerdown', function (e) {
    if (e.button > 0 || !e.isPrimary || (e.target.closest && e.target.closest('#between'))) return;
    e.preventDefault();
    // Keyboard players get a focus ring on the garden; a finger or mouse does not.
    bed.focus({ preventScroll: true, focusVisible: false });
    swipe = { id: e.pointerId, x: e.clientX, y: e.clientY, done: false };
    try { bed.setPointerCapture(e.pointerId); } catch (err) { /* the swipe still works while the finger stays on the garden */ }
  });
  bed.addEventListener('pointermove', function (e) {
    if (!swipe || swipe.done || e.pointerId !== swipe.id) return;
    var dx = e.clientX - swipe.x, dy = e.clientY - swipe.y;
    if (Math.max(Math.abs(dx), Math.abs(dy)) < SWIPE_MIN) return;
    swipe.done = true;
    request(direction(dx, dy));
  });
  function endSwipe(e) {
    if (!swipe || e.pointerId !== swipe.id) return;
    var dx = e.clientX - swipe.x, dy = e.clientY - swipe.y;
    // A short, quick flick that ended before reaching SWIPE_MIN still counts.
    if (!swipe.done && e.type === 'pointerup' && Math.max(Math.abs(dx), Math.abs(dy)) >= 10) request(direction(dx, dy));
    swipe = null;
  }
  bed.addEventListener('pointerup', endSwipe);
  bed.addEventListener('pointercancel', endSwipe);
  // No touch on the garden scrolls, zooms or refreshes the page.
  bed.addEventListener('touchmove', function (e) { if (!(e.target.closest && e.target.closest('#between'))) e.preventDefault(); }, { passive: false });
  bed.addEventListener('contextmenu', function (e) { e.preventDefault(); });

  // The arrow keys slide the plants. A held key repeats; only a fresh press moves.
  var KEYS = { ArrowLeft: 'L', ArrowRight: 'R', ArrowUp: 'U', ArrowDown: 'D', Left: 'L', Right: 'R', Up: 'U', Down: 'D' };
  document.addEventListener('keydown', function (e) {
    if (dialogOpen() || e.altKey || e.ctrlKey || e.metaKey || !S) return;
    var dir = KEYS[e.key];
    if (dir && (S.phase === 'play' || S.phase === 'ending')) {
      e.preventDefault();
      if (!e.repeat) request(dir);
      return;
    }
    // Focus moves to the card's buttons after a round, so a held Enter or Space could start
    // the next round by accident. Only a fresh press counts there.
    if (e.repeat && (e.key === 'Enter' || e.key === ' ') && e.target.closest && e.target.closest('#between, #results, #pad')) e.preventDefault();
  }, true);
  Array.prototype.forEach.call($('pad').querySelectorAll('button'), function (b) {
    b.addEventListener('click', function () { request(b.getAttribute('data-dir')); });
  });

  $('again-btn').addEventListener('click', goAgain);
  $('stop-btn').addEventListener('click', function () {
    if (S.phase !== 'between') return;
    var game = S;
    guarded(function () {
      if (S !== game || S.phase !== 'between') return;
      S.done = true;
      if (commit()) showResults(true);
    });
  });
  $('help-btn').addEventListener('click', function () { openDialog('help'); });
  $('stats-btn').addEventListener('click', openStats);
  Array.prototype.forEach.call(document.querySelectorAll('dialog'), function (d) {
    d.addEventListener('click', function (e) {
      if (e.target === d || (e.target.closest && e.target.closest('[data-close]'))) closeDialog(d);
    });
    // Moves held while the dialog was open carry on.
    d.addEventListener('close', nextMove);
  });
  $('contrast').addEventListener('change', function () { setting('contrast', $('contrast').checked); });
  $('pad-on').addEventListener('change', function () { setting('pad', $('pad-on').checked); });
  $('prev-day').addEventListener('click', function () { if (canPreview(S.day - 1)) startGame(S.day - 1, false); });
  $('next-day').addEventListener('click', function () { if (canPreview(S.day + 1)) startGame(S.day + 1, false); });

  // Another tab saved something: take its copy, and catch up with its moves if this tab is
  // not in the middle of one.
  window.addEventListener('storage', function (e) {
    if (e.key !== STORE_KEY || memoryIsTruth) return;
    var fresh = readStore();
    if (!fresh) return;
    store = fresh;
    applySettings();
    if (!S.persist || S.busy || S.phase === 'ending') return;
    var theirs = store.game;
    if (theirs && theirs.day > S.day) {
      if (S.phase === 'done' || untouched()) startGame(today(), true);
    } else if (theirs && theirs.day === S.day) {
      var merged = G.mergeRounds(theirs.rounds, S.rounds), done = theirs.done || S.done;
      // This tab knows more: put it back (unless its round gave way to theirs).
      if ((!sameRounds(merged, theirs.rounds) || done !== theirs.done) && !commit()) return;
      if (!sameRounds(merged, S.rounds) || done !== S.done) {
        store.game = { day: S.day, rounds: merged, done: done };
        startGame(S.day, true);
      }
    } else if (played(S.rounds)) {
      // Their copy has no trace of this tab's day (it was on an earlier one): put ours back.
      commit();
    }
  });
  document.addEventListener('visibilitychange', function () { if (!document.hidden) tick(); });
  setInterval(tick, 1000);

  applySettings();
  if (!PREVIEW && settle(store, today())) save();
  startGame(forcedDay > 0 ? forcedDay : today(), !PREVIEW);
})();
