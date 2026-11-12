/*
 * Paddock rules. No DOM in here: app.js draws the page, this file decides each animal's mood
 * and offers for a day, how an offer goes down, hearts, friendship levels, who arrives when,
 * the streak, the share text, and how saved progress is read, repaired and merged. Works as a
 * plain <script> in the browser (after animals.js) and via require() in Node.
 *
 * The game: a few animals in a paddock, each in a mood for the day. The player offers each
 * one something; it loves it (two hearts), likes it (one) or not today (none). Hearts build
 * friendship, friendship unlocks cards, and more total friendship brings more animals.
 */
(function (root) {
  'use strict';

  var ANIMALS = root.PADDOCK_ANIMALS || (typeof require === 'function' ? require('./animals.js') : null);
  var BY_KIND = {};
  ANIMALS.forEach(function (a, i) { a.index = i; BY_KIND[a.kind] = a; });

  // Day 1, as a local calendar date.
  var EPOCH = { year: 2026, month: 11, day: 13 };
  var VERSION = 1;

  var HEARTS = { loved: 2, liked: 1, no: 0 };
  // Hearts with one animal needed for each friendship level. Each level takes more than the last.
  var LEVELS = [0, 3, 12, 30, 72, 165];
  var LEVEL_NAMES = ['Just met', 'Friendly', 'Pals', 'Good pals', 'Close friends', 'Best friends'];
  // The next animal turns up the day after total hearts reach ARRIVAL_MARKS[n - 1], where n is
  // the number of animals so far, or after ARRIVAL_WAIT[n - 1] days with a visit since the last
  // arrival, whichever comes first. The wait keeps a player who has not worked anyone out yet
  // from being stuck.
  var ARRIVAL_MARKS = [1, 10, 26, 48, 80, 120, 170];
  var ARRIVAL_WAIT = [2, 6, 7, 7, 8, 8, 9];
  // An animal not visited for this many days greets the player as someone missed.
  var MISSED_AFTER = 3;
  var SHOWN = 3;

  // ---- small helpers

  // A small seeded random number generator (mulberry32), so a day is the same for everyone.
  function rng(seed) {
    var s = seed >>> 0;
    return function () {
      s = (s + 0x6d2b79f5) | 0;
      var t = Math.imul(s ^ (s >>> 15), 1 | s);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function seed(a, b, c) { return Math.imul(a + 0x3c6ef372, 2654435761) ^ Math.imul(b + 0x1b873593, 0x85ebca6b) ^ Math.imul(c + 7, 0xc2b2ae35); }
  function shuffle(rand, list) {
    var a = list.slice();
    for (var i = a.length - 1; i > 0; i--) {
      var j = Math.floor(rand() * (i + 1)), t = a[i];
      a[i] = a[j];
      a[j] = t;
    }
    return a;
  }
  function mod(n, m) { return ((n % m) + m) % m; }
  function isInt(n) { return typeof n === 'number' && Number.isInteger(n); }

  // ---- the calendar

  function dayNumber(date) {
    var d = date || new Date();
    var ms = Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) - Date.UTC(EPOCH.year, EPOCH.month - 1, EPOCH.day);
    return Math.round(ms / 864e5) + 1;
  }
  function msUntilTomorrow(date) {
    var d = date || new Date();
    return new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1).getTime() - d.getTime();
  }
  // 'morning', 'afternoon', 'dusk' or 'night' on the player's clock.
  function timeOfDay(date) {
    var h = (date || new Date()).getHours();
    return h >= 5 && h < 12 ? 'morning' : h >= 12 && h < 17 ? 'afternoon' : h >= 17 && h < 21 ? 'dusk' : 'night';
  }

  // ---- moods and offers: the same for everyone on a calendar day

  /*
   * The cycle a day falls in for one animal: each run of n days (n = its number of moods)
   * holds every mood once, in a shuffled order. When a cycle would start with the mood the
   * last one ended on, its first two moods swap, so a mood never lasts two days running.
   * Only positions 0 and 1 can swap and n is at least five, so a cycle's last mood is always
   * the one its own shuffle put there.
   */
  function cycleOrder(a, k) {
    var n = a.moods.length, ids = [];
    for (var i = 0; i < n; i++) ids.push(i);
    var order = shuffle(rng(seed(a.index, k, 1)), ids);
    var before = shuffle(rng(seed(a.index, k - 1, 1)), ids);
    if (order[0] === before[n - 1]) { var t = order[0]; order[0] = order[1]; order[1] = t; }
    return order;
  }

  // The animal's mood on a calendar day: { mood, line } where line is the hint for the bubble.
  function moodOn(kind, day) {
    var a = BY_KIND[kind], n = a.moods.length;
    var k = Math.floor((day - 1) / n), mood = a.moods[cycleOrder(a, k)[mod(day - 1, n)]];
    return { mood: mood, line: mood.lines[mod(k, mood.lines.length)] };
  }

  // How the animal takes an offer in a mood: 'loved', 'liked' or 'no'.
  function reaction(kind, moodId, offerId) {
    var mood = BY_KIND[kind].moods.filter(function (m) { return m.id === moodId; })[0];
    if (!mood) return 'no';
    return mood.loved === offerId ? 'loved' : mood.liked.indexOf(offerId) >= 0 ? 'liked' : 'no';
  }

  // The three offers for an animal on a day, in the order shown: the loved one and two others.
  function offersOn(kind, day) {
    var a = BY_KIND[kind], mood = moodOn(kind, day).mood, rand = rng(seed(a.index, day, 2));
    var others = Object.keys(a.offers).filter(function (id) { return id !== mood.loved; });
    return shuffle(rand, [mood.loved].concat(shuffle(rand, others).slice(0, SHOWN - 1)));
  }

  // The line for a reaction: the animal's own line for a loved offer, else one of its stock
  // lines, chosen by day so the same line never comes two days running.
  function reactionLine(kind, offerId, result, day) {
    var a = BY_KIND[kind];
    if (result === 'loved') return a.offers[offerId].loved;
    var lines = result === 'liked' ? a.liked : a.notToday;
    return lines[mod(day, lines.length)];
  }

  // ---- friendship

  function level(hearts) {
    var n = 0;
    for (var i = 1; i < LEVELS.length; i++) if (hearts >= LEVELS[i]) n = i;
    return n;
  }
  // { level, name, into, need }: hearts into the current level and needed for the next (0 at the top).
  function friendship(hearts) {
    var l = level(hearts), top = l === LEVELS.length - 1;
    return { level: l, name: LEVEL_NAMES[l], into: hearts - LEVELS[l], need: top ? 0 : LEVELS[l + 1] - LEVELS[l] };
  }

  // ---- the player's progress

  /*
   * Progress, all plain JSON:
   *   v            format version
   *   start        the calendar day of the first visit
   *   animals      [{ kind, arrived, hearts, lastSeen }] in order of arrival. `hearts` counts
   *                every day before visit.day; today's offers are added on top.
   *   visit        { day, offers: { kind: offerId } }: the current day and what was offered
   *   lastDay      the last day with an offer; streak, best: days running with an offer
   *   visits       days with an offer; arrivalVisits: the value of `visits` at the last arrival
   *   known        { kind: [moodId] }: moods in which the player has seen what the animal loves
   */
  function newProgress(day) {
    return {
      v: VERSION, start: day, animals: [{ kind: ANIMALS[0].kind, arrived: day, hearts: 0, lastSeen: 0 }],
      visit: { day: day, offers: {} }, lastDay: 0, streak: 0, best: 0, visits: 0, arrivalVisits: 0, known: {},
    };
  }
  function clone(p) { return JSON.parse(JSON.stringify(p)); }
  function find(p, kind) { return p.animals.filter(function (x) { return x.kind === kind; })[0] || null; }

  // The hearts from one offer on one day.
  function offerHearts(kind, offerId, day) { return HEARTS[reaction(kind, moodOn(kind, day).mood.id, offerId)]; }
  // An animal's hearts including any from today's offer.
  function heartsOf(p, kind) {
    var x = find(p, kind);
    if (!x) return 0;
    var o = p.visit.offers[kind];
    return x.hearts + (o ? offerHearts(kind, o, p.visit.day) : 0);
  }
  function totalHearts(p) { return p.animals.reduce(function (sum, x) { return sum + heartsOf(p, x.kind); }, 0); }

  // Moves progress on to `day` without anyone arriving: today's hearts are added to the totals.
  function foldTo(p, day) {
    if (day <= p.visit.day) return p;
    var q = clone(p);
    q.animals.forEach(function (x) {
      var o = q.visit.offers[x.kind];
      if (o) x.hearts += offerHearts(x.kind, o, q.visit.day);
    });
    q.visit = { day: day, offers: {} };
    return q;
  }

  /*
   * Start a new day: fold the last day's hearts in, and let the next animal through the gate if
   * the player has earned one. At most one arrives a day, and only after a visit with an offer
   * since the last one arrived. A day not later than the current one changes nothing, so a
   * clock set back can neither undo nor repeat a day.
   */
  function beginDay(p, day) {
    if (day <= p.visit.day) return p;
    var q = foldTo(p, day), n = q.animals.length;
    if (n < ANIMALS.length && q.visits > q.arrivalVisits) {
      var total = q.animals.reduce(function (s, x) { return s + x.hearts; }, 0);
      if (total >= ARRIVAL_MARKS[n - 1] || q.visits - q.arrivalVisits >= ARRIVAL_WAIT[n - 1]) {
        q.animals.push({ kind: ANIMALS[n].kind, arrived: day, hearts: 0, lastSeen: 0 });
        q.arrivalVisits = q.visits;
      }
    }
    return q;
  }

  /*
   * Offer something to an animal on the current day. Returns the new progress, or the same
   * object unchanged if the offer cannot be made: a different day, an animal not in the
   * paddock, one already visited today, or an offer not on today's list. So a visit is never
   * counted twice.
   */
  function offer(p, day, kind, offerId) {
    if (p.visit.day !== day || !find(p, kind) || p.visit.offers[kind] || offersOn(kind, day).indexOf(offerId) < 0) return p;
    var q = clone(p), x = find(q, kind), mood = moodOn(kind, day).mood;
    if (!Object.keys(q.visit.offers).length && day > q.lastDay) {
      q.streak = q.lastDay === day - 1 ? q.streak + 1 : 1;
      q.best = Math.max(q.best, q.streak);
      q.lastDay = day;
      q.visits++;
    }
    q.visit.offers[kind] = offerId;
    x.lastSeen = day;
    if (mood.loved === offerId) {
      var known = q.known[kind] = q.known[kind] || [];
      if (known.indexOf(mood.id) < 0) known.push(mood.id);
    }
    return q;
  }

  // The streak as it stands on `day`: it lapses once a whole day goes by without a visit.
  function currentStreak(p, day) { return p.lastDay >= day - 1 ? p.streak : 0; }

  // True if the animal should greet the player as someone it has missed.
  function missedYou(p, kind, day) {
    var x = find(p, kind);
    return !!x && !p.visit.offers[kind] && day - (x.lastSeen || x.arrived) > MISSED_AFTER;
  }
  // The greeting from an animal that has missed the player; it alternates by day, so it never
  // reads the same two days running.
  function missedLine(kind, day) { var lines = BY_KIND[kind].missed; return lines[mod(day, lines.length)]; }
  // The animal that came through the gate today, if any (never the first one).
  function newArrival(p) {
    var last = p.animals[p.animals.length - 1];
    return p.animals.length > 1 && last.arrived === p.visit.day ? last.kind : null;
  }
  function everyoneVisited(p) { return p.animals.every(function (x) { return !!p.visit.offers[x.kind]; }); }

  // What happened today: [{ kind, offer, result, hearts }] in order of arrival, visited animals only.
  function dayResults(p) {
    return p.animals.filter(function (x) { return p.visit.offers[x.kind]; }).map(function (x) {
      var o = p.visit.offers[x.kind], r = reaction(x.kind, moodOn(x.kind, p.visit.day).mood.id, o);
      return { kind: x.kind, offer: o, result: r, hearts: HEARTS[r] };
    });
  }

  // "Paddock · day 12 🐖❤️❤️ 🐐❤️ 🐓" and "7 days running", plus the address if there is one.
  function shareText(p, url) {
    var row = dayResults(p).map(function (r) { return BY_KIND[r.kind].emoji + (r.hearts ? new Array(r.hearts + 1).join('❤️') : ''); });
    var out = ['Paddock · day ' + p.visit.day + ' ' + row.join(' ')];
    var streak = currentStreak(p, p.visit.day);
    if (streak >= 2) out.push(streak + ' days running');
    if (url) out.push(url);
    return out.join('\n');
  }

  // ---- reading saved progress

  /*
   * Checks progress read from storage, field by field. Returns { p, bad } where p is complete
   * and valid and bad lists what could not be used (filled in with a default). An object that is
   * not progress at all (wrong version, not an object) gives null.
   */
  function check(d) {
    if (!d || typeof d !== 'object' || d.v !== VERSION) return null;
    var p = newProgress(isInt(d.start) ? d.start : 1), bad = [];
    if (!isInt(d.start)) bad.push('start');
    ['lastDay', 'streak', 'best', 'visits', 'arrivalVisits'].forEach(function (k) {
      if (isInt(d[k]) && d[k] >= 0) p[k] = d[k]; else bad.push(k);
    });
    if (Array.isArray(d.animals)) {
      var seen = {};
      p.animals = [];
      d.animals.forEach(function (x, i) {
        if (!x || !BY_KIND[x.kind] || seen[x.kind]) { bad.push('animals.' + i); return; }
        seen[x.kind] = true;
        var ok = isInt(x.arrived) && isInt(x.hearts) && x.hearts >= 0 && isInt(x.lastSeen) && x.lastSeen >= 0;
        if (!ok) bad.push('animal.' + x.kind);
        p.animals.push({
          kind: x.kind, arrived: isInt(x.arrived) ? x.arrived : p.start,
          hearts: isInt(x.hearts) && x.hearts >= 0 ? x.hearts : 0, lastSeen: isInt(x.lastSeen) && x.lastSeen >= 0 ? x.lastSeen : 0,
        });
      });
      // Animals always come in the same order; keep that order whatever the save says.
      p.animals.sort(function (a, b) { return BY_KIND[a.kind].index - BY_KIND[b.kind].index; });
      if (!p.animals.length) { bad.push('animals'); p.animals = newProgress(p.start).animals; }
    } else {
      bad.push('animals');
    }
    var v = d.visit;
    if (v && isInt(v.day) && v.offers && typeof v.offers === 'object') {
      p.visit.day = v.day;
      Object.keys(v.offers).forEach(function (kind) {
        if (find(p, kind) && BY_KIND[kind].offers[v.offers[kind]]) p.visit.offers[kind] = v.offers[kind];
        else bad.push('visit.' + kind);
      });
    } else {
      bad.push('visit');
      p.visit.day = Math.max(p.start, p.lastDay);
    }
    if (d.known && typeof d.known === 'object') {
      Object.keys(d.known).forEach(function (kind) {
        var a = BY_KIND[kind], list = d.known[kind];
        if (!a || !Array.isArray(list)) { bad.push('known.' + kind); return; }
        p.known[kind] = list.filter(function (id, i) { return a.moods.some(function (m) { return m.id === id; }) && list.indexOf(id) === i; });
      });
    } else {
      bad.push('known');
    }
    return { p: p, bad: bad };
  }

  function parse(raw) {
    if (typeof raw !== 'string' || !raw) return null;
    try { return check(JSON.parse(raw)); } catch (e) { return null; }
  }

  /*
   * The progress to play with, given the main save and the once-a-day backup (raw strings, or
   * null). Returns { p, from } where from is:
   *   'none'      nothing saved yet (p is null)
   *   'main'      the main save, read cleanly
   *   'repaired'  the main save with the fields it could not use taken from the backup
   *   'backup'    the main save was unreadable; this is the backup
   *   'lost'      something was saved but neither copy could be read (p is null)
   * A field broken in the main save is taken from the backup, so one bad field never costs more
   * than that field, and only if the backup has none either.
   */
  function restore(mainRaw, backupRaw) {
    var main = parse(mainRaw), backup = parse(backupRaw);
    if (!main && !backup) return { p: null, from: mainRaw || backupRaw ? 'lost' : 'none' };
    if (!main) return { p: backup.p, from: 'backup' };
    if (!main.bad.length) return { p: main.p, from: 'main' };
    if (!backup) return { p: main.p, from: 'repaired' };
    var p = main.p, b = backup.p;
    main.bad.forEach(function (field) {
      var parts = field.split('.');
      if (parts[0] === 'animal') {
        var mine = find(p, parts[1]), theirs = find(b, parts[1]);
        if (mine && theirs) { mine.arrived = theirs.arrived; mine.hearts = Math.max(mine.hearts, theirs.hearts); mine.lastSeen = Math.max(mine.lastSeen, theirs.lastSeen); }
      } else if (parts.length === 1 && field !== 'visit' && field !== 'known' && field !== 'animals') {
        p[field] = b[field];
      }
    });
    // Whole sections that were lost (and per-item losses) come back by merging the backup in:
    // merging only ever adds what one copy has and the other lacks.
    return { p: merge(p, b), from: 'repaired' };
  }

  /*
   * Two copies of one player's progress made into one, losing nothing from either: another
   * tab's save and this tab's, or a pasted save and the one on this device. Each animal keeps
   * the most hearts either copy has; today's offers are combined (where both copies made an
   * offer to the same animal, `a`'s stands); the streak comes from the copy with the later
   * visit. Merging a copy with itself, or with an older version of itself, changes nothing.
   */
  function merge(a, b) {
    if (!b) return a;
    if (!a) return b;
    var day = Math.max(a.visit.day, b.visit.day);
    var x = foldTo(a, day), y = foldTo(b, day), q = clone(x);
    y.animals.forEach(function (theirs) {
      var mine = find(q, theirs.kind);
      if (!mine) { q.animals.push(clone(theirs)); return; }
      mine.arrived = Math.min(mine.arrived, theirs.arrived);
      mine.hearts = Math.max(mine.hearts, theirs.hearts);
      mine.lastSeen = Math.max(mine.lastSeen, theirs.lastSeen);
    });
    q.animals.sort(function (m, n) { return BY_KIND[m.kind].index - BY_KIND[n.kind].index; });
    Object.keys(y.visit.offers).forEach(function (kind) { if (!q.visit.offers[kind]) q.visit.offers[kind] = y.visit.offers[kind]; });
    q.start = Math.min(x.start, y.start);
    if (y.lastDay > x.lastDay || (y.lastDay === x.lastDay && y.streak > x.streak)) { q.lastDay = y.lastDay; q.streak = y.streak; }
    q.best = Math.max(x.best, y.best, q.streak);
    q.visits = Math.max(x.visits, y.visits);
    q.arrivalVisits = Math.max(x.arrivalVisits, y.arrivalVisits);
    Object.keys(y.known).forEach(function (kind) {
      var list = q.known[kind] = q.known[kind] || [];
      y.known[kind].forEach(function (id) { if (list.indexOf(id) < 0) list.push(id); });
    });
    return q;
  }

  // Two copies are the same progress.
  function same(a, b) { return JSON.stringify(a) === JSON.stringify(b); }

  // A save as text the player can copy to another device, and back. Null if the text is not one.
  function exportSave(p) { return 'PADDOCK1:' + encode(JSON.stringify(p)); }
  function importSave(text) {
    var m = /PADDOCK1:([A-Za-z0-9+/=_-]+)/.exec(String(text || '').replace(/\s+/g, ''));
    if (!m) return null;
    var got = null;
    try { got = check(JSON.parse(decode(m[1]))); } catch (e) { return null; }
    return got ? got.p : null;
  }
  function encode(s) {
    if (typeof btoa === 'function') return btoa(unescape(encodeURIComponent(s)));
    return Buffer.from(s, 'utf8').toString('base64');
  }
  function decode(s) {
    if (typeof atob === 'function') return decodeURIComponent(escape(atob(s)));
    return Buffer.from(s, 'base64').toString('utf8');
  }

  // ---- simulated players, for tuning the pace and for preview mode

  /*
   * Plays `visits` days in a row from calendar day `from`, one visit a day, every animal
   * visited. strategy 'learner' remembers everything: once it has seen what an animal loves in
   * a mood it offers that every time, and it never repeats an offer that was not loved in that
   * mood. 'random' picks any of the three. Returns { p, arrived: { kind: visit number },
   * levels: { kind: [visit number reaching level 1, 2, ...] }, hearts: [total after each visit] }.
   */
  function simulate(strategy, visits, from, seedValue) {
    var rand = rng(seedValue || 1), p = newProgress(from), memory = {}, arrived = {}, levels = {}, hearts = [];
    arrived[ANIMALS[0].kind] = 1;
    for (var i = 0; i < visits; i++) {
      var day = from + i;
      p = beginDay(p, day);
      p.animals.forEach(function (x) {
        if (!arrived[x.kind]) arrived[x.kind] = i + 1;
        var shown = offersOn(x.kind, day), mood = moodOn(x.kind, day).mood, key = x.kind + ':' + mood.id;
        var mem = memory[key] = memory[key] || { loved: null, tried: [] }, choice;
        if (strategy === 'learner' && mem.loved) choice = mem.loved;
        else {
          var fresh = strategy === 'learner' ? shown.filter(function (o) { return mem.tried.indexOf(o) < 0; }) : shown;
          choice = fresh[Math.floor(rand() * fresh.length)];
        }
        if (mood.loved === choice) mem.loved = choice; else mem.tried.push(choice);
        var before = level(heartsOf(p, x.kind));
        p = offer(p, day, x.kind, choice);
        var after = level(heartsOf(p, x.kind));
        for (var l = before + 1; l <= after; l++) (levels[x.kind] = levels[x.kind] || [])[l - 1] = i + 1;
      });
      hearts.push(totalHearts(p));
    }
    return { p: p, arrived: arrived, levels: levels, hearts: hearts };
  }

  // Progress for preview mode: a player on their `stage`-th visit on calendar day `day`, who has
  // come every day before and learns as they go.
  function previewProgress(day, stage) {
    var n = Math.max(1, stage), first = day - n + 1;
    var p = n > 1 ? simulate('learner', n - 1, first, 7).p : newProgress(first);
    return beginDay(p, day);
  }

  var api = {
    ANIMALS: ANIMALS, BY_KIND: BY_KIND, EPOCH: EPOCH, VERSION: VERSION, HEARTS: HEARTS, LEVELS: LEVELS, LEVEL_NAMES: LEVEL_NAMES,
    ARRIVAL_MARKS: ARRIVAL_MARKS, ARRIVAL_WAIT: ARRIVAL_WAIT, MISSED_AFTER: MISSED_AFTER,
    dayNumber: dayNumber, msUntilTomorrow: msUntilTomorrow, timeOfDay: timeOfDay,
    moodOn: moodOn, reaction: reaction, offersOn: offersOn, reactionLine: reactionLine,
    level: level, friendship: friendship,
    newProgress: newProgress, find: find, heartsOf: heartsOf, totalHearts: totalHearts, beginDay: beginDay, offer: offer,
    currentStreak: currentStreak, missedYou: missedYou, missedLine: missedLine, newArrival: newArrival, everyoneVisited: everyoneVisited,
    dayResults: dayResults, shareText: shareText,
    check: check, restore: restore, merge: merge, same: same, exportSave: exportSave, importSave: importSave,
    simulate: simulate, previewProgress: previewProgress,
  };
  root.Paddock = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
