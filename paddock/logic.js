/*
 * Paddock rules. No DOM in here: app.js draws the page, this file decides each animal's mood
 * and offers for a day, how an offer goes down, hearts, friendship levels, who arrives when,
 * the streak, the weekly moments, the share text, and how saved progress is checked, repaired
 * and merged. Works as a plain <script> in the browser (after animals.js and moments.js) and
 * via require() in Node.
 *
 * The game: a few animals in a paddock, each in a mood for the day. The player offers each
 * one something; it loves it (two hearts), likes it (one) or not today (none). Hearts build
 * friendship, friendship unlocks cards, and more total friendship brings more animals.
 */
(function (root) {
  'use strict';

  var ANIMALS = root.PADDOCK_ANIMALS || (typeof require === 'function' ? require('./animals.js') : null);
  var MOMENTS = root.PADDOCK_MOMENTS || (typeof require === 'function' ? require('./moments.js') : null);
  // Lookups with no inherited keys, so a save naming "toString" or "__proto__" finds nothing.
  var BY_KIND = Object.create(null), MOMENT_BY_ID = Object.create(null);
  ANIMALS.forEach(function (a, i) { a.index = i; BY_KIND[a.kind] = a; });
  MOMENTS.forEach(function (m) { MOMENT_BY_ID[m.id] = m; });

  // Day 1, as a local calendar date.
  var EPOCH = { year: 2026, month: 11, day: 13 };
  var VERSION = 2;

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
  // The last calendar day a save may name: a hundred years after day 1.
  var MAX_DAY = 36525;
  // A pasted save longer than this many characters is refused before it is decoded.
  var MAX_PASTE = 400000;

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
  function has(o, k) { return Object.prototype.hasOwnProperty.call(o, k); }
  function isObj(o) { return !!o && typeof o === 'object' && !Array.isArray(o); }
  function isDay(n) { return isInt(n) && n >= 1 && n <= MAX_DAY; }
  function clone(o) { return JSON.parse(JSON.stringify(o)); }

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

  // The hearts from one offer on one day.
  function offerHearts(kind, offerId, day) { return HEARTS[reaction(kind, moodOn(kind, day).mood.id, offerId)]; }

  // ---- moments: about once a week, the same day for everyone

  // A fixed order of the moments, gone through one a week and then from the top again, so a
  // moment comes round once every MOMENTS.length weeks.
  var MOMENT_ORDER = shuffle(rng(seed(11, 13, 4)), MOMENTS.map(function (m, i) { return i; }));
  // The moment on a calendar day, or null. Each week from day 1 has one, on a day of that week
  // picked by the calendar.
  function momentOn(day) {
    if (!isInt(day) || day < 1) return null;
    var week = Math.floor((day - 1) / 7);
    if (mod(day - 1, 7) !== Math.floor(rng(seed(week, 7, 3))() * 7)) return null;
    return MOMENTS[MOMENT_ORDER[mod(week, MOMENTS.length)]];
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

  // ---- the player's save: a record of visits

  /*
   * A save, all plain JSON:
   *   v         format version (2)
   *   start     the calendar day the player started; the first animal arrives that day
   *   log       { day: { kind: [offerId, hearts] } }: every offer made, by calendar day and animal
   *   moments   { day: momentId }: the moments the player has seen, by the day they played
   * Nothing else is kept. Hearts, levels, cards, arrivals, the number of visits, the streak and
   * what each animal is known to love are all worked out from the log, so two copies merge by
   * putting their records together.
   */
  function newSave(day) { return { v: VERSION, start: day, log: {}, moments: {} }; }

  function find(s, kind) { return s.animals.filter(function (x) { return x.kind === kind; })[0] || null; }

  /*
   * Replaying the log. A walker holds what the records so far add up to; days are fed to it in
   * order. After each day with a visit it checks whether the next animal has earned its place,
   * and if so that animal arrives the next calendar day, so at most one arrives a day and only
   * after a visit since the last one came.
   */
  function walker(start) {
    return {
      start: start, animals: [{ kind: ANIMALS[0].kind, arrived: start, hearts: 0, lastSeen: 0 }],
      visits: 0, arrivalVisits: 0, lastDay: 0, streak: 0, best: 0, known: {},
    };
  }
  function presentOn(w, kind, day) { var x = find(w, kind); return !!x && x.arrived <= day; }
  // Takes in one day's records, already checked: [[kind, offerId, hearts]].
  function applyDay(w, day, recs) {
    if (!recs.length) return;
    w.streak = w.lastDay === day - 1 ? w.streak + 1 : 1;
    w.best = Math.max(w.best, w.streak);
    w.lastDay = day;
    w.visits++;
    recs.forEach(function (r) {
      var x = find(w, r[0]), mood = moodOn(r[0], day).mood;
      x.hearts += r[2];
      x.lastSeen = day;
      if (mood.loved === r[1]) {
        var known = w.known[r[0]] = w.known[r[0]] || [];
        if (known.indexOf(mood.id) < 0) known.push(mood.id);
      }
    });
    var n = w.animals.length;
    if (n < ANIMALS.length) {
      var total = w.animals.reduce(function (s, x) { return s + x.hearts; }, 0);
      if (total >= ARRIVAL_MARKS[n - 1] || w.visits - w.arrivalVisits >= ARRIVAL_WAIT[n - 1]) {
        w.animals.push({ kind: ANIMALS[n].kind, arrived: day + 1, hearts: 0, lastSeen: 0 });
        w.arrivalVisits = w.visits;
      }
    }
  }
  // True if `rec` is a record the game could have made for `kind` on `day`, given the walker
  // has taken in every day before it: an animal in the paddock that day, an offer that was on
  // show for it that day, and the hearts that offer earned.
  function recordOk(w, day, kind, rec) {
    return Array.isArray(rec) && rec.length === 2 && typeof rec[0] === 'string' && isInt(rec[1]) &&
      kind in BY_KIND && presentOn(w, kind, day) && has(BY_KIND[kind].offers, rec[0]) &&
      offersOn(kind, day).indexOf(rec[0]) >= 0 && rec[1] === offerHearts(kind, rec[0], day);
  }

  /*
   * Replays one or more logs together, up to and including day `upTo`, keeping only records
   * that check out. Where the logs hold different records for the same day and animal, the one
   * with more hearts is kept (the first, on a tie). Returns { w, log, problems }: the walker at
   * the end, the log of kept records in a fixed order, and a note of each record or day that
   * could not be used.
   */
  function walk(start, logs, upTo) {
    var problems = [], cands = Object.create(null);
    logs.forEach(function (log) {
      if (!isObj(log)) { problems.push('log'); return; }
      Object.keys(log).forEach(function (key) {
        var d = Number(key), entry = log[key];
        if (!isDay(d) || String(d) !== key || !isObj(entry)) { problems.push('day ' + key); return; }
        if (d > upTo) return;
        var byKind = cands[d] = cands[d] || Object.create(null);
        Object.keys(entry).forEach(function (kind) {
          if (!(kind in BY_KIND)) { problems.push('day ' + d + ' ' + kind); return; }
          (byKind[kind] = byKind[kind] || []).push(entry[kind]);
        });
      });
    });
    var w = walker(start), out = {};
    Object.keys(cands).map(Number).sort(function (a, b) { return a - b; }).forEach(function (d) {
      var recs = [], day = {};
      ANIMALS.forEach(function (a) {
        var list = cands[d][a.kind];
        if (!list) return;
        var best = null;
        list.forEach(function (rec) {
          if (!recordOk(w, d, a.kind, rec)) problems.push('day ' + d + ' ' + a.kind);
          else if (!best || rec[1] > best[1]) best = rec;
        });
        if (!best) return;
        day[a.kind] = [best[0], best[1]];
        recs.push([a.kind, best[0], best[1]]);
      });
      if (recs.length) out[d] = day;
      applyDay(w, d, recs);
    });
    return { w: w, log: out, problems: problems };
  }

  /*
   * Everything about the player on calendar day `day`, worked out from the save. Records dated
   * after `day` are kept in the save but count for nothing until their day comes. Returns
   *   day, start
   *   animals   [{ kind, arrived, hearts, lastSeen }] in order of arrival, those here by `day`
   *   offers    { kind: offerId }: what was offered on `day`
   *   visits    days with an offer; streak: days running with an offer, as it stands on `day`;
   *   best      the longest streak; lastDay: the last day with an offer
   *   known     { kind: [moodId] }: moods in which the player has seen what the animal loves
   *   seen      [{ day, moment }]: moments seen up to `day`
   */
  function state(save, day) {
    var start = Math.min(save.start, day), r = walk(start, [save.log], day), w = r.w, offers = {}, today = r.log[day] || {};
    Object.keys(today).forEach(function (kind) { offers[kind] = today[kind][0]; });
    var seen = Object.keys(save.moments).map(Number).filter(function (d) { return d <= day; }).sort(function (a, b) { return a - b; })
      .map(function (d) { return { day: d, moment: MOMENT_BY_ID[save.moments[d]] }; });
    return {
      day: day, start: start, animals: w.animals.filter(function (x) { return x.arrived <= day; }), offers: offers,
      visits: w.visits, streak: w.lastDay >= day - 1 ? w.streak : 0, best: w.best, lastDay: w.lastDay, known: w.known, seen: seen,
    };
  }

  function heartsOf(s, kind) { var x = find(s, kind); return x ? x.hearts : 0; }
  function totalHearts(s) { return s.animals.reduce(function (sum, x) { return sum + x.hearts; }, 0); }

  // A day's entry in the log with its animals in order of arrival, so equal saves are equal as text.
  function ordered(entry) {
    var out = {};
    ANIMALS.forEach(function (a) { if (has(entry, a.kind)) out[a.kind] = entry[a.kind]; });
    return out;
  }

  /*
   * Offer something to an animal on calendar day `day`. Returns the new save, or the same object
   * unchanged if the offer cannot be made: an animal not in the paddock that day, one already
   * visited that day, or an offer not on that day's list. So a visit is never counted twice. A
   * day before the save's start moves the start back to it, so the paddock is never empty.
   */
  function offer(save, day, kind, offerId) {
    if (!isDay(day) || !(kind in BY_KIND)) return save;
    var s = state(save, day);
    if (!find(s, kind) || has(s.offers, kind) || offersOn(kind, day).indexOf(offerId) < 0) return save;
    var q = clone(save), entry = q.log[day] || {};
    q.start = Math.min(q.start, day);
    entry[kind] = [offerId, offerHearts(kind, offerId, day)];
    q.log[day] = ordered(entry);
    return q;
  }

  // The moment that plays on the state's day, if both its animals are here and it has not been
  // seen that day already; else null.
  function momentFor(s) {
    var m = momentOn(s.day);
    if (!m || !m.kinds.every(function (k) { return !!find(s, k); })) return null;
    return s.seen.some(function (x) { return x.day === s.day; }) ? null : m;
  }
  // The save with a moment marked as seen on `day`.
  function seeMoment(save, day, id) {
    var q = clone(save);
    q.moments[day] = id;
    q.moments = sortedDays(q.moments);
    return q;
  }
  function sortedDays(o) {
    var out = {};
    Object.keys(o).map(Number).sort(function (a, b) { return a - b; }).forEach(function (d) { out[d] = o[d]; });
    return out;
  }

  // True if the animal should greet the player as someone it has missed: visited before, but
  // not today and not for more than MISSED_AFTER days.
  function missedYou(s, kind) {
    var x = find(s, kind);
    return !!x && x.lastSeen > 0 && !s.offers[kind] && s.day - x.lastSeen > MISSED_AFTER;
  }
  // The greeting from an animal that has missed the player; it alternates by day, so it never
  // reads the same two days running.
  function missedLine(kind, day) { var lines = BY_KIND[kind].missed; return lines[mod(day, lines.length)]; }
  // The newest animal, if it has come through the gate and not been visited yet (never the first one).
  function newArrival(s) {
    var last = s.animals[s.animals.length - 1];
    return s.animals.length > 1 && !last.lastSeen && !s.offers[last.kind] ? last.kind : null;
  }
  function everyoneVisited(s) { return s.animals.every(function (x) { return !!s.offers[x.kind]; }); }

  // What happened on the state's day: [{ kind, offer, result, hearts }] in order of arrival, visited animals only.
  function dayResults(s) {
    return s.animals.filter(function (x) { return s.offers[x.kind]; }).map(function (x) {
      var o = s.offers[x.kind], r = reaction(x.kind, moodOn(x.kind, s.day).mood.id, o);
      return { kind: x.kind, offer: o, result: r, hearts: HEARTS[r] };
    });
  }

  // "Paddock · day 12 🐖❤️❤️ 🐐❤️ 🐓" and "7 days running", plus the address if there is one.
  function shareText(s, url) {
    var row = dayResults(s).map(function (r) { return BY_KIND[r.kind].emoji + (r.hearts ? new Array(r.hearts + 1).join('❤️') : ''); });
    var out = ['Paddock · day ' + s.day + ' ' + row.join(' ')];
    if (s.streak >= 2) out.push(s.streak + ' days running');
    if (url) out.push(url);
    return out.join('\n');
  }

  // ---- checking a save as a whole

  /*
   * Checks something read from storage or pasted in. Returns null if it is not a save at all,
   * else { save, problems } where save holds every record that checks out and problems lists
   * what did not. A save from the first format (v1, running totals) is converted to records.
   */
  function check(d, today) {
    if (!isObj(d)) return null;
    if (d.v === 1) return fromV1(d, today);
    if (d.v !== VERSION) return null;
    var problems = [], logs = isObj(d.log) ? [d.log] : [];
    if (!logs.length) problems.push('log');
    var days = logs.length ? Object.keys(d.log).map(Number).filter(isDay) : [];
    var first = days.length ? days.reduce(function (a, b) { return Math.min(a, b); }) : null, start = d.start;
    if (!isDay(start)) { problems.push('start'); start = first || (isDay(today) ? today : 1); }
    else if (first !== null && first < start) { problems.push('start'); start = first; }
    var r = walk(start, logs, MAX_DAY);
    return { save: { v: VERSION, start: start, log: r.log, moments: checkMoments(d.moments, r.w, start, problems) }, problems: problems.concat(r.problems) };
  }
  // The moments in a save that could have played: a known moment, on a day in range, with
  // both its animals in the paddock by then.
  function checkMoments(m, w, start, problems) {
    var out = {};
    if (!isObj(m)) { problems.push('moments'); return out; }
    Object.keys(m).forEach(function (key) {
      var d = Number(key), id = m[key], mo = typeof id === 'string' && id in MOMENT_BY_ID ? MOMENT_BY_ID[id] : null;
      var ok = isDay(d) && String(d) === key && d >= start && mo && mo.kinds.every(function (k) { return presentOn(w, k, d); });
      if (ok) out[d] = id; else problems.push('moment ' + key);
    });
    return sortedDays(out);
  }

  /*
   * A save in the first format, which kept running totals (hearts per animal, visits, streak)
   * and only the current day's offers, turned into records. Days before the current one were
   * not kept, so the conversion lays out the right number of visit days ending on the last
   * one (the streak's run last, the best streak's run before it when it differs, the rest
   * single days), and shares each animal's hearts out over those days as loved, liked or
   * not-today offers that were really on show then. The current day's offers become records
   * as they are, unless that day is still to come on `today`'s clock; then their hearts join
   * the rest. Anything that cannot be fitted (more hearts than the days allow, an animal the
   * visits could not have brought, a broken field) is listed in problems.
   */
  function fromV1(d, today) {
    var problems = [];
    var num = function (k, min) { if (isInt(d[k]) && d[k] >= min && d[k] <= MAX_DAY) return d[k]; problems.push(k); return null; };
    var start = num('start', 1), lastDay = num('lastDay', 0), streak = num('streak', 0), best = num('best', 0), visits = num('visits', 0);
    var hearts = Object.create(null), kinds = [];
    if (Array.isArray(d.animals)) {
      d.animals.forEach(function (x, i) {
        if (!isObj(x) || typeof x.kind !== 'string' || !(x.kind in BY_KIND) || x.kind in hearts || !isInt(x.hearts) || x.hearts < 0) { problems.push('animals.' + i); return; }
        hearts[x.kind] = x.hearts;
        kinds.push(x.kind);
      });
    } else problems.push('animals');
    // Animals always arrive in the same order, so the list must be the first few of them.
    kinds.sort(function (a, b) { return BY_KIND[a].index - BY_KIND[b].index; });
    if (kinds.some(function (k, i) { return k !== ANIMALS[i].kind; })) problems.push('animals');
    var v = d.visit, vday = null, todays = [];
    if (isObj(v) && isDay(v.day) && isObj(v.offers)) {
      vday = v.day;
      Object.keys(v.offers).forEach(function (kind) {
        var o = v.offers[kind];
        if (kind in hearts && typeof o === 'string' && has(BY_KIND[kind].offers, o) && offersOn(kind, vday).indexOf(o) >= 0) todays.push([kind, o, offerHearts(kind, o, vday)]);
        else problems.push('visit.' + kind);
      });
    } else problems.push('visit');

    var now = isDay(today) ? today : vday || lastDay || start || 1;
    if (start === null) start = Math.min(now, vday || now);
    if (visits === null) visits = 0;
    if (streak === null) streak = Math.min(1, visits);
    if (best === null) best = streak;
    if (lastDay === null) lastDay = vday || now;
    var real = todays.length > 0 && vday <= now;
    if (!real) todays.forEach(function (r) { hearts[r[0]] += r[2]; });
    var histVisits = Math.max(0, visits - (real ? 1 : 0)), histStreak = Math.min(histVisits, Math.max(0, streak - (real ? 1 : 0)));
    var end = real ? (histStreak ? vday - 1 : vday - 2) : Math.min(lastDay || now, now);

    // The visit days before the current one, latest first: runs of days in a row, a day apart.
    var runs = [], left = histVisits;
    if (left) { runs.push(Math.max(1, histStreak)); left -= runs[0]; }
    if (left && best > runs[0]) { runs.push(Math.min(best, left)); left -= runs[1]; }
    for (; left > 0; left--) runs.push(1);
    // A day apart between runs where the calendar has room, the streak's gap first, then the
    // best streak's; where it has none, runs meet. A start still to come on today's clock was
    // set by a clock running ahead, so it moves back to fit.
    if (start > now) start = Math.max(1, Math.min(now, end - histVisits + 1));
    var spare = end - start + 1 - histVisits, days = [], dd = end;
    if (histVisits && spare < 0) { problems.push('visits'); spare = 0; }
    runs.forEach(function (n, i) {
      if (i && spare > 0) { dd--; spare--; }
      for (var j = 0; j < n; j++) days.push(dd--);
    });
    days = days.reverse().filter(function (x) { return x >= start; });

    var w = walker(start), log = {};
    days.forEach(function (day) {
      var recs = [];
      var pick = function (kind, want) {
        return offersOn(kind, day).filter(function (o) { return offerHearts(kind, o, day) === want; })[0];
      };
      w.animals.forEach(function (x) {
        if (x.arrived > day) return;
        var want = Math.min(2, hearts[x.kind] || 0), o = want ? pick(x.kind, want) : pick(x.kind, 0);
        if (!o && want === 1) o = pick(x.kind, (want = 0));
        if (!o) return;
        recs.push([x.kind, o, want]);
        hearts[x.kind] -= want;
      });
      // A visit day needs an offer: if nobody could take one, the first animal gets the smallest there is.
      if (!recs.length) {
        var k = w.animals[0].kind, o1 = pick(k, 1);
        recs.push(o1 ? [k, o1, 1] : [k, moodOn(k, day).mood.loved, 2]);
      }
      var entry = {};
      recs.forEach(function (r) { entry[r[0]] = [r[1], r[2]]; });
      log[day] = entry;
      applyDay(w, day, recs);
    });
    if (real) {
      var entry = {}, recs = [];
      todays.forEach(function (r) {
        if (recordOk(w, vday, r[0], [r[1], r[2]])) { entry[r[0]] = [r[1], r[2]]; recs.push(r); } else problems.push('visit.' + r[0]);
      });
      if (recs.length) { log[vday] = ordered(entry); applyDay(w, vday, recs); }
    }
    kinds.forEach(function (k) {
      if (hearts[k] > 0) problems.push('hearts.' + k);
      if (!presentOn(w, k, Math.max(now, vday || 0))) problems.push('arrived.' + k);
    });
    return { save: { v: VERSION, start: start, log: log, moments: {} }, problems: problems, converted: true };
  }

  function parse(raw, today) {
    if (typeof raw !== 'string' || !raw) return null;
    try { return check(JSON.parse(raw), today); } catch (e) { return null; }
  }

  /*
   * The save to play with, given the main save and the once-a-day backup (raw strings, or
   * null) and today's calendar day. Returns { p, from, converted } where from is:
   *   'none'      nothing saved yet (p is null)
   *   'main'      the main save, every record in order
   *   'repaired'  the main save had records that could not be used: they are dropped, and the
   *               backup's records are put back in with the rest
   *   'backup'    the main save was unreadable; this is the backup
   *   'lost'      something was saved but neither copy could be read (p is null)
   * converted is true when the save was in the first format and has been turned into records.
   */
  function restore(mainRaw, backupRaw, today) {
    var main = parse(mainRaw, today), backup = parse(backupRaw, today);
    var converted = !!((main && main.converted) || (!main && backup && backup.converted));
    if (!main && !backup) return { p: null, from: mainRaw || backupRaw ? 'lost' : 'none', converted: false };
    if (!main) return { p: backup.save, from: 'backup', converted: converted };
    if (!main.problems.length) return { p: main.save, from: 'main', converted: converted };
    return { p: backup ? merge(main.save, backup.save) : main.save, from: 'repaired', converted: converted };
  }

  /*
   * Two copies of one player's save made into one, losing nothing from either: another tab's
   * save and this tab's, or a pasted save and the one on this device. The records are put
   * together; where both have a record for the same day and animal, the one with more hearts
   * stands (`a`'s, on a tie). Merging a copy with itself, or with an older copy of itself,
   * changes nothing.
   */
  function merge(a, b) {
    if (!b) return a;
    if (!a) return b;
    var start = Math.min(a.start, b.start), r = walk(start, [a.log, b.log], MAX_DAY), moments = clone(a.moments);
    Object.keys(b.moments).forEach(function (d) { if (!has(moments, d)) moments[d] = b.moments[d]; });
    return { v: VERSION, start: start, log: r.log, moments: sortedDays(moments) };
  }

  // Two copies are the same save.
  function same(a, b) { return JSON.stringify(a) === JSON.stringify(b); }

  // A save as text the player can copy to another device.
  function exportSave(save) { return 'PADDOCK2:' + encode(JSON.stringify(save)); }
  /*
   * A pasted save. Returns { save } or { error } where error is 'too-long' (refused before it is
   * decoded), 'not-a-save', or 'problems' (it decodes, but something in it could not have
   * happened; it is refused whole). A save copied from the first format (PADDOCK1:) is
   * converted, and refused if it does not convert cleanly.
   */
  function importSave(text, today) {
    var t = typeof text === 'string' ? text : '';
    if (t.length > MAX_PASTE) return { error: 'too-long' };
    var m = /PADDOCK[12]:([A-Za-z0-9+/=_-]+)/.exec(t.replace(/\s+/g, ''));
    if (!m) return { error: 'not-a-save' };
    var got = null;
    try { got = check(JSON.parse(decode(m[1])), today); } catch (e) { return { error: 'not-a-save' }; }
    if (!got) return { error: 'not-a-save' };
    if (got.problems.length) return { error: 'problems', problems: got.problems };
    return { save: got.save };
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
   * mood. 'random' picks any of the three. Returns { p: the save, arrived: { kind: visit
   * number }, levels: { kind: [visit number reaching level 1, 2, ...] }, hearts: [total after
   * each visit] }.
   */
  function simulate(strategy, visits, from, seedValue) {
    var rand = rng(seedValue || 1), w = walker(from), log = {}, memory = {}, arrived = {}, levels = {}, hearts = [];
    for (var i = 0; i < visits; i++) {
      var day = from + i, recs = [], entry = {};
      w.animals.forEach(function (x) {
        if (x.arrived > day) return;
        if (!arrived[x.kind]) arrived[x.kind] = i + 1;
        var shown = offersOn(x.kind, day), mood = moodOn(x.kind, day).mood, key = x.kind + ':' + mood.id;
        var mem = memory[key] = memory[key] || { loved: null, tried: [] }, choice;
        if (strategy === 'learner' && mem.loved) choice = mem.loved;
        else {
          var fresh = strategy === 'learner' ? shown.filter(function (o) { return mem.tried.indexOf(o) < 0; }) : shown;
          choice = fresh[Math.floor(rand() * fresh.length)];
        }
        if (mood.loved === choice) mem.loved = choice; else mem.tried.push(choice);
        var h = offerHearts(x.kind, choice, day), before = level(x.hearts), after = level(x.hearts + h);
        for (var l = before + 1; l <= after; l++) (levels[x.kind] = levels[x.kind] || [])[l - 1] = i + 1;
        recs.push([x.kind, choice, h]);
        entry[x.kind] = [choice, h];
      });
      log[day] = entry;
      applyDay(w, day, recs);
      hearts.push(w.animals.reduce(function (s, x) { return s + x.hearts; }, 0));
    }
    return { p: { v: VERSION, start: from, log: log, moments: {} }, arrived: arrived, levels: levels, hearts: hearts };
  }

  // A save for preview mode: a player on their `stage`-th visit on calendar day `day`, who has
  // come every day before (from day 1 at the earliest) and learns as they go.
  function previewProgress(day, stage) {
    var n = Math.min(Math.max(1, stage), day), first = day - n + 1;
    return n > 1 ? simulate('learner', n - 1, first, 7).p : newSave(first);
  }

  var api = {
    ANIMALS: ANIMALS, BY_KIND: BY_KIND, MOMENTS: MOMENTS, MOMENT_BY_ID: MOMENT_BY_ID, EPOCH: EPOCH, VERSION: VERSION, HEARTS: HEARTS,
    LEVELS: LEVELS, LEVEL_NAMES: LEVEL_NAMES, ARRIVAL_MARKS: ARRIVAL_MARKS, ARRIVAL_WAIT: ARRIVAL_WAIT, MISSED_AFTER: MISSED_AFTER,
    MAX_DAY: MAX_DAY, MAX_PASTE: MAX_PASTE,
    dayNumber: dayNumber, msUntilTomorrow: msUntilTomorrow, timeOfDay: timeOfDay,
    moodOn: moodOn, reaction: reaction, offersOn: offersOn, reactionLine: reactionLine, offerHearts: offerHearts,
    momentOn: momentOn, momentFor: momentFor, seeMoment: seeMoment,
    level: level, friendship: friendship,
    newSave: newSave, state: state, find: find, heartsOf: heartsOf, totalHearts: totalHearts, offer: offer,
    missedYou: missedYou, missedLine: missedLine, newArrival: newArrival, everyoneVisited: everyoneVisited,
    dayResults: dayResults, shareText: shareText,
    check: check, restore: restore, merge: merge, same: same, exportSave: exportSave, importSave: importSave,
    simulate: simulate, previewProgress: previewProgress,
  };
  root.Paddock = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
