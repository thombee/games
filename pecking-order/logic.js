/*
 * Pecking Order game rules. No DOM in here: app.js draws the page, this file decides each
 * day's question and how a try is graded. Works as a plain <script> in the browser and via
 * require() in Node.
 *
 * The game: one question a day. Five cards in a shuffled column; the player puts them in
 * order and locks in. Cards in the right place lock; three tries in all.
 */
(function (root) {
  'use strict';

  var SIZE = 5, TRIES = 3;
  // Day 1, as a local calendar date.
  var EPOCH = { year: 2026, month: 11, day: 13 };
  // Neighbours in the sorted five differ by at least this factor.
  var GAP = 1.15;
  var AREAS = ['food', 'animals', 'places'];

  // ---- numbers as the cards show them

  // 1234567 -> "1,234,567"
  function group(n) {
    var s = String(Math.round(Math.abs(n))), out = '';
    while (s.length > 3) { out = ',' + s.slice(-3) + out; s = s.slice(0, -3); }
    return (n < 0 ? '-' : '') + s + out;
  }
  // Three significant figures, without trailing zeros: 99.48 -> "99.5", 0.43 -> "0.43", 1574 -> "1,570".
  function sig(x) {
    var r = Number(x.toPrecision(3));
    return r >= 1000 ? group(r) : String(r);
  }
  // One decimal place at most: 22.8 -> "22.8", 27 -> "27".
  function dec1(x) { return String(Math.round(x * 10) / 10); }
  function plural(text, one, many) { return text + ' ' + (text === '1' ? one : many); }

  // How each measure's values are written. Values come in the measure's base unit (see data.js).
  var FORMATS = {
    years: function (v) { return plural(dec1(v), 'year', 'years'); },
    mass: function (g) {
      if (g >= 1e6) return plural(sig(g / 1e6), 'tonne', 'tonnes');
      return g >= 1000 ? sig(g / 1000) + ' kg' : sig(g) + ' g';
    },
    days: function (v) { return plural(group(v), 'day', 'days'); },
    hours: function (v) { return plural(v >= 100 ? group(v) : dec1(v), 'hour', 'hours'); },
    count: function (v) {
      if (v >= 1e9) return sig(v / 1e9) + ' billion';
      return v >= 1e6 ? sig(v / 1e6) + ' million' : group(v);
    },
    grams: function (v) { return dec1(v) + ' g'; },
    kcal: function (v) { return group(v) + ' kcal'; },
    co2: function (v) { return sig(v) + ' kg CO₂e'; },
    m2: function (v) { return sig(v) + ' m²'; },
    litres: function (v) { return (v >= 100 ? group(v) : dec1(v)) + ' litres'; },
    km2: function (v) { return v >= 1e6 ? sig(v / 1e6) + ' million km²' : group(v) + ' km²'; },
    km: function (v) { return group(v) + ' km'; },
  };
  function formatValue(format, v) {
    var f = FORMATS[format];
    if (!f) throw new Error('unknown format ' + format);
    return f(v);
  }

  // ---- seeded randomness, so a day is the same for everyone

  // mulberry32
  function rng(seed) {
    var s = seed >>> 0;
    return function () {
      s = (s + 0x6d2b79f5) | 0;
      var t = Math.imul(s ^ (s >>> 15), 1 | s);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function shuffle(rand, list) {
    var a = list.slice();
    for (var i = a.length - 1; i > 0; i--) {
      var j = Math.floor(rand() * (i + 1)), t = a[i];
      a[i] = a[j];
      a[j] = t;
    }
    return a;
  }

  // ---- which measure a day asks about

  /*
   * The order of areas within one cycle of the rotation, one entry per measure. The areas
   * are listed largest first (food, animals, places on ties) and dealt into the even slots,
   * then the odd ones. So no area comes up twice running, including from the end of one
   * cycle to the start of the next, as long as no area has more than half the measures.
   */
  function areaPattern(measures) {
    var counts = {};
    measures.forEach(function (m) { counts[m.area] = (counts[m.area] || 0) + 1; });
    var areas = Object.keys(counts).sort(function (a, b) { return counts[b] - counts[a] || AREAS.indexOf(a) - AREAS.indexOf(b); });
    var dealt = [];
    areas.forEach(function (a) { for (var i = 0; i < counts[a]; i++) dealt.push(a); });
    var n = dealt.length, slots = [], out = new Array(n);
    for (var e = 0; e < n; e += 2) slots.push(e);
    for (var o = 1; o < n; o += 2) slots.push(o);
    slots.forEach(function (slot, i) { out[slot] = dealt[i]; });
    return out;
  }

  /*
   * The measure for a day and the direction to ask it in. Each cycle of the rotation uses
   * every measure once; within a cycle the measures of an area come in an order shuffled
   * per cycle. A measure is asked largest-first in one cycle and smallest-first in the
   * next, starting with largest-first.
   */
  function measureFor(day, data) {
    var measures = data.measures, pattern = areaPattern(measures), n = pattern.length;
    var cycle = Math.floor((day - 1) / n), at = ((day - 1) % n + n) % n, area = pattern[at];
    var nth = pattern.slice(0, at).filter(function (a) { return a === area; }).length;
    var inArea = measures.filter(function (m) { return m.area === area; });
    var order = cycle === 0 ? inArea : shuffle(rng(Math.imul(cycle + 1, 0x85ebca6b) ^ 0x51ed270b), inArea);
    var index = measures.indexOf(order[nth]);
    return { measure: order[nth], direction: (cycle + index) % 2 === 0 ? 'desc' : 'asc' };
  }

  // ---- the five items

  // True if two candidates can share a day: values far enough apart to be ordered at a
  // glance and written differently, and different emoji so the cards look different.
  function apart(p, c, format) {
    if (p.item.emoji === c.item.emoji) return false;
    var a = p.value, b = c.value, hi = Math.max(a, b), lo = Math.min(a, b);
    if (hi <= 0) return false;
    if (lo > 0 && hi / lo < GAP) return false;
    return formatValue(format, a) !== formatValue(format, b);
  }

  /*
   * Pick `groups` ([{ list, n }]) from the pool: n entries from each list, every pair
   * apart(). Tries a few hundred random orders, then gives up (null).
   */
  function choose(rand, groups, format) {
    for (var attempt = 0; attempt < 400; attempt++) {
      var picked = [], ok = groups.every(function (g) {
        var got = 0;
        shuffle(rand, g.list).forEach(function (c) {
          if (got === g.n) return;
          if (picked.every(function (p) { return apart(p, c, format); })) { picked.push(c); got++; }
        });
        return got === g.n;
      });
      if (ok) return picked;
    }
    return null;
  }

  /*
   * The kinds of mix a measure's five must have, in order of preference: each a list of
   * groups for choose(). Animal measures that include the farm animals marked `farmed`
   * take one or two of them and fill the rest from other animals. Food measures marked
   * `mix` take two or three animal foods and the rest plant foods. Others take any five.
   */
  function plans(rand, measure, pool) {
    var split = function (test, low, high) {
      var yes = pool.filter(test), no = pool.filter(function (c) { return !test(c); });
      var first = rand() < 0.5 ? low : high, second = first === low ? high : low;
      return [first, second].map(function (k) { return [{ list: yes, n: k }, { list: no, n: SIZE - k }]; });
    };
    if (measure.area === 'animals' && pool.some(function (c) { return c.item.farmed; })) {
      return split(function (c) { return !!c.item.farmed; }, 1, 2);
    }
    if (measure.mix) return split(function (c) { return c.item.origin === 'animal'; }, 2, 3);
    return [[{ list: pool, n: SIZE }]];
  }

  /*
   * A starting order: a shuffle of the five that is not already right, not simply the
   * right order upside down, and has at most one card in its right place.
   */
  function startOrder(rand) {
    var ids = [0, 1, 2, 3, 4];
    for (;;) {
      var p = shuffle(rand, ids);
      var inPlace = p.filter(function (v, i) { return v === i; }).length;
      var reversed = p.every(function (v, i) { return v === SIZE - 1 - i; });
      if (inPlace <= 1 && !reversed) return p;
    }
  }

  /*
   * The question for a day: the same day always gives the same question.
   *
   * Returns { day, measure, direction ('desc' | 'asc'), prompt, ends: [top, bottom], items,
   * start }. `items` are the five in the right order, top to bottom, each { id, name,
   * emoji, value, text }. `start` is the order they are first shown in: start[i] is the
   * index into items of the card in place i.
   *
   * Only items marked familiar are used. Two days running always come from different
   * areas, and no item belongs to two areas, so no item appears two days running.
   */
  function dailyPuzzle(day, data) {
    var pickd = measureFor(day, data), m = pickd.measure;
    var rand = rng(Math.imul(day, 2654435761) ^ 0x9e3779b9);
    var pool = m.items.filter(function (p) { return data.items[p[0]].familiar; }).map(function (p) {
      return { id: p[0], value: p[1], item: data.items[p[0]] };
    });
    var five = null;
    plans(rand, m, pool).some(function (groups) { five = choose(rand, groups, m.format); return five; });
    if (!five) throw new Error('no five items fit day ' + day + ' (' + m.id + ')');
    var sign = pickd.direction === 'desc' ? -1 : 1;
    five.sort(function (a, b) { return sign * (a.value - b.value); });
    return {
      day: day,
      measure: { id: m.id, area: m.area, note: m.note, format: m.format, source: m.source },
      direction: pickd.direction,
      prompt: m.prompts[pickd.direction],
      ends: m.ends[pickd.direction],
      items: five.map(function (c) {
        return { id: c.id, name: c.item.name, emoji: c.item.emoji, value: c.value, text: formatValue(m.format, c.value) };
      }),
      start: startOrder(rand),
    };
  }

  // ---- playing: an order is a list of item indices, one per place, top to bottom

  function isPermutation(order) {
    if (!Array.isArray(order) || order.length !== SIZE) return false;
    var seen = {};
    return order.every(function (v) {
      if (!(Number.isInteger(v) && v >= 0 && v < SIZE) || seen[v]) return false;
      seen[v] = true;
      return true;
    });
  }
  // Which places hold the right card.
  function marks(order) { return order.map(function (v, i) { return v === i; }); }
  function inPlace(order) { return order.filter(function (v, i) { return v === i; }).length; }

  // Places that are locked after these tries: those any try had right.
  function lockedAfter(tries) {
    var locked = [false, false, false, false, false];
    tries.forEach(function (t) { t.forEach(function (v, i) { if (v === i) locked[i] = true; }); });
    return locked;
  }

  /*
   * The state of a day's game from its tries: { locked, solved, over, used }. Solved means
   * the last try had all five right; over means solved or out of tries.
   */
  function status(tries) {
    var last = tries[tries.length - 1];
    var solved = !!last && inPlace(last) === SIZE;
    return { locked: lockedAfter(tries), solved: solved, over: solved || tries.length >= TRIES, used: tries.length };
  }

  /*
   * Move the card in place `from` to place `to`. Locked places do not move: the free cards
   * shift around them to make room. Both places must be free; otherwise the order comes
   * back unchanged. Returns a new order.
   */
  function move(order, locked, from, to) {
    if (locked[from] || locked[to] || from === to) return order.slice();
    var free = [], cards = [];
    order.forEach(function (v, i) { if (!locked[i]) { free.push(i); cards.push(v); } });
    var a = free.indexOf(from), b = free.indexOf(to);
    if (a < 0 || b < 0) return order.slice();
    var card = cards.splice(a, 1)[0];
    cards.splice(b, 0, card);
    var out = order.slice();
    free.forEach(function (place, k) { out[place] = cards[k]; });
    return out;
  }
  // The nearest free place above (step -1) or below (step 1) `from`, or -1 if there is none.
  function nextFree(locked, from, step) {
    for (var i = from + step; i >= 0 && i < SIZE; i += step) if (!locked[i]) return i;
    return -1;
  }

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

  // ---- sharing and stats

  // The result as text: a row of squares per try, in place or not, and nothing about the answer.
  function shareText(day, tries, url) {
    var st = status(tries);
    var out = ['Pecking Order #' + day + ' 🐔 ' + (st.solved ? st.used : 'X') + '/' + TRIES];
    tries.forEach(function (t) { out.push(marks(t).map(function (ok) { return ok ? '🟩' : '🟥'; }).join('')); });
    if (url) out.push(url);
    return out.join('\n');
  }

  function emptyStats() {
    return { played: 0, solved: 0, streak: 0, best: 0, lastDay: 0, dist: [0, 0, 0] };
  }

  /*
   * Record a finished day. `triesUsed` is 1 to 3 for a solve, 0 for a day not solved. The
   * streak counts days played in a row, solved or not. A day that is not later than the last
   * one recorded changes nothing, so a clock set back cannot count a day twice.
   */
  function recordResult(stats, day, triesUsed) {
    if (day <= stats.lastDay) return stats;
    var s = { played: stats.played + 1, solved: stats.solved + (triesUsed ? 1 : 0), dist: stats.dist.slice(), lastDay: day };
    s.streak = stats.lastDay === day - 1 ? stats.streak + 1 : 1;
    s.best = Math.max(stats.best, s.streak);
    if (triesUsed) s.dist[triesUsed - 1]++;
    return s;
  }

  var api = {
    SIZE: SIZE, TRIES: TRIES, EPOCH: EPOCH, GAP: GAP,
    formatValue: formatValue, areaPattern: areaPattern, measureFor: measureFor, dailyPuzzle: dailyPuzzle,
    isPermutation: isPermutation, marks: marks, inPlace: inPlace, lockedAfter: lockedAfter, status: status,
    move: move, nextFree: nextFree,
    dayNumber: dayNumber, msUntilTomorrow: msUntilTomorrow,
    shareText: shareText, emptyStats: emptyStats, recordResult: recordResult,
  };
  root.PeckingOrder = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
