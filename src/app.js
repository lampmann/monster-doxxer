/* ============================================================
   Monster Doxxer — the browser app.

   Everything here is presentation and wiring. All the ranking lives in
   src/score.js and src/symptoms.js, which know nothing about the DOM and are
   tested headlessly; this file's job is to collect observations, hand them over,
   and show the answer with its reasoning.

   Same shape as pmcrwf: no framework, no build step, plain functions, delegated
   click handlers, state in one object, localStorage for persistence.

   THE ORDER OF THE FORM IS THE ARGUMENT. "What did it do?" comes first because
   the symptom ontology is worth roughly four times what any other kind of
   evidence is (see DESIGN.md's ablation). A player who fills in only that box
   has given the tool its best shot. Numbers come last because they are the thing
   DMs change.
   ============================================================ */
(function () {
  "use strict";

  const $ = id => document.getElementById(id);
  const esc = s => String(s == null ? "" : s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

  const STORE_KEY = "monster-doxxer-session";
  /* Rank a wider window than gets shown. The extra rows are never rendered; they exist so
     the tie count can say "40+ are tied" rather than reporting the size of the list it
     happened to cut, and so F13 picks its tests against the real field of candidates. */
  const WINDOW = 40;
  const SHOWN = 12;
  /* The embedding half's share of the appearance score. Now MEASURED, on a real
     ViT-B-32/laion2b index over 4528 monsters with 2632 pictures mixed in
     (eval/appearance.js --sweep), against the query representation this page actually
     uses — the mean of a query's word vectors:

         lexical only   4/16 top-1   8/16 top-5   10/16 top-20
         0.35           4/16         8/16         12/16
         0.5            4/16         8/16         12/16
         0.65           4/16         6/16          9/16
         semantic only  0/16         0/16          0/16

     So the honest claim is narrow: +2 of 16 at top-20, nothing at top-1 or top-5. 0.35
     and 0.5 tie, and the lower weight is kept because performance falls off a cliff
     above 0.5 and there is no reason to sit nearer the edge for no gain.

     Note the last row. On its own the embedding half finds nothing, which means this is
     a reranking effect within what BM25 already surfaced, not retrieval. The same index
     queried with properly-encoded sentences scores 1/3/7 semantic-only and 4/9/13
     blended, so the vectors are not the problem — the mean-of-words shortcut is. See
     DESIGN.md; build/embed.py --vocab-prompt is the attempt to close that gap. */
  const BLEND_WEIGHT = 0.35;

  /* ---------- state ----------

     WHAT IS PER-TAB AND WHAT IS NOT is the only real decision here. Observations belong
     to a monster: the whole point of tabs is that the evidence for the thing in the
     doorway must never blend into the evidence for the thing on the ceiling, which is
     the "two monsters, one set of observations" failure the handoff flagged from the
     start. Everything else — which books your DM owns, how big your party is — is a fact
     about the TABLE and is shared, because retyping it per monster would be absurd. */
  const blankObs = () => ({ symptoms: [], type: "", size: "", movement: [], senses: [],
    condImmune: [], damage: {}, appearance: "", heardName: "" });
  const blankTab = () => ({ id: "t" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    label: "", best: "", obs: blankObs(), ac: null, hp: null, retuned: false,
    // Which fight this creature was in, and how many of it there were. Both feed the
    // party-plausibility band: one ogre and one of eight ogres are very different CRs.
    fight: "f1", count: 1 });

  const S = {
    monsters: [], rarity: null, numerics: null, legacy: null, ontology: null, srcRows: [],
    appearanceIndex: null, nameIndex: null, embeddings: null, sizeFromProse: "",
    // The active tab's fields, mirrored here so the rest of the app reads them unchanged.
    obs: blankObs(),
    ac: null, hp: null, retuned: false,
    tabs: [], activeId: "",
    sources: {},              // { CODE: "ignore" | "include" | "exclude" } — shared
    party: { level: null, size: 4 },   // a fact about the table, so shared across tabs
    ranked: [], selected: null,
  };

  /* The picker vocabularies. Fixed lists rather than whatever the corpus happens to
     contain: a player picking "how it moved" wants the five ways a creature can move,
     not a list that changes shape because of which books are loaded. */
  const PICKERS = {
    type: { multi: false, opts: ["aberration", "beast", "celestial", "construct", "dragon", "elemental",
      "fey", "fiend", "giant", "humanoid", "monstrosity", "ooze", "plant", "undead"] },
    size: { multi: false, opts: ["tiny", "small", "medium", "large", "huge", "gargantuan"] },
    movement: { multi: true, opts: ["fly", "swim", "burrow", "climb"] },
    senses: { multi: true, opts: ["darkvision", "blindsight", "truesight", "tremorsense"] },
    condImmune: { multi: true, opts: ["charmed", "frightened", "poisoned", "paralyzed", "petrified",
      "stunned", "grappled", "restrained", "prone", "exhaustion"] },
  };
  const CONDIMMUNE_LABEL = { exhaustion: "exhausted" };

  const DAMAGE_TYPES = ["acid", "bludgeoning", "cold", "fire", "force", "lightning", "necrotic",
    "piercing", "poison", "psychic", "radiant", "slashing", "thunder"];
  /* The player's words, not the rulebook's. Someone at a table says "it shrugged it off",
     not "it has resistance". The value stored is still the mechanical state. */
  const DMG_STATES = [
    ["immune", "no effect"],
    ["resistant", "halved"],
    ["normal", "normal"],
    ["vulnerable", "extra"],
  ];

  /* ============================================================
     Loading
     ============================================================ */
  function fatal(msg) {
    const el = $("fatal");
    el.hidden = false;
    el.innerHTML = msg;
  }

  async function getJson(path) {
    const res = await fetch(path, { cache: "no-cache" });
    if (!res.ok) throw new Error(path + " -> HTTP " + res.status);
    return res.json();
  }
  // Optional files degrade to null rather than taking the app down with them.
  const getJsonOptional = path => getJson(path).catch(() => null);

  async function load() {
    const status = $("corpus-status");
    let index;
    try {
      index = await getJson("data/bestiary/index.json");
    } catch (e) {
      status.textContent = "";
      fatal('No bestiary found. Put 5e.tools\' data in <code>data/</code> — see ' +
            '<code>data/README.md</code>. (Nothing from the books is bundled with this tool, on purpose.)');
      return;
    }

    const files = Object.values(index);
    const lists = [];
    let done = 0;
    await Promise.all(files.map(async f => {
      const j = await getJsonOptional("data/bestiary/" + f);
      if (j && Array.isArray(j.monster)) lists.push(j.monster);
      status.textContent = `loading ${++done}/${files.length}…`;
    }));

    const ingested = window.ingest(lists);
    S.monsters = ingested.monsters;

    const ont = await getJsonOptional("ontology/symptoms.json");
    S.ontology = window.compile(ont || { symptoms: [] });
    window.tagAll(S.monsters, S.ontology);

    S.rarity = window.buildRarity(S.monsters);
    S.numerics = window.buildNumerics(S.monsters);

    const [books, adventures] = await Promise.all([
      getJsonOptional("data/books.json"), getJsonOptional("data/adventures.json"),
    ]);
    const catalogue = window.buildCatalogue(books, adventures);
    S.srcRows = window.sourceRows(S.monsters, catalogue);
    // Release order, for the tie-break. Optional data, so this degrades rather than fails.
    S.legacy = window.buildLegacy(S.monsters, window.sourceDates(catalogue));

    /* F10's index. Fluff is optional too: without it the description documents still carry
       name, size, type and trait names, which is thin but not nothing. */
    const fidx = await getJsonOptional("data/bestiary/fluff-index.json");
    const fluffLists = [];
    if (fidx) {
      await Promise.all(Object.values(fidx).map(async f => {
        /* 5e.tools ships these inside bestiary/ next to the statblocks; data/README.md
           asked for a fluff-bestiary/ of your own. Try both — reading neither is silent,
           and leaves every description document with no prose in it. */
        const j = await getJsonOptional("data/bestiary/" + f)
               || await getJsonOptional("data/fluff-bestiary/" + f);
        if (j && Array.isArray(j.monsterFluff)) fluffLists.push(j.monsterFluff);
      }));
    }
    S.appearanceIndex = window.buildAppearanceIndex(S.monsters, window.fluffMap(fluffLists));
    S.nameIndex = window.buildNameIndex(S.monsters);
    S.embeddings = await loadEmbeddings();

    status.textContent = `${S.monsters.length} monsters, ${S.ontology.symptoms.length} symptoms` +
      (S.embeddings ? ", semantic search on" : "") +
      (books || adventures ? "" : " (add data/books.json for book titles)");

    restore();
    renderAll();
  }

  /* The CLIP index, if build/embed.py has been run. Absent is the normal state: the
     tool ranks on BM25 alone and simply loses the paraphrase half, so this never warns
     and never blocks the page on a download that may not exist. */
  async function loadEmbeddings() {
    const manifest = await getJsonOptional("index/appearance.json");
    if (!manifest) return null;
    const bytes = async path => {
      try {
        const res = await fetch(path, { cache: "no-cache" });
        if (!res.ok) return null;
        return new Int8Array(await res.arrayBuffer());
      } catch (e) { return null; }
    };
    const [mon, vocab] = await Promise.all([
      bytes("index/appearance-mon.i8"), bytes("index/appearance-vocab.i8"),
    ]);
    return window.buildEmbeddingIndex(manifest, mon, vocab);
  }

  /* ============================================================
     F15 — session evidence. The fight is still going; the tool should not
     forget what you told it because you reloaded the page.
     ============================================================ */
  /* Copy the live fields back into whichever tab is showing, so a switch or a save
     never loses what was typed since the last one. */
  function syncActive() {
    const t = S.tabs.find(x => x.id === S.activeId);
    if (!t) return;
    t.obs = S.obs; t.ac = S.ac; t.hp = S.hp; t.retuned = S.retuned;
  }

  function persist() {
    syncActive();
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify({
        tabs: S.tabs, activeId: S.activeId, sources: S.sources, party: S.party,
      }));
    } catch (e) { /* private browsing, quota — not worth interrupting a fight over */ }
  }
  function restore() {
    let d = null;
    try { d = JSON.parse(localStorage.getItem(STORE_KEY)); } catch (e) { d = null; }
    if (d && Array.isArray(d.tabs) && d.tabs.length) {
      S.tabs = d.tabs.map(t => Object.assign(blankTab(), t, { obs: Object.assign(blankObs(), t.obs) }));
      S.activeId = d.tabs.some(t => t.id === d.activeId) ? d.activeId : S.tabs[0].id;
    } else if (d && d.obs) {
      // A session saved before tabs existed. Carry it into the first tab rather than bin it.
      const t = blankTab();
      Object.assign(t, { obs: Object.assign(blankObs(), d.obs), ac: d.ac, hp: d.hp, retuned: !!d.retuned });
      S.tabs = [t]; S.activeId = t.id;
    } else {
      const t = blankTab();
      S.tabs = [t]; S.activeId = t.id;
    }
    if (d) {
      S.sources = d.sources || {};
      if (d.party) S.party = Object.assign({ level: null, size: 4 }, d.party);
    }
    $("in-level").value = S.party.level == null ? "" : S.party.level;
    $("in-party").value = S.party.size == null ? "" : S.party.size;
    loadActive();
  }

  /* Pull the showing tab's fields into the live state and into the inputs. */
  function loadActive() {
    const t = S.tabs.find(x => x.id === S.activeId) || S.tabs[0];
    if (!t) return;
    S.activeId = t.id;
    S.obs = Object.assign(blankObs(), t.obs);
    S.ac = t.ac == null ? null : t.ac;
    S.hp = t.hp == null ? null : t.hp;
    S.retuned = !!t.retuned;
    S.sizeFromProse = "";
    S.selected = null;
    $("in-ac").value = S.ac == null ? "" : S.ac;
    $("in-hp").value = S.hp == null ? "" : S.hp;
    $("in-retuned").checked = S.retuned;
    $("in-appearance").value = S.obs.appearance || "";
    $("in-name").value = S.obs.heardName || "";
    $("sym-search").value = "";
    $("in-count").value = t.count || 1;
    renderFightPicker();
  }

  /* How many creatures were in this tab's fight, across every tab in it. This is the
     number that shifts the band: the DMG multiplies an encounter's XP by how crowded it
     is, so inverting it divides each individual monster's plausible CR down. */
  function fightCount(fight) {
    return S.tabs.filter(t => (t.fight || "f1") === fight)
      .reduce((n, t) => n + Math.max(1, Number(t.count) || 1), 0);
  }
  const fightIds = () => {
    const ids = [...new Set(S.tabs.map(t => t.fight || "f1"))];
    return ids.sort();
  };

  function renderFightPicker() {
    const sel = $("in-fight");
    if (!sel) return;
    const t = S.tabs.find(x => x.id === S.activeId);
    const cur = (t && t.fight) || "f1";
    const ids = [...new Set(fightIds().concat([cur]))].sort();
    sel.innerHTML = ids.map((f, i) =>
      `<option value="${esc(f)}"${f === cur ? " selected" : ""}>Fight ${i + 1}</option>`).join("") +
      `<option value="__new">+ a separate fight</option>`;
  }

  /* A tab shows what it is about without being named: whatever is currently winning.
     Naming it yourself wins, because "Goblin" beside a tab you know is a disguised
     doppelganger is worse than no label at all. */
  function tabLabel(t) {
    if (t.label) return t.label;
    // `best` is remembered from the last time this tab was ranked, so a tab you are not
    // looking at keeps showing what it resolved to instead of reverting to raw input.
    if (t.best) return t.best;
    if (t.obs && t.obs.heardName) return t.obs.heardName;
    return "Monster " + (S.tabs.indexOf(t) + 1);
  }

  function renderTabs() {
    const el = $("doxx-tabs");
    if (!el) return;
    el.innerHTML = S.tabs.map(t => {
      const active = t.id === S.activeId;
      return `<button type="button" class="doxx-tab${active ? " active" : ""}" data-tab="${esc(t.id)}" ` +
        `title="${active ? "click to rename" : "switch to this monster"}">${esc(tabLabel(t))}` +
        (S.tabs.length > 1 ? `<span class="doxx-tab-x" data-closetab="${esc(t.id)}" title="close">×</span>` : "") +
        `</button>`;
    }).join("") + `<button type="button" id="tab-add" title="another monster in the same fight">+ Another monster</button>`;
  }
  // Clears the monster in front of you, not the whole session — the other tabs and the
  // book filter are separate work and losing them to a mis-click would be its own bug.
  function clearSession() {
    const t = S.tabs.find(x => x.id === S.activeId);
    if (t) { t.obs = blankObs(); t.ac = t.hp = null; t.retuned = false; t.label = ""; }
    loadActive();
    persist(); renderAll();
  }

  /* ============================================================
     Rendering — the query side
     ============================================================ */
  function renderPickers() {
    Object.keys(PICKERS).forEach(field => {
      const cfg = PICKERS[field];
      $("pick-" + field).innerHTML = cfg.opts.map(v => {
        const on = cfg.multi ? S.obs[field].includes(v) : S.obs[field] === v;
        return `<button class="chip${on ? " on" : ""}" data-pick="${field}" data-val="${esc(v)}">` +
               `${esc(CONDIMMUNE_LABEL[v] || v)}</button>`;
      }).join("");
    });
  }

  function renderDamage() {
    $("dmg-body").innerHTML = DAMAGE_TYPES.map(d => {
      const cur = S.obs.damage[d] || "";
      const cells = DMG_STATES.map(([state]) =>
        `<td class="opt"><input type="radio" name="dmg-${d}" data-dmg="${d}" value="${state}"` +
        `${cur === state ? " checked" : ""} title="${esc(state)}"></td>`).join("");
      return `<tr><td class="dt">${esc(d)}</td>${cells}` +
             `<td class="opt"><button class="fctrl-btn" data-dmg-clear="${d}"` +
             `${cur ? "" : " disabled"} title="we never tested this">clear</button></td></tr>`;
    }).join("");
  }

  function renderSymptoms() {
    const chosen = S.obs.symptoms.map(id => {
      const s = S.ontology.byId[id];
      return `<button class="chip on" data-sym-remove="${esc(id)}" title="remove">` +
             `${esc(s ? s.player : id)}</button>`;
    }).join("");
    $("sym-chosen").innerHTML = chosen;

    const q = $("sym-search").value.trim();
    const box = $("sym-results");
    if (!q) { box.innerHTML = ""; return; }
    const hits = window.lookup(S.ontology, q, 12).filter(h => !S.obs.symptoms.includes(h.id));
    box.innerHTML = hits.length
      ? hits.map(h => `<button class="sym-hit" data-sym-add="${esc(h.id)}">${esc(h.player)}</button>`).join("")
      : `<span class="hint">Nothing in the ontology matches that yet. Try plainer words &mdash; ` +
        `&ldquo;it vanished&rdquo;, &ldquo;my sword bounced off&rdquo;.</span>`;
  }

  /* F16's tri-state filter, grouped Books / Adventures / Other. */
  function renderSources() {
    const groups = window.groupRows(S.srcRows);
    if (!groups.length) { $("src-filter").innerHTML = `<span class="hint">no sources loaded</span>`; return; }
    $("src-filter").innerHTML = groups.map(g => {
      const opts = g.rows.map(r => {
        const st = S.sources[r.code] || "ignore";
        const cls = st === "include" ? " inc" : st === "exclude" ? " exc" : "";
        return `<button class="fbtn${cls}" data-src="${esc(r.code)}" ` +
               `title="${esc(r.name)} — ${r.count} monster${r.count === 1 ? "" : "s"}">${esc(r.code)}</button>`;
      }).join("");
      return `<div class="fgroup"><div class="flabel">${esc(g.label)}</div>` +
             `<div class="fbody"><span class="fctrl">` +
             `<button class="fctrl-btn" data-src-all="${g.group}">Include all</button>` +
             `<button class="fctrl-btn" data-src-none="${g.group}">Exclude all</button>` +
             `<button class="fctrl-btn" data-src-clear="${g.group}">Clear</button></span>${opts}</div></div>`;
    }).join("");
  }

  /* ============================================================
     Rendering — the answer
     ============================================================ */
  function currentObservation() {
    const obs = {
      symptoms: S.obs.symptoms.slice(),
      movement: S.obs.movement.slice(),
      senses: S.obs.senses.slice(),
      condImmune: S.obs.condImmune.slice(),
      damage: Object.assign({}, S.obs.damage),
    };
    if (S.obs.type) obs.type = S.obs.type;
    if (S.obs.size) obs.size = S.obs.size;
    if (S.obs.appearance) obs.appearance = S.obs.appearance;
    if (S.obs.heardName) obs.heardName = S.obs.heardName;
    if (typeof S.ac === "number") obs.ac = S.ac;
    if (typeof S.hp === "number") obs.hp = S.hp;
    return obs;
  }

  function renderCrHint() {
    const el = $("cr-implied");
    const implied = S.numerics && (typeof S.hp === "number" || typeof S.ac === "number")
      ? S.numerics.inferCr({ ac: S.ac == null ? undefined : S.ac, hp: S.hp == null ? undefined : S.hp })
      : null;
    el.textContent = implied
      ? `Those numbers fight like a CR ${implied.cr < 1 ? implied.cr.toFixed(2) : implied.cr.toFixed(1)} creature.`
      : "";
  }

  function evidenceList(items, cls) {
    if (!items.length) return "";
    const label = cls === "for" ? "for" : "against";
    return `<div class="${cls}">${label}: ` + items.map(x => {
      const conf = x.confidence != null && x.confidence < 1 ? ` <span class="hint">(uncertain)</span>` : "";
      const why = x.why ? ` &mdash; ${esc(x.why)}` : "";
      return `${esc(prettyValue(x))}${conf}${why}`;
    }).join("; ") + "</div>";
  }

  /* Feature keys read like "symptom:it-healed-between-rounds" to the scorer. Nobody
     should have to read that, so F14's explanation is translated back into the same
     sentence the player picked in the first place. */
  function prettyValue(x) {
    if (x.facet === "symptom") {
      const s = S.ontology.byId[x.value];
      return s ? s.player : x.value;
    }
    if (x.facet === "damage") return x.value;
    if (x.facet === "ac" || x.facet === "hp") return x.value;
    if (x.facet === "movement") return x.value === "fly" ? "it flew" : "it " + x.value + "ed";
    if (x.facet === "sense") return x.value;
    if (x.facet === "condImmune") return "immune to " + x.value;
    return x.value;
  }

  function renderResults() {
    const box = $("results");
    const obs = currentObservation();

    if (!window.hasEvidence(obs)) {
      S.ranked = [];
      const empty = S.tabs.find(x => x.id === S.activeId);
      if (empty) empty.best = "";
      box.innerHTML = `<span class="hint">Nothing observed yet. Start with what it did &mdash; ` +
        `that box is worth more than all the others together.</span>`;
      renderTabs();
      return;
    }

    const spec = window.toSpec(S.sources);
    /* F10 is scored against the whole collection at once — BM25 needs the collection —
       so it is computed here and handed in, rather than recomputed per candidate. */
    /* F10 asks for the two scorers BLENDED, not for one to replace the other: BM25 is
       strong on distinctive nouns it shares with the book, embeddings on paraphrase. */
    let appearanceScores = obs.appearance && S.appearanceIndex
      ? window.appearanceScore(obs.appearance, S.appearanceIndex) : null;
    if (obs.appearance && S.embeddings) {
      const semantic = window.embeddingScore(window.withoutSize(obs.appearance), S.embeddings);
      appearanceScores = window.blend(appearanceScores || new Map(), semantic, BLEND_WEIGHT);
    }
    const nameScores = obs.heardName && S.nameIndex
      ? window.nameScore(obs.heardName, S.nameIndex) : null;
    /* The party prior. Needs a level to mean anything; without one it is simply absent
       rather than assumed, because guessing the party's level would be inventing evidence. */
    const active = S.tabs.find(x => x.id === S.activeId);
    const crScores = S.party.level
      ? window.crPlausibility(S.monsters, S.party.level, S.party.size,
                              fightCount((active && active.fight) || "f1"))
      : null;
    const ranked = window.rank(S.monsters, obs, S.rarity, {
      sources: spec, numerics: S.numerics, retuned: S.retuned, legacy: S.legacy,
      appearanceScores, nameScores, crPlausibility: crScores,
      collapseByName: true, limit: WINDOW, keepMonster: true,
    });
    S.ranked = ranked;

    if (!ranked.length) {
      box.innerHTML = `<span class="error">Every book is excluded, so there is nothing left to rank.</span>`;
      renderTabs();
      return;
    }

    /* Drop candidates that explain nothing. With F7 normalisation a monster that matches
       no part of the query scores exactly 0, so under a single strong observation the list
       filled up with whatever the tie-break happened to surface — "barghast" answered
       Barghest, Ghast, and then ten zero-scoring creatures under a heading that says "best
       explanations". They are not explanations. Kept only when nothing at all scores, so
       the list is never mysteriously empty. */
    const explains = ranked.filter(r => r.score > 1e-9);
    const shown = explains.length ? explains : ranked;

    const notes = [];
    if (window.isActive(S.sources)) {
      const bits = [];
      if (spec.include.length) bits.push(`${spec.include.length} book${spec.include.length === 1 ? "" : "s"} included`);
      if (spec.exclude.length) bits.push(`${spec.exclude.length} excluded`);
      notes.push(`Filtered: ${bits.join(", ")}.`);
    }

    /* Ties are the normal case with three or four observations, and saying so is more
       useful than pretending to an order. The tiebreak below the score is a prior, not
       evidence, so a silent list would imply a confidence the ranking doesn't have. */
    if (!explains.length) {
      notes.push("Nothing in your books explains this. These are the least bad matches, not answers.");
    } else if (explains.length <= 3 && ranked.length > explains.length) {
      notes.push(`Only ${explains.length} monster${explains.length === 1 ? "" : "s"} explain${
        explains.length === 1 ? "s" : ""} any of this; the rest are not shown.`);
    }

    const top = shown[0].score;
    const tied = shown.filter(r => Math.abs(r.score - top) < 1e-9).length;
    if (tied > 1) {
      // Counted over the wider window, so "12" never means "12, and we stopped looking".
      const n = tied >= WINDOW ? `${WINDOW}+` : String(tied);
      notes.push(`The top ${n} explain your observations equally well — the order between ` +
        `them is a guess. One more observation would separate them.`);
    }
    const noteHtml = notes.length ? `<div class="hint block">${notes.map(esc).join(" ")}</div>` : "";

    box.innerHTML = noteHtml + shown.slice(0, SHOWN).map((r, i) => {
      /* The bar is the ABSOLUTE score, not a share of the leader: F7 already normalises
         it to "how much of the evidence you gave does this monster explain", which is
         the number a reader actually wants. Relative bars made every tied result full
         width and said nothing at all. */
      const rel = Math.max(0, Math.min(1, r.score));
      const m = r.monster;
      return `<div class="result">
        <div class="result-head">
          <span class="result-rank">${i + 1}.</span>
          <span class="bar-track" title="explains ${(rel * 100).toFixed(0)}% of what you reported"><span class="bar" style="width:${(rel * 100).toFixed(0)}%"></span></span>
          <span class="result-name"><button data-detail="${esc(r.key)}">${esc(r.name)}</button></span>
          <span class="result-meta">${esc(r.source)}${m && m.cr ? ", CR " + esc(m.cr) : ""}${
            r.alsoIn ? " (also " + esc(r.alsoIn.slice(0, 2).join(", ")) + ")" : ""}</span>
        </div>
        <div class="why">
          ${evidenceList(r.for.slice(0, 4), "for")}
          ${evidenceList(r.against.slice(0, 3), "against")}
        </div>
      </div>`;
    }).join("");

    /* Drawn here rather than in renderAll: a tab is labelled by whatever is currently
       winning, so the label has to follow the ranking it reads — and doing it at the end
       of the one function that re-ranks means every handler updates it for free. */
    const cur = S.tabs.find(x => x.id === S.activeId);
    if (cur) cur.best = shown.length && shown[0].score > 1e-9 ? shown[0].name : "";
    renderTabs();
  }

  /* F13 — what to try next.

     Each suggestion carries the answers as buttons, so the loop closes in one tap:
     the party hits it with radiant, taps "no effect", and the ranking updates. That
     is the whole point of the feature — it is advice for the next round, not a
     report on the last one. */
  function renderSuggestions() {
    const mod = $("suggest-module");
    if (!S.ranked.length || !window.suggest) { mod.hidden = true; return; }

    const tests = window.suggest(S.ranked, {
      ontology: S.ontology, observation: currentObservation(), limit: 3,
    });
    if (!tests.length) { mod.hidden = true; return; }
    mod.hidden = false;

    const ANSWERS = {
      damage: [["immune", "no effect"], ["resistant", "halved"], ["normal", "normal"], ["vulnerable", "extra"]],
      condition: [["immune", "it was immune"], ["affected", "it worked"]],
      symptom: [["yes", "yes, that happened"], ["no", "no"]],
    };

    $("suggestions").innerHTML = tests.map((t, i) => {
      const answers = (ANSWERS[t.kind] || []).map(([value, label]) =>
        `<button class="chip" data-answer="${i}" data-outcome="${esc(value)}">${esc(label)}</button>`).join("");
      return `<div class="sugg">
        <div class="sugg-label">${esc(t.label)}<span class="sugg-gain">${t.gain.toFixed(1)} bits</span></div>
        <div class="sugg-split">${esc(t.split)}</div>
        <div class="sugg-answers">what happened? ${answers}</div>
      </div>`;
    }).join("");
    S.suggested = tests;
  }

  function renderDetail() {
    const mod = $("detail-module");
    if (!S.selected) { mod.hidden = true; return; }
    const m = S.monsters.find(x => x.key === S.selected);
    if (!m) { mod.hidden = true; return; }
    mod.hidden = false;
    $("detail-title").textContent = m.name;

    const line = (k, v) => v ? `<div class="sb-line"><b>${esc(k)}</b> ${esc(v)}</div>` : "";
    const traits = [].concat(m.traits, m.actions, m.legendary)
      .map(t => `<div class="sb-trait"><b>${esc(t.name)}.</b> ${esc(t.text)}</div>`).join("");

    $("detail").innerHTML =
      `<div class="sb-line hint">${esc(m.size.join("/"))} ${esc(m.type)}` +
      `${m.typeTags.length ? " (" + esc(m.typeTags.join(", ")) + ")" : ""}, ${esc(m.alignment)} ` +
      `&mdash; ${esc(m.source)}${m.page ? " p." + m.page : ""}</div>` +
      line("AC", m.acText || m.ac) +
      line("HP", m.hpSpecial || (m.hpAvg ? m.hpAvg + (m.hpFormula ? " (" + m.hpFormula + ")" : "") : "")) +
      line("Speed", m.speedText) +
      line("Senses", m.senses.concat(m.passive ? ["passive Perception " + m.passive] : []).join(", ")) +
      line("Resistances", m.resistText) + line("Immunities", m.immuneText) +
      line("Vulnerabilities", m.vulnerableText) +
      line("Condition immunities", m.conditionImmune.join(", ")) +
      line("Languages", m.languages.join(", ")) + line("CR", m.cr) +
      traits;
  }

  function renderAll() {
    applyProseSize(); renderNameRead(); renderFightPicker(); renderBand();
    renderPickers(); renderDamage(); renderSymptoms(); renderSources();
    renderCrHint(); renderResults(); renderSuggestions(); renderDetail();
  }

  /* ============================================================
     Events — one delegated click handler, as in pmcrwf
     ============================================================ */
  function toggleIn(list, value) {
    const i = list.indexOf(value);
    if (i < 0) list.push(value); else list.splice(i, 1);
  }

  document.addEventListener("click", e => {
    const t = e.target;

    const pick = t.closest("[data-pick]");
    if (pick) {
      const field = pick.dataset.pick, val = pick.dataset.val;
      if (PICKERS[field].multi) toggleIn(S.obs[field], val);
      else S.obs[field] = S.obs[field] === val ? "" : val;      // clicking the chosen one clears it
      // A size the user clicked is theirs; stop F11 overwriting it on the next keystroke.
      if (field === "size") { S.sizeFromProse = ""; applyProseSize(); }
      persist(); renderPickers(); renderResults(); renderSuggestions();
      return;
    }

    const add = t.closest("[data-sym-add]");
    if (add) {
      S.obs.symptoms.push(add.dataset.symAdd);
      $("sym-search").value = "";
      persist(); renderSymptoms(); renderResults(); renderSuggestions();
      return;
    }
    const rm = t.closest("[data-sym-remove]");
    if (rm) {
      toggleIn(S.obs.symptoms, rm.dataset.symRemove);
      persist(); renderSymptoms(); renderResults(); renderSuggestions();
      return;
    }

    const dclear = t.closest("[data-dmg-clear]");
    if (dclear) {
      delete S.obs.damage[dclear.dataset.dmgClear];
      persist(); renderDamage(); renderResults(); renderSuggestions();
      return;
    }

    const src = t.closest("[data-src]");
    if (src) {
      const code = src.dataset.src;
      S.sources[code] = window.nextState(S.sources[code] || "ignore");
      if (S.sources[code] === "ignore") delete S.sources[code];
      persist(); renderSources(); renderResults(); renderSuggestions();
      return;
    }
    const bulk = t.closest("[data-src-all],[data-src-none],[data-src-clear]");
    if (bulk) {
      const g = bulk.dataset.srcAll || bulk.dataset.srcNone || bulk.dataset.srcClear;
      const mode = bulk.dataset.srcAll ? "include" : bulk.dataset.srcNone ? "exclude" : "ignore";
      S.srcRows.filter(r => r.group === g).forEach(r => {
        if (mode === "ignore") delete S.sources[r.code];
        else S.sources[r.code] = mode;
      });
      persist(); renderSources(); renderResults(); renderSuggestions();
      return;
    }

    /* Answering a suggested test writes straight into the observation set, so the tool
       learns from the round the party just spent on its advice. */
    const ans = t.closest("[data-answer]");
    if (ans) {
      const test = (S.suggested || [])[Number(ans.dataset.answer)];
      if (!test) return;
      const next = window.applyAnswer(currentObservation(), test, ans.dataset.outcome);
      S.obs.damage = next.damage || S.obs.damage;
      S.obs.condImmune = next.condImmune || S.obs.condImmune;
      S.obs.symptoms = next.symptoms || S.obs.symptoms;
      persist(); renderAll();
      return;
    }

    const det = t.closest("[data-detail]");
    if (det) {
      S.selected = S.selected === det.dataset.detail ? null : det.dataset.detail;
      renderDetail();
      if (S.selected) $("detail-module").scrollIntoView({ block: "nearest" });
      return;
    }

    if (t.closest("#btn-clear")) { clearSession(); return; }

    /* ---- tabs ---- */
    const close = t.closest("[data-closetab]");
    if (close) {
      const id = close.dataset.closetab;
      const i = S.tabs.findIndex(x => x.id === id);
      if (i < 0 || S.tabs.length <= 1) return;
      syncActive();
      S.tabs.splice(i, 1);
      if (S.activeId === id) S.activeId = S.tabs[Math.max(0, i - 1)].id;
      loadActive();
      persist(); renderAll();
      return;
    }
    const tab = t.closest("[data-tab]");
    if (tab) {
      const id = tab.dataset.tab;
      if (id === S.activeId) {
        // Clicking the tab you are already on renames it, as in pmcrwf.
        const cur = S.tabs.find(x => x.id === id);
        const name = window.prompt("Call this one:", cur.label || tabLabel(cur));
        if (name != null) { cur.label = name.trim(); persist(); renderTabs(); }
        return;
      }
      syncActive();
      S.activeId = id;
      loadActive();
      persist(); renderAll();
      return;
    }
    if (t.closest("#tab-add")) {
      syncActive();
      const fresh = blankTab();
      S.tabs.push(fresh);
      S.activeId = fresh.id;
      loadActive();
      persist(); renderAll();
    }
  });

  function renderBand() {
    const el = $("band-read");
    if (!el) return;
    if (!S.party.level) { el.textContent = ""; return; }
    const t = S.tabs.find(x => x.id === S.activeId);
    const n = fightCount((t && t.fight) || "f1");
    const b = window.band(S.party.level, S.party.size, n);
    el.textContent = `${n} creature${n === 1 ? "" : "s"} in this fight — a DM building it would ` +
      `be working around ${window.describeBand(b)}. Used only to order monsters the evidence ties.`;
  }

  document.addEventListener("change", e => {
    if (e.target.id === "in-fight") {
      const t = S.tabs.find(x => x.id === S.activeId);
      if (!t) return;
      // "+ a separate fight" mints an id nothing else uses yet.
      t.fight = e.target.value === "__new"
        ? "f" + (fightIds().length + 1) + Date.now().toString(36).slice(-3)
        : e.target.value;
      renderFightPicker(); renderBand();
      persist(); renderResults(); renderSuggestions();
      return;
    }
    const dmg = e.target.closest("[data-dmg]");
    if (dmg) {
      S.obs.damage[dmg.dataset.dmg] = dmg.value;
      persist(); renderDamage(); renderResults(); renderSuggestions();
      return;
    }
    if (e.target.id === "in-retuned") {
      S.retuned = e.target.checked;
      persist(); renderResults(); renderSuggestions();
    }
  });

  /* F11 — size out of the description.

     Size is a tier 1 structural fact, so a size read out of prose earns FULL weight
     through the ordinary size facet, while the rest of the sentence stays a capped
     bonus. It is applied rather than merely offered, because a player who wrote "about
     horse-sized" has told us the size and should not have to say it twice — but it is
     shown, with the words that produced it, and a manual pick always wins. Silently
     inferring a tier 1 fact and never mentioning it would be the wrong trade. */
  function applyProseSize() {
    const el = $("size-read");
    const read = window.extractSize(S.obs.appearance);
    if (!read) {
      if (S.sizeFromProse && S.obs.size === S.sizeFromProse) S.obs.size = "";
      S.sizeFromProse = "";
      el.textContent = "";
      return;
    }
    // Only ever overwrite a size this same mechanism set; never a chip the user clicked.
    if (!S.obs.size || S.obs.size === S.sizeFromProse) {
      S.obs.size = read.size;
      S.sizeFromProse = read.size;
      el.textContent = `Read as ${read.size} — from ${read.via}. Click a size to override.`;
    } else {
      el.textContent = `That sounds ${read.size} (${read.via}), but you chose ${S.obs.size}.`;
    }
  }

  /* Say what the name matched, rather than silently reweighting the whole list. A nudge
     this strong has to be visible — and if it matched the wrong thing, the user needs to
     see that it did before they trust the ranking underneath it. */
  function renderNameRead() {
    const el = $("name-read");
    const q = (S.obs.heardName || "").trim();
    if (!q || !S.nameIndex) { el.textContent = ""; return; }
    const hit = window.looksLikeName(q, S.nameIndex, 0.5);
    if (!hit) {
      el.textContent = "No creature in your books goes by that. Left as a hint rather than an answer.";
      return;
    }
    el.textContent = hit.exact
      ? `Matched “${hit.name}” exactly.`
      : `Closest name is “${hit.name}”. Ranked accordingly, not filtered to it.`;
  }

  document.addEventListener("input", e => {
    if (e.target.id === "sym-search") { renderSymptoms(); return; }
    if (e.target.id === "in-name") {
      S.obs.heardName = e.target.value;
      renderNameRead();
      persist(); renderResults(); renderSuggestions();
      return;
    }
    if (e.target.id === "in-appearance") {
      S.obs.appearance = e.target.value;
      applyProseSize();
      persist(); renderPickers(); renderResults(); renderSuggestions();
      return;
    }
    if (e.target.id === "in-level" || e.target.id === "in-party") {
      const v = e.target.value === "" ? null : Number(e.target.value);
      const ok = v == null || (Number.isFinite(v) && v > 0);
      if (e.target.id === "in-level") S.party.level = ok ? v : null;
      else S.party.size = ok ? v : 4;
      renderBand();
      persist(); renderResults(); renderSuggestions();
      return;
    }
    if (e.target.id === "in-count") {
      const t = S.tabs.find(x => x.id === S.activeId);
      if (t) t.count = Math.max(1, Number(e.target.value) || 1);
      renderBand();
      persist(); renderResults(); renderSuggestions();
      return;
    }
    if (e.target.id === "in-ac" || e.target.id === "in-hp") {
      const v = e.target.value === "" ? null : Number(e.target.value);
      const ok = v == null || (Number.isFinite(v) && v > 0);
      if (e.target.id === "in-ac") S.ac = ok ? v : null; else S.hp = ok ? v : null;
      persist(); renderCrHint(); renderResults(); renderSuggestions();
    }
  });

  // Enter in the symptom box takes the top suggestion — the fastest path for someone
  // typing mid-fight, and the box is the highest-value field in the form.
  document.addEventListener("keydown", e => {
    if (e.target.id !== "sym-search" || e.key !== "Enter") return;
    e.preventDefault();
    const first = $("sym-results").querySelector("[data-sym-add]");
    if (first) first.click();
  });

  load().catch(err => fatal("Failed to load: " + esc(err.message)));
})();
