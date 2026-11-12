/*
 * Bolt game rules: the day's runaway, the course, the physics, collisions, landmarks,
 * scoring, share text and stats. No DOM in here: app.js draws the state and feeds in
 * presses. Works as a plain <script> in the browser and via require() in Node.
 *
 * The run moves on a fixed step of 1/120 s. The physics and the course use only + - * /,
 * comparisons and Math.imul/floor, which JavaScript defines exactly, so the same day and
 * the same presses (by step number) give exactly the same run in every browser and in Node.
 *
 * Units are metres and steps. The runaway's x is the distance from the gate.
 */
(function (root) {
  'use strict';

  var HZ = 120; // steps a second
  // Day 1, as a local calendar date.
  var EPOCH = { year: 2026, month: 11, day: 13 };
  var RUNS = 3; // runs a day; the best counts

  // ---- physics, per step

  var GRAVITY = 0.0024; // m/step² (34.6 m/s²)
  var JUMP = 0.086; // upward speed of a jump from the ground, m/step: about 1.54 m high, 0.6 s in the air
  var HOP = 0.066; // the second jump in the air adds this to 40% of any upward speed left
  var HOP_KEEP = 0.4;
  var BUFFER = 10; // steps a press is remembered when it comes with no jump left, so it jumps on landing
  // The runaway's hitbox: half its width and its height. Smaller than the drawing, to be kind.
  var BODY_HALF = 0.33, BODY_H = 0.72;

  // Running speed in m/s rises with the distance from V0 at the gate to VMAX at RAMP metres.
  var V0 = 8, VMAX = 16, RAMP = 2400;
  function speedAt(x) { return x >= RAMP ? VMAX : V0 + (VMAX - V0) * x / RAMP; }
  // Jumps quicken with the pace too: at tempo t a jump has the same shape in metres but
  // takes 1/t of the time. The tempo rises from 1 at the gate to TEMPO at RAMP metres.
  var TEMPO = 1.4;
  function tempoAt(x) { return x >= RAMP ? TEMPO : 1 + (TEMPO - 1) * x / RAMP; }

  /*
   * How much of the course the play area shows at x metres: { metres, behind }, the width of
   * the view in metres and the share of it behind the runaway. As the pace rises the runaway
   * sits further left and the view widens, so the course ahead always takes at least LOOK
   * seconds to reach the runaway's front, plus a little: on any screen, at any speed.
   * A wide screen (wider than 1.3 times its height) shows 15% more.
   */
  var LOOK = 0.95;
  function view(x, wide) {
    var v = speedAt(x), t = (v - V0) / (VMAX - V0), behind = 0.18 - 0.06 * t;
    var metres = Math.max(9 + 0.25 * v, (LOOK * v + BODY_HALF + 0.3) / (1 - behind));
    return { metres: wide ? metres * 1.15 : metres, behind: behind };
  }
  // The metres of course visible ahead of the runaway's x.
  function ahead(x, wide) {
    var w = view(x, wide);
    return w.metres * (1 - w.behind);
  }

  // ---- the day's runaway

  var ANIMALS = [
    { kind: 'hen', emoji: '🐓' }, { kind: 'pig', emoji: '🐖' }, { kind: 'goat', emoji: '🐐' },
    { kind: 'sheep', emoji: '🐑' }, { kind: 'cow', emoji: '🐄' }, { kind: 'duck', emoji: '🦆' },
    { kind: 'turkey', emoji: '🦃' }, { kind: 'donkey', emoji: '🫏' }, { kind: 'rabbit', emoji: '🐇' },
    { kind: 'goose', emoji: '🪿' },
  ];
  var NAMES = [
    'Hazel', 'Mabel', 'Clover', 'Pip', 'Bramble', 'Daisy', 'Biscuit', 'Juniper', 'Poppy', 'Rosie',
    'Hattie', 'Nell', 'Dot', 'Peggy', 'Winnie', 'Ruby', 'Olive', 'Maggie', 'Tilly', 'Bonnie',
    'Gus', 'Alfie', 'Percy', 'Barney', 'Otis', 'Murphy', 'Ziggy', 'Fergus', 'Rufus', 'Monty',
    'Ned', 'Hamish', 'Basil', 'Bert', 'Clem', 'Dougal', 'Ernie', 'Frankie', 'Gilbert', 'Hugo',
    'Iggy', 'Jasper', 'Kip', 'Lenny', 'Milo', 'Noodle', 'Ozzie', 'Pickle', 'Quincy', 'Reggie',
    'Sid', 'Toby', 'Vera', 'Wally', 'Acorn', 'Button', 'Cricket', 'Dumpling', 'Fig', 'Ginger',
    'Honey', 'Jelly', 'Kiwi', 'Lulu', 'Maple', 'Nutmeg', 'Pudding', 'Sprout', 'Truffle', 'Waffles',
    'Wren', 'Bluebell', 'Marigold', 'Sunny', 'Banjo', 'Coco', 'Dusty', 'Fern', 'Goldie', 'Mo',
  ];

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
  function shuffle(rand, list) {
    var a = list.slice();
    for (var i = a.length - 1; i > 0; i--) {
      var j = Math.floor(rand() * (i + 1)), t = a[i];
      a[i] = a[j];
      a[j] = t;
    }
    return a;
  }

  /*
   * The day's runaway: { kind, emoji, name }. The animals take turns in a fixed order. The
   * names are dealt from a shuffled deck per block of NAMES.length days, so no name comes
   * round twice in a block.
   */
  function animalFor(day) {
    var n = NAMES.length, i = ((day - 1) % n + n) % n, block = Math.floor((day - 1) / n);
    var deck = shuffle(rng(seedFor(block, 0x5bd1e995)), NAMES);
    var a = ANIMALS[((day - 1) % ANIMALS.length + ANIMALS.length) % ANIMALS.length];
    return { kind: a.kind, emoji: a.emoji, name: deck[i] };
  }

  // ---- landmarks

  var LANDMARKS = [
    { m: 100, name: 'the orchard' }, { m: 250, name: 'the back paddock' }, { m: 500, name: 'the creek' },
    { m: 750, name: 'the old windmill' }, { m: 1000, name: 'the foothills' }, { m: 1500, name: 'the high meadow' },
    { m: 2000, name: 'the hills' },
  ];
  // The index of the furthest landmark reached at `m` metres, or -1 for none.
  function landmarkAt(m) {
    var i = -1;
    while (i + 1 < LANDMARKS.length && m >= LANDMARKS[i + 1].m) i++;
    return i;
  }

  // ---- the course

  /*
   * Obstacles. Each is an item { kind, x0, x1 } with either a top `h` (a solid thing to get
   * over), a bottom `y0` (a low branch to stay under), or neither (a puddle: no touching
   * the ground over it). x0, x1, h and y0 are the drawing's outline (scene.js draws from
   * them). A solid thing or a branch also has `boxes`, the rectangles that count for a crash:
   * { x0, x1, h } or { x0, x1, y0 }, matching the drawing and each inset a little in the
   * player's favour, so a crash never happens short of what is drawn.
   * Items come in groups, made by make(rand, k, x) at x metres, where k runs from 1 at the
   * gate to 2 at top speed: long things get longer as the pace rises, so the faster runaway
   * does not get an easier time of it. `plan` says how the group is meant to be cleared:
   * 'jump', 'double' (jump then hop) or 'stay' (keep running underneath).
   */
  var GENTLE = 150; // the first stretch: only low single jumps, spaced out
  // A solid item whose box is its outline drawn in by `side` at each end and `top` from above.
  function item(kind, x0, x1, h, side, top) {
    return { kind: kind, x0: x0, x1: x1, h: h, boxes: [{ x0: x0 + side, x1: x1 - side, h: h - top }] };
  }
  // Bales and haystacks are drawn with corners rounded 0.28 m, so their boxes sit further in.
  function bale(kind, x0, x1, h) { return item(kind, x0, x1, h, 0.12, 0.04); }
  var GROUPS = {
    // Fences and bales are lower in the gentle first stretch. A fence's posts are drawn
    // 0.05 m above its top rail, so its box is already within the drawing.
    fence: { plan: 'jump', make: function (r, k, x) { return [item('fence', 0, 0.55, x < GENTLE ? 0.7 : 0.9, 0.02, 0)]; } },
    // Round bales side by side: one at first, up to three further on.
    hay: {
      plan: 'jump', make: function (r, k, x) {
        var n = 1 + Math.floor(r() * (x < 600 ? 1 : x < 1500 ? 2 : 3)), out = [];
        for (var i = 0; i < n; i++) out.push(bale('hay', i, i + 1, x < GENTLE ? 0.75 : 0.85));
        return out;
      },
    },
    puddle: { plan: 'jump', make: function (r, k, x) { return [{ kind: 'puddle', x0: 0, x1: (x < GENTLE ? 1.2 : 1.5) + Math.floor(r() * 10) / 10 * k }]; } },
    // A parked tractor, and further on sometimes a trailer of hay behind it.
    tractor: {
      plan: 'double', make: function (r, k, x) {
        // Two boxes: the tall cab over the big back wheel (drawn 0.1 to 1.05 m along, 1.4 m
        // high) and the low bonnet (drawn 0.9 m along to the front, 0.95 m high). The thin
        // exhaust pipe on the bonnet is scenery and does not count.
        var out = [{ kind: 'tractor', x0: 0, x1: 2.2, h: 1.4, boxes: [{ x0: 0.15, x1: 1, h: 1.35 }, { x0: 1, x1: 2.15, h: 0.9 }] }];
        // The trailer's hay load is drawn 0.1 m in from each end, 1 m high.
        if (x >= 1000 && r() < 0.5) out.push(item('trailer', 2.2, 3.5, 1, 0.12, 0.03));
        return out;
      },
    },
    fences: { plan: 'double', make: function (r, k) { return [item('fence', 0, 0.55, 0.9, 0.02, 0), item('fence', 0.55 + 1.35 * k, 1.1 + 1.35 * k, 0.9, 0.02, 0)]; } },
    // A leafy bough drawn with its lower corners rounded 0.5 m: its box is narrower, and
    // 0.04 m higher, than the outline.
    branch: { plan: 'stay', make: function (r, k) { return [{ kind: 'branch', x0: 0, x1: 1.6 * k, y0: 1, boxes: [{ x0: 0.25, x1: 1.6 * k - 0.25, y0: 1.04 }] }]; } },
    stack: { plan: 'double', make: function () { return [bale('stack', 0, 1.1, 1.95)]; } },
  };
  var FIRST = 40; // where the first obstacle stands

  // How likely each group is at distance x.
  function weights(x) {
    if (x < GENTLE) return { fence: 5, puddle: 3, hay: 2 };
    if (x < 450) return { fence: 4, puddle: 3, hay: 3, tractor: 1.5, fences: 1 };
    if (x < 1000) return { fence: 3, puddle: 2, hay: 3, tractor: 2, fences: 2, branch: x >= 650 ? 2 : 0 };
    return { fence: 3, puddle: 2, hay: 2.5, tractor: 2, fences: 2, branch: 2.5, stack: 2 };
  }
  // The clear time between one group and the next, in seconds, before a random stretch of up to SPREAD more.
  function minGap(x) {
    if (x < GENTLE) return 1.9;
    return 1.35 - 0.65 * (x >= RAMP ? 1 : x / RAMP);
  }
  var SPREAD = 0.5;
  var AFTER_DOUBLE = 0.3; // extra clear time after a group that takes a double jump, which lands later

  /*
   * The day's course: { groups, items } in order along the way. It is built on demand as
   * far as it is needed, so it never runs out. newCourse builds a fresh copy; courseFor
   * keeps one per day.
   */
  function newCourse(day) {
    var c = { day: day, rand: rng(seedFor(day, 0x9e3779b9)), groups: [], items: [], next: FIRST, last: '' };
    extend(c, 200);
    return c;
  }
  var courses = {};
  function courseFor(day) {
    return courses[day] || (courses[day] = newCourse(day));
  }
  // Add groups until the course reaches at least x metres.
  function extend(c, x) {
    while (c.next < x) addGroup(c);
  }
  function addGroup(c) {
    var r = c.rand, at = c.next, w = weights(at);
    // Any group but the one just placed, except that fences may follow fences.
    var keys = Object.keys(w).filter(function (k) { return w[k] > 0 && (k !== c.last || k === 'fence'); });
    var total = keys.reduce(function (sum, k) { return sum + w[k]; }, 0), roll = r() * total, kind = keys[keys.length - 1];
    for (var i = 0; i < keys.length; i++) {
      roll -= w[keys[i]];
      if (roll < 0) { kind = keys[i]; break; }
    }
    var g = GROUPS[kind], items = g.make(r, speedAt(at) / V0, at).map(function (it) {
      var o = { kind: it.kind, x0: at + it.x0, x1: at + it.x1 };
      if (it.h !== undefined) o.h = it.h;
      if (it.y0 !== undefined) o.y0 = it.y0;
      if (it.boxes) {
        o.boxes = it.boxes.map(function (b) {
          return b.h !== undefined ? { x0: at + b.x0, x1: at + b.x1, h: b.h } : { x0: at + b.x0, x1: at + b.x1, y0: b.y0 };
        });
      }
      return o;
    });
    var end = items[items.length - 1].x1;
    c.groups.push({ kind: kind, plan: g.plan, x0: at, x1: end, items: items });
    items.forEach(function (it) { c.items.push(it); });
    c.last = kind;
    var gap = minGap(at) * (1 + r() * SPREAD) + (g.plan === 'double' ? AFTER_DOUBLE : 0);
    c.next = end + gap * speedAt(end);
  }

  // ---- a run

  /*
   * A new run on the day's course. The fields are plain numbers so a run can be copied
   * with clone(). `events`, if a list, collects what happened for the page to animate.
   */
  function newRun(day, events) {
    return {
      day: day, course: courseFor(day), step: 0, x: 0, y: 0, vy: 0, px: 0, py: 0,
      air: false, hopped: false, buffer: 0, queued: false, over: false, hit: null, mark: -1, next: 0,
      events: events === undefined ? [] : events,
    };
  }
  function clone(run) {
    return {
      day: run.day, course: run.course, step: run.step, x: run.x, y: run.y, vy: run.vy, px: run.px, py: run.py,
      air: run.air, hopped: run.hopped, buffer: run.buffer, queued: run.queued, over: run.over, hit: run.hit,
      mark: run.mark, next: run.next, events: null,
    };
  }

  // A press of the button. It acts on the next step.
  function press(run) {
    if (!run.over) run.queued = true;
  }

  function emit(run, type, extra) {
    if (!run.events) return;
    var e = { type: type, step: run.step, x: run.x, y: run.y };
    if (extra) for (var k in extra) e[k] = extra[k];
    run.events.push(e);
  }
  function jump(run) {
    run.air = true;
    run.vy = JUMP * tempoAt(run.x);
    emit(run, 'jump');
  }

  // Advance the run by one step.
  function step(run) {
    if (run.over) return;
    run.px = run.x;
    run.py = run.y;
    if (run.queued) {
      run.queued = false;
      if (!run.air) jump(run);
      else if (!run.hopped) {
        run.hopped = true;
        run.vy = (run.vy > 0 ? run.vy * HOP_KEEP : 0) + HOP * tempoAt(run.x);
        emit(run, 'hop');
      } else run.buffer = BUFFER;
    }
    run.x += speedAt(run.x) / HZ;
    if (run.air) {
      var t = tempoAt(run.x);
      run.vy -= GRAVITY * t * t;
      run.y += run.vy;
      if (run.y <= 0) {
        run.y = 0;
        run.vy = 0;
        run.air = false;
        run.hopped = false;
        emit(run, 'land');
        if (run.buffer > 0) { run.buffer = 0; jump(run); }
      }
    }
    if (run.buffer > 0) run.buffer--;

    var c = run.course, items = c.items;
    if (c.next < run.x + 100) extend(c, run.x + 200);
    while (items[run.next].x1 < run.x - BODY_HALF) run.next++;
    for (var i = run.next; items[i].x0 < run.x + BODY_HALF; i++) {
      if (hits(run, items[i])) {
        run.over = true;
        run.hit = items[i];
        emit(run, 'crash', { kind: items[i].kind });
        break;
      }
    }
    while (run.mark + 1 < LANDMARKS.length && run.x >= LANDMARKS[run.mark + 1].m) {
      run.mark++;
      emit(run, 'landmark', { index: run.mark });
    }
    run.step++;
  }

  // Whether the runaway touches the item: one of its boxes, or for a puddle, the water.
  function hits(run, it) {
    // A puddle: the feet (the middle of the hitbox) touch water away from its edges.
    if (!it.boxes) return !run.air && run.x + 0.12 > it.x0 + 0.15 && run.x - 0.12 < it.x1 - 0.15;
    for (var i = 0; i < it.boxes.length; i++) {
      var b = it.boxes[i];
      if (run.x + BODY_HALF <= b.x0 || run.x - BODY_HALF >= b.x1) continue;
      if (b.y0 !== undefined ? run.y + BODY_H > b.y0 : run.y < b.h) return true;
    }
    return false;
  }

  // The whole distance of a run, in whole metres.
  function distance(run) { return Math.floor(run.x); }

  /*
   * Play a run from the start with presses at the given step numbers, until it ends or
   * `maxSteps` steps have run. The same arguments always give the same run.
   */
  function replay(day, presses, maxSteps, events) {
    var run = newRun(day, events === undefined ? null : events), at = {};
    (presses || []).forEach(function (s) { at[s] = true; });
    var limit = maxSteps === undefined ? 1e7 : maxSteps;
    while (!run.over && run.step < limit) {
      if (at[run.step]) press(run);
      step(run);
    }
    return run;
  }

  // ---- the clock: from real time to steps

  /*
   * The page plays a run in real time through a clock: { run, t0, base, last }. At time t0
   * (in ms) the run was due at step `base`, so the step due at time t is base plus the whole
   * steps since t0. A press at time t acts on the step due at t, however the frames fall, so
   * the same timed presses give the same run at any frame rate. Steps are never skipped: if
   * more than STALL_MS pass between two calls (a stalled or busy device), the clock runs
   * nothing and says so, and the page pauses the run where it stands.
   */
  var STALL_MS = 250;
  function newClock(run, now) { return { run: run, t0: now, base: run.step, last: now }; }
  function dueAt(clock, now) { return clock.base + Math.floor((now - clock.t0) * HZ / 1000); }
  // Run every step due by `now`. False, running nothing, after a stall.
  function clockTo(clock, now) {
    if (now - clock.last > STALL_MS) return false;
    if (now > clock.last) clock.last = now;
    var due = dueAt(clock, now);
    while (clock.run.step < due && !clock.run.over) step(clock.run);
    return true;
  }
  // A press at `now`: run the steps due first, so it acts on the step due at `now`. False,
  // with no press, after a stall.
  function clockPress(clock, now) {
    if (!clockTo(clock, now)) return false;
    press(clock.run);
    return true;
  }
  // Carry on from the step the run stands at, as if it were due at `now`.
  function clockResume(clock, now) {
    clock.t0 = now;
    clock.base = clock.run.step;
    clock.last = now;
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

  // ---- runs, scoring, sharing and stats

  /*
   * A day's runs are a list of { id, m, live }: the distance in metres, and live while the
   * run is still going. Two copies (from two tabs) merge by id: the further distance wins,
   * and a run either copy has ended is ended.
   */
  function mergeRuns(a, b) {
    var out = a.map(function (r) { return { id: r.id, m: r.m, live: r.live }; });
    b.forEach(function (r) {
      var mine = out.filter(function (o) { return o.id === r.id; })[0];
      if (!mine) out.push({ id: r.id, m: r.m, live: r.live });
      else {
        mine.m = Math.max(mine.m, r.m);
        mine.live = mine.live && r.live;
      }
    });
    return out;
  }
  function best(runs) {
    return runs.reduce(function (m, r) { return Math.max(m, r.m); }, 0);
  }

  var BARS = '▁▂▃▄▅▆▇█';
  // One bar per run, its height the run's share of the best.
  function bars(runs) {
    var top = best(runs);
    return runs.map(function (r) {
      var level = top > 0 ? Math.max(1, Math.ceil(r.m / top * 8)) : 1;
      return BARS.charAt(level - 1);
    }).join('');
  }

  // "Hazel reached the creek", or how far a run that reached no landmark got.
  function reachedLine(name, m) {
    var i = landmarkAt(m);
    if (i < 0) return name + ' got out the gate';
    if (i === LANDMARKS.length - 1) return name + ' made it to ' + LANDMARKS[i].name;
    return name + ' reached ' + LANDMARKS[i].name;
  }

  // The result as text: the best distance, the furthest landmark and a bar per run.
  function shareText(day, runs, url) {
    var a = animalFor(day), top = best(runs);
    var out = ['Bolt #' + day + ' ' + a.emoji + ' ' + top + ' m', reachedLine(a.name, top), bars(runs)];
    if (url) out.push(url);
    return out.join('\n');
  }

  function emptyStats() {
    return { played: 0, total: 0, streak: 0, bestStreak: 0, best: 0, lastDay: 0, marks: LANDMARKS.map(function () { return 0; }) };
  }

  /*
   * Record a day's best distance. `total` is the sum of the days' bests, for the average.
   * The streak counts days played in a row. `marks` counts, per landmark, the days it was
   * reached. A day that is not later than the last one recorded changes nothing, so a day
   * is counted once and a clock set back cannot count an earlier day.
   */
  function recordResult(stats, day, m) {
    if (day <= stats.lastDay) return stats;
    var s = { played: stats.played + 1, total: stats.total + m, best: Math.max(stats.best, m), lastDay: day, marks: stats.marks.slice() };
    s.streak = stats.lastDay === day - 1 ? stats.streak + 1 : 1;
    s.bestStreak = Math.max(stats.bestStreak, s.streak);
    for (var i = 0; i <= landmarkAt(m); i++) s.marks[i]++;
    return s;
  }

  var api = {
    HZ: HZ, EPOCH: EPOCH, RUNS: RUNS, GRAVITY: GRAVITY, JUMP: JUMP, HOP: HOP, BUFFER: BUFFER,
    BODY_HALF: BODY_HALF, BODY_H: BODY_H, V0: V0, VMAX: VMAX, RAMP: RAMP, TEMPO: TEMPO, GENTLE: GENTLE, FIRST: FIRST,
    ANIMALS: ANIMALS, NAMES: NAMES, LANDMARKS: LANDMARKS, GROUPS: GROUPS,
    speedAt: speedAt, tempoAt: tempoAt, view: view, ahead: ahead, LOOK: LOOK, hits: hits, animalFor: animalFor, landmarkAt: landmarkAt, newCourse: newCourse, courseFor: courseFor, extend: extend,
    newRun: newRun, clone: clone, press: press, step: step, distance: distance, replay: replay,
    STALL_MS: STALL_MS, newClock: newClock, dueAt: dueAt, clockTo: clockTo, clockPress: clockPress, clockResume: clockResume,
    dayNumber: dayNumber, msUntilTomorrow: msUntilTomorrow,
    mergeRuns: mergeRuns, best: best, bars: bars, reachedLine: reachedLine, shareText: shareText,
    emptyStats: emptyStats, recordResult: recordResult,
  };
  root.Bolt = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
