/*
 * Unearth game rules. No DOM in here: app.js draws the page, this file knows the pictures,
 * makes the clues, solves grids line by line, picks hints and keeps the stats. Works as a
 * plain <script> in the browser and via require() in Node.
 *
 * The game: a nonogram. A square grid hides a small picture. Each row and column has a clue,
 * the lengths of its runs of filled squares in order, with at least one empty square between
 * runs. The player fills squares until the filled ones match the picture.
 */
(function (root) {
  'use strict';

  // Day 1, as a local calendar date: Friday 13 November 2026.
  var EPOCH = { year: 2026, month: 11, day: 13 };
  // The first days of the schedule, played whatever the weekday, before the weekly plan starts.
  var INTRO_DAYS = 3;
  var INTRO_SIZE = 5;
  // The grid size for each day of the week, Monday first.
  var WEEK = [5, 5, 8, 8, 8, 10, 10];
  var SIZES = [5, 8, 10];

  // Square states, as stored in a grid string: empty, filled, crossed (marked empty).
  var EMPTY = '.', FILL = '#', CROSS = 'x';

  // ---- pictures

  // The picture's answer as a grid string: '#' where the picture has a square, '.' elsewhere.
  function solution(p) {
    return p.cells.replace(/[^.]/g, FILL);
  }
  function emptyGrid(n) { return new Array(n * n + 1).join(EMPTY); }

  // The squares of a row or column, in order: kind is 'row' or 'col'.
  function lineCells(n, kind, index) {
    var out = [];
    for (var k = 0; k < n; k++) out.push(kind === 'row' ? index * n + k : k * n + index);
    return out;
  }
  // The lengths of the runs of filled squares in a list of states.
  function runs(states) {
    var out = [], len = 0;
    for (var i = 0; i <= states.length; i++) {
      if (i < states.length && states[i] === FILL) len++;
      else if (len) { out.push(len); len = 0; }
    }
    return out;
  }
  function lineStates(grid, n, kind, index) {
    return lineCells(n, kind, index).map(function (i) { return grid[i]; });
  }
  // Every row's and column's clue for a grid string (usually the solution).
  function cluesFor(grid, n) {
    var rows = [], cols = [];
    for (var k = 0; k < n; k++) {
      rows.push(runs(lineStates(grid, n, 'row', k)));
      cols.push(runs(lineStates(grid, n, 'col', k)));
    }
    return { rows: rows, cols: cols };
  }
  function sameRuns(a, b) {
    return a.length === b.length && a.every(function (x, i) { return x === b[i]; });
  }
  // True when a line's filled squares form exactly its clue's runs (the clue is marked as matched then).
  function lineMatches(grid, n, kind, index, clue) {
    return sameRuns(runs(lineStates(grid, n, kind, index)), clue);
  }

  // ---- the line solver

  /*
   * Everything one line's clue says about its squares, given what is known already.
   * `known` is a string of '.' (unknown), '#' (filled) and 'x' (empty). Returns the line with
   * every square that all possible placements of the runs agree on filled in, or null if no
   * placement fits.
   */
  function solveLine(clue, known) {
    var n = known.length, canFill = [], canEmpty = [], cur = [], fits = 0;
    for (var i = 0; i < n; i++) { canFill.push(false); canEmpty.push(false); cur.push(CROSS); }
    function record() {
      fits++;
      for (var i = 0; i < n; i++) { if (cur[i] === FILL) canFill[i] = true; else canEmpty[i] = true; }
    }
    // Place run k at or after square `from`; squares before `from` are already decided.
    function place(k, from) {
      if (k === clue.length) {
        for (var i = from; i < n; i++) if (known[i] === FILL) return;
        record();
        return;
      }
      var len = clue[k];
      for (var s = from; s + len <= n; s++) {
        // The squares skipped before the run are empty, so none of them may be known filled.
        if (s > from && known[s - 1] === FILL) break;
        var ok = true;
        for (var j = s; j < s + len; j++) if (known[j] === CROSS) { ok = false; break; }
        if (!ok || (s + len < n && known[s + len] === FILL)) continue;
        for (j = s; j < s + len; j++) cur[j] = FILL;
        place(k + 1, s + len + 1);
        for (j = s; j < s + len; j++) cur[j] = CROSS;
      }
    }
    place(0, 0);
    if (!fits) return null;
    var out = '';
    for (i = 0; i < n; i++) out += canFill[i] && canEmpty[i] ? known[i] : canFill[i] ? FILL : CROSS;
    return out;
  }

  /*
   * Solves a grid using one line at a time, as a person can without guessing: each pass reads
   * every row and column against its clue, and it stops when a pass learns nothing more.
   * `start` is an optional grid of what is known already. Returns { solved, grid, passes }
   * where grid has '#', 'x' and, where it got stuck, '.'. When it solves the grid, that is the
   * only grid the clues allow, since every step follows from the clues.
   */
  function logicSolve(n, clues, start) {
    var grid = (start || emptyGrid(n)).split(''), passes = 0, changed = true, broken = false;
    while (changed && !broken) {
      changed = false;
      passes++;
      ['row', 'col'].forEach(function (kind) {
        for (var k = 0; k < n && !broken; k++) {
          var cells = lineCells(n, kind, k);
          var known = cells.map(function (i) { return grid[i]; }).join('');
          var got = solveLine(kind === 'row' ? clues.rows[k] : clues.cols[k], known);
          if (got === null) { broken = true; return; }
          if (got !== known) {
            changed = true;
            cells.forEach(function (i, j) { grid[i] = got[j]; });
          }
        }
      });
    }
    var g = grid.join('');
    return { solved: !broken && g.indexOf(EMPTY) < 0, grid: g, passes: passes };
  }

  // ---- playing

  function isSolved(p, grid) {
    return grid.replace(/x/g, EMPTY) === solution(p);
  }
  // Squares the player has filled that the picture leaves empty.
  function wrongSquares(p, grid) {
    var out = [];
    for (var i = 0; i < grid.length; i++) if (grid[i] === FILL && p.cells[i] === EMPTY) out.push(i);
    return out;
  }
  function filledCount(grid) { return grid.replace(/[^#]/g, '').length; }

  /*
   * The row or column a hint fills in: { kind, index }, or null if the picture is solved.
   * Of the lines whose filled squares do not yet match the picture, it takes the one where
   * the player's correct marks and the line's clue settle the most squares, which is where a
   * solver would look next. Ties go to rows, then to the lowest number.
   */
  function hintLine(p, grid) {
    var n = p.n, sol = solution(p), clues = cluesFor(sol, n), best = null, bestScore = -1;
    // What the player has right: filled squares that should be, crosses that should be.
    var right = '';
    for (var i = 0; i < grid.length; i++) right += grid[i] !== EMPTY && (grid[i] === FILL) === (sol[i] === FILL) ? grid[i] : EMPTY;
    ['row', 'col'].forEach(function (kind) {
      for (var k = 0; k < n; k++) {
        var clue = kind === 'row' ? clues.rows[k] : clues.cols[k];
        var cells = lineCells(n, kind, k);
        var mine = cells.map(function (j) { return grid[j] === FILL ? FILL : EMPTY; }).join('');
        var want = cells.map(function (j) { return sol[j] === FILL ? FILL : EMPTY; }).join('');
        if (mine === want) continue;
        var known = cells.map(function (j) { return right[j]; }).join('');
        var got = solveLine(clue, known), score = 0;
        for (var j = 0; j < n; j++) if (known[j] === EMPTY && got[j] !== EMPTY) score++;
        if (score > bestScore) { best = { kind: kind, index: k }; bestScore = score; }
      }
    });
    return best;
  }
  // The grid with one line set to the picture: filled where it has squares, crossed elsewhere.
  function fillLine(p, grid, kind, index) {
    var g = grid.split(''), sol = solution(p);
    lineCells(p.n, kind, index).forEach(function (i) { g[i] = sol[i] === FILL ? FILL : CROSS; });
    return g.join('');
  }

  // ---- the schedule

  // The grid size a day is meant to have.
  function plannedSize(day) {
    if (day <= INTRO_DAYS) return INTRO_SIZE;
    return WEEK[(day - INTRO_DAYS - 1) % 7];
  }
  // Which picture a day shows. The intro days come first, then the weekly part repeats.
  function scheduleIndex(day, bank) {
    var s = bank.schedule, intro = bank.intro;
    if (day <= intro) return s[Math.max(0, day - 1)];
    return s[intro + ((day - intro - 1) % (s.length - intro))];
  }
  // A picture's subject: its id without the size, so "carrot-5" and "carrot-10" are both carrots.
  function subject(p) { return p.id.replace(/-\d+$/, ''); }
  /*
   * The day's picture: { day, index, id, name, n, bg, colours, cells, clues }. cells has one
   * character a square: '.' for empty, else the index of its colour in `colours` (0-9, a-z).
   */
  function dailyPicture(day, bank) {
    var index = scheduleIndex(day, bank), src = bank.pictures[index];
    var p = { day: day, index: index, id: src.id, name: src.name, n: src.n, bg: src.bg, colours: src.colours, cells: src.cells };
    p.clues = cluesFor(solution(p), p.n);
    return p;
  }
  // The colour of a square of the picture, or null where it is empty.
  function colourAt(p, i) {
    var c = p.cells[i];
    return c === EMPTY ? null : p.colours[parseInt(c, 36)];
  }

  /*
   * The guided example on a first visit: a 4 by 4 snail. Each step points at one line and asks
   * for the squares its clue settles, in this order: a run as long as the line, the overlap of
   * a 3 in a line of 4, a clue of two runs that fills its line exactly, a cross on a square a
   * finished line rules out, the square that cross then settles, and last a square the player
   * finds alone, with nothing outlined. `cells` are the squares a step asks for, `mark` is what
   * a tap puts there (FILL unless it says CROSS), and `find` steps outline nothing. After the
   * last step the picture is complete.
   */
  var EXAMPLE = {
    id: 'example', name: 'A snail', n: 4, bg: '#e3f1d5', colours: ['#c77a32', '#7a4416', '#c9b36a', '#2b2b2b'],
    cells: '...3' + '10.2' + '0122' + '.222',
    steps: [
      { kind: 'row', index: 2, cells: [8, 9, 10, 11], text: 'Row 3’s clue is 4, and the row is 4 squares wide, so all four are filled.' },
      { kind: 'row', index: 3, cells: [13, 14], text: 'Row 4 needs a run of 3 in 4 squares. Slide it left or right: the middle two are filled either way.' },
      { kind: 'row', index: 1, cells: [4, 5, 7], text: 'Two runs: 2, then 1, with a gap between. That takes all 4 squares, so there is only one way to fill them.' },
      { kind: 'col', index: 0, cells: [12], mark: CROSS, text: 'Column 1 needs 2, and it has them. The other squares must be empty: cross out the one at the bottom.' },
      { kind: 'row', index: 3, cells: [15], text: 'That cross helps row 4: its 3 can’t start on a crossed square, so it ends at the right. Fill it.' },
      { find: true, cells: [3], text: 'Your turn. One square is still missing, and nothing is outlined: find it from the clues.',
        nudge: 'Not that one. Look for a clue that isn’t matched yet, and count its squares.' },
    ],
  };
  EXAMPLE.clues = cluesFor(solution(EXAMPLE), EXAMPLE.n);

  /*
   * The warm-up after the example on a first visit: an easy 5 by 5 beehive, outside the daily
   * schedule. Nothing about it is saved or counted.
   */
  var WARMUP = {
    id: 'warmup', name: 'A beehive', n: 5, bg: '#fbf5e6', colours: ['#e8b04a', '#c7862a'],
    cells: '..0..' + '.111.' + '00000' + '11111' + '00.00',
  };
  WARMUP.clues = cluesFor(solution(WARMUP), WARMUP.n);

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

  // "0:07", "2:31", "1:02:05".
  function formatTime(ms) {
    var s = Math.max(0, Math.floor(ms / 1000)), h = Math.floor(s / 3600), m = Math.floor(s / 60) % 60;
    var pad = function (x) { return (x < 10 ? '0' : '') + x; };
    return h ? h + ':' + pad(m) + ':' + pad(s % 60) : m + ':' + pad(s % 60);
  }

  // The result as text: the size, the time, and any checks and hints. Never the picture.
  function shareText(p, ms, checks, hints, url) {
    var head = 'Unearth #' + p.day + ' 🖼️ ' + p.n + '×' + p.n + ' in ' + formatTime(ms) +
      (checks ? ' ✓×' + checks : '') + (hints ? ' 💡×' + hints : '');
    return url ? head + '\n' + url : head;
  }

  function emptyStats() {
    var bySize = {};
    SIZES.forEach(function (n) { bySize[n] = { solved: 0, total: 0, best: 0 }; });
    return { played: 0, streak: 0, best: 0, lastDay: 0, clean: 0, bySize: bySize };
  }

  /*
   * Record a solved day. The streak counts days played in a row; `clean` counts days solved
   * with no checks and no hints. Per size it keeps the number solved, their total time (for
   * the average) and the best time, which only counts clean solves. A day that is not later
   * than the last one recorded changes nothing, so a clock set back cannot count a day twice.
   */
  function recordResult(stats, day, n, ms, checks, hints) {
    if (day <= stats.lastDay || !stats.bySize[n]) return stats;
    var bySize = {};
    Object.keys(stats.bySize).forEach(function (k) {
      var b = stats.bySize[k];
      bySize[k] = { solved: b.solved, total: b.total, best: b.best };
    });
    var t = Math.max(1, Math.round(ms)); // 0 means no best time yet
    var clean = !checks && !hints;
    bySize[n].solved++;
    bySize[n].total += t;
    if (clean && (!bySize[n].best || t < bySize[n].best)) bySize[n].best = t;
    var s = { played: stats.played + 1, lastDay: day, clean: stats.clean + (clean ? 1 : 0), bySize: bySize };
    s.streak = stats.lastDay === day - 1 ? stats.streak + 1 : 1;
    s.best = Math.max(stats.best, s.streak);
    return s;
  }

  var api = {
    EPOCH: EPOCH, INTRO_DAYS: INTRO_DAYS, INTRO_SIZE: INTRO_SIZE, WEEK: WEEK, SIZES: SIZES,
    EMPTY: EMPTY, FILL: FILL, CROSS: CROSS, EXAMPLE: EXAMPLE, WARMUP: WARMUP,
    solution: solution, emptyGrid: emptyGrid, lineCells: lineCells, runs: runs, cluesFor: cluesFor,
    lineMatches: lineMatches, solveLine: solveLine, logicSolve: logicSolve,
    isSolved: isSolved, wrongSquares: wrongSquares, filledCount: filledCount, hintLine: hintLine, fillLine: fillLine,
    plannedSize: plannedSize, scheduleIndex: scheduleIndex, subject: subject, dailyPicture: dailyPicture, colourAt: colourAt,
    dayNumber: dayNumber, msUntilTomorrow: msUntilTomorrow, formatTime: formatTime, shareText: shareText,
    emptyStats: emptyStats, recordResult: recordResult,
  };
  root.Unearth = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
