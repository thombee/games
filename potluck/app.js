/*
 * Potluck page. Shows the day's recipe card, takes guesses through a searchable list, and
 * shows the result card at the end. Progress is kept in localStorage. The rules (the day's
 * dish, marking, what is on show, share text, stats) are in logic.js.
 */
(function () {
  'use strict';

  var P = window.Potluck;
  var DISHES = window.POTLUCK_DISHES;
  var SCHEDULE = window.POTLUCK_SCHEDULE;
  var REGIONS = {};
  window.POTLUCK_REGIONS.forEach(function (r) { REGIONS[r.id] = r; });
  var byId = {};
  DISHES.forEach(function (d) { byId[d.id] = d; });

  // The address added to shared results. Empty until the game has a home.
  var SITE_URL = 'https://thombee.github.io/games/potluck/';
  var STORE_KEY = 'potluck:v1';

  var root = document.documentElement;
  var forcedDay = parseInt(new URLSearchParams(location.search).get('day'), 10);
  // Preview mode plays any day and saves nothing. It is on for ?day=N and for preview builds.
  var PREVIEW = root.hasAttribute('data-preview') || forcedDay > 0;
  // Whether the system asks for less motion. Asked each time something would move, so a
  // change to the setting while the page is open counts straight away.
  function reduced() { return window.matchMedia('(prefers-reduced-motion: reduce)').matches; }
  var TOUCH = window.matchMedia('(pointer: coarse)').matches;

  var WIN_WORDS = ['First go. Chef’s kiss!', 'Two goes. Impressive!', 'Got it in three!', 'Got it in four!', 'Got it in five!', 'Phew, on the last go!'];
  var NOTES = { region: 'Right part of the world', wrong: 'Somewhere else', skip: 'Skipped', correct: 'That’s it!' };

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
  function regionName(d) { return REGIONS[d.region].name; }
  function capital(s) { return s.charAt(0).toUpperCase() + s.slice(1); }

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
      ['played', 'won', 'streak', 'best', 'lastDay'].forEach(function (k) {
        if (Number.isFinite(st[k]) && st[k] >= 0) s.stats[k] = Math.floor(st[k]);
      });
      s.stats.won = Math.min(s.stats.won, s.stats.played);
      if (Array.isArray(st.dist) && st.dist.length === s.stats.dist.length) {
        s.stats.dist = st.dist.map(function (n) { return Number.isFinite(n) && n >= 0 ? Math.floor(n) : 0; });
      }
      if (d.game && Number.isFinite(d.game.day) && Array.isArray(d.game.guesses)) {
        s.game = {
          day: d.game.day,
          guesses: d.game.guesses.filter(function (id) { return id === null || (typeof id === 'string' && byId[id]); }).slice(0, P.MAX_GUESSES),
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
    $('live').textContent = note.textContent;
  }
  var store = readStore();
  if (!store) { store = emptyStore(); storageFailed = true; cannotSave(); }

  // ---- the current day's game

  // day, persist (false in preview), answer, guesses (a dish, or null for a skip, per go).
  var S = null;

  function today() { return Math.max(1, P.dayNumber()); }

  function startGame(day, persist) {
    var answer = byId[P.answerId(day, SCHEDULE)];
    S = { day: day, persist: persist, answer: answer, guesses: [] };
    if (persist && store.game && store.game.day === day) {
      store.game.guesses.some(function (id) {
        if (P.status(S.guesses, answer).done) return true;
        var d = id === null ? null : byId[id];
        if (d && S.guesses.indexOf(d) >= 0) return false;
        S.guesses.push(d);
        return false;
      });
      // A saved game with a repeat or goes past the end is written back as it was played.
      if (JSON.stringify(ids(S.guesses)) !== JSON.stringify(store.game.guesses)) snapshot();
    }
    $('day-tag').textContent = '#' + day;
    $('preview-bar').hidden = !PREVIEW;
    $('preview-day').textContent = 'Day ' + day;
    $('guess').value = '';
    closeList();
    renderAll(-1);
  }
  function done() { return P.status(S.guesses, S.answer).done; }
  function ids(guesses) { return guesses.map(function (g) { return g ? g.id : null; }); }
  function snapshot() {
    store.game = { day: S.day, guesses: ids(S.guesses) };
    save();
  }
  // True if the saved game is for this tab's day and is ahead of this tab or at odds with it.
  function savedIsNewer() {
    var theirs = store.game, mine = ids(S.guesses);
    return !!theirs && theirs.day === S.day && theirs.guesses.length >= mine.length && JSON.stringify(theirs.guesses) !== JSON.stringify(mine);
  }

  // Play a go: a dish, or null to skip.
  function play(dish) {
    if (done()) return;
    if (dish && S.guesses.indexOf(dish) >= 0) { toast('You already guessed that'); return; }
    if (S.persist) {
      // Read the store again first, so what another tab has saved is not overwritten. If
      // another tab has moved on to a later day, this tab's day is over: show today's game
      // and write nothing. If it has played this day further, or differently, take its game
      // instead of this go.
      var fresh = reread();
      if (fresh) store = fresh;
      if (store.game && store.game.day > S.day) { startGame(today(), true); return; }
      if (savedIsNewer()) { startGame(S.day, true); return; }
    }
    S.guesses.push(dish);
    var st = P.status(S.guesses, S.answer);
    if (S.persist) {
      if (st.done) store.stats = P.recordResult(store.stats, S.day, st.won, st.used);
      snapshot();
    }
    $('guess').value = '';
    closeList();
    if (TOUCH && dish) $('guess').blur();
    renderAll(S.guesses.length - 1);
    announce(dish);
    if (st.done) {
      if (st.won) celebrate();
      var share = $('results').querySelector('.primary');
      if (share) share.focus({ preventScroll: true });
      $('results').scrollIntoView({ behavior: reduced() ? 'auto' : 'smooth', block: 'start' });
    } else if (dish) {
      nudge($('entry').querySelector('.combo'));
    }
  }

  // Replay a short animation on an element.
  function nudge(node) {
    if (reduced() || !node) return;
    node.classList.remove('nudge');
    void node.offsetWidth;
    node.classList.add('nudge');
  }

  function announce(dish) {
    var grade = P.grade(dish, S.answer), parts = [];
    if (grade === 'correct') parts.push('Correct! It’s ' + S.answer.name + '.');
    else if (dish) parts.push(dish.name + ': not it. ' + (grade === 'region' ? 'Right part of the world.' : 'Somewhere else.'));
    else parts.push('Skipped.');
    var st = P.status(S.guesses, S.answer);
    if (!st.won && st.done) parts.push('Out of goes. It was ' + S.answer.name + '.');
    if (!st.done) {
      var n = P.shownIngredients(S.guesses, S.answer);
      parts.push('Ingredient ' + n + ': ' + S.answer.ingredients[n - 1] + '.');
      if (n === P.REGION_FROM) parts.push('It comes from ' + regionName(S.answer) + '.');
    }
    $('live').textContent = parts.join(' ');
  }

  // ---- drawing

  // fresh: the index of the go just played, to animate what it changed; -1 for none.
  function renderAll(fresh) {
    var over = done();
    $('recipe').hidden = over;
    $('entry').hidden = over;
    $('guesses').hidden = over;
    $('results').hidden = !over;
    if (over) { renderResults(fresh >= 0); return; }
    renderSlots(fresh >= 0);
    renderGuesses(fresh);
    var go = S.guesses.length + 1;
    $('count').textContent = 'Go ' + go + ' of ' + P.MAX_GUESSES + (go === 1 ? '. A wrong guess or a skip shows the next ingredient.' : '');
    $('skip').textContent = go === P.MAX_GUESSES ? 'Give up' : 'Skip';
  }

  function renderSlots(animate) {
    var shown = P.shownIngredients(S.guesses, S.answer), ul = $('slots');
    ul.textContent = '';
    for (var i = 0; i < P.INGREDIENTS; i++) {
      var open = i < shown;
      ul.appendChild(el('li', {
        class: 'slot ' + (open ? 'open' : 'shut') + (open && animate && i === shown - 1 ? ' fresh' : ''),
        'aria-label': 'Ingredient ' + (i + 1) + ': ' + (open ? S.answer.ingredients[i] : 'not shown yet'),
      }, [
        el('span', { class: 'slot-n', 'aria-hidden': 'true', text: String(i + 1) }),
        el('span', { class: 'slot-text', 'aria-hidden': 'true', text: open ? capital(S.answer.ingredients[i]) : '?' }),
      ]));
    }
    var region = $('region');
    region.textContent = '';
    if (P.regionShown(S.guesses, S.answer)) {
      region.className = 'region known' + (animate && shown === P.REGION_FROM ? ' fresh' : '');
      region.appendChild(document.createTextNode('From: '));
      region.appendChild(el('b', { text: regionName(S.answer) }));
    } else {
      region.className = 'region';
      region.appendChild(document.createTextNode('From: '));
      region.appendChild(el('b', { text: '?' }));
      region.appendChild(el('span', { class: 'region-hint', text: ' (shown with ingredient ' + P.REGION_FROM + ')' }));
    }
  }

  function renderGuesses(fresh) {
    var ol = $('guesses');
    ol.textContent = '';
    S.guesses.forEach(function (g, i) {
      var grade = P.grade(g, S.answer);
      ol.appendChild(el('li', { class: 'guess g-' + grade + (i === fresh ? ' fresh' : '') }, [
        el('span', { class: 'chip g-' + grade, 'aria-hidden': 'true', text: P.SQUARES[grade] }),
        el('span', { class: 'guess-name' }, g ? [el('span', { 'aria-hidden': 'true', text: g.emoji + ' ' }), g.name] : ['Skipped']),
        g ? el('span', { class: 'guess-note', text: NOTES[grade] }) : null,
      ]));
    });
  }

  // ---- the result card

  function renderResults(justFinished) {
    var box = $('results'), a = S.answer, st = P.status(S.guesses, a);
    box.textContent = '';
    box.className = 'results' + (st.won ? ' won' : ' lost') + (justFinished ? ' fresh' : '');
    box.appendChild(el('p', { class: 'res-kicker', text: st.won ? WIN_WORDS[st.used - 1] : 'Out of goes. It was…' }));
    box.appendChild(el('div', { class: 'res-emoji', 'aria-hidden': 'true', text: a.emoji }));
    box.appendChild(el('h2', { class: 'res-name', id: 'result-name', text: a.name }));
    box.appendChild(el('p', { class: 'res-origin', text: 'From ' + a.origin + ' · ' + regionName(a) }));
    box.appendChild(el('p', { class: 'res-blurb', text: a.blurb }));
    box.appendChild(el('ol', { class: 'res-ings', 'aria-label': 'The six ingredients' }, a.ingredients.map(function (ing, i) {
      return el('li', {}, [el('span', { class: 'slot-n', 'aria-hidden': 'true', text: String(i + 1) }), el('span', { class: 'res-ing', text: capital(ing) })]);
    })));
    var spoken = S.guesses.map(function (g) { var gr = P.grade(g, a); return g ? g.name + ', ' + NOTES[gr].toLowerCase() : 'skipped'; }).join('; ');
    box.appendChild(el('p', { class: 'res-goes', 'aria-label': 'Your goes: ' + spoken }, S.guesses.map(function (g) {
      var gr = P.grade(g, a);
      return el('span', { class: 'chip g-' + gr, 'aria-hidden': 'true', title: g ? g.name : 'Skipped', text: P.SQUARES[gr] });
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

  // A short shower of ingredients after a win.
  function celebrate() {
    if (reduced()) return;
    var bits = [S.answer.emoji, '🧄', '🌶️', '🍋', '🌿', '🥄'];
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
    var text = P.shareText(S.day, S.guesses, S.answer, SITE_URL);
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

  // ---- the clock: countdown to the next dish, and moving on when it arrives

  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function tick() {
    if (!S.persist) {
      if ($('next')) $('next').textContent = 'Preview: use the arrows at the top to try another day.';
      return;
    }
    var newDay = today() !== S.day;
    // A day nobody has started moves on by itself. One in progress can be finished first.
    if (newDay && !S.guesses.length) { startGame(today(), true); return; }
    var box = $('next');
    if (!box || !done()) return;
    if (newDay) {
      if (box.getAttribute('data-ready')) return;
      box.setAttribute('data-ready', '1');
      box.textContent = 'A new dish is ready. ';
      box.appendChild(el('button', { class: 'chip-btn', type: 'button', text: 'Play', onclick: function () { startGame(today(), true); focusGuess(); } }));
      return;
    }
    var s = Math.floor(P.msUntilTomorrow() / 1000);
    box.textContent = 'Next dish in ';
    box.appendChild(el('b', { text: pad(Math.floor(s / 3600)) + ':' + pad(Math.floor(s / 60) % 60) + ':' + pad(s % 60) }));
  }
  function focusGuess() { if (!done() && !TOUCH) $('guess').focus({ preventScroll: true }); }

  // ---- stats

  function openStats() {
    var st = store.stats, body = $('stats-body');
    var lost = st.played - st.won;
    var most = Math.max.apply(null, st.dist.concat([lost, 1]));
    var mine = S.persist && done() && st.lastDay === S.day ? P.status(S.guesses, S.answer) : null;
    body.textContent = '';
    body.appendChild(el('div', { class: 'nums' }, [
      num(st.played, 'Played'),
      num(st.played ? Math.round(100 * st.won / st.played) : 0, 'Win %'),
      num(st.lastDay >= today() - 1 ? st.streak : 0, 'Day streak'),
      num(st.best, 'Best streak'),
    ]));
    body.appendChild(el('h3', { text: 'Goes needed' }));
    var rows = st.dist.map(function (n, i) { return [String(i + 1), n, !!mine && mine.won && mine.used === i + 1]; });
    rows.push(['X', lost, !!mine && !mine.won]);
    body.appendChild(el('ol', { class: 'dist', 'aria-label': 'How many goes your wins took' }, rows.map(function (r) {
      var label = r[0] === 'X' ? 'Not solved' : 'In ' + r[0] + (r[0] === '1' ? ' go' : ' goes');
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

  // ---- the dish picker: a text box with a list of matching dishes

  var shown = [], active = -1;

  function guessed(d) { return S.guesses.indexOf(d) >= 0; }

  function openList() {
    if (done()) return;
    var input = $('guess'), ul = $('options');
    shown = P.search(DISHES, input.value);
    ul.textContent = '';
    shown.forEach(function (d, i) {
      ul.appendChild(el('li', {
        class: 'opt', role: 'option', id: 'opt-' + i, 'data-id': d.id,
        'aria-selected': 'false', 'aria-disabled': guessed(d) ? 'true' : null,
      }, [
        el('span', { 'aria-hidden': 'true', text: d.emoji }),
        el('span', { class: 'opt-name', text: d.name }),
        el('span', { class: 'opt-region', text: REGIONS[d.region].short }),
      ]));
    });
    if (!shown.length) ul.appendChild(el('li', { class: 'opt-none', text: 'No dish by that name. Try another word.' }));
    // The first dish not yet guessed is ready for Enter, unless the text names a dish exactly
    // and that one has been guessed: then nothing is, so Enter cannot pick a different dish.
    var exact = P.exactMatch(DISHES, input.value);
    active = P.fold(input.value) && !(exact && guessed(exact)) ? step(-1, 1) : -1;
    ul.hidden = false;
    ul.scrollTop = 0;
    input.setAttribute('aria-expanded', 'true');
    markActive();
  }
  function closeList() {
    $('options').hidden = true;
    $('guess').setAttribute('aria-expanded', 'false');
    $('guess').removeAttribute('aria-activedescendant');
    active = -1;
  }
  // The next dish not yet guessed, moving from index `from` in direction `dir`; -1 if none.
  function step(from, dir) {
    for (var n = 1; n <= shown.length; n++) {
      var i = (((from + dir * n) % shown.length) + shown.length) % shown.length;
      if (!guessed(shown[i])) return i;
    }
    return -1;
  }
  function markActive() {
    var ul = $('options');
    Array.prototype.forEach.call(ul.children, function (li, i) {
      if (li.getAttribute('role') === 'option') li.setAttribute('aria-selected', i === active ? 'true' : 'false');
    });
    if (active >= 0) {
      $('guess').setAttribute('aria-activedescendant', 'opt-' + active);
      ul.children[active].scrollIntoView({ block: 'nearest' });
    } else {
      $('guess').removeAttribute('aria-activedescendant');
    }
  }
  function onKey(e) {
    var ul = $('options');
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (ul.hidden) { openList(); return; }
      if (!shown.length) return;
      var dir = e.key === 'ArrowDown' ? 1 : -1;
      active = step(active < 0 && dir < 0 ? 0 : active, dir);
      markActive();
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (e.repeat) return;
      var typed = P.fold($('guess').value);
      var exact = P.exactMatch(DISHES, typed);
      if (active >= 0 && !ul.hidden) play(shown[active]);
      else if (typed && exact) play(exact);
      else if (typed) toast('Pick a dish from the list');
      else openList();
    } else if (e.key === 'Escape') {
      if (!ul.hidden) { e.preventDefault(); closeList(); }
    }
  }

  // ---- dialogs, toast, settings

  function openDialog(id) {
    var d = $(id);
    closeList();
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

  $('guess').addEventListener('input', openList);
  $('guess').addEventListener('focus', openList);
  // A click on a box that already has focus fires no focus event, so open the list on click too.
  $('guess').addEventListener('click', function () { if ($('options').hidden) openList(); });
  $('guess').addEventListener('keydown', onKey);
  // Keep the text box focused while the list is clicked, so the list does not close first.
  $('options').addEventListener('mousedown', function (e) { e.preventDefault(); });
  $('options').addEventListener('click', function (e) {
    var li = e.target.closest ? e.target.closest('.opt') : null;
    if (li && li.getAttribute('aria-disabled') !== 'true' && byId[li.getAttribute('data-id')]) play(byId[li.getAttribute('data-id')]);
    else if (li) toast('You already guessed that');
  });
  document.addEventListener('pointerdown', function (e) {
    if (!e.target.closest || !e.target.closest('.combo')) closeList();
  });
  $('skip').addEventListener('click', function () { play(null); });
  // A held Enter or Space key repeats. On Skip each repeat would use up another go, so only
  // the first press of a key counts there.
  document.addEventListener('keydown', function (e) {
    if (e.repeat && (e.key === 'Enter' || e.key === ' ') && e.target.closest && e.target.closest('#skip, #results button')) e.preventDefault();
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
    var fresh = reread();
    if (fresh) store = fresh;
    store.contrast = $('contrast').checked;
    save();
    applyContrast();
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
    if (!S.persist) return;
    var theirs = store.game;
    if (theirs && theirs.day > S.day) {
      // Another tab has moved on to a later day: never write over it.
      startGame(today(), true);
    } else if (theirs && theirs.day === S.day) {
      if (savedIsNewer()) startGame(S.day, true);
    } else if (S.guesses.length) {
      // Their copy has no trace of this tab's day (it was on an earlier one): put ours back.
      snapshot();
    }
  });
  document.addEventListener('visibilitychange', function () { if (!document.hidden) tick(); });
  setInterval(tick, 1000);

  applyContrast();
  startGame(forcedDay > 0 ? forcedDay : today(), !PREVIEW);
})();
