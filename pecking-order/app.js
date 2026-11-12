/*
 * Pecking Order page. Shows the day's five cards, lets the player drag them (or move them
 * with their arrow buttons) and lock in, then reveals the answer and the result card. Keeps
 * the player's progress in localStorage. The rules (the day's question, grading, stats,
 * share text) are in logic.js.
 */
(function () {
  'use strict';

  var P = window.PeckingOrder;
  var DATA = window.PECKING_DATA;

  // The address added to shared results. Empty until the game has a home.
  var SITE_URL = 'https://thombee.github.io/games/pecking-order/';
  var STORE_KEY = 'pecking-order:v1';

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
  function plural(n, one, many) { return n + ' ' + (n === 1 ? one : many); }

  // ---- saved progress

  function emptyStore() { return { v: 1, stats: P.emptyStats(), game: null, contrast: false }; }
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
      if (g && Number.isInteger(g.day) && g.day > 0 && Array.isArray(g.tries)) {
        s.game = {
          day: g.day,
          tries: g.tries.filter(P.isPermutation).slice(0, P.TRIES).map(function (t) { return t.slice(); }),
          order: P.isPermutation(g.order) ? g.order.slice() : null,
          moved: g.moved === true,
          rev: Number.isInteger(g.rev) && g.rev >= 0 ? g.rev : 0,
        };
      }
      s.contrast = d.contrast === true;
    } catch (e) { /* corrupt: start clean */ }
    return s;
  }
  // Once a write has failed, what is in storage is out of date: this tab's copy is the truth
  // from then on and storage is not read again.
  var writeFailed = false;
  function save() {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(store)); } catch (e) { writeFailed = true; cannotSave(); }
  }
  // Read the store again to pick up what other tabs have saved. Returns false, changing
  // nothing, if storage cannot be read or a write from this tab has failed.
  function reread() {
    if (writeFailed) return false;
    var fresh = readStore();
    if (!fresh) return false;
    store = fresh;
    return true;
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

  // day, persist (false in preview), puzzle, tries (orders locked in), order (the cards on
  // screen now), moved (the player has moved a card today), busy (the reveal is playing),
  // rev (the revision of the saved game this one is: every move and lock-in saved adds one).
  var S = null;

  function today() { return Math.max(1, P.dayNumber()); }
  function state() { return P.status(S.tries); }

  // Tries as saved, cut short at the first one that moved a card an earlier try had locked.
  function validTries(tries) {
    var out = [];
    for (var i = 0; i < tries.length; i++) {
      var locked = P.lockedAfter(out);
      if (!tries[i].every(function (v, k) { return !locked[k] || v === k; })) break;
      out.push(tries[i]);
      if (P.status(out).over) break;
    }
    return out;
  }

  function startGame(day, persist) {
    var puzzle = P.dailyPuzzle(day, DATA);
    S = { day: day, persist: persist, puzzle: puzzle, tries: [], order: puzzle.start.slice(), moved: false, busy: false, rev: 0 };
    // A drag in progress belonged to the cards being replaced.
    drag = null;
    if (persist && store.game && store.game.day === day) {
      S.rev = store.game.rev;
      S.tries = validTries(store.game.tries);
      var locked = P.lockedAfter(S.tries), saved = store.game.order;
      var fits = function (o) { return o && o.every(function (v, k) { return !locked[k] || v === k; }); };
      S.order = fits(saved) ? saved.slice() : S.tries.length ? S.tries[S.tries.length - 1].slice() : S.order;
      S.moved = store.game.moved || S.tries.length > 0;
    }
    $('day-tag').textContent = '#' + day;
    $('preview-bar').hidden = !PREVIEW;
    $('preview-day').textContent = 'Day ' + day;
    $('prompt').textContent = puzzle.prompt;
    $('note').textContent = puzzle.measure.note;
    $('end-top').textContent = '▲ ' + puzzle.ends[0];
    $('end-bottom').textContent = '▼ ' + puzzle.ends[1];
    $('cards').setAttribute('aria-label', puzzle.prompt + ', top to bottom');
    $('results').hidden = true;
    if (state().over) {
      S.order = [0, 1, 2, 3, 4];
      renderCards();
      showDone(false);
    } else {
      renderCards();
      renderAfter();
    }
  }

  function snapshot() {
    S.rev++;
    store.game = { day: S.day, tries: S.tries.map(function (t) { return t.slice(); }), order: S.order.slice(), moved: S.moved, rev: S.rev };
    save();
  }
  // True if the saved game is for a later day than this tab's.
  function savedIsLaterDay() { return !!store.game && store.game.day > S.day; }
  // True if the saved game is this tab's day at a later revision: another tab has moved a
  // card or locked in since this tab last saw it.
  function savedIsNewer() { return !!store.game && store.game.day === S.day && store.game.rev > S.rev; }
  // Before a move or a lock-in, read the store again so another tab's progress is not
  // overwritten. If another tab has played on since this one last saw the game, or has
  // started a later day, show that game instead, and return false: the action is not applied.
  function syncBeforeWrite() {
    if (!S.persist) return true;
    reread();
    if (savedIsLaterDay()) { startGame(Math.max(today(), store.game.day), true); return false; }
    if (savedIsNewer()) { startGame(S.day, true); return false; }
    return true;
  }

  // ---- drawing the cards

  function cardEls() { return Array.prototype.slice.call($('cards').children); }

  function card(place, item, locked, st) {
    var done = st.over;
    var label = (place + 1) + ': ' + item.name + (done ? ', ' + item.text : locked ? ', in the right place' : '');
    var kids = [
      el('span', { class: 'c-emoji', 'aria-hidden': 'true', text: item.emoji }),
      el('span', { class: 'c-body' }, [
        el('span', { class: 'c-name', text: item.name }),
        done && el('span', { class: 'c-value', 'aria-hidden': 'true' }, [el('span', { class: 'c-bar' }, [el('i')]), el('b', { text: item.text })]),
      ]),
    ];
    if (done || locked) {
      kids.push(el('span', { class: 'c-mark', 'aria-hidden': 'true', text: locked ? '✓' : '✕' }));
    } else {
      var up = P.nextFree(st.locked, place, -1), down = P.nextFree(st.locked, place, 1);
      kids.push(el('span', { class: 'c-moves' }, [
        el('button', { class: 'mv up', type: 'button', 'aria-label': 'Move ' + item.name + ' up', disabled: up < 0, 'data-step': '-1', text: '▲' }),
        el('button', { class: 'mv down', type: 'button', 'aria-label': 'Move ' + item.name + ' down', disabled: down < 0, 'data-step': '1', text: '▼' }),
      ]));
    }
    var cls = 'card' + (locked ? ' locked' : '') + (done ? ' done' + (locked ? '' : ' missed') : '');
    return el('li', { class: cls, 'data-id': item.id, 'data-place': String(place), 'aria-label': label }, kids);
  }

  // Draw the cards in S.order. Places locked so far are marked; once the day is over, every
  // card shows its value. `before` (id -> top on screen) slides cards from where they were.
  function renderCards(before) {
    var st = state(), list = $('cards'), lockedNow = st.over ? finalLocks() : st.locked;
    list.textContent = '';
    S.order.forEach(function (index, place) { list.appendChild(card(place, S.puzzle.items[index], lockedNow[place], st)); });
    if (before) slideFrom(before);
    renderPips();
  }
  // At the end, the places the last try had right (the others are marked as missed).
  function finalLocks() {
    var last = S.tries[S.tries.length - 1];
    return P.lockedAfter(last ? [last] : []);
  }
  function tops() {
    var out = {};
    cardEls().forEach(function (li) { out[li.getAttribute('data-id')] = li.getBoundingClientRect().top; });
    return out;
  }
  // Slide each card from its old position on screen to its new one.
  function slideFrom(before) {
    if (REDUCED) return;
    cardEls().forEach(function (li) {
      var b = before[li.getAttribute('data-id')];
      if (b === undefined) return;
      var dy = b - li.getBoundingClientRect().top;
      if (Math.abs(dy) < 1) return;
      li.style.transition = 'none';
      li.style.transform = 'translateY(' + dy + 'px)';
      li.getBoundingClientRect();
      li.style.transition = '';
      li.style.transform = '';
    });
  }

  function renderPips() {
    var st = state(), pips = $('pips');
    pips.textContent = '';
    for (var i = 0; i < P.TRIES; i++) {
      var used = i < st.used, won = st.solved && i === st.used - 1, now = !st.over && i === st.used;
      var label = 'Try ' + (i + 1) + ': ' + (won ? 'solved' : used ? 'used' : now ? 'this one' : 'still to come');
      pips.appendChild(el('li', { class: 'pip' + (won ? ' won' : used ? ' used' : '') + (now ? ' now' : ''), 'aria-label': label }));
    }
  }

  function renderAfter() {
    var st = state(), hint = $('hint');
    $('after').hidden = st.over;
    if (st.over) return;
    hint.textContent = '';
    if (!S.moved && !st.used) {
      hint.textContent = 'Drag to put them in order, then lock in';
    } else if (st.used) {
      var right = P.inPlace(S.tries[st.used - 1]);
      hint.appendChild(el('b', { text: right + ' of 5 in place. ' }));
      hint.appendChild(document.createTextNode(plural(P.TRIES - st.used, 'try', 'tries') + ' left'));
    } else {
      hint.textContent = 'Lock in when you are happy with the order';
    }
    $('lock-btn').disabled = S.busy;
  }

  // ---- moving cards

  // Move the card in place `from` to place `to`, saving the new order. `before` slides the
  // cards from where they were drawn. Returns false if nothing moved.
  function commitMove(from, to, before) {
    var st = state();
    if (S.busy || st.over || from === to || to < 0) return false;
    if (!syncBeforeWrite()) return false;
    var next = P.move(S.order, st.locked, from, to);
    if (next.every(function (v, i) { return v === S.order[i]; })) return false;
    var item = S.puzzle.items[S.order[from]];
    S.order = next;
    S.moved = true;
    if (S.persist) snapshot();
    renderCards(before);
    renderAfter();
    $('live').textContent = item.name + ' moved to place ' + (to + 1) + ' of 5.';
    return true;
  }

  // The arrow buttons: move one free place up or down, and keep the focus on the card moved.
  function stepCard(li, step) {
    var place = Number(li.getAttribute('data-place')), id = li.getAttribute('data-id');
    var to = P.nextFree(state().locked, place, step);
    if (to < 0) return;
    if (!commitMove(place, to, tops())) return;
    var moved = $('cards').querySelector('.card[data-id="' + id + '"]');
    if (!moved) return;
    var same = moved.querySelector(step < 0 ? '.mv.up' : '.mv.down'), other = moved.querySelector(step < 0 ? '.mv.down' : '.mv.up');
    (same && !same.disabled ? same : other).focus({ preventScroll: true });
  }

  /*
   * Dragging, with pointer events so it works the same for a finger, a pen or a mouse. The
   * card follows the pointer, the other free cards slide out of its way, and on release it
   * drops into the nearest free place. Cards have a fixed height, so the place tops measured
   * when the drag starts hold throughout.
   */
  var drag = null;
  function onPointerDown(e) {
    if (drag || (e.pointerType === 'mouse' && e.button !== 0)) return;
    var li = e.target.closest && e.target.closest('.card');
    if (!li || e.target.closest('button') || li.classList.contains('locked') || li.classList.contains('done')) return;
    if (S.busy || state().over) return;
    var lis = cardEls();
    drag = {
      id: e.pointerId, li: li, lis: lis, from: Number(li.getAttribute('data-place')), y0: e.clientY, dy: 0, started: false,
      tops: lis.map(function (l) { return l.offsetTop; }),
    };
    drag.to = drag.from;
    try { li.setPointerCapture(e.pointerId); } catch (err) { /* the drag still works while the pointer stays on the card */ }
    e.preventDefault();
  }
  function onPointerMove(e) {
    if (!drag || e.pointerId !== drag.id) return;
    var d = drag, dy = e.clientY - d.y0;
    if (!d.started) {
      if (Math.abs(dy) < 4) return;
      d.started = true;
      d.li.classList.add('dragging');
    }
    // Keep the card within the column.
    dy = Math.max(d.tops[0] - d.tops[d.from], Math.min(d.tops[d.tops.length - 1] - d.tops[d.from], dy));
    d.dy = dy;
    d.li.style.transform = 'translateY(' + dy + 'px)';
    var locked = state().locked, y = d.tops[d.from] + dy, best = d.from, bestGap = Infinity;
    d.tops.forEach(function (t, i) {
      if (!locked[i] && Math.abs(t - y) < bestGap) { best = i; bestGap = Math.abs(t - y); }
    });
    if (best === d.to) return;
    d.to = best;
    var next = P.move(S.order, locked, d.from, best);
    d.lis.forEach(function (l, j) {
      if (j === d.from) return;
      var k = next.indexOf(S.order[j]);
      l.style.transform = k === j ? '' : 'translateY(' + (d.tops[k] - d.tops[j]) + 'px)';
    });
  }
  function endDrag(e, cancelled) {
    if (!drag || e.pointerId !== drag.id) return;
    var d = drag;
    drag = null;
    d.li.classList.remove('dragging');
    if (!d.started) return;
    if (cancelled || d.to === d.from) {
      d.lis.forEach(function (l) { l.style.transform = ''; });
      return;
    }
    // Where the card is on screen now, so it can glide the rest of the way into its place.
    var before = tops();
    if (!commitMove(d.from, d.to, before)) d.lis.forEach(function (l) { l.style.transform = ''; });
  }

  // ---- locking in

  function lockIn() {
    var st = state();
    if (S.busy || st.over) return;
    if (!syncBeforeWrite()) return;
    var before = st.locked;
    S.tries.push(S.order.slice());
    S.moved = true;
    st = state();
    if (S.persist) {
      if (st.over) store.stats = P.recordResult(store.stats, S.day, st.solved ? st.used : 0);
      snapshot();
    }
    var right = P.inPlace(S.order);
    if (st.over) {
      S.busy = true;
      renderCards();
      cardEls().forEach(function (li, place) { li.classList.add(S.order[place] === place ? 'hit' : 'miss'); });
      $('after').hidden = true;
      $('live').textContent = st.solved ? 'All five in place.' : right + ' of 5 in place. No tries left.';
      // The reveal belongs to this game: if another starts first (a new day in preview), it is dropped.
      var game = S;
      setTimeout(function () { if (S === game) reveal(); }, REDUCED ? 0 : 750);
      return;
    }
    renderCards();
    cardEls().forEach(function (li, place) {
      if (st.locked[place] && !before[place]) li.classList.add('hit');
      else if (!st.locked[place]) li.classList.add('miss');
    });
    renderAfter();
    $('live').textContent = right + ' of 5 in place. ' + plural(P.TRIES - st.used, 'try', 'tries') + ' left.';
    $('lock-btn').focus({ preventScroll: true });
  }

  // The day is over: cards glide into the right order, the bars grow, the result card appears.
  function reveal() {
    var before = tops();
    S.order = [0, 1, 2, 3, 4];
    renderCards(before);
    showDone(true);
  }

  function showDone(justFinished) {
    S.busy = false;
    $('after').hidden = true;
    // Bars are drawn against the largest of the five.
    var max = Math.max.apply(null, S.puzzle.items.map(function (it) { return it.value; }));
    var bars = cardEls().map(function (li) {
      var item = S.puzzle.items.filter(function (it) { return it.id === li.getAttribute('data-id'); })[0];
      return [li.querySelector('.c-bar i'), Math.max(2, item.value / max * 100)];
    });
    var grow = function () { bars.forEach(function (b) { b[0].style.width = b[1].toFixed(1) + '%'; }); };
    if (justFinished && !REDUCED) requestAnimationFrame(function () { requestAnimationFrame(grow); });
    else {
      bars.forEach(function (b) { b[0].style.transition = 'none'; });
      grow();
    }
    renderResults(justFinished);
  }

  // ---- the result card

  var TITLES = ['Spot on', 'Nicely sorted', 'Just made it'];
  function renderResults(justFinished) {
    var st = state(), box = $('results'), last = S.tries[S.tries.length - 1], right = P.inPlace(last);
    box.textContent = '';
    box.hidden = false;
    box.appendChild(el('div', { class: 'score-head' }, [
      el('div', { class: 'score', 'aria-label': st.solved ? 'Solved in ' + plural(st.used, 'try', 'tries') : 'Not solved' }, [st.solved ? String(st.used) : 'X', el('span', { text: '/' + P.TRIES })]),
      el('div', {}, [
        el('h2', { class: 'score-title', text: st.solved ? TITLES[st.used - 1] : 'Out of tries' }),
        el('p', { class: 'score-sub', text: st.solved ? 'All five in order on try ' + st.used + ' of ' + P.TRIES + '.' : 'In place at the end: ' + right + ' of 5.' }),
      ]),
    ]));
    box.appendChild(el('ol', { class: 'grid', 'aria-hidden': 'true' }, S.tries.map(function (t) {
      return el('li', {}, P.marks(t).map(function (ok) { return el('span', { class: ok ? 'ok' : '' }); }));
    })));
    var src = S.puzzle.measure.source;
    box.appendChild(el('p', { class: 'source' }, ['Figures: ', el('a', { href: src.url, target: '_blank', rel: 'noopener', text: src.text }), '.']));
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
      $('live').textContent = (st.solved ? 'Solved in ' + plural(st.used, 'try', 'tries') + '. ' : 'Out of tries. ') + 'The right order: ' +
        S.puzzle.items.map(function (it) { return it.name + ', ' + it.text; }).join('; ') + '.';
      if (st.solved) celebrate();
      box.querySelector('.primary').focus({ preventScroll: true });
      if (!REDUCED) setTimeout(function () { box.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); }, 900);
    }
  }

  function celebrate() {
    if (REDUCED) return;
    var bits = ['🪶', '🐣', '🥚', '🪶', '🐥'];
    var layer = el('div', { class: 'confetti', 'aria-hidden': 'true' });
    for (var i = 0; i < 16; i++) {
      layer.appendChild(el('span', {
        text: bits[i % bits.length],
        style: '--x:' + (Math.random() * 96).toFixed(1) + '%;--delay:' + (0.6 + Math.random() * 0.5).toFixed(2) + 's;--spin:' +
          Math.round(Math.random() * 360 - 180) + 'deg;--time:' + (1.5 + Math.random()).toFixed(2) + 's',
      }));
    }
    document.body.appendChild(layer);
    setTimeout(function () { layer.remove(); }, 4000);
  }

  // ---- sharing

  function share() {
    var text = P.shareText(S.day, S.tries, SITE_URL);
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
    var newDay = today() !== S.day, st = state();
    // A day nobody has touched moves on by itself. One in progress can be finished first.
    if (newDay && !S.moved && !st.used && !drag) { startGame(today(), true); return; }
    var box = $('next');
    if (!box || !st.over || $('results').hidden) return;
    if (newDay) {
      if (box.getAttribute('data-ready')) return;
      box.setAttribute('data-ready', '1');
      box.textContent = 'A new question is ready. ';
      box.appendChild(el('button', { class: 'chip-btn', type: 'button', text: 'Play', onclick: function () { startGame(today(), true); } }));
      return;
    }
    var s = Math.floor(P.msUntilTomorrow() / 1000);
    box.textContent = 'Next question in ';
    box.appendChild(el('b', { text: pad(Math.floor(s / 3600)) + ':' + pad(Math.floor(s / 60) % 60) + ':' + pad(s % 60) }));
  }

  // ---- stats

  function openStats() {
    var st = store.stats, body = $('stats-body');
    var most = Math.max.apply(null, st.dist.concat([1]));
    var game = state(), todayTries = S.persist && game.solved && st.lastDay === S.day ? game.used : 0;
    body.textContent = '';
    body.appendChild(el('div', { class: 'nums' }, [
      num(st.played, 'Played'),
      num(st.played ? Math.round(st.solved / st.played * 100) : 0, 'Solved %'),
      num(st.lastDay >= today() - 1 ? st.streak : 0, 'Day streak'),
      num(st.best, 'Best streak'),
    ]));
    body.appendChild(el('h3', { text: 'Solved in' }));
    body.appendChild(el('ol', { class: 'hist' }, st.dist.map(function (n, i) {
      return el('li', {}, [
        el('span', { text: plural(i + 1, 'try', 'tries') }),
        el('span', { class: 'hist-bar' + (todayTries === i + 1 ? ' today' : ''), style: 'width:' + Math.max(8, Math.round(n / most * 100)) + '%', text: String(n) }),
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

  var cards = $('cards');
  cards.addEventListener('pointerdown', onPointerDown);
  cards.addEventListener('pointermove', onPointerMove);
  cards.addEventListener('pointerup', function (e) { endDrag(e, false); });
  cards.addEventListener('pointercancel', function (e) { endDrag(e, true); });
  cards.addEventListener('lostpointercapture', function (e) { endDrag(e, false); });
  // The page must not scroll under a finger that is dragging a card.
  cards.addEventListener('touchmove', function (e) { if (drag) e.preventDefault(); }, { passive: false });
  cards.addEventListener('click', function (e) {
    var btn = e.target.closest && e.target.closest('.mv');
    if (btn && !btn.disabled) stepCard(btn.closest('.card'), Number(btn.getAttribute('data-step')));
  });
  // Up and down arrow keys on a card's buttons move that card.
  cards.addEventListener('keydown', function (e) {
    var btn = e.target.closest && e.target.closest('.mv');
    if (!btn || (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') || e.altKey || e.ctrlKey || e.metaKey) return;
    e.preventDefault();
    if (!e.repeat) stepCard(btn.closest('.card'), e.key === 'ArrowUp' ? -1 : 1);
  });
  // A held key repeats, and focus moves on after a move or a lock-in, so each repeat would
  // press another button. Only the first press of a key counts.
  document.addEventListener('keydown', function (e) {
    if (!e.repeat || (e.key !== 'Enter' && e.key !== ' ')) return;
    if (e.target.closest && e.target.closest('button')) e.preventDefault();
  }, true);
  $('lock-btn').addEventListener('click', lockIn);
  $('help-btn').addEventListener('click', function () { openDialog('help'); });
  $('stats-btn').addEventListener('click', openStats);
  Array.prototype.forEach.call(document.querySelectorAll('dialog'), function (d) {
    d.addEventListener('click', function (e) {
      if (e.target === d || (e.target.closest && e.target.closest('[data-close]'))) closeDialog(d);
    });
  });
  $('contrast').addEventListener('change', function () {
    // Read the store again first, so this write carries what another tab has saved since.
    reread();
    store.contrast = $('contrast').checked;
    save();
    applyContrast();
  });
  $('prev-day').addEventListener('click', function () { if (S.day > 1) startGame(S.day - 1, false); });
  $('next-day').addEventListener('click', function () { startGame(S.day + 1, false); });
  // Another tab saved something: take its copy. Redraw if it has played this day further, or
  // move on to its day if that is later: this tab can no longer save its own.
  window.addEventListener('storage', function (e) {
    if (e.key !== STORE_KEY || !reread()) return;
    applyContrast();
    if (!S.persist || S.busy) return;
    var theirs = store.game;
    if (savedIsLaterDay()) {
      startGame(Math.max(today(), theirs.day), true);
    } else if (theirs && theirs.day === S.day) {
      if (savedIsNewer()) startGame(S.day, true);
    } else if (S.tries.length || S.moved) {
      // Their copy has no trace of this tab's day (it was on an earlier one): put ours back.
      snapshot();
    }
  });
  document.addEventListener('visibilitychange', function () { if (!document.hidden) tick(); });
  setInterval(tick, 1000);

  applyContrast();
  startGame(forcedDay > 0 ? forcedDay : today(), !PREVIEW);
})();
