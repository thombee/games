/*
 * Tall Tales game rules. No DOM in here: app.js draws the page, this file decides which cards
 * a day has, what makes a good day, and how a day is scored. Works as a plain <script> in the
 * browser and via require() in Node.
 *
 * The game: seven cards a day. Each makes a claim about the natural world, and the player
 * says whether it is true or a tall tale.
 */
(function (root) {
  'use strict';

  var ROUNDS = 7;
  // Day 1, as a local calendar date.
  var EPOCH = { year: 2026, month: 11, day: 13 };
  // A claim fits in one sentence of about this many characters, an explanation in this many.
  var MAX_CLAIM = 110, MAX_EXPLAIN = 200;
  // How many of a day's seven cards are true: [at least, at most].
  var TRUE_PER_DAY = [3, 4];

  /*
   * The kinds of card. `target` is the rough share of the bank, `perDay` how many one day may
   * have: [at least, at most].
   */
  var KINDS = {
    animals: { label: 'Animals', target: 0.40, perDay: [2, 4] },
    plants: { label: 'Plants, fungi & food', target: 0.20, perDay: [0, 2] },
    earth: { label: 'Body, Earth & space', target: 0.25, perDay: [0, 3] },
    australia: { label: 'Australia', target: 0.15, perDay: [0, 2] },
  };

  // ---- a day's cards

  /*
   * The cards for a day, in playing order. `days` is the fixed schedule from cards.js, a list
   * of days each holding seven card ids; after the last day the list starts again.
   */
  var byIdCache = null, byIdFor = null;
  function dailyCards(day, cards, days) {
    if (byIdFor !== cards) {
      byIdCache = {};
      cards.forEach(function (c) { byIdCache[c.id] = c; });
      byIdFor = cards;
    }
    var n = days.length, ids = days[(((day - 1) % n) + n) % n];
    return ids.map(function (id) {
      if (!byIdCache[id]) throw new Error('no card ' + id);
      return byIdCache[id];
    });
  }

  /*
   * Puts a day's cards in playing order: an easy card first, then the rest from easier to
   * harder, so the day never opens with its hardest card. `rand` breaks ties.
   */
  function orderDay(cards, rand) {
    var keyed = cards.map(function (c) { return { c: c, k: rand() }; });
    keyed.sort(function (a, b) { return a.c.level - b.c.level || a.k - b.k; });
    return keyed.map(function (x) { return x.c; });
  }

  // What, if anything, is wrong with a day's cards in their playing order: a list of reasons.
  function dayProblems(cards) {
    var out = [];
    if (cards.length !== ROUNDS) out.push(cards.length + ' cards, not ' + ROUNDS);
    var trues = cards.filter(function (c) { return c.answer === true; }).length;
    if (trues < TRUE_PER_DAY[0] || trues > TRUE_PER_DAY[1]) out.push(trues + ' true cards');
    var kinds = {};
    cards.forEach(function (c) { kinds[c.kind] = (kinds[c.kind] || 0) + 1; });
    Object.keys(KINDS).forEach(function (k) {
      var n = kinds[k] || 0, range = KINDS[k].perDay;
      if (n < range[0] || n > range[1]) out.push(n + ' ' + k + ' cards');
    });
    var others = Object.keys(kinds).filter(function (k) { return k !== 'animals'; }).length;
    if (others < 2) out.push('only ' + others + ' kind(s) besides animals');
    var subjects = {};
    cards.forEach(function (c) {
      c.subjects.forEach(function (s) {
        if (subjects[s]) out.push('two cards about ' + s);
        subjects[s] = true;
      });
    });
    if (cards.length && cards[0].level !== 1) out.push('opens with a level ' + cards[0].level + ' card');
    for (var i = 1; i < cards.length; i++) {
      if (cards[i].level < cards[i - 1].level) { out.push('not ordered from easier to harder'); break; }
    }
    if (!cards.some(function (c) { return c.level === 3; })) out.push('no hard card');
    return out;
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

  // ---- scoring, sharing and stats

  // picks is what the player said for each card played so far: true for True, false for Tall tale.
  function isRight(card, pick) { return !!card && pick === card.answer; }
  function score(cards, picks) {
    return picks.filter(function (p, i) { return isRight(cards[i], p); }).length;
  }

  var TITLES = [[7, 'Myth buster'], [6, 'Sharp eye'], [5, 'Hard to fool'], [3, 'Not bad at all'], [0, 'The tall tales won today']];
  function title(points) {
    for (var i = 0; i < TITLES.length; i++) if (points >= TITLES[i][0]) return TITLES[i][1];
    return TITLES[TITLES.length - 1][1];
  }

  /*
   * Of the cards the player got wrong, the one most people would find surprising: the
   * hardest, and of those the latest. null if every answer so far is right.
   */
  function surprise(cards, picks) {
    var best = null;
    picks.forEach(function (p, i) {
      if (isRight(cards[i], p)) return;
      if (!best || cards[i].level >= best.level) best = cards[i];
    });
    return best;
  }

  // The result as text: a square per card, right or wrong, and nothing about the claims.
  function shareText(day, cards, picks, url) {
    var squares = cards.map(function (c, i) { return isRight(c, picks[i]) ? '🟩' : '🟥'; }).join('');
    var out = ['Tall Tales #' + day + ' 🃏 ' + score(cards, picks) + '/' + cards.length, squares];
    if (url) out.push(url);
    return out.join('\n');
  }

  function emptyStats() {
    var dist = [];
    for (var i = 0; i <= ROUNDS; i++) dist.push(0);
    return { played: 0, total: 0, streak: 0, best: 0, lastDay: 0, dist: dist };
  }

  /*
   * Record a finished day. `total` is the sum of all scores, for the average. The streak
   * counts days played in a row. A day that is not later than the last one recorded
   * changes nothing, so a clock set back cannot count a day twice.
   */
  function recordResult(stats, day, points) {
    if (day <= stats.lastDay) return stats;
    var s = { played: stats.played + 1, total: stats.total + points, dist: stats.dist.slice(), lastDay: day };
    s.streak = stats.lastDay === day - 1 ? stats.streak + 1 : 1;
    s.best = Math.max(stats.best, s.streak);
    s.dist[points]++;
    return s;
  }

  var api = {
    ROUNDS: ROUNDS, EPOCH: EPOCH, MAX_CLAIM: MAX_CLAIM, MAX_EXPLAIN: MAX_EXPLAIN, TRUE_PER_DAY: TRUE_PER_DAY, KINDS: KINDS,
    dailyCards: dailyCards, orderDay: orderDay, dayProblems: dayProblems,
    dayNumber: dayNumber, msUntilTomorrow: msUntilTomorrow,
    isRight: isRight, score: score, title: title, surprise: surprise, shareText: shareText,
    emptyStats: emptyStats, recordResult: recordResult,
  };
  root.TallTales = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
