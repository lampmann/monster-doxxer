/* ============================================================
   Source metadata for F16's filter.

   The bestiary gives source CODES — "MM", "VGM", "CoS". A filter listing 107 of
   those is unusable, so this turns them into titles, and splits them into the two
   groups the filter actually cares about:

     Books       Monster Manual, Volo's, Mordenkainen's. You either own them or
                 you don't, and that is a stable fact about your table.
     Adventures  Curse of Strahd, Descent into Avernus. These are the spoiler
                 case: a player halfway through one wants its monsters OUT of
                 their results, and the group boundary is what makes that one
                 click rather than ninety-nine.

   Titles come from 5e.tools' own books.json / adventures.json, read from the
   user's data/ at runtime and never committed — same rule as the bestiary. Both
   files are OPTIONAL. Without them the filter still works and simply shows the
   codes, which is worse but not broken, and that is the right failure: the tool
   should not refuse to rank monsters because it cannot pretty-print a book name.
   ============================================================ */
(function (root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else Object.assign(root, api);
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const asArray = v => (v == null ? [] : Array.isArray(v) ? v : [v]);

  /* books/adventures JSON -> { CODE: {name, group} }. Takes the parsed files rather
     than fetching them, so this stays loadable in Node for tests. */
  function buildCatalogue(booksJson, adventuresJson) {
    const byCode = Object.create(null);
    const add = (list, group) => asArray(list).forEach(e => {
      if (!e || !e.id) return;
      byCode[String(e.id).toLowerCase()] = {
        code: e.id, name: e.name || e.id, group,
        published: e.published || "",     // release order, for the legacy tiebreak
      };
    });
    add(booksJson && booksJson.book, "book");
    add(adventuresJson && adventuresJson.adventure, "adventure");
    return byCode;
  }

  /* One row per source actually present in the corpus, with a count. Sources the
     catalogue doesn't know (homebrew, a supplement 5e.tools lists elsewhere) keep
     their bare code and land in "other" rather than being dropped — a filter that
     silently omits a source you have monsters from is worse than an ugly label. */
  function sourceRows(monsters, catalogue) {
    const counts = Object.create(null);
    monsters.forEach(m => {
      const s = m.source || "";
      if (!s) return;
      counts[s] = (counts[s] || 0) + 1;
    });
    const cat = catalogue || {};
    const rows = Object.keys(counts).map(code => {
      const meta = cat[code.toLowerCase()];
      const fallback = FALLBACK_NAMES[code.toUpperCase()];
      return {
        code,
        name: meta ? meta.name : (fallback || code),
        group: meta ? meta.group : "other",
        count: counts[code],
        known: !!meta,
      };
    });
    // Commonest first inside each group: the Monster Manual should not be below an
    // adventure that contributed two statblocks.
    rows.sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
    return rows;
  }

  /* Products 5e.tools ships bestiary files for but does not list in books.json or
     adventures.json — the Plane Shift PDFs, the Monstrous Compendium volumes, a couple
     of one-offs. 346 monsters across 14 codes, every one of which showed in the filter
     as a bare acronym with a tooltip that repeated the acronym back.

     TITLES ONLY, and only for codes that actually fall through. This is bibliographic
     metadata of exactly the kind books.json already carries — a citation, not content —
     and it stays a FALLBACK so a real catalogue entry always wins. If 5e.tools starts
     listing one of these, this table silently stops being consulted for it. */
  const FALLBACK_NAMES = {
    TFTYP: "Tales from the Yawning Portal",
    MFF: "Mordenkainen's Fiendish Folio",
    ESK: "Essentials Kit",
    VD: "Vecna Dossier",
    SADS: "Sapphire Anniversary Dice Set",
    MISMV1: "Misplaced Monsters: Volume 1",
    MCV2DC: "Monstrous Compendium Volume 2: Dragonlance Creatures",
    MCV3MC: "Monstrous Compendium Volume 3: Minecraft Creatures",
    PSA: "Plane Shift: Amonkhet",
    PSD: "Plane Shift: Dominaria",
    PSI: "Plane Shift: Innistrad",
    PSK: "Plane Shift: Kaladesh",
    PSX: "Plane Shift: Ixalan",
    PSZ: "Plane Shift: Zendikar",
  };

  const GROUP_LABEL = { book: "Books", adventure: "Adventures", other: "Other" };
  const GROUP_ORDER = ["book", "adventure", "other"];

  function groupRows(rows) {
    return GROUP_ORDER
      .map(g => ({ group: g, label: GROUP_LABEL[g], rows: rows.filter(r => r.group === g) }))
      .filter(g => g.rows.length);
  }

  /* Tri-state, exactly as pmcrwf cycles its filters: neutral -> include -> exclude. */
  function nextState(s) { return s === "include" ? "exclude" : s === "exclude" ? "ignore" : "include"; }

  /* Fold the per-code state map into the { include, exclude } spec score.js's rank() reads. */
  function toSpec(states) {
    const include = [], exclude = [];
    Object.keys(states || {}).forEach(code => {
      if (states[code] === "include") include.push(code);
      else if (states[code] === "exclude") exclude.push(code);
    });
    return { include, exclude };
  }

  const isActive = states => Object.values(states || {}).some(s => s === "include" || s === "exclude");

  /* { CODE: "YYYY-MM-DD" } for whatever the catalogue knows, for score.js's legacy
     tiebreak. Sources with no date simply aren't in the map, and the tiebreak treats
     them as undatable rather than as ancient or as new. */
  function sourceDates(catalogue) {
    const out = Object.create(null);
    Object.keys(catalogue || {}).forEach(k => {
      const e = catalogue[k];
      if (e && e.published) out[e.code.toLowerCase()] = e.published;
    });
    return out;
  }

  return { buildCatalogue, sourceRows, groupRows, nextState, toSpec, isActive, sourceDates,
           GROUP_LABEL, GROUP_ORDER };
});
