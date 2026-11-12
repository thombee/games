/*
 * Paddock page. Draws the paddock and its animals, runs a visit to each one, plays the weekly
 * moments, shows the day's summary and the book of cards, and keeps the player's save in
 * localStorage. The rules (moods, offers, hearts, arrivals, streak, checking and merging saves)
 * are in logic.js.
 */
(function () {
  'use strict';

  var P = window.Paddock;
  var FACTS = window.PADDOCK_FACTS;

  // The address added to shared results. Empty until the game has a home.
  var SITE_URL = 'https://thombee.github.io/games/paddock/';
  var STORE_KEY = 'paddock:v2';
  // A second copy, written on the first save of each day.
  var BACKUP_KEY = 'paddock:v2:backup';
  // Where a main save that could not be read cleanly is kept, untouched, so it is never lost outright.
  var UNREADABLE_KEY = 'paddock:v2:unreadable';
  // Saves in the first format, which kept running totals. They are converted to records on the
  // first load, and the originals kept under KEPT_KEY for KEEP_DAYS days in case the conversion
  // got something wrong.
  var OLD_KEY = 'paddock:v1', OLD_BACKUP_KEY = 'paddock:v1:backup';
  var KEPT_KEY = 'paddock:v1:kept', KEEP_DAYS = 30;

  var root = document.documentElement;
  var params = new URLSearchParams(location.search);
  var forcedDay = parseInt(params.get('day'), 10), forcedStage = parseInt(params.get('stage'), 10);
  // Preview mode shows any day at any stage and saves nothing. It is on for ?day=N or ?stage=N
  // and for preview builds.
  var PREVIEW = root.hasAttribute('data-preview') || forcedDay > 0 || forcedStage > 0;
  var TOUCH = window.matchMedia('(pointer: coarse)').matches;
  // Checked each time something is about to move, so a change of setting takes effect at once.
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

  function animal(kind) { return P.BY_KIND[kind]; }
  // "A mud wallow" -> "a mud wallow", for "Loved a mud wallow".
  function lower(label) { return label.charAt(0).toLowerCase() + label.slice(1); }
  function heartsText(n) { return n === 1 ? '1 heart' : n + ' hearts'; }
  function heartRow(n) { return n === 2 ? '❤️❤️' : n === 1 ? '❤️🤍' : '🤍🤍'; }
  function resultText(kind, offerId, result) {
    var label = lower(animal(kind).offers[offerId].label);
    return result === 'loved' ? 'Loved ' + label : result === 'liked' ? 'Liked ' + label : 'Not today';
  }

  // ---- the save

  var store = { blocked: false, failing: false, backupDay: 0 };

  function note(text) {
    var n = $('storage-note');
    if (PREVIEW) return;
    if (!text) { n.hidden = true; return; }
    if (!n.hidden && n.textContent === text) return;
    n.textContent = text;
    n.hidden = false;
    say(text);
  }

  // The latest day with a record, up to day `t`, or 0.
  function lastRecordDay(save, t) {
    return Object.keys(save.log).map(Number).filter(function (d) { return d <= t; }).reduce(function (a, b) { return Math.max(a, b); }, 0);
  }

  // The save: { p, from, converted } as P.restore gives it, or null if storage cannot be read.
  function load() {
    var main, backup, oldMain, oldBackup, kept, t = today(), r;
    try {
      main = localStorage.getItem(STORE_KEY);
      backup = localStorage.getItem(BACKUP_KEY);
      oldMain = localStorage.getItem(OLD_KEY);
      oldBackup = localStorage.getItem(OLD_BACKUP_KEY);
      kept = localStorage.getItem(KEPT_KEY);
    } catch (e) {
      store.blocked = true;
      return null;
    }
    if (!main && !backup && (oldMain || oldBackup)) {
      r = P.restore(oldMain, oldBackup, t);
      try {
        localStorage.setItem(KEPT_KEY, JSON.stringify({ until: t + KEEP_DAYS, main: oldMain, backup: oldBackup }));
        if (r.p) {
          localStorage.setItem(STORE_KEY, JSON.stringify(r.p));
          localStorage.setItem(BACKUP_KEY, JSON.stringify(r.p));
          store.backupDay = t;
        }
        localStorage.removeItem(OLD_KEY);
        localStorage.removeItem(OLD_BACKUP_KEY);
      } catch (e) { /* the old keys stay where they are, and the conversion runs again next time */ }
      return r;
    }
    try {
      var k = kept && JSON.parse(kept);
      if (kept && !(k && k.until >= t)) localStorage.removeItem(KEPT_KEY);
    } catch (e) { try { localStorage.removeItem(KEPT_KEY); } catch (e2) { /* left for next time */ } }
    var b = P.restore(backup, null, t).p;
    store.backupDay = b ? lastRecordDay(b, t) : 0;
    r = P.restore(main, backup, t);
    if (r.from === 'backup' || r.from === 'lost' || r.from === 'repaired') {
      // Keep the save that could not be read cleanly as it was, in case it can be mended by hand.
      try { if (main) localStorage.setItem(UNREADABLE_KEY, main); } catch (e) { /* nothing more to do */ }
    }
    return r;
  }

  // What is saved now, or null if there is nothing or it cannot be read.
  function readFresh() {
    if (PREVIEW || store.blocked) return null;
    try { return P.restore(localStorage.getItem(STORE_KEY), localStorage.getItem(BACKUP_KEY), today()).p; } catch (e) { return null; }
  }

  // Take in whatever another tab has saved, so nothing it did is overwritten.
  function sync() {
    var fresh = readFresh();
    if (fresh) p = P.merge(fresh, p);
    refresh();
  }

  /*
   * Write the save. If the write fails, the copy in memory stays the truth and a note says so;
   * the next successful write carries everything. The backup is written on the first save of
   * each day.
   */
  function save() {
    if (PREVIEW || store.blocked) return;
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(p));
      if (day > store.backupDay) {
        localStorage.setItem(BACKUP_KEY, JSON.stringify(p));
        store.backupDay = day;
      }
      if (store.failing) { store.failing = false; note(''); }
    } catch (e) {
      store.failing = true;
      note("Couldn't save just now. Your animals are fine while this page stays open.");
    }
  }

  // ---- state

  // p: the save. day: the calendar day on screen, from the clock. s: what the save adds up to
  // on that day (P.state). openKind: the animal being visited, if any. moment: the moment on
  // show, if any.
  var p = null, s = null, day = 1, openKind = null, justArrived = null, moment = null;
  var previewDay = 1, previewStage = 1;

  function today() { return Math.max(1, P.dayNumber()); }
  function refresh() { s = P.state(p, day); }

  // Move to a day and draw it. The day always comes from the clock, so a clock put back shows
  // the earlier day; anything recorded for a later day waits for that day.
  function startDay(d) {
    day = d;
    refresh();
    justArrived = P.newArrival(s);
    moment = null;
    playMoment();
    render();
  }

  function startPreview() {
    p = P.previewProgress(previewDay, previewStage);
    startDay(previewDay);
  }

  // ---- drawing the paddock

  function setTimeOfDay() { $('paddock').setAttribute('data-time', P.timeOfDay(new Date())); }

  function firstVisit() { return s.visits === 0 && s.animals.length === 1 && !Object.keys(s.offers).length; }
  function unvisited() { return s.animals.filter(function (x) { return !s.offers[x.kind]; }); }

  function render() {
    $('day-tag').textContent = 'Day ' + day;
    $('preview-bar').hidden = !PREVIEW;
    $('preview-day').textContent = 'Day ' + day + ' · visit ' + previewStage;
    setTimeOfDay();
    var arrival = $('arrival'), newKind = P.newArrival(s);
    arrival.hidden = !newKind;
    if (newKind) arrival.textContent = '🚪 Someone new has arrived. Say hello to ' + animal(newKind).name + ' the ' + newKind + '.';
    renderMoment();
    renderHint();
    renderHerd();
    renderClosing();
  }

  function renderHint() {
    var hint = $('hint'), left = unvisited();
    hint.hidden = !left.length;
    hint.classList.toggle('first', firstVisit());
    if (firstVisit()) hint.textContent = 'Tap ' + animal(s.animals[0].kind).name + ' to say hello';
    else if (left.length === s.animals.length) hint.textContent = s.animals.length === 1 ? 'Tap ' + animal(left[0].kind).name + ' to say hello' : 'Tap each animal to say hello';
    else if (left.length) hint.textContent = left.length === 1 ? 'Just ' + animal(left[0].kind).name + ' still to see' : left.length + ' still to see';
  }

  function tileLabel(x) {
    var a = animal(x.kind), o = s.offers[x.kind];
    if (o) {
      var r = P.reaction(x.kind, P.moodOn(x.kind, day).mood.id, o);
      return a.name + ' the ' + x.kind + '. Visited today: ' + resultText(x.kind, o, r).toLowerCase() + ', ' + heartsText(P.HEARTS[r]) + '.';
    }
    var greet = P.missedYou(s, x.kind) ? P.missedLine(x.kind, day) + ' ' : '';
    return a.name + ' the ' + x.kind + '. ' + greet + P.moodOn(x.kind, day).line;
  }

  function renderHerd() {
    var herd = $('herd'), focused = document.activeElement && document.activeElement.getAttribute('data-kind');
    herd.textContent = '';
    herd.setAttribute('data-count', String(s.animals.length));
    s.animals.forEach(function (x, i) {
      var a = animal(x.kind), o = s.offers[x.kind], m = P.moodOn(x.kind, day), bubble;
      if (o) {
        var r = P.reaction(x.kind, m.mood.id, o);
        bubble = el('span', { class: 'bubble done ' + r }, [
          el('span', { class: 'b-hearts', text: heartRow(P.HEARTS[r]) }),
          el('span', { class: 'b-text', text: resultText(x.kind, o, r) }),
        ]);
      } else {
        bubble = el('span', { class: 'bubble' }, [
          P.missedYou(s, x.kind) && el('span', { class: 'b-missed', text: P.missedLine(x.kind, day) }),
          el('span', { class: 'b-text' }, [el('span', { class: 'b-icon', 'aria-hidden': 'true', text: m.mood.icon + ' ' }), m.line]),
        ]);
      }
      var cls = 'beast' + (o ? ' visited' : '') + (x.kind === justArrived && !o ? ' new' : '') + (firstVisit() ? ' first' : '');
      herd.appendChild(el('li', { class: 'spot', style: '--i:' + i }, [
        el('button', { class: cls, type: 'button', 'data-kind': x.kind, 'aria-label': tileLabel(x), onclick: function () { openVisit(x.kind); } }, [
          bubble,
          el('span', { class: 'critter', 'aria-hidden': 'true' }, [el('span', { class: 'body', text: a.emoji })]),
          el('span', { class: 'tag' }, [a.name, x.kind === justArrived && !o && el('span', { class: 'new-pill', text: 'New' })]),
        ]),
      ]));
    });
    if (focused) {
      var again = herd.querySelector('[data-kind="' + focused + '"]');
      if (again) again.focus({ preventScroll: true });
    }
  }

  // ---- a visit

  function visitOpen() { return $('visit').open; }

  function friendBox(kind) {
    var a = animal(kind), f = P.friendship(P.heartsOf(s, kind));
    var pct = f.need ? Math.round(f.into / f.need * 100) : 100;
    var next = f.need ? (f.need - f.into) + ' more ' + (f.need - f.into === 1 ? 'heart' : 'hearts') + ' to ' + P.LEVEL_NAMES[f.level + 1] : 'As close as can be';
    var box = $('visit-friend');
    box.textContent = '';
    box.appendChild(el('div', { class: 'f-line' }, [el('b', { text: f.name }), el('span', { text: next })]));
    box.appendChild(el('div', {
      class: 'meter', role: 'progressbar', 'aria-label': 'Friendship with ' + a.name, 'aria-valuemin': '0', 'aria-valuemax': '100',
      'aria-valuenow': String(pct), 'aria-valuetext': f.name + '. ' + next,
    }, [el('span', { style: 'width:' + pct + '%' })]));
  }

  function openVisit(kind) {
    var a = animal(kind), m = P.moodOn(kind, day);
    openKind = kind;
    // Marks the page while a visit is open; cleared once the paddock is drawn again after it.
    root.setAttribute('data-visiting', kind);
    var critter = $('visit-critter');
    critter.textContent = a.emoji;
    critter.className = 'v-critter';
    // The animal looks up at you.
    if (!reduced()) { void critter.offsetWidth; critter.classList.add('look'); }
    $('visit-name').textContent = a.name;
    var mood = $('visit-mood');
    mood.textContent = '';
    if (P.missedYou(s, kind)) mood.appendChild(el('span', { class: 'b-missed', text: P.missedLine(kind, day) + ' ' }));
    mood.appendChild(el('span', { 'aria-hidden': 'true', text: m.mood.icon + ' ' }));
    mood.appendChild(document.createTextNode(m.line));
    friendBox(kind);
    if (s.offers[kind]) showReaction(kind, false, null); else showOffers(kind);
    openDialog('visit');
    var first = $('visit-body').querySelector('button');
    if (first) first.focus({ preventScroll: true });
    if (!s.offers[kind]) say(m.line + ' What would ' + a.name + ' like? Choose one for today.');
  }

  function showOffers(kind) {
    var a = animal(kind), body = $('visit-body');
    body.textContent = '';
    body.appendChild(el('p', { class: 'ask', text: 'What would ' + a.name + ' like?' }));
    body.appendChild(el('div', { class: 'offers' }, P.offersOn(kind, day).map(function (id, i) {
      var o = a.offers[id];
      return el('button', { class: 'offer', type: 'button', 'data-offer': id, onclick: function () { choose(kind, id); } }, [
        el('span', { class: 'o-emoji', 'aria-hidden': 'true', text: o.emoji }),
        el('span', { class: 'o-label', text: o.label }),
        el('kbd', { class: 'o-key', 'aria-hidden': 'true', text: String(i + 1) }),
      ]);
    })));
    // The first choice is the one that counts, so say so before it is made.
    body.appendChild(el('p', { class: 'choose', text: 'Choose one for today.' }));
  }

  // The offer counts for the day the visit was opened on, even if midnight has passed since.
  function choose(kind, offerId) {
    if (openKind !== kind) return;
    if (!PREVIEW) sync();
    if (s.offers[kind]) { showReaction(kind, false, null); renderHerd(); return; }
    var before = P.level(P.heartsOf(s, kind));
    var q = P.offer(p, day, kind, offerId);
    if (q === p) return;
    p = q;
    save();
    refresh();
    showReaction(kind, true, before);
    renderHerd();
  }

  function showReaction(kind, fresh, levelBefore) {
    var a = animal(kind), o = s.offers[kind], m = P.moodOn(kind, day);
    var r = P.reaction(kind, m.mood.id, o), n = P.HEARTS[r], line = P.reactionLine(kind, o, r, day);
    var title = r === 'loved' ? a.name + ' loves it!' : r === 'liked' ? a.name + ' likes it.' : 'Not today.';
    var lvl = P.level(P.heartsOf(s, kind)), up = fresh && levelBefore !== null && lvl > levelBefore;
    var body = $('visit-body');
    body.textContent = '';
    body.appendChild(el('div', { class: 'reaction ' + r }, [
      el('p', { class: 'r-hearts', 'aria-hidden': 'true', text: heartRow(n) }),
      el('p', { class: 'r-title', text: title }),
      el('p', { class: 'r-line' }, [el('span', { 'aria-hidden': 'true', text: a.offers[o].emoji + ' ' }), line]),
    ]));
    if (up) {
      body.appendChild(el('div', { class: 'level-up' }, [
        el('p', { class: 'lu-title', text: 'You and ' + a.name + ' are now ' + P.LEVEL_NAMES[lvl] }),
        el('p', { class: 'lu-sub', text: 'A new card for your book' }),
        factCard(kind, lvl - 1),
      ]));
    }
    body.appendChild(el('button', { class: 'primary', type: 'button', id: 'visit-done', text: 'Back to the paddock', 'data-close': true }));
    friendBox(kind);
    if (fresh) {
      $('visit-done').focus({ preventScroll: true });
      say(title + ' ' + heartsText(n) + '. ' + line + (up ? ' You and ' + a.name + ' are now ' + P.LEVEL_NAMES[lvl] + '. A new card is in your book.' : ''));
      animateReaction(r);
    }
  }

  // The happy moment, a nod, or a shrug. Nothing moves when reduced motion is asked for.
  function animateReaction(r) {
    var critter = $('visit-critter');
    critter.className = 'v-critter';
    if (reduced()) return;
    void critter.offsetWidth;
    critter.classList.add(r === 'loved' ? 'happy' : r === 'liked' ? 'nod' : 'shrug');
    if (r === 'no') return;
    var layer = el('div', { class: 'burst', 'aria-hidden': 'true' });
    var count = r === 'loved' ? 9 : 3;
    for (var i = 0; i < count; i++) {
      layer.appendChild(el('span', {
        text: r === 'loved' && i % 3 === 2 ? '✨' : '❤️',
        style: '--x:' + Math.round(Math.random() * 120 - 60) + 'px;--d:' + (Math.random() * 0.35).toFixed(2) + 's;--s:' + (0.8 + Math.random() * 0.6).toFixed(2),
      }));
    }
    critter.parentNode.appendChild(layer);
    setTimeout(function () { layer.remove(); }, 1800);
  }

  // After a visit: back to the paddock, focus on whoever is next, and the day can move on.
  function afterVisit() {
    var was = openKind;
    openKind = null;
    render();
    root.removeAttribute('data-visiting');
    var tiles = Array.prototype.slice.call($('herd').querySelectorAll('.beast'));
    var start = Math.max(0, tiles.findIndex(function (t) { return t.getAttribute('data-kind') === was; }));
    var next = tiles.slice(start).concat(tiles.slice(0, start)).filter(function (t) { return !t.classList.contains('visited'); })[0];
    if (next) next.focus({ preventScroll: true });
    else if (P.everyoneVisited(s)) {
      var share = $('closing').querySelector('.primary');
      if (share) share.focus({ preventScroll: true });
      if (!reduced()) $('closing').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      say(closingSummary());
    } else if (was) {
      var same = $('herd').querySelector('[data-kind="' + was + '"]');
      if (same) same.focus({ preventScroll: true });
    }
    tick();
  }

  // ---- the end of the visit

  function closingSummary() {
    var hearts = P.dayResults(s).reduce(function (s, r) { return s + r.hearts; }, 0);
    return "That's everyone for today. " + heartsText(hearts) + ' earned. Come back tomorrow, they\'ll be in a different mood.';
  }

  function renderClosing() {
    var box = $('closing');
    if (!P.everyoneVisited(s) || visitOpen()) { box.hidden = true; return; }
    var results = P.dayResults(s), hearts = results.reduce(function (n, r) { return n + r.hearts; }, 0);
    var streak = s.streak;
    box.textContent = '';
    box.hidden = false;
    box.appendChild(el('h2', { id: 'closing-title', text: "That's everyone for today" }));
    box.appendChild(el('ul', { class: 'today-list' }, results.map(function (r) {
      var a = animal(r.kind);
      return el('li', { class: r.result }, [
        el('span', { class: 't-emoji', 'aria-hidden': 'true', text: a.emoji }),
        el('span', { class: 't-text' }, [el('b', { text: a.name }), ' ' + (r.result === 'no' ? 'said not today' : lower(resultText(r.kind, r.offer, r.result)))]),
        el('span', { class: 't-hearts', 'aria-label': heartsText(r.hearts), text: heartRow(r.hearts).replace(/🤍/g, '') }),
      ]);
    })));
    box.appendChild(el('div', { class: 'sums' }, [
      el('div', {}, [el('b', { text: String(hearts) }), el('span', { text: hearts === 1 ? 'heart today' : 'hearts today' })]),
      el('div', {}, [el('b', { text: String(streak) }), el('span', { text: streak === 1 ? 'day running' : 'days running' })]),
      el('div', {}, [el('b', { text: String(P.totalHearts(s)) }), el('span', { text: 'hearts in all' })]),
    ]));
    box.appendChild(el('div', { class: 'actions' }, [
      el('button', { class: 'primary', type: 'button', text: 'Share', onclick: share }),
      el('button', { class: 'secondary', type: 'button', text: 'Your book', onclick: function () { openBook(); } }),
    ]));
    box.appendChild(el('pre', { class: 'share-text', id: 'share-text', hidden: true }));
    box.appendChild(el('p', { class: 'next', id: 'next', text: PREVIEW ? 'Preview: use the arrows at the top to try another day.' : "Come back tomorrow, they'll be in a different mood." }));
  }

  // ---- sharing

  function share() {
    var text = P.shareText(s, SITE_URL);
    var showText = function () {
      var pre = $('share-text');
      pre.textContent = text;
      pre.hidden = false;
      try { window.getSelection().selectAllChildren(pre); } catch (e) { /* the text is still there to copy by hand */ }
      toast('Select the text below to copy it');
    };
    copyText(text, function () { toast('Copied. Paste it to a friend'); }, showText);
  }
  function copyText(text, ok, fail) {
    var copy = function () {
      if (!navigator.clipboard || !navigator.clipboard.writeText) { fail(); return; }
      try { navigator.clipboard.writeText(text).then(ok, fail); } catch (e) { fail(); }
    };
    if (TOUCH && navigator.share) {
      navigator.share({ text: text }).then(function () { /* shared */ }, function (err) { if (!err || err.name !== 'AbortError') copy(); });
    } else {
      copy();
    }
  }

  // ---- the book

  var bookKind = null;

  function factCard(kind, i) {
    var a = animal(kind), f = FACTS[kind][i];
    return el('article', { class: 'fact' }, [
      el('h4', { text: 'About ' + a.plural + ' · ' + (i + 1) + ' of ' + FACTS[kind].length }),
      el('p', { text: f.text }),
      el('a', { href: f.url, target: '_blank', rel: 'noopener', text: 'Source: ' + f.source }),
    ]);
  }

  function openBook(kind) {
    bookKind = kind || bookKind || s.animals[0].kind;
    if (!P.find(s, bookKind)) bookKind = s.animals[0].kind;
    renderBook();
    openDialog('book');
    var tab = $('book-body').querySelector('[aria-selected="true"]');
    if (tab) tab.focus({ preventScroll: true });
  }

  function renderBook() {
    var body = $('book-body');
    body.textContent = '';
    body.appendChild(el('div', { class: 'nums' }, [
      num(s.visits, s.visits === 1 ? 'Visit' : 'Visits'), num(s.streak, 'Day streak'), num(s.best, 'Best streak'), num(P.totalHearts(s), 'Hearts'),
    ]));
    var tabs = el('div', { class: 'tabs', role: 'tablist', 'aria-label': 'Your animals' });
    s.animals.forEach(function (x) {
      var a = animal(x.kind), on = x.kind === bookKind;
      tabs.appendChild(el('button', {
        class: 'tab', type: 'button', role: 'tab', id: 'tab-' + x.kind, 'aria-selected': on ? 'true' : 'false', 'aria-controls': 'book-page',
        tabindex: on ? '0' : '-1', onclick: function () { bookKind = x.kind; renderBook(); $('tab-' + x.kind).focus(); },
      }, [el('span', { class: 'tab-emoji', 'aria-hidden': 'true', text: a.emoji }), el('span', { text: a.name })]));
    });
    tabs.addEventListener('keydown', function (e) {
      if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
      var i = s.animals.findIndex(function (x) { return x.kind === bookKind; }), n = s.animals.length;
      bookKind = s.animals[(i + (e.key === 'ArrowRight' ? 1 : n - 1)) % n].kind;
      renderBook();
      $('tab-' + bookKind).focus();
      e.preventDefault();
    });
    body.appendChild(tabs);
    if (s.animals.length < P.ANIMALS.length) body.appendChild(el('p', { class: 'fine soon', text: 'More friends turn up at the gate as your hearts add up.' }));

    var kind = bookKind, a = animal(kind), f = P.friendship(P.heartsOf(s, kind));
    var page = el('div', { class: 'page', id: 'book-page', role: 'tabpanel', 'aria-labelledby': 'tab-' + kind });
    page.appendChild(el('h3', { class: 'page-title', text: a.emoji + ' ' + a.name + ' the ' + kind }));
    page.appendChild(el('p', { class: 'page-level' }, [
      el('b', { text: f.name }), ' · ' + heartsText(P.heartsOf(s, kind)) + (f.need ? ' · ' + (f.need - f.into) + ' more to ' + P.LEVEL_NAMES[f.level + 1] : ''),
    ]));
    page.appendChild(el('h4', { class: 'sub', text: 'What ' + a.name + ' loves' }));
    var known = s.known[kind] || [];
    page.appendChild(el('ul', { class: 'loves' }, a.moods.map(function (m) {
      var k = known.indexOf(m.id) >= 0, o = a.offers[m.loved];
      return el('li', { class: k ? 'known' : '' }, [
        el('span', { class: 'l-mood' }, [el('span', { 'aria-hidden': 'true', text: m.icon + ' ' }), 'When ' + m.word]),
        el('span', { class: 'l-offer', text: k ? o.emoji + ' ' + lower(o.label) : 'not found out yet' }),
      ]);
    })));
    page.appendChild(el('h4', { class: 'sub', text: 'Cards' }));
    FACTS[kind].forEach(function (fact, i) {
      if (i < f.level) page.appendChild(factCard(kind, i));
      else page.appendChild(el('div', { class: 'fact locked' }, [el('span', { 'aria-hidden': 'true', text: '🔒 ' }), 'Card ' + (i + 1) + ' comes when you are ' + P.LEVEL_NAMES[i + 1].toLowerCase()]));
    });
    body.appendChild(page);
    // The moments seen so far, newest first.
    body.appendChild(el('h4', { class: 'sub', text: 'Moments' }));
    if (!s.seen.length) body.appendChild(el('p', { class: 'fine', text: 'Every week or so, two of your animals get up to something. The ones you see are kept here.' }));
    else body.appendChild(el('ul', { class: 'moments' }, s.seen.slice().reverse().map(function (x) { return momentCard(x.moment, x.day); })));
    if (PREVIEW) body.appendChild(el('p', { class: 'fine', text: 'This is a preview, so nothing here is saved.' }));
  }
  function num(value, label) {
    return el('div', {}, [el('b', { text: String(value) }), el('span', { text: label })]);
  }

  // ---- copying and pasting a save

  function saveMsg(text) { $('save-msg').textContent = text; }
  function copySave() {
    var text = P.exportSave(p), box = $('paste-box');
    var show = function () {
      box.value = text;
      box.focus();
      box.select();
      saveMsg('Copy the text in the box, then paste it on your other device.');
    };
    var copy = function () {
      if (!navigator.clipboard || !navigator.clipboard.writeText) { show(); return; }
      try { navigator.clipboard.writeText(text).then(function () { saveMsg('Copied. Paste it into Paddock on your other device.'); toast('Save copied'); }, show); } catch (e) { show(); }
    };
    copy();
  }
  var PASTE_ERRORS = {
    'too-long': "That's far too long to be a Paddock save, so nothing was changed.",
    'not-a-save': "That doesn't look like a Paddock save. It starts with PADDOCK2:",
    problems: "That save has something in it that can't be right, so it wasn't loaded. Nothing was changed.",
  };
  function loadSave() {
    var got = P.importSave($('paste-box').value, PREVIEW ? day : today());
    if (got.error) { saveMsg(PASTE_ERRORS[got.error]); return; }
    if (!PREVIEW) sync();
    // Merge rather than replace, so pasting an older save never loses what this device has.
    p = P.merge(got.save, p);
    save();
    $('paste-box').value = '';
    saveMsg('Loaded. Your animals are here.');
    toast('Save loaded');
    refresh();
    justArrived = P.newArrival(s);
    render();
  }

  // ---- moments

  function momentCard(m, d) {
    var kids = [el('h4', { text: m.kinds.map(function (k) { return animal(k).emoji; }).join(' ') + ' ' + m.title + (d ? ' · day ' + d : '') })];
    return el('li', { class: 'moment-card' }, kids.concat(m.lines.map(function (line) { return el('p', { text: line }); })));
  }

  // A moment due today plays as the paddock opens, once; seeing it is kept in the save.
  function playMoment() {
    var m = P.momentFor(s);
    if (!m) return;
    moment = { m: m, fresh: true };
    if (!PREVIEW) {
      p = P.seeMoment(p, day, m.id);
      save();
      refresh();
    }
  }

  function renderMoment() {
    var box = $('moment');
    if (!moment) { box.hidden = true; return; }
    var m = moment.m;
    box.hidden = false;
    $('moment-title').textContent = m.kinds.map(function (k) { return animal(k).emoji; }).join(' ') + ' ' + m.title;
    var lines = $('moment-lines');
    if (moment.fresh) {
      lines.textContent = '';
      m.lines.forEach(function (line, i) { lines.appendChild(el('p', { class: 'm-line', style: '--n:' + i, text: line })); });
      // The lines come one after another; with reduced motion they are all there at once.
      box.classList.toggle('play', !reduced());
      moment.fresh = false;
      say(m.title + '. ' + m.lines.join(' '));
    }
  }

  // ---- the clock: the time of day, and moving on at midnight

  function tick() {
    setTimeOfDay();
    if (PREVIEW) return;
    var t = today();
    // A new day waits until the animal being visited is left.
    if (t !== day && !visitOpen()) {
      sync();
      startDay(t);
    }
  }

  // ---- dialogs, toast, screen reader

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
  // Spoken by screen readers. While the visit is open the rest of the page is inert, so it
  // speaks through a live region inside the visit instead.
  function say(text) {
    var live = $('visit').open ? $('visit-live') : $('live');
    live.textContent = '';
    setTimeout(function () { live.textContent = text; }, 30);
  }

  // ---- wiring

  // A held Enter or Space key repeats, and focus moves from an offer to "Back to the paddock",
  // so a repeat would carry on. Only the first press of a key counts.
  document.addEventListener('keydown', function (e) {
    if (!e.repeat || (e.key !== 'Enter' && e.key !== ' ')) return;
    if (e.target.closest && e.target.closest('.offer, #visit-done, .beast')) e.preventDefault();
  }, true);
  // In a visit, 1, 2 and 3 pick an offer.
  $('visit').addEventListener('keydown', function (e) {
    if (e.altKey || e.ctrlKey || e.metaKey || !/^[1-3]$/.test(e.key)) return;
    var b = $('visit-body').querySelectorAll('.offer')[Number(e.key) - 1];
    if (b) { e.preventDefault(); b.click(); }
  });
  $('visit').addEventListener('close', afterVisit);
  $('help-btn').addEventListener('click', function () { saveMsg(''); openDialog('help'); });
  $('book-btn').addEventListener('click', function () { openBook(); });
  $('copy-save').addEventListener('click', copySave);
  $('moment-done').addEventListener('click', function () {
    moment = null;
    renderMoment();
    var next = $('herd').querySelector('.beast:not(.visited)') || $('herd').querySelector('.beast');
    if (next) next.focus({ preventScroll: true });
  });
  $('load-save').addEventListener('click', loadSave);
  Array.prototype.forEach.call(document.querySelectorAll('dialog'), function (d) {
    d.addEventListener('click', function (e) {
      if (e.target === d || (e.target.closest && e.target.closest('[data-close]'))) closeDialog(d);
    });
  });
  $('prev-day').addEventListener('click', function () {
    if (previewDay <= 1) return;
    previewDay--;
    previewStage = Math.max(1, previewStage - 1);
    startPreview();
  });
  $('next-day').addEventListener('click', function () {
    previewDay++;
    previewStage++;
    startPreview();
  });
  // Another tab saved: take in what it did, and catch up if it has moved on a day.
  window.addEventListener('storage', function (e) {
    if (PREVIEW || (e.key !== STORE_KEY && e.key !== null)) return;
    var fresh = readFresh();
    if (!fresh) return;
    var merged = P.merge(fresh, p);
    p = merged;
    // This tab had something the saved copy lacks (a write that failed, say): put it back.
    if (!P.same(merged, fresh)) save();
    refresh();
    if (visitOpen() && s.offers[openKind] && !$('visit-done')) showReaction(openKind, false, null);
    if (!visitOpen()) render(); else renderHerd();
  });
  document.addEventListener('visibilitychange', function () { if (!document.hidden) tick(); });
  setInterval(tick, 1000);

  // ---- start

  if (PREVIEW) {
    previewDay = forcedDay > 0 ? forcedDay : today();
    previewStage = forcedStage > 0 ? forcedStage : previewDay;
    startPreview();
  } else {
    var loaded = load();
    if (!loaded) note("Your paddock can't be saved in this browser, so it starts afresh each time.");
    else if (loaded.from === 'backup') note('Your save had a problem, so it was put back from your daily backup.');
    else if (loaded.from === 'repaired') note('Part of your save had a problem. What could be used is kept, with the rest from your daily backup.');
    else if (loaded.from === 'lost') note("Your save couldn't be read, so the paddock has started afresh. The old save is kept in this browser.");
    p = loaded && loaded.p ? loaded.p : P.newSave(today());
    startDay(today());
  }
  var first = unvisited()[0];
  if (first && !moment) say((P.missedYou(s, first.kind) ? P.missedLine(first.kind, day) + ' ' : '') + P.moodOn(first.kind, day).line + (firstVisit() ? ' Tap ' + animal(first.kind).name + ' to say hello.' : ''));
})();
