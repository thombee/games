/*
 * Patch game rules. No DOM in here: app.js draws the page, this file knows the puzzles,
 * checks the rules, solves gardens and keeps the stats. Works as a plain <script> in the
 * browser and via require() in Node.
 *
 * The game: a square garden of n by n squares is split into n coloured beds. The player
 * plants n seedlings so that every row, every column and every bed has exactly one, and no
 * two seedlings touch, not even at a corner.
 */
(function (root) {
  'use strict';

  // Day 1, as a local calendar date: Friday 13 November 2026.
  var EPOCH = { year: 2026, month: 11, day: 13 };
  // The first days of the schedule, played whatever the weekday, before the weekly plan starts.
  var INTRO_DAYS = 3;

  // Square states, as stored in a garden string: empty, marked ✕, seedling.
  var EMPTY = '.', CROSS = 'x', SEED = 's';

  // Bed colours by palette index: the name read out to screen readers, the square used in
  // shared results, and the vegetable a seedling in that bed becomes when the garden blooms.
  var PALETTE = [
    { name: 'red', square: '🟥', veg: '🍅' },
    { name: 'orange', square: '🟧', veg: '🥕' },
    { name: 'yellow', square: '🟨', veg: '🌽' },
    { name: 'green', square: '🟩', veg: '🥦' },
    { name: 'blue', square: '🟦', veg: '🫐' },
    { name: 'purple', square: '🟪', veg: '🍆' },
    { name: 'brown', square: '🟫', veg: '🥔' },
    { name: 'white', square: '⬜', veg: '🧅' },
  ];

  /*
   * The techniques the step-by-step solver knows, from easiest to hardest. A puzzle's rating
   * is the hardest one it needs. Each placed seedling also clears its row, column, bed and
   * the eight squares around it; that is part of every level.
   */
  var TECHNIQUES = [
    null,
    'only one square left in a row, column or bed',
    'a bed that lies in one row or column (or a row or column that lies in one bed)',
    'a square that touches or shares a line with every free square of another row, column or bed',
    'two beds, rows or columns confined to two others',
    'three or more beds, rows or columns confined to as many others',
  ];
  // How hard a day feels, from the rating.
  var DIFFICULTY = [null, 'gentle', 'gentle', 'medium', 'tricky', 'hard'];
  // The weekly plan, Monday first: [garden size, difficulty].
  var WEEK = [[5, 'gentle'], [6, 'gentle'], [6, 'medium'], [7, 'medium'], [7, 'tricky'], [8, 'tricky'], [8, 'hard']];
  var INTRO = [5, 'gentle'];

  // ---- puzzles

  /*
   * A puzzle as stored in puzzles.js: "n|beds|solution|rating". beds is n*n digits, the bed
   * of each square in reading order; solution is n digits, the column of each row's seedling.
   */
  function decode(text) {
    var parts = String(text).split('|'), n = Number(parts[0]);
    return {
      n: n,
      beds: parts[1].split('').map(Number),
      solution: parts[2].split('').map(Number),
      rating: Number(parts[3]),
    };
  }
  function encode(p) {
    return [p.n, p.beds.join(''), p.solution.join(''), p.rating].join('|');
  }

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

  // Which puzzle in the bank a day plays. The intro days come first, then the weekly part of
  // the schedule repeats for as long as needed.
  function scheduleIndex(day, bank) {
    var s = bank.schedule, intro = bank.intro;
    if (day <= intro) return s[Math.max(0, day - 1)];
    return s[intro + ((day - intro - 1) % (s.length - intro))];
  }
  // The size and difficulty a day is meant to have.
  function plannedFor(day) {
    if (day <= INTRO_DAYS) return INTRO;
    return WEEK[(day - INTRO_DAYS - 1) % 7];
  }

  /*
   * The day's puzzle: { day, index, n, beds, solution, rating, difficulty, colours }.
   * colours[b] is the palette index of bed b, shuffled per puzzle so that small gardens do
   * not always use the same colours.
   */
  function dailyPuzzle(day, bank) {
    var index = scheduleIndex(day, bank), p = decode(bank.puzzles[index]);
    p.day = day;
    p.index = index;
    p.difficulty = DIFFICULTY[p.rating];
    p.colours = shuffle(rng(Math.imul(index + 1, 2654435761) ^ 0x5bd1e995), [0, 1, 2, 3, 4, 5, 6, 7]).slice(0, p.n);
    return p;
  }

  // ---- the rules

  function emptyGarden(n) { return new Array(n * n + 1).join(EMPTY); }
  function nextState(s) { return s === EMPTY ? CROSS : s === CROSS ? SEED : EMPTY; }

  /*
   * What breaks the rules in a garden: { seeds, rows, cols, beds } where seeds lists the
   * squares of seedlings that clash with another (same row, column or bed, or touching), and
   * rows, cols and beds list the lines and beds that hold more than one seedling.
   */
  function conflicts(p, garden) {
    var n = p.n, seeds = [], clash = {}, rows = {}, cols = {}, beds = {};
    for (var i = 0; i < n * n; i++) if (garden[i] === SEED) seeds.push(i);
    seeds.forEach(function (a, x) {
      seeds.slice(x + 1).forEach(function (b) {
        var ra = Math.floor(a / n), ca = a % n, rb = Math.floor(b / n), cb = b % n, hit = false;
        if (ra === rb) { rows[ra] = true; hit = true; }
        if (ca === cb) { cols[ca] = true; hit = true; }
        if (p.beds[a] === p.beds[b]) { beds[p.beds[a]] = true; hit = true; }
        if (Math.abs(ra - rb) <= 1 && Math.abs(ca - cb) <= 1) hit = true;
        if (hit) clash[a] = clash[b] = true;
      });
    });
    var keys = function (o) { return Object.keys(o).map(Number).sort(function (x, y) { return x - y; }); };
    return { seeds: keys(clash), rows: keys(rows), cols: keys(cols), beds: keys(beds) };
  }

  // True when the garden keeps every rule: n seedlings, none clashing.
  function isSolved(p, garden) {
    var count = 0;
    for (var i = 0; i < garden.length; i++) if (garden[i] === SEED) count++;
    return count === p.n && conflicts(p, garden).seeds.length === 0;
  }

  // ---- solving

  /*
   * Every solution of a layout, up to `limit` of them, by trying each column row by row.
   * Each solution is a list of columns, one per row.
   */
  function solutions(n, beds, limit) {
    var colUsed = [], bedUsed = [], sol = [], found = [];
    function go(r) {
      if (r === n) { found.push(sol.slice()); return found.length >= limit; }
      for (var c = 0; c < n; c++) {
        var b = beds[r * n + c];
        if (colUsed[c] || bedUsed[b] || (r > 0 && Math.abs(sol[r - 1] - c) <= 1)) continue;
        colUsed[c] = bedUsed[b] = true;
        sol[r] = c;
        if (go(r + 1)) return true;
        colUsed[c] = bedUsed[b] = false;
      }
      return false;
    }
    go(0);
    return found;
  }

  // The rows, columns and beds of a layout, as lists of squares, and each square's three units.
  function unitsOf(n, beds) {
    var units = [], byCell = [], i;
    for (i = 0; i < n; i++) units.push({ type: 'row', i: i, cells: [] });
    for (i = 0; i < n; i++) units.push({ type: 'col', i: i, cells: [] });
    for (i = 0; i < n; i++) units.push({ type: 'bed', i: i, cells: [] });
    for (i = 0; i < n * n; i++) {
      var r = Math.floor(i / n), c = i % n, u = [units[r], units[n + c], units[2 * n + beds[i]]];
      u.forEach(function (unit) { unit.cells.push(i); });
      byCell.push(u);
    }
    return { all: units, byCell: byCell };
  }

  // The squares that touch square i, corners included.
  function neighbours(n, i) {
    var r = Math.floor(i / n), c = i % n, out = [];
    for (var dr = -1; dr <= 1; dr++) {
      for (var dc = -1; dc <= 1; dc++) {
        var rr = r + dr, cc = c + dc;
        if ((dr || dc) && rr >= 0 && rr < n && cc >= 0 && cc < n) out.push(rr * n + cc);
      }
    }
    return out;
  }

  // Every subset of `list` with `k` members.
  function subsets(list, k) {
    var out = [];
    (function go(start, acc) {
      if (acc.length === k) { out.push(acc.slice()); return; }
      for (var i = start; i < list.length; i++) { acc.push(list[i]); go(i + 1, acc); acc.pop(); }
    })(0, []);
    return out;
  }

  /*
   * Solves a layout the way a person would, without guessing: it uses the easiest technique
   * that makes progress, and starts again from the easiest after each step.
   *
   * Returns { solved, rating, steps, order, garden } where rating is the hardest technique
   * used (see TECHNIQUES), steps lists each step as { level, place } or { level, out } (the
   * squares ruled out), order lists the seedlings in the order they were found, and garden
   * is how far it got. `start` is an optional garden to begin from: its seedlings are taken
   * as given and its ✕ marks are ignored.
   */
  function logicSolve(n, beds, start) {
    var U = unitsOf(n, beds), free = [], placed = [], steps = [], order = [], rating = 0, i;
    var attack = [];
    for (i = 0; i < n * n; i++) {
      free.push(true);
      placed.push(false);
      var hit = {};
      U.byCell[i].forEach(function (u) { u.cells.forEach(function (j) { hit[j] = true; }); });
      neighbours(n, i).forEach(function (j) { hit[j] = true; });
      delete hit[i];
      attack.push(hit);
    }
    function place(i) {
      placed[i] = true;
      free[i] = false;
      order.push(i);
      Object.keys(attack[i]).forEach(function (j) { free[j] = false; });
    }
    function done(u) { return u.cells.some(function (j) { return placed[j]; }); }
    function freeIn(u) { return u.cells.filter(function (j) { return free[j]; }); }
    function open() { return U.all.filter(function (u) { return !done(u); }); }
    function rule(level, out) {
      out.forEach(function (j) { free[j] = false; });
      steps.push({ level: level, out: out });
      rating = Math.max(rating, level);
    }

    if (start) for (i = 0; i < n * n; i++) if (start[i] === SEED && free[i]) place(i);

    // Level 1: a row, column or bed with one free square left gets its seedling there.
    // Returns false if some row, column or bed has no room left at all.
    var stuck = false;
    function singles() {
      var units = open();
      for (var k = 0; k < units.length; k++) {
        var f = freeIn(units[k]);
        if (!f.length) { stuck = true; return false; }
        if (f.length === 1) {
          place(f[0]);
          steps.push({ level: 1, place: f[0] });
          rating = Math.max(rating, 1);
          return true;
        }
      }
      return false;
    }
    // Levels 2, 4 and 5: k units of one kind whose free squares all lie within k units of
    // another kind hold those k seedlings, so the rest of those other units is ruled out.
    function confined(k, level) {
      var kinds = ['bed', 'row', 'col'], units = open();
      for (var a = 0; a < 3; a++) {
        for (var b = 0; b < 3; b++) {
          if (a === b) continue;
          var from = units.filter(function (u) { return u.type === kinds[a]; });
          if (from.length <= k) continue;
          var sets = subsets(from, k);
          for (var s = 0; s < sets.length; s++) {
            var cells = [], into = {};
            sets[s].forEach(function (u) { cells = cells.concat(freeIn(u)); });
            cells.forEach(function (j) {
              var other = U.byCell[j].filter(function (u) { return u.type === kinds[b]; })[0];
              into[U.all.indexOf(other)] = other;
            });
            var targets = Object.keys(into).map(function (x) { return into[x]; });
            if (targets.length !== k) continue;
            var mine = {};
            cells.forEach(function (j) { mine[j] = true; });
            var out = [];
            targets.forEach(function (u) { freeIn(u).forEach(function (j) { if (!mine[j]) out.push(j); }); });
            if (out.length) { rule(level, out); return true; }
          }
        }
      }
      return false;
    }
    // Level 3: a free square whose seedling would rule out every free square of some other
    // row, column or bed cannot hold a seedling.
    function blocks() {
      var units = open(), out = [];
      for (var j = 0; j < n * n; j++) {
        if (!free[j]) continue;
        for (var k = 0; k < units.length; k++) {
          var u = units[k];
          if (u.cells.indexOf(j) >= 0) continue;
          var f = freeIn(u);
          if (f.length && f.every(function (x) { return attack[j][x]; })) { out.push(j); break; }
        }
      }
      if (out.length) { rule(3, out); return true; }
      return false;
    }

    for (;;) {
      if (order.length === n || stuck) break;
      if (singles()) continue;
      if (stuck) break;
      if (confined(1, 2)) continue;
      if (blocks()) continue;
      if (confined(2, 4)) continue;
      var more = false;
      for (var k = 3; k <= n - 3 && !more; k++) more = confined(k, 5);
      if (more) continue;
      break;
    }
    var garden = '';
    for (i = 0; i < n * n; i++) garden += placed[i] ? SEED : free[i] ? EMPTY : CROSS;
    return { solved: order.length === n && !stuck, rating: rating, steps: steps, order: order, garden: garden };
  }

  /*
   * The square a hint plants: the first seedling, in the order the step-by-step solver finds
   * them, that the player has not planted yet.
   */
  function hintSquare(p, garden) {
    var order = logicSolve(p.n, p.beds).order;
    for (var k = 0; k < order.length; k++) if (garden[order[k]] !== SEED) return order[k];
    return -1;
  }
  // A square that the easiest techniques rule out from the start, or -1: the first step
  // a new player could make.
  function firstClue(p) {
    var first = logicSolve(p.n, p.beds).steps[0];
    if (!first || first.level > 2) return -1;
    return first.place !== undefined ? first.place : first.out[0];
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

  // "0:07", "1:42", "1:02:05".
  function formatTime(ms) {
    var s = Math.max(0, Math.floor(ms / 1000)), h = Math.floor(s / 3600), m = Math.floor(s / 60) % 60;
    var pad = function (x) { return (x < 10 ? '0' : '') + x; };
    return h ? h + ':' + pad(m) + ':' + pad(s % 60) : m + ':' + pad(s % 60);
  }

  // Gardens up to this size get a picture of their beds in shared results; bigger ones are too bulky.
  var SHARE_PICTURE_MAX = 6;
  // The result as text: the time, any hints, and for gardens up to 6 by 6 the bed layout in
  // coloured squares, which says nothing about where the seedlings go.
  function shareText(p, ms, hints, url) {
    var head = 'Patch #' + p.day + ' 🌱 ' + formatTime(ms) + (hints ? ' 💡×' + hints : '');
    var rows = [];
    for (var r = 0; p.n <= SHARE_PICTURE_MAX && r < p.n; r++) {
      var line = '';
      for (var c = 0; c < p.n; c++) line += PALETTE[p.colours[p.beds[r * p.n + c]]].square;
      rows.push(line);
    }
    var out = [head].concat(rows);
    if (url) out.push(url);
    return out.join('\n');
  }

  var SIZES = [5, 6, 7, 8];
  function emptyStats() {
    var bySize = {};
    SIZES.forEach(function (n) { bySize[n] = { solved: 0, total: 0, best: 0 }; });
    return { played: 0, streak: 0, best: 0, lastDay: 0, hints: 0, bySize: bySize };
  }

  /*
   * Record a solved day. The streak counts days played in a row. Per garden size it keeps
   * the number solved, their total time (for the average) and the best time, which only
   * counts gardens solved without a hint. A day that is not later than the last one
   * recorded changes nothing, so a clock set back cannot count a day twice.
   */
  function recordResult(stats, day, n, ms, hints) {
    if (day <= stats.lastDay || !stats.bySize[n]) return stats;
    var bySize = {};
    Object.keys(stats.bySize).forEach(function (k) {
      var b = stats.bySize[k];
      bySize[k] = { solved: b.solved, total: b.total, best: b.best };
    });
    var t = Math.max(1, Math.round(ms)); // 0 means no best time yet
    bySize[n].solved++;
    bySize[n].total += t;
    if (!hints && (!bySize[n].best || t < bySize[n].best)) bySize[n].best = t;
    var s = { played: stats.played + 1, lastDay: day, hints: stats.hints + (hints || 0), bySize: bySize };
    s.streak = stats.lastDay === day - 1 ? stats.streak + 1 : 1;
    s.best = Math.max(stats.best, s.streak);
    return s;
  }

  var api = {
    EPOCH: EPOCH, INTRO_DAYS: INTRO_DAYS, SHARE_PICTURE_MAX: SHARE_PICTURE_MAX, EMPTY: EMPTY, CROSS: CROSS, SEED: SEED, PALETTE: PALETTE,
    TECHNIQUES: TECHNIQUES, DIFFICULTY: DIFFICULTY, WEEK: WEEK, INTRO: INTRO, SIZES: SIZES,
    decode: decode, encode: encode, rng: rng, shuffle: shuffle,
    scheduleIndex: scheduleIndex, plannedFor: plannedFor, dailyPuzzle: dailyPuzzle,
    emptyGarden: emptyGarden, nextState: nextState, conflicts: conflicts, isSolved: isSolved,
    solutions: solutions, neighbours: neighbours, logicSolve: logicSolve, hintSquare: hintSquare, firstClue: firstClue,
    dayNumber: dayNumber, msUntilTomorrow: msUntilTomorrow, formatTime: formatTime, shareText: shareText,
    emptyStats: emptyStats, recordResult: recordResult,
  };
  root.Patch = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
