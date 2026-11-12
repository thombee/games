/*
 * Plot game rules. No DOM in here: app.js draws the page, this file decides the day's
 * planting, how a guess is marked, what hard mode allows, the share text and the stats.
 * Works as a plain <script> in the browser and via require() in Node.
 *
 * The game: four garden beds hide four vegetables, chosen from six, and a vegetable can be
 * in more than one bed. The player has seven guesses. Each bed of a guess is marked the way
 * Wordle marks a letter: right (that vegetable is in that bed), elsewhere (it is planted in
 * another bed) or absent (it is not planted, or not as many times as the guess has it).
 */
(function (root) {
  'use strict';

  var BEDS = 4;
  var MAX_GUESSES = 7;
  // Day 1, as a local calendar date. It is a Friday.
  var EPOCH = { year: 2026, month: 11, day: 13 };
  // The first days of the schedule never repeat a vegetable, whatever the weekday.
  var GENTLE_DAYS = 3;
  // On days where a repeat may happen but is not required, the chance that it does.
  var REPEAT_CHANCE = 0.5;

  // The six vegetables. `key` is the letter that places it from the keyboard: the first
  // letter of its name that no vegetable before it in the tray has taken.
  var VEG = [
    { id: 'carrot', name: 'Carrot', emoji: '🥕', key: 'c' },
    { id: 'tomato', name: 'Tomato', emoji: '🍅', key: 't' },
    { id: 'corn', name: 'Corn', emoji: '🌽', key: 'o' },
    { id: 'eggplant', name: 'Eggplant', emoji: '🍆', key: 'e' },
    { id: 'capsicum', name: 'Capsicum', emoji: '🫑', key: 'a' },
    { id: 'pumpkin', name: 'Pumpkin', emoji: '🎃', key: 'p' },
  ];
  var KINDS = VEG.length;

  // ---- codes: a code is an array of four vegetable indices, 0 to 5

  // Every possible code, in order: [0,0,0,0], [0,0,0,1], ... [5,5,5,5].
  var ALL = [];
  for (var n = 0; n < Math.pow(KINDS, BEDS); n++) {
    ALL.push([Math.floor(n / 216) % 6, Math.floor(n / 36) % 6, Math.floor(n / 6) % 6, n % 6]);
  }
  function hasRepeat(code) {
    for (var i = 0; i < code.length; i++) if (code.indexOf(code[i]) !== i) return true;
    return false;
  }
  function allOne(code) { return code.every(function (v) { return v === code[0]; }); }
  var DISTINCT = ALL.filter(function (c) { return !hasRepeat(c); });
  var REPEATING = ALL.filter(function (c) { return hasRepeat(c) && !allOne(c); });

  // ---- marking a guess

  /*
   * The mark for each bed of a guess: 'right', 'elsewhere' or 'absent'. Repeats count as in
   * Wordle: beds that are right are marked first; then, from left to right, a bed is marked
   * elsewhere only while the code still has an unmatched copy of that vegetable.
   */
  function feedback(guess, code) {
    var marks = [], left = [0, 0, 0, 0, 0, 0], i;
    for (i = 0; i < BEDS; i++) {
      if (guess[i] === code[i]) marks[i] = 'right';
      else left[code[i]]++;
    }
    for (i = 0; i < BEDS; i++) {
      if (marks[i]) continue;
      if (left[guess[i]] > 0) { marks[i] = 'elsewhere'; left[guess[i]]--; }
      else marks[i] = 'absent';
    }
    return marks;
  }
  function solved(marks) { return marks.every(function (m) { return m === 'right'; }); }

  // Where a day stands, from its guesses so far: { won, done, used }.
  function status(guesses, code) {
    var won = guesses.some(function (g) { return solved(feedback(g, code)); });
    return { won: won, done: won || guesses.length >= MAX_GUESSES, used: guesses.length };
  }

  /*
   * What the guesses so far say about each vegetable, as a list in tray order:
   * 'found' if some bed marked it right or elsewhere, 'absent' if it has been tried and never
   * found, '' if it has not been tried.
   */
  function knowledge(guesses, code) {
    var out = VEG.map(function () { return ''; });
    guesses.forEach(function (g) {
      feedback(g, code).forEach(function (m, i) {
        if (m !== 'absent') out[g[i]] = 'found';
        else if (!out[g[i]]) out[g[i]] = 'absent';
      });
    });
    return out;
  }

  // ---- building a guess: a draft is four beds, each a vegetable index or null

  function emptyDraft() { return [null, null, null, null]; }
  // The draft with `veg` in its first empty bed (unchanged if all four are full).
  function place(draft, veg) {
    var d = draft.slice(), at = d.indexOf(null);
    if (at >= 0) d[at] = veg;
    return d;
  }
  // The draft with bed `bed` emptied.
  function clearBed(draft, bed) {
    var d = draft.slice();
    d[bed] = null;
    return d;
  }
  // The draft with its last filled bed emptied.
  function removeLast(draft) {
    for (var i = BEDS - 1; i >= 0; i--) if (draft[i] !== null) return clearBed(draft, i);
    return draft.slice();
  }
  function isFull(draft) { return draft.every(function (v) { return v !== null; }); }

  // ---- hard mode

  /*
   * In hard mode every guess must be one that could still be the code: each earlier guess
   * would get the marks it got if this guess were the code. That holds exactly when the
   * guess keeps every clue of every earlier row:
   *   'in'      a bed marked right has that vegetable
   *   'not-in'  a bed marked elsewhere or absent does not have that vegetable
   *   'exactly' a vegetable with an absent mark is planted exactly as many times as the row
   *             marks it right or elsewhere (none, if it has no such marks)
   *   'at-least' otherwise, at least that many times
   * Returns null if the guess fits, or the first clue it breaks, row by row:
   *   { row, clue, veg, bed, count }  (row and bed count from 1; bed is 0 for a count clue)
   */
  function hardModeProblem(guess, earlier, code) {
    for (var r = 0; r < earlier.length; r++) {
      var g = earlier[r], marks = feedback(g, code), b, v;
      var problem = function (clue, veg, bed, count) { return { row: r + 1, clue: clue, veg: veg, bed: bed, count: count }; };
      for (b = 0; b < BEDS; b++) if (marks[b] === 'right' && guess[b] !== g[b]) return problem('in', g[b], b + 1, 0);
      for (b = 0; b < BEDS; b++) if (marks[b] !== 'right' && guess[b] === g[b]) return problem('not-in', g[b], b + 1, marks[b] === 'absent' ? shown(g, marks, g[b]) : 1);
      for (v = 0; v < KINDS; v++) {
        if (g.indexOf(v) < 0) continue;
        var want = shown(g, marks, v), have = guess.filter(function (x) { return x === v; }).length;
        var exact = marks.some(function (m, i) { return m === 'absent' && g[i] === v; });
        if (exact ? have !== want : have < want) return problem(exact ? 'exactly' : 'at-least', v, 0, want);
      }
    }
    return null;
  }
  // How many beds of guess g the marks show holding vegetable v (right or elsewhere).
  function shown(g, marks, v) {
    var n = 0;
    for (var i = 0; i < BEDS; i++) if (g[i] === v && marks[i] !== 'absent') n++;
    return n;
  }
  var COUNT_WORDS = ['no', 'one', 'two', 'three', 'four'];
  // The clue a hard-mode guess breaks, in words: "Row 2 has 🌽 in bed 3."
  function problemText(p) {
    var e = VEG[p.veg].emoji, row = 'Row ' + p.row;
    if (p.clue === 'in') return row + ' has ' + e + ' in bed ' + p.bed + '.';
    if (p.clue === 'not-in') return p.count === 0 ? row + ' shows no ' + e + ' is planted.' : row + ' shows ' + e + ' is not in bed ' + p.bed + '.';
    if (p.clue === 'exactly') return p.count === 0 ? row + ' shows no ' + e + ' is planted.' : row + ' shows only ' + COUNT_WORDS[p.count] + ' ' + e + ' planted.';
    return p.count === 1 ? row + ' shows ' + e + ' is planted.' : row + ' shows at least ' + COUNT_WORDS[p.count] + ' ' + e + ' planted.';
  }

  // ---- the calendar and the day's code

  function dayNumber(date) {
    var d = date || new Date();
    var ms = Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) - Date.UTC(EPOCH.year, EPOCH.month - 1, EPOCH.day);
    return Math.round(ms / 864e5) + 1;
  }
  function msUntilTomorrow(date) {
    var d = date || new Date();
    return new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1).getTime() - d.getTime();
  }
  // The day of the week of a day number: 0 Sunday to 6 Saturday.
  function weekday(day) {
    return new Date(Date.UTC(EPOCH.year, EPOCH.month - 1, EPOCH.day + day - 1)).getUTCDay();
  }

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
  function seedFor(day, salt) { return Math.imul(day, 2654435761) ^ salt; }

  /*
   * Whether a day's code has a repeated vegetable:
   *   'none'    Monday to Wednesday, and the first GENTLE_DAYS days of the schedule
   *   'repeat'  one day of each weekend, Saturday or Sunday, drawn per weekend
   *   'maybe'   Thursday, Friday and the other weekend day: a repeat with REPEAT_CHANCE
   */
  function repeatRule(day) {
    if (day <= GENTLE_DAYS) return 'none';
    var wd = weekday(day);
    if (wd >= 1 && wd <= 3) return 'none';
    if (wd === 4 || wd === 5) return 'maybe';
    var saturday = wd === 6 ? day : day - 1;
    var forced = rng(seedFor(saturday, 0x5eed))() < 0.5 ? saturday : saturday + 1;
    // A weekend that starts inside the gentle days keeps its other day free.
    if (forced <= GENTLE_DAYS) forced = forced === saturday ? saturday + 1 : saturday;
    return day === forced ? 'repeat' : 'maybe';
  }

  /*
   * The day's code. The same day always gives the same code. Days are worked out in order
   * from day 1, because a day's code must differ from the day before's (the same four in the
   * same order); the results are kept, so each day is worked out once.
   */
  var made = [];
  function dailyCode(day) {
    day = Math.max(1, Math.floor(day));
    for (var d = made.length + 1; d <= day; d++) made.push(makeCode(d, made[d - 2] || null));
    return made[day - 1].slice();
  }
  function makeCode(day, before) {
    var rand = rng(seedFor(day, 0x9e3779b9)), rule = repeatRule(day);
    var repeat = rule === 'repeat' || (rule === 'maybe' && rand() < REPEAT_CHANCE);
    var pool = repeat ? REPEATING : DISTINCT;
    for (;;) {
      var code = pool[Math.floor(rand() * pool.length)];
      if (!before || code.join() !== before.join()) return code.slice();
    }
  }

  // ---- sharing and stats

  var SQUARES = { right: '🟩', elsewhere: '🟨', absent: '⬜' };

  // The result as text: the score, then a row of squares per guess. It never names a vegetable.
  function shareText(day, guesses, code, hard, url) {
    var st = status(guesses, code);
    var out = ['Plot #' + day + ' 🥕 ' + (st.won ? st.used : 'X') + '/' + MAX_GUESSES + (hard ? ' ✳︎' : '')];
    guesses.forEach(function (g) {
      out.push(feedback(g, code).map(function (m) { return SQUARES[m]; }).join(''));
    });
    if (url) out.push(url);
    return out.join('\n');
  }

  // dist[i] counts days solved in i + 1 guesses.
  function emptyStats() {
    var dist = [];
    for (var i = 0; i < MAX_GUESSES; i++) dist.push(0);
    return { played: 0, won: 0, streak: 0, best: 0, lastDay: 0, dist: dist };
  }

  /*
   * Record a finished day. The streak counts days played in a row, solved or not. A day that
   * is not later than the last one recorded changes nothing, so a day is never counted twice
   * and a clock set back cannot add an earlier one.
   */
  function recordResult(stats, day, won, used) {
    if (day <= stats.lastDay) return stats;
    var s = { played: stats.played + 1, won: stats.won + (won ? 1 : 0), dist: stats.dist.slice(), lastDay: day };
    s.streak = stats.lastDay === day - 1 ? stats.streak + 1 : 1;
    s.best = Math.max(stats.best, s.streak);
    if (won) s.dist[used - 1]++;
    return s;
  }

  var api = {
    BEDS: BEDS, MAX_GUESSES: MAX_GUESSES, EPOCH: EPOCH, GENTLE_DAYS: GENTLE_DAYS, REPEAT_CHANCE: REPEAT_CHANCE,
    VEG: VEG, ALL: ALL, SQUARES: SQUARES,
    hasRepeat: hasRepeat, feedback: feedback, solved: solved, status: status, knowledge: knowledge,
    emptyDraft: emptyDraft, place: place, clearBed: clearBed, removeLast: removeLast, isFull: isFull,
    hardModeProblem: hardModeProblem, problemText: problemText,
    dayNumber: dayNumber, msUntilTomorrow: msUntilTomorrow, weekday: weekday, repeatRule: repeatRule, dailyCode: dailyCode,
    shareText: shareText, emptyStats: emptyStats, recordResult: recordResult,
  };
  root.Plot = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
