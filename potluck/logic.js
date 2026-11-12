/*
 * Potluck game rules. No DOM in here: app.js draws the page, this file decides the day's
 * dish, how a guess is marked, what is on show, the share text and the stats. Works as a
 * plain <script> in the browser and via require() in Node.
 *
 * The game: one dish a day, the same for everyone. Its six ingredients are revealed one at
 * a time, least telling first. The player has six goes; each is a guess or a skip, and
 * every wrong guess or skip shows the next ingredient.
 */
(function (root) {
  'use strict';

  var MAX_GUESSES = 6;
  var INGREDIENTS = 6;
  // The ingredient from which the card also says which part of the world the dish is from.
  var REGION_FROM = 4;
  // Day 1, as a local calendar date.
  var EPOCH = { year: 2026, month: 11, day: 13 };

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
  // The id of the dish for a day. The schedule repeats when it runs out.
  function answerId(day, schedule) {
    var n = schedule.length;
    return schedule[(((day - 1) % n) + n) % n];
  }

  // ---- search

  // Lower case, accents and punctuation dropped: "Chè chuối" and "che-chuoi" both become "che chuoi",
  // and "Kısır" becomes "kisir".
  function fold(s) {
    return String(s).toLowerCase().replace(/ı/g, 'i').replace(/[øœ]/g, 'o').replace(/æ/g, 'ae').replace(/ß/g, 'ss').replace(/ł/g, 'l').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
  }

  // The dish whose name or one of whose aliases is exactly what the player typed, or null.
  function exactMatch(dishes, query) {
    var q = fold(query);
    if (!q) return null;
    for (var i = 0; i < dishes.length; i++) {
      var d = dishes[i];
      if (fold(d.name) === q || (d.aliases || []).some(function (a) { return fold(a) === q; })) return d;
    }
    return null;
  }

  /*
   * Dishes matching what the player has typed, best first: the exact name or an exact alias,
   * names that start with the text, names with a word starting with it, then aliases that
   * start with it or have a word that does, then names or aliases containing it anywhere. An
   * empty query gives every dish in alphabetical order.
   */
  function search(dishes, query) {
    var q = fold(query), scored = [];
    dishes.forEach(function (d) {
      var name = fold(d.name), score = -1;
      if (!q) score = 1;
      else if (name === q || (d.aliases || []).some(function (a) { return fold(a) === q; })) score = 0;
      else if (name.indexOf(q) === 0) score = 1;
      else if ((' ' + name).indexOf(' ' + q) >= 0) score = 2;
      else {
        (d.aliases || []).forEach(function (alias) {
          var a = fold(alias);
          if (a === q || a.indexOf(q) === 0 || (' ' + a).indexOf(' ' + q) >= 0) score = 3;
          else if (score < 0 && q.length >= 3 && a.indexOf(q) >= 0) score = 4;
        });
        if ((score < 0 || score > 3) && q.length >= 3 && name.indexOf(q) >= 0) score = 4;
      }
      if (score >= 0) scored.push({ dish: d, score: score, key: name });
    });
    scored.sort(function (x, y) { return x.score - y.score || (x.key < y.key ? -1 : x.key > y.key ? 1 : 0); });
    return scored.map(function (s) { return s.dish; });
  }

  // ---- a day's game

  /*
   * How a go is marked. guess is a dish, or null for a skip.
   *   'correct'  it is the dish
   *   'region'   another dish from the same part of the world
   *   'wrong'    another dish from somewhere else
   *   'skip'     no guess
   */
  function grade(guess, answer) {
    if (!guess) return 'skip';
    if (guess.id === answer.id) return 'correct';
    return guess.region === answer.region ? 'region' : 'wrong';
  }

  // Where a day stands, from its goes so far: { won, done, used }.
  function status(guesses, answer) {
    var won = guesses.some(function (g) { return !!g && g.id === answer.id; });
    return { won: won, done: won || guesses.length >= MAX_GUESSES, used: guesses.length };
  }

  // How many ingredients are on show: one at the start, one more per wrong go, all six once the day is over.
  function shownIngredients(guesses, answer) {
    if (status(guesses, answer).done) return INGREDIENTS;
    return Math.min(INGREDIENTS, guesses.length + 1);
  }
  // Whether the card says where the dish is from.
  function regionShown(guesses, answer) {
    return shownIngredients(guesses, answer) >= REGION_FROM;
  }

  // ---- sharing and stats

  var SQUARES = { skip: '⬛', wrong: '⬜', region: '🟨', correct: '🟩' };

  // The result as text: the score and a square per go, and nothing that names the dish.
  function shareText(day, guesses, answer, url) {
    var st = status(guesses, answer);
    var squares = guesses.map(function (g) { return SQUARES[grade(g, answer)]; }).join('');
    var out = ['Potluck #' + day + ' 🍲 ' + (st.won ? st.used : 'X') + '/' + MAX_GUESSES, squares];
    if (url) out.push(url);
    return out.join('\n');
  }

  // dist[i] counts days won with i + 1 goes.
  function emptyStats() {
    var dist = [];
    for (var i = 0; i < MAX_GUESSES; i++) dist.push(0);
    return { played: 0, won: 0, streak: 0, best: 0, lastDay: 0, dist: dist };
  }

  /*
   * Record a finished day. The streak counts days played in a row, won or not. A day that is
   * not later than the last one recorded changes nothing, so a day is never counted twice
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
    MAX_GUESSES: MAX_GUESSES, INGREDIENTS: INGREDIENTS, REGION_FROM: REGION_FROM, EPOCH: EPOCH, SQUARES: SQUARES,
    dayNumber: dayNumber, msUntilTomorrow: msUntilTomorrow, answerId: answerId,
    fold: fold, search: search, exactMatch: exactMatch,
    grade: grade, status: status, shownIngredients: shownIngredients, regionShown: regionShown,
    shareText: shareText, emptyStats: emptyStats, recordResult: recordResult,
  };
  root.Potluck = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
