/*
 * Plot page. Draws the seven rows of beds and the tray of vegetables, takes guesses, turns
 * each dug row over bed by bed, and shows the result card at the end. Progress (the guesses
 * dug and the guess being planted) is kept in localStorage. The rules (the day's planting,
 * marking, hard mode, share text, stats) are in logic.js.
 */
(function () {
  'use strict';

  var P = window.Plot;
  var VEG = P.VEG;

  // The address added to shared results. Empty until the game has a home.
  var SITE_URL = 'https://thombee.github.io/games/plot/';
  var STORE_KEY = 'plot:v1';

  var root = document.documentElement;
  var forcedDay = parseInt(new URLSearchParams(location.search).get('day'), 10);
  // Preview mode plays any day and saves nothing. It is on for ?day=N and for preview builds.
  var PREVIEW = root.hasAttribute('data-preview') || forcedDay > 0;
  // Whether the system asks for less motion. Asked each time something would move, so a
  // change to the setting while the page is open counts straight away.
  function reduced() { return window.matchMedia('(prefers-reduced-motion: reduce)').matches; }
  var TOUCH = window.matchMedia('(pointer: coarse)').matches;

  // A dug row turns over one bed after another: each bed takes TURN_MS, starting STAGGER_MS after the one before.
  var TURN_MS = 500, STAGGER_MS = 250;
  var MARK_TEXT = { right: '✓', elsewhere: '•', absent: '–' };
  var WIN_WORDS = ['First dig. Green thumbs!', 'Two digs. Remarkable!', 'Got it in three!', 'Got it in four!', 'Got it in five!', 'Got it in six!', 'Phew, on the last dig!'];
  var FIRST_HINT = 'Tap four vegetables, then Dig. Green: right bed. Yellow: planted elsewhere.';

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
  function names(code) { return code.map(function (v) { return VEG[v].name; }).join(', '); }

  // ---- saved progress

  function emptyStore() { return { v: 1, stats: P.emptyStats(), game: null, contrast: false, hard: false }; }
  function isVeg(x) { return Number.isInteger(x) && x >= 0 && x < VEG.length; }
  // The saved progress, or null if this browser will not let the page read localStorage.
  function readStore() {
    var raw;
    try { raw = localStorage.getItem(STORE_KEY); } catch (e) { return null; }
    var s = emptyStore();
    try {
      var d = JSON.parse(raw || 'null');
      if (!d || d.v !== 1) return s;
      var st = d.stats || {};
      ['played', 'won', 'streak', 'best', 'lastDay'].forEach(function (k) {
        if (Number.isFinite(st[k]) && st[k] >= 0) s.stats[k] = Math.floor(st[k]);
      });
      s.stats.won = Math.min(s.stats.won, s.stats.played);
      if (Array.isArray(st.dist) && st.dist.length === s.stats.dist.length) {
        s.stats.dist = st.dist.map(function (n) { return Number.isFinite(n) && n >= 0 ? Math.floor(n) : 0; });
      }
      var g = d.game;
      if (g && Number.isInteger(g.day) && g.day >= 1 && Array.isArray(g.guesses)) {
        var draft = Array.isArray(g.draft) && g.draft.length === P.BEDS && g.draft.every(function (v) { return v === null || isVeg(v); });
        s.game = {
          day: g.day,
          guesses: g.guesses.filter(function (x) { return Array.isArray(x) && x.length === P.BEDS && x.every(isVeg); }).slice(0, P.MAX_GUESSES),
          draft: draft ? g.draft.slice() : P.emptyDraft(),
          hard: g.hard === true,
        };
      }
      s.contrast = d.contrast === true;
      s.hard = d.hard === true;
    } catch (e) { /* corrupt: start clean */ }
    return s;
  }
  /*
   * Once a write has failed, what this tab holds in memory is the truth: storage is not read
   * again, because what it still has is older than this tab's progress.
   */
  var storageFailed = false;
  function save() {
    if (storageFailed) return;
    try { localStorage.setItem(STORE_KEY, JSON.stringify(store)); } catch (e) { storageFailed = true; cannotSave(); }
  }
  // The saved progress as another tab may have left it, or null if storage is not to be read.
  function reread() { return storageFailed ? null : readStore(); }
  // Shown once, under the game, when the browser will not keep the player's progress.
  function cannotSave() {
    var note = $('storage-note');
    if (PREVIEW || !note.hidden) return;
    note.hidden = false;
    $('live').textContent = note.textContent;
  }
  var store = readStore();
  if (!store) { store = emptyStore(); storageFailed = true; cannotSave(); }

  // ---- the current day's game

  /*
   * day, persist (false in preview), code (the four planted), guesses (each four vegetable
   * indices), draft (the guess being planted: four indices or nulls), hard (every guess so
   * far was dug in hard mode), busy (true while a dug row is turning over).
   */
  var S = null;
  var revealTimer = 0;

  function today() { return Math.max(1, P.dayNumber()); }

  function startGame(day, persist) {
    clearTimeout(revealTimer);
    S = { day: day, persist: persist, code: P.dailyCode(day), guesses: [], draft: P.emptyDraft(), hard: store.hard, busy: false };
    var saved = persist && store.game && store.game.day === day ? store.game : null;
    if (saved) {
      saved.guesses.some(function (g) {
        if (done()) return true;
        S.guesses.push(g.slice());
        return false;
      });
      if (S.guesses.length) S.hard = saved.hard;
      if (!done()) S.draft = saved.draft.slice();
    }
    $('day-tag').textContent = '#' + day;
    $('preview-bar').hidden = !PREVIEW;
    $('preview-day').textContent = 'Day ' + day;
    $('board').textContent = '';
    $('app').removeAttribute('data-busy');
    renderAll();
  }
  function status() { return P.status(S.guesses, S.code); }
  function done() { return status().done; }
  function untouched() { return !S.guesses.length && S.draft.every(function (v) { return v === null; }); }
  function gameNow() { return { day: S.day, guesses: S.guesses.map(function (g) { return g.slice(); }), draft: S.draft.slice(), hard: S.hard }; }
  function snapshot() {
    store.game = gameNow();
    save();
  }
  // True if the saved game is for this tab's day and is ahead of this tab or at odds with it.
  function savedIsNewer() {
    var theirs = store.game;
    if (!theirs || theirs.day !== S.day || theirs.guesses.length < S.guesses.length) return false;
    return JSON.stringify([theirs.guesses, theirs.draft]) !== JSON.stringify([S.guesses, S.draft]);
  }
  /*
   * Called before any change that is saved. Reads the store again first, so what another tab
   * has saved is not overwritten. If another tab has moved on to a later day, this tab's day
   * is over: it shows today's game. If another tab has played this day further, or
   * differently, this tab takes that game. Either way the change is not made: returns false.
   */
  function sync() {
    if (!S.persist) return true;
    var fresh = reread();
    if (fresh) store = fresh;
    if (store.game && store.game.day > S.day) { startGame(today(), true); return false; }
    if (savedIsNewer()) { startGame(S.day, true); return false; }
    return true;
  }
  function canPlant() { return !!S && !S.busy && !done(); }

  // Put vegetable v in the first empty bed.
  function plant(v) {
    if (!canPlant()) return;
    if (P.isFull(S.draft)) { toast('All four beds are planted. Dig, or tap a bed to empty it'); return; }
    if (!sync()) return;
    var at = S.draft.indexOf(null);
    S.draft = P.place(S.draft, v);
    if (S.persist) snapshot();
    renderBoard(-1, at);
    $('live').textContent = 'Bed ' + (at + 1) + ': ' + VEG[v].name + '.';
  }
  // Empty one bed of the guess being planted (bed counts from 0), or the last filled one.
  function unplant(bed) {
    if (!canPlant()) return;
    if (bed === undefined) {
      for (bed = P.BEDS - 1; bed >= 0 && S.draft[bed] === null; bed--) { /* find the last filled bed */ }
      if (bed < 0) return;
    }
    if (S.draft[bed] === null) return;
    var focused = document.activeElement && document.activeElement.getAttribute('data-bed') !== null;
    if (!sync()) return;
    var v = S.draft[bed];
    S.draft = P.clearBed(S.draft, bed);
    if (S.persist) snapshot();
    renderBoard(-1, -1);
    $('live').textContent = 'Bed ' + (bed + 1) + ' emptied. ' + VEG[v].name + ' taken out.';
    // A keyboard player who emptied a bed stays in the row, or goes to the tray if it is empty.
    if (focused) {
      var nextBed = $('board').querySelector('.row.now button.bed');
      (nextBed || $('tray').querySelector('.veg-btn')).focus({ preventScroll: true });
    }
  }

  function dig() {
    if (!canPlant()) return;
    var now = $('board').querySelector('.row.now');
    if (!P.isFull(S.draft)) {
      nudge(now, 'nudge');
      toast('Fill all four beds');
      $('live').textContent = 'Fill all four beds first.';
      return;
    }
    if (!sync()) return;
    if (store.hard) {
      var problem = P.hardModeProblem(S.draft, S.guesses, S.code);
      if (problem) {
        var text = 'Hard mode: ' + P.problemText(problem);
        nudge($('board').children[problem.row - 1], 'flag');
        toast(text);
        $('live').textContent = text;
        return;
      }
    }
    S.hard = S.guesses.length ? S.hard && store.hard : store.hard;
    S.guesses.push(S.draft);
    S.draft = P.emptyDraft();
    var st = status();
    if (S.persist) {
      if (st.done) store.stats = P.recordResult(store.stats, S.day, st.won, st.used);
      snapshot();
    }
    reveal(S.guesses.length - 1);
  }

  // Replay a short animation on an element.
  function nudge(node, cls) {
    if (!node) return;
    node.classList.remove('nudge', 'flag');
    if (reduced()) return;
    void node.offsetWidth;
    node.classList.add(cls);
    setTimeout(function () { node.classList.remove(cls); }, cls === 'flag' ? 1600 : 450);
  }

  // Show the row just dug: its beds turn over one by one, then the tray and the hint catch up.
  function reveal(i) {
    var animate = !reduced();
    S.busy = animate;
    if (animate) $('app').setAttribute('data-busy', '');
    renderBoard(animate ? i : -1, -1);
    var finish = function () {
      S.busy = false;
      $('app').removeAttribute('data-busy');
      var st = status();
      announce(i);
      if (st.done) {
        if (st.won) celebrate(i);
        renderAll(true);
        var share = $('results').querySelector('.primary');
        if (share) share.focus({ preventScroll: true });
        $('results').scrollIntoView({ behavior: reduced() ? 'auto' : 'smooth', block: 'nearest' });
      } else {
        renderAll();
      }
    };
    if (animate) revealTimer = setTimeout(finish, STAGGER_MS * (P.BEDS - 1) + TURN_MS);
    else finish();
  }

  function markWords(g, marks, k) {
    if (marks[k] === 'right') return 'right bed';
    if (marks[k] === 'elsewhere') return 'planted elsewhere';
    var more = g.some(function (v, j) { return j !== k && v === g[k] && marks[j] !== 'absent'; });
    return more ? 'no more planted' : 'not planted';
  }
  function rowWords(i) {
    var g = S.guesses[i], marks = P.feedback(g, S.code);
    return g.map(function (v, k) { return VEG[v].name + ', ' + markWords(g, marks, k); }).join('; ');
  }
  function announce(i) {
    var st = status(), parts = ['Guess ' + (i + 1) + ': ' + rowWords(i) + '.'];
    if (st.won) parts.push(WIN_WORDS[st.used - 1]);
    else if (st.done) parts.push('Out of guesses. The beds held ' + names(S.code) + '.');
    $('live').textContent = parts.join(' ');
  }

  // ---- drawing

  // fresh: the index of a row just dug, to turn over; -1 for none.
  function renderAll(justFinished) {
    var over = done();
    renderBoard(-1, -1);
    renderTray();
    renderHint();
    applyHard();
    $('tray-box').hidden = over;
    $('results').hidden = !over;
    if (over) renderResults(!!justFinished);
  }

  function renderHint() {
    var hint = $('hint'), st = status();
    if (st.done) { hint.textContent = st.won ? 'Solved in ' + st.used + ' of ' + P.MAX_GUESSES + '.' : 'Not this time: all seven dug.'; return; }
    if (!S.guesses.length) { hint.textContent = FIRST_HINT; return; }
    hint.textContent = '';
    hint.appendChild(el('span', {}, [
      el('b', { text: 'Guess ' + (S.guesses.length + 1) + ' of ' + P.MAX_GUESSES + (store.hard ? ', hard mode' : '') + '.' }),
      ' Tap a bed to empty it.',
    ]));
  }

  /*
   * The seven rows: dug guesses, then the guess being planted, then empty rows. Dug rows
   * already on screen are kept as they are, so a row still turning over is not interrupted.
   * fresh: a row just dug, to turn over. popped: a bed of the planting row just filled.
   */
  function renderBoard(fresh, popped) {
    var ol = $('board'), over = done();
    for (var i = 0; i < P.MAX_GUESSES; i++) {
      var kind = i < S.guesses.length ? 'dug' : i === S.guesses.length && !over ? 'now' : 'todo';
      var key = kind === 'dug' ? 'dug:' + S.day + ':' + S.guesses[i].join('') : kind;
      var existing = ol.children[i];
      if (existing && kind !== 'now' && existing.getAttribute('data-key') === key && i !== fresh) continue;
      var row = kind === 'dug' ? dugRow(i, i === fresh) : kind === 'now' ? nowRow(i, popped) : todoRow();
      row.setAttribute('data-key', key);
      if (existing) ol.replaceChild(row, existing); else ol.appendChild(row);
    }
  }
  function dugRow(i, fresh) {
    var g = S.guesses[i], marks = P.feedback(g, S.code);
    return el('li', { class: 'row dug', 'aria-label': 'Guess ' + (i + 1) + ': ' + rowWords(i) }, g.map(function (v, k) {
      return el('span', {
        class: 'bed ' + marks[k] + (fresh ? ' turn' : ''), 'data-mark': marks[k], 'aria-hidden': 'true',
        style: '--pt-delay:' + (k * STAGGER_MS / 1000) + 's',
      }, [el('span', { class: 'veg', text: VEG[v].emoji }), el('i', { class: 'mark', text: MARK_TEXT[marks[k]] })]);
    }));
  }
  function nowRow(i, popped) {
    return el('li', { class: 'row now', 'aria-label': 'Guess ' + (i + 1) + ' of ' + P.MAX_GUESSES + ', being planted' }, S.draft.map(function (v, k) {
      if (v === null) return el('span', { class: 'bed empty' }, [el('span', { class: 'sr-only', text: 'Bed ' + (k + 1) + ': empty' })]);
      return el('button', {
        class: 'bed filled' + (k === popped && !reduced() ? ' pop' : ''), type: 'button', 'data-bed': String(k),
        'aria-label': 'Bed ' + (k + 1) + ': ' + VEG[v].name + '. Press to empty it.',
        onclick: function () { unplant(k); },
      }, [el('span', { class: 'veg', 'aria-hidden': 'true', text: VEG[v].emoji })]);
    }));
  }
  function todoRow() {
    var beds = [];
    for (var k = 0; k < P.BEDS; k++) beds.push(el('span', { class: 'bed' }));
    return el('li', { class: 'row todo', 'aria-hidden': 'true' }, beds);
  }

  // The tray: one button per vegetable, built once, marked with what the guesses so far show.
  function buildTray() {
    VEG.forEach(function (veg, i) {
      $('tray').appendChild(el('button', {
        class: 'veg-btn', type: 'button', 'data-veg': veg.id, 'aria-keyshortcuts': String(i + 1) + ' ' + veg.key.toUpperCase(),
        onclick: function () { plant(i); },
      }, [el('span', { class: 'veg', 'aria-hidden': 'true', text: veg.emoji })]));
    });
  }
  function renderTray() {
    var known = P.knowledge(S.guesses, S.code);
    Array.prototype.forEach.call($('tray').children, function (btn, i) {
      var k = known[i];
      btn.className = 'veg-btn' + (k ? ' ' + k : '');
      btn.setAttribute('aria-label', VEG[i].name + (k === 'found' ? ', planted somewhere' : k === 'absent' ? ', not planted' : ''));
      var tick = btn.querySelector('.tick');
      if (k === 'found' && !tick) btn.appendChild(el('i', { class: 'tick', 'aria-hidden': 'true', text: '✓' }));
      if (k !== 'found' && tick) tick.remove();
    });
  }

  // ---- the result card

  function renderResults(justFinished) {
    var box = $('results'), st = status();
    box.textContent = '';
    box.className = 'results' + (st.won ? ' won' : ' lost') + (justFinished && !reduced() ? ' fresh' : '');
    box.appendChild(el('h2', { class: 'res-kicker', id: 'result-title', text: st.won ? WIN_WORDS[st.used - 1] : 'Out of digs' }));
    box.appendChild(el('p', { class: 'res-sub', text: (st.won ? 'Today’s plot' : 'Here’s what was planted') + (S.hard ? ' · hard mode ✳︎' : '') }));
    box.appendChild(el('div', { class: 'res-plot', role: 'img', 'aria-label': 'The four beds: ' + names(S.code) }, S.code.map(function (v, k) {
      return el('span', { class: 'bed', style: '--pt-delay:' + (0.15 + k * 0.12).toFixed(2) + 's' }, [el('span', { class: 'veg', text: VEG[v].emoji })]);
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
  }

  // The winning row hops bed by bed, and a few vegetables fall.
  function celebrate(i) {
    if (reduced()) return;
    var row = $('board').children[i];
    if (row) {
      Array.prototype.forEach.call(row.children, function (b) { b.classList.remove('turn'); });
      row.classList.add('won');
    }
    var layer = el('div', { class: 'confetti', 'aria-hidden': 'true' });
    for (var n = 0; n < 18; n++) {
      layer.appendChild(el('span', {
        text: VEG[n % VEG.length].emoji,
        style: '--x:' + (Math.random() * 96).toFixed(1) + '%;--delay:' + (0.3 + Math.random() * 0.5).toFixed(2) + 's;--spin:' +
          Math.round(Math.random() * 360 - 180) + 'deg;--time:' + (1.5 + Math.random()).toFixed(2) + 's',
      }));
    }
    document.body.appendChild(layer);
    setTimeout(function () { layer.remove(); }, 3800);
  }

  // ---- sharing

  function share() {
    var text = P.shareText(S.day, S.guesses, S.code, S.hard, SITE_URL);
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

  // ---- the clock: countdown to the next plot, and moving on when it arrives

  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function tick() {
    if (!S.persist) {
      if ($('next')) $('next').textContent = 'Preview: use the arrows at the top to try another day.';
      return;
    }
    var newDay = today() !== S.day;
    // A day nobody has started moves on by itself. One in progress can be finished first.
    if (newDay && untouched() && !S.busy) { startGame(today(), true); return; }
    var box = $('next');
    if (!box || !done()) return;
    if (newDay) {
      if (box.getAttribute('data-ready')) return;
      box.setAttribute('data-ready', '1');
      box.textContent = 'A new plot is ready. ';
      box.appendChild(el('button', { class: 'chip-btn', type: 'button', text: 'Play', onclick: function () { startGame(today(), true); } }));
      return;
    }
    var s = Math.floor(P.msUntilTomorrow() / 1000);
    box.textContent = 'Next plot in ';
    box.appendChild(el('b', { text: pad(Math.floor(s / 3600)) + ':' + pad(Math.floor(s / 60) % 60) + ':' + pad(s % 60) }));
  }

  // ---- stats

  function openStats() {
    var st = store.stats, body = $('stats-body');
    var lost = st.played - st.won;
    var most = Math.max.apply(null, st.dist.concat([lost, 1]));
    var mine = S.persist && done() && st.lastDay === S.day ? status() : null;
    body.textContent = '';
    body.appendChild(el('div', { class: 'nums' }, [
      num(st.played, 'Played'),
      num(st.played ? Math.round(100 * st.won / st.played) : 0, 'Solved %'),
      num(st.lastDay >= today() - 1 ? st.streak : 0, 'Day streak'),
      num(st.best, 'Best streak'),
    ]));
    body.appendChild(el('h3', { text: 'Guesses needed' }));
    var rows = st.dist.map(function (n, i) { return [String(i + 1), n, !!mine && mine.won && mine.used === i + 1]; });
    rows.push(['X', lost, !!mine && !mine.won]);
    body.appendChild(el('ol', { class: 'dist', 'aria-label': 'How many guesses your solves took' }, rows.map(function (r) {
      var label = r[0] === 'X' ? 'Not solved' : 'In ' + r[0] + (r[0] === '1' ? ' guess' : ' guesses');
      return el('li', { 'aria-label': label + ': ' + r[1] + (r[1] === 1 ? ' day' : ' days') }, [
        el('span', { 'aria-hidden': 'true', text: r[0] }),
        el('span', { class: 'dist-bar' + (r[2] ? ' today' : ''), 'aria-hidden': 'true', style: 'width:' + Math.max(8, r[1] / most * 100).toFixed(0) + '%', text: String(r[1]) }),
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
    toastTimer = setTimeout(function () { t.classList.remove('show'); }, msg.length > 40 ? 3600 : 2200);
  }
  function applyContrast() {
    if (store.contrast) root.setAttribute('data-contrast', 'high'); else root.removeAttribute('data-contrast');
    $('contrast').checked = store.contrast;
  }
  // Hard mode can be switched off at any time, but on only before the day's first guess.
  function applyHard() {
    var locked = !store.hard && !!S && S.guesses.length > 0 && !done();
    $('hard').checked = store.hard;
    $('hard').disabled = locked;
    $('hard-note').hidden = !locked;
  }

  // ---- wiring

  buildTray();
  $('dig').addEventListener('click', dig);
  // Tapping or clicking the tray or a bed leaves the focus where it was, so Enter still digs.
  ['tray', 'board'].forEach(function (id) {
    $(id).addEventListener('mousedown', function (e) { if (e.target.closest && e.target.closest('button')) e.preventDefault(); });
  });
  // A held key repeats. On a button each repeat would press it again, so only the first
  // press of a key counts.
  document.addEventListener('keydown', function (e) {
    if (e.repeat && (e.key === 'Enter' || e.key === ' ') && e.target.closest && e.target.closest('button')) e.preventDefault();
  }, true);
  /*
   * Playing from the keyboard: 1 to 6, or each vegetable's letter, plant it; Backspace takes
   * the last one out; Enter digs, unless the focus is on a button, which Enter presses.
   */
  document.addEventListener('keydown', function (e) {
    if (e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey) return;
    // The page has no text to edit, so Backspace never goes back a page, even with a dialog open.
    if (e.key === 'Backspace' && dialogOpen()) e.preventDefault();
    if (dialogOpen()) return;
    var onControl = e.target.closest && e.target.closest('button, a, input, select, textarea');
    if (e.key === 'Enter') {
      if (onControl) return;
      e.preventDefault();
      if (!e.repeat) dig();
      return;
    }
    if (e.key === 'Backspace' || e.key === 'Delete') {
      e.preventDefault();
      if (!e.repeat) unplant();
      return;
    }
    var v = /^[1-6]$/.test(e.key) ? Number(e.key) - 1 : -1;
    if (v < 0 && e.key.length === 1) {
      VEG.forEach(function (veg, i) { if (veg.key === e.key.toLowerCase()) v = i; });
    }
    if (v < 0) return;
    e.preventDefault();
    if (!e.repeat) plant(v);
  });
  $('help-btn').addEventListener('click', function () { openDialog('help'); });
  $('stats-btn').addEventListener('click', openStats);
  Array.prototype.forEach.call(document.querySelectorAll('dialog'), function (d) {
    d.addEventListener('click', function (e) {
      if (e.target === d || (e.target.closest && e.target.closest('[data-close]'))) closeDialog(d);
    });
  });
  $('contrast').addEventListener('change', function () {
    // Read the store again first, so this write carries what another tab has saved since.
    var fresh = reread();
    if (fresh) store = fresh;
    store.contrast = $('contrast').checked;
    save();
    applyContrast();
  });
  $('hard').addEventListener('change', function () {
    var fresh = reread();
    if (fresh) store = fresh;
    var on = $('hard').checked;
    store.hard = on;
    if (!done()) {
      // Before the first guess the day follows the switch; switching off part-way means the day is no longer a hard one.
      S.hard = S.guesses.length ? S.hard && on : on;
      if (S.persist && store.game && store.game.day === S.day && !P.status(store.game.guesses, S.code).done) store.game.hard = S.hard;
    }
    save();
    applyHard();
    renderHint();
  });
  $('prev-day').addEventListener('click', function () { if (S.day > 1) startGame(S.day - 1, false); });
  $('next-day').addEventListener('click', function () { startGame(S.day + 1, false); });
  // Another tab saved something: take its copy, and redraw if it has played this day further
  // than this tab, or as far but differently.
  window.addEventListener('storage', function (e) {
    if (e.key !== STORE_KEY && e.key !== null) return;
    var fresh = reread();
    if (!fresh) return;
    store = fresh;
    applyContrast();
    if (!S.persist) { applyHard(); return; }
    var theirs = store.game;
    if (theirs && theirs.day > S.day) {
      // Another tab has moved on to a later day: never write over it.
      startGame(today(), true);
    } else if (theirs && theirs.day === S.day) {
      if (savedIsNewer() && !S.busy) startGame(S.day, true);
      else { applyHard(); renderHint(); }
    } else if (!untouched()) {
      // Their copy has no trace of this tab's day (it was on an earlier one): put ours back.
      snapshot();
    }
  });
  document.addEventListener('visibilitychange', function () { if (!document.hidden) tick(); });
  setInterval(tick, 1000);

  applyContrast();
  startGame(forcedDay > 0 ? forcedDay : today(), !PREVIEW);
})();
