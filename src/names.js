/* ============================================================
   Matching a name the party actually heard.

   Not in the original handoff, and it should have been. The premise of the whole
   tool is that players do not know what they fought — but a DM narrates, and
   narration contains nouns. "The barghest lunges at you" tells a table the word
   *barghest* without telling them it is a creature in a book with a statblock and
   a poison immunity. Plenty of players will have a name and no idea it is one.

   THIS IS NOT APPEARANCE, and folding it into F10 would get it wrong twice over.
   A description is tier 3 — capped, never subtracting, because the DM reflavours.
   A name the DM said out loud is close to conclusive: it earns a much larger
   bonus. It still cannot be a filter, because the DM may have invented the name,
   renamed something, or the player may have misheard it.

   Which is why matching is deliberately forgiving. Names arrive through the air,
   at a table, once. People write down "barghast", "owl bear", "gelatinous cube
   thing". So: exact forms first, then whole-string fuzzy matching for spelling,
   then per-token scoring weighted by how distinctive each token is across the
   corpus of names — because "giant" appears in 180 names and "barghest" in one,
   and a player who heard only "some kind of giant" has still narrowed it usefully.
   ============================================================ */
(function (root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else Object.assign(root, api);
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const asArray = v => (v == null ? [] : Array.isArray(v) ? v : [v]);
  const norm = s => String(s == null ? "" : s).toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "").replace(/[\s-]+/g, " ").trim();
  const words = s => norm(s).split(" ").filter(Boolean);

  /* Words that carry no identifying force in a monster name. Not general stop words —
     "of" and "the" specifically, plus the qualifiers 5e.tools appends to variants. */
  const NAME_STOP = new Set(["of", "the", "a", "an", "and"]);

  /* Levenshtein, capped: anything past `max` is "not a match" and there is no reason to
     finish computing how far past. Names are short, so this stays cheap over the corpus. */
  function editDistance(a, b, max) {
    if (a === b) return 0;
    if (Math.abs(a.length - b.length) > max) return max + 1;
    let prev = new Array(b.length + 1);
    let cur = new Array(b.length + 1);
    for (let j = 0; j <= b.length; j++) prev[j] = j;
    for (let i = 1; i <= a.length; i++) {
      cur[0] = i;
      let best = cur[0];
      for (let j = 1; j <= b.length; j++) {
        cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
        if (cur[j] < best) best = cur[j];
      }
      if (best > max) return max + 1;
      const t = prev; prev = cur; cur = t;
    }
    return prev[b.length];
  }

  /* How much spelling slack to give, by length. "orc" must not match "ord"; "gelatinous"
     can afford two wrong letters, because it was heard rather than read. */
  const slackFor = n => (n <= 4 ? 0 : n <= 6 ? 1 : n <= 10 ? 2 : 3);

  function buildNameIndex(monsters) {
    const df = Object.create(null);
    const entries = asArray(monsters).map(m => {
      /* Every string this creature answers to. `alias` covers the handful the books
         give two names ("Liondrake" is a Dragonne), and shortName is what a statblock
         calls it in its own action text. */
      const forms = [m.name].concat(asArray(m.alias), m.shortName ? [m.shortName] : [])
        .map(norm).filter(Boolean);
      const toks = [...new Set(words(m.name).filter(w => !NAME_STOP.has(w)))];
      toks.forEach(t => { df[t] = (df[t] || 0) + 1; });
      return { key: m.key, name: m.name, forms: [...new Set(forms)], tokens: toks };
    });

    const N = entries.length || 1;
    // "giant" is in ~180 names and "barghest" in one. Weight accordingly.
    const idf = t => Math.log(1 + N / (1 + (df[t] || 0)));
    return { entries, df, N, idf };
  }

  /* Returns a Map of key -> [0,1]. 1 means "this is that name"; lower means the words
     overlap. Never filters and never returns negatives — a name the corpus has never
     heard of simply matches nothing, which is the right answer for homebrew. */
  function nameScore(query, index) {
    const out = new Map();
    const q = norm(query);
    if (!q || !index) return out;
    const qTokens = words(q).filter(w => !NAME_STOP.has(w));
    if (!qTokens.length) return out;

    const qWeight = qTokens.reduce((n, t) => n + index.idf(t), 0) || 1;
    const slack = slackFor(q.length);

    index.entries.forEach(e => {
      let score = 0;

      for (const form of e.forms) {
        if (form === q) { score = 1; break; }
        /* Spelling. Only against whole forms — running fuzzy matching per token would
           make "fire" match "fine", "five" and "hire" and drown the signal. */
        if (slack > 0 && editDistance(q, form, slack) <= slack) {
          score = Math.max(score, 0.92);
        }
        // "gelatinous cube thing" should still find the Gelatinous Cube.
        if (score < 0.9 && form.length > 4 && q.includes(form)) score = Math.max(score, 0.85);
      }

      if (score < 0.85 && e.tokens.length) {
        /* Partial overlap, weighted by how distinctive the shared words are. Scaled by
           BOTH how much of the query is explained and how much of the name is covered,
           so "giant" does not score full marks against "Fire Giant Dreadnought". */
        const shared = qTokens.filter(t => e.tokens.includes(t));
        if (shared.length) {
          const w = shared.reduce((n, t) => n + index.idf(t), 0);
          const nameWeight = e.tokens.reduce((n, t) => n + index.idf(t), 0) || 1;
          score = Math.max(score, 0.8 * (w / qWeight) * (0.5 + 0.5 * (w / nameWeight)));
        }
      }

      if (score > 0.02) out.set(e.key, score);
    });
    return out;
  }

  /* Does what the user typed look like a creature's name at all? The UI asks this so it
     can say "that matched a monster called X" instead of silently reweighting the list —
     a strong nudge the user did not ask for should be visible and dismissible. */
  function looksLikeName(query, index, threshold) {
    const scores = nameScore(query, index);
    let bestKey = null, best = 0;
    scores.forEach((v, k) => { if (v > best) { best = v; bestKey = k; } });
    if (!bestKey || best < (threshold == null ? 0.8 : threshold)) return null;
    const entry = index.entries.find(e => e.key === bestKey);
    return { key: bestKey, name: entry ? entry.name : bestKey, score: best, exact: best >= 1 };
  }

  return { norm, words, editDistance, slackFor, buildNameIndex, nameScore, looksLikeName, NAME_STOP };
});
