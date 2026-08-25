/* ============================================================
   F8 — the symptom ontology, applied.

   The problem this solves: the DM will not say "it has Regeneration." The DM
   says the wounds closed. Players report *observable consequences*, and the
   bestiary is indexed by *mechanic names*. Nothing joins the two.

   So: `ontology/symptoms.json` is a hand-curated map from what a player would
   say to the set of mechanics that could produce it — with a likelihood on each
   edge, because a symptom almost never has one cause. "It healed between rounds"
   is Regeneration, or a leech attack, or a healing trait, or a potion, and the
   ontology says all four with different weights rather than picking one.

   This file is the interpreter. It compiles the ontology once, then tags each
   monster with the symptoms its statblock could produce. Those tags become
   ordinary features on the monster, so the F1 scorer picks them up through the
   existing `symptom` facet and needs no changes at all — an opaque mechanic ends
   up scored by exactly the same rarity maths as a burrow speed.

   Two layers, in the order the handoff specifies:

     1. 5e.tools' own traitTags/actionTags, where they exist. Free and exact —
        "Regeneration", "Pack Tactics", "Undead Fortitude" are already labelled.
        But there are only 50 trait tags and 8 action tags in the whole corpus,
        so they cover the head and nothing else.
     2. Regex over the trait and action prose, for the long tail. Lower
        precision, which is why matches carry a likelihood rather than a boolean.

   WHY CONFIDENCE, NOT A BOOLEAN: a tagTag hit is near-certain; a prose regex hit
   is a guess. Collapsing both to "has symptom" throws that distinction away and
   makes the scorer trust a loose keyword match as much as a curated label. The
   confidence multiplies the credit, so a strong match earns full rarity weight
   and a weak one earns a fraction of it.
   ============================================================ */
