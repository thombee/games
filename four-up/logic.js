/*
 * Four Up game rules and solver. No DOM in here: app.js draws the page, this file knows the
 * board, finds the best moves, judges the player's moves (a miss by what puzzles.js stores
 * for it) and picks Red's replies. Works as a
 * plain <script> in the browser and via require() in Node.
 *
 * The game: a four-in-a-row position part-way through a game, Yellow (the player) to move,
 * and a forced win in N of Yellow's moves to find. Red always moves first, so a position
 * with Yellow to move has an odd number of discs.
 *
 * Columns are numbered 0 to 6 from the left and rows 0 to 5 from the bottom. A game is a
 * string of column digits, one per disc, Red first.
 */
(function (root) {
  'use strict';

  var WIDTH = 7, HEIGHT = 6, CELLS = WIDTH * HEIGHT, TRIES = 3;
  // Day 1, as a local calendar date (a Friday).
  var EPOCH = { year: 2026, month: 11, day: 13 };
  // The order moves are tried and ties are broken in: centre first, then outwards, left
  // before right. Red's replies use it too, so everyone sees the same reply.
  var ORDER = [3, 2, 4, 1, 5, 0, 6];

  /*
   * Bitboards. A board is 49 bits, seven per column (six cells and an empty bit on top that
   * stops lines wrapping from one column into the next): bit col * 7 + row. JavaScript's
   * bitwise operators work on 32 bits, so each board is kept in two numbers: columns 0 to 3
   * in the low 28 bits of `lo`, columns 4 to 6 in the low 21 bits of `hi`.
   */
  var LO_BITS = 28;
  var LO_MASK = 0x0fffffff, HI_MASK = 0x1fffff;
  var BOTTOM_LO = 1 | 1 << 7 | 1 << 14 | 1 << 21, BOTTOM_HI = 1 | 1 << 7 | 1 << 14;
  var BOARD_LO = BOTTOM_LO * 0x3f, BOARD_HI = BOTTOM_HI * 0x3f;

  // The two halves of (lo, hi) shifted left or right by s bits (s < 28).
  function sll(lo, hi, s) { return (lo << s) & LO_MASK; }
  function slh(lo, hi, s) { return ((hi << s) | (lo >>> (LO_BITS - s))) & HI_MASK; }
  function srl(lo, hi, s) { return ((lo >>> s) | (hi << (LO_BITS - s))) & LO_MASK; }
  function srh(lo, hi, s) { return hi >>> s; }

  function popcount(x) {
    x = x - ((x >>> 1) & 0x55555555);
    x = (x & 0x33333333) + ((x >>> 2) & 0x33333333);
    return (((x + (x >>> 4)) & 0x0f0f0f0f) * 0x01010101) >>> 24;
  }

  // True if the stones (lo, hi) contain four in a row.
  function hasFour(lo, hi) {
    // Vertical (1), horizontal (7) and the two diagonals (6 and 8).
    for (var k = 0; k < 4; k++) {
      var s = k === 0 ? 1 : k === 1 ? 7 : k === 2 ? 6 : 8;
      var ml = lo & srl(lo, hi, s), mh = hi & (hi >>> s);
      if ((ml & srl(ml, mh, 2 * s)) | (mh & (mh >>> (2 * s)))) return true;
    }
    return false;
  }

  /*
   * The empty cells where the stones (pl, ph) would complete four in a row, given the
   * occupied cells (ml, mh). The result is left in SPOT_LO and SPOT_HI.
   */
  var SPOT_LO = 0, SPOT_HI = 0;
  function winSpots(pl, ph, ml, mh) {
    // Three stones straight below.
    var rl = sll(pl, ph, 1) & sll(pl, ph, 2) & sll(pl, ph, 3);
    var rh = slh(pl, ph, 1) & slh(pl, ph, 2) & slh(pl, ph, 3);
    // Along a row (7) and the two diagonals (6 and 8): every way a gap can sit among three stones.
    for (var k = 0; k < 3; k++) {
      var s = k === 0 ? 7 : k === 1 ? 6 : 8, s2 = 2 * s, s3 = 3 * s;
      var al = sll(pl, ph, s) & sll(pl, ph, s2), ah = slh(pl, ph, s) & slh(pl, ph, s2);
      rl |= al & sll(pl, ph, s3);
      rh |= ah & slh(pl, ph, s3);
      rl |= al & srl(pl, ph, s);
      rh |= ah & srh(pl, ph, s);
      al = srl(pl, ph, s) & srl(pl, ph, s2);
      ah = srh(pl, ph, s) & srh(pl, ph, s2);
      rl |= al & sll(pl, ph, s);
      rh |= ah & slh(pl, ph, s);
      rl |= al & srl(pl, ph, s3);
      rh |= ah & srh(pl, ph, s3);
    }
    SPOT_LO = rl & (BOARD_LO ^ ml);
    SPOT_HI = rh & (BOARD_HI ^ mh);
  }

  function colLo(c) { return c < 4 ? 0x3f << (7 * c) : 0; }
  function colHi(c) { return c < 4 ? 0 : 0x3f << (7 * (c - 4)); }

  /*
   * A position. cl/ch are the stones of the player to move, ml/mh every occupied cell, n
   * the number of discs on the board. Positions never change; play() returns a new one.
   */
  function Position(cl, ch, ml, mh, n) {
    this.cl = cl; this.ch = ch; this.ml = ml; this.mh = mh; this.n = n;
  }
  Position.prototype.canPlay = function (c) {
    return c === (c | 0) && c >= 0 && c < WIDTH && (c < 4 ? (this.ml & (1 << (7 * c + 5))) : (this.mh & (1 << (7 * (c - 4) + 5)))) === 0;
  };
  Position.prototype.play = function (c) {
    var ml = this.ml, mh = this.mh;
    if (c < 4) ml = ml | (ml + (1 << (7 * c))); else mh = mh | (mh + (1 << (7 * (c - 4))));
    return new Position(this.cl ^ this.ml, this.ch ^ this.mh, ml, mh, this.n + 1);
  };
  // True if the player to move makes four in a row by playing column c.
  Position.prototype.isWinningMove = function (c) {
    var sl = ((this.ml + BOTTOM_LO) & colLo(c)), sh = ((this.mh + BOTTOM_HI) & colHi(c));
    sl &= BOARD_LO; sh &= BOARD_HI;
    if (!(sl | sh)) return false;
    return hasFour(this.cl | sl, this.ch | sh);
  };
  // True if the player who just moved has four in a row.
  Position.prototype.lastMoverWon = function () {
    return hasFour(this.cl ^ this.ml, this.ch ^ this.mh);
  };
  Position.prototype.canWinNext = function () {
    winSpots(this.cl, this.ch, this.ml, this.mh);
    return ((SPOT_LO & (this.ml + BOTTOM_LO) & BOARD_LO) | (SPOT_HI & (this.mh + BOTTOM_HI) & BOARD_HI)) !== 0;
  };
  // A number that identifies the position (the stones of the player to move plus the occupied cells).
  Position.prototype.key = function () {
    return (this.cl + this.ml) + (this.ch + this.mh) * 268435456;
  };
  // The key of the position seen in a mirror, so a position and its mirror image can be compared.
  Position.prototype.mirrorKey = function () {
    var cl = 0, ch = 0, ml = 0, mh = 0;
    for (var c = 0; c < WIDTH; c++) {
      var m = 6 - c;
      var cb = c < 4 ? (this.cl >>> (7 * c)) & 0x7f : (this.ch >>> (7 * (c - 4))) & 0x7f;
      var mb = c < 4 ? (this.ml >>> (7 * c)) & 0x7f : (this.mh >>> (7 * (c - 4))) & 0x7f;
      if (m < 4) { cl |= cb << (7 * m); ml |= mb << (7 * m); } else { ch |= cb << (7 * (m - 4)); mh |= mb << (7 * (m - 4)); }
    }
    return (cl + ml) + (ch + mh) * 268435456;
  };
  // Number of discs in column c.
  Position.prototype.height = function (c) {
    var bits = c < 4 ? (this.ml >>> (7 * c)) & 0x3f : (this.mh >>> (7 * (c - 4))) & 0x3f;
    return popcount(bits);
  };

  var EMPTY = new Position(0, 0, 0, 0, 0);

  // The position after a string (or array) of column moves from the empty board, or null if
  // a move is not a column, goes into a full column, or comes after four in a row.
  function positionFrom(moves) {
    var p = EMPTY;
    for (var i = 0; i < moves.length; i++) {
      var c = Number(moves[i]);
      if (!(c >= 0 && c < WIDTH) || c !== Math.floor(c) || !p.canPlay(c) || (p.n && p.lastMoverWon())) return null;
      p = p.play(c);
    }
    return p;
  }

  /*
   * The moves the player to move can make without handing the opponent an immediate win,
   * as a bitboard of the cells they would fill, left in MOVE_LO and MOVE_HI. If the opponent
   * has two immediate wins, there are none.
   */
  var MOVE_LO = 0, MOVE_HI = 0;
  function nonLosingMoves(p) {
    var pl = (p.ml + BOTTOM_LO) & BOARD_LO, ph = (p.mh + BOTTOM_HI) & BOARD_HI;
    winSpots(p.cl ^ p.ml, p.ch ^ p.mh, p.ml, p.mh);
    var ol = SPOT_LO, oh = SPOT_HI;
    var fl = pl & ol, fh = ph & oh;
    if (fl | fh) {
      if (popcount(fl) + popcount(fh) > 1) { MOVE_LO = MOVE_HI = 0; return; }
      pl = fl; ph = fh;
    }
    // Never play directly under a cell where the opponent would complete four.
    MOVE_LO = pl & ~srl(ol, oh, 1);
    MOVE_HI = ph & ~(oh >>> 1);
  }

  /*
   * Scores, from the point of view of the player to move: 0 for a draw (or, in a search with
   * a depth limit, for nothing decided within it); positive for a win, larger the sooner it
   * comes (22 minus the number of discs the winner will have placed, counting the winning
   * one); negative for a loss, the same way round.
   */
  function winScore(n) { return (CELLS + 1 - n) >> 1; }
  // The number of the side to move's own moves a positive score means: 1 is win at once.
  function movesToWin(p, score) { return score > 0 ? 22 - (p.n >> 1) - score : 0; }

  /*
   * Depth-limited negamax with alpha-beta: the score of position p looking `depth` plies
   * ahead (the moves of both sides). A win or loss further away than that counts as 0. With
   * a window of (-64, 64) the score is exact.
   */
  function limited(p, depth, alpha, beta) {
    if (p.canWinNext()) return winScore(p.n);
    if (depth < 2) return 0;
    nonLosingMoves(p);
    var nl = MOVE_LO, nh = MOVE_HI;
    if (!(nl | nh)) return -((CELLS - p.n) >> 1);
    if (p.n >= CELLS - 2) return 0;
    for (var i = 0; i < WIDTH; i++) {
      var c = ORDER[i];
      if (!((nl & colLo(c)) | (nh & colHi(c)))) continue;
      var score = -limited(p.play(c), depth - 1, -beta, -alpha);
      if (score >= beta) return score;
      if (score > alpha) alpha = score;
    }
    return alpha;
  }

  // The fewest of its own moves the player to move needs to force four in a row, if that is
  // at most maxN; else 0.
  function winIn(p, maxN) {
    if (maxN < 1) return 0;
    return movesToWin(p, limited(p, 2 * maxN - 1, -64, 64));
  }

  // ---- the perfect solver: negamax with alpha-beta, a transposition table and move ordering

  var MIN_SCORE = -(CELLS >> 1) + 3, TT_SIZE = 8388593; // a prime
  var ttKeys = null, ttVals = null, nodes = 0, nodeBudget = Infinity;

  function ttInit() {
    if (!ttKeys) { ttKeys = new Float64Array(TT_SIZE); ttVals = new Int8Array(TT_SIZE); }
  }

  function negamax(p, alpha, beta) {
    if (++nodes > nodeBudget) throw new Error('over budget');
    nonLosingMoves(p);
    var nl = MOVE_LO, nh = MOVE_HI;
    if (!(nl | nh)) return -((CELLS - p.n) >> 1);
    if (p.n >= CELLS - 2) return 0;
    var min = -((CELLS - 2 - p.n) >> 1);
    if (alpha < min) { alpha = min; if (alpha >= beta) return alpha; }
    var max = (CELLS - 1 - p.n) >> 1;
    var key = p.key(), slot = key % TT_SIZE;
    // Keys are stored plus one, so the empty board (key 0) never matches an unused slot.
    if (ttKeys[slot] === key + 1) max = ttVals[slot] + MIN_SCORE - 1;
    if (beta > max) { beta = max; if (alpha >= beta) return beta; }
    // Try first the moves that leave the most cells where the mover would complete four.
    var cols = [], scores = [];
    for (var i = 0; i < WIDTH; i++) {
      var c = ORDER[i], sl = nl & colLo(c), sh = nh & colHi(c);
      if (!(sl | sh)) continue;
      winSpots(p.cl | sl, p.ch | sh, p.ml, p.mh);
      var sc = popcount(SPOT_LO) + popcount(SPOT_HI), j = cols.length;
      while (j > 0 && scores[j - 1] < sc) { cols[j] = cols[j - 1]; scores[j] = scores[j - 1]; j--; }
      cols[j] = c; scores[j] = sc;
    }
    for (var k = 0; k < cols.length; k++) {
      var score = -negamax(p.play(cols[k]), -beta, -alpha);
      if (score >= beta) return score;
      if (score > alpha) alpha = score;
    }
    ttKeys[slot] = key + 1;
    ttVals[slot] = alpha - MIN_SCORE + 1;
    return alpha;
  }

  /*
   * The exact score of position p with perfect play by both sides (or, with weak set, just
   * 1, 0 or -1 for win, draw or loss). `budget` caps the positions searched: past it the
   * answer is null. Needs a 72 MB table, so it is for Node, not for the page.
   */
  function solve(p, weak, budget) {
    if (p.canWinNext()) return weak ? 1 : winScore(p.n);
    ttInit();
    nodes = 0;
    nodeBudget = budget || Infinity;
    var min = weak ? -1 : -((CELLS - p.n) >> 1), max = weak ? 1 : (CELLS + 1 - p.n) >> 1;
    try {
      while (min < max) {
        var med = min + ((max - min) >> 1);
        if (med <= 0 && Math.trunc(min / 2) < med) med = Math.trunc(min / 2);
        else if (med >= 0 && Math.trunc(max / 2) > med) med = Math.trunc(max / 2);
        var r = negamax(p, med, med + 1);
        if (r <= med) max = r; else min = r;
      }
    } catch (e) {
      if (e.message === 'over budget') return null;
      throw e;
    } finally {
      nodeBudget = Infinity;
    }
    return (weak ? Math.sign(min) : min) | 0;
  }

  // ---- judging the player's moves and choosing Red's

  /*
   * Red's reply in position p (Red to move) when Yellow has `budget` moves left to win: the
   * move that holds out longest (an immediate win for Red if there is one, then a move that
   * escapes a win within the budget, then the one that puts Yellow's win furthest off), ties
   * going to the first column in ORDER. The page uses it only after a good move, where every
   * reply loses within the budget, so the depth-limited search sees each one to the end.
   */
  function redReply(p, budget) {
    var depth = Math.max(1, 2 * budget - 1), best = -1, bestScore = -Infinity;
    for (var i = 0; i < WIDTH; i++) {
      var c = ORDER[i];
      if (!p.canPlay(c)) continue;
      var score = p.isWinningMove(c) ? 100 : -limited(p.play(c), depth, -64, 64);
      if (score > bestScore) { best = c; bestScore = score; }
    }
    return best;
  }

  // What a miss comes to with perfect play, by the letter puzzles.js stores for it: Yellow
  // still wins, but too slowly; a draw; or Red wins.
  var MISS = { w: 'slow', d: 'draw', l: 'lost' };

  /*
   * Judges Yellow playing column c in position p, a point in a puzzle where Yellow has `budget`
   * moves left to win in. `node` is what the puzzle stores for that point (see puzzles.js):
   * two characters per column, '--' where the column is not a miss, else the miss's letter and
   * Red's best reply, both proved by the perfect solver when the puzzles were made.
   * Returns null if the column is full, else { result, reply, after, miss } where result is
   * 'win' (four in a row), 'good' (the win within the budget is still forced) or 'miss';
   * reply is Red's answer (null after a win), after the position once it is played, and miss,
   * for a miss, 'slow', 'draw' or 'lost' (else null). Throws if the stored node is missing or
   * does not fit the position, which the tests rule out for every puzzle.
   */
  function judge(p, c, budget, node) {
    if (!p.canPlay(c)) return null;
    if (p.isWinningMove(c)) return { result: 'win', reply: null, after: p.play(c), miss: null };
    if (typeof node !== 'string' || node.length !== 2 * WIDTH) throw new Error('no stored judgement for this position');
    var mid = p.play(c), code = node.substr(2 * c, 2);
    if (code === '--' && budget > 1) {
      var r = redReply(mid, budget - 1);
      return { result: 'good', reply: r, after: mid.play(r), miss: null };
    }
    var reply = Number(code.charAt(1));
    if (!MISS[code.charAt(0)] || !mid.canPlay(reply)) throw new Error('stored judgement ' + code + ' does not fit column ' + c);
    return { result: 'miss', reply: reply, after: mid.play(reply), miss: MISS[code.charAt(0)] };
  }

  /*
   * Plays a day through: the puzzle and every column Yellow has chosen today, in order,
   * across all tries. A try ends at four in a row (solved) or a miss; the board then goes
   * back to the puzzle's start for the next try.
   *
   * Returns { tries, solved, used, over, moves } where tries is a list of
   * { steps: [{ col, by: 'yellow' | 'red' }], outcome: 'solved' | 'missed' | 'playing', pos,
   * budget, miss } (pos and budget being where a try still in play stands, miss what a missed
   * try's last move came to: 'slow', 'draw' or 'lost', see judge), used is the number of
   * tries begun, and moves the columns that counted: a move that is not a column with room,
   * or comes after the day is over, is dropped.
   */
  function playDay(puzzle, moves) {
    var start = positionFrom(puzzle.moves), tries = [], solved = false, accepted = [], cur = null;
    for (var i = 0; i < moves.length; i++) {
      if (solved || (tries.length === TRIES && cur === null)) break;
      var c = moves[i];
      if (typeof c !== 'number') c = NaN;
      // The stored judgements are found by Yellow's columns so far in the try.
      var j = judge(cur ? cur.pos : start, c, cur ? cur.budget : puzzle.n, (puzzle.misses || {})[cur ? cur.path : '']);
      if (!j) continue;
      if (cur === null) {
        cur = { steps: [], outcome: 'playing', pos: start, budget: puzzle.n, path: '' };
        tries.push(cur);
      }
      accepted.push(c);
      cur.steps.push({ col: c, by: 'yellow' });
      if (j.reply !== null) cur.steps.push({ col: j.reply, by: 'red' });
      if (j.result === 'win') { cur.outcome = 'solved'; solved = true; cur = null; continue; }
      if (j.result === 'miss') { cur.outcome = 'missed'; cur.miss = j.miss; cur = null; continue; }
      cur.pos = j.after;
      cur.budget--;
      cur.path += c;
    }
    var out = tries.map(function (t) { return { steps: t.steps, outcome: t.outcome, pos: t.pos, budget: t.budget, miss: t.miss || null }; });
    var finishedTries = out.filter(function (t) { return t.outcome !== 'playing'; }).length;
    return {
      tries: out, solved: solved, used: out.length, moves: accepted,
      over: solved || finishedTries >= TRIES,
    };
  }

  /*
   * The winning line from the puzzle's start: Yellow's fastest move each time (ties to the
   * first column in ORDER) and Red's reply to each, as a list of columns.
   */
  function solutionLine(puzzle) {
    var p = positionFrom(puzzle.moves), budget = puzzle.n, line = [];
    while (budget > 0) {
      var best = -1, bestN = Infinity;
      for (var i = 0; i < WIDTH; i++) {
        var c = ORDER[i];
        if (!p.canPlay(c)) continue;
        var n = p.isWinningMove(c) ? 1 : 1 + winInAfter(p.play(c), budget - 1);
        if (n < bestN) { best = c; bestN = n; }
      }
      line.push(best);
      if (p.isWinningMove(best)) return line;
      var mid = p.play(best), reply = redReply(mid, budget - 1);
      line.push(reply);
      p = mid.play(reply);
      budget--;
    }
    return line;
  }
  // Yellow's fewest moves to win after Red, to move in p, replies as well as possible; Infinity if not within maxN.
  function winInAfter(p, maxN) {
    if (maxN < 1 || p.n >= CELLS) return Infinity;
    var s = -limited(p, 2 * maxN, -64, 64);
    if (s <= 0) return Infinity;
    return 22 - ((p.n + 1) >> 1) - s;
  }

  // ---- reading the board for drawing

  // The board as rows of cells, bottom row first: 'red', 'yellow' or ''. moves is a string or array.
  function grid(moves) {
    var g = [], heights = [0, 0, 0, 0, 0, 0, 0];
    for (var r = 0; r < HEIGHT; r++) g.push(['', '', '', '', '', '', '']);
    for (var i = 0; i < moves.length; i++) {
      var c = Number(moves[i]);
      g[heights[c]++][c] = i % 2 === 0 ? 'red' : 'yellow';
    }
    return g;
  }

  // The four (or more) cells in a line through (col, row), as [col, row] pairs, or [] if none.
  function lineThrough(g, col, row) {
    var who = g[row][col];
    if (!who) return [];
    var dirs = [[1, 0], [0, 1], [1, 1], [1, -1]];
    for (var d = 0; d < dirs.length; d++) {
      var cells = [[col, row]];
      for (var sgn = -1; sgn <= 1; sgn += 2) {
        var c = col + sgn * dirs[d][0], r = row + sgn * dirs[d][1];
        while (c >= 0 && c < WIDTH && r >= 0 && r < HEIGHT && g[r][c] === who) {
          cells.push([c, r]);
          c += sgn * dirs[d][0];
          r += sgn * dirs[d][1];
        }
      }
      if (cells.length >= 4) return cells;
    }
    return [];
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
  // The day of the week of a day number: 0 is Sunday.
  function weekday(day) {
    var first = new Date(Date.UTC(EPOCH.year, EPOCH.month - 1, EPOCH.day)).getUTCDay();
    return (((first + day - 1) % 7) + 7) % 7;
  }
  // The puzzle for a day number (1 and up). The schedule repeats when it runs out.
  function puzzleFor(day, bank) {
    var i = ((day - 1) % bank.schedule.length + bank.schedule.length) % bank.schedule.length;
    return bank.puzzles[bank.schedule[i]];
  }

  // ---- sharing and stats

  // The result as text: which try solved it and a square per try, and nothing about the moves.
  function shareText(day, result, url) {
    var squares = result.tries.map(function (t) { return t.outcome === 'solved' ? '🟩' : '🟥'; }).join('');
    var out = ['Four Up #' + day + ' 🟡 ' + (result.solved ? 'solved on try ' + result.used : 'not solved'), squares];
    if (url) out.push(url);
    return out.join('\n');
  }

  function emptyStats() {
    return { played: 0, solved: 0, streak: 0, best: 0, lastDay: 0, dist: [0, 0, 0] };
  }

  /*
   * Record a finished day. `tryUsed` is 1 to 3 for a solve, 0 for a day not solved. The
   * streak counts days played in a row, solved or not. A day that is not later than the last
   * one recorded changes nothing, so a clock set back cannot count a day twice.
   */
  function recordResult(stats, day, tryUsed) {
    if (day <= stats.lastDay) return stats;
    var s = { played: stats.played + 1, solved: stats.solved + (tryUsed ? 1 : 0), dist: stats.dist.slice(), lastDay: day };
    s.streak = stats.lastDay === day - 1 ? stats.streak + 1 : 1;
    s.best = Math.max(stats.best, s.streak);
    if (tryUsed) s.dist[tryUsed - 1]++;
    return s;
  }

  var api = {
    WIDTH: WIDTH, HEIGHT: HEIGHT, TRIES: TRIES, EPOCH: EPOCH, ORDER: ORDER,
    Position: Position, EMPTY: EMPTY, positionFrom: positionFrom,
    limited: function (p, depth, alpha, beta) { return limited(p, depth, alpha, beta) | 0; }, winIn: winIn, solve: solve, movesToWin: movesToWin,
    redReply: redReply, judge: judge, playDay: playDay, solutionLine: solutionLine,
    grid: grid, lineThrough: lineThrough,
    dayNumber: dayNumber, msUntilTomorrow: msUntilTomorrow, weekday: weekday, puzzleFor: puzzleFor,
    shareText: shareText, emptyStats: emptyStats, recordResult: recordResult,
  };
  root.FourUp = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
