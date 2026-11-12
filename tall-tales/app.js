/*
 * Tall Tales page. Shows the day's cards one at a time, takes an answer by swipe, button or
 * arrow key, turns the card over to show the answer, then shows the score. Keeps the player's
 * progress in localStorage. The rules (which cards, scoring, stats, share text) are in logic.js.
 */
(function () {
  'use strict';

  var T = window.TallTales;
  var CARDS = window.TALL_TALES_CARDS;
  var DAYS = window.TALL_TALES_DAYS;

  // The address added to shared results. Empty until the game has a home.
  var SITE_URL = 'https://thombee.github.io/games/tall-tales/';
  var STORE_KEY = 'tall-tales:v1';

  var root = document.documentElement;
  var forcedDay = parseInt(new URLSearchParams(location.search).get('day'), 10);
  // Preview mode plays any day and saves nothing. It is on for ?day=N and for preview builds.
  var PREVIEW = root.hasAttribute('data-preview') || forcedDay > 0;
  var TOUCH = window.matchMedia('(pointer: coarse)').matches;
  // Asked each time something would move, so a change of setting applies straight away.
  function reducedMotion() { return window.matchMedia('(prefers-reduced-motion: reduce)').matches; }

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

  function answerWord(isTrue) { return isTrue ? 'True' : 'Tall tale'; }
  // A small coloured label: "✓ True" or "✕ Tall tale".
  function pill(isTrue) {
    return el('span', { class: 'pill ' + (isTrue ? 'is-true' : 'is-tall') }, [(isTrue ? '✓ ' : '✕ ') + answerWord(isTrue)]);
  }

  // ---- saved progress

  function emptyStore() { return { v: 1, stats: T.emptyStats(), game: null, contrast: false, hinted: false }; }
  // The saved progress, or null if this browser will not let the page read localStorage.
  function readStore() {
    var raw;
    try { raw = localStorage.getItem(STORE_KEY); } catch (e) { return null; }
    var s = emptyStore();
    try {
      var d = JSON.parse(raw || 'null');
      if (!d || d.v !== 1) return s;
      var st = d.stats || {};
      ['played', 'total', 'streak', 'best', 'lastDay'].forEach(function (k) {
        if (Number.isFinite(st[k]) && st[k] >= 0) s.stats[k] = Math.floor(st[k]);
      });
      if (Array.isArray(st.dist) && st.dist.length === s.stats.dist.length) {
        s.stats.dist = st.dist.map(function (n) { return Number.isFinite(n) && n >= 0 ? Math.floor(n) : 0; });
      }
      if (d.game && Number.isFinite(d.game.day) && Array.isArray(d.game.picks)) {
        s.game = {
          day: d.game.day,
          picks: d.game.picks.filter(function (p) { return p === true || p === false; }).slice(0, T.ROUNDS),
        };
      }
      s.contrast = d.contrast === true;
      s.hinted = d.hinted === true;
    } catch (e) { /* corrupt: start clean */ }
    return s;
  }

  /*
   * Once a write has failed (or storage could not be read at all), the copy in memory is the
   * only truth: the page stops reading storage back, so it never swaps the player's progress
   * for an older saved copy. Preview mode is memory-only from the start: it reads the saved
   * settings once, and nothing changed there (a game, the contrast setting) is ever written.
   */
  var memoryOnly = PREVIEW;
  function save() {
    if (memoryOnly) return;
    try { localStorage.setItem(STORE_KEY, JSON.stringify(store)); } catch (e) { memoryOnly = true; cannotSave(); }
  }
  // Read storage again, so a write carries what another tab has saved since.
  function refresh() {
    if (memoryOnly) return;
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
  if (!store) { store = emptyStore(); memoryOnly = true; cannotSave(); }

  // ---- the current day's game

  // day, persist (false in preview), cards, picks (true for True, false for Tall tale, per
  // card played), revealed (true while the answer to the latest pick is on screen).
  var S = null;

  function today() { return Math.max(1, T.dayNumber()); }

  function startGame(day, persist) {
    S = { day: day, persist: persist, cards: T.dailyCards(day, CARDS, DAYS), picks: [], revealed: false };
    if (persist && store.game && store.game.day === day) S.picks = store.game.picks.slice();
    $('day-tag').textContent = '#' + day;
    $('preview-bar').hidden = !PREVIEW;
    $('preview-day').textContent = 'Day ' + day;
    if (finished()) renderResults(false); else renderCard(false);
  }
  function finished() { return S.picks.length >= T.ROUNDS; }
  function snapshot() {
    store.game = { day: S.day, picks: S.picks.slice() };
    save();
  }

  function samePicks(a, b) {
    return a.length === b.length && a.every(function (p, i) { return p === b[i]; });
  }
  // True if the saved game is for this tab's day and is ahead of this tab or at odds with it.
  function savedIsNewer() {
    var theirs = store.game;
    return !!theirs && theirs.day === S.day && theirs.picks.length >= S.picks.length && !samePicks(theirs.picks, S.picks);
  }

  // The player says True (pick = true) or Tall tale (pick = false) for the card on screen.
  function choose(pick, swiped) {
    if (S.revealed || finished()) return;
    if (S.persist && !memoryOnly) {
      // Read the store again first, so what another tab has saved is not overwritten. If that
      // tab is on a later day, or has played this day further or differently, take its game
      // instead of recording this answer.
      refresh();
      if (store.game && store.game.day > S.day) { startGame(store.game.day, true); return; }
      if (savedIsNewer()) { startGame(S.day, true); return; }
    }
    S.picks.push(pick);
    S.revealed = true;
    // The swipe hint has done its job; it is saved with the game (never in preview).
    store.hinted = true;
    if (S.persist) {
      if (finished()) store.stats = T.recordResult(store.stats, S.day, T.score(S.cards, S.picks));
      snapshot();
    }
    reveal(pick, swiped);
  }

  function next() {
    if (!S.revealed) return;
    S.revealed = false;
    if (finished()) { renderResults(true); return; }
    renderCard(true);
    $('card').focus({ preventScroll: true });
  }

  // ---- drawing a card

  function renderDots() {
    var dots = $('dots'), at = S.revealed ? S.picks.length - 1 : S.picks.length;
    dots.textContent = '';
    S.cards.forEach(function (c, i) {
      var state = i < S.picks.length ? (T.isRight(c, S.picks[i]) ? 'right' : 'wrong') : '';
      var label = 'Card ' + (i + 1) + ': ' + (state || (i === at ? 'now playing' : 'still to come'));
      dots.appendChild(el('li', { class: 'dot ' + state + (i === at && !finished() ? ' now' : ''), 'aria-label': label }, [
        state && el('span', { 'aria-hidden': 'true', text: state === 'right' ? '✓' : '✕' }),
      ]));
    });
  }

  var card = $('card');
  function resetCardMotion() {
    card.style.transition = '';
    card.style.transform = '';
    setStamps(0);
    card.classList.remove('dragging', 'enter', 'flip-in', 'answered');
  }

  function renderCard(animate) {
    var i = S.picks.length, c = S.cards[i];
    $('play').hidden = false;
    $('results').hidden = true;
    cancelDrag();
    resetCardMotion();
    $('card-pos').textContent = 'Card ' + (i + 1) + ' of ' + T.ROUNDS + '.';
    $('kind').textContent = T.KINDS[c.kind].label;
    $('emoji').textContent = c.emoji;
    $('claim').textContent = c.claim;
    $('claim').classList.toggle('long', c.claim.length > 80);
    $('back').setAttribute('aria-hidden', 'true');
    $('front').removeAttribute('aria-hidden');
    $('choices').hidden = false;
    $('next-btn').hidden = true;
    // The first card a player ever sees says how to answer.
    $('hint').hidden = !(i === 0 && !store.hinted);
    $('hint').classList.remove('spent');
    if (animate && !reducedMotion()) {
      void card.offsetWidth; // restart the animation
      card.classList.add('enter');
    }
    renderDots();
  }

  // Show the answer to the card the player has just answered.
  function reveal(pick, swiped) {
    var i = S.picks.length - 1, c = S.cards[i], right = T.isRight(c, pick);
    $('answer').className = 'answer ' + (c.answer ? 'is-true' : 'is-tall');
    $('answer').textContent = (c.answer ? '✓ ' : '✕ ') + answerWord(c.answer);
    $('outcome').textContent = right ? 'You got it.' : 'Not this time: you said ' + answerWord(pick) + '.';
    $('explain').textContent = c.explain;
    $('source').textContent = 'Source: ' + c.source.title;
    $('source').href = c.source.url;
    // The hint keeps its space until the next card, so nothing jumps.
    $('hint').classList.add('spent');
    $('choices').hidden = true;
    var btn = $('next-btn');
    btn.textContent = finished() ? 'See my score' : 'Next';
    btn.hidden = false;
    $('live').textContent = (right ? 'Right. ' : 'Not this time. ') + 'It\'s ' + (c.answer ? 'true' : 'a tall tale') + '. ' + c.explain;
    renderDots();

    var turnOver = function () {
      cancelDrag();
      card.style.transition = 'none';
      card.style.transform = '';
      setStamps(0);
      card.classList.remove('dragging', 'enter');
      card.classList.add('answered');
      if (!reducedMotion()) {
        void card.offsetWidth;
        card.classList.add('flip-in');
      }
      $('front').setAttribute('aria-hidden', 'true');
      $('back').removeAttribute('aria-hidden');
    };
    // After a button or key, focus moves to Next. A swipe leaves focus where it was.
    if (!swiped) btn.focus({ preventScroll: true });
    if (reducedMotion()) { turnOver(); return; }
    // The card flies off to the side the player chose, then comes back turned over.
    var dir = pick ? 1 : -1, w = card.offsetWidth;
    setStamps(dir);
    card.style.transition = 'transform ' + (swiped ? '.2s' : '.28s') + ' cubic-bezier(.4, 0, .9, .6)';
    card.style.transform = 'translateX(' + dir * (window.innerWidth / 2 + w) + 'px) rotate(' + dir * 22 + 'deg)';
    var shownFor = S.picks.length;
    setTimeout(function () { if (S.picks.length === shownFor && S.revealed) turnOver(); }, swiped ? 200 : 280);
  }

  // ---- swiping

  // How strongly each stamp shows: x > 0 fades in "True", x < 0 "Tall tale", up to 1 each.
  function setStamps(x) {
    card.querySelector('.stamp-true').style.opacity = String(Math.max(0, Math.min(1, x)));
    card.querySelector('.stamp-tall').style.opacity = String(Math.max(0, Math.min(1, -x)));
  }
  function threshold() { return Math.min(110, card.offsetWidth * 0.3); }
  function place(dx) {
    var tilt = reducedMotion() ? 0 : Math.max(-14, Math.min(14, dx / card.offsetWidth * 22));
    card.style.transition = 'none';
    card.style.transform = 'translateX(' + dx + 'px) rotate(' + tilt + 'deg)';
    setStamps(dx / threshold());
  }

  var drag = null;
  // Forget the drag in progress, if any, and let go of the pointer. Returns the drag.
  function endDrag() {
    var d = drag;
    if (d && d.moving) { try { card.releasePointerCapture(d.id); } catch (e) { /* already released */ } }
    drag = null;
    return d;
  }
  // A drag stopped by something other than the finger lifting (a dialog opening, the browser
  // cancelling the touch, the page losing focus): the card springs back and nothing is answered.
  function cancelDrag() {
    var d = endDrag();
    if (d && d.moving) springBack();
  }
  // Released short of a decision: the card springs back to the middle.
  function springBack() {
    card.classList.remove('dragging');
    if (reducedMotion()) { card.style.transition = 'none'; card.style.transform = ''; setStamps(0); return; }
    card.style.transition = 'transform .32s cubic-bezier(.3, 1.4, .5, 1)';
    card.style.transform = '';
    setStamps(0);
  }

  card.addEventListener('pointerdown', function (e) {
    if (S.revealed || finished() || dialogOpen()) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    drag = { id: e.pointerId, x: e.clientX, y: e.clientY, dx: 0, moving: false, samples: [[e.timeStamp, e.clientX]] };
  });
  card.addEventListener('pointermove', function (e) {
    if (!drag || e.pointerId !== drag.id) return;
    var dx = e.clientX - drag.x, dy = e.clientY - drag.y;
    if (!drag.moving) {
      if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return;
      // A mostly vertical movement is the page scrolling: let it.
      if (Math.abs(dy) >= Math.abs(dx)) { drag = null; return; }
      drag.moving = true;
      try { card.setPointerCapture(e.pointerId); } catch (err) { /* the pointer is already gone */ }
      card.classList.add('dragging');
    }
    e.preventDefault();
    drag.dx = dx;
    drag.samples.push([e.timeStamp, e.clientX]);
    if (drag.samples.length > 6) drag.samples.shift();
    place(dx);
  });
  function release(e) {
    if (!drag || e.pointerId !== drag.id) return;
    var d = endDrag();
    if (!d.moving) return;
    // Speed over the last tenth of a second, in pixels per millisecond: none if the finger
    // stopped before letting go.
    var samples = d.samples.concat([[e.timeStamp, e.clientX]]);
    var recent = samples.filter(function (s) { return e.timeStamp - s[0] <= 100; });
    var first = recent[0], last = recent[recent.length - 1];
    var speed = recent.length < 2 ? 0 : (last[1] - first[1]) / Math.max(1, last[0] - first[0]);
    var flick = Math.abs(speed) > 0.5 && Math.abs(d.dx) > 30 && (speed > 0) === (d.dx > 0);
    if (e.type === 'pointerup' && (Math.abs(d.dx) >= threshold() || flick)) choose(d.dx > 0, true);
    else springBack();
  }
  card.addEventListener('pointerup', release);
  card.addEventListener('pointercancel', release);
  window.addEventListener('blur', cancelDrag);
  document.addEventListener('visibilitychange', function () { if (document.hidden) cancelDrag(); });

  // ---- the score card

  function renderResults(justFinished) {
    var box = $('results'), points = T.score(S.cards, S.picks), fooled = T.surprise(S.cards, S.picks);
    $('play').hidden = true;
    box.hidden = false;
    box.textContent = '';
    renderDots();
    box.appendChild(el('div', { class: 'score-head' }, [
      el('div', { class: 'score', 'aria-label': points + ' out of ' + T.ROUNDS }, [String(points), el('span', { text: '/' + T.ROUNDS })]),
      el('div', {}, [
        el('h2', { class: 'score-title', text: T.title(points) }),
        el('ol', { class: 'marks', 'aria-label': 'Right and wrong, card by card' }, S.cards.map(function (c, i) {
          var right = T.isRight(c, S.picks[i]);
          return el('li', { class: 'mark ' + (right ? 'right' : 'wrong'), 'aria-label': 'Card ' + (i + 1) + ': ' + (right ? 'right' : 'wrong') }, [
            el('span', { 'aria-hidden': 'true', text: right ? '✓' : '✕' }),
          ]);
        })),
      ]),
    ]));
    if (fooled) {
      box.appendChild(el('div', { class: 'fooled' }, [
        el('h3', { text: 'The one that fooled you' }),
        el('p', { class: 'f-claim' }, [fooled.emoji + ' ' + fooled.claim]),
        pill(fooled.answer),
        el('p', { class: 'f-explain', text: fooled.explain }),
        el('a', { class: 'source', href: fooled.source.url, target: '_blank', rel: 'noopener', text: 'Source: ' + fooled.source.title }),
      ]));
    } else {
      box.appendChild(el('p', { class: 'perfect', text: 'Perfect: not one tall tale got past you.' }));
    }
    box.appendChild(el('div', { class: 'actions' }, [
      el('button', { class: 'primary', type: 'button', text: 'Share result', onclick: share }),
      el('button', { class: 'secondary', type: 'button', text: 'Stats', onclick: openStats }),
    ]));
    box.appendChild(el('pre', { class: 'share-text', id: 'share-text', hidden: true }));
    if (S.persist && store.stats.streak >= 2 && store.stats.lastDay === S.day) {
      box.appendChild(el('p', { class: 'streak', text: '🔥 ' + store.stats.streak + ' days in a row' }));
    }
    box.appendChild(el('p', { class: 'next', id: 'next' }));
    box.appendChild(el('h3', { text: 'Today’s cards' }));
    box.appendChild(el('ol', { class: 'recap' }, S.cards.map(function (c, i) {
      var right = T.isRight(c, S.picks[i]);
      return el('li', {}, [
        el('span', { class: 'mark ' + (right ? 'right' : 'wrong') }, [
          el('span', { 'aria-hidden': 'true', text: right ? '✓' : '✕' }),
          el('span', { class: 'sr-only', text: right ? 'You were right: ' : 'You were wrong: ' }),
        ]),
        el('span', { class: 'r-claim' }, [c.claim + ' ', pill(c.answer)]),
      ]);
    })));
    tick();
    if (justFinished) {
      $('live').textContent = 'You scored ' + points + ' out of ' + T.ROUNDS + '. ' + T.title(points) + '.';
      if (points >= 6) celebrate();
      box.querySelector('.primary').focus({ preventScroll: true });
      box.scrollIntoView({ behavior: reducedMotion() ? 'auto' : 'smooth', block: 'start' });
    }
  }

  // A short shower of cards after a high score.
  function celebrate() {
    if (reducedMotion()) return;
    var bits = ['🃏', '✨', '🦉', '🐙', '🍄', '🦘'];
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
    var text = T.shareText(S.day, S.cards, S.picks, SITE_URL);
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
    // A day nobody has started moves on by itself. One in progress can be finished first.
    if (newDay && !S.picks.length) { startGame(today(), true); return; }
    var box = $('next');
    if (!box || !finished() || $('results').hidden) return;
    if (newDay) {
      if (box.getAttribute('data-ready')) return;
      box.setAttribute('data-ready', '1');
      box.textContent = 'New cards are ready. ';
      box.appendChild(el('button', { class: 'chip-btn', type: 'button', text: 'Play', onclick: function () { startGame(today(), true); } }));
      return;
    }
    var s = Math.floor(T.msUntilTomorrow() / 1000);
    box.textContent = 'New cards in ';
    box.appendChild(el('b', { text: pad(Math.floor(s / 3600)) + ':' + pad(Math.floor(s / 60) % 60) + ':' + pad(s % 60) }));
  }

  // ---- stats

  function openStats() {
    var st = store.stats, body = $('stats-body');
    var most = Math.max.apply(null, st.dist.concat([1]));
    var todayScore = S.persist && finished() && st.lastDay === S.day ? T.score(S.cards, S.picks) : -1;
    body.textContent = '';
    body.appendChild(el('div', { class: 'nums' }, [
      num(st.played, 'Played'),
      num(st.played ? (st.total / st.played).toFixed(1) : '0', 'Average'),
      num(st.lastDay >= today() - 1 ? st.streak : 0, 'Day streak'),
      num(st.best, 'Best streak'),
    ]));
    body.appendChild(el('h3', { text: 'Your scores' }));
    body.appendChild(el('ol', { class: 'hist', 'aria-label': 'How often you got each score' }, st.dist.map(function (n, i) {
      return el('li', { 'aria-label': i + ' out of ' + T.ROUNDS + ': ' + n + (n === 1 ? ' time' : ' times') }, [
        el('span', { class: 'hist-count', 'aria-hidden': 'true', text: n ? String(n) : '' }),
        el('span', { class: 'hist-bar' + (todayScore === i ? ' today' : ''), style: 'height:' + Math.round(n / most * 64) + 'px' }),
        el('span', { 'aria-hidden': 'true', text: String(i) }),
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
    cancelDrag();
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

  $('true-btn').addEventListener('click', function () { choose(true, false); });
  $('tall-btn').addEventListener('click', function () { choose(false, false); });
  $('next-btn').addEventListener('click', next);
  // A held key repeats, and focus moves from the answer buttons to Next, so each repeat would
  // play on. Only the first press of a key counts.
  document.addEventListener('keydown', function (e) {
    if (!e.repeat) return;
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') { e.preventDefault(); return; }
    if ((e.key === 'Enter' || e.key === ' ') && e.target.closest && e.target.closest('#play button')) e.preventDefault();
  }, true);
  // The right arrow says True, the left arrow Tall tale.
  document.addEventListener('keydown', function (e) {
    if (e.repeat || dialogOpen() || e.altKey || e.ctrlKey || e.metaKey) return;
    if ($('play').hidden) return;
    if (e.key === 'ArrowLeft') { e.preventDefault(); choose(false, false); }
    else if (e.key === 'ArrowRight') { e.preventDefault(); choose(true, false); }
  });
  $('help-btn').addEventListener('click', function () { openDialog('help'); });
  $('stats-btn').addEventListener('click', openStats);
  Array.prototype.forEach.call(document.querySelectorAll('dialog'), function (d) {
    d.addEventListener('click', function (e) {
      if (e.target === d || (e.target.closest && e.target.closest('[data-close]'))) closeDialog(d);
    });
  });
  $('contrast').addEventListener('change', function () {
    refresh();
    store.contrast = $('contrast').checked;
    save();
    applyContrast();
  });
  $('prev-day').addEventListener('click', function () { if (S.day > 1) startGame(S.day - 1, false); });
  $('next-day').addEventListener('click', function () { startGame(S.day + 1, false); });
  // Another tab saved something: take its copy, and redraw if it has played this day further
  // than this tab, or as far but differently, or has moved on to a later day.
  window.addEventListener('storage', function (e) {
    if (e.key !== STORE_KEY || memoryOnly) return;
    var fresh = readStore();
    if (!fresh) return;
    store = fresh;
    applyContrast();
    if (!S.persist) return;
    var theirs = store.game;
    if (theirs && theirs.day > S.day) {
      startGame(theirs.day, true);
    } else if (theirs && theirs.day === S.day) {
      if (savedIsNewer()) startGame(S.day, true);
    } else if (S.picks.length) {
      // Their copy has no trace of this tab's day (it was on an earlier one): put ours back.
      snapshot();
    }
  });
  document.addEventListener('visibilitychange', function () { if (!document.hidden) tick(); });
  setInterval(tick, 1000);

  applyContrast();
  startGame(forcedDay > 0 ? forcedDay : today(), !PREVIEW);
})();
