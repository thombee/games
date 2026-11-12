/*
 * Molehill game rules. No DOM in here: app.js draws the page, this file knows the lawns,
 * digs squares, solves lawns step by step, finds hints and keeps the stats. Works as a
 * plain <script> in the browser and via require() in Node.
 *
 * The game: a lawn of squares, some with a sleeping mole underneath. A dug square shows how
 * many of its eight neighbours have a mole. The player digs every square without a mole,
 * and can mark a square they think hides one with a daisy. Digging a mole wakes it.
 */
(function (root) {
  'use strict';

  // Day 1, as a local calendar date: Friday 13 November 2026.
  var EPOCH = { year: 2026, month: 11, day: 13 };
  // The first days of the schedule, played whatever the weekday, before the weekly plan starts.
  var INTRO_DAYS = 3;

  // Square states, as stored in a lawn-state string: not dug, dug, marked with a daisy.
  var COVERED = '.', DUG = 'o', DAISY = 'f';

  /*
   * The deductions the step-by-step solver knows, from easiest to hardest. A lawn is rated
   * by the hardest one it needs and by how many times it needs the harder two.
   */
  var DEDUCTIONS = [
    null,
    'a number that already touches all its moles: its other squares are safe',
    'a number with exactly as many undug squares as moles still to find: they are all moles',
    'two overlapping numbers compared',
    'counting the moles left',
  ];
  var DIFFICULTIES = ['gentle', 'steady', 'tricky', 'tough'];

  /*
   * The weekly plan, Monday first: width, height, moles, difficulty, and the hardest
   * deduction a lawn of that day may need. Day sizes are named "7×9" (wide by tall).
   */
  var WEEK = [
    { w: 7, h: 7, moles: 6, difficulty: 'gentle', maxLevel: 2 },
    { w: 7, h: 8, moles: 8, difficulty: 'gentle', maxLevel: 2 },
    { w: 8, h: 9, moles: 10, difficulty: 'gentle', maxLevel: 2 },
    { w: 8, h: 10, moles: 13, difficulty: 'steady', maxLevel: 3 },
    { w: 9, h: 10, moles: 15, difficulty: 'steady', maxLevel: 3 },
    { w: 9, h: 11, moles: 18, difficulty: 'tricky', maxLevel: 4 },
    { w: 10, h: 12, moles: 22, difficulty: 'tough', maxLevel: 4 },
  ];
  var INTRO = WEEK[0];
  var SIZES = ['7×7', '7×8', '8×9', '8×10', '9×10', '9×11', '10×12'];

  // How hard a lawn feels: from the hardest deduction it needs and how often it needs
  // the two harder ones (comparing numbers, counting moles).
  function difficultyOf(level, hard) {
    if (level <= 2) return 'gentle';
    if (hard <= 2) return 'steady';
    if (hard <= 5) return 'tricky';
    return 'tough';
  }

  // ---- lawns

  var B32 = '0123456789abcdefghijklmnopqrstuv';

  /*
   * A lawn as stored in lawns.js: "w|h|moles|start|level|hard". moles is a bit for each
   * square in reading order, five to a character in base 32; start is the square the
   * starting patch is opened from (it has no mole next to it); level and hard are the rating.
   */
  function decode(text) {
    var parts = String(text).split('|'), w = Number(parts[0]), h = Number(parts[1]), moles = [];
    for (var i = 0; i < w * h; i++) moles.push((B32.indexOf(parts[2][Math.floor(i / 5)]) >> (4 - (i % 5))) & 1);
    var lawn = { w: w, h: h, moles: moles, start: Number(parts[3]), level: Number(parts[4]), hard: Number(parts[5]) };
    return prepare(lawn);
  }
  function encode(lawn) {
    var bits = '';
    for (var i = 0; i < lawn.moles.length; i += 5) {
      var v = 0;
      for (var k = 0; k < 5; k++) v = (v << 1) | (lawn.moles[i + k] ? 1 : 0);
      bits += B32[v];
    }
    return [lawn.w, lawn.h, bits, lawn.start, lawn.level, lawn.hard].join('|');
  }
  // Fills in what follows from the moles: the count of moles, each square's number, the size name.
  function prepare(lawn) {
    var nb = neighbourTable(lawn.w, lawn.h);
    lawn.count = 0;
    lawn.nums = lawn.moles.map(function (m, i) {
      if (m) lawn.count++;
      var k = 0;
      nb[i].forEach(function (j) { k += lawn.moles[j]; });
      return k;
    });
    lawn.size = lawn.w + '×' + lawn.h;
    return lawn;
  }

  // The squares around square i, corners included, for a lawn w wide and h tall. Cached.
  var tables = {};
  function neighbourTable(w, h) {
    var key = w + 'x' + h;
    if (tables[key]) return tables[key];
    var out = [];
    for (var i = 0; i < w * h; i++) {
      var r = Math.floor(i / w), c = i % w, list = [];
      for (var dr = -1; dr <= 1; dr++) {
        for (var dc = -1; dc <= 1; dc++) {
          var rr = r + dr, cc = c + dc;
          if ((dr || dc) && rr >= 0 && rr < h && cc >= 0 && cc < w) list.push(rr * w + cc);
        }
      }
      out.push(list);
    }
    return (tables[key] = out);
  }
  function neighbours(lawn, i) { return neighbourTable(lawn.w, lawn.h)[i]; }

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

  // ---- the schedule

  // Which lawn in the bank a day plays. The intro days come first, then the weekly part of
  // the schedule repeats for as long as needed.
  function scheduleIndex(day, bank) {
    var s = bank.schedule, intro = bank.intro;
    if (day <= intro) return s[Math.max(0, day - 1)];
    return s[intro + ((day - intro - 1) % (s.length - intro))];
  }
  // The plan a day is meant to follow (one of WEEK).
  function plannedFor(day) {
    if (day <= INTRO_DAYS) return INTRO;
    return WEEK[(day - INTRO_DAYS - 1) % 7];
  }
  // The day's lawn: a decoded lawn with day, index and difficulty added.
  function dailyLawn(day, bank) {
    var index = scheduleIndex(day, bank), lawn = decode(bank.lawns[index]);
    lawn.day = day;
    lawn.index = index;
    lawn.difficulty = difficultyOf(lawn.level, lawn.hard);
    return lawn;
  }

  // ---- digging

  function setAt(state, i, ch) { return state.slice(0, i) + ch + state.slice(i + 1); }
  function blankState(lawn) { return new Array(lawn.w * lawn.h + 1).join(COVERED); }

  /*
   * Digs the given squares, and goes on digging around every dug square with no mole next
   * to it, as in Minesweeper. Squares with a daisy are left alone. Returns
   * { state, opened, woke }: the new state, the squares newly dug, and any moles among them.
   */
  function digAll(lawn, state, list) {
    var s = state.split(''), opened = [], woke = [], todo = list.slice(), nb = neighbourTable(lawn.w, lawn.h);
    while (todo.length) {
      var i = todo.pop();
      if (s[i] !== COVERED) continue;
      s[i] = DUG;
      opened.push(i);
      if (lawn.moles[i]) { woke.push(i); continue; }
      if (lawn.nums[i] === 0) nb[i].forEach(function (j) { if (s[j] === COVERED) todo.push(j); });
    }
    return { state: s.join(''), opened: opened, woke: woke };
  }
  function dig(lawn, state, i) { return digAll(lawn, state, [i]); }
  // The state a lawn starts in: the starting patch dug.
  function startState(lawn) { return digAll(lawn, blankState(lawn), [lawn.start]).state; }

  // Puts a daisy on an undug square, or takes it off. Dug squares do not change.
  function toggleDaisy(state, i) {
    if (state[i] === COVERED) return setAt(state, i, DAISY);
    if (state[i] === DAISY) return setAt(state, i, COVERED);
    return state;
  }

  /*
   * A chord: a dug number with exactly that many daisies around it digs its other undug
   * neighbours. Returns what digAll returns, or null if the square cannot chord.
   */
  function chordable(lawn, state, i) {
    if (state[i] !== DUG || lawn.moles[i] || !lawn.nums[i]) return false;
    var daisies = 0, covered = 0;
    neighbours(lawn, i).forEach(function (j) {
      if (state[j] === DAISY) daisies++;
      else if (state[j] === COVERED) covered++;
    });
    return daisies === lawn.nums[i] && covered > 0;
  }
  function chord(lawn, state, i) {
    if (!chordable(lawn, state, i)) return null;
    return digAll(lawn, state, neighbours(lawn, i).filter(function (j) { return state[j] === COVERED; }));
  }

  // True once a mole has been dug.
  function isLost(lawn, state) {
    for (var i = 0; i < state.length; i++) if (state[i] === DUG && lawn.moles[i]) return true;
    return false;
  }
  // True once every square without a mole is dug, and no mole is.
  function isCleared(lawn, state) {
    for (var i = 0; i < state.length; i++) if ((state[i] === DUG) === !!lawn.moles[i]) return false;
    return true;
  }
  // A cleared lawn with a daisy on every mole.
  function withAllDaisies(lawn, state) {
    return state.split('').map(function (ch, i) { return lawn.moles[i] ? DAISY : ch; }).join('');
  }
  function daisyCount(state) {
    var k = 0;
    for (var i = 0; i < state.length; i++) if (state[i] === DAISY) k++;
    return k;
  }
  // Moles still to find, as the counter shows it: the moles less the daisies placed.
  function molesLeft(lawn, state) { return lawn.count - daisyCount(state); }
  // How much of the garden is dug: the share of squares without a mole that are dug, in
  // whole percent, never 100 unless every one is.
  function percentDug(lawn, state) {
    var safe = 0, dug = 0;
    for (var i = 0; i < state.length; i++) {
      if (lawn.moles[i]) continue;
      safe++;
      if (state[i] === DUG) dug++;
    }
    var p = Math.floor((100 * dug) / safe);
    return dug < safe ? Math.min(p, 99) : 100;
  }

  // ---- solving

  /*
   * The easiest deduction that can be made from what is showing. nums[i] is the number on a
   * dug square, or -1 for a square that is not dug; known[i] is 1 for a square known to hide
   * a mole, 2 for one known to be safe but not dug, else 0. total is the number of moles.
   *
   * Returns null, or { level, safe, moles, from, need, cells } where safe and moles are the
   * squares the step proves, from the numbers it uses, and for each of those numbers need is
   * the moles it still needs and cells its squares that are not yet known.
   */
  function findStep(w, h, nums, known, total, maxLevel) {
    var nb = neighbourTable(w, h), n = w * h, cons = [], byCell = {}, i, k;
    maxLevel = maxLevel || 4;
    for (i = 0; i < n; i++) {
      if (nums[i] < 0) continue;
      var cells = [], marked = 0;
      for (k = 0; k < nb[i].length; k++) {
        var j = nb[i][k];
        if (nums[j] >= 0) continue;
        if (known[j] === 1) marked++;
        else if (!known[j]) cells.push(j);
      }
      if (!cells.length) continue;
      var c = { at: i, cells: cells, need: nums[i] - marked };
      cons.push(c);
      cells.forEach(function (x) { (byCell[x] = byCell[x] || []).push(c); });
    }
    function step(level, safe, moles, from) {
      return {
        level: level, safe: safe, moles: moles, from: from.map(function (c) { return c.at; }),
        need: from.map(function (c) { return c.need; }), cells: from.map(function (c) { return c.cells; }),
      };
    }
    // 1: a number that already touches all its moles.
    for (k = 0; k < cons.length; k++) if (cons[k].need === 0) return step(1, cons[k].cells, [], [cons[k]]);
    // 2: a number whose undug squares must all be moles.
    if (maxLevel < 2) return null;
    for (k = 0; k < cons.length; k++) if (cons[k].need === cons[k].cells.length) return step(2, [], cons[k].cells, [cons[k]]);
    // 3: two numbers that share squares. If A needs d more moles than B and has exactly d
    // squares B does not touch, those d squares are moles and B's own squares are safe.
    if (maxLevel < 3) return null;
    for (k = 0; k < cons.length; k++) {
      var a = cons[k], seen = {};
      for (var x = 0; x < a.cells.length; x++) {
        var others = byCell[a.cells[x]];
        for (var y = 0; y < others.length; y++) {
          var b = others[y];
          if (b === a || seen[b.at]) continue;
          seen[b.at] = true;
          var onlyA = a.cells.filter(function (q) { return b.cells.indexOf(q) < 0; });
          var onlyB = b.cells.filter(function (q) { return a.cells.indexOf(q) < 0; });
          if (a.need - b.need === onlyA.length && (onlyA.length || onlyB.length)) return step(3, onlyB, onlyA, [a, b]);
        }
      }
    }
    // 4: counting the moles left.
    if (maxLevel < 4) return null;
    var unknown = [], left = total;
    for (i = 0; i < n; i++) {
      if (nums[i] >= 0) continue;
      if (known[i] === 1) left--;
      else if (!known[i]) unknown.push(i);
    }
    if (!unknown.length) return null;
    if (left === 0) return step(4, unknown, [], []);
    if (left === unknown.length) return step(4, [], unknown, []);
    var outside = function (sets) {
      return unknown.filter(function (q) { return sets.every(function (s) { return s.cells.indexOf(q) < 0; }); });
    };
    for (k = 0; k < cons.length; k++) {
      var out = outside([cons[k]]);
      if (!out.length) continue;
      if (cons[k].need === left) return step(4, out, [], [cons[k]]);
      if (out.length === left - cons[k].need) return step(4, [], out, [cons[k]]);
    }
    for (k = 0; k < cons.length; k++) {
      for (var m = k + 1; m < cons.length; m++) {
        var p = cons[k], q = cons[m];
        if (p.cells.some(function (z) { return q.cells.indexOf(z) >= 0; })) continue;
        if (p.need + q.need !== left) continue;
        var rest = outside([p, q]);
        if (rest.length) return step(4, rest, [], [p, q]);
      }
    }
    return null;
  }

  // What a lawn state shows: the number on each dug square, or -1.
  function shownNumbers(lawn, state) {
    return lawn.nums.map(function (v, i) { return state[i] === DUG && !lawn.moles[i] ? v : -1; });
  }

  /*
   * Solves a lawn from its starting patch the way a person would, without guessing: it uses
   * the easiest deduction that makes progress, digs the squares that proves safe (a dug
   * blank opens its neighbours, as in the game) and remembers the moles, then starts again
   * from the easiest. maxLevel limits the deductions it may use.
   *
   * Returns { solved, level, hard, steps, state } where level is the hardest deduction used,
   * hard counts the steps that compared two numbers or counted moles, steps lists each step
   * (see findStep) and state is how far it got.
   */
  function solveLawn(lawn, maxLevel, from) {
    var state = from || startState(lawn), known = lawn.moles.map(function () { return 0; }), steps = [], level = 0, hard = 0;
    for (var i = 0; i < state.length; i++) if (state[i] === DAISY && lawn.moles[i]) known[i] = 1;
    state = state.replace(/f/g, COVERED);
    while (!isCleared(lawn, state)) {
      var st = findStep(lawn.w, lawn.h, shownNumbers(lawn, state), known, lawn.count, maxLevel);
      if (!st) break;
      steps.push(st);
      level = Math.max(level, st.level);
      if (st.level >= 3) hard++;
      st.moles.forEach(function (j) { known[j] = 1; });
      state = digAll(lawn, state, st.safe).state;
    }
    return { solved: isCleared(lawn, state), level: level, hard: hard, steps: steps, state: state };
  }

  /*
   * Everything that can be proved from what a lawn state shows, without digging anything:
   * { moles, safe } as arrays of 0/1 a square. Daisies are not trusted.
   */
  function provable(lawn, state) {
    var nums = shownNumbers(lawn, state), known = lawn.moles.map(function () { return 0; });
    for (;;) {
      var st = findStep(lawn.w, lawn.h, nums, known, lawn.count);
      if (!st) break;
      st.moles.forEach(function (j) { known[j] = 1; });
      st.safe.forEach(function (j) { known[j] = 2; });
    }
    return { moles: known.map(function (v) { return v === 1 ? 1 : 0; }), safe: known.map(function (v) { return v === 2 ? 1 : 0; }) };
  }

  /*
   * A hint: one square that can be proved safe or proved a mole from what is showing, by the
   * easiest deduction available. Daisies count as moles only where they can be proved right,
   * so the reason given never rests on a wrong daisy. Returns null if nothing is left to find,
   * else { cell, safe, level, from, need, cells, left } (see findStep; left is the moles still
   * to find when the step counts them).
   *
   * The square named is one the player has not dealt with: a safe square that is not dug, or
   * a mole without a daisy.
   */
  function hint(lawn, state) {
    if (isLost(lawn, state) || isCleared(lawn, state)) return null;
    var proof = provable(lawn, state), known = lawn.moles.map(function () { return 0; }), left = lawn.count;
    for (var i = 0; i < state.length; i++) {
      if (state[i] === DAISY && proof.moles[i]) { known[i] = 1; left--; }
    }
    var st = findStep(lawn.w, lawn.h, shownNumbers(lawn, state), known, lawn.count);
    if (!st) return null;
    var safe = st.safe.length > 0, list = safe ? st.safe : st.moles;
    // Prefer a square next to the first number the step uses, then the first in reading order.
    var near = st.from.length ? neighbours(lawn, st.from[0]) : [];
    var cell = list.filter(function (j) { return near.indexOf(j) >= 0; })[0];
    if (cell === undefined) cell = list[0];
    return { cell: cell, safe: safe, level: st.level, from: st.from, need: st.need, cells: st.cells, left: left, all: list };
  }

  // "row 3, column 4" for square i.
  function squareName(lawn, i) { return 'row ' + (Math.floor(i / lawn.w) + 1) + ', column ' + (i % lawn.w + 1); }
  function plural(n, one, many) { return n + ' ' + (n === 1 ? one : many); }
  function cap(s) { return s.charAt(0).toUpperCase() + s.slice(1); }

  /*
   * The sentence that goes with a hint: the square, and which number proves it. With the
   * state, a safe square that carries a (wrong) daisy says so.
   */
  function hintText(lawn, h, state) {
    var where = cap(squareName(lawn, h.cell)), what = h.safe ? where + ' is safe to dig' : where + ' hides a mole';
    if (h.safe && state && state[h.cell] === DAISY) what += ' (take its daisy off first)';
    var num = function (k) { return 'the ' + lawn.nums[h.from[k]] + ' at ' + squareName(lawn, h.from[k]); };
    var moles = function (n) { return plural(n, 'mole', 'moles'); };
    if (h.level === 1) {
      var n1 = lawn.nums[h.from[0]];
      return what + ': ' + num(0) + ' already touches ' + (n1 === 1 ? 'its mole' : 'all ' + n1 + ' of its moles') + ', marked with ' +
        (n1 === 1 ? 'a daisy' : 'daisies') + ', so its other squares are safe.';
    }
    if (h.level === 2) {
      var marked = lawn.nums[h.from[0]] - h.need[0];
      return what + ': ' + num(0) + ' needs ' + (marked ? h.need[0] + ' more ' + (h.need[0] === 1 ? 'mole' : 'moles') : moles(h.need[0])) + ' and has only ' +
        plural(h.cells[0].length, 'undug square', 'undug squares') + (marked ? ' without a daisy' : '') + ' around it, so ' +
        (h.cells[0].length === 1 ? 'that one is a mole.' : 'every one is a mole.');
    }
    if (h.level === 3) {
      var d = h.need[0] - h.need[1];
      var outA = h.cells[0].filter(function (q) { return h.cells[1].indexOf(q) < 0; }).length;
      if (d === 0) {
        return what + ': compare ' + num(0) + ' with ' + num(1) + '. Every square that could hide the first one’s ' +
          (h.need[0] === 1 ? 'mole' : 'moles') + ' also touches the second, and the second needs no more than that, so its other squares are safe.';
      }
      return what + ': compare ' + num(0) + ' with ' + num(1) + '. The first needs ' + d + ' more ' + (d === 1 ? 'mole' : 'moles') +
        ' than the second, and only ' + plural(outA, 'of its squares is', 'of its squares are') + ' out of the second’s reach, so ' +
        (outA === 1 ? 'that square hides a mole' : 'those squares all hide moles') + ' and the squares only the second touches are safe.';
    }
    // Counting the moles left.
    var left = 'Only ' + moles(h.left) + ' left to find';
    if (!h.from.length) {
      return what + ': ' + (h.left === 0 ? 'every mole is found, so every undug square is safe.' : left.toLowerCase() + ', and exactly that many undug squares, so each hides one.');
    }
    if (h.from.length === 2) return what + ': ' + left.toLowerCase() + ', and ' + num(0) + ' and ' + num(1) + ' need all of them between them, so every square away from those two is safe.';
    if (h.safe) return what + ': ' + left.toLowerCase() + ', and ' + num(0) + ' needs all of them, so every square away from it is safe.';
    return what + ': ' + left.toLowerCase() + '. ' + cap(num(0)) + ' takes ' + h.need[0] + ', and the rest must be in the squares away from it, which are exactly enough.';
  }

  // ---- the guided lawn

  /*
   * A 4 by 4 lawn with two moles, for a first visit, laid out like this (M a mole, * dug at
   * the start):
   *
   *   M  2  1  1
   *   1* 2* M  1*
   *   0* 1* 1* 1*
   *   0* 0* 0* 0*
   *
   * Each step points at one number, says what it proves, and waits until the squares it
   * names (targets) are marked or dug. `chord` steps can also be done by tapping the number.
   */
  var GUIDE = {
    w: 4, h: 4, moles: [0, 6], start: 12, extra: [7],
    steps: [
      { from: 9, targets: [6], action: 'mark', text: 'This 1 touches only one grassy square, so a mole is asleep under it. Mark it with a daisy: switch to 🌼 Mark and tap it, or press and hold it.' },
      { from: 7, targets: [2, 3], action: 'chord', text: 'This 1 already touches its daisy, so its other neighbours are safe. Switch back to ⛏ Dig and tap the 1 itself to dig them both at once.' },
      { from: 2, targets: [1], action: 'dig', text: 'This 1 has its daisy too, so the last grassy square beside it is safe. Dig it to finish.' },
    ],
  };
  // The guided lawn, ready to play, and the state it starts in.
  function guideLawn() {
    var moles = [];
    for (var i = 0; i < GUIDE.w * GUIDE.h; i++) moles.push(GUIDE.moles.indexOf(i) >= 0 ? 1 : 0);
    var lawn = prepare({ w: GUIDE.w, h: GUIDE.h, moles: moles, start: GUIDE.start, level: 2, hard: 0 });
    lawn.day = 0;
    lawn.difficulty = 'gentle';
    return lawn;
  }
  function guideStart(lawn) { return digAll(lawn, startState(lawn), GUIDE.extra).state; }
  // The first guide step not yet done in a state, as an index into GUIDE.steps (its length when all are).
  function guideStep(state) {
    for (var k = 0; k < GUIDE.steps.length; k++) {
      var s = GUIDE.steps[k], want = s.action === 'mark' ? DAISY : DUG;
      if (!s.targets.every(function (t) { return state[t] === want; })) return k;
    }
    return GUIDE.steps.length;
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

  // Lawns up to this many squares wide get a picture in shared results; wider ones are too bulky.
  var SHARE_PICTURE_MAX = 8;
  /*
   * The result as text. A cleared lawn: "Molehill #3 🌼 cleared in 1:12"; a woken mole:
   * "Molehill #3 😵 woke a mole at 73%". Hints add " 💡×2". For lawns up to 8 wide, a picture
   * follows: 🟩 dug, 🌼 a mole with a daisy, 🟫 a woken mole, ⬜ anything else.
   */
  function shareText(lawn, state, ms, hints, url) {
    var lost = isLost(lawn, state);
    var head = 'Molehill #' + lawn.day + (lost ? ' 😵 woke a mole at ' + percentDug(lawn, state) + '%' : ' 🌼 cleared in ' + formatTime(ms)) +
      (hints ? ' 💡×' + hints : '');
    var out = [head];
    for (var r = 0; lawn.w <= SHARE_PICTURE_MAX && r < lawn.h; r++) {
      var line = '';
      for (var c = 0; c < lawn.w; c++) {
        var i = r * lawn.w + c, s = state[i];
        line += s === DUG ? (lawn.moles[i] ? '🟫' : '🟩') : s === DAISY && lawn.moles[i] ? '🌼' : '⬜';
      }
      out.push(line);
    }
    if (url) out.push(url);
    return out.join('\n');
  }

  function emptyStats() {
    var bySize = {};
    SIZES.forEach(function (k) { bySize[k] = { cleared: 0, total: 0, best: 0 }; });
    return { played: 0, cleared: 0, clean: 0, streak: 0, best: 0, lastDay: 0, hints: 0, bySize: bySize };
  }

  /*
   * Record a finished day: cleared (true) or a woken mole (false). The streak counts days
   * played in a row, cleared or not. For each lawn size it keeps the number cleared, their
   * total time (for the average) and the best time. clean counts lawns cleared without a
   * hint. A day that is not later than the last one recorded changes nothing, so a clock set
   * back cannot count a day twice.
   */
  function recordResult(stats, day, size, cleared, ms, hints) {
    if (day <= stats.lastDay || !stats.bySize[size]) return stats;
    var bySize = {};
    Object.keys(stats.bySize).forEach(function (k) {
      var b = stats.bySize[k];
      bySize[k] = { cleared: b.cleared, total: b.total, best: b.best };
    });
    var s = {
      played: stats.played + 1, cleared: stats.cleared + (cleared ? 1 : 0), clean: stats.clean + (cleared && !hints ? 1 : 0),
      lastDay: day, hints: stats.hints + (hints || 0), bySize: bySize,
    };
    if (cleared) {
      var t = Math.max(1, Math.round(ms)); // 0 means no best time yet
      bySize[size].cleared++;
      bySize[size].total += t;
      if (!bySize[size].best || t < bySize[size].best) bySize[size].best = t;
    }
    s.streak = stats.lastDay === day - 1 ? stats.streak + 1 : 1;
    s.best = Math.max(stats.best, s.streak);
    return s;
  }

  var api = {
    EPOCH: EPOCH, INTRO_DAYS: INTRO_DAYS, COVERED: COVERED, DUG: DUG, DAISY: DAISY, DEDUCTIONS: DEDUCTIONS, DIFFICULTIES: DIFFICULTIES,
    WEEK: WEEK, INTRO: INTRO, SIZES: SIZES, SHARE_PICTURE_MAX: SHARE_PICTURE_MAX, GUIDE: GUIDE, guideLawn: guideLawn, guideStart: guideStart, guideStep: guideStep,
    difficultyOf: difficultyOf, decode: decode, encode: encode, prepare: prepare, neighbours: neighbours, rng: rng,
    scheduleIndex: scheduleIndex, plannedFor: plannedFor, dailyLawn: dailyLawn,
    blankState: blankState, digAll: digAll, dig: dig, startState: startState, toggleDaisy: toggleDaisy, chordable: chordable, chord: chord,
    isLost: isLost, isCleared: isCleared, withAllDaisies: withAllDaisies, daisyCount: daisyCount, molesLeft: molesLeft, percentDug: percentDug,
    findStep: findStep, shownNumbers: shownNumbers, solveLawn: solveLawn, provable: provable, hint: hint, hintText: hintText, squareName: squareName,
    dayNumber: dayNumber, msUntilTomorrow: msUntilTomorrow, formatTime: formatTime, shareText: shareText,
    emptyStats: emptyStats, recordResult: recordResult,
  };
  root.Molehill = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
