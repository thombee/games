/*
 * Forage game rules. No DOM in here: app.js draws the page, this file knows the calendar,
 * the geometry of a selection on the grid, how a grid is checked, the share text and the
 * stats. Works as a plain <script> in the browser and via require() in Node.
 *
 * The game: a 7 by 7 grid of letters hides six words on one theme, in straight lines.
 * The player picks each one out by dragging from its first letter to its last.
 */
(function (root) {
  'use strict';

  var SIZE = 7;
  var WORDS = 6;
  // Day 1, as a local calendar date.
  var EPOCH = { year: 2026, month: 11, day: 13 };

  // The eight directions a word can run in, as [row step, column step].
  var DIRS = [[0, 1], [1, 0], [1, 1], [-1, 1], [0, -1], [-1, 0], [-1, -1], [1, -1]];

  // True if a word running in this direction reads backwards (right to left, or upwards).
  function isBackwards(dir) { return dir[1] < 0 || (dir[1] === 0 && dir[0] < 0); }
  function isDiagonal(dir) { return dir[0] !== 0 && dir[1] !== 0; }
  function sign(n) { return n > 0 ? 1 : n < 0 ? -1 : 0; }
  function sameCell(a, b) { return a[0] === b[0] && a[1] === b[1]; }

  // The direction from cell a to cell b, or null unless they share a row, column or diagonal.
  function dirBetween(a, b) {
    var dr = b[0] - a[0], dc = b[1] - a[1];
    if (dr === 0 && dc === 0) return null;
    if (dr !== 0 && dc !== 0 && Math.abs(dr) !== Math.abs(dc)) return null;
    return [sign(dr), sign(dc)];
  }

  // The cells from a to b inclusive, if they lie on a straight line; [a] if a is b; else null.
  function lineCells(a, b) {
    if (sameCell(a, b)) return [[a[0], a[1]]];
    var d = dirBetween(a, b);
    if (!d) return null;
    var n = Math.max(Math.abs(b[0] - a[0]), Math.abs(b[1] - a[1])), out = [];
    for (var i = 0; i <= n; i++) out.push([a[0] + d[0] * i, a[1] + d[1] * i]);
    return out;
  }

  /*
   * Where a selection that started at `start` ends, given the pointer's position in cell
   * units (the middle of cell [r, c] is at row r, column c). The selection snaps to the
   * nearest of the eight directions and to the nearest whole number of cells along it, and
   * never leaves the grid.
   */
  function snapEnd(start, row, col, size) {
    var n = size || SIZE, dr = row - start[0], dc = col - start[1];
    if (Math.abs(dr) < 0.5 && Math.abs(dc) < 0.5) return [start[0], start[1]];
    var k = Math.round(Math.atan2(dr, dc) / (Math.PI / 4));
    var dir = [Math.round(Math.sin(k * Math.PI / 4)), Math.round(Math.cos(k * Math.PI / 4))];
    var along = (dr * dir[0] + dc * dir[1]) / (dir[0] * dir[0] + dir[1] * dir[1]);
    var steps = Math.max(0, Math.round(along));
    // Stop at the edge of the grid.
    while (steps > 0) {
      var r = start[0] + dir[0] * steps, c = start[1] + dir[1] * steps;
      if (r >= 0 && r < n && c >= 0 && c < n) break;
      steps--;
    }
    return [start[0] + dir[0] * steps, start[1] + dir[1] * steps];
  }

  // The letters in these cells of the grid (an array of row strings).
  function textOf(rows, cells) {
    return cells.map(function (c) { return rows[c[0]].charAt(c[1]); }).join('');
  }

  // The index of the puzzle word whose ends are cells a and b (either way round), or -1.
  function wordAt(words, a, b) {
    for (var i = 0; i < words.length; i++) {
      var w = words[i];
      if ((sameCell(w.start, a) && sameCell(w.end, b)) || (sameCell(w.start, b) && sameCell(w.end, a))) return i;
    }
    return -1;
  }
  function wordCells(w) { return lineCells(w.start, w.end); }

  // Every place `word` can be read in the grid, in any of the eight directions: [{ start, dir }].
  function occurrences(rows, word) {
    var n = rows.length, w = word.toUpperCase(), out = [];
    for (var r = 0; r < n; r++) {
      for (var c = 0; c < n; c++) {
        if (rows[r].charAt(c) !== w.charAt(0)) continue;
        DIRS.forEach(function (d) {
          for (var i = 1; i < w.length; i++) {
            var rr = r + d[0] * i, cc = c + d[1] * i;
            if (rr < 0 || rr >= n || cc < 0 || cc >= n || rows[rr].charAt(cc) !== w.charAt(i)) return;
          }
          out.push({ start: [r, c], dir: d });
        });
      }
    }
    return out;
  }

  // The cells of `length` letters read from `start` in direction `dir`.
  function runCells(start, dir, length) {
    var out = [];
    for (var i = 0; i < length; i++) out.push([start[0] + dir[0] * i, start[1] + dir[1] * i]);
    return out;
  }

  /*
   * Places where a blocked string reads in the grid, in any of the eight directions, leaving
   * out only a string whose every letter lies inside one placed word (HOBART read backwards
   * holds one; the player reads HOBART, not the string). Returns [{ text, start, dir }].
   */
  function blockedIn(rows, words, blocklist) {
    var spans = words.map(function (w) {
      var set = {};
      (wordCells(w) || []).forEach(function (c) { set[c[0] + ',' + c[1]] = true; });
      return set;
    });
    var out = [];
    blocklist.forEach(function (b) {
      occurrences(rows, b).forEach(function (o) {
        var cells = runCells(o.start, o.dir, b.length);
        var inside = spans.some(function (set) { return cells.every(function (c) { return set[c[0] + ',' + c[1]]; }); });
        if (!inside) out.push({ text: b.toUpperCase(), start: o.start, dir: o.dir });
      });
    });
    return out;
  }

  /*
   * Problems with a finished grid, as a list of sentences (empty if it is fine):
   * each placed word must sit where the puzzle says and read there exactly once in the whole
   * grid; no other candidate word of the theme and no word from its `also` list (other words
   * on the same subject) may read anywhere; and no blocked string may read anywhere outside
   * a placed word. All of this in any of the eight directions.
   */
  function checkGrid(rows, words, themeWords, blocklist, also) {
    var problems = [], n = rows.length;
    if (!rows.every(function (row) { return row.length === n && /^[A-Z]+$/.test(row); })) problems.push('the grid is not a square of capital letters');
    if (problems.length) return problems;
    var placed = {};
    words.forEach(function (w) {
      var cells = wordCells(w);
      placed[w.text] = true;
      if (!cells || textOf(rows, cells) !== w.text) problems.push(w.text + ' is not where the puzzle says');
      var count = occurrences(rows, w.text).length;
      if (count !== 1) problems.push(w.text + ' appears ' + count + ' times');
    });
    themeWords.forEach(function (t) {
      var up = t.toUpperCase();
      if (!placed[up] && occurrences(rows, up).length) problems.push('the unused theme word ' + up + ' appears');
    });
    (also || []).forEach(function (a) {
      var up = a.toUpperCase();
      if (occurrences(rows, up).length) problems.push('the related word ' + up + ' appears');
    });
    var seen = {};
    blockedIn(rows, words, blocklist).forEach(function (b) {
      if (!seen[b.text]) problems.push('the blocked word ' + b.text + ' appears');
      seen[b.text] = true;
    });
    return problems;
  }

  // ---- the day's puzzle

  /*
   * The puzzle for a day: the schedule in grids.js runs from day 1 and starts again at the top
   * when it runs out. Returns { day, id, kind, name, clue, note, source, rows, words } where
   * each word is { text, start: [row, col], end: [row, col] }, and note and source (why the
   * animals belong, and where that is shown) are null for a theme that has none.
   */
  function puzzleFor(day, data) {
    var list = data.days, i = (((day - 1) % list.length) + list.length) % list.length, p = list[i];
    return {
      day: day, id: p.id, kind: p.kind, name: p.name, clue: p.clue, note: p.note || null, source: p.source || null,
      rows: p.rows, words: p.words,
    };
  }

  /*
   * Which word a press of the Hint button points at: the first word in the list that is not
   * found and has had no hint yet, and the hint counts. If every word left has had a hint,
   * the first of those is shown again and the hint does not count. null when all are found.
   */
  function hintTarget(words, found, hinted) {
    var again = -1;
    for (var i = 0; i < words.length; i++) {
      if (found.indexOf(i) >= 0) continue;
      if (hinted.indexOf(i) < 0) return { index: i, counts: true };
      if (again < 0) again = i;
    }
    return again < 0 ? null : { index: again, counts: false };
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

  // ---- time, sharing and stats

  // A time in whole seconds as "1:42", or "1:02:09" past an hour.
  function formatTime(ms) {
    var s = Math.max(0, Math.floor(ms / 1000)), h = Math.floor(s / 3600), m = Math.floor(s / 60) % 60, sec = s % 60;
    var two = function (v) { return (v < 10 ? '0' : '') + v; };
    return h ? h + ':' + two(m) + ':' + two(sec) : m + ':' + two(sec);
  }
  // The same, in words, for screen readers: "1 minute 42 seconds".
  function spokenTime(ms) {
    var s = Math.max(0, Math.floor(ms / 1000)), h = Math.floor(s / 3600), m = Math.floor(s / 60) % 60, sec = s % 60;
    var part = function (n, one) { return n + ' ' + one + (n === 1 ? '' : 's'); };
    var out = [];
    if (h) out.push(part(h, 'hour'));
    if (m) out.push(part(m, 'minute'));
    if (sec || !out.length) out.push(part(sec, 'second'));
    return out.join(' ');
  }

  // The result as text: the day, the time, any hints, and the clue. Never the theme or a word.
  function shareText(day, ms, hints, clue, url) {
    var head = 'Forage #' + day + ' 🧺 ' + WORDS + '/' + WORDS + ' in ' + formatTime(ms) + (hints ? ' 💡×' + hints : '');
    var out = [head, '"' + clue + '"'];
    if (url) out.push(url);
    return out.join('\n');
  }

  function emptyStats() {
    return { played: 0, totalMs: 0, bestMs: 0, clean: 0, streak: 0, best: 0, lastDay: 0 };
  }

  /*
   * Record a finished day: its time and how many hints it took. The streak counts days
   * played in a row. A day that is not later than the last one recorded changes nothing,
   * so a day is never counted twice and a clock set back cannot count an earlier day.
   */
  function recordResult(stats, day, ms, hints) {
    if (day <= stats.lastDay) return stats;
    var t = Math.max(0, Math.floor(ms / 1000) * 1000);
    var s = {
      played: stats.played + 1, totalMs: stats.totalMs + t, clean: stats.clean + (hints ? 0 : 1), lastDay: day,
      bestMs: stats.bestMs && stats.bestMs <= t ? stats.bestMs : t,
    };
    s.streak = stats.lastDay === day - 1 ? stats.streak + 1 : 1;
    s.best = Math.max(stats.best, s.streak);
    return s;
  }
  // The streak as it stands today: it lapses once a whole day has gone by unplayed.
  function currentStreak(stats, today) { return stats.lastDay >= today - 1 ? stats.streak : 0; }

  // ---- seeded randomness, for the grid builder

  // A small seeded random number generator (mulberry32).
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

  var api = {
    SIZE: SIZE, WORDS: WORDS, EPOCH: EPOCH, DIRS: DIRS,
    isBackwards: isBackwards, isDiagonal: isDiagonal, dirBetween: dirBetween, lineCells: lineCells, snapEnd: snapEnd,
    textOf: textOf, wordAt: wordAt, wordCells: wordCells, occurrences: occurrences, blockedIn: blockedIn, checkGrid: checkGrid,
    puzzleFor: puzzleFor, hintTarget: hintTarget, dayNumber: dayNumber, msUntilTomorrow: msUntilTomorrow,
    formatTime: formatTime, spokenTime: spokenTime, shareText: shareText,
    emptyStats: emptyStats, recordResult: recordResult, currentStreak: currentStreak,
    rng: rng, shuffle: shuffle,
  };
  root.Forage = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
