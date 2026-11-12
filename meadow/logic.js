/*
 * Meadow game rules. No DOM in here: app.js draws the page, this file holds the board,
 * the moves, the search, the daily schedule, scoring, share text and stats. Works as a
 * plain <script> in the browser and via require() in Node.
 *
 * The game: a sliding-block puzzle on a 6 by 6 yard. One animal, two cells wide on the
 * third row, has to reach the gate on the right-hand edge of that row. Every other piece
 * slides only along its own length. One slide of one piece, any distance, is one move.
 */
(function (root) {
  'use strict';

  var SIZE = 6;
  var EXIT_ROW = 2;
  // The animal's column (its left-hand cell) when it stands in the gate.
  var GOAL = SIZE - 2;
  // Day 1, as a local calendar date. It is a Friday.
  var EPOCH = { year: 2026, month: 11, day: 13 };
  // The fewest moves each weekday's puzzle needs, Monday first: [at least, at most].
  var PAR_BY_WEEKDAY = [[6, 9], [9, 12], [11, 14], [13, 17], [15, 20], [18, 24], [20, 30]];
  // The first week is a gentle ramp, whatever the weekday: day 1's par, day 2's, and so on.
  // The weekday ranges apply from the day after.
  var OPENING_PARS = [6, 7, 8, 9, 10, 12, 14];
  var WEEKDAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

  // The animals, in the order they take turns, one a day.
  var ANIMALS = [
    { id: 'pig', name: 'pig', emoji: '🐖' },
    { id: 'cow', name: 'cow', emoji: '🐄' },
    { id: 'hen', name: 'hen', emoji: '🐔' },
    { id: 'sheep', name: 'sheep', emoji: '🐑' },
    { id: 'goat', name: 'goat', emoji: '🐐' },
    { id: 'duck', name: 'duck', emoji: '🦆' },
    { id: 'turkey', name: 'turkey', emoji: '🦃' },
    { id: 'donkey', name: 'donkey', emoji: '🫏' },
    { id: 'rabbit', name: 'rabbit', emoji: '🐇' },
    { id: 'goose', name: 'goose', emoji: '🪿' },
  ];

  var NAMES = [
    'Rosie', 'Daisy', 'Clover', 'Pip', 'Hazel', 'Biscuit', 'Maple', 'Juniper', 'Poppy', 'Bramble',
    'Willow', 'Pickle', 'Mabel', 'Otis', 'Tilly', 'Nutmeg', 'Barnaby', 'Fern', 'Honey', 'Percy',
    'Lulu', 'Basil', 'Marigold', 'Teddy', 'Wren', 'Dolly', 'Ziggy', 'Bonnie', 'Alfie', 'Peaches',
    'Winston', 'Olive', 'Hector', 'Bluebell', 'Rufus', 'Penny', 'Gus', 'Primrose', 'Milo', 'Ruby',
    'Pumpkin', 'Sage', 'Bertie', 'Lottie', 'Murphy', 'Iris', 'Toffee', 'Florence', 'Ned', 'Button',
    'Coco', 'Archie', 'Mittens', 'Violet', 'Dougal', 'Freya', 'Bean', 'Harriet', 'Moss', 'Sunny',
    'Wilbur', 'Ginger', 'Rocket', 'Matilda',
  ];
  // Names are dealt in a fixed order that visits every name once before any repeats.
  var NAME_STEP = 23;

  // ---- the board

  /*
   * A board is a 36-character string, row by row from the top left: '.' for an empty
   * cell, 'A' for the animal and another capital letter for each other piece. Each piece
   * is a straight run of two or three cells.
   *
   * Returns { board, pieces, radix, mult, start } where pieces[0] is the animal. Each
   * piece is { id, len, horiz, line }: line is its row if it lies across, else its column.
   * A position is an array with one number per piece: the column of its left-hand cell if
   * it lies across, else the row of its top cell. Throws on a malformed board.
   */
  function parseBoard(board) {
    if (typeof board !== 'string' || board.length !== SIZE * SIZE || /[^.A-Z]/.test(board)) throw new Error('bad board: ' + board);
    var cells = {};
    for (var i = 0; i < board.length; i++) {
      var ch = board[i];
      if (ch !== '.') (cells[ch] = cells[ch] || []).push(i);
    }
    var ids = Object.keys(cells).sort();
    if (ids[0] !== 'A') throw new Error('no animal: ' + board);
    // The search packs a piece number into four bits.
    if (ids.length > 16) throw new Error('more than 16 pieces: ' + board);
    var pieces = [], start = [];
    ids.forEach(function (id) {
      var c = cells[id], len = c.length, r = Math.floor(c[0] / SIZE), col = c[0] % SIZE;
      var horiz = len > 1 && c[1] === c[0] + 1;
      if (len < 2 || len > 3) throw new Error('piece ' + id + ' is ' + len + ' cells: ' + board);
      for (var k = 1; k < len; k++) {
        var want = horiz ? c[0] + k : c[0] + k * SIZE;
        if (c[k] !== want || (horiz && Math.floor(want / SIZE) !== r)) throw new Error('piece ' + id + ' is not straight: ' + board);
      }
      pieces.push({ id: id, len: len, horiz: horiz, line: horiz ? r : col });
      start.push(horiz ? col : r);
    });
    var a = pieces[0];
    if (!a.horiz || a.len !== 2 || a.line !== EXIT_ROW) throw new Error('the animal must lie across the third row: ' + board);
    // Positions are packed into one number: piece i's position times mult[i], summed.
    var radix = [], mult = [], m = 1;
    pieces.forEach(function (p) { radix.push(SIZE - p.len + 1); mult.push(m); m *= SIZE - p.len + 1; });
    return { board: board, pieces: pieces, radix: radix, mult: mult, start: start };
  }

  // The cells a piece covers at a position, as indexes 0 to 35.
  function cellsOf(piece, at) {
    var out = [];
    for (var k = 0; k < piece.len; k++) out.push(piece.horiz ? piece.line * SIZE + at + k : (at + k) * SIZE + piece.line);
    return out;
  }

  // Fill `grid` (36 cells) with piece index + 1 for every covered cell, 0 for empty ones.
  function fillGrid(pz, pos, grid) {
    grid.fill(0);
    for (var i = 0; i < pz.pieces.length; i++) {
      var p = pz.pieces[i], at = pos[i];
      for (var k = 0; k < p.len; k++) grid[p.horiz ? p.line * SIZE + at + k : (at + k) * SIZE + p.line] = i + 1;
    }
    return grid;
  }
  function gridOf(pz, pos) { return fillGrid(pz, pos, new Uint8Array(SIZE * SIZE)); }

  // How far piece i can slide from where it is: { min, max } positions along its line.
  function reach(pz, pos, i, grid) {
    var p = pz.pieces[i], at = pos[i], g = grid || gridOf(pz, pos), lo = at, hi = at;
    var cell = p.horiz ? function (x) { return p.line * SIZE + x; } : function (x) { return x * SIZE + p.line; };
    while (lo > 0 && !g[cell(lo - 1)]) lo--;
    while (hi + p.len < SIZE && !g[cell(hi + p.len)]) hi++;
    return { min: lo, max: hi };
  }

  // The position after sliding piece i to `to`, or null if anything is in the way.
  function slide(pz, pos, i, to) {
    if (!(i >= 0 && i < pz.pieces.length) || !Number.isInteger(to) || to === pos[i]) return null;
    var r = reach(pz, pos, i);
    if (to < r.min || to > r.max) return null;
    var out = pos.slice();
    out[i] = to;
    return out;
  }

  function isSolved(pos) { return pos[0] === GOAL; }

  function keyOf(pz, pos) {
    var k = 0;
    for (var i = 0; i < pos.length; i++) k += pos[i] * pz.mult[i];
    return k;
  }
  function decode(pz, key, pos) {
    for (var i = 0; i < pz.pieces.length; i++) {
      var r = pz.radix[i], d = key % r;
      pos[i] = d;
      key = (key - d) / r;
    }
    return pos;
  }

  /*
   * Call fn(i, to, key) for every move from the position `pos` (whose packed key is `key`):
   * piece i slides to `to`, giving the position with packed key `key`. `grid` is scratch
   * space for 36 cells.
   */
  function forEachMove(pz, pos, key, grid, fn) {
    fillGrid(pz, pos, grid);
    for (var i = 0; i < pz.pieces.length; i++) {
      var p = pz.pieces[i], at = pos[i], m = pz.mult[i], x;
      if (p.horiz) {
        var row = p.line * SIZE;
        for (x = at - 1; x >= 0 && !grid[row + x]; x--) fn(i, x, key + (x - at) * m);
        for (x = at + p.len; x < SIZE && !grid[row + x]; x++) fn(i, x - p.len + 1, key + (x - p.len + 1 - at) * m);
      } else {
        var col = p.line;
        for (x = at - 1; x >= 0 && !grid[x * SIZE + col]; x--) fn(i, x, key + (x - at) * m);
        for (x = at + p.len; x < SIZE && !grid[x * SIZE + col]; x++) fn(i, x - p.len + 1, key + (x - p.len + 1 - at) * m);
      }
    }
  }

  /*
   * A set of positions, each held by its packed key and numbered in the order it was added.
   * It is an open-addressing hash table on typed arrays, which is several times quicker than
   * a Map for keys this large; it keeps the search for a hint fast on a phone.
   */
  function PositionSet() {
    this.size = 0;
    this.keys = new Float64Array(1024);
    this.slots = new Int32Array(4096).fill(-1);
  }
  // Add a key. Returns its number, or -1 if it was already in the set.
  PositionSet.prototype.add = function (key) {
    var slots = this.slots, mask = slots.length - 1;
    var h = Math.imul((key >>> 0) ^ Math.imul((key / 4294967296) | 0, 0x9e3779b1), 0x85ebca6b);
    for (var s = (h ^ (h >>> 15)) & mask; slots[s] >= 0; s = (s + 1) & mask) if (this.keys[slots[s]] === key) return -1;
    if (this.size === this.keys.length) {
      var keys = new Float64Array(this.size * 2);
      keys.set(this.keys);
      this.keys = keys;
    }
    var n = this.size++;
    this.keys[n] = key;
    slots[s] = n;
    if (this.size * 2 > slots.length) this.grow();
    return n;
  };
  PositionSet.prototype.grow = function () {
    var slots = new Int32Array(this.slots.length * 2).fill(-1), mask = slots.length - 1;
    for (var n = 0; n < this.size; n++) {
      var key = this.keys[n], h = Math.imul((key >>> 0) ^ Math.imul((key / 4294967296) | 0, 0x9e3779b1), 0x85ebca6b);
      var s = (h ^ (h >>> 15)) & mask;
      while (slots[s] >= 0) s = (s + 1) & mask;
      slots[s] = n;
    }
    this.slots = slots;
  };
  PositionSet.prototype.indexOf = function (key) {
    var slots = this.slots, mask = slots.length - 1;
    var h = Math.imul((key >>> 0) ^ Math.imul((key / 4294967296) | 0, 0x9e3779b1), 0x85ebca6b);
    for (var s = (h ^ (h >>> 15)) & mask; slots[s] >= 0; s = (s + 1) & mask) if (this.keys[slots[s]] === key) return slots[s];
    return -1;
  };

  /*
   * The fewest moves from `pos` to the gate, by breadth-first search over positions:
   * a list of moves [piece, to], empty if the animal is already in the gate, or null if
   * it can never get there.
   *
   * This is the search behind hints, so it is written for speed: each position reached is
   * kept as a row of bytes (one per piece) as well as by its packed key, so nothing has to
   * be unpacked, and the moves are worked out in line rather than through forEachMove.
   */
  function solve(pz, pos) {
    if (isSolved(pos)) return [];
    var n = pz.pieces.length, mult = pz.mult, grid = new Uint8Array(SIZE * SIZE);
    var lens = [], across = [], lines = [];
    for (var i = 0; i < n; i++) { lens.push(pz.pieces[i].len); across.push(pz.pieces[i].horiz); lines.push(pz.pieces[i].line); }
    var seen = new PositionSet(), rows = new Int8Array(1024 * n);
    // For each position reached: the number of the position it was reached from, and the move (piece * 8 + to).
    var from = [-1], how = [0], found = -1;
    seen.add(keyOf(pz, pos));
    for (i = 0; i < n; i++) rows[i] = pos[i];
    for (var head = 0; head < seen.size && found < 0; head++) {
      var base = head * n, key = seen.keys[head], k, x, at, len, cell, step, m;
      grid.fill(0);
      for (i = 0; i < n; i++) {
        at = rows[base + i];
        cell = across[i] ? lines[i] * SIZE + at : at * SIZE + lines[i];
        step = across[i] ? 1 : SIZE;
        for (k = 0; k < lens[i]; k++) grid[cell + k * step] = 1;
      }
      for (i = 0; i < n && found < 0; i++) {
        at = rows[base + i];
        len = lens[i];
        m = mult[i];
        // Cells along the piece's line are line * SIZE + x across, or x * SIZE + line upright.
        var first = across[i] ? lines[i] * SIZE : lines[i], stride = across[i] ? 1 : SIZE;
        for (x = at - 1; x >= 0 && !grid[first + x * stride]; x--) if (reached(i, x)) break;
        for (x = at + len; x < SIZE && found < 0 && !grid[first + x * stride]; x++) if (reached(i, x - len + 1)) break;
      }
    }
    // Piece i slid to `to` from the position being looked at; true once the animal is out.
    function reached(i, to) {
      var next = seen.add(key + (to - at) * m);
      if (next < 0) return false;
      if (rows.length < (next + 1) * n) {
        var bigger = new Int8Array(rows.length * 2);
        bigger.set(rows);
        rows = bigger;
      }
      for (var j = 0; j < n; j++) rows[next * n + j] = rows[base + j];
      rows[next * n + i] = to;
      from.push(head);
      how.push(i * 8 + to);
      if (i === 0 && to === GOAL) { found = next; return true; }
      return false;
    }
    if (found < 0) return null;
    var moves = [];
    for (var f = found; f > 0; f = from[f]) moves.push([how[f] >> 3, how[f] & 7]);
    return moves.reverse();
  }

  // The first move of a shortest way to the gate: { piece, to, dir }, or null if there is none.
  function hint(pz, pos) {
    var path = solve(pz, pos);
    if (!path || !path.length) return null;
    var i = path[0][0], to = path[0][1], p = pz.pieces[i];
    return { piece: i, to: to, dir: p.horiz ? (to > pos[i] ? 'right' : 'left') : (to > pos[i] ? 'down' : 'up') };
  }

  /*
   * Every position reachable from `pos`, with each one's fewest moves to the gate, by the
   * same search. Returns null if there are more than `limit` positions. Otherwise
   * { keys, dist, most } where dist[j] is the fewest moves from keys[j] (-1 if the gate
   * cannot be reached from there) and `most` the largest of them.
   */
  function explore(pz, pos, limit) {
    var n = pz.pieces.length, cur = new Array(n), grid = new Uint8Array(SIZE * SIZE);
    var seen = new PositionSet(), edges = [], goals = [];
    seen.add(keyOf(pz, pos));
    for (var head = 0; head < seen.size; head++) {
      if (seen.size > limit) return null;
      var key = seen.keys[head], out = [];
      decode(pz, key, cur);
      if (isSolved(cur)) goals.push(head);
      forEachMove(pz, cur, key, grid, function (i, to, next) {
        var j = seen.add(next);
        out.push(j < 0 ? seen.indexOf(next) : j);
      });
      edges.push(out);
    }
    var keys = seen.keys.subarray(0, seen.size);
    // Moves can always be undone, so distances to the gate spread out from the solved positions.
    var dist = new Int16Array(keys.length).fill(-1), queue = goals.slice(), most = -1;
    goals.forEach(function (g) { dist[g] = 0; });
    for (var q = 0; q < queue.length; q++) {
      var d = dist[queue[q]] + 1;
      edges[queue[q]].forEach(function (j) { if (dist[j] < 0) { dist[j] = d; queue.push(j); } });
    }
    for (var j = 0; j < dist.length; j++) if (dist[j] > most) most = dist[j];
    return { keys: keys, dist: dist, most: most };
  }

  // The board string for a position, with the pieces lettered as in the puzzle.
  function boardAt(pz, pos) {
    var out = new Array(SIZE * SIZE).fill('.');
    pz.pieces.forEach(function (p, i) { cellsOf(p, pos[i]).forEach(function (c) { out[c] = p.id; }); });
    return out.join('');
  }

  /*
   * The board for a position with each piece drawn by its shape rather than its letter:
   * 'A' for the animal, 'h' or 'H' for a two- or three-cell piece lying across, 'v' or 'V'
   * for one standing up. Two positions that look the same give the same string.
   */
  function shapeAt(pz, pos) {
    var out = new Array(SIZE * SIZE).fill('.');
    pz.pieces.forEach(function (p, i) {
      var ch = i === 0 ? 'A' : (p.horiz ? 'h' : 'v');
      if (i && p.len === 3) ch = ch.toUpperCase();
      cellsOf(p, pos[i]).forEach(function (c) { out[c] = ch; });
    });
    return out.join('');
  }

  // Which cells hold something other than the animal, as a list of 36 booleans.
  function blockers(board) {
    return board.split('').map(function (ch) { return ch !== '.' && ch !== 'A'; });
  }
  /*
   * How different two boards look: the number of cells where one has a piece (other than
   * the animal) and the other does not, compared both as they are and with the second
   * board flipped top to bottom, whichever is smaller.
   */
  function boardDifference(a, b) {
    var x = blockers(a), y = blockers(b), same = 0, flipped = 0;
    for (var i = 0; i < x.length; i++) {
      var r = Math.floor(i / SIZE), c = i % SIZE;
      if (x[i] !== y[i]) same++;
      if (x[i] !== y[(SIZE - 1 - r) * SIZE + c]) flipped++;
    }
    return Math.min(same, flipped);
  }

  /*
   * What each piece is drawn as: 'animal' for the first, and for the rest 'hay' or 'trough'
   * (two cells) and 'log' or 'tractor' (three cells). A board has at most one trough and
   * one tractor, chosen from the board itself so they stay put across reloads.
   */
  function pieceKinds(pz) {
    var h = 0;
    for (var i = 0; i < pz.board.length; i++) h = (Math.imul(h, 31) + pz.board.charCodeAt(i)) | 0;
    h = h >>> 0;
    var twos = [], threes = [];
    pz.pieces.forEach(function (p, j) { if (j) (p.len === 2 ? twos : threes).push(j); });
    var kinds = pz.pieces.map(function (p, j) { return j === 0 ? 'animal' : p.len === 2 ? 'hay' : 'log'; });
    if (twos.length > 1) kinds[twos[h % twos.length]] = 'trough';
    if (threes.length) kinds[threes[(h >>> 8) % threes.length]] = 'tractor';
    return kinds;
  }

  // ---- moves made by the player

  /*
   * Add a slide of piece i from `from` to `to` to the list of moves made so far, each
   * [piece, from, to]. Sliding the piece moved last again only extends that move, since
   * one slide of one piece, any distance, is one move; if it ends where it began, the move
   * is gone. Returns a new list.
   */
  function addMove(moves, i, from, to) {
    var out = moves.slice(), last = out[out.length - 1];
    if (last && last[0] === i) {
      out[out.length - 1] = [i, last[1], to];
      if (last[1] === to) out.pop();
    } else if (from !== to) {
      out.push([i, from, to]);
    }
    return out;
  }

  /*
   * The position after a list of moves from the start, or null if one of them is not a
   * legal slide from where the piece then is.
   */
  function replay(pz, moves) {
    var pos = pz.start.slice();
    for (var k = 0; k < moves.length; k++) {
      var m = moves[k];
      if (!Array.isArray(m) || m.length !== 3 || pos[m[0]] !== m[1] || isSolved(pos)) return null;
      pos = slide(pz, pos, m[0], m[2]);
      if (!pos) return null;
    }
    return pos;
  }

  // ---- the calendar and the schedule

  function dayNumber(date) {
    var d = date || new Date();
    var ms = Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) - Date.UTC(EPOCH.year, EPOCH.month - 1, EPOCH.day);
    return Math.round(ms / 864e5) + 1;
  }
  function msUntilTomorrow(date) {
    var d = date || new Date();
    return new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1).getTime() - d.getTime();
  }
  // The weekday of a day number, 0 for Monday to 6 for Sunday.
  function weekday(day) {
    return (new Date(EPOCH.year, EPOCH.month - 1, EPOCH.day + day - 1).getDay() + 6) % 7;
  }

  /*
   * Day `day`'s puzzle from the bank: { board, par }. The bank is laid out as a schedule
   * from day 1: first the opening week, one entry for each of OPENING_PARS, then a whole
   * number of weeks. When it runs out it starts again from the first day after the opening
   * week, so each puzzle keeps its weekday.
   */
  function puzzleFor(day, bank) {
    var open = OPENING_PARS.length, cycle = bank.length - open, i;
    if (day >= 1 && day <= open) i = day - 1;
    else i = open + ((((day - open - 1) % cycle) + cycle) % cycle);
    var e = bank[i];
    return { board: e[0], par: e[1] };
  }
  // The pars day `day` may have: [at least, at most].
  function parRange(day) {
    if (day >= 1 && day <= OPENING_PARS.length) return [OPENING_PARS[day - 1], OPENING_PARS[day - 1]];
    return PAR_BY_WEEKDAY[weekday(day)].slice();
  }
  function animalFor(day) { return ANIMALS[(((day - 1) % ANIMALS.length) + ANIMALS.length) % ANIMALS.length]; }
  function nameFor(day) { return NAMES[(((day - 1) * NAME_STEP % NAMES.length) + NAMES.length) % NAMES.length]; }
  // The fact for the day: an animal's facts are shown in turn, one each time it comes round.
  function factFor(day, facts) {
    var list = facts[animalFor(day).id], turn = Math.floor((day - 1) / ANIMALS.length);
    return list[((turn % list.length) + list.length) % list.length];
  }

  // ---- scoring, sharing and stats

  // Three stars for par or better, two for up to one and a half times par, one otherwise.
  function stars(moves, par) {
    if (moves <= par) return 3;
    if (moves <= par * 1.5) return 2;
    return 1;
  }

  // result is { moves, par, hinted }.
  function shareText(day, result, url) {
    var head = 'Meadow #' + day + ' ' + animalFor(day).emoji + ' ' + '⭐'.repeat(stars(result.moves, result.par)) + (result.hinted ? ' 💡' : '');
    var out = [head, result.moves + (result.moves === 1 ? ' move' : ' moves') + ' (par ' + result.par + ')'];
    if (url) out.push(url);
    return out.join('\n');
  }

  // dist[k] counts the days that earned k + 1 stars.
  function emptyStats() { return { played: 0, streak: 0, best: 0, lastDay: 0, dist: [0, 0, 0] }; }

  /*
   * Record a finished day. The streak counts days played in a row. A day that is not later
   * than the last one recorded changes nothing, so a clock set back cannot count a day twice.
   */
  function recordResult(stats, day, starCount) {
    if (day <= stats.lastDay) return stats;
    var s = { played: stats.played + 1, dist: stats.dist.slice(), lastDay: day };
    s.streak = stats.lastDay === day - 1 ? stats.streak + 1 : 1;
    s.best = Math.max(stats.best, s.streak);
    s.dist[starCount - 1]++;
    return s;
  }

  // A small seeded random number generator (mulberry32), for the puzzle generator.
  function rng(seed) {
    var s = seed >>> 0;
    return function () {
      s = (s + 0x6d2b79f5) | 0;
      var t = Math.imul(s ^ (s >>> 15), 1 | s);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  var api = {
    SIZE: SIZE, EXIT_ROW: EXIT_ROW, GOAL: GOAL, EPOCH: EPOCH, PAR_BY_WEEKDAY: PAR_BY_WEEKDAY, OPENING_PARS: OPENING_PARS, WEEKDAYS: WEEKDAYS,
    ANIMALS: ANIMALS, NAMES: NAMES, NAME_STEP: NAME_STEP,
    parseBoard: parseBoard, cellsOf: cellsOf, gridOf: gridOf, reach: reach, slide: slide, isSolved: isSolved,
    keyOf: keyOf, decode: decode, forEachMove: forEachMove, solve: solve, hint: hint, explore: explore,
    boardAt: boardAt, shapeAt: shapeAt, boardDifference: boardDifference, pieceKinds: pieceKinds,
    addMove: addMove, replay: replay,
    dayNumber: dayNumber, msUntilTomorrow: msUntilTomorrow, weekday: weekday,
    puzzleFor: puzzleFor, parRange: parRange, animalFor: animalFor, nameFor: nameFor, factFor: factFor,
    stars: stars, shareText: shareText, emptyStats: emptyStats, recordResult: recordResult, rng: rng,
  };
  root.Meadow = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
