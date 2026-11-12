/*
 * Reunion game rules. No DOM in here: app.js draws the page, this file knows the puzzles,
 * edits paths, checks completion, solves puzzles and keeps the stats. Works as a plain
 * <script> in the browser and via require() in Node.
 *
 * The game: a square paddock of n by n squares holds pairs of matching animals. The player
 * draws a path from each animal to its partner, moving up, down, left or right. Paths never
 * cross or share a square, and every square ends up on a path.
 */
(function (root) {
  'use strict';

  // Day 1, as a local calendar date: Friday 13 November 2026.
  var EPOCH = { year: 2026, month: 11, day: 13 };
  // The first days of the schedule, played whatever the weekday, before the weekly plan starts.
  var INTRO_DAYS = 3;

  // The animals, in the order the bank's pair letters are given them before the day's shuffle.
  // The sheepdog and the barn cat only join puzzles with BIG_PAIRS pairs or more.
  var ANIMALS = [
    { id: 'pig', name: 'pig', emoji: '🐷' },
    { id: 'cow', name: 'cow', emoji: '🐮' },
    { id: 'sheep', name: 'sheep', emoji: '🐑' },
    { id: 'hen', name: 'hen', emoji: '🐔' },
    { id: 'goat', name: 'goat', emoji: '🐐' },
    { id: 'duck', name: 'duck', emoji: '🦆' },
    { id: 'turkey', name: 'turkey', emoji: '🦃' },
    { id: 'donkey', name: 'donkey', emoji: '🫏' },
    { id: 'rabbit', name: 'rabbit', emoji: '🐰' },
    { id: 'goose', name: 'goose', emoji: '🪿' },
    { id: 'dog', name: 'sheepdog', emoji: '🐕' },
    { id: 'cat', name: 'barn cat', emoji: '🐈' },
  ];
  var BIG_PAIRS = 7;
  // Path colours by palette index (the values live in style.css as --ru-path-N).
  var PALETTE = ['red', 'orange', 'yellow', 'green', 'teal', 'blue', 'purple', 'pink', 'brown', 'grey'];

  // How hard a puzzle feels, by rating (see rate()).
  var DIFFICULTY = [null, 'gentle', 'medium', 'tricky', 'hard'];
  // The weekly plan, Monday first: [paddock size, difficulty, fewest pairs, most pairs].
  var WEEK = [[5, 'gentle', 4, 5], [6, 'gentle', 5, 6], [6, 'medium', 5, 6], [7, 'medium', 6, 7], [7, 'tricky', 6, 7], [8, 'tricky', 7, 9], [8, 'hard', 7, 9]];
  var INTRO = [5, 'gentle', 4, 5];
  var SIZES = [5, 6, 7, 8];

  // ---- the grid

  function rowOf(n, i) { return Math.floor(i / n); }
  // The squares beside square i: up, down, left, right (those that exist).
  function sides(n, i) {
    var r = Math.floor(i / n), c = i % n, out = [];
    if (r > 0) out.push(i - n);
    if (r < n - 1) out.push(i + n);
    if (c > 0) out.push(i - 1);
    if (c < n - 1) out.push(i + 1);
    return out;
  }
  function adjacent(n, a, b) {
    var d = Math.abs(a - b);
    return d === n || (d === 1 && Math.floor(a / n) === Math.floor(b / n));
  }

  /*
   * The squares a straight line crosses, from (x0, y0) to (x1, y1) in square units (square
   * (r, c) covers x from c to c+1 and y from r to r+1), in order, each beside the one before.
   * A line through a corner exactly goes round it by the side square it is nearer, so a fast
   * finger that cuts a corner still gives a path square by square.
   */
  function cellsAlong(n, x0, y0, x1, y1) {
    var clamp = function (v) { return Math.min(n - 1e-9, Math.max(0, v)); };
    x0 = clamp(x0); y0 = clamp(y0); x1 = clamp(x1); y1 = clamp(y1);
    var c = Math.floor(x0), r = Math.floor(y0), c1 = Math.floor(x1), r1 = Math.floor(y1);
    var out = [r * n + c], dx = x1 - x0, dy = y1 - y0;
    var sx = dx > 0 ? 1 : -1, sy = dy > 0 ? 1 : -1;
    var tdx = dx ? Math.abs(1 / dx) : Infinity, tdy = dy ? Math.abs(1 / dy) : Infinity;
    var tx = dx ? ((sx > 0 ? c + 1 - x0 : x0 - c) * tdx) : Infinity;
    var ty = dy ? ((sy > 0 ? r + 1 - y0 : y0 - r) * tdy) : Infinity;
    for (var guard = 0; (c !== c1 || r !== r1) && guard < 4 * n; guard++) {
      if (tx < ty || (tx === ty && Math.abs(dx) >= Math.abs(dy))) { c += sx; tx += tdx; }
      else { r += sy; ty += tdy; }
      out.push(r * n + c);
    }
    return out;
  }

  // ---- puzzles

  /*
   * A puzzle as stored in puzzles.js: "n|grid|rating". grid has a letter for each square in
   * reading order, the letter of the pair whose path covers it in the solution; the two
   * animals of each pair are in capitals. Pairs are lettered in the order the step-by-step
   * solver joins them, so a hint takes the earliest pair not yet drawn right.
   *
   * Decoded: { n, k, ends: [[a, b] per pair], solution: [path per pair], rating, grid }
   * where each path is a list of squares from a to b, and a comes before b in reading order.
   */
  function decode(text) {
    var parts = String(text).split('|'), n = Number(parts[0]), grid = parts[1];
    var k = 0, ends = [], i;
    for (i = 0; i < grid.length; i++) k = Math.max(k, grid.toLowerCase().charCodeAt(i) - 96);
    for (i = 0; i < k; i++) ends.push([]);
    for (i = 0; i < grid.length; i++) if (grid[i] !== grid[i].toLowerCase()) ends[grid.charCodeAt(i) - 65].push(i);
    var lower = grid.toLowerCase(), solution = ends.map(function (e, p) { return tracePath(n, lower, String.fromCharCode(97 + p), e[0], e[1]); });
    return { n: n, k: k, ends: ends, solution: solution, rating: Number(parts[2]), grid: grid };
  }
  function encode(p) { return [p.n, p.grid, p.rating].join('|'); }
  // The grid string of a set of full paths, pair p lettered String.fromCharCode(97 + p).
  function gridOf(n, paths) {
    var g = new Array(n * n).fill('.');
    paths.forEach(function (path, p) {
      path.forEach(function (i, x) {
        var ch = String.fromCharCode(97 + p);
        g[i] = x === 0 || x === path.length - 1 ? ch.toUpperCase() : ch;
      });
    });
    return g.join('');
  }
  // The path from a to b through every square lettered `ch`.
  function tracePath(n, grid, ch, a, b) {
    var total = 0, i;
    for (i = 0; i < grid.length; i++) if (grid[i] === ch) total++;
    var path = [a], used = {};
    used[a] = true;
    (function go(at) {
      if (path.length === total) return at === b;
      var next = sides(n, at);
      for (var s = 0; s < next.length; s++) {
        var j = next[s];
        if (used[j] || grid[j] !== ch || (j === b && path.length !== total - 1)) continue;
        used[j] = true;
        path.push(j);
        if (go(j)) return true;
        path.pop();
        used[j] = false;
      }
      return false;
    })(a);
    return path;
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
  // The size and difficulty a day is meant to have: [n, difficulty, fewest pairs, most pairs].
  function plannedFor(day) {
    if (day <= INTRO_DAYS) return INTRO;
    return WEEK[(day - INTRO_DAYS - 1) % 7];
  }

  /*
   * The day's puzzle: the decoded puzzle plus { day, index, difficulty, animals, colours,
   * endAt }. animals[p] and colours[p] are the animal (from ANIMALS) and palette index of
   * pair p, shuffled per day. endAt[i] is the pair whose animal stands on square i, or -1.
   */
  function dailyPuzzle(day, bank) {
    var index = scheduleIndex(day, bank), p = decode(bank.puzzles[index]);
    var rand = rng(Math.imul(day, 2654435761) ^ 0x5bd1e995);
    var pool = ANIMALS.filter(function (a, x) { return x < 10 || p.k >= BIG_PAIRS; });
    p.day = day;
    p.index = index;
    p.difficulty = DIFFICULTY[p.rating];
    p.animals = shuffle(rand, pool).slice(0, p.k);
    p.colours = shuffle(rand, PALETTE.map(function (c, x) { return x; })).slice(0, p.k);
    p.endAt = endsMap(p);
    return p;
  }
  function endsMap(p) {
    var endAt = new Array(p.n * p.n).fill(-1);
    p.ends.forEach(function (e, q) { endAt[e[0]] = q; endAt[e[1]] = q; });
    return endAt;
  }

  // ---- the exact solver

  /*
   * How many ways the puzzle can be finished, counting up to `limit`: sets of paths that join
   * every pair, never cross, and between them cover every square. `ends` lists each pair's
   * two squares.
   *
   * It decides the squares in reading order, choosing for each whether its path goes on to
   * the right and down (the square above and the one to the left have already said whether
   * they come in). All that matters about the decided part is the row of path ends hanging
   * over the undecided part, which path piece each belongs to, and that piece's pair if it
   * has reached an animal. Counts are kept for each such state, so the work stays small.
   */
  function countSolutions(n, ends, limit) {
    var N = n * n, endAt = new Array(N).fill(0);
    ends.forEach(function (e, p) { endAt[e[0]] = p + 1; endAt[e[1]] = p + 1; });
    limit = limit || 2;
    var memo = [];
    for (var i = 0; i <= N; i++) memo.push(new Map());

    // F: for each column, the piece label of a path end hanging into the next square of that
    // column (0 for none); L: the piece hanging in from the left; col[label]: its pair, 0 if
    // not known yet. A piece of unknown pair has two hanging ends, one of known pair has one.
    function go(i, F, L, col) {
      if (i === N) return 1;
      var key = F.join(',') + ';' + L + ';' + col.join(',');
      var m = memo[i], hit = m.get(key);
      if (hit !== undefined) return hit;
      var r = Math.floor(i / n), c = i % n, up = F[c], left = L;
      var need = endAt[i] ? 1 : 2, ins = (up ? 1 : 0) + (left ? 1 : 0), out = need - ins, total = 0;
      if (out < 0) { m.set(key, 0); return 0; }
      var canRight = c < n - 1, canDown = r < n - 1;
      var options = out === 0 ? [[0, 0]] : out === 1 ? [[1, 0], [0, 1]] : [[1, 1]];
      for (var o = 0; o < options.length && total < limit; o++) {
        var right = options[o][0], down = options[o][1];
        if ((right && !canRight) || (down && !canDown)) continue;
        var F2 = F.slice(), C2 = col.slice(), label = 0;
        F2[c] = 0;
        if (ins === 2) {
          // Two pieces meet here and become one. The same piece from both sides would be a loop.
          if (up === left) continue;
          var ca = C2[up], cb = C2[left];
          if (ca && cb && ca !== cb) continue;
          if (!(ca && cb)) {
            // Unless both had reached an animal (a finished path), the joined piece hangs on.
            for (var x = 0; x < n; x++) if (F2[x] === left) F2[x] = up;
            C2[up] = ca || cb;
          }
        } else if (ins === 1) {
          label = up || left;
          if (endAt[i]) {
            // A piece arrives at an animal: it must be that pair's, or not known yet.
            if (C2[label] && C2[label] !== endAt[i]) continue;
            C2[label] = endAt[i];
            label = 0;
          }
        } else {
          label = C2.length;
          C2.push(endAt[i] || 0);
        }
        if (down) F2[c] = label;
        var s = canon(F2, right ? label : 0, C2);
        total += go(i + 1, s.F, s.L, s.C);
      }
      if (total > limit) total = limit;
      m.set(key, total);
      return total;
    }
    // Renumbers piece labels in order of appearance, so that equal states get equal keys.
    function canon(F2, L2, C2) {
      var map = {}, next = 1, Fo = new Array(n), Co = [0], Lo = 0;
      for (var x = 0; x <= n; x++) {
        var v = x < n ? F2[x] : L2;
        if (v && !map[v]) { map[v] = next++; Co.push(C2[v]); }
        if (x < n) Fo[x] = v ? map[v] : 0;
        else Lo = v ? map[v] : 0;
      }
      return { F: Fo, L: Lo, C: Co };
    }
    return go(0, new Array(n).fill(0), 0, [0]);
  }

  // ---- the step-by-step solver

  /*
   * Solves a puzzle the way a person might, without guessing. It keeps, for each link between
   * two side-by-side squares, whether a path uses it (yes, no or not known), and for each
   * square the pairs whose path could pass through it. Then it repeats these deductions:
   *
   *   - an animal's square has one link, any other square two: once a square has that many
   *     it uses no more, and if only that many are left open it uses them all;
   *   - linked squares are on the same pair's path; squares that cannot share a pair are not linked;
   *   - a link that would close a loop is not used;
   *   - a pair can only pass through squares its two animals can both still reach.
   *
   * Those are the forced moves. When they run dry it tries one link at a time each way, and a
   * choice that leads straight to a contradiction is ruled out (a "trial").
   *
   * Returns { solved, order, forced, trials, rounds } where order lists the pairs in the order
   * they were joined, forced is how many were joined by forced moves alone, before any trial,
   * trials counts the trials needed (Infinity if trials alone could not finish it), and
   * rounds counts the rounds of deductions, a rough measure of how long it took.
   */
  function logicSolve(n, ends) {
    var N = n * n, k = ends.length, endAt = new Array(N).fill(-1), i;
    ends.forEach(function (e, p) { endAt[e[0]] = p; endAt[e[1]] = p; });
    // Links: id for each side-by-side pair of squares; at[i] lists [other square, link id].
    var links = [], at = [];
    for (i = 0; i < N; i++) at.push([]);
    for (i = 0; i < N; i++) {
      var r = Math.floor(i / n), c = i % n;
      if (c < n - 1) { at[i].push([i + 1, links.length]); at[i + 1].push([i, links.length]); links.push([i, i + 1]); }
      if (r < n - 1) { at[i].push([i + n, links.length]); at[i + n].push([i, links.length]); links.push([i, i + n]); }
    }
    var all = (1 << k) - 1;
    var state = { link: new Int8Array(links.length), dom: new Int32Array(N) };
    for (i = 0; i < N; i++) state.dom[i] = endAt[i] >= 0 ? 1 << endAt[i] : all;

    // Applies the forced moves until none is left; false on a contradiction. onRound, if
    // given, is called after each round through the deductions.
    function propagate(s, onRound) {
      var link = s.link, dom = s.dom;
      for (var changed = true; changed;) {
        if (onRound) onRound(s);
        changed = false;
        // Squares: how many links they use.
        for (var x = 0; x < N; x++) {
          var need = endAt[x] >= 0 ? 1 : 2, on = 0, open = 0, a = at[x], y;
          for (y = 0; y < a.length; y++) { var v = link[a[y][1]]; if (v === 1) on++; else if (v === 0) open++; }
          if (on > need || on + open < need) return false;
          if (open && (on === need || on + open === need)) {
            for (y = 0; y < a.length; y++) if (link[a[y][1]] === 0) link[a[y][1]] = on === need ? -1 : 1;
            changed = true;
          }
        }
        // Links: linked squares share a pair; squares with no pair in common are not linked.
        for (var e = 0; e < links.length; e++) {
          var p = links[e][0], q = links[e][1];
          if (link[e] === 1) {
            var both = dom[p] & dom[q];
            if (!both) return false;
            if (both !== dom[p] || both !== dom[q]) { dom[p] = dom[q] = both; changed = true; }
          } else if (link[e] === 0 && !(dom[p] & dom[q])) { link[e] = -1; changed = true; }
        }
        // Loops: a link between two squares already joined would close one.
        var parent = new Int32Array(N);
        for (x = 0; x < N; x++) parent[x] = x;
        var find = function (z) { while (parent[z] !== z) { parent[z] = parent[parent[z]]; z = parent[z]; } return z; };
        for (e = 0; e < links.length; e++) {
          if (link[e] !== 1) continue;
          var ra = find(links[e][0]), rb = find(links[e][1]);
          if (ra === rb) return false;
          parent[ra] = rb;
        }
        for (e = 0; e < links.length; e++) {
          if (link[e] === 0 && find(links[e][0]) === find(links[e][1])) { link[e] = -1; changed = true; }
        }
        // Reach: a pair passes only through squares both its animals can reach.
        for (var pr = 0; pr < k; pr++) {
          var bit = 1 << pr, fromA = reach(s, ends[pr][0], bit), fromB = reach(s, ends[pr][1], bit);
          if (!fromA[ends[pr][1]]) return false;
          for (x = 0; x < N; x++) {
            if ((dom[x] & bit) && !(fromA[x] && fromB[x])) {
              dom[x] &= ~bit;
              if (!dom[x]) return false;
              changed = true;
            }
          }
        }
      }
      return true;
    }
    function reach(s, from, bit) {
      var seen = new Uint8Array(N), todo = [from];
      seen[from] = 1;
      while (todo.length) {
        var x = todo.pop(), a = at[x];
        for (var y = 0; y < a.length; y++) {
          var z = a[y][0];
          if (seen[z] || s.link[a[y][1]] === -1 || !(s.dom[z] & bit)) continue;
          seen[z] = 1;
          todo.push(z);
        }
      }
      return seen;
    }
    function copy(s) { return { link: s.link.slice(), dom: s.dom.slice() }; }
    function done(s) { for (var e = 0; e < links.length; e++) if (s.link[e] === 0) return false; return true; }
    // The pairs whose two animals are joined by used links.
    function joinedPairs(s) {
      var out = [];
      for (var p = 0; p < k; p++) {
        var prev = -1, x = ends[p][0], steps = 0;
        while (x !== ends[p][1] && steps++ < N) {
          var next = -1;
          for (var y = 0; y < at[x].length; y++) if (s.link[at[x][y][1]] === 1 && at[x][y][0] !== prev) { next = at[x][y][0]; break; }
          if (next < 0) break;
          prev = x;
          x = next;
        }
        if (x === ends[p][1]) out.push(p);
      }
      return out;
    }

    // Pairs joined in the same round are taken shortest path first.
    var order = [], trials = 0, rounds = 0;
    function note(s) {
      rounds++;
      var fresh = joinedPairs(s).filter(function (p) { return order.indexOf(p) < 0; });
      fresh.sort(function (a, b) { return pathLength(s, a) - pathLength(s, b) || a - b; });
      order = order.concat(fresh);
    }
    function pathLength(s, p) { var len = 0; for (var x = 0; x < N; x++) if (s.dom[x] === 1 << p) len++; return len; }
    if (!propagate(state, note)) return { solved: false, order: order, forced: 0, trials: Infinity, rounds: rounds };
    note(state);
    var forced = order.length;
    while (!done(state)) {
      var progress = false;
      for (var e = 0; e < links.length && !progress; e++) {
        if (state.link[e] !== 0) continue;
        for (var v = 1; v >= -1 && !progress; v -= 2) {
          var t = copy(state);
          t.link[e] = v;
          if (!propagate(t)) {
            state.link[e] = -v;
            if (!propagate(state, note)) return { solved: false, order: order, forced: forced, trials: Infinity, rounds: rounds };
            trials++;
            progress = true;
          }
        }
      }
      if (!progress) return { solved: false, order: order, forced: forced, trials: Infinity, rounds: rounds };
      note(state);
    }
    note(state);
    return { solved: order.length === k, order: order, forced: forced, trials: trials, rounds: rounds };
  }

  /*
   * A puzzle's rating, 1 to 4 (see DIFFICULTY), from how the step-by-step solver gets on:
   * gentle if forced moves alone join every pair, then by how many trials it needs. 0 if
   * trials one at a time cannot finish it.
   */
  var TRIALS = [0, 0, 3, 10];
  function rate(n, ends) {
    var s = logicSolve(n, ends);
    if (!s.solved) return 0;
    for (var r = 1; r < TRIALS.length; r++) if (s.trials <= TRIALS[r]) return r;
    return 4;
  }

  // ---- drawing paths

  /*
   * The player's paths: one list of squares per pair, starting at one of its animals, or
   * empty. A path is complete when it ends on the other animal. Hinted pairs are locked:
   * their path is the solution and nothing can change or cut it.
   */
  function emptyPaths(k) { var out = []; for (var p = 0; p < k; p++) out.push([]); return out; }
  function isComplete(p, pair, path) {
    var e = p.ends[pair];
    return path.length >= 2 && ((path[0] === e[0] && path[path.length - 1] === e[1]) || (path[0] === e[1] && path[path.length - 1] === e[0]));
  }
  // The pair whose path covers square i, or -1.
  function owner(paths, i) {
    for (var q = 0; q < paths.length; q++) if (paths[q].indexOf(i) >= 0) return q;
    return -1;
  }
  // The square a path can be carried on from: its loose end, or -1 if it has none.
  function looseEnd(p, pair, path) {
    return path.length >= 2 && !isComplete(p, pair, path) ? path[path.length - 1] : -1;
  }

  /*
   * Starts drawing at square i. From an animal it starts that pair's path afresh; from a
   * square on a path it takes that path back to the square, to carry on from there.
   * Returns { pair, path } for the path in hand, or null if nothing can be drawn from i
   * (an empty square, or a hinted pair).
   */
  function pickUp(p, paths, locked, i) {
    var pair = p.endAt[i];
    if (pair >= 0) return locked[pair] ? null : { pair: pair, path: [i] };
    var q = owner(paths, i);
    if (q < 0 || locked[q]) return null;
    return { pair: q, path: paths[q].slice(0, paths[q].indexOf(i) + 1) };
  }

  /*
   * The path in hand after moving on to square i, which must be beside its end: back along
   * the path shortens it, a new square lengthens it, the partner animal completes it. Returns
   * null if the move is not allowed: another pair's animal, a hinted path, or onward from a
   * complete path. Crossing another path is allowed; withCut() cuts that path back.
   */
  function stepTo(p, locked, base, hold, i) {
    var path = hold.path, end = path[path.length - 1];
    if (!adjacent(p.n, end, i)) return null;
    var back = path.indexOf(i);
    if (back >= 0) return path.slice(0, back + 1);
    if (isComplete(p, hold.pair, path)) return null;
    var e = p.endAt[i];
    if (e >= 0 && e !== hold.pair) return null;
    var q = owner(base, i);
    if (q >= 0 && q !== hold.pair && locked[q]) return null;
    return path.concat([i]);
  }

  /*
   * All the paths, with `path` as pair `pair`'s and every other path cut back to just before
   * the first square it shares with `path`. A path cut down to its animal alone is empty.
   * The paths in `base` are not changed, so a path cut during a drag comes back if the drag
   * backs off it again.
   */
  function withCut(base, pair, path) {
    var mine = {};
    path.forEach(function (i) { mine[i] = true; });
    return base.map(function (b, q) {
      if (q === pair) return path.length >= 2 ? path.slice() : [];
      for (var x = 0; x < b.length; x++) if (mine[b[x]]) return x >= 2 ? b.slice(0, x) : [];
      return b.slice();
    });
  }

  /*
   * How far the player has got: { joined, covered, total, percent, solved, allJoined }.
   * covered counts squares on a path (an animal counts once its path has left it).
   */
  function progress(p, paths) {
    var joined = 0, seen = {}, covered = 0;
    paths.forEach(function (path, q) {
      if (isComplete(p, q, path)) joined++;
      if (path.length >= 2) path.forEach(function (i) { if (!seen[i]) { seen[i] = true; covered++; } });
    });
    var total = p.n * p.n;
    return {
      joined: joined, covered: covered, total: total, percent: Math.floor(covered * 100 / total),
      allJoined: joined === p.k, solved: joined === p.k && covered === total,
    };
  }

  /*
   * Checks saved paths against the puzzle and keeps only what could have been drawn: each
   * path starts at one of its animals, moves square by square, visits no square twice, passes
   * no other animal, stops at its partner, and shares no square with an earlier path.
   */
  function cleanPaths(p, saved) {
    var used = {}, out = emptyPaths(p.k);
    for (var q = 0; q < p.k; q++) {
      var path = Array.isArray(saved) && Array.isArray(saved[q]) ? saved[q] : [];
      var ok = path.length >= 2 && (path[0] === p.ends[q][0] || path[0] === p.ends[q][1]), seen = {};
      for (var x = 0; ok && x < path.length; x++) {
        var i = path[x];
        if (!Number.isInteger(i) || i < 0 || i >= p.n * p.n || seen[i] || used[i]) ok = false;
        else if (x && !adjacent(p.n, path[x - 1], i)) ok = false;
        else if (x && p.endAt[i] >= 0 && (p.endAt[i] !== q || x !== path.length - 1)) ok = false;
        seen[i] = true;
      }
      if (!ok) continue;
      out[q] = path.slice();
      path.forEach(function (i) { used[i] = true; });
    }
    return out;
  }

  // True if `path` is the solution path of pair q, drawn either way.
  function isSolutionPath(p, q, path) {
    var s = p.solution[q];
    if (path.length !== s.length) return false;
    var same = true, rev = true;
    for (var x = 0; x < s.length; x++) {
      if (path[x] !== s[x]) same = false;
      if (path[x] !== s[s.length - 1 - x]) rev = false;
    }
    return same || rev;
  }
  /*
   * The pair a hint draws: the first, in the order the step-by-step solver joins them (the
   * pair letters), that is not hinted already and not drawn as in the solution. -1 if none.
   */
  function hintPair(p, paths, locked) {
    for (var q = 0; q < p.k; q++) if (!locked[q] && !isSolutionPath(p, q, paths[q])) return q;
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

  // ---- time, sharing and stats

  // "0:07", "1:42", "1:02:05".
  function formatTime(ms) {
    var s = Math.max(0, Math.floor(ms / 1000)), h = Math.floor(s / 3600), m = Math.floor(s / 60) % 60;
    var pad = function (x) { return (x < 10 ? '0' : '') + x; };
    return h ? h + ':' + pad(m) + ':' + pad(s % 60) : m + ':' + pad(s % 60);
  }

  // The result as text: "Reunion #3 🐑 6×6 in 0:48", with " 💡×1" if hints were used.
  function shareText(p, ms, hints, url) {
    var out = ['Reunion #' + p.day + ' 🐑 ' + p.n + '×' + p.n + ' in ' + formatTime(ms) + (hints ? ' 💡×' + hints : '')];
    if (url) out.push(url);
    return out.join('\n');
  }

  function emptyStats() {
    var bySize = {};
    SIZES.forEach(function (n) { bySize[n] = { solved: 0, total: 0, best: 0 }; });
    return { played: 0, streak: 0, best: 0, lastDay: 0, clean: 0, hints: 0, bySize: bySize };
  }

  /*
   * Record a solved day. The streak counts days played in a row; clean counts days solved
   * without a hint. Per paddock size it keeps the number solved, their total time (for the
   * average) and the best time, which only counts puzzles solved without a hint. A day that
   * is not later than the last one recorded changes nothing, so a clock set back cannot
   * count a day twice.
   */
  function recordResult(stats, day, n, ms, hints) {
    if (day <= stats.lastDay || !stats.bySize[n]) return stats;
    var bySize = {};
    Object.keys(stats.bySize).forEach(function (key) {
      var b = stats.bySize[key];
      bySize[key] = { solved: b.solved, total: b.total, best: b.best };
    });
    var t = Math.max(1, Math.round(ms)); // 0 means no best time yet
    bySize[n].solved++;
    bySize[n].total += t;
    if (!hints && (!bySize[n].best || t < bySize[n].best)) bySize[n].best = t;
    var s = { played: stats.played + 1, lastDay: day, clean: stats.clean + (hints ? 0 : 1), hints: stats.hints + (hints || 0), bySize: bySize };
    s.streak = stats.lastDay === day - 1 ? stats.streak + 1 : 1;
    s.best = Math.max(stats.best, s.streak);
    return s;
  }

  var api = {
    EPOCH: EPOCH, INTRO_DAYS: INTRO_DAYS, ANIMALS: ANIMALS, BIG_PAIRS: BIG_PAIRS, PALETTE: PALETTE,
    DIFFICULTY: DIFFICULTY, WEEK: WEEK, INTRO: INTRO, SIZES: SIZES,
    sides: sides, adjacent: adjacent, rowOf: rowOf, cellsAlong: cellsAlong,
    decode: decode, encode: encode, gridOf: gridOf, rng: rng, shuffle: shuffle,
    scheduleIndex: scheduleIndex, plannedFor: plannedFor, dailyPuzzle: dailyPuzzle, endsMap: endsMap,
    countSolutions: countSolutions, logicSolve: logicSolve, rate: rate, TRIALS: TRIALS,
    emptyPaths: emptyPaths, isComplete: isComplete, owner: owner, looseEnd: looseEnd,
    pickUp: pickUp, stepTo: stepTo, withCut: withCut, progress: progress, cleanPaths: cleanPaths,
    isSolutionPath: isSolutionPath, hintPair: hintPair,
    dayNumber: dayNumber, msUntilTomorrow: msUntilTomorrow, formatTime: formatTime, shareText: shareText,
    emptyStats: emptyStats, recordResult: recordResult,
  };
  root.Reunion = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
