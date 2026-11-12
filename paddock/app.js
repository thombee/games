/*
 * Paddock page. Draws the paddock and its animals, runs a visit to each one, shows the day's
 * summary and the book of cards, and keeps the player's progress in localStorage. The rules
 * (moods, offers, hearts, arrivals, streak, merging saves) are in logic.js.
 */
(function () {
  'use strict';

  var P = window.Paddock;
  var FACTS = window.PADDOCK_FACTS;

  // The address added to shared results. Empty until the game has a home.
  var SITE_URL = 'https://thombee.github.io/games/paddock/';
  var STORE_KEY = 'paddock:v1';
  // A second copy, written on the first save of each day.
  var BACKUP_KEY = 'paddock:v1:backup';
  // Where an unreadable main save is kept, untouched, so it is never lost outright.
  var UNREADABLE_KEY = 'paddock:v1:unreadable';

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

  // ---- saved progress

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

  // The saved progress: { p, from } as P.restore gives it, or null if storage cannot be read.
  function load() {
    var main, backup;
    try {
      main = localStorage.getItem(STORE_KEY);
      backup = localStorage.getItem(BACKUP_KEY);
    } catch (e) {
      store.blocked = true;
      return null;
    }
    var b = P.restore(backup, null).p;
    store.backupDay = b ? b.visit.day : 0;
    var r = P.restore(main, backup);
    if (r.from === 'backup' || r.from === 'lost' || r.from === 'repaired') {
      // Keep the save that could not be read as it was, in case it can be mended by hand.
      try { if (main) localStorage.setItem(UNREADABLE_KEY, main); } catch (e) { /* nothing more to do */ }
    }
    return r;
  }

  // What is saved now, or null if there is nothing or it cannot be read.
  function readFresh() {
    if (PREVIEW || store.blocked) return null;
    try { return P.restore(localStorage.getItem(STORE_KEY), localStorage.getItem(BACKUP_KEY)).p; } catch (e) { return null; }
  }

  // Take in whatever another tab has saved, so nothing it did is overwritten.
  function sync() {
    var fresh = readFresh();
    if (fresh) p = P.merge(fresh, p);
  }

  /*
   * Write the progress. If the write fails, the copy in memory stays the truth and a note says
   * so; the next successful write carries everything. The backup is written on the first save
   * of each day.
   */
  function save() {
    if (PREVIEW || store.blocked) return;
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(p));
      if (p.visit.day > store.backupDay) {
        localStorage.setItem(BACKUP_KEY, JSON.stringify(p));
        store.backupDay = p.visit.day;
      }
      if (store.failing) { store.failing = false; note(''); }
    } catch (e) {
      store.failing = true;
      note("Couldn't save just now. Your animals are fine while this page stays open.");
    }
  }

  // ---- state

  // p: the player's progress. day: the day on screen. openKind: the animal being visited, if any.
  var p = null, day = 1, openKind = null, justArrived = null;
  var previewDay = 1, previewStage = 1;

  function today() { return Math.max(1, P.dayNumber()); }

  // Move to a day (never backwards) and draw it.
  function startDay(d) {
    var before = p;
    p = P.beginDay(p, d);
    day = p.visit.day;
    if (p !== before && !PREVIEW && p.visits > 0) save();
    justArrived = P.newArrival(p);
    render();
  }

  function startPreview() {
    p = P.previewProgress(previewDay, previewStage);
    day = previewDay;
    justArrived = P.newArrival(p);
    render();
  }

  // ---- drawing the paddock

  function setTimeOfDay() { $('paddock').setAttribute('data-time', P.timeOfDay(new Date())); }

  function firstVisit() { return p.visits === 0 && p.animals.length === 1 && !Object.keys(p.visit.offers).length; }
  function unvisited() { return p.animals.filter(function (x) { return !p.visit.offers[x.kind]; }); }

  function render() {
    $('day-tag').textContent = 'Day ' + day;
    $('preview-bar').hidden = !PREVIEW;
    $('preview-day').textContent = 'Day ' + day + ' · visit ' + previewStage;
    setTimeOfDay();
    var arrival = $('arrival'), newKind = P.newArrival(p);
    arrival.hidden = !newKind || !!p.visit.offers[newKind];
    if (newKind) arrival.textContent = '🚪 Someone new has arrived. Say hello to ' + animal(newKind).name + ' the ' + newKind + '.';
    renderHint();
    renderHerd();
    renderClosing();
  }

  function renderHint() {
    var hint = $('hint'), left = unvisited();
    hint.hidden = !left.length;
    hint.classList.toggle('first', firstVisit());
    if (firstVisit()) hint.textContent = 'Tap ' + animal(p.animals[0].kind).name + ' to say hello';
    else if (left.length === p.animals.length) hint.textContent = p.animals.length === 1 ? 'Tap ' + animal(left[0].kind).name + ' to say hello' : 'Tap each animal to say hello';
    else if (left.length) hint.textContent = left.length === 1 ? 'Just ' + animal(left[0].kind).name + ' still to see' : left.length + ' still to see';
  }

  function tileLabel(x) {
    var a = animal(x.kind), o = p.visit.offers[x.kind];
    if (o) {
      var r = P.reaction(x.kind, P.moodOn(x.kind, day).mood.id, o);
      return a.name + ' the ' + x.kind + '. Visited today: ' + resultText(x.kind, o, r).toLowerCase() + ', ' + heartsText(P.HEARTS[r]) + '.';
    }
    var greet = P.missedYou(p, x.kind, day) ? P.missedLine(x.kind, day) + ' ' : '';
    return a.name + ' the ' + x.kind + '. ' + greet + P.moodOn(x.kind, day).line;
  }

  function renderHerd() {
    var herd = $('herd'), focused = document.activeElement && document.activeElement.getAttribute('data-kind');
    herd.textContent = '';
    herd.setAttribute('data-count', String(p.animals.length));
    p.animals.forEach(function (x, i) {
      var a = animal(x.kind), o = p.visit.offers[x.kind], m = P.moodOn(x.kind, day), bubble;
      if (o) {
        var r = P.reaction(x.kind, m.mood.id, o);
        bubble = el('span', { class: 'bubble done ' + r }, [
          el('span', { class: 'b-hearts', text: heartRow(P.HEARTS[r]) }),
          el('span', { class: 'b-text', text: resultText(x.kind, o, r) }),
        ]);
      } else {
        bubble = el('span', { class: 'bubble' }, [
          P.missedYou(p, x.kind, day) && el('span', { class: 'b-missed', text: P.missedLine(x.kind, day) }),
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
    var a = animal(kind), f = P.friendship(P.heartsOf(p, kind));
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
    if (P.missedYou(p, kind, day)) mood.appendChild(el('span', { class: 'b-missed', text: P.missedLine(kind, day) + ' ' }));
    mood.appendChild(el('span', { 'aria-hidden': 'true', text: m.mood.icon + ' ' }));
    mood.appendChild(document.createTextNode(m.line));
    friendBox(kind);
    if (p.visit.offers[kind]) showReaction(kind, false, null); else showOffers(kind);
    openDialog('visit');
    var first = $('visit-body').querySelector('button');
    if (first) first.focus({ preventScroll: true });
    if (!p.visit.offers[kind]) say(m.line + ' What would ' + a.name + ' like?');
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
  }

  function choose(kind, offerId) {
    if (openKind !== kind) return;
    if (!PREVIEW) {
      sync();
      // Another tab has moved on to a new day: follow it.
      if (p.visit.day > day) { closeDialog($('visit')); startDay(p.visit.day); return; }
    }
    if (p.visit.offers[kind]) { showReaction(kind, false, null); render(); return; }
    var before = P.level(P.heartsOf(p, kind));
    var q = P.offer(p, day, kind, offerId);
    if (q === p) return;
    p = q;
    save();
    showReaction(kind, true, before);
    renderHerd();
  }

  function showReaction(kind, fresh, levelBefore) {
    var a = animal(kind), o = p.visit.offers[kind], m = P.moodOn(kind, day);
    var r = P.reaction(kind, m.mood.id, o), n = P.HEARTS[r], line = P.reactionLine(kind, o, r, day);
    var title = r === 'loved' ? a.name + ' loves it!' : r === 'liked' ? a.name + ' likes it.' : 'Not today.';
    var lvl = P.level(P.heartsOf(p, kind)), up = fresh && levelBefore !== null && lvl > levelBefore;
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
    else if (P.everyoneVisited(p)) {
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
    var hearts = P.dayResults(p).reduce(function (s, r) { return s + r.hearts; }, 0);
    return "That's everyone for today. " + heartsText(hearts) + ' earned. Come back tomorrow, they\'ll be in a different mood.';
  }

  function renderClosing() {
    var box = $('closing');
    if (!P.everyoneVisited(p) || visitOpen()) { box.hidden = true; return; }
    var results = P.dayResults(p), hearts = results.reduce(function (s, r) { return s + r.hearts; }, 0);
    var streak = P.currentStreak(p, day);
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
      el('div', {}, [el('b', { text: String(P.totalHearts(p)) }), el('span', { text: 'hearts in all' })]),
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
    var text = P.shareText(p, SITE_URL);
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
    bookKind = kind || bookKind || p.animals[0].kind;
    if (!P.find(p, bookKind)) bookKind = p.animals[0].kind;
    renderBook();
    openDialog('book');
    var tab = $('book-body').querySelector('[aria-selected="true"]');
    if (tab) tab.focus({ preventScroll: true });
  }

  function renderBook() {
    var body = $('book-body'), streak = P.currentStreak(p, day);
    body.textContent = '';
    body.appendChild(el('div', { class: 'nums' }, [
      num(p.visits, p.visits === 1 ? 'Visit' : 'Visits'), num(streak, 'Day streak'), num(p.best, 'Best streak'), num(P.totalHearts(p), 'Hearts'),
    ]));
    var tabs = el('div', { class: 'tabs', role: 'tablist', 'aria-label': 'Your animals' });
    p.animals.forEach(function (x) {
      var a = animal(x.kind), on = x.kind === bookKind;
      tabs.appendChild(el('button', {
        class: 'tab', type: 'button', role: 'tab', id: 'tab-' + x.kind, 'aria-selected': on ? 'true' : 'false', 'aria-controls': 'book-page',
        tabindex: on ? '0' : '-1', onclick: function () { bookKind = x.kind; renderBook(); $('tab-' + x.kind).focus(); },
      }, [el('span', { class: 'tab-emoji', 'aria-hidden': 'true', text: a.emoji }), el('span', { text: a.name })]));
    });
    tabs.addEventListener('keydown', function (e) {
      if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
      var i = p.animals.findIndex(function (x) { return x.kind === bookKind; }), n = p.animals.length;
      bookKind = p.animals[(i + (e.key === 'ArrowRight' ? 1 : n - 1)) % n].kind;
      renderBook();
      $('tab-' + bookKind).focus();
      e.preventDefault();
    });
    body.appendChild(tabs);
    if (p.animals.length < P.ANIMALS.length) body.appendChild(el('p', { class: 'fine soon', text: 'More friends turn up at the gate as your hearts add up.' }));

    var kind = bookKind, a = animal(kind), f = P.friendship(P.heartsOf(p, kind));
    var page = el('div', { class: 'page', id: 'book-page', role: 'tabpanel', 'aria-labelledby': 'tab-' + kind });
    page.appendChild(el('h3', { class: 'page-title', text: a.emoji + ' ' + a.name + ' the ' + kind }));
    page.appendChild(el('p', { class: 'page-level' }, [
      el('b', { text: f.name }), ' · ' + heartsText(P.heartsOf(p, kind)) + (f.need ? ' · ' + (f.need - f.into) + ' more to ' + P.LEVEL_NAMES[f.level + 1] : ''),
    ]));
    page.appendChild(el('h4', { class: 'sub', text: 'What ' + a.name + ' loves' }));
    var known = p.known[kind] || [];
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
  function loadSave() {
    var got = P.importSave($('paste-box').value);
    if (!got) { saveMsg("That doesn't look like a Paddock save. It starts with PADDOCK1:"); return; }
    if (!PREVIEW) sync();
    // Merge rather than replace, so pasting an older save never loses what this device has.
    p = P.merge(got, p);
    var target = PREVIEW ? day : Math.max(today(), p.visit.day);
    p = P.beginDay(p, target);
    day = p.visit.day;
    save();
    $('paste-box').value = '';
    saveMsg('Loaded. Your animals are here.');
    toast('Save loaded');
    justArrived = P.newArrival(p);
    render();
  }

  // ---- the clock: the time of day, and moving on at midnight

  function tick() {
    setTimeOfDay();
    if (PREVIEW) return;
    var target = Math.max(today(), p.visit.day);
    // A new day waits until the animal being visited is left.
    if (target > day && !visitOpen()) {
      sync();
      startDay(Math.max(target, p.visit.day));
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
  function say(text) {
    var live = $('live');
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
    if (p.visit.day > day) { if (!visitOpen()) startDay(p.visit.day); return; }
    if (visitOpen() && p.visit.offers[openKind] && !$('visit-done')) showReaction(openKind, false, null);
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
    else if (loaded.from === 'repaired') note('Part of your save had a problem and was mended from your daily backup.');
    else if (loaded.from === 'lost') note("Your save couldn't be read, so the paddock has started afresh. The old save is kept in this browser.");
    p = loaded && loaded.p ? loaded.p : P.newProgress(today());
    day = p.visit.day;
    startDay(Math.max(today(), p.visit.day));
  }
  var first = unvisited()[0];
  if (first) say((P.missedYou(p, first.kind, day) ? P.missedLine(first.kind, day) + ' ' : '') + P.moodOn(first.kind, day).line + (firstVisit() ? ' Tap ' + animal(first.kind).name + ' to say hello.' : ''));
})();