(function (root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else Object.assign(root, api);
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const asArray = v => (v == null ? [] : Array.isArray(v) ? v : [v]);
  const norm = s => String(s == null ? "" : s).trim().toLowerCase();

  /* Entry kinds a candidate can be scoped to with `where`. Default is all of them:
     the same mechanic shows up as a trait on one monster and an action on another,
     and a player watching the fight cannot tell which. */
  const ENTRY_KINDS = {
    trait: m => m.traits,
    action: m => m.actions,
    bonus: m => m.bonusActions,
    reaction: m => m.reactions,
    legendary: m => m.legendary,
    spellcasting: m => m.spellcasting,
    /* Damage and condition interactions, as a synthetic entry. The qualifying note is
       where the interesting part lives and it is prose, not a flat list: "immune to fire"
       and "immune to bludgeoning from nonmagical attacks that aren't silvered" are very
       different facts to a player whose weapon bounced off. */
    defence: m => [{
      name: "Damage and condition interactions",
      text: [
        m.resistText ? "Resistant to " + m.resistText : "",
        m.immuneText ? "Immune to " + m.immuneText : "",
        m.vulnerableText ? "Vulnerable to " + m.vulnerableText : "",
        (m.conditionImmune || []).length ? "Cannot be " + m.conditionImmune.join(", ") : "",
      ].filter(Boolean).join("\n"),
    }],
  };
  const ALL_KINDS = Object.keys(ENTRY_KINDS);
  /* `where: ["mechanics"]` — everything the monster DOES, excluding the defence block.
     This distinction is load-bearing, not tidiness. "Inflicts frightened" and "cannot be
     frightened" are opposite facts that share a word, so a symptom about being frightened
     scanning the defence block matches every creature immune to fear — which is exactly
     backwards. Scoping by intent is reliable; negative lookarounds over a comma-separated
     immunity list are not. */
  const MECHANIC_KINDS = ALL_KINDS.filter(k => k !== "defence");
  const WHERE_ALIASES = { mechanics: MECHANIC_KINDS, any: ALL_KINDS };

  /* ============================================================
     Structural predicates — `field` in the ontology.

     These read the normalised record directly, for symptoms whose real evidence
     is a stat and not prose. "It felt me through the floor" is tremorsense, and
     tremorsense is a sense entry, not a sentence in a trait.
     ============================================================ */
  const FIELD_TESTS = {
    speed: (m, arg) => (m.speeds || {})[arg] > 0,
    hover: m => !!m.hover,
    sense: (m, arg) => (m.senseTags || []).some(s => norm(s).includes(arg)),
    condimmune: (m, arg) => (m.conditionImmune || []).some(c => norm(c) === arg),
    immune: (m, arg) => (m.immune || []).some(d => norm(d) === arg),
    resist: (m, arg) => (m.resist || []).some(d => norm(d) === arg),
    vulnerable: (m, arg) => (m.vulnerable || []).some(d => norm(d) === arg),
    dealsdamage: (m, arg) => (m.damageTags || []).some(d => norm(d) === arg),
    type: (m, arg) => norm(m.type) === arg,
    size: (m, arg) => (m.size || []).some(s => norm(s) === arg),
    lair: m => !!m.hasLair,
    legendary: m => (m.legendary || []).length > 0,
    spellcasting: m => (m.spellcasting || []).length > 0,
    language: (m, arg) => (m.languages || []).some(l => norm(l).includes(arg)),
    // Reach beyond 5 ft on any attack: "it hit me from further away than it should have".
    reach: (m, arg) => [].concat(m.actions || [], m.legendary || [], m.reactions || [])
      .some(a => (a.reach || 0) >= Number(arg)),
  };

  function testField(m, spec) {
    const i = spec.indexOf(".");
    const name = norm(i < 0 ? spec : spec.slice(0, i));
    const arg = i < 0 ? "" : norm(spec.slice(i + 1));
    const fn = FIELD_TESTS[name];
    return fn ? !!fn(m, arg) : false;
  }

  /* ============================================================
     Compilation

     Regexes are compiled once for the whole corpus rather than per monster.
     There are ~130 symptoms with several patterns each, against ~4,500 monsters
     with ~10 entries apiece; rebuilding these per test would dominate the run.

     Compiled with `is`: case-insensitive because prose capitalisation varies
     between the 2014 and 2024 statblock styles ("hit points" vs "Hit Points"),
     and dotAll because entry text is newline-joined and a pattern spanning a
     sentence break is otherwise silently dead.
     ============================================================ */
  function compileRe(src) {
    try { return new RegExp(src, "is"); }
    catch (e) { return null; }          // a bad pattern disables its candidate, never the run
  }

  function expandWhere(where) {
    const out = [];
    asArray(where).forEach(k => {
      const alias = WHERE_ALIASES[k];
      if (alias) alias.forEach(x => { if (!out.includes(x)) out.push(x); });
      else if (ENTRY_KINDS[k] && !out.includes(k)) out.push(k);
    });
    return out;
  }

  function compile(ontology) {
    const symptoms = asArray(ontology && ontology.symptoms).map(s => ({
      id: s.id,
      player: s.player || s.id,
      aka: asArray(s.aka),
      group: s.group || "",
      testable: !!s.testable,
      volatile: !!s.volatile,
      /* Another module asks for this observation better — see the ontology's `about`.
         Carried through compile rather than read off the raw JSON, because the UI only
         ever sees the compiled ontology. */
      collectedBy: s.collectedBy || "",
      candidates: asArray(s.candidates).map(c => {
        const out = {
          mechanic: c.mechanic || "",
          p: typeof c.p === "number" ? Math.max(0, Math.min(1, c.p)) : 0.5,
          traitTag: c.traitTag ? norm(c.traitTag) : null,
          actionTag: c.actionTag ? norm(c.actionTag) : null,
          field: c.field || null,
          text: c.text ? compileRe(c.text) : null,
          name: c.name ? compileRe(c.name) : null,
          unless: c.unless ? compileRe(c.unless) : null,
          where: expandWhere(c.where),
        };
        /* A candidate with no working predicate would match every monster in the corpus —
           the failure mode is silent and maximally wrong, so it is disabled here rather
           than left to fire. Two ways to get one: an author writes a candidate with no
           matcher at all, or a regex fails to compile and leaves the field null. */
        out.dead = !out.traitTag && !out.actionTag && !out.field && !out.text && !out.name;
        out.badPattern = !!((c.text && !out.text) || (c.name && !out.name) || (c.unless && !out.unless));
        return out;
      }),
    })).filter(s => s.id);

    const byId = Object.create(null);
    symptoms.forEach(s => { byId[s.id] = s; });
    const problems = [];
    symptoms.forEach(s => s.candidates.forEach(c => {
      if (c.badPattern) problems.push(`${s.id}: candidate "${c.mechanic}" has a regex that won't compile`);
      else if (c.dead) problems.push(`${s.id}: candidate "${c.mechanic}" matches nothing`);
    }));
    /* The ids whose mechanic a GM adds and removes freely (handoff §7). Handed to the
       scorer as a set so score.js never has to know an ontology id by name — which
       symptoms are volatile is a data question, and it stays in the data. */
    const volatileIds = new Set(symptoms.filter(s => s.volatile).map(s => s.id));
    return { symptoms, byId, problems, idf: buildIdf(symptoms), volatileIds,
             version: (ontology && ontology.version) || 0 };
  }

  /* ============================================================
     Tagging
     ============================================================ */
  /* Every entry of a monster, bucketed by kind and flattened once. Built per monster
     rather than per candidate: ~130 symptoms with several candidates each, over ~4,500
     monsters, means the concatenation would otherwise run millions of times. */
  function entryBank(m) {
    const bank = { all: [] };
    ALL_KINDS.forEach(k => {
      const list = asArray(ENTRY_KINDS[k](m)).filter(Boolean);
      bank[k] = list;
      list.forEach(e => bank.all.push(e));
    });
    return bank;
  }
  function entriesFor(bank, where) {
    if (!where || !where.length) return bank.all;
    if (where.length === 1) return bank[where[0]] || [];
    const out = [];
    where.forEach(k => (bank[k] || []).forEach(e => out.push(e)));
    return out;
  }

  /* One candidate against one monster. Returns the entry that fired, or null.
     Every predicate present on the candidate must hold — they are ANDed, so a
     candidate can say "prose mentions swallowing AND the thing is Huge". */
  function candidateFires(m, c, tagSets, bank) {
    if (c.dead || c.badPattern) return null;
    if (c.traitTag && !tagSets.trait.has(c.traitTag)) return null;
    if (c.actionTag && !tagSets.action.has(c.actionTag)) return null;
    if (c.field && !testField(m, c.field)) return null;

    if (!c.text && !c.name) return { via: c.traitTag || c.actionTag || c.field, entry: "" };

    const entries = entriesFor(bank, c.where);
    for (let i = 0; i < entries.length; i++) {
      const e = entries[i];
      const nm = e.name || "";
      const body = nm + "\n" + (e.text || "");
      if (c.name && !c.name.test(nm)) continue;
      if (c.text && !c.text.test(body)) continue;
      if (c.unless && c.unless.test(body)) continue;
      return { via: "prose", entry: nm };
    }
    return null;
  }

  /* Tag one monster. Confidence for a symptom is the MAX over the mechanics that
     could explain it, not the sum: two independent ways to produce the same
     observable does not make the observation twice as likely, and summing would
     let a monster with several weak partial matches outrank one with the real
     mechanic. */
  function tagMonster(m, compiled) {
    const tagSets = {
      trait: new Set((m.traitTags || []).map(norm)),
      action: new Set((m.actionTags || []).map(norm)),
    };
    const bank = entryBank(m);
    const symptoms = [], confidence = Object.create(null), evidence = Object.create(null);
    compiled.symptoms.forEach(s => {
      let best = 0;
      const hits = [];
      s.candidates.forEach(c => {
        const fired = candidateFires(m, c, tagSets, bank);
        if (!fired) return;
        hits.push({ mechanic: c.mechanic, p: c.p, via: fired.via, entry: fired.entry });
        if (c.p > best) best = c.p;
      });
      if (!hits.length || best <= 0) return;
      symptoms.push(s.id);
      confidence[s.id] = best;
      evidence[s.id] = hits.sort((a, b) => b.p - a.p);
    });
    return { symptoms, symptomConf: confidence, symptomWhy: evidence };
  }

  /* Tag the whole corpus in place. Returns the monsters for chaining. */
  function tagAll(monsters, compiled) {
    monsters.forEach(m => {
      const t = tagMonster(m, compiled);
      m.symptoms = t.symptoms;
      m.symptomConf = t.symptomConf;
      m.symptomWhy = t.symptomWhy;
    });
    return monsters;
  }

  /* ============================================================
     Lookup — the ontology read backwards, for the UI.

     The player types what they saw in their own words. This finds the symptom
     chips to offer them. Deliberately forgiving and deliberately dumb: token
     overlap against the symptom's own phrasing plus its `aka` list, no stemming
     and no embeddings. F9's embedding fallback is the answer for what this
     misses; making this layer cleverer would blur the line between them.
     ============================================================ */
  const STOP = new Set(["it", "its", "the", "a", "an", "was", "were", "is", "i", "me", "my",
    "and", "of", "to", "at", "in", "on", "when", "then", "that", "this", "with", "did", "do",
    "had", "has", "have", "got", "get", "we", "us", "our", "they", "them", "he", "she", "him", "her"]);
  const tokens = s => norm(s).replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter(t => t && !STOP.has(t));

  /* Every phrasing a symptom can be found by: what a player would say, the alternates,
     and the id itself. The id is written as a sentence for exactly this reason
     (`it-felt-me-through-the-floor`), and leaving it out lost matches where the id said
     the thing more plainly than the prose did. */
  const phrasesOf = s => [s.player].concat(s.aka, [s.id.replace(/-/g, " ")]);

  /* Token weights, by how distinctive each word is across the ontology's own phrasings.
     Plain overlap counts "through" for as much as "burrowed", and since half the movement
     symptoms say "through" and half the forced-movement ones say "away", the commonest
     words decided the ranking. "It felt me through the floor" matched *walking through a
     wall*, on the strength of "through the floor" alone.

     Standard IDF, computed once at compile time over a few hundred short phrases. */
  function buildIdf(symptoms) {
    const df = Object.create(null);
    let docs = 0;
    symptoms.forEach(s => phrasesOf(s).forEach(p => {
      docs++;
      new Set(tokens(p)).forEach(t => { df[t] = (df[t] || 0) + 1; });
    }));
    const total = docs || 1;
    return t => Math.log((total + 1) / ((df[t] || 0) + 1)) + 0.2;   // floor keeps unseen words usable
  }

  function lookup(compiled, query, limit) {
    const q = tokens(query);
    if (!q.length) return [];
    const idf = compiled.idf || (() => 1);
    const qWeight = q.reduce((n, t) => n + idf(t), 0) || 1;

    const scored = compiled.symptoms.map(s => {
      let best = 0;
      phrasesOf(s).forEach(p => {
        const t = tokens(p);
        if (!t.length) return;
        const set = new Set(t);
        const matched = q.filter(w => set.has(w));
        if (!matched.length) return;
        const hitWeight = matched.reduce((n, w) => n + idf(w), 0);
        const phraseWeight = t.reduce((n, w) => n + idf(w), 0) || 1;
        /* Balance recall against precision: how much of what the user said was explained,
           and how much of the phrase was used. Without the second term a one-word hit on a
           long phrase would rank as high as an exact match. */
        const score = hitWeight / qWeight * 0.6 + hitWeight / phraseWeight * 0.4;
        if (score > best) best = score;
      });
      return { id: s.id, player: s.player, group: s.group, score: best };
    }).filter(x => x.score > 0);
    scored.sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
    return limit ? scored.slice(0, limit) : scored;
  }

  /* THE MECHANICS A SYMPTOM IS ACTUALLY LOOKING FOR, named.

     A player picking "It was much more dangerous when its friends were nearby" cannot
     tell whether the tool understood them, because the sentence deliberately avoids
     saying "Pack Tactics" — that is the whole point of the ontology. The cost is that
     eleven sentences in the offence group read as vague near-synonyms of each other,
     and picking between them is guesswork.

     So the UI shows the mechanic names in brackets. Derived here rather than written
     into the JSON as a label field, because a hand-written label is a second copy of
     the candidate list and would silently stop matching it the first time someone adds
     a candidate.

     Ordered by p — the strongest explanation first, since that is the one most likely
     to be what the party actually met. */
  function mechanicsOf(symptom, limit) {
    const seen = new Set();
    const names = (symptom && symptom.candidates || [])
      .slice()
      .sort((a, b) => (b.p || 0) - (a.p || 0))
      .map(c => String(c.mechanic || "").trim())
      .filter(m => {
        if (!m || seen.has(m.toLowerCase())) return false;
        seen.add(m.toLowerCase());
        return true;
      });
    const n = limit == null ? 3 : limit;
    return { shown: names.slice(0, n), more: Math.max(0, names.length - n) };
  }

  /* "Pack Tactics", or "charm, domination, possession +1". Empty string when the
     symptom has no candidates at all, so callers can concatenate it unconditionally. */
  function mechanicsLabel(symptom, limit) {
    const { shown, more } = mechanicsOf(symptom, limit);
    if (!shown.length) return "";
    return shown.join(", ") + (more ? ` +${more}` : "");
  }

  /* Corpus-wide coverage report. Used by the ontology's own test: a symptom that
     matches nothing is dead weight, and one that matches nearly everything is
     worse than dead — it dilutes the rarity table it feeds. */
  function coverage(monsters, compiled) {
    const rows = compiled.symptoms.map(s => ({ id: s.id, group: s.group, count: 0, strong: 0 }));
    const byId = Object.create(null);
    rows.forEach(r => { byId[r.id] = r; });
    monsters.forEach(m => (m.symptoms || []).forEach(id => {
      const r = byId[id];
      if (!r) return;
      r.count++;
      if ((m.symptomConf || {})[id] >= 0.8) r.strong++;
    }));
    const total = monsters.length || 1;
    rows.forEach(r => { r.fraction = r.count / total; });
    return {
      total,
      rows: rows.sort((a, b) => b.count - a.count),
      dead: rows.filter(r => r.count === 0).map(r => r.id),
      ubiquitous: rows.filter(r => r.fraction > 0.5).map(r => r.id),
    };
  }

  return { ENTRY_KINDS, ALL_KINDS, FIELD_TESTS, testField, compile, tagMonster, tagAll, lookup,
           mechanicsOf, mechanicsLabel, coverage };
});
