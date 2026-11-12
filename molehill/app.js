/*
 * Molehill page. Draws the day's lawn, turns taps, long presses, right-clicks and keys into
 * digs and daisies, runs the clock, the guided lawn and hints, and keeps the player's
 * progress in localStorage. The rules (lawns, digging, the solver, share text, stats) are
 * in logic.js.
 */
(function () {
  'use strict';

  var P = window.Molehill;
  var BANK = window.MOLEHILL_LAWNS;

  // The address added to shared results. Empty until the game has a home.
  var SITE_URL = 'https://thombee.github.io/games/molehill/';
  var STORE_KEY = 'molehill:v1';
  // While the clock runs, progress is saved at least this often.
  var SAVE_EVERY = 5000;
  // A press held this long marks the square instead of digging it.
  var LONG_PRESS = 450;
  // A pointer that moves further than this from where it went down is a drag or a scroll, not a tap.
  var SLOP = 10;

  var root = document.documentElement;
  // The preview build plays any day as often as you like and saves nothing.
  var PREVIEW_BUILD = root.hasAttribute('data-preview');
  var TOUCH = window.matchMedia('(pointer: coarse)').matches;
  // Checked at the moment of animating, so a change of setting applies straight away.
  function reduced() { return window.matchMedia('(prefers-reduced-motion: reduce)').matches; }
  function today() { return Math.max(1, P.dayNumber()); }

  // ?day=N previews day N: any day in the preview build, only an earlier day otherwise.
  var asked = parseInt(new URLSearchParams(location.search).get('day'), 10);
  var forcedDay = asked > 0 && (PREVIEW_BUILD || asked < today()) ? asked : 0;
  var PREVIEW = PREVIEW_BUILD || forcedDay > 0;

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

  var STATE_RE = /^[.of]+$/;
  function emptyStore() { return { v: 1, stats: P.emptyStats(), game: null, contrast: false, guided: false }; }
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
      ['played', 'cleared', 'clean', 'streak', 'best', 'lastDay', 'hints'].forEach(function (k) { s.stats[k] = count(st[k]); });
      s.stats.cleared = Math.min(s.stats.cleared, s.stats.played);
      s.stats.clean = Math.min(s.stats.clean, s.stats.cleared);
      P.SIZES.forEach(function (k) {
        var b = (st.bySize || {})[k] || {};
        s.stats.bySize[k] = { cleared: count(b.cleared), total: count(b.total), best: count(b.best) };
      });
      var g = d.game;
      if (g && Number.isInteger(g.day) && g.day > 0 && typeof g.state === 'string' && STATE_RE.test(g.state)) {
        s.game = { day: g.day, state: g.state, elapsed: count(g.elapsed), hints: count(g.hints), moves: count(g.moves) };
      }
      s.contrast = d.contrast === true;
      s.guided = d.guided === true;
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

  // ---- the game on screen

  /*
   * day, persist (false in preview and in the guide), guide (true for the guided lawn),
   * lawn, state (one character a square: see logic.js), moves (changes made), hints,
   * outcome ('won', 'lost' or ''), elapsed (ms on the clock before runningSince),
   * runningSince (when the clock last started, or 0 while it is stopped), focus (the square
   * keyboard focus goes to), shownHint (the hint on screen, until the next change).
   */
  var S = null;
  var mode = 'dig';
  var lastSave = 0;

  function outcomeOf(lawn, state) { return P.isLost(lawn, state) ? 'lost' : P.isCleared(lawn, state) ? 'won' : ''; }

  function startGame(day, persist, carry) {
    var lawn = P.dailyLawn(day, BANK);
    S = {
      day: day, persist: persist, guide: false, lawn: lawn, state: P.startState(lawn), moves: 0, hints: 0, outcome: '',
      elapsed: 0, runningSince: 0, focus: firstFocus(lawn), shownHint: null,
    };
    var g = store.game;
    if (persist && g && g.day === day && g.state.length === lawn.w * lawn.h) {
      // The starting patch is always dug, whatever was saved.
      var base = S.state;
      S.state = g.state.split('').map(function (ch, i) { return base[i] === P.DUG ? P.DUG : ch; }).join('');
      S.moves = g.moves;
      S.hints = g.hints;
      S.outcome = outcomeOf(lawn, S.state);
      if (S.outcome === 'won') S.state = P.withAllDaisies(lawn, S.state);
      // A finished game keeps the time it was finished in. Otherwise the longer clock wins.
      S.elapsed = S.outcome ? g.elapsed : Math.max(g.elapsed, carry || 0);
    }
    $('preview-bar').hidden = !PREVIEW;
    $('preview-day').textContent = 'Day ' + day;
    $('prev-day').disabled = day <= 1;
    $('next-day').disabled = !PREVIEW_BUILD && day + 1 >= today();
    var dayTag = $('day-tag');
    dayTag.textContent = '';
    dayTag.appendChild(el('b', { text: '#' + day }));
    dayTag.appendChild(document.createTextNode(' · ' + lawn.size + ' · ' + lawn.difficulty));
    $('coach').hidden = true;
    $('timer').hidden = false;
    $('hint-btn').hidden = false;
    buildLawn();
    if (S.moves && !S.outcome) startClock();
    render();
    renderTimer();
    if (S.outcome) renderResults(false); else $('results').hidden = true;
  }
  // The first square keyboard focus lands on: the first undug square, so arrow keys start near play.
  function firstFocus(lawn) {
    var s = P.startState(lawn);
    for (var i = 0; i < s.length; i++) if (s[i] !== P.DUG) return i;
    return 0;
  }

  function elapsedNow() { return S.elapsed + (S.runningSince ? Date.now() - S.runningSince : 0); }
  function startClock() {
    if (!S.runningSince && !S.outcome && !S.guide && !document.hidden) S.runningSince = Date.now();
  }
  function stopClock() {
    if (!S.runningSince) return;
    S.elapsed = elapsedNow();
    S.runningSince = 0;
  }

  // The time on a day's clock only goes up: if the saved game for this day has more time on
  // it than this tab (another tab has been open longer), this tab's clock catches up with it.
  function mergeClock() {
    var theirs = store.game;
    if (S.outcome || !S.persist || !theirs || theirs.day !== S.day) return;
    var behind = theirs.elapsed - elapsedNow();
    if (behind > 0) S.elapsed += behind;
  }
  function snapshot() {
    if (!S.persist) return;
    mergeClock();
    // A tab still showing an earlier day never replaces a later day's game.
    if (!store.game || store.game.day <= S.day) {
      store.game = { day: S.day, state: S.state, elapsed: Math.round(elapsedNow()), hints: S.hints, moves: S.moves };
    }
    lastSave = Date.now();
    save();
  }
  // True if the saved game is for this tab's day and has moved on further than this tab, or
  // as far but differently.
  function savedIsNewer() {
    var theirs = store.game;
    if (!theirs || theirs.day !== S.day) return false;
    return theirs.moves > S.moves || (theirs.moves === S.moves && (theirs.state !== S.state || theirs.hints !== S.hints));
  }
  // Before writing, read the store again so another tab's progress is not overwritten. If
  // that tab has moved on further, take its game instead and return false.
  function syncBeforeWrite() {
    if (!S.persist) return true;
    refresh();
    if (savedIsNewer()) { adopt(); return false; }
    return true;
  }
  // Take the saved game for this day, keeping the longer of the two clocks (or, if it is
  // finished, the time it was finished in).
  function adopt() {
    var mine = elapsedNow(), focus = S.focus;
    startGame(S.day, true, mine);
    S.focus = Math.min(focus, S.state.length - 1);
    render();
  }
  // Save the clock while it runs, now and then.
  function saveProgress() {
    if (!S.persist || !S.moves || S.outcome) return;
    if (syncBeforeWrite()) snapshot();
  }

  // ---- changing the lawn

  // Checks that a change may be made now; false if the game is over, or another tab had
  // moved on (this tab then shows that game instead of making the change).
  function canChange() { return !S.outcome && syncBeforeWrite(); }

  // What a tap does with the switch where it is.
  function tap(i) { if (mode === 'mark') mark(i, false); else dig(i); }

  // Digs square i, or chords if it is a dug number with all its daisies. A daisy protects its square.
  function dig(i) {
    if (S.guide) { guideAct(i, 'dig'); return; }
    if (S.outcome) return;
    var ch = S.state[i];
    if (ch === P.DAISY) { say('That square has a daisy. Take it off first to dig there.'); return; }
    if (ch === P.DUG && !P.chordable(S.lawn, S.state, i)) {
      if (S.lawn.nums[i]) say('The ' + S.lawn.nums[i] + ' needs ' + plural(S.lawn.nums[i], 'daisy', 'daisies') + ' around it before tapping it digs the rest.');
      return;
    }
    if (!canChange()) return;
    var res = S.state[i] === P.DUG ? P.chord(S.lawn, S.state, i) : P.dig(S.lawn, S.state, i);
    if (!res || !res.opened.length) return;
    S.state = res.state;
    commit();
    describeDig(i, res);
  }
  // Puts a daisy on square i or takes it off. `held` is true for a long press, which buzzes.
  function mark(i, held) {
    if (S.guide) { guideAct(i, 'mark', held); return; }
    if (S.outcome || S.state[i] === P.DUG) return;
    if (!canChange()) return;
    S.state = P.toggleDaisy(S.state, i);
    if (held) buzz(i);
    commit();
    var left = P.molesLeft(S.lawn, S.state);
    announce((S.state[i] === P.DAISY ? 'Daisy on ' : 'Daisy taken off ') + P.squareName(S.lawn, i) + '. ' + plural(left, 'mole', 'moles') + ' left to find.');
  }
  // Record a change: the clock, the outcome, saving, stats and drawing.
  function commit() {
    S.moves++;
    S.shownHint = null;
    startClock();
    S.outcome = outcomeOf(S.lawn, S.state);
    if (S.outcome) {
      mergeClock();
      stopClock();
      if (S.outcome === 'won') S.state = P.withAllDaisies(S.lawn, S.state);
      if (S.persist) store.stats = P.recordResult(store.stats, S.day, S.lawn.size, S.outcome === 'won', S.elapsed, S.hints);
    }
    snapshot();
    render();
    renderTimer();
    if (S.outcome) finish();
  }
  function describeDig(i, res) {
    if (S.outcome === 'lost') return;
    if (S.outcome === 'won') return;
    if (res.opened.length === 1) {
      var n = S.lawn.nums[res.opened[0]];
      announce('Dug ' + P.squareName(S.lawn, res.opened[0]) + ': ' + (n ? plural(n, 'mole', 'moles') + ' nearby.' : 'no moles nearby.'));
    } else {
      announce('Dug ' + res.opened.length + ' squares.');
    }
  }

  function hint() {
    if (S.guide || S.outcome) return;
    if (!canChange()) return;
    var h = P.hint(S.lawn, S.state);
    if (!h) return;
    S.hints++;
    S.moves++;
    S.shownHint = h;
    S.focus = h.cell;
    startClock();
    snapshot();
    render();
    var text = P.hintText(S.lawn, h, S.state);
    say(text);
    focusSquare(h.cell, true);
  }

  // ---- the guided lawn

  function startGuide() {
    if (S && S.runningSince) { stopClock(); saveProgress(); }
    var lawn = P.guideLawn();
    S = {
      day: S ? S.day : today(), back: S ? { day: S.day, persist: S.persist } : null, persist: false, guide: true, lawn: lawn,
      state: P.guideStart(lawn), moves: 0, hints: 0, outcome: '', elapsed: 0, runningSince: 0, focus: P.GUIDE.steps[0].targets[0], shownHint: null,
    };
    mode = 'dig';
    $('preview-bar').hidden = true;
    $('results').hidden = true;
    $('day-tag').textContent = 'Practice lawn · 4×4';
    $('timer').hidden = true;
    $('hint-btn').hidden = true;
    $('coach').hidden = false;
    $('coach-done').hidden = true;
    $('coach-skip').hidden = false;
    buildLawn();
    render();
    renderCoach();
  }
  function renderCoach() {
    var k = P.guideStep(S.state), steps = P.GUIDE.steps;
    if (k < steps.length) {
      $('coach-step').textContent = 'Step ' + (k + 1) + ' of ' + steps.length;
      $('coach-text').textContent = (k === 0 ? 'Each number counts the moles in the eight squares around it. ' : '') + steps[k].text;
      return;
    }
    $('coach-step').textContent = 'All done';
    $('coach-text').textContent = 'That’s all there is to it: every lawn can be worked out like this, one number at a time, without a guess.';
    $('coach-skip').hidden = true;
    var done = $('coach-done');
    done.textContent = S.back ? 'Back to the lawn' : 'Play today’s lawn';
    done.hidden = false;
    done.focus({ preventScroll: true });
  }
  // A dig or mark in the guide: only the step's own squares (and, for a chord step, its
  // number) respond, and a mole is never dug.
  function guideAct(i, kind, held) {
    var k = P.guideStep(S.state), step = P.GUIDE.steps[k];
    if (!step) return;
    var target = step.targets.indexOf(i) >= 0;
    if (kind === 'mark') {
      if (!target || step.action !== 'mark') { say(step.action === 'mark' ? 'Try the square with the dashed ring.' : 'No daisy needed there. Switch to ⛏ Dig for this step.'); return; }
      S.state = P.toggleDaisy(S.state, i);
      if (held) buzz(i);
    } else if (step.action === 'mark') {
      say(target ? 'Careful: a mole is asleep there. Switch to 🌼 Mark first, or press and hold the square.' : 'Try the square with the dashed ring.');
      return;
    } else if (i === step.from && step.action === 'chord') {
      S.state = P.chord(S.lawn, S.state, i).state;
    } else if (target && S.state[i] === P.COVERED) {
      S.state = P.dig(S.lawn, S.state, i).state;
    } else {
      say(step.action === 'chord' ? 'Tap the 1 with the ring, or the squares with dashed rings.' : 'Try the square with the dashed ring.');
      return;
    }
    S.moves++;
    if (P.guideStep(S.state) === P.GUIDE.steps.length) {
      S.outcome = 'won';
      S.state = P.withAllDaisies(S.lawn, S.state);
      if (!store.guided) { refresh(); store.guided = true; save(); }
    }
    say('');
    render();
    renderCoach();
    var next = P.GUIDE.steps[P.guideStep(S.state)];
    if (next) focusSquare(next.action === 'chord' ? next.from : next.targets[0], false);
  }
  function endGuide() {
    if (!store.guided) { refresh(); store.guided = true; save(); }
    var back = S.back;
    say('');
    if (back) startGame(back.day, back.persist); else startGame(today(), !PREVIEW);
    focusSquare(S.focus, false);
  }

  // ---- drawing the lawn

  var cells = [];
  var buzzing = {};

  function buildLawn() {
    var l = S.lawn, box = $('lawn');
    box.textContent = '';
    box.style.setProperty('--w', l.w);
    box.style.setProperty('--h', l.h);
    box.setAttribute('aria-label', (S.guide ? 'Practice lawn' : 'Lawn') + ', ' + l.w + ' squares wide and ' + l.h + ' tall. Arrow keys move, Space digs, F marks.');
    cells = [];
    for (var r = 0; r < l.h; r++) {
      var row = el('div', { class: 'row', role: 'row' });
      for (var c = 0; c < l.w; c++) {
        var i = r * l.w + c;
        var cell = el('div', { class: 'cell', role: 'gridcell', tabindex: '-1', 'data-i': String(i) });
        cell.appendChild(el('span', { class: 'sq', 'aria-hidden': 'true' }));
        row.appendChild(cell);
        cells.push(cell);
      }
      box.appendChild(row);
    }
  }

  // A little mole: asleep (eyes shut) or awake (eyes open, blinking).
  function moleSvg(awake) {
    var eyes = awake
      ? '<g class="eyes"><circle cx="15" cy="19" r="2.6" fill="#fff"/><circle cx="25" cy="19" r="2.6" fill="#fff"/><circle cx="15.4" cy="19.4" r="1.3" fill="#111"/><circle cx="25.4" cy="19.4" r="1.3" fill="#111"/></g>'
      : '<path d="M12.6 19.2q2.4 2.2 4.8 0M22.6 19.2q2.4 2.2 4.8 0" fill="none" stroke="#efe6ee" stroke-width="1.6" stroke-linecap="round"/>';
    return '<svg class="mole" viewBox="0 0 40 40" aria-hidden="true">' +
      '<ellipse cx="20" cy="35.5" rx="18" ry="4.5" fill="#6f4a2c"/>' +
      '<path d="M7 36C7 19 12 9 20 9s13 10 13 27z" fill="#4b3f4c"/>' +
      eyes +
      '<ellipse cx="20" cy="25.5" rx="4.2" ry="3" fill="#f39ab2"/>' +
      '<ellipse cx="12" cy="34" rx="4" ry="2.3" fill="#f39ab2"/><ellipse cx="28" cy="34" rx="4" ry="2.3" fill="#f39ab2"/>' +
      '</svg>';
  }

  /*
   * Brings every square up to date. What a square shows:
   *   grass (not dug), a daisy, soil with its number, and once the game is over the moles:
   *   asleep where they were, woken where one was dug, and a ✕ on a daisy with no mole.
   */
  function render() {
    var l = S.lawn, st = S.state, over = !!S.outcome, box = $('lawn');
    var step = S.guide ? P.GUIDE.steps[P.guideStep(st)] : null;
    var hintFrom = S.shownHint ? S.shownHint.from : [];
    cells.forEach(function (cell, i) {
      var ch = st[i], mole = !!l.moles[i], r = Math.floor(i / l.w), c = i % l.w;
      var kind, label;
      if (ch === P.DUG && mole) { kind = 'woke'; label = 'mole, woken'; }
      else if (ch === P.DUG) { kind = 'dug n' + l.nums[i]; label = l.nums[i] ? plural(l.nums[i], 'mole', 'moles') + ' nearby' : 'dug, no moles nearby'; }
      else if (over && mole) { kind = 'asleep' + (ch === P.DAISY ? ' daisy' : ''); label = ch === P.DAISY ? 'daisy, mole asleep' : 'mole, asleep'; }
      else if (ch === P.DAISY) { kind = 'grass daisy' + (over ? ' wrong' : ''); label = over ? 'daisy, but no mole here' : 'daisy'; }
      else { kind = 'grass'; label = 'grass'; }
      var cls = 'cell ' + kind + ((r + c) % 2 ? ' alt' : '');
      if (S.shownHint && S.shownHint.cell === i) cls += ' hinted';
      if (hintFrom.indexOf(i) >= 0) cls += ' proof';
      if (step && step.targets.indexOf(i) >= 0) cls += ' target';
      if (step && step.from === i) cls += ' proof';
      if (buzzing[i] && Date.now() - buzzing[i] < 400) cls += ' buzz';
      if (over && S.outcome === 'won' && !S.guide && mole) cls += ' snooze';
      cell.className = cls;
      cell.tabIndex = i === S.focus ? 0 : -1;
      var mark = cell.firstChild, want = kind + (S.outcome === 'won' ? '+' : '');
      if (mark.getAttribute('data-k') !== want) {
        mark.setAttribute('data-k', want);
        mark.innerHTML = '';
        if (ch === P.DUG && !mole && l.nums[i]) mark.textContent = String(l.nums[i]);
        else if (ch === P.DUG && mole) mark.innerHTML = moleSvg(true);
        else if (over && mole) mark.innerHTML = moleSvg(false) + (ch === P.DAISY ? '<span class="badge">🌼</span>' : '') + (S.outcome === 'won' ? '<span class="zz">z</span>' : '');
        else if (ch === P.DAISY) mark.innerHTML = '<span class="flower">🌼</span>' + (over ? '<span class="nope">✕</span>' : '');
      }
      cell.setAttribute('aria-label', 'Row ' + (r + 1) + ', column ' + (c + 1) + ': ' + label);
      if (over) cell.setAttribute('aria-disabled', 'true'); else cell.removeAttribute('aria-disabled');
    });
    box.classList.toggle('over', over);
    box.classList.toggle('lost', S.outcome === 'lost');
    renderControls();
  }

  function renderControls() {
    var over = !!S.outcome;
    $('controls').hidden = over;
    $('mode-dig').setAttribute('aria-pressed', String(mode === 'dig'));
    $('mode-mark').setAttribute('aria-pressed', String(mode === 'mark'));
    $('lawn').classList.toggle('marking', mode === 'mark');
    var hb = $('hint-btn');
    hb.textContent = '';
    hb.appendChild(el('span', { 'aria-hidden': 'true', text: '💡' }));
    hb.appendChild(document.createTextNode(S.hints ? ' Hint (' + S.hints + ')' : ' Hint'));
    var left = P.molesLeft(S.lawn, S.state);
    $('left').textContent = '';
    $('left').appendChild(el('span', { 'aria-hidden': 'true', text: '🌼 ' }));
    $('left').appendChild(document.createTextNode(String(left)));
    $('left').setAttribute('aria-label', plural(left, 'mole', 'moles') + ' left to find');
    $('left').title = 'Moles left to find';
    if (!S.shownHint && !S.guide) renderStatus();
  }
  // The line under the lawn: how to play before the first move, then nothing in particular.
  function renderStatus() {
    var st = $('status');
    st.className = 'status';
    if (S.outcome) st.textContent = S.state.split('').some(function (ch, i) { return ch === P.DAISY && !S.lawn.moles[i]; }) ? 'A ✕ marks a daisy with no mole under it.' : '';
    else if (!S.moves) st.textContent = TOUCH ? 'Tap a square to dig it. Press and hold to plant a daisy.' : 'Click a square to dig it. Right-click to plant a daisy.';
    else st.textContent = '';
  }
  function say(text) {
    var st = $('status');
    st.className = 'status' + (text ? ' said' : '');
    st.textContent = text;
    if (text) announce(text);
  }
  function renderTimer() {
    var t = S.outcome ? S.elapsed : elapsedNow();
    $('timer').textContent = P.formatTime(t);
  }
  function spokenTime(ms) {
    var s = Math.floor(ms / 1000), m = Math.floor(s / 60);
    return (m ? plural(m, 'minute', 'minutes') + ' ' : '') + plural(s % 60, 'second', 'seconds');
  }
  // The on-screen buzz when a long press turns into a mark, with a tiny vibration where phones allow.
  function buzz(i) {
    buzzing[i] = Date.now();
    setTimeout(function () { delete buzzing[i]; }, 400);
    try { if (navigator.vibrate) navigator.vibrate(12); } catch (e) { /* not every browser allows it */ }
  }

  // ---- pointer: a tap acts on release over the square it went down on; a long press marks
  //
  // Nothing changes when the pointer goes down. Released on the same square without having
  // moved more than a few pixels, the press is a tap (dig, or mark with the switch on Mark).
  // Held for LONG_PRESS it marks straight away, and the release then does nothing. A drag,
  // a scroll or a cancelled gesture changes nothing.

  var press = null;
  var lastPointer = 'mouse';
  function cellAt(x, y) {
    var t = document.elementFromPoint(x, y), cell = t && t.closest ? t.closest('.cell') : null;
    return cell && $('lawn').contains(cell) ? Number(cell.getAttribute('data-i')) : -1;
  }
  function endPress() {
    if (!press) return;
    clearTimeout(press.timer);
    press = null;
  }
  function onPointerDown(e) {
    lastPointer = e.pointerType || 'mouse';
    if (e.button !== 0) return;
    var i = cellAt(e.clientX, e.clientY);
    if (i < 0 || press || S.outcome) return;
    if (e.pointerType === 'mouse') e.preventDefault();
    S.focus = i;
    press = { id: e.pointerId, i: i, x: e.clientX, y: e.clientY, moved: false, held: false, timer: 0 };
    press.timer = setTimeout(function () {
      if (!press || press.moved) return;
      press.held = true;
      mark(press.i, true);
    }, LONG_PRESS);
  }
  function onPointerMove(e) {
    if (!press || e.pointerId !== press.id || press.moved) return;
    if (Math.abs(e.clientX - press.x) > SLOP || Math.abs(e.clientY - press.y) > SLOP || cellAt(e.clientX, e.clientY) !== press.i) {
      press.moved = true;
      clearTimeout(press.timer);
    }
  }
  function onPointerUp(e) {
    if (!press || e.pointerId !== press.id) return;
    var p = press;
    endPress();
    if (p.moved || p.held || cellAt(e.clientX, e.clientY) !== p.i) return;
    if (Math.abs(e.clientX - p.x) > SLOP || Math.abs(e.clientY - p.y) > SLOP) return;
    tap(p.i);
  }
  function onPointerCancel(e) {
    if (press && e.pointerId === press.id) endPress();
  }

  // ---- keyboard

  function focusSquare(i, scroll) {
    S.focus = i;
    cells.forEach(function (c, k) { c.tabIndex = k === i ? 0 : -1; });
    if (cells[i]) cells[i].focus({ preventScroll: !scroll });
  }
  function onKeyDown(e) {
    var cell = e.target.closest && e.target.closest('.cell');
    if (!cell || e.altKey || e.ctrlKey || e.metaKey) return;
    var i = Number(cell.getAttribute('data-i')), w = S.lawn.w, h = S.lawn.h, r = Math.floor(i / w), c = i % w;
    var to = { ArrowUp: [r - 1, c], ArrowDown: [r + 1, c], ArrowLeft: [r, c - 1], ArrowRight: [r, c + 1], Home: [r, 0], End: [r, w - 1] }[e.key];
    if (to) {
      e.preventDefault();
      if (to[0] >= 0 && to[0] < h && to[1] >= 0 && to[1] < w) focusSquare(to[0] * w + to[1], true);
      return;
    }
    if (e.key === ' ' || e.key === 'Enter') {
      e.preventDefault();
      if (e.repeat) return;
      S.focus = i;
      dig(i);
    } else if (e.key === 'f' || e.key === 'F') {
      e.preventDefault();
      if (e.repeat) return;
      S.focus = i;
      mark(i, false);
    } else {
      return;
    }
    // If another tab's game was taken instead, the squares were rebuilt: keep the focus.
    if (!S.outcome && cells[S.focus] && document.activeElement !== cells[S.focus]) cells[S.focus].focus({ preventScroll: true });
  }

  // ---- the end of a game

  function finish() {
    var lost = S.outcome === 'lost', pct = P.percentDug(S.lawn, S.state);
    announce(lost
      ? 'Oh no, a mole woke up. You dug ' + pct + '% of the garden.'
      : 'Garden dug! The moles slept through it. Cleared in ' + spokenTime(S.elapsed) + '.');
    renderResults(true);
  }

  function renderResults(justFinished) {
    var box = $('results'), l = S.lawn, lost = S.outcome === 'lost', pct = P.percentDug(l, S.state);
    box.hidden = false;
    box.textContent = '';
    box.classList.toggle('lost', lost);
    var sub = l.w + ' by ' + l.h + ', ' + l.difficulty + ' · ' + (S.hints ? plural(S.hints, 'hint', 'hints') : 'no hints');
    box.appendChild(el('div', { class: 'score-head' }, [
      el('div', { class: 'score', 'aria-label': lost ? pct + '% dug' : 'Cleared in ' + spokenTime(S.elapsed) }, [lost ? pct + '%' : P.formatTime(S.elapsed)]),
      el('div', {}, [
        el('h2', { class: 'score-title', text: lost ? 'A mole woke up!' : 'Garden dug!' }),
        el('p', { class: 'score-sub', text: lost ? 'You dug ' + pct + '% of the garden. It’s dozing off again.' : 'The moles slept right through it.' }),
        el('p', { class: 'score-sub', text: sub }),
      ]),
    ]));
    box.appendChild(el('div', { class: 'actions' }, [
      el('button', { class: 'primary', type: 'button', text: 'Share result', onclick: share }),
      el('button', { class: 'secondary', type: 'button', text: 'Stats', onclick: openStats }),
    ]));
    if (PREVIEW_BUILD) box.appendChild(el('button', { class: 'secondary wide again', type: 'button', text: 'Try this lawn again', onclick: function () { startGame(S.day, false); focusSquare(S.focus, false); } }));
    box.appendChild(el('pre', { class: 'share-text', id: 'share-text', hidden: true }));
    if (S.persist && store.stats.streak >= 2 && store.stats.lastDay === S.day) {
      box.appendChild(el('p', { class: 'streak', text: '🔥 ' + store.stats.streak + ' days in a row' }));
    }
    box.appendChild(el('p', { class: 'next', id: 'next' }));
    tick();
    if (justFinished) {
      box.querySelector('.primary').focus({ preventScroll: true });
      // On a woken mole, let the mole have its moment before the card slides into view.
      var delay = lost && !reduced() ? 900 : 0;
      setTimeout(function () {
        if (!box.hidden) box.scrollIntoView({ behavior: reduced() ? 'auto' : 'smooth', block: 'nearest' });
      }, delay);
    }
  }

  // ---- sharing

  function share() {
    var text = P.shareText(S.lawn, S.state, S.elapsed, S.hints, SITE_URL);
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
    if (S.guide) return;
    renderTimer();
    if (S.runningSince && Date.now() - lastSave >= SAVE_EVERY) saveProgress();
    var box = $('next');
    if (!S.persist) {
      if (box) box.textContent = PREVIEW_BUILD ? 'Preview: try again, or use the arrows at the top for another day.' : 'Preview: use the arrows at the top to try another day.';
      return;
    }
    var newDay = today() !== S.day;
    // A day nobody has started moves on by itself. One in progress can be finished first.
    if (newDay && !S.moves) { startGame(today(), true); return; }
    if (!box || !S.outcome || $('results').hidden) return;
    if (newDay) {
      if (box.getAttribute('data-ready')) return;
      box.setAttribute('data-ready', '1');
      box.textContent = 'A new lawn is ready. ';
      box.appendChild(el('button', { class: 'chip-btn', type: 'button', text: 'Play', onclick: function () { startGame(today(), true); focusSquare(S.focus, false); } }));
      return;
    }
    var s = Math.floor(P.msUntilTomorrow() / 1000);
    box.textContent = 'Next lawn in ';
    box.appendChild(el('b', { text: pad(Math.floor(s / 3600)) + ':' + pad(Math.floor(s / 60) % 60) + ':' + pad(s % 60) }));
  }

  // ---- stats

  function openStats() {
    var st = store.stats, body = $('stats-body');
    body.textContent = '';
    body.appendChild(el('div', { class: 'nums' }, [
      num(st.played, 'Played'),
      num(st.played ? Math.round((100 * st.cleared) / st.played) + '%' : '–', 'Cleared'),
      num(st.lastDay >= today() - 1 ? st.streak : 0, 'Day streak'),
      num(st.best, 'Best streak'),
    ]));
    body.appendChild(el('h3', { text: 'Times by lawn size' }));
    var todaySize = S.persist && S.outcome === 'won' && st.lastDay === S.day ? S.lawn.size : '';
    body.appendChild(el('table', { class: 'times' }, [
      el('thead', {}, [el('tr', {}, [el('th', { scope: 'col', text: 'Lawn' }), el('th', { scope: 'col', text: 'Cleared' }), el('th', { scope: 'col', text: 'Best' }), el('th', { scope: 'col', text: 'Average' })])]),
      el('tbody', {}, P.SIZES.map(function (k) {
        var b = st.bySize[k];
        return el('tr', { class: k === todaySize ? 'today' : null }, [
          el('th', { scope: 'row', text: k }),
          el('td', { text: String(b.cleared) }),
          el('td', { text: b.best ? P.formatTime(b.best) : '–' }),
          el('td', { text: b.cleared ? P.formatTime(b.total / b.cleared) : '–' }),
        ]);
      })),
    ]));
    body.appendChild(el('p', { class: 'fine clean', text: st.cleared ? 'Cleared without hints: ' + Math.round((100 * st.clean) / st.cleared) + '% of the lawns you cleared.' : 'Lawns are sized wide by tall.' }));
    if (PREVIEW) body.appendChild(el('p', { class: 'fine', text: 'This is a preview, so lawns played here are not counted.' }));
    openDialog('stats');
  }
  function num(value, label) {
    return el('div', {}, [el('b', { text: String(value) }), el('span', { text: label })]);
  }

  // ---- dialogs, toast, live region, settings

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
  function announce(msg) { $('live').textContent = msg; }
  function applyContrast() {
    if (store.contrast) root.setAttribute('data-contrast', 'high'); else root.removeAttribute('data-contrast');
    $('contrast').checked = store.contrast;
  }
  function setMode(m) {
    mode = m;
    renderControls();
  }

  // ---- wiring

  var lawnBox = $('lawn');
  lawnBox.addEventListener('pointerdown', onPointerDown);
  window.addEventListener('pointermove', onPointerMove);
  window.addEventListener('pointerup', onPointerUp);
  window.addEventListener('pointercancel', onPointerCancel);
  // Right-click marks. A long press on a touch screen also opens a context menu in some
  // browsers: that is held back, and the long press does the marking.
  lawnBox.addEventListener('contextmenu', function (e) {
    e.preventDefault();
    var cell = e.target.closest && e.target.closest('.cell');
    if (!cell || lastPointer !== 'mouse') return;
    endPress();
    var i = Number(cell.getAttribute('data-i'));
    S.focus = i;
    mark(i, false);
  });
  lawnBox.addEventListener('keydown', onKeyDown);
  // A screen reader's own "activate" sends a click with no pointer behind it: it acts as a tap.
  lawnBox.addEventListener('click', function (e) {
    var cell = e.target.closest && e.target.closest('.cell');
    if (cell && e.detail === 0) { S.focus = Number(cell.getAttribute('data-i')); tap(S.focus); }
  });
  lawnBox.addEventListener('focusin', function (e) {
    var cell = e.target.closest && e.target.closest('.cell');
    if (cell) S.focus = Number(cell.getAttribute('data-i'));
  });
  $('mode-dig').addEventListener('click', function () { setMode('dig'); });
  $('mode-mark').addEventListener('click', function () { setMode('mark'); });
  $('hint-btn').addEventListener('click', hint);
  $('coach-skip').addEventListener('click', endGuide);
  $('coach-done').addEventListener('click', endGuide);
  $('guide-btn').addEventListener('click', function () {
    closeDialog($('help'));
    startGuide();
    focusSquare(S.focus, false);
  });
  // A held Enter or Space on a button repeats; only the first press counts.
  document.addEventListener('keydown', function (e) {
    if (e.repeat && (e.key === 'Enter' || e.key === ' ') && e.target.closest && e.target.closest('button')) e.preventDefault();
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
    refresh();
    store.contrast = $('contrast').checked;
    save();
    applyContrast();
  });
  $('prev-day').addEventListener('click', function () { if (S.day > 1) startGame(S.day - 1, false); });
  $('next-day').addEventListener('click', function () { if (PREVIEW_BUILD || S.day + 1 < today()) startGame(S.day + 1, false); });
  // Another tab saved something: take its copy, and redraw if it has played this day further
  // than this tab, or as far but differently.
  window.addEventListener('storage', function (e) {
    if (e.key !== STORE_KEY || writeFailed) return;
    if (!refresh()) return;
    applyContrast();
    if (!S.persist || press) return;
    var theirs = store.game;
    if (theirs && theirs.day > S.day) {
      if (!S.moves || S.outcome) startGame(today(), true);
    } else if (theirs && theirs.day === S.day) {
      if (savedIsNewer()) adopt();
      else { mergeClock(); renderTimer(); }
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
      if (S.moves && !S.outcome && !S.guide) startClock();
      tick();
    }
  });
  window.addEventListener('pagehide', function () { if (S.runningSince) saveProgress(); });
  setInterval(tick, 1000);

  applyContrast();
  // A first visit starts with the guided lawn; preview mode never does.
  if (!PREVIEW && !store.guided) startGuide();
  else startGame(forcedDay || today(), !PREVIEW);
})();
