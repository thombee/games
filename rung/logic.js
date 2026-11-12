/*
 * Rung game rules. No DOM in here: app.js draws the page, this file holds the word lists,
 * the day's pair, the checks on an entry, the warmer/cooler marks, hints, share text and
 * stats. Works as a plain <script> in the browser and via require() in Node.
 *
 * The game: a ladder from a start word to an end word. Each rung changes one letter of the
 * word above it. Words are kept in lower case and shown in capitals.
 */
(function (root) {
  'use strict';

  // Day 1, as a local calendar date (Friday 13 November 2026).
  var EPOCH = { year: 2026, month: 11, day: 13 };
  var ALPHABET = 'abcdefghijklmnopqrstuvwxyz';

  // ---- packing word lists small

  /*
   * A sorted list of same-length words as one string. Each word is written as a digit, the
   * number of letters it shares with the start of the word before, then the rest of its
   * letters: ["abet", "able", "ably"] packs to "0abet2le3y".
   */
  function pack(words) {
    var out = '', prev = '';
    words.forEach(function (w) {
      var k = 0;
      while (k < w.length - 1 && w[k] === prev[k]) k++;
      out += k + w.slice(k);
      prev = w;
    });
    return out;
  }
  function unpack(text, length) {
    var out = [], prev = '', i = 0;
    while (i < text.length) {
      var k = text.charCodeAt(i) - 48, rest = length - k;
      prev = prev.slice(0, k) + text.slice(i + 1, i + 1 + rest);
      out.push(prev);
      i += 1 + rest;
    }
    return out;
  }

  // ---- word graphs: two words are joined when they differ in exactly one letter

  /*
   * A graph over a list of same-length words. Words that differ in one letter share a
   * bucket: "seed" is in the buckets "_eed", "s_ed", "se_d" and "see_".
   */
  function graph(words) {
    var buckets = new Map(), has = new Set(words);
    words.forEach(function (w) {
      for (var p = 0; p < w.length; p++) {
        var key = w.slice(0, p) + '_' + w.slice(p + 1), list = buckets.get(key);
        if (list) list.push(w); else buckets.set(key, [w]);
      }
    });
    return { words: words, has: has, buckets: buckets };
  }
  // The words in the graph one letter away from w (w itself need not be in the graph).
  function neighbours(g, w) {
    var out = [];
    for (var p = 0; p < w.length; p++) {
      var list = g.buckets.get(w.slice(0, p) + '_' + w.slice(p + 1));
      if (list) list.forEach(function (x) { if (x !== w) out.push(x); });
    }
    return out;
  }
  /*
   * Breadth-first search from `target`: a Map of each reachable word to its fewest steps
   * from the target. Words in `skip` (a Set) are left out of the search.
   */
  function distances(g, target, skip) {
    var dist = new Map([[target, 0]]), queue = [target];
    for (var head = 0; head < queue.length; head++) {
      var w = queue[head], d = dist.get(w) + 1;
      for (var p = 0; p < w.length; p++) {
        var list = g.buckets.get(w.slice(0, p) + '_' + w.slice(p + 1));
        if (!list) continue;
        for (var j = 0; j < list.length; j++) {
          var x = list[j];
          if (dist.has(x) || (skip && skip.has(x))) continue;
          dist.set(x, d);
          queue.push(x);
        }
      }
    }
    return dist;
  }
  /*
   * One shortest route from `from` to `to` as a list of words, both ends included, or null.
   * At each step the next word is the one with the lowest `rank` (a Map; missing words rank
   * last), then the first in alphabetical order, so the route is the same every time.
   */
  function route(g, from, to, rank) {
    var dist = distances(g, to);
    if (!dist.has(from)) return null;
    var out = [from], w = from;
    while (w !== to) {
      var want = dist.get(w) - 1;
      var options = neighbours(g, w).filter(function (x) { return dist.get(x) === want; });
      options.sort(function (a, b) { return rankOf(rank, a) - rankOf(rank, b) || (a < b ? -1 : 1); });
      w = options[0];
      out.push(w);
    }
    return out;
  }
  function rankOf(rank, w) { return rank && rank.has(w) ? rank.get(w) : 1e9; }

  // ---- the word lists

  /*
   * The game's words, from the generated data (words.js). `common` words build solutions;
   * `valid` words (common plus the rest) are accepted as steps. For each length the data
   * holds the common words in frequency tiers, most frequent first, and the other valid
   * words; `rank` gives each common word its tier. Graphs are built on first use.
   */
  function lexicon(data) {
    var lex = { common: new Set(), valid: new Set(), rank: new Map(), lists: {}, graphs: {} };
    Object.keys(data.common).forEach(function (key) {
      var len = Number(key), common = [];
      data.common[key].forEach(function (packed, tier) {
        unpack(packed, len).forEach(function (w) {
          common.push(w);
          lex.rank.set(w, tier);
        });
      });
      var more = unpack(data.more[key] || '', len);
      common.sort();
      common.forEach(function (w) { lex.common.add(w); lex.valid.add(w); });
      more.forEach(function (w) { lex.valid.add(w); });
      lex.lists['common' + len] = common;
      lex.lists['valid' + len] = common.concat(more).sort();
    });
    return lex;
  }
  // The graph of `kind` ('common' or 'valid') words of a length.
  function graphOf(lex, kind, length) {
    var key = kind + length;
    if (!lex.graphs[key]) lex.graphs[key] = graph(lex.lists[key] || []);
    return lex.graphs[key];
  }

  // ---- the calendar and the day's pair

  function dayNumber(date) {
    var d = date || new Date();
    var ms = Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) - Date.UTC(EPOCH.year, EPOCH.month - 1, EPOCH.day);
    return Math.round(ms / 864e5) + 1;
  }
  function msUntilTomorrow(date) {
    var d = date || new Date();
    return new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1).getTime() - d.getTime();
  }
  // 0 for Sunday to 6 for Saturday, for a day number. Day 1 is a Friday.
  function weekday(day) { return (((day - 1 + 5) % 7) + 7) % 7; }

  /*
   * The pair for a day: { start, end, fewest, solution } where solution is one shortest
   * ladder of common words, start and end included. The schedule repeats when it runs out.
   */
  function pairForDay(day, data) {
    var n = data.schedule.length, i = data.schedule[(((day - 1) % n) + n) % n], p = data.pairs[i];
    return { index: i, start: p[0], end: p[1], fewest: p[2], solution: [p[0]].concat(p[3] ? p[3].split(' ') : [], [p[1]]) };
  }

  // ---- playing

  function differences(a, b) {
    var n = 0;
    for (var i = 0; i < a.length; i++) if (a[i] !== b[i]) n++;
    return n;
  }
  // The position of the one letter that differs between a and b, or -1.
  function changedAt(a, b) {
    if (a.length !== b.length || differences(a, b) !== 1) return -1;
    for (var i = 0; i < a.length; i++) if (a[i] !== b[i]) return i;
    return -1;
  }

  /*
   * Why an entry cannot go on the ladder, or null if it can. `ladder` is every word so far,
   * the start word first. Returns { code, text }: code is 'short', 'unknown', 'same',
   * 'many' or 'repeat'.
   */
  function refusal(entry, ladder, lex) {
    var above = ladder[ladder.length - 1];
    if (entry.length < above.length) return { code: 'short', text: 'Type a ' + above.length + '-letter word' };
    if (!lex.valid.has(entry)) return { code: 'unknown', text: 'Not in the word list' };
    var n = differences(entry, above);
    if (n === 0) return { code: 'same', text: 'That’s the word above. Change one letter' };
    if (n > 1) return { code: 'many', text: 'That changes ' + n + ' letters. Change just one' };
    if (ladder.indexOf(entry) >= 0) return { code: 'repeat', text: entry.toUpperCase() + ' is already on the ladder' };
    return null;
  }

  /*
   * The ladder after a word is accepted: the word goes on, and if it is one letter from the
   * end word the end word follows, finishing the day.
   */
  function addWord(ladder, word, end) {
    var out = ladder.concat([word]);
    if (word !== end && differences(word, end) === 1) out.push(end);
    return out;
  }
  function finished(ladder, end) { return ladder[ladder.length - 1] === end; }
  // Steps taken: every word after the start.
  function steps(ladder) { return ladder.length - 1; }

  // Distances to the end word over every valid word, for the warmer/cooler marks.
  function distancesToEnd(lex, end) { return distances(graphOf(lex, 'valid', end.length), end); }

  /*
   * For each step (each word after the start), true if that word is closer to the end word
   * than the word above it, by the true shortest distance over valid words.
   */
  function closer(ladder, dist) {
    var out = [];
    for (var i = 1; i < ladder.length; i++) out.push(dist.get(ladder[i]) < dist.get(ladder[i - 1]));
    return out;
  }

  /*
   * The next word on a shortest route from the last word of the ladder to the end word,
   * avoiding words already on the ladder, or null if every way on repeats one. Among the
   * words that are as close as can be, a word with a route of common words the rest of the
   * way is preferred (the shorter that route the better), then the most frequent word, then
   * alphabetical order.
   */
  function hint(lex, ladder, end) {
    var now = ladder[ladder.length - 1], used = new Set(ladder), g = graphOf(lex, 'valid', end.length);
    var dist = distances(g, end, used), viaCommon = distances(graphOf(lex, 'common', end.length), end, used);
    var best = null;
    neighbours(g, now).forEach(function (w) {
      if (!dist.has(w) || used.has(w)) return;
      var key = [dist.get(w), viaCommon.has(w) ? viaCommon.get(w) : 1e9, rankOf(lex.rank, w), w];
      if (!best || compare(key, best.key) < 0) best = { word: w, key: key };
    });
    return best ? best.word : null;
  }
  function compare(a, b) {
    for (var i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] < b[i] ? -1 : 1;
    return 0;
  }

  // ---- sharing and stats

  /*
   * The result as text: the pair (public), the steps against the fewest, hints if any, and a
   * square per step, green for a step that got closer and yellow for one that did not.
   */
  function shareText(day, pair, ladder, marks, hints, url) {
    var out = [
      'Rung #' + day + ' 🪜 ' + pair.start.toUpperCase() + ' → ' + pair.end.toUpperCase(),
      steps(ladder) + ' steps (best ' + pair.fewest + ')' + (hints ? ' 💡×' + hints : ''),
      marks.map(function (m) { return m ? '🟩' : '🟨'; }).join(''),
    ];
    if (url) out.push(url);
    return out.join('\n');
  }

  // How many steps over the fewest, bucketed for the stats chart: 0, 1, 2, 3, 4 or more.
  var OVER_BUCKETS = 5;
  function emptyStats() {
    var dist = [];
    for (var i = 0; i < OVER_BUCKETS; i++) dist.push(0);
    return { played: 0, matched: 0, over: 0, streak: 0, best: 0, lastDay: 0, dist: dist };
  }
  /*
   * Record a finished day. `matched` counts days solved in the fewest steps; `over` is the
   * sum of steps over the fewest, for the average. The streak counts days played in a row.
   * A day that is not later than the last one recorded changes nothing, so a clock set back
   * cannot count a day twice.
   */
  function recordResult(stats, day, taken, fewest) {
    if (day <= stats.lastDay) return stats;
    var extra = Math.max(0, taken - fewest);
    var s = {
      played: stats.played + 1, matched: stats.matched + (extra === 0 ? 1 : 0), over: stats.over + extra,
      dist: stats.dist.slice(), lastDay: day,
    };
    s.streak = stats.lastDay === day - 1 ? stats.streak + 1 : 1;
    s.best = Math.max(stats.best, s.streak);
    s.dist[Math.min(extra, OVER_BUCKETS - 1)]++;
    return s;
  }

  var api = {
    EPOCH: EPOCH, ALPHABET: ALPHABET, OVER_BUCKETS: OVER_BUCKETS,
    pack: pack, unpack: unpack, graph: graph, neighbours: neighbours, distances: distances, route: route,
    lexicon: lexicon, graphOf: graphOf,
    dayNumber: dayNumber, msUntilTomorrow: msUntilTomorrow, weekday: weekday, pairForDay: pairForDay,
    differences: differences, changedAt: changedAt, refusal: refusal, addWord: addWord, finished: finished, steps: steps,
    distancesToEnd: distancesToEnd, closer: closer, hint: hint,
    shareText: shareText, emptyStats: emptyStats, recordResult: recordResult,
  };
  root.Rung = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
