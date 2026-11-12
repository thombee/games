/*
 * Grow game rules. No DOM in here: app.js draws the page, this file slides and merges the
 * plants, decides where new seeds appear, scores a round and keeps the stats. Works as a
 * plain <script> in the browser and via require() in Node.
 *
 * The game: the rules of 2048 on a 4 by 4 garden bed, with plants for numbers. A swipe
 * slides every plant that way; two of the same that meet merge into the next stage. After
 * each move a seed (sometimes a sprout) appears. A round is a fixed number of moves, three
 * rounds a day, and the best round counts.
 */
(function (root) {
  'use strict';

  var SIZE = 4;
  var CELLS = SIZE * SIZE;
  // Moves in a round. A swipe that moves nothing does not count.
  var MOVES = 80;
  // Rounds a day; the best counts.
  var ROUNDS = 3;
  // Plants in the bed when a round starts.
  var START = 6;
  // The chance that a new plant is a sprout rather than a seed: SPROUT at the start of a
  // round, rising evenly to SPROUT_END by the last move, so the bed fills faster near the end.
  var SPROUT = 0.4;
  var SPROUT_END = 0.9;
  // Points for each empty square when a round ends: a tidy garden scores more.
  var TIDY = 20;
  // Day 1, as a local calendar date.
  var EPOCH = { year: 2026, month: 11, day: 13 };

  /*
   * The stages, smallest first. A plant's level is its place in this list counting from 1,
   * so a seed is level 1. Two plants of one level merge into one of the next. Merging into
   * level k scores 2^k points, as in 2048 (where a seed would be the 2 tile).
   */
  var STAGES = [
    null,
    { name: 'seed', emoji: '🌰' },
    { name: 'sprout', emoji: '🌱' },
    { name: 'seedling', emoji: '🌿' },
    { name: 'pot plant', emoji: '🪴' },
    { name: 'tulip', emoji: '🌷' },
    { name: 'sunflower', emoji: '🌻' },
    { name: 'palm', emoji: '🌴' },
    { name: 'tree', emoji: '🌳' },
    { name: 'orchard', emoji: '🍎' },
    { name: 'forest', emoji: '🌲' },
  ];
  var TOP = STAGES.length - 1;

  function points(level) { return Math.pow(2, level); }

  // The bonus for a round that ends with this garden: { empty (squares), points }.
  function tidyBonus(board) {
    var empty = 0;
    for (var i = 0; i < board.length; i++) if (!board[i]) empty++;
    return { empty: empty, points: empty * TIDY };
  }

  // ---- sliding and merging

  var DIRS = ['L', 'R', 'U', 'D'];
  var DIR_NAMES = { L: 'left', R: 'right', U: 'up', D: 'down' };

  /*
   * The four lines of cells for a direction, each ordered from the edge the plants slide
   * towards. Cells are numbered row by row from the top left, 0 to 15.
   */
  function lines(dir) {
    var out = [];
    for (var i = 0; i < SIZE; i++) {
      var line = [];
      for (var j = 0; j < SIZE; j++) {
        if (dir === 'L') line.push(i * SIZE + j);
        else if (dir === 'R') line.push(i * SIZE + (SIZE - 1 - j));
        else if (dir === 'U') line.push(j * SIZE + i);
        else line.push((SIZE - 1 - j) * SIZE + i);
      }
      out.push(line);
    }
    return out;
  }
  var LINES = {};
  DIRS.forEach(function (d) { LINES[d] = lines(d); });

  /*
   * Slide every plant towards one side. The board is a list of 16 levels, 0 for an empty
   * cell. Returns { board, moved, points, paths, merges }: paths has one { from, to } per
   * plant, merges one { cell, level } per merge (the new level). As in 2048, a plant
   * merges at most once a move, and the pair nearest the edge merges first, so four seeds
   * in a row make two sprouts. Forests, the top stage, do not merge.
   */
  function slide(board, dir) {
    var next = board.slice(), paths = [], merges = [], gained = 0, moved = false;
    LINES[dir].forEach(function (line) {
      var at = 0, open = false; // `open`: the plant at line[at - 1] can still take a merge
      line.forEach(function (cell) { next[cell] = 0; });
      line.forEach(function (cell) {
        var level = board[cell];
        if (!level) return;
        if (open && next[line[at - 1]] === level && level < TOP) {
          var to = line[at - 1];
          next[to] = level + 1;
          gained += points(level + 1);
          merges.push({ cell: to, level: level + 1 });
          paths.push({ from: cell, to: to });
          open = false;
          moved = true;
          return;
        }
        next[line[at]] = level;
        paths.push({ from: cell, to: line[at] });
        if (line[at] !== cell) moved = true;
        at++;
        open = true;
      });
    });
    return { board: next, moved: moved, points: gained, paths: paths, merges: merges };
  }

  // Whether any swipe would move something.
  function canMove(board) {
    for (var i = 0; i < CELLS; i++) {
      if (!board[i]) return true;
      var col = i % SIZE;
      if (col < SIZE - 1 && board[i] === board[i + 1] && board[i] < TOP) return true;
      if (i + SIZE < CELLS && board[i] === board[i + SIZE] && board[i] < TOP) return true;
    }
    return false;
  }

  // ---- seeded spawns

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

  // The chance that spawn number n is a sprout.
  function sproutChance(n) {
    var k = Math.min(1, Math.max(0, n - START + 1) / MOVES);
    return SPROUT + (SPROUT_END - SPROUT) * k;
  }

  /*
   * The plant that appears for spawn number n of a day (the first START are the plants a
   * round starts with, then one per move). It goes in one of the empty cells, counted row
   * by row, so the same day and the same moves always give the same garden. Returns
   * { cell, level }, or null if the bed is full.
   */
  function spawnFor(board, day, n) {
    var empty = [];
    for (var i = 0; i < CELLS; i++) if (!board[i]) empty.push(i);
    if (!empty.length) return null;
    var rand = rng(Math.imul(day, 2654435761) ^ Math.imul(n + 1, 0x85ebca6b) ^ 0x9e3779b9);
    rand(); // the first draw of a fresh generator varies little with the seed
    var cell = empty[Math.floor(rand() * empty.length)];
    return { cell: cell, level: rand() < sproutChance(n) ? 2 : 1 };
  }

  // ---- a round

  /*
   * A round in play: { day, board, score, top, moves (the swipes so far, as a string of
   * L R U D), over }. `top` is the highest level grown or planted. The score includes the
   * tidy bonus once the round is over.
   */
  function newRound(day) {
    var r = { day: day, board: [], score: 0, top: 0, moves: '', over: false };
    for (var i = 0; i < CELLS; i++) r.board.push(0);
    for (var n = 0; n < START; n++) {
      var s = spawnFor(r.board, day, n);
      r.board[s.cell] = s.level;
      r.top = Math.max(r.top, s.level);
    }
    return r;
  }

  function movesLeft(r) { return MOVES - r.moves.length; }

  /*
   * Make a swipe. Returns null if it moves nothing (it does not count) or the round is over;
   * otherwise changes the round and returns what happened: { dir, paths, merges, points,
   * spawn, newTop (true if the round's best plant went up), over, tidy }. `tidy` is the
   * bonus for the empty squares, as tidyBonus gives it, on the move that ends the round, and
   * null before; it is already in the round's score.
   */
  function move(r, dir) {
    if (r.over || DIRS.indexOf(dir) < 0) return null;
    var s = slide(r.board, dir);
    if (!s.moved) return null;
    var before = r.top;
    r.board = s.board;
    r.score += s.points;
    s.merges.forEach(function (m) { r.top = Math.max(r.top, m.level); });
    r.moves += dir;
    var sp = spawnFor(r.board, r.day, START + r.moves.length - 1);
    if (sp) {
      r.board[sp.cell] = sp.level;
      r.top = Math.max(r.top, sp.level);
    }
    r.over = r.moves.length >= MOVES || !canMove(r.board);
    var tidy = r.over ? tidyBonus(r.board) : null;
    if (tidy) r.score += tidy.points;
    return { dir: dir, paths: s.paths, merges: s.merges, points: s.points, spawn: sp, newTop: r.top > before, over: r.over, tidy: tidy };
  }

  /*
   * Play a day's round from the start with these moves. Stops early at a move that would
   * change nothing or after the round is over, so a damaged list still gives a real round.
   */
  function replay(day, moves) {
    var r = newRound(day);
    for (var i = 0; i < (moves || '').length; i++) if (!move(r, moves.charAt(i))) break;
    return r;
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

  // ---- a day's rounds, sharing and stats

  // 1,284: digits in threes, the same in every browser and in Node.
  function grouped(n) { return String(Math.floor(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ','); }

  // A copy of a saved round, with its own board.
  function copyRound(r) {
    var c = {};
    Object.keys(r).forEach(function (k) { c[k] = Array.isArray(r[k]) ? r[k].slice() : r[k]; });
    return c;
  }

  /*
   * A day's rounds as saved are a list of { id, moves, done, ... } (the page also keeps each
   * round's board, score and best plant). Two copies (from two tabs) merge by id: of two
   * copies of one round the one with more moves wins (a finished one if they are as long),
   * and a round either copy has finished is finished. Rounds only one copy has are added
   * after the others. At most ROUNDS are kept.
   */
  function mergeRounds(a, b) {
    var out = a.map(copyRound);
    b.forEach(function (r) {
      for (var i = 0; i < out.length; i++) {
        if (out[i].id !== r.id) continue;
        var mine = out[i];
        if (r.moves.length > mine.moves.length || (r.moves.length === mine.moves.length && r.done && !mine.done)) {
          out[i] = copyRound(r);
        }
        out[i].done = mine.done || r.done;
        return;
      }
      out.push(copyRound(r));
    });
    return out.slice(0, ROUNDS);
  }

  // The best score and the best plant over a list of { score, top }.
  function best(list) {
    return list.reduce(function (b, r) { return { score: Math.max(b.score, r.score), top: Math.max(b.top, r.top) }; }, { score: 0, top: 0 });
  }

  var BARS = '▁▂▃▄▅▆▇█';
  // One bar per round, its height the round's share of the best score.
  function bars(list) {
    var top = best(list).score;
    return list.map(function (r) {
      var level = top > 0 ? Math.max(1, Math.ceil(r.score / top * 8)) : 1;
      return BARS.charAt(level - 1);
    }).join('');
  }

  // The result as text: the best score with the best plant, its name, and a bar per round.
  function shareText(day, list, url) {
    var b = best(list), stage = STAGES[Math.max(1, b.top)];
    var out = ['Grow #' + day + ' ' + stage.emoji + ' ' + grouped(b.score), 'Best plant: ' + stage.name, bars(list)];
    if (url) out.push(url);
    return out.join('\n');
  }

  // How many days of figures the stats keep, so a recent day can still improve.
  var KEEP_DAYS = 60;

  function emptyStats() {
    var plants = [];
    for (var i = 0; i <= TOP; i++) plants.push(0);
    return { played: 0, total: 0, streak: 0, bestStreak: 0, best: 0, lastDay: 0, plants: plants, days: {} };
  }

  /*
   * Record a day's figures: its best score and its best plant. `days` keeps each recent
   * day's figures by day number (the last KEEP_DAYS days), and the rest are worked out from
   * them as they change: `total` is the sum of the days' best scores, for the average, the
   * streak counts days played in a row, and `plants` counts, per level, the days it was the
   * best plant.
   *
   * A day already recorded can only improve: its better figures replace the old ones in the
   * total, the best and the plants, and it is not counted or the streak advanced again. A
   * day not yet recorded counts only if it is later than the last one, so a clock set back
   * cannot add an earlier day. Returns the same object when nothing changes.
   */
  function recordResult(stats, day, score, top) {
    var days = stats.days || {}, had = days[day];
    if (!had && day <= stats.lastDay) return stats;
    if (had && score <= had.score && top <= had.top) return stats;
    var s = {
      played: stats.played, total: stats.total, streak: stats.streak, bestStreak: stats.bestStreak,
      best: Math.max(stats.best, score), lastDay: stats.lastDay, plants: stats.plants.slice(), days: {},
    };
    var now = had ? { score: Math.max(had.score, score), top: Math.max(had.top, top) } : { score: score, top: top };
    if (had) {
      s.total += now.score - had.score;
      if (had.top >= 1 && had.top <= TOP) s.plants[had.top]--;
    } else {
      s.played++;
      s.total += score;
      s.streak = stats.lastDay === day - 1 ? stats.streak + 1 : 1;
      s.bestStreak = Math.max(stats.bestStreak, s.streak);
      s.lastDay = day;
    }
    if (now.top >= 1 && now.top <= TOP) s.plants[now.top]++;
    Object.keys(days).forEach(function (d) { if (Number(d) > s.lastDay - KEEP_DAYS) s.days[d] = days[d]; });
    s.days[day] = now;
    return s;
  }

  var api = {
    SIZE: SIZE, CELLS: CELLS, MOVES: MOVES, ROUNDS: ROUNDS, START: START, SPROUT: SPROUT, SPROUT_END: SPROUT_END, TIDY: TIDY, KEEP_DAYS: KEEP_DAYS, EPOCH: EPOCH,
    STAGES: STAGES, TOP: TOP, DIRS: DIRS, DIR_NAMES: DIR_NAMES,
    points: points, tidyBonus: tidyBonus, slide: slide, canMove: canMove, rng: rng, sproutChance: sproutChance, spawnFor: spawnFor,
    newRound: newRound, move: move, movesLeft: movesLeft, replay: replay,
    dayNumber: dayNumber, msUntilTomorrow: msUntilTomorrow,
    grouped: grouped, copyRound: copyRound, mergeRounds: mergeRounds, best: best, bars: bars, shareText: shareText,
    emptyStats: emptyStats, recordResult: recordResult,
  };
  root.Grow = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
