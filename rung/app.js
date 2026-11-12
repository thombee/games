/*
 * Rung page. Draws the ladder, the on-screen keyboard and the result card, takes words from
 * either keyboard, and keeps the player's progress (the ladder so far, the letters being
 * typed, hints used) in localStorage. The rules (the day's pair, checks, marks, hints, share
 * text, stats) are in logic.js; the words are in words.js.
 */
(function () {
  'use strict';

  var R = window.Rung;
  var DATA = window.RUNG_DATA;
  var LEX = R.lexicon(DATA);

  // The address added to shared results. Empty until the game has a home.
  var SITE_URL = 'https://thombee.github.io/games/rung/';
  var STORE_KEY = 'rung:v1';

  var root = document.documentElement;
  var forcedDay = parseInt(new URLSearchParams(location.search).get('day'), 10);
  // Preview mode plays any day and saves nothing. It is on for ?day=N and for preview builds.
  var PREVIEW = root.hasAttribute('data-preview') || forcedDay > 0;
  // Whether the system asks for less motion. Asked each time something would move, so a
  // change to the setting while the page is open counts straight away.
  function reduced() { return window.matchMedia('(prefers-reduced-motion: reduce)').matches; }
  var TOUCH = window.matchMedia('(pointer: coarse)').matches;
  var KEY_ROWS = ['qwertyuiop', 'asdfghjkl', 'zxcvbnm'];

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
  function up(w) { return w.toUpperCase(); }
  // A word spelt out for a screen reader, so "SEED" is not read as a word it is not: "S E E D".
  function spelt(w) { return up(w) + ' (' + up(w).split('').join(' ') + ')'; }

  // ---- saved progress

  function emptyStore() { return { v: 1, stats: R.emptyStats(), game: null, contrast: false }; }
  var WORD = /^[a-z]{4,5}$/;
  // The saved progress, or null if this browser will not let the page read localStorage.
  function readStore() {
    var raw;
    try { raw = localStorage.getItem(STORE_KEY); } catch (e) { return null; }
    var s = emptyStore();
    try {
      var d = JSON.parse(raw || 'null');
      if (!d || d.v !== 1) return s;
      var st = d.stats || {};
      ['played', 'matched', 'over', 'streak', 'best', 'lastDay'].forEach(function (k) {
        if (Number.isFinite(st[k]) && st[k] >= 0) s.stats[k] = Math.floor(st[k]);
      });
      s.stats.matched = Math.min(s.stats.matched, s.stats.played);
      if (Array.isArray(st.dist) && st.dist.length === s.stats.dist.length) {
        s.stats.dist = st.dist.map(function (n) { return Number.isFinite(n) && n >= 0 ? Math.floor(n) : 0; });
      }
      var g = d.game;
      if (g && Number.isInteger(g.day) && g.day >= 1 && Array.isArray(g.words)) {
        var words = g.words.filter(function (w) { return typeof w === 'string' && WORD.test(w); }).slice(0, 200);
        s.game = {
          day: g.day,
          words: words,
          hinted: words.map(function (w, i) { return Array.isArray(g.hinted) && g.hinted[i] === true; }),
          typed: typeof g.typed === 'string' && /^[a-z]{0,5}$/.test(g.typed) ? g.typed : '',
          hints: Number.isInteger(g.hints) && g.hints >= 0 ? g.hints : 0,
        };
      }
      s.contrast = d.contrast === true;
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
    say(note.textContent);
  }
  var store = readStore();
  if (!store) { store = emptyStore(); storageFailed = true; }

  // ---- the current day's game

  /*
   * day, persist (false in preview), pair, dist (each valid word's fewest steps to the end
   * word), ladder (every word so far, the start first; the end word last once finished),
   * hinted (per word, true if a hint put it there), typed (the letters being typed), hints.
   */
  var S = null;

  function today() { return Math.max(1, R.dayNumber()); }

  function startGame(day, persist) {
    var pair = R.pairForDay(day, DATA);
    S = {
      day: day, persist: persist, pair: pair, dist: R.distancesToEnd(LEX, pair.end),
      ladder: [pair.start], hinted: [false], typed: '', hints: 0,
    };
    var saved = persist && store.game && store.game.day === day ? store.game : null;
    if (saved) {
      // Take the saved words for as long as each one is a fair step from the one before.
      saved.words.some(function (w, i) {
        if (R.finished(S.ladder, pair.end)) return true;
        var ok = w === pair.end ? R.differences(w, last()) === 1 : !R.refusal(w, S.ladder, LEX);
        if (!ok) return true;
        S.ladder.push(w);
        S.hinted.push(saved.hinted[i]);
        return false;
      });
      S.hints = saved.hints;
      if (!done() && saved.typed.length <= pair.start.length) S.typed = saved.typed;
    }
    $('day-tag').textContent = '#' + day;
    $('preview-bar').hidden = !PREVIEW;
    $('preview-day').textContent = 'Day ' + day;
    renderAll(false);
  }
  function last() { return S.ladder[S.ladder.length - 1]; }
  function done() { return R.finished(S.ladder, S.pair.end); }
  function untouched() { return S.ladder.length === 1 && !S.typed; }
  function gameNow() {
    return { day: S.day, words: S.ladder.slice(1), hinted: S.hinted.slice(1), typed: S.typed, hints: S.hints };
  }
  function snapshot() {
    store.game = gameNow();
    save();
  }
  // True if the saved game is for this tab's day and differs from what this tab shows.
  function savedIsNewer() {
    var theirs = store.game;
    if (!theirs || theirs.day !== S.day) return false;
    var mine = gameNow();
    return JSON.stringify([theirs.words, theirs.hinted, theirs.typed, theirs.hints]) !== JSON.stringify([mine.words, mine.hinted, mine.typed, mine.hints]);
  }
  /*
   * Called before any change that is saved. Reads the store again first, so what another tab
   * has saved is not overwritten. If another tab has moved on to a later day, this tab's day
   * is over: it shows today's game. If another tab has played this day differently, this tab
   * takes that game. Either way the change is not made: returns false.
   */
  function sync() {
    if (!S.persist) return true;
    var fresh = reread();
    if (fresh) store = fresh;
    if (store.game && store.game.day > S.day) { startGame(today(), true); return false; }
    if (savedIsNewer()) { startGame(S.day, true); return false; }
    return true;
  }

  // ---- moves

  function typeLetter(ch) {
    if (done() || S.typed.length >= S.pair.start.length) return;
    if (!sync()) return;
    S.typed += ch;
    if (S.persist) snapshot();
    renderLadder({ popped: S.typed.length - 1 });
  }
  function deleteLetter() {
    if (done() || !S.typed) return;
    if (!sync()) return;
    S.typed = S.typed.slice(0, -1);
    if (S.persist) snapshot();
    renderLadder({});
  }
  function submit() {
    if (done()) return;
    if (!sync()) return;
    var entry = S.typed, why = R.refusal(entry, S.ladder, LEX);
    if (why) { refuse(why); return; }
    place(entry, false);
  }
  // Put a word on the ladder (from the player, or from a hint) and save.
  function place(word, fromHint) {
    var before = S.ladder.length;
    S.ladder = R.addWord(S.ladder, word, S.pair.end);
    S.hinted.push(fromHint);
    if (S.ladder.length > before + 1) S.hinted.push(false); // the end word, joined on
    S.typed = '';
    var finishedNow = done();
    if (S.persist) {
      if (finishedNow) store.stats = R.recordResult(store.stats, S.day, R.steps(S.ladder), S.pair.fewest);
      snapshot();
    }
    var closer = S.dist.get(word) < S.dist.get(S.ladder[before - 1]);
    var words = up(word) + (fromHint ? ', from a hint' : '') + '. ' + (closer ? 'Closer to ' : 'No closer to ') + up(S.pair.end) + '.';
    if (finishedNow) {
      words += ' Joined to ' + up(S.pair.end) + '. Done in ' + R.steps(S.ladder) + ' steps; the fewest possible is ' + S.pair.fewest + '.';
    }
    say(words);
    renderAll(finishedNow, before);
  }
  function refuse(why) {
    var row = $('ladder').querySelector('.rung.now');
    nudge(row);
    toast(why.text);
    say(why.text + '.');
  }
  function stepBack() {
    if (done() || S.ladder.length < 2) return;
    if (!sync()) return;
    var gone = last();
    S.ladder = S.ladder.slice(0, -1);
    S.hinted = S.hinted.slice(0, -1);
    S.typed = '';
    if (S.persist) snapshot();
    say(up(gone) + ' taken off. The word above is ' + up(last()) + '.');
    renderAll(false);
  }
  function giveHint() {
    if (done()) return;
    if (!sync()) return;
    var word = R.hint(LEX, S.ladder, S.pair.end);
    if (!word) {
      var text = 'Every way on from ' + up(last()) + ' repeats a word. Step back first';
      toast(text);
      say(text + '.');
      return;
    }
    S.hints++;
    place(word, true);
  }

  // Replay a short shake on an element.
  function nudge(node) {
    if (!node) return;
    node.classList.remove('nudge');
    if (reduced()) return;
    void node.offsetWidth;
    node.classList.add('nudge');
    setTimeout(function () { node.classList.remove('nudge'); }, 450);
  }

  // ---- drawing

  // finishedNow: the day was just finished. fresh: the index of the first word just placed.
  function renderAll(finishedNow, fresh) {
    var over = done();
    renderHint();
    renderLadder({ fresh: fresh });
    $('play').hidden = over;
    $('results').hidden = !over;
    $('back-btn').disabled = S.ladder.length < 2;
    if (over) renderResults(finishedNow);
    if (finishedNow) {
      var share = $('results').querySelector('.primary');
      if (share) share.focus({ preventScroll: true });
      $('results').scrollIntoView({ behavior: reduced() ? 'auto' : 'smooth', block: 'nearest' });
      celebrate();
    }
  }

  function renderHint() {
    var hint = $('hint'), p = S.pair;
    hint.textContent = '';
    if (done()) {
      hint.appendChild(el('span', { text: 'Done: ' + up(p.start) + ' to ' + up(p.end) + ' in ' + R.steps(S.ladder) + ' steps.' }));
    } else if (S.ladder.length === 1) {
      hint.appendChild(el('span', {}, ['Change one letter to make a new word. Get from ', el('b', { text: up(p.start) }), ' to ', el('b', { text: up(p.end) }), '.']));
    } else {
      hint.appendChild(el('span', {}, [
        'Fewest: ' + p.fewest + ' steps · ',
        el('span', { class: 'mark warm', 'aria-hidden': 'true', text: '▲' }), ' closer · ',
        el('span', { class: 'mark cool', 'aria-hidden': 'true', text: '▼' }), ' not closer',
        el('span', { class: 'sr-only', text: ' to ' + up(p.end) }),
      ]));
    }
  }

  function tiles(word, changed, extra) {
    return el('span', { class: 'tiles', 'aria-hidden': 'true' }, word.split('').map(function (ch, i) {
      return el('span', { class: 'tile' + (i === changed ? ' changed' : '') + (extra ? extra(i) : ''), text: up(ch) });
    }));
  }
  function markFor(i) {
    var closer = S.dist.get(S.ladder[i]) < S.dist.get(S.ladder[i - 1]);
    return el('span', { class: 'side' }, [
      S.hinted[i] ? el('span', { class: 'bulb', 'aria-hidden': 'true', text: '💡' }) : null,
      el('span', { class: 'mark ' + (closer ? 'warm' : 'cool'), 'aria-hidden': 'true', text: closer ? '▲' : '▼' }),
    ]);
  }
  function rungLabel(i) {
    var w = S.ladder[i], closer = S.dist.get(w) < S.dist.get(S.ladder[i - 1]);
    return 'Step ' + i + ': ' + spelt(w) + ', changed letter ' + (R.changedAt(S.ladder[i - 1], w) + 1) + (S.hinted[i] ? ', from a hint' : '') + ', ' + (closer ? 'closer' : 'no closer');
  }

  /*
   * The ladder: the start word, each word placed, the row being typed, empty rungs for the
   * fewest steps still to go (at least), and the end word. opts.fresh: the index of the first
   * word just placed, to click into place. opts.popped: a letter just typed.
   */
  function renderLadder(opts) {
    var ol = $('ladder'), p = S.pair, over = done();
    var placed = over ? S.ladder.length - 1 : S.ladder.length; // words above the end rung
    var rows = Math.max(p.fewest, over ? placed : placed + 1); // rungs from the start word to the end word
    ol.textContent = '';
    var animate = !reduced();
    ol.appendChild(el('li', { class: 'rung start', 'aria-label': 'Start: ' + spelt(p.start) }, [el('span', { class: 'side' }), tiles(p.start, -1), el('span', { class: 'side' })]));
    for (var i = 1; i < rows; i++) {
      if (i < placed) {
        var w = S.ladder[i];
        ol.appendChild(el('li', {
          class: 'rung word' + (animate && opts.fresh !== undefined && i >= opts.fresh ? ' click' : ''), 'aria-label': rungLabel(i),
        }, [el('span', { class: 'side' }), tiles(w, R.changedAt(S.ladder[i - 1], w)), markFor(i)]));
      } else if (i === placed && !over) {
        ol.appendChild(nowRow(opts.popped));
      } else {
        ol.appendChild(el('li', { class: 'rung todo', 'aria-hidden': 'true' }, [el('span', { class: 'side' }), tiles(new Array(p.start.length + 1).join(' '), -1), el('span', { class: 'side' })]));
      }
    }
    var endChanged = over ? R.changedAt(S.ladder[S.ladder.length - 2], p.end) : -1;
    ol.appendChild(el('li', {
      class: 'rung end' + (over ? ' joined' : '') + (over && animate && opts.fresh !== undefined ? ' click' : ''),
      'aria-label': 'End: ' + spelt(p.end) + (over ? ', reached in step ' + R.steps(S.ladder) : ''),
    }, [el('span', { class: 'side' }), tiles(p.end, endChanged), over ? markFor(S.ladder.length - 1) : el('span', { class: 'side' })]));
    var now = ol.querySelector('.rung.now');
    if (now && now.getBoundingClientRect) {
      var r = now.getBoundingClientRect(), keys = $('play').getBoundingClientRect();
      if (r.bottom > keys.top || r.top < 0) now.scrollIntoView({ block: 'nearest' });
    }
  }
  // The row being typed: the letters so far, over the word above shown faintly.
  function nowRow(popped) {
    var above = last(), typed = S.typed, n = above.length;
    var cells = [];
    for (var i = 0; i < n; i++) {
      var ch = typed[i];
      cells.push(el('span', {
        class: 'tile' + (ch ? ' typed' : ' ghost') + (ch && ch !== above[i] ? ' changed' : '') + (i === typed.length ? ' cursor' : '') + (i === popped && !reduced() ? ' pop' : ''),
        text: up(ch || above[i]),
      }));
    }
    var label = 'Step ' + S.ladder.length + ', being typed: ' + (typed ? up(typed).split('').join(' ') : 'nothing yet') + '. The word above is ' + spelt(above) + '.';
    return el('li', { class: 'rung now', 'aria-label': label }, [
      el('span', { class: 'side' }), el('span', { class: 'tiles', 'aria-hidden': 'true' }, cells), el('span', { class: 'side' }),
    ]);
  }

  // The on-screen keyboard, built once.
  function buildKeyboard() {
    var kb = $('keyboard');
    KEY_ROWS.forEach(function (letters, r) {
      var row = el('div', { class: 'krow' });
      if (r === 2) row.appendChild(el('button', { class: 'key wide', type: 'button', 'data-key': 'enter', text: 'Enter', onclick: submit }));
      letters.split('').forEach(function (ch) {
        row.appendChild(el('button', { class: 'key', type: 'button', 'data-key': ch, 'aria-label': up(ch), text: up(ch), onclick: function () { typeLetter(ch); } }));
      });
      if (r === 2) row.appendChild(el('button', { class: 'key wide', type: 'button', 'data-key': 'back', 'aria-label': 'Delete letter', text: '⌫', onclick: deleteLetter }));
      kb.appendChild(row);
    });
  }

  // ---- the result card

  var TITLES = ['Shortest possible!', 'One step off the best', 'You got there'];
  function renderResults(finishedNow) {
    var box = $('results'), taken = R.steps(S.ladder), extra = taken - S.pair.fewest;
    box.textContent = '';
    box.className = 'results' + (finishedNow && !reduced() ? ' fresh' : '');
    box.appendChild(el('h2', { class: 'res-title', id: 'result-title', text: TITLES[Math.min(Math.max(extra, 0), 2)] }));
    box.appendChild(el('p', { class: 'res-sub', id: 'result-sub', text: taken + ' steps · fewest possible ' + S.pair.fewest + (S.hints ? ' · 💡 ' + S.hints + (S.hints === 1 ? ' hint' : ' hints') : '') }));
    box.appendChild(el('div', { class: 'compare' }, [miniLadder('Yours', S.ladder), miniLadder('Shortest', S.pair.solution)]));
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
  function miniLadder(title, words) {
    return el('div', { class: 'mini' }, [
      el('h3', { text: title }),
      el('ol', { 'aria-label': title + ': ' + words.map(up).join(', ') }, words.map(function (w, i) {
        return el('li', { 'aria-hidden': 'true' }, w.split('').map(function (ch, k) {
          return el('b', { class: i && R.changedAt(words[i - 1], w) === k ? 'changed' : null, text: up(ch) });
        }));
      })),
    ]);
  }

  // A few rungs fall after the ladder is joined.
  function celebrate() {
    if (reduced()) return;
    var layer = el('div', { class: 'confetti', 'aria-hidden': 'true' });
    var bits = ['🪜', '✨', '🔤', '⭐'];
    for (var n = 0; n < 16; n++) {
      layer.appendChild(el('span', {
        text: bits[n % bits.length],
        style: '--x:' + (Math.random() * 96).toFixed(1) + '%;--delay:' + (Math.random() * 0.5).toFixed(2) + 's;--spin:' +
          Math.round(Math.random() * 360 - 180) + 'deg;--time:' + (1.5 + Math.random()).toFixed(2) + 's',
      }));
    }
    document.body.appendChild(layer);
    setTimeout(function () { layer.remove(); }, 3500);
  }

  // ---- sharing

  function share() {
    var text = R.shareText(S.day, S.pair, S.ladder, R.closer(S.ladder, S.dist), S.hints, SITE_URL);
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

  // ---- the clock: countdown to the next ladder, and moving on when it arrives

  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function tick() {
    if (!S.persist) {
      if ($('next')) $('next').textContent = 'Preview: use the arrows at the top to try another day.';
      return;
    }
    var newDay = today() !== S.day;
    // A day nobody has started moves on by itself. One in progress can be finished first.
    if (newDay && untouched()) { startGame(today(), true); return; }
    var box = $('next');
    if (!box || !done()) return;
    if (newDay) {
      if (box.getAttribute('data-ready')) return;
      box.setAttribute('data-ready', '1');
      box.textContent = 'A new ladder is ready. ';
      box.appendChild(el('button', { class: 'chip-btn', type: 'button', text: 'Play', onclick: function () { startGame(today(), true); } }));
      return;
    }
    var s = Math.floor(R.msUntilTomorrow() / 1000);
    box.textContent = 'Next ladder in ';
    box.appendChild(el('b', { text: pad(Math.floor(s / 3600)) + ':' + pad(Math.floor(s / 60) % 60) + ':' + pad(s % 60) }));
  }

  // ---- stats

  var BUCKETS = ['Fewest', '+1', '+2', '+3', '+4 or more'];
  function openStats() {
    var st = store.stats, body = $('stats-body');
    var most = Math.max.apply(null, st.dist.concat([1]));
    var mine = S.persist && done() && st.lastDay === S.day ? Math.min(R.steps(S.ladder) - S.pair.fewest, BUCKETS.length - 1) : -1;
    body.textContent = '';
    body.appendChild(el('div', { class: 'nums' }, [
      num(st.played, 'Played'),
      num(st.played ? Math.round(100 * st.matched / st.played) : 0, 'Fewest %'),
      num(st.lastDay >= today() - 1 ? st.streak : 0, 'Day streak'),
      num(st.best, 'Best streak'),
    ]));
    body.appendChild(el('p', { class: 'avg', text: st.played ? 'On average ' + (st.over / st.played).toFixed(1) + ' steps over the fewest' : 'Finish a ladder to see how close you get to the fewest steps.' }));
    body.appendChild(el('h3', { text: 'Steps over the fewest' }));
    body.appendChild(el('ol', { class: 'dist', 'aria-label': 'How many steps over the fewest your ladders took' }, st.dist.map(function (n, i) {
      return el('li', { 'aria-label': BUCKETS[i] + ': ' + n + (n === 1 ? ' day' : ' days') }, [
        el('span', { 'aria-hidden': 'true', text: BUCKETS[i] }),
        el('span', { class: 'dist-bar' + (mine === i ? ' today' : ''), 'aria-hidden': 'true', style: 'width:' + Math.max(8, n / most * 100).toFixed(0) + '%', text: String(n) }),
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
    toastTimer = setTimeout(function () { t.classList.remove('show'); }, msg.length > 40 ? 3200 : 2200);
  }
  // The live region reads each message once; clearing it first makes a repeat heard again.
  function say(text) {
    var live = $('live');
    live.textContent = '';
    setTimeout(function () { live.textContent = text; }, 30);
  }
  function applyContrast() {
    if (store.contrast) root.setAttribute('data-contrast', 'high'); else root.removeAttribute('data-contrast');
    $('contrast').checked = store.contrast;
  }

  // ---- wiring

  buildKeyboard();
  $('back-btn').addEventListener('click', stepBack);
  $('hint-btn').addEventListener('click', giveHint);
  // Clicking or tapping a button on the page (a key, Hint, the help button, a day arrow) leaves
  // the focus where it was, so Enter on a physical keyboard still places the word rather than
  // pressing that button again. Buttons in dialogs work as usual.
  document.addEventListener('mousedown', function (e) {
    if (e.target.closest && e.target.closest('button') && !e.target.closest('dialog')) e.preventDefault();
  });
  /*
   * Playing from the keyboard: letters type, Backspace deletes, Enter places the word, unless
   * the focus is on a button, which Enter presses. A held key repeats; only the first press
   * of a key counts.
   */
  document.addEventListener('keydown', function (e) {
    if (e.repeat && (e.key === 'Enter' || e.key === ' ') && e.target.closest && e.target.closest('button')) { e.preventDefault(); return; }
    if (e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey) return;
    // The page has no text to edit, so Backspace never goes back a page, even with a dialog open.
    if (e.key === 'Backspace' && dialogOpen()) e.preventDefault();
    if (dialogOpen() || !S) return;
    var onControl = e.target.closest && e.target.closest('button, a, input, select, textarea');
    // A control left focused in a closed dialog does not count.
    if (onControl && onControl.closest('dialog:not([open])')) { onControl.blur(); onControl = null; }
    if (e.key === 'Enter') {
      if (onControl) return;
      e.preventDefault();
      if (!e.repeat) submit();
      return;
    }
    if (e.key === 'Backspace' || e.key === 'Delete') {
      e.preventDefault();
      if (!e.repeat) deleteLetter();
      return;
    }
    if (/^[a-zA-Z]$/.test(e.key)) {
      e.preventDefault();
      if (!e.repeat) typeLetter(e.key.toLowerCase());
    }
  });
  $('help-btn').addEventListener('click', function () { openDialog('help'); });
  $('stats-btn').addEventListener('click', openStats);
  Array.prototype.forEach.call(document.querySelectorAll('dialog'), function (d) {
    d.addEventListener('click', function (e) {
      if (e.target === d || (e.target.closest && e.target.closest('[data-close]'))) closeDialog(d);
    });
    // A closed dialog keeps no focus, so the next Enter places a word instead of pressing a
    // button that is no longer on screen.
    d.addEventListener('close', function () {
      setTimeout(function () {
        var f = document.activeElement;
        if (f && f.closest && f.closest('dialog:not([open])')) f.blur();
      }, 0);
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
  $('prev-day').addEventListener('click', function () { if (S.day > 1) startGame(S.day - 1, false); });
  $('next-day').addEventListener('click', function () { startGame(S.day + 1, false); });
  // Another tab saved something: take its copy, and redraw if it has this day differently.
  window.addEventListener('storage', function (e) {
    if (e.key !== STORE_KEY && e.key !== null) return;
    var fresh = reread();
    if (!fresh) return;
    store = fresh;
    applyContrast();
    if (!S.persist) return;
    var theirs = store.game;
    if (theirs && theirs.day > S.day) {
      // Another tab has moved on to a later day: never write over it.
      startGame(today(), true);
    } else if (theirs && theirs.day === S.day) {
      if (savedIsNewer()) startGame(S.day, true);
    } else if (!untouched()) {
      // Their copy has no trace of this tab's day (it was on an earlier one): put ours back.
      snapshot();
    }
  });
  document.addEventListener('visibilitychange', function () { if (!document.hidden) tick(); });
  setInterval(tick, 1000);

  applyContrast();
  if (storageFailed) cannotSave();
  startGame(forcedDay > 0 ? forcedDay : today(), !PREVIEW);
})();
