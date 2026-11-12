/*
 * Bolt page. Runs the day's runs in real time, draws them (through scene.js), shows the card
 * between runs and the result at the end, plays the sounds, and keeps the player's progress
 * in localStorage. The rules (course, physics, the clock, scoring, stats, share text) are in
 * logic.js.
 */
(function () {
  'use strict';

  var B = window.Bolt;
  var Scene = window.BoltScene.Scene;
  var TUMBLE_MS = window.BoltScene.TUMBLE_MS;

  // The address added to shared results. Empty until the game has a home.
  var SITE_URL = 'https://thombee.github.io/games/bolt/';
  var STORE_KEY = 'bolt:v1';
  // While a run is on, its distance is saved every this many metres (and when the page is hidden).
  var SAVE_EVERY = 10;
  // Each beat of the three-two-one before a paused run carries on, in ms.
  var COUNT_MS = 500;
  // One tab plays at a time. The tab with a run in progress (started and not yet ended) says so
  // in storage every BEAT_MS; another tab waits for that run to end, or for STALE_MS without a
  // word from it.
  var BEAT_MS = 1000;
  var STALE_MS = 5000;
  // This page's own id, for the run it owns. A reload is a new page with a new id.
  var TAB = Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

  var root = document.documentElement;
  var forcedDay = parseInt(new URLSearchParams(location.search).get('day'), 10);
  // Preview mode plays any day, with as many runs as you like, and saves nothing. It is on
  // for ?day=N and for preview builds.
  var PREVIEW = root.hasAttribute('data-preview') || forcedDay > 0;
  var reducedQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
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
  function metres(m) { return m.toLocaleString('en-AU') + ' m'; }

  // ---- saved progress

  function emptyStore() { return { v: 1, stats: B.emptyStats(), game: null, lock: null, contrast: false, sound: true }; }
  // A day's runs as saved, keeping only well-formed ones.
  function cleanRuns(list) {
    if (!Array.isArray(list)) return [];
    var seen = {};
    return list.filter(function (r) {
      var ok = r && typeof r.id === 'string' && r.id.length > 0 && r.id.length <= 40 && !seen[r.id] &&
        Number.isFinite(r.m) && r.m >= 0 && r.m < 1e7;
      if (ok) seen[r.id] = true;
      return ok;
    }).slice(0, B.RUNS).map(function (r) { return { id: r.id, m: Math.floor(r.m), live: r.live === true }; });
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
      if (Array.isArray(st.marks) && st.marks.length === s.stats.marks.length) {
        s.stats.marks = st.marks.map(function (n) { return Number.isFinite(n) && n >= 0 ? Math.floor(n) : 0; });
      }
      var g = d.game;
      if (g && Number.isInteger(g.day) && g.day > 0) s.game = { day: g.day, runs: cleanRuns(g.runs), done: g.done === true };
      var l = d.lock;
      if (l && typeof l.tab === 'string' && typeof l.run === 'string' && Number.isFinite(l.beat)) s.lock = { tab: l.tab, run: l.run, beat: l.beat };
      s.contrast = d.contrast === true;
      s.sound = d.sound !== false;
    } catch (e) { /* corrupt: start clean */ }
    return s;
  }
  // After a write has failed, what is in memory is the truth: reads no longer replace it.
  var memoryIsTruth = false;
  function save() {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(store)); } catch (e) { memoryIsTruth = true; cannotSave(); }
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

  // The run in progress in another tab, as saved in `s`: its lock { tab, run, beat }, or null
  // if there is none or its tab has said nothing for STALE_MS.
  function otherTab(s) {
    var l = s.lock;
    return l && l.tab !== TAB && Math.abs(Date.now() - l.beat) <= STALE_MS ? l : null;
  }

  // A saved day as it stands now. A run still going whose tab has gone quiet (closed, or
  // asleep for STALE_MS) counts as ended at the distance saved; a run another tab is still
  // playing stays as it is. A day with all its runs ended is done, and once every run started
  // has ended, a finished or past day with runs is recorded in the stats (once).
  function settle(s, day) {
    var g = s.game;
    if (!g) return false;
    var changed = false, held = otherTab(s);
    g.runs.forEach(function (r) { if (r.live && !(held && held.run === r.id)) { r.live = false; changed = true; } });
    if (s.lock && !held && s.lock.tab !== TAB) { s.lock = null; changed = true; }
    var open = g.runs.some(function (r) { return r.live; });
    if (!g.done && !open && g.runs.length >= B.RUNS) { g.done = true; changed = true; }
    if ((g.done || g.day < day) && !open && g.runs.length && s.stats.lastDay < g.day) {
      s.stats = B.recordResult(s.stats, g.day, B.best(g.runs));
      changed = true;
    }
    return changed;
  }

  // ---- the current day

  /*
   * S: day, persist (false in preview), animal, runs (the day's runs: { id, m, live }),
   * done (the day is over), phase ('gate' before the first run, 'run', 'paused', 'countdown'
   * back from a pause, 'tumble' after a crash, 'between' runs, 'done'), run (the run in
   * logic.js), runId (this tab's run), clock (logic.js's clock for it), events (what the run
   * has done since the last frame), saved (the distance last saved), crash (what the last run
   * hit), busy (the card says another tab has a run on).
   */
  var S = null;
  var frozen = false; // the test hook has stopped the clock: steps only advance through it
  var scene = new Scene($('scene'));

  function today() { return Math.max(1, B.dayNumber()); }
  function ended() { return S.runs.filter(function (r) { return !r.live; }); }
  function runsLeft() { return PREVIEW ? Infinity : B.RUNS - S.runs.length; }

  function startGame(day, persist) {
    S = {
      day: day, persist: persist, animal: B.animalFor(day), runs: [], done: false, phase: 'gate',
      run: null, runId: null, clock: null, events: [], saved: 0, crash: '', lastRun: null, busy: false,
    };
    if (persist && store.game && store.game.day === day) {
      S.runs = store.game.runs.map(function (r) { return { id: r.id, m: r.m, live: r.live }; });
      S.done = store.game.done;
    }
    scene.reset();
    $('day-tag').textContent = '#' + day;
    $('preview-bar').hidden = !PREVIEW;
    $('preview-day').textContent = 'Day ' + day;
    $('who').textContent = S.animal.emoji + ' ' + S.animal.name + ' the ' + S.animal.kind;
    $('jump').setAttribute('aria-label', 'Jump. Today’s runaway is ' + S.animal.name + ' the ' + S.animal.kind + '.');
    root.classList.remove('running');
    $('count').hidden = true;
    if (S.done) showResults(false);
    else if (S.runs.length || (persist && otherTab(store))) showBetween(S.runs[S.runs.length - 1], false);
    else showGate();
  }

  // Whether this tab has a run in progress (started and not yet ended), which it owns.
  function playing() { return S.phase === 'run' || S.phase === 'paused' || S.phase === 'countdown'; }

  // Write this tab's day into the store, merged with what another tab has saved, with this
  // tab's claim on its run in progress (or without it, once the run has ended). A store
  // already on a later day keeps that day's progress; only this day's stats can still count,
  // and only once every run started has ended.
  function commit() {
    if (!S.persist) return;
    reread();
    var theirs = store.game;
    if (theirs && theirs.day === S.day) {
      S.runs = B.mergeRuns(S.runs, theirs.runs);
      S.done = S.done || theirs.done;
    }
    if (!theirs || theirs.day <= S.day) {
      if (theirs && theirs.day < S.day) settle(store, S.day);
      store.game = { day: S.day, runs: S.runs.map(function (r) { return { id: r.id, m: r.m, live: r.live }; }), done: S.done };
    }
    if (playing()) store.lock = { tab: TAB, run: S.runId, beat: Date.now() };
    else if (store.lock && store.lock.tab === TAB) store.lock = null;
    var open = S.runs.some(function (r) { return r.live; });
    if (S.done && !open && ended().length && store.stats.lastDay < S.day) store.stats = B.recordResult(store.stats, S.day, B.best(ended()));
    save();
  }

  // Whether this tab still owns its run in progress: no other tab has taken over, or counted
  // the run as ended, while this one was asleep. Reads the store.
  function stillMine() {
    if (!S.persist) return true;
    reread();
    if (memoryIsTruth) return true;
    var l = store.lock, g = store.game;
    if (l && l.tab !== TAB) return false;
    var r = g && g.day === S.day ? g.runs.filter(function (x) { return x.id === S.runId; })[0] : null;
    return !(r && !r.live);
  }

  // Another tab counted this tab's run as ended while it was asleep: it is over at the
  // distance saved, and the day is shown as it now stands.
  function lostRun() {
    root.classList.remove('running');
    $('paused').hidden = true;
    $('count').hidden = true;
    S.phase = 'between';
    startGame(S.day, true);
    toast('This run ended while the tab was asleep');
  }

  // Say every BEAT_MS that this tab's run is still going, unless it has been taken from it.
  function heartbeat() {
    if (!S || !S.persist || !playing()) return;
    if (!stillMine()) { lostRun(); return; }
    commit();
  }

  function mine() {
    var id = S.runId;
    return S.runs.filter(function (r) { return r.id === id; })[0];
  }

  /*
   * Start a run. Whether a run can be taken is checked against the store at this moment, in
   * one go: not while another tab has a run on, and never a fourth. A run still marked as
   * going whose tab has gone quiet counts as ended first.
   */
  function startRun(withJump) {
    if (S.phase !== 'gate' && S.phase !== 'between') return;
    if (S.persist) {
      reread();
      if (otherTab(store)) { startGame(S.day, true); return; }
      // If the store has moved on to a later day, this tab is finishing an earlier one: it
      // goes on from what it has in memory, and commit() leaves the later day alone.
      var theirs = store.game;
      if (theirs && theirs.day === S.day) {
        settle(store, S.day);
        S.runs = B.mergeRuns(S.runs, theirs.runs);
        S.done = S.done || theirs.done;
      }
      S.runs.forEach(function (r) { r.live = false; });
      // Another tab has used up the day meanwhile.
      if (S.done || S.runs.length >= B.RUNS) { commit(); startGame(S.day, true); return; }
    }
    S.runId = Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
    S.runs.push({ id: S.runId, m: 0, live: true });
    S.saved = 0;
    S.events = [];
    S.run = B.newRun(S.day, S.events);
    S.phase = 'run';
    S.busy = false;
    commit();
    S.clock = B.newClock(S.run, performance.now());
    scene.reset();
    if (withJump) B.press(S.run);
    $('hint').hidden = true;
    $('between').hidden = true;
    $('stage').classList.remove('carded');
    $('paused').hidden = true;
    $('count').hidden = true;
    root.classList.add('running');
    $('jump').focus({ preventScroll: true });
    updateHud(true);
  }

  // Run the logic up to the step due at `now`. After a stall (more than B.STALL_MS since the
  // last time), nothing is run: the run pauses where it stands, so no step is ever dropped.
  function advanceTo(now) {
    if (B.clockTo(S.clock, now)) return true;
    pause();
    return false;
  }

  // The jump button: tap, click, Space, Enter or the up arrow.
  function press() {
    if (dialogOpen()) return;
    if (S.phase === 'gate') { startRun(true); return; }
    if (S.phase === 'paused') { countdown(); return; }
    if (S.phase !== 'run') return;
    if (frozen) B.press(S.run);
    else if (!B.clockPress(S.clock, performance.now())) pause();
  }

  function pause() {
    if (S.phase !== 'run' && S.phase !== 'countdown') return;
    S.phase = 'paused';
    $('paused').hidden = false;
    $('count').hidden = true;
    saveDistance(true);
  }
  // Back from a pause: three, two, one, then the run carries on from exactly where it stopped.
  function countdown() {
    if (!stillMine()) { lostRun(); return; }
    S.phase = 'countdown';
    S.countAt = performance.now();
    $('paused').hidden = true;
    $('count').hidden = false;
    $('count').textContent = '3';
  }
  function resume(now) {
    S.phase = 'run';
    B.clockResume(S.clock, now);
    $('count').hidden = true;
  }

  // Keep the distance of the run in progress, so it counts if this tab goes away.
  function saveDistance(force) {
    if (!S.persist || !S.run || !playing()) return;
    var m = B.distance(S.run), r = mine();
    if (!r || (!force && m < S.saved + SAVE_EVERY)) return;
    if (!stillMine()) { lostRun(); return; }
    r.m = Math.max(r.m, m);
    S.saved = m;
    commit();
  }

  // The page is going away (a reload, a new address, a closed tab): a run in progress ends
  // here, at the distance it reached.
  function leave() {
    if (!S || !playing()) return;
    var r = mine();
    if (S.persist && !stillMine()) return;
    if (r) {
      r.m = Math.max(r.m, B.distance(S.run));
      r.live = false;
    }
    if (S.persist && S.runs.length >= B.RUNS) S.done = true;
    S.phase = 'between';
    commit();
    root.classList.remove('running');
    if (S.done) showResults(false); else showBetween(r, false);
  }

  // The run has hit something.
  function crashed(now) {
    sound.play('crash');
    var r = mine();
    if (r) {
      r.m = B.distance(S.run);
      r.live = false;
    }
    S.lastRun = r;
    S.crash = S.run.hit ? S.run.hit.kind : '';
    if (S.persist && S.runs.length >= B.RUNS) S.done = true;
    S.phase = 'tumble';
    commit();
    S.crashAt = now;
    root.classList.remove('running');
    $('banner').classList.remove('show');
  }

  // ---- the frame loop: advance the run by whole steps, then draw

  var lastShown = -1;
  function frame() {
    requestAnimationFrame(frame);
    if (!S) return;
    var now = performance.now();
    if (S.phase === 'run' && !frozen) advanceTo(now);
    if (S.phase === 'countdown') {
      var left = 3 - Math.floor((now - S.countAt) / COUNT_MS);
      if (left <= 0) resume(now);
      else if ($('count').textContent !== String(left)) $('count').textContent = String(left);
    }
    if (S.events.length) {
      S.events.splice(0).forEach(function (e) { onEvent(e, now); });
    }
    if (S.phase === 'run') {
      if (S.run.over) crashed(now);
      else saveDistance(false);
    }
    if (S.phase === 'tumble' && now - S.crashAt >= (reducedQuery.matches ? 450 : TUMBLE_MS)) {
      if (S.done) showResults(true);
      else showBetween(S.lastRun, true);
    }
    updateHud(false);
    if (!$('play').hidden) draw(now);
  }

  function draw(now) {
    var run = S.run, x = 0, y = 0;
    if (run) {
      // Between two steps, draw the runaway part of the way from the last step to this one.
      var c = S.clock, alpha = S.phase === 'run' && !frozen && c ? clamp((now - c.t0) * B.HZ / 1000 - (run.step - c.base), 0, 1) : 1;
      x = run.px + (run.x - run.px) * alpha;
      y = run.py + (run.y - run.py) * alpha;
    }
    scene.resize();
    scene.draw({
      now: now, x: x, y: y, phase: S.phase, emoji: S.animal.emoji, course: B.courseFor(S.day),
      dead: !!(run && run.over), contrast: store.contrast,
    });
  }
  function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }

  function onEvent(e, now) {
    scene.event(e, now);
    if (e.type === 'jump' || e.type === 'hop') sound.play(e.type);
    if (e.type === 'landmark') {
      sound.play('landmark');
      var m = B.LANDMARKS[e.index], last = e.index === B.LANDMARKS.length - 1;
      if (last) banner('🎉 ' + S.animal.name + ' made it to ' + m.name + '!', true);
      else banner('✓ ' + metres(m.m) + ' · ' + m.name, false);
      var d = $('dist');
      d.classList.remove('tick');
      void d.offsetWidth;
      if (!reducedQuery.matches) d.classList.add('tick');
    }
  }

  var bannerTimer = 0;
  function banner(text, big) {
    var b = $('banner');
    b.textContent = text;
    b.classList.toggle('big', big);
    b.classList.add('show');
    clearTimeout(bannerTimer);
    bannerTimer = setTimeout(function () { b.classList.remove('show'); }, big ? 2600 : 1700);
  }

  function updateHud(force) {
    var m = S.run ? B.distance(S.run) : 0;
    if (S.phase === 'between' && S.lastRun) m = S.lastRun.m;
    if (m !== lastShown || force) {
      lastShown = m;
      $('dist').textContent = metres(m);
    }
    var n = S.phase === 'gate' ? S.runs.length + 1 : Math.max(1, S.runs.length);
    var text = PREVIEW ? 'Run ' + n : 'Run ' + Math.min(n, B.RUNS) + ' of ' + B.RUNS;
    if ($('run-no').textContent !== text) $('run-no').textContent = text;
  }

  // ---- before the first run, and between runs

  function showGate() {
    S.phase = 'gate';
    S.run = null;
    $('play').hidden = false;
    $('results').hidden = true;
    $('between').hidden = true;
    $('stage').classList.remove('carded');
    $('paused').hidden = true;
    $('count').hidden = true;
    $('hint').hidden = false;
    updateHud(true);
  }

  var CRASHES = {
    fence: 'Clipped a fence!', hay: 'Bounced off a hay bale!', stack: 'Bumped the haystack!', puddle: 'Splash! Into the puddle.',
    tractor: 'Bonk! Met the tractor.', trailer: 'Bumped the hay trailer!', branch: 'Thwack! A low branch.',
  };

  /*
   * The card after a run: how far it went, the best so far, and another go or stop. While
   * another tab has a run on, it says so instead, shows that run's distance as last saved,
   * and both buttons wait for it to end.
   */
  function showBetween(run, fresh) {
    S.phase = 'between';
    var held = S.persist ? otherTab(store) : null;
    S.busy = !!held;
    if (held) run = S.runs.filter(function (r) { return r.id === held.run; })[0] || run;
    S.lastRun = run;
    $('play').hidden = false;
    $('results').hidden = true;
    $('hint').hidden = true;
    $('paused').hidden = true;
    $('count').hidden = true;
    var all = ended(), top = B.best(all), left = runsLeft();
    var number = S.runs.map(function (r) { return r.id; }).indexOf(run && run.id) + 1;
    var others = all.filter(function (r) { return !run || r.id !== run.id; });
    var newBest = !!run && !held && others.length > 0 && run.m > B.best(others);
    $('b-what').textContent = held ? 'A run is under way in another tab' : fresh && CRASHES[S.crash] ? CRASHES[S.crash] :
      'Run ' + number + (PREVIEW ? '' : ' of ' + B.RUNS) + (run && run.live ? ', still going in another tab' : '');
    $('b-dist').textContent = metres(run ? run.m : 0);
    $('b-best').textContent = newBest ? 'A new best! ' + B.reachedLine(S.animal.name, top) + '.' : 'Best so far: ' + metres(top);
    $('again-btn').textContent = left === Infinity ? 'Run again' : 'Run again · ' + left + ' left';
    $('again-btn').disabled = !!held;
    $('stop-btn').disabled = !!held || !all.length;
    $('between').hidden = false;
    $('stage').classList.add('carded');
    $('banner').classList.remove('show');
    updateHud(true);
    var said = held ? 'A run is under way in another tab. This tab can play when it ends. ' :
      (fresh ? 'Run over. ' : '') + S.animal.name + ' ran ' + (run ? run.m : 0) + ' metres. ';
    said += 'Best so far ' + top + ' metres. ' + (left === Infinity ? '' : left + (left === 1 ? ' run left.' : ' runs left.'));
    $('live').textContent = said;
    if (!held) $('again-btn').focus({ preventScroll: true });
  }

  // ---- the result card

  function showResults(justFinished) {
    S.phase = 'done';
    S.done = true;
    root.classList.remove('running');
    var all = ended(), top = B.best(all), box = $('results'), a = S.animal, mark = B.landmarkAt(top);
    $('play').hidden = true;
    box.hidden = false;
    box.textContent = '';
    box.appendChild(el('div', { class: 'score-head' }, [
      el('span', { class: 'score-emoji', 'aria-hidden': 'true', text: a.emoji }),
      el('div', {}, [
        el('div', { class: 'score', 'aria-label': 'Best run: ' + top + ' metres' }, [String(top.toLocaleString('en-AU')), el('span', { text: ' m' })]),
        el('h2', { class: 'score-title', text: B.reachedLine(a.name + ' the ' + a.kind, top) + (mark === B.LANDMARKS.length - 1 ? '!' : '.') }),
        el('p', { class: 'score-sub', text: mark < B.LANDMARKS.length - 1 ? 'Next up: ' + B.LANDMARKS[mark + 1].name + ' at ' + metres(B.LANDMARKS[mark + 1].m) + '.' : 'All the way to the hills.' }),
      ]),
    ]));
    box.appendChild(el('ol', { class: 'runs', 'aria-label': 'Today’s runs' }, all.map(function (r, i) {
      return el('li', { class: r.m === top ? 'top' : '' }, [
        el('span', { class: 'r-label', text: 'Run ' + (i + 1) }),
        el('span', { class: 'r-bar', 'aria-hidden': 'true' }, [el('i', { style: 'width:' + (top ? Math.max(3, r.m / top * 100) : 3).toFixed(1) + '%' })]),
        el('span', { class: 'r-m', text: metres(r.m) }),
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
      $('live').textContent = 'Day over. ' + B.reachedLine(a.name, top) + '. Best run ' + top + ' metres.';
      box.querySelector('.primary').focus({ preventScroll: true });
    }
  }

  // ---- sharing

  function share() {
    var text = B.shareText(S.day, ended(), SITE_URL);
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
    // The other tab's run has ended, or its tab has gone quiet: this tab can play again.
    if (S.persist && S.busy && S.phase === 'between' && !otherTab(store)) { reread(); startGame(S.day, true); return; }
    if (!S.persist) {
      if ($('next')) $('next').textContent = 'Preview: use the arrows at the top to try another day.';
      return;
    }
    var newDay = today() !== S.day;
    // A day nobody has started moves on by itself. One in progress can be finished first.
    if (newDay && !S.runs.length && (S.phase === 'gate' || S.busy)) { startGame(today(), true); return; }
    var box = $('next');
    if (!box || S.phase !== 'done' || $('results').hidden) return;
    if (newDay) {
      if (box.getAttribute('data-ready')) return;
      box.setAttribute('data-ready', '1');
      box.textContent = 'A new course is ready. ';
      box.appendChild(el('button', { class: 'chip-btn', type: 'button', text: 'Play', onclick: function () { startGame(today(), true); } }));
      return;
    }
    var s = Math.floor(B.msUntilTomorrow() / 1000);
    box.textContent = 'Tomorrow’s course in ';
    box.appendChild(el('b', { text: pad(Math.floor(s / 3600)) + ':' + pad(Math.floor(s / 60) % 60) + ':' + pad(s % 60) }));
  }

  // ---- stats

  function openStats() {
    var st = store.stats, body = $('stats-body');
    var most = Math.max.apply(null, [1, st.played]);
    body.textContent = '';
    body.appendChild(el('div', { class: 'nums' }, [
      num(st.played, 'Days played'),
      num(st.lastDay >= today() - 1 ? st.streak : 0, 'Day streak'),
      num(st.bestStreak, 'Best streak'),
      num(metres(st.best), 'Best ever'),
      num(metres(st.played ? Math.round(st.total / st.played) : 0), 'Average best'),
    ]));
    body.appendChild(el('h3', { text: 'Landmarks reached' }));
    body.appendChild(el('ol', { class: 'marks' }, B.LANDMARKS.map(function (m, i) {
      var n = st.marks[i];
      return el('li', { 'aria-label': m.name + ', ' + m.m + ' metres: reached on ' + n + (n === 1 ? ' day' : ' days') }, [
        el('span', { class: 'm-name', 'aria-hidden': 'true' }, [m.name + ' ', el('small', { text: metres(m.m) })]),
        el('span', { class: 'm-bar', 'aria-hidden': 'true' }, [el('i', { style: 'width:' + Math.round(n / most * 100) + '%' })]),
        el('span', { class: 'm-n', 'aria-hidden': 'true', text: String(n) }),
      ]);
    })));
    if (PREVIEW) body.appendChild(el('p', { class: 'fine', text: 'This is a preview, so runs here are not counted.' }));
    openDialog('stats');
  }
  function num(value, label) {
    return el('div', {}, [el('b', { text: String(value) }), el('span', { text: label })]);
  }

  // ---- dialogs, toast, settings

  function openDialog(id) {
    if (S && playing()) pause();
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
    $('sound-btn').setAttribute('aria-pressed', String(store.sound));
    $('sound-btn').setAttribute('aria-label', store.sound ? 'Sound on' : 'Sound off');
  }

  // ---- sounds, made on the spot with the Web Audio API. Browsers allow sound only after the
  // player has tapped or pressed a key, so there is none before that; the header button mutes
  // it, and that is remembered. Reduced motion does not change the sounds.

  var sound = {
    ctx: null,
    // Make the audio context, on the player's first tap or key (and only if sound is on).
    wake: function () {
      if (!store.sound) return;
      var AC = window.AudioContext || window.webkitAudioContext;
      try {
        if (!sound.ctx && AC) sound.ctx = new AC();
        // Firefox turns this down if the page is going away; that needs no word.
        var waking = sound.ctx && sound.ctx.state === 'suspended' ? sound.ctx.resume() : null;
        if (waking && waking.catch) waking.catch(function () {});
      } catch (e) { sound.ctx = null; }
    },
    // A tone from `f0` to `f1` Hz over `dur` seconds, starting `at` seconds from now.
    tone: function (type, f0, f1, dur, vol, at) {
      var c = sound.ctx, t = c.currentTime + (at || 0), o = c.createOscillator(), g = c.createGain();
      o.type = type;
      o.frequency.setValueAtTime(f0, t);
      o.frequency.exponentialRampToValueAtTime(f1, t + dur);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(vol, t + 0.012);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(g);
      g.connect(c.destination);
      o.start(t);
      o.stop(t + dur + 0.02);
    },
    // A soft blip for a jump, a higher one for the hop, a thud for a crash, a chime for a landmark.
    play: function (what) {
      if (!store.sound || !sound.ctx || sound.ctx.state !== 'running') return;
      try {
        if (what === 'jump') sound.tone('sine', 420, 640, 0.11, 0.16);
        else if (what === 'hop') sound.tone('sine', 700, 1050, 0.11, 0.14);
        else if (what === 'crash') { sound.tone('triangle', 150, 45, 0.3, 0.32); sound.tone('sine', 90, 40, 0.22, 0.25); }
        else if (what === 'landmark') { sound.tone('triangle', 1319, 1310, 0.5, 0.12); sound.tone('triangle', 1976, 1970, 0.6, 0.09, 0.09); }
      } catch (e) { /* no sound is better than a broken run */ }
    },
  };

  // ---- wiring

  var jumpBtn = $('jump');
  // The jump button covers the play area, under the card between runs, which has its own
  // buttons. A press counts as the finger or mouse button goes down, not when it lifts.
  jumpBtn.addEventListener('pointerdown', function (e) {
    if (e.button > 0) return;
    e.preventDefault();
    jumpBtn.focus({ preventScroll: true });
    press();
  });
  jumpBtn.addEventListener('contextmenu', function (e) { e.preventDefault(); });
  jumpBtn.addEventListener('dblclick', function (e) { e.preventDefault(); });
  // The first tap or key anywhere lets sound start.
  ['pointerdown', 'keydown', 'touchend', 'click'].forEach(function (type) { document.addEventListener(type, sound.wake, true); });
  // While running, no touch anywhere scrolls or zooms the page.
  document.addEventListener('touchmove', function (e) { if (S && S.phase === 'run') e.preventDefault(); }, { passive: false });

  // Space, Enter and the up arrow jump. A Space or Enter press that jumps never also presses
  // a focused button: its keydown and (for Space) its keyup are both kept from the button.
  var swallowSpace = false;
  function isJumpKey(e) { return e.key === ' ' || e.key === 'Spacebar' || e.key === 'Enter' || e.key === 'ArrowUp'; }
  document.addEventListener('keydown', function (e) {
    if (dialogOpen() || e.altKey || e.ctrlKey || e.metaKey || !S) return;
    var onBetween = e.target.closest && e.target.closest('#between, #results');
    if (isJumpKey(e) && (S.phase === 'gate' || S.phase === 'run' || S.phase === 'paused' || S.phase === 'countdown' || S.phase === 'tumble')) {
      e.preventDefault();
      if (e.key === ' ' || e.key === 'Spacebar') swallowSpace = true;
      if (!e.repeat) press();
      return;
    }
    // A held key repeats, and focus moves to the card's buttons after a crash, so a repeat
    // could start the next run by accident. Only a fresh press counts there.
    if (e.repeat && onBetween && (e.key === 'Enter' || e.key === ' ')) e.preventDefault();
  }, true);
  document.addEventListener('keyup', function (e) {
    if ((e.key === ' ' || e.key === 'Spacebar') && swallowSpace) {
      swallowSpace = false;
      e.preventDefault();
    }
  }, true);

  $('again-btn').addEventListener('click', function () { startRun(false); });
  $('stop-btn').addEventListener('click', function () {
    if (S.phase !== 'between' || S.busy) return;
    S.done = true;
    commit();
    showResults(true);
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
    reread();
    store.contrast = $('contrast').checked;
    save();
    applyContrast();
  });
  $('sound-btn').addEventListener('click', function () {
    reread();
    store.sound = !store.sound;
    save();
    applyContrast();
    sound.wake();
  });
  $('prev-day').addEventListener('click', function () { if (S.day > 1 && S.phase !== 'run') startGame(S.day - 1, false); });
  $('next-day').addEventListener('click', function () { if (S.phase !== 'run') startGame(S.day + 1, false); });
  // Another tab saved something: take its copy, and catch up with its runs if this tab is
  // not in the middle of one. A tab whose run was taken from it while asleep finds out here.
  window.addEventListener('storage', function (e) {
    if (e.key !== STORE_KEY || memoryIsTruth) return;
    var fresh = readStore();
    if (!fresh) return;
    store = fresh;
    applyContrast();
    if (!S.persist) return;
    if (playing() && !stillMine()) { lostRun(); return; }
    var theirs = store.game, busy = playing() || S.phase === 'tumble';
    var waitChanged = S.phase === 'between' && S.busy !== !!otherTab(store);
    if (theirs && theirs.day > S.day) {
      if (!busy && (S.phase === 'done' || !S.runs.length)) startGame(today(), true);
    } else if (theirs && theirs.day === S.day) {
      var merged = B.mergeRuns(S.runs, theirs.runs), changed = merged.length !== S.runs.length || theirs.done !== S.done ||
        merged.some(function (r, i) { return r.m !== S.runs[i].m || r.live !== S.runs[i].live; });
      S.runs = merged;
      S.done = S.done || theirs.done;
      if ((changed || waitChanged) && !busy) startGame(S.day, true);
    } else if (S.runs.length) {
      // Their copy has no trace of this tab's day (it was on an earlier one): put ours back.
      if (!busy) commit();
    } else if (waitChanged || (S.phase === 'gate' && otherTab(store))) {
      startGame(S.day, true);
    }
  });
  document.addEventListener('visibilitychange', function () {
    if (document.hidden) pause(); else tick();
  });
  window.addEventListener('pagehide', leave);
  var resizeTimer = 0;
  window.addEventListener('resize', function () { clearTimeout(resizeTimer); resizeTimer = setTimeout(function () { scene.resize(); }, 50); });
  setInterval(tick, 1000);
  setInterval(heartbeat, BEAT_MS);

  // ---- a test hook, in preview mode only: run the logic by exact steps instead of by the clock

  if (PREVIEW) {
    var snapshot = function () {
      var r = S.run;
      return {
        phase: S.phase, day: S.day, step: r ? r.step : 0, x: r ? r.x : 0, y: r ? r.y : 0, vy: r ? r.vy : 0,
        over: !!(r && r.over), hit: r && r.hit ? r.hit.kind : null, distance: r ? B.distance(r) : 0,
        runs: S.runs.map(function (x) { return x.m; }),
      };
    };
    window.boltTest = {
      // Stop the clock: from now on steps only advance through advance().
      freeze: function () { frozen = true; return snapshot(); },
      // Start a run, as the Run again button does (no jump).
      start: function () { startRun(false); return snapshot(); },
      // The sound the page would play now: whether it is on, and whether the browser lets it.
      sound: function () { return { on: store.sound, ctx: sound.ctx ? sound.ctx.state : 'none' }; },
      // Run n steps, pressing the button at the given step numbers of the run.
      advance: function (n, presses) {
        var at = {};
        (presses || []).forEach(function (s) { at[s] = true; });
        for (var i = 0; i < n && S.run && !S.run.over && S.phase === 'run'; i++) {
          if (at[S.run.step]) B.press(S.run);
          B.step(S.run);
        }
        return snapshot();
      },
      state: snapshot,
    };
  }

  applyContrast();
  if (!PREVIEW && settle(store, today())) save();
  startGame(forcedDay > 0 ? forcedDay : today(), !PREVIEW);
  requestAnimationFrame(frame);
})();
