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

  /* Values are stored lowercase because that is what the scorer matches on; labels are
     capitalised because that is what a reader wants. Same string, two jobs. */
  const cap = v => String(v || "").replace(/^./, c => c.toUpperCase());

  const STORE_KEY = "monster-doxxer-session";
  /* Rank a wider window than gets shown. The extra rows are never rendered; they exist so
     the tie count can say "40+ are tied" rather than reporting the size of the list it
     happened to cut, and so F13 picks its tests against the real field of candidates. */
  const WINDOW = 40;
  const SHOWN = 12;
  /* The embedding half's share of the appearance score. MEASURED, on a real
     ViT-B-32/laion2b index over 4528 monsters with 2632 pictures mixed in
     (eval/appearance.js --sweep), against the query representation this page actually
     uses — an IDF-weighted mean of a query's word vectors, correctly stemmed:

         lexical only   4/16 top-1   8/16 top-5   10/16 top-20
         0.35           4/16         8/16         12/16
         0.5            4/16         7/16         13/16
         0.65           3/16         7/16         12/16
         semantic only  0/16         0/16          0/16

     +2 of 16 at top-20, nothing at top-1 or top-5. Ties a flat, unweighted mean exactly
     (both 4/8/12 at 0.35) — weighting by rarity is kept for being demonstrably correct
     (see semanticWeight() in appearance.js and its regression test), not because this
     benchmark rewards it. It doesn't, at n=16, and that is stated plainly rather than
     papered over: an earlier build of this same idea had a real bug — the IDF lookup
     wasn't stemming, so "eyestalks" scored as unseen — and THAT version measured 13/16.
     Fixing the bug did not reproduce the higher number. Sixteen queries cannot tell a 12
     from a 13 apart; the bug was wrong regardless of what the aggregate rewarded.

     The number that has never moved, under any weighting scheme tried: alone, the
     embedding half finds nothing. 0/16 even at top-20, where chance over 4528 monsters is
     ~0.07 expected hits. Properly-encoded sentences reach 1/3/7 semantic-only from the
     identical vectors — so the vectors can retrieve, and no way of averaging a bag of
     word vectors tried here can. What ships is a reranker over what BM25 already
     surfaced, not the semantic search this feature is named for. See DESIGN.md. */
  const BLEND_WEIGHT = 0.35;

  /* ---------- state ----------

     WHAT IS PER-TAB AND WHAT IS NOT is the only real decision here. Observations belong
     to a monster: the whole point of tabs is that the evidence for the thing in the
     doorway must never blend into the evidence for the thing on the ceiling, which is
     the "two monsters, one set of observations" failure the handoff flagged from the
     start. Everything else — which books your DM owns, how big your party is — is a fact
     about the TABLE and is shared, because retyping it per monster would be absurd. */
  const blankObs = () => ({ symptoms: [], mechanics: [], type: "", size: "", movement: [], senses: [],
    condImmune: [], damage: {}, appearance: "", heardName: "",
    /* What it did with its turn. One row per action rather than three bags of chips,
       because the fields have to be true OF THE SAME ACTION to mean anything — see
       scoreCombat. Rows are created empty and an empty row is not an observation. */
    attacks: [], saves: [],
    /* What it cast, and how. Spell names are held loosely — see VOLATILE_FACETS in
       score.js — while the shape of the spellcasting is weighed in full. */
    spells: [], castingKind: [], castingAbility: "", castingClass: [],
    // The bounds the party's dice established.
    acHit: "", acMiss: "", dcPass: "", dcFail: "", hpLived: "", hpDied: "" });
  const blankTab = () => ({ id: "t" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    label: "", best: "", obs: blankObs(), ac: null, hp: null, retuned: false,
    // Which fight this creature was in, and how many of it there were. Both feed the
    // party-plausibility band: one ogre and one of eight ogres are very different CRs.
    fight: "f1", count: 1 });

  const S = {
    monsters: [], rarity: null, numerics: null, legacy: null, ontology: null, srcRows: [],
    appearanceIndex: null, nameIndex: null, embeddings: null, sizeFromProse: "",
    fluff: null,              // name|source -> the book's Info text, for the detail panel
    loreIndex: null,          // built on demand — see loreIndex()
    detailTab: "stat",        // which tab the detail panel is showing
    srcVisible: null,         // group -> the codes currently shown, for the bulk buttons
    // The active tab's fields, mirrored here so the rest of the app reads them unchanged.
    obs: blankObs(),
    ac: null, hp: null, retuned: false,
    tabs: [], activeId: "",
    sources: {},              // { CODE: "ignore" | "include" | "exclude" } — shared
    party: { level: null, size: 4 },   // a fact about the table, so shared across tabs
    /* Whether to drop unique adventure NPCs. A fact about the TABLE — which module you
       are in — so shared across tabs like the book filter, and off by default because a
       named NPC really can be what you fought. */
    hideNamed: false,
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
    /* How it cast, which the party can usually say even when they cannot name a spell:
       whether it spoke and gestured, and whether it did neither. */
    castingKind: { multi: true, opts: ["innate", "prepared", "psionic"] },
    castingAbility: { multi: false, opts: ["int", "wis", "cha"] },
    castingClass: { multi: true, opts: ["wizard", "cleric", "druid", "bard", "sorcerer",
      "warlock", "paladin", "ranger", "artificer"] },
  };

  /* The vocabularies a combat row draws on. Same principle as PICKERS: fixed lists, so
     the options do not change shape because of which books happen to be loaded.

     The attack kinds are 5e's four, which is what a GM's narration distinguishes:
     whether it closed to touch you, and whether it was casting. */
  const ATTACK_KINDS = ["melee weapon", "ranged weapon", "melee spell", "ranged spell"];
  const ABILITIES = ["str", "dex", "con", "int", "wis", "cha"];
  /* Damage types come from DAMAGE_TYPES below, which the damage-interaction table
     already owns — one list, so a type can never be offered in one place and not the
     other.

     The conditions a player would name having had one put on them. Not 5e's full list:
     "incapacitated" is a consequence of paralysis nobody reports separately. */
  const CONDITIONS = ["blinded", "charmed", "deafened", "frightened", "grappled",
    "paralyzed", "petrified", "poisoned", "prone", "restrained", "stunned",
    "unconscious", "exhaustion"];
  const CONDIMMUNE_LABEL = { exhaustion: "exhausted" };

  /* The six roll boxes, input id -> observation field. Text inputs, so they answer to
     `input` rather than `change`: the derived range reads back as you type, which is the
     point — a mistyped total is visible before it silently moves the ranking. */
  const ROLL_FIELDS = { "in-ac-hit": "acHit", "in-ac-miss": "acMiss",
    "in-dc-pass": "dcPass", "in-dc-fail": "dcFail",
    "in-hp-lived": "hpLived", "in-hp-died": "hpDied" };

  const DAMAGE_TYPES = ["acid", "bludgeoning", "cold", "fire", "force", "lightning", "necrotic",
    "piercing", "poison", "psychic", "radiant", "slashing", "thunder"];
  /* The player's words, not the rulebook's. Someone at a table says "it shrugged it off",
     not "it has resistance". The value stored is still the mechanical state. */
  /* The value the scorer matches on, and the word above the column. These used to be
     the player's phrasing ("no effect", "halved") on the theory that nobody says
     "resistance" at a table. They do, though — and a column head that says "halved"
     while the reasoning below says "resistant" makes the reader do the translation
     themselves. One vocabulary, the rules' own. */
  const DMG_STATES = [
    ["immune", "Immune"],
    ["resistant", "Resistant"],
    ["normal", "Normal"],
    ["vulnerable", "Vulnerable"],
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

    /* THE SPELL VOCABULARY, AND A MISTAKE WORTH RECORDING.

       It was built from the corpus alone, on the reasoning that offering a spell no
       monster casts is offering a guaranteed dead end. That reasoning is wrong, and the
       feature's own premise says why: the whole point of pricing spells as volatile is
       that GMs re-prepare casters constantly. A GM who handed their archmage Melf's
       Minute Meteors — which nothing in the bestiary casts — is precisely the case this
       module exists for, and the suggestion list refused to admit the spell existed.

       So: the full spell list when data/spells is present, the corpus's own names
       otherwise, and free text accepted either way. Suggestions are a convenience, never
       a constraint — see addSpell. */
    const spellCount = new Map();
    S.monsters.forEach(m => (m.spells || []).forEach(sp =>
      spellCount.set(sp, (spellCount.get(sp) || 0) + 1)));

    /* Optional, like the fluff and the CLIP index: read it if it is there, carry on
       without it if not. 5e.tools ships it next to the bestiary. */
    const spellNames = new Map();          // lowercase key -> the name as the book prints it
    const sidx = await getJsonOptional("data/spells/index.json");
    if (sidx) {
      await Promise.all(Object.values(sidx).map(async f => {
        const j = await getJsonOptional("data/spells/" + f);
        (j && j.spell || []).forEach(sp => {
          if (sp && sp.name) spellNames.set(String(sp.name).toLowerCase(), String(sp.name));
        });
      }));
    }
    S.spellNames = spellNames;

    /* Ordered by how many monsters cast it, so the first suggestions are the ones you
       are likeliest to have met; everything else follows alphabetically. */
    const known = [...spellCount.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .map(([sp]) => sp);
    const rest = [...spellNames.keys()].filter(k => !spellCount.has(k)).sort();
    S.spellVocab = known.concat(rest);
    const dl = $("spell-list");
    if (dl) dl.innerHTML = S.spellVocab.map(sp => `<option value="${esc(spellTitle(sp))}">`).join("");

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
    /* Kept, not just consumed. It was built for the search index and dropped on the
       floor; the Info tab is the same text, and re-reading a hundred files to show one
       monster's description would be absurd. */
    S.fluff = window.fluffMap(fluffLists);
    S.appearanceIndex = window.buildAppearanceIndex(S.monsters, S.fluff);
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
        hideNamed: S.hideNamed,
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
      S.hideNamed = !!d.hideNamed;
      if (d.party) S.party = Object.assign({ level: null, size: 4 }, d.party);
    }
    $("in-hide-named").checked = S.hideNamed;
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
    { const el = $("in-spell"); if (el) el.value = ""; }
    $("sym-search").value = "";
    $("in-count").value = t.count || 1;
    // The roll boxes belong to the monster, so they follow a tab switch like everything
    // else in `obs` — otherwise one creature's dice would score another.
    Object.entries(ROLL_FIELDS).forEach(([id, key]) => {
      const el = $(id); if (el) el.value = S.obs[key] || "";
    });
    renderRanges();
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

  /* TABS, GROUPED BY THE FIGHT THEY WERE IN.

     The grouping already existed and already worked — it drives the CR band, and moving
     a monster into its own fight moves that band from CR 1-5 to CR 4-12. What it did not
     do was SHOW anything: the tab strip was one flat row, and the only control was a
     dropdown in the Party module several screens down, so a grouping you had set looked
     exactly like one you had not. A feature with no visible state reads as broken, and
     was reported as broken.

     The label only appears once there is more than one fight. With a single fight it
     would be a heading over the whole strip saying nothing. */
  function renderTabs() {
    const el = $("doxx-tabs");
    if (!el) return;

    const btn = t => {
      const active = t.id === S.activeId;
      return `<button type="button" class="doxx-tab${active ? " active" : ""}" data-tab="${esc(t.id)}" ` +
        `title="${active ? "click to rename" : "switch to this monster"}">${esc(tabLabel(t))}` +
        (t.count > 1 ? ` <span class="hint">\u00d7${esc(t.count)}</span>` : "") +
        (S.tabs.length > 1 ? `<span class="doxx-tab-x" data-closetab="${esc(t.id)}" title="close">\u00d7</span>` : "") +
        `</button>`;
    };

    const fights = fightIds();
    const add = `<button type="button" id="tab-add" title="another monster in the same fight">+ Another monster</button>`;
    if (fights.length < 2) {
      el.innerHTML = S.tabs.map(btn).join("") + add;
      return;
    }
    el.innerHTML = fights.map((f, i) => {
      const inFight = S.tabs.filter(t => (t.fight || "f1") === f);
      const n = fightCount(f);
      return `<span class="tab-group">` +
        `<span class="tab-group-label" title="${n} creature${n === 1 ? "" : "s"} in this fight, ` +
        `which is what sets the CR band">Fight ${i + 1}</span>` +
        inFight.map(btn).join("") + `</span>`;
    }).join("") + add;
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
               `${esc(cap(CONDIMMUNE_LABEL[v] || v))}</button>`;
      }).join("");
    });
  }

  /* ============================================================
     Combat rows — the attacks and saves the party watched.

     Every field is optional and every field is a text or select input rather than a
     chip, because the interesting ones are numbers the party read off the table: what
     it rolled, how far away it was, how much it hurt. Chips were what the old version
     offered and the answer to all three was "you can't say".

     A row you opened and did not fill in is not an observation — buildObs drops it —
     so adding a row costs nothing until you put something in it.
     ============================================================ */
  const ATTACK_FIELDS = [
    { key: "count",  label: "attacks",    w: "4rem",   type: "number" },
    { key: "kind",   label: "attack type", opts: () => ATTACK_KINDS },
    { key: "rolls",  label: "attack rolls", w: "6rem" },
    { key: "reach",  label: "reach/range (ft.)", w: "5rem", type: "number" },
    { key: "dmg",    label: "damage",     w: "8rem" },
    { key: "dmgType", label: "damage type", opts: () => DAMAGE_TYPES },
    { key: "condition", label: "condition", opts: () => CONDITIONS },
  ];
  const SAVE_FIELDS = [
    { key: "abil",   label: "ability",    opts: () => ABILITIES, upper: true },
    { key: "dc",     label: "DC",         w: "4.5rem" },
    /* The saves the party made, which bound the DC the same way attack totals bound AC
       — a passed save is an inclusive upper bound, a failed one an exclusive lower
       bound. Better evidence than the DC field above it, because the GM has to announce
       a DC for you to know it and nobody has to announce anything for you to have
       rolled. Both are offered: sometimes you are told, sometimes you only roll. */
    { key: "passed", label: "saves passed", w: "5.5rem" },
    { key: "failed", label: "saves failed", w: "5.5rem" },
    { key: "area",   label: "area (ft.)", w: "5rem", type: "number" },
    { key: "dmg",    label: "damage",     w: "7rem" },
    { key: "dmgType", label: "damage type", opts: () => DAMAGE_TYPES },
    { key: "condition", label: "condition", opts: () => CONDITIONS },
  ];

  const rowHasContent = r => !!r && Object.keys(r)
    .some(k => r[k] !== "" && r[k] != null);

  function renderRowField(f, row, list, i) {
    const val = row[f.key] == null ? "" : String(row[f.key]);
    const attrs = `data-row="${list}" data-idx="${i}" data-field="${esc(f.key)}"`;
    const inner = f.opts
      ? `<select class="rowsel" ${attrs}><option value=""></option>` +
        /* The VALUE stays lowercase — it is what the scorer matches on — while the
           label is capitalised. Two different things that happened to be one string. */
        f.opts().map(o => `<option value="${esc(o)}"${o === val ? " selected" : ""}>` +
          `${esc(f.upper ? o.toUpperCase() : cap(o))}</option>`).join("") +
        `</select>`
      : `<input type="${f.type || "text"}" class="txt rowin" ${attrs} ` +
        `style="width:${f.w || "5rem"}" value="${esc(val)}" autocomplete="off">`;
    return `<label class="rowfield"><span class="hint">${esc(f.label)}</span>${inner}</label>`;
  }

  /* The spells the party named, as removable chips. Same shape as the symptom chips
     because it is the same interaction: a growing list of things you saw. */
  function renderSpells() {
    const el = $("spell-chosen");
    if (!el) return;
    el.innerHTML = (S.obs.spells || []).map(sp =>
      `<button class="chip on" data-spell-remove="${esc(sp)}" title="remove">` +
      `${esc(spellTitle(sp))}</button>`).join("");
  }

  /* THE SCORE BAR, WITH ITS NUMBER IN IT.

     It was a hover-only tooltip, which meant the one piece of ornament in the results
     was unreadable: a reader saw a blue rectangle and had no way to learn what it
     measured without discovering that it could be hovered.

     The number is drawn TWICE — once in the ordinary text colour across the whole
     track, once in white clipped to the filled part. Which half you read depends on
     where the fill ends, so the digits stay legible at 4% and at 96% alike. One copy
     in white would vanish on the empty half of the track; one copy in dark would
     vanish on the blue.

     The fill was also rendering ABOVE its frame rather than inside it: both were
     inline-blocks with vertical-align: middle, so the inner one aligned to the track's
     baseline instead of filling it. It is positioned now, which is what a fill wants. */
  /* ============================================================
     WHERE A SCORE CAME FROM.

     The bar said 24% and nothing else, so two monsters tied at 24% looked identical when
     one had earned it from a name and the other from three symptoms. The evidence lines
     underneath name every feature, which is the opposite problem: complete and unreadable
     at a glance.

     So the bar is split into one band per module of the form, coloured to match a swatch
     on that module's heading. Hovering gives the arithmetic. The bands sum to the score
     exactly, because they are computed from the same numbers it is: each category's
     credit minus its penalties, over the same F7 denominator.
     ============================================================ */
  const CATEGORIES = [
    { id: "name",     label: "Name",              colour: "#1a56c4",
      facets: ["name"] },
    { id: "symptom",  label: "Observed effects",  colour: "#7b2d8e",
      facets: ["symptom", "mechanic"] },
    { id: "look",     label: "Appearance and lore", colour: "#0f7b6c",
      facets: ["appearance"] },
    { id: "creature", label: "Creature",          colour: "#a8571a",
      facets: ["type", "typeTag", "size", "movement", "hover", "sense", "condImmune"] },
    { id: "damage",   label: "Damage taken",      colour: "#b32318",
      facets: ["damage", "immune", "resist", "vuln"] },
    { id: "fight",    label: "Attacks and saves", colour: "#2b6cb0",
      facets: ["attack", "save", "attackKind", "saveAbility", "attacksPerTurn",
               "inflicts", "damageDealt", "traitTag", "actionTag", "dc"] },
    { id: "spells",   label: "Spellcasting",      colour: "#8a6d1f",
      facets: ["spell", "castingKind", "castingAbility", "castingClass"] },
    { id: "numbers",  label: "Numbers",           colour: "#4a5568",
      facets: ["ac", "hp"] },
  ];
  const CATEGORY_OF = (() => {
    const m = Object.create(null);
    CATEGORIES.forEach(c => c.facets.forEach(f => { m[f] = c.id; }));
    return m;
  })();
  const CATEGORY_BY_ID = new Map(CATEGORIES.map(c => [c.id, c]));

  /* Each category's share of the score, in the same units the bar is drawn in. Anything
     whose facet has no category falls into "other" rather than vanishing — a band that
     silently dropped evidence would make the arithmetic lie. */
  function scoreParts(r) {
    const parts = new Map();
    const add = (facet, w) => {
      const id = CATEGORY_OF[facet] || "other";
      parts.set(id, (parts.get(id) || 0) + w);
    };
    const denom = r.supplied > 0 ? r.supplied : 1;
    (r.for || []).forEach(x => {
      // The appearance bonus is added AFTER normalisation, so it is already on the score's scale.
      if (x.facet === "appearance") add(x.facet, x.weight);
      else add(x.facet, x.weight / denom);
    });
    (r.against || []).forEach(x => add(x.facet, x.weight / denom));
    return [...parts.entries()]
      .map(([id, share]) => ({ id, share, cat: CATEGORY_BY_ID.get(id) }))
      .filter(p => p.share > 0.0005)
      .sort((a, b) => b.share - a.share);
  }

  function scoreBar(rel, r) {
    const pct = Math.round(rel * 100);
    const label = `${pct}%`;
    const parts = r ? scoreParts(r) : [];

    /* Bands are drawn from the shares, then clipped to the filled width — a category
       cannot paint past the score it helped produce. */
    let run = 0;
    const bands = parts.map(p => {
      const w = Math.max(0, Math.min(100 - run, p.share * 100));
      const seg = `<span class="bar-seg" style="left:${run}%;width:${w}%;` +
                  `background:${p.cat ? p.cat.colour : "#888"}"></span>`;
      run += w;
      return seg;
    }).join("");

    const rows = parts.map(p =>
      `<div class="tip-row"><span class="tip-sw" style="background:${p.cat ? p.cat.colour : "#888"}"></span>` +
      `<span class="tip-pct">${Math.round(p.share * 100)}%</span>` +
      `<span>${esc(p.cat ? p.cat.label : "other")}</span></div>`).join("");

    return `<span class="barwrap">` +
      `<span class="bar-track">${bands}` +
      `<span class="bar-num">${label}</span>` +
      `<span class="bar-num on" style="clip-path:inset(0 ${100 - pct}% 0 0)">${label}</span>` +
      `</span>` +
      (rows ? `<span class="bar-tip"><div class="tip-total">${label}</div>${rows}</span>` : "") +
      `</span>`;
  }

  function renderCombatRows() {
    const draw = (list, fields, verb) => {
      const rows = S.obs[list] || [];
      $(list === "attacks" ? "atk-rows" : "sav-rows").innerHTML = rows.map((row, i) =>
        `<div class="combatrow">` +
        fields.map(f => renderRowField(f, row, list, i)).join("") +
        `<button class="rowdel" data-rowdel="${list}" data-idx="${i}" ` +
        `title="remove this ${verb}">&times;</button></div>`).join("");
    };
    draw("attacks", ATTACK_FIELDS, "attack");
    draw("saves", SAVE_FIELDS, "save");
    renderAttackTotal();
  }

  /* SEPARATE FROM renderCombatRows ON PURPOSE. Redrawing the rows replaces the very
     input the user is typing in, which loses the caret and — because the browser is
     still delivering blur to a node that no longer exists — throws NotFoundError. The
     derived total lives outside the rows precisely so it can be refreshed on every
     keystroke without touching them. */
  function renderAttackTotal() {
    /* Echo the derived attack count back. It is derived rather than asked for, so the
       user has no other way to see what the tool concluded — and a wrong total here is
       exactly the mismatch the playtest reported. */
    const el = $("atk-total");
    if (!el) return;
    const filled = (S.obs.attacks || []).filter(rowHasContent);
    const counts = filled.map(r => parseInt(r.count, 10)).filter(n => Number.isFinite(n) && n > 0);
    if (filled.length && counts.length === filled.length) {
      const total = counts.reduce((a, b) => a + b, 0);
      el.textContent = total > 10
        ? `That is ${total} attack rolls a turn — more than any statblock claims, so it is not being used.`
        : `That is ${total} attack roll${total === 1 ? "" : "s"} a turn.`;
    } else if (filled.length) {
      el.textContent = "Say how many of each it made and the total becomes evidence too.";
    } else {
      el.textContent = "";
    }
  }

  function renderDamage() {
    $("dmg-body").innerHTML = DAMAGE_TYPES.map(d => {
      const cur = S.obs.damage[d] || "";
      const cells = DMG_STATES.map(([state]) =>
        `<td class="opt"><input type="radio" name="dmg-${d}" data-dmg="${d}" value="${state}"` +
        `${cur === state ? " checked" : ""} title="${esc(state)}"></td>`).join("");
      // No clear button: clicking the selected option again unselects it, which is
      // what people try first anyway. Unselected means "we never tested this", and
      // costs the candidate nothing (F2).
      return `<tr><td class="dt">${esc(cap(d))}</td>${cells}</tr>`;
    }).join("");
  }

  /* Clicking the selected damage option again unselects it.

     This has to hang off `click` rather than `change`, because clicking an already-
     checked radio fires no change event at all — the browser sees no change. So the
     comparison is against our own state, not the DOM's: if the option clicked is the
     one already recorded, the click means "undo that", and preventDefault stops the
     radio from staying visually checked before the re-render catches up. */
  document.addEventListener("click", e => {
    const dmg = e.target.closest && e.target.closest("[data-dmg]");
    if (!dmg) return;
    if (S.obs.damage[dmg.dataset.dmg] !== dmg.value) return;   // a change: let `change` have it
    e.preventDefault();
    delete S.obs.damage[dmg.dataset.dmg];
    persist(); renderDamage(); renderResults(); renderSuggestions();
  });

  /* Spell names as the books print them.

     The bestiary writes them lowercase ({@spell fire bolt}), so they are stored and
     matched lowercase — one canonical key, no chance of "Fire Bolt" and "fire bolt"
     becoming two chips. Only the DISPLAY is capitalised, and only when the real name is
     not already known: with data/spells present the book's own spelling wins outright,
     which is the only way to get "Abi-Dalzim" and "Otiluke" right.

     Small words stay lowercase inside a title but never at the start; hyphens and
     slashes ("enlarge/reduce", "abi-dalzim's") capitalise on both sides; a possessive
     's does not become 'S. */
  const SMALL_WORDS = new Set(["of", "the", "and", "to", "from", "in", "on", "at", "or", "a", "an"]);
  function spellTitle(name) {
    const raw = String(name || "");
    const known = S.spellNames && S.spellNames.get(raw.toLowerCase());
    if (known) return known;
    return raw.split(" ").map((word, i) =>
      /* Split on the punctuation that starts a new word, keeping it, so both halves get
         capitalised. The apostrophe is NOT in that set: "melf's" must not become
         "Melf'S". */
      word.split(/([-/])/).map((part, j) => {
        if (part === "-" || part === "/") return part;
        if (i > 0 && j === 0 && SMALL_WORDS.has(part)) return part;
        return part.charAt(0).toUpperCase() + part.slice(1);
      }).join("")
    ).join(" ");
  }

  /* ============================================================
     A SYMPTOM AND THE MECHANICS UNDER IT.

     A symptom is vague on purpose: the players never hear the name, so "one specific
     spell had no effect whatsoever" has to cover Spell Immunity, an immunity to one
     named spell, and Antimagic Susceptibility at once. But GMs do sometimes say the
     name out loud, and a party that heard it knows something far more specific than
     the sentence can express — and, until now, had no way to say it.

     So every mechanic under a symptom is its own button. The parent and its children
     are a select-all relationship: the parent on means all of them, turning one child
     off narrows the claim, turning the last one on widens it back. The invariant the
     rest of the code depends on is that a symptom is EITHER in `symptoms` (all of it)
     or has keys in `mechanics` (some of it), never both — so the existing, measured
     symptom path is untouched whenever the parent button is used.

     Symptoms with a single candidate get no children: the parent already is the
     mechanic, and a lone sub-button that can never disagree with its parent is noise.
     ============================================================ */
  const mechNames = s => (window.mechanicsOf ? window.mechanicsOf(s, 99).shown : []);
  const mechKeys = s => mechNames(s).map(m => window.mechanicKey(s.id, m));
  const hasSubs = s => mechNames(s).length > 1;

  /* "all" | "some" | "none" — everything the UI draws is derived from this rather than
     stored, so the two halves of the selection cannot drift apart. */
  function symState(sym) {
    if (S.obs.symptoms.includes(sym.id)) return "all";
    return mechKeys(sym).some(k => S.obs.mechanics.includes(k)) ? "some" : "none";
  }
  const mechOn = (sym, key) =>
    S.obs.symptoms.includes(sym.id) || S.obs.mechanics.includes(key);

  // Drop every trace of a symptom, whichever half it was recorded in.
  function clearSym(sym) {
    const i = S.obs.symptoms.indexOf(sym.id);
    if (i >= 0) S.obs.symptoms.splice(i, 1);
    const keys = mechKeys(sym);
    S.obs.mechanics = S.obs.mechanics.filter(k => !keys.includes(k));
  }

  /* Re-record a symptom from the set of its mechanics that should be on, collapsing to
     whichever of the two representations fits. This is the only writer of either list
     for symptom state, which is what keeps the invariant true. */
  function setSym(sym, onKeys) {
    clearSym(sym);
    const all = mechKeys(sym);
    if (!onKeys.length) return;
    if (onKeys.length === all.length) { S.obs.symptoms.push(sym.id); return; }
    S.obs.mechanics = S.obs.mechanics.concat(onKeys);
  }

  function toggleSymptom(sym) {
    if (symState(sym) === "all") clearSym(sym);
    else setSym(sym, mechKeys(sym));
  }

  function toggleMechanic(sym, key) {
    const all = mechKeys(sym);
    // "all" is stored as the symptom alone, so expand it before narrowing.
    const on = symState(sym) === "all" ? all.slice()
      : all.filter(k => S.obs.mechanics.includes(k));
    const i = on.indexOf(key);
    if (i >= 0) on.splice(i, 1); else on.push(key);
    setSym(sym, on);
  }

  /* THE SENTENCE, THEN THE MECHANIC IT MEANS.

     Eleven sentences in the offence group read as near-synonyms of each other, because
     the ontology deliberately never says "Pack Tactics" — the players never heard the
     name. That is right for the sentence and wrong for the person choosing between
     them, who has no way to tell what any of them will actually look for. The bracket
     restores it without putting the jargon in the player's mouth.

     Read straight off the candidate list, so it cannot drift from what the symptom
     really matches. */
  /* Symptoms another module asks for better. The ten damage-type sentences — "It burned
     me", "It hit me with cold" — are the same question an attack row's damage-type
     field asks, except the row pairs it to one action and this does not. Both would be
     scored, which is the same evidence twice; and offering both invites the user to
     answer in the weaker place. The ontology says which, via `collectedBy`, so this
     stays a data decision rather than app.js hardcoding a group name.

     The symptom is NOT deleted: the tagger still uses it to index the corpus, and the
     rarity table still counts it. Only the player-facing list drops it. */
  const collectedElsewhere = s => !!(s && s.collectedBy);

  /* One symptom, as a parent button plus a button per mechanic under it. A row rather
     than one button, because a button cannot contain another button. */
  function symRow(sym) {
    const st = symState(sym);
    const cls = st === "all" ? " on" : st === "some" ? " part" : "";
    const parent = `<button class="sym-hit${cls}" data-sym-toggle="${esc(sym.id)}">` +
      `${esc(sym.player)}</button>`;
    /* A symptom with ONE mechanic gets its name as plain text, not as a button. The
       button would be a control that can never disagree with its parent — clicking it
       and clicking the sentence do the same thing — but the NAME still has to be
       there, because it is what tells apart eleven sentences that read alike. */
    const names = mechNames(sym);
    if (!hasSubs(sym)) {
      const only = names.length ? ` <span class="sym-mech">(${esc(names[0])})</span>` : "";
      return `<div class="sym-row">${parent.replace("</button>", only + "</button>")}</div>`;
    }
    const subs = names.map(name => {
      const key = window.mechanicKey(sym.id, name);
      return `<button class="sym-sub${mechOn(sym, key) ? " on" : ""}" ` +
        `data-mech="${esc(key)}" data-mech-sym="${esc(sym.id)}" ` +
        `title="only this mechanic, rather than any of the ${names.length}">` +
        `${esc(name)}</button>`;
    }).join("");
    return `<div class="sym-row">${parent}<span class="sym-subs">${subs}</span></div>`;
  }

  function renderSymptoms() {
    /* Both halves of the selection, in one strip: whole symptoms and the partial ones.
       A partial selection says which mechanics survived, because "It vanished" and "It
       vanished (Incorporeal Movement)" are very different claims and the chip is the
       only place you would see which one you made. */
    const partials = new Map();
    S.obs.mechanics.forEach(k => {
      const id = k.slice(0, k.indexOf("::"));
      if (!partials.has(id)) partials.set(id, []);
      partials.get(id).push(k.slice(k.indexOf("::") + 2));
    });
    const chosen = S.obs.symptoms.map(id => {
      const s = S.ontology.byId[id];
      const mech = s && window.mechanicsLabel ? window.mechanicsLabel(s) : "";
      return `<button class="chip on" data-sym-remove="${esc(id)}" ` +
             `title="${esc(mech ? "looks for: " + mech : "remove")}">` +
             `${esc(s ? s.player : id)}</button>`;
    }).concat([...partials.entries()].map(([id, names]) => {
      const s = S.ontology.byId[id];
      return `<button class="chip on part" data-sym-remove="${esc(id)}" ` +
             `title="narrowed to ${esc(names.join(", "))}">` +
             `${esc(s ? s.player : id)} <span class="chip-narrow">(${esc(names.join(", "))})</span>` +
             `</button>`;
    })).join("");
    $("sym-chosen").innerHTML = chosen;

    const q = $("sym-search").value.trim();
    const box = $("sym-results");

    /* WITH AN EMPTY BOX, SHOW EVERYTHING, GROUPED.

       This used to render nothing at all until you typed something that happened to
       match, which made the single most valuable input in the tool — worth four times
       what any other facet is — look like an empty text field that does nothing. You
       cannot search a list of 111 sentences you have never seen. Browsing is the
       default; searching narrows it. */
    if (!q) {
      const groups = new Map();
      S.ontology.symptoms.forEach(s => {
        if (collectedElsewhere(s)) return;
        const g = s.group || "other";
        if (!groups.has(g)) groups.set(g, []);
        groups.get(g).push(s);
      });
      if (!groups.size) { box.innerHTML = `<span class="hint">Nothing to pick from.</span>`; return; }
      box.innerHTML = [...groups.entries()]
        .sort((a, b) => b[1].length - a[1].length)
        .map(([g, list]) =>
          `<div class="sym-group"><div class="sym-group-label">${esc(GROUP_LABELS[g] || g)}</div>` +
          list.map(s => symRow(s)).join("") +
          `</div>`).join("");
      return;
    }

    const hits = window.lookup(S.ontology, q, 12)
      .filter(h => !collectedElsewhere(S.ontology.byId[h.id]));
    box.innerHTML = hits.length
      ? hits.map(h => symRow(S.ontology.byId[h.id] || h)).join("")
      : `<span class="hint">Nothing matches that yet. Try plainer words &mdash; ` +
        `&ldquo;it vanished&rdquo;, &ldquo;my sword bounced off&rdquo; &mdash; or clear the box ` +
        `to browse all ${S.ontology.symptoms.length}.</span>`;
  }

  /* The ontology's group keys are terse because they are data. These are what a player
     reads above each block. An unknown group falls through to its own key. */
  const GROUP_LABELS = {
    durability: "Staying alive", damage: "Damage it dealt", condition: "What it did to us",
    movement: "How it moved", senses: "What it noticed", turn: "Its turn",
    reaction: "When we hit it", offence: "How it fought", disguise: "Before we knew",
    multiply: "When it was hurt", meta: "Odder things",
  };

  /* F16's tri-state filter, grouped Books / Adventures / Other. */
  function renderSources() {
    const named = S.monsters.reduce((n, m) => n + (m.isNamed ? 1 : 0), 0);
    const el = $("named-count");
    if (el) el.textContent = named
      ? ` \u2014 ${named} unique adventure NPCs, e.g. Acererak. Off by default: one of them really might be what you fought.`
      : "";
    /* NARROW THE LIST, NEVER THE FILTER. 107 sources is more than anyone scans, and
       "which button is Curse of Strahd" is a real question — but a search box over a
       filter invites a nasty bug, where a source you excluded scrolls out of view and
       you forget it is still excluded. So the search hides ROWS and touches no state:
       anything already include/exclude stays visible however the search reads. */
    const q = ($("src-search") ? $("src-search").value : "").trim().toLowerCase();
    const visible = !q ? S.srcRows : S.srcRows.filter(r =>
      (S.sources[r.code] && S.sources[r.code] !== "ignore") ||
      r.code.toLowerCase().includes(q) || String(r.name).toLowerCase().includes(q));

    const groups = window.groupRows(visible);
    /* What each group's Include all / Exclude all should act on. Recorded at render
       time from the VISIBLE rows: with a search active, a bulk button that reached
       sources you cannot see would be a trap — you would exclude a book by name and
       silently take out five others with it. */
    S.srcVisible = new Map(groups.map(g => [g.group, g.rows.map(r => r.code)]));
    if (!groups.length) {
      $("src-filter").innerHTML = q
        ? `<span class="hint">No source matches &ldquo;${esc(q)}&rdquo;.</span>`
        : `<span class="hint">no sources loaded</span>`;
      return;
    }
    $("src-filter").innerHTML = groups.map(g => {
      const opts = g.rows.map(r => {
        const st = S.sources[r.code] || "ignore";
        const cls = st === "include" ? " inc" : st === "exclude" ? " exc" : "";
        /* While searching, the code alone is useless — you searched by title, so the
           title is what confirms the hit. */
        const label = q && r.name !== r.code ? `${r.code} · ${r.name}` : r.code;
        return `<button class="fbtn${cls}" data-src="${esc(r.code)}" ` +
               `title="${esc(r.name)} — ${r.count} monster${r.count === 1 ? "" : "s"}">${esc(label)}</button>`;
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
      // Partial selections — see the symptom/mechanic model above.
      mechanics: (S.obs.mechanics || []).slice(),
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

    /* Combat rows. Empty rows are dropped rather than passed through: a row the user
       opened and did not fill in is not an observation, and scoring it as one would
       penalise every monster for a blank. */
    const attacks = (S.obs.attacks || []).filter(rowHasContent);
    const saves = (S.obs.saves || []).filter(rowHasContent);
    if (attacks.length) obs.attacks = attacks.map(r => Object.assign({}, r));
    if (saves.length) obs.saves = saves.map(r => Object.assign({}, r));

    /* Attacks per turn is DERIVED from the rows rather than asked for separately.
       Asking twice invites the two answers to disagree, and the rows already know:
       two claws and a bite is three attack rolls. Only counted when every attack row
       says how many it made, since a partial sum is worse than no claim at all. */
    const counts = attacks.map(r => parseInt(r.count, 10)).filter(n => Number.isFinite(n) && n > 0);
    if (attacks.length && counts.length === attacks.length) {
      const total = counts.reduce((a, b) => a + b, 0);
      if (total > 0 && total <= 10) obs.attacksPerTurn = String(total);
    }

    // What it cast. Spell names go in loosely priced; the shape of the casting does not.
    if (S.obs.spells.length) obs.spells = S.obs.spells.slice();
    if (S.obs.castingKind.length) obs.castingKind = S.obs.castingKind.slice();
    if (S.obs.castingClass.length) obs.castingClass = S.obs.castingClass.slice();
    if (S.obs.castingAbility) obs.castingAbility = S.obs.castingAbility;

    /* Bounds from the dice. Derived here rather than stored, so editing a box
       re-derives rather than leaving a stale range behind — and so a contradiction
       stays visible as one instead of being quietly resolved at save time. */
    const ac = window.fromFields(S.obs.acHit, S.obs.acMiss);
    const dc = window.fromFields(S.obs.dcPass, S.obs.dcFail);
    const hp = window.fromFields(S.obs.hpDied, S.obs.hpLived);   // died = upper, lived = lower
    if (ac) obs.acRange = ac;
    if (dc) obs.dcRange = dc;
    if (hp) obs.hpRange = hp;
    return obs;
  }

  /* Echo each bound back in words. A mistyped roll is otherwise invisible: it does not
     error, it just silently moves the ranking. */
  function renderRanges() {
    const show = (id, range, noun) => {
      const el = $(id);
      if (!el) return;
      el.textContent = range ? window.describeRange(range, noun) : "";
      el.classList.toggle("bad", !!(range && range.contradiction));
    };
    show("ac-range-read", window.fromFields(S.obs.acHit, S.obs.acMiss), "Its AC");
    show("dc-range-read", window.fromFields(S.obs.dcPass, S.obs.dcFail), "The DC");
    show("hp-range-read", window.fromFields(S.obs.hpDied, S.obs.hpLived), "Its hit points");
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

  /* WHAT ARGUED FOR AND AGAINST, AS TIGHT AS IT GOES.

     This was "for: ..." and "against: ...", semicolon-separated, with every entry on the
     against side carrying "— the statblock doesn't have this". Which is what against
     MEANS: repeating it once per item spent most of the line restating the heading.

     A + and a - carry the same information in one character, and the colour already
     says it twice over. The `why` is kept only where it says something the sign does
     not — a volatile miss, a contradicted damage type, the nearest action a combat row
     could find. */
  function evidenceList(items, cls) {
    if (!items.length) return "";
    const sign = cls === "for" ? "+" : "\u2212";
    return `<div class="${cls}"><span class="ev-sign">${sign}</span> ` + items.map(x => {
      const conf = x.confidence != null && x.confidence < 1 ? ` <span class="hint">(uncertain)</span>` : "";
      const why = x.why && !DEFAULT_WHY.test(x.why) ? ` <span class="hint">(${esc(x.why)})</span>` : "";
      return `${esc(prettyValue(x))}${conf}${why}`;
    }).join(", ") + "</div>";
  }

  /* The reason that is merely the definition of "against". Anything else is worth the
     room it takes. */
  const DEFAULT_WHY = /^the statblock doesn't have this$/i;

  /* Feature keys read like "symptom:it-healed-between-rounds" to the scorer. Nobody
     should have to read that, so F14's explanation is translated back into the same
     sentence the player picked in the first place. */
  function prettyValue(x) {
    if (x.facet === "symptom") {
      const s = S.ontology.byId[x.value];
      return s ? s.player : x.value;
    }
    /* A mechanic's value is a composite key — "it-put-out-the-lights::magical darkness" —
       because two symptoms may reasonably name the same mechanic and they are different
       observations. That is the right key and the wrong thing to read: it was being
       printed raw. Split back into the sentence and the mechanic under it. */
    if (x.facet === "mechanic") {
      const i = String(x.value).indexOf("::");
      if (i < 0) return cap(x.value);
      const s = S.ontology.byId[x.value.slice(0, i)];
      const mech = cap(x.value.slice(i + 2));
      return s ? `${s.player} (${mech})` : mech;
    }
    if (x.facet === "spell") return spellTitle(x.value);
    if (x.facet === "damage") {
      // "fire: immune" -> "Fire: immune". The type is a proper noun here, the state is not.
      const i = String(x.value).indexOf(":");
      return i < 0 ? cap(x.value) : cap(x.value.slice(0, i)) + x.value.slice(i);
    }
    if (x.facet === "ac" || x.facet === "hp" || x.facet === "dc") return x.value;
    if (x.facet === "attack" || x.facet === "save") return x.value;
    if (x.facet === "movement") return x.value === "fly" ? "it flew" : "it " + x.value + "ed";
    if (x.facet === "sense") return cap(x.value);
    if (x.facet === "condImmune") return "immune to " + x.value;
    // Damage types, creature types, sizes, attack kinds — all read as labels, not prose.
    if (x.facet === "damageDealt" || x.facet === "immune" || x.facet === "resist"
        || x.facet === "vuln" || x.facet === "type" || x.facet === "size"
        || x.facet === "attackKind" || x.facet === "inflicts") return cap(x.value);
    if (x.facet === "saveAbility" || x.facet === "castingAbility") return x.value.toUpperCase();
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
      /* Weight the query's words by rarity before averaging them. A flat mean lets
         "covered" pull as hard as "eyestalks", and since most words in a sentence are
         unremarkable the mean drifts toward the vocabulary's centroid — the same place
         for every query, which is how the semantic half ends up ranking at chance.
         Worth a point of top-20 on the benchmark. See semanticWeight(). */
      const semantic = window.embeddingScore(window.withoutSize(obs.appearance),
        S.embeddings, window.semanticWeight(S.appearanceIndex));
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
      // F3's fourth tier: which symptoms a DM adds and removes freely, from the ontology.
      volatileSymptoms: S.ontology && S.ontology.volatileIds,
      hideNamed: S.hideNamed,
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
    /* The no-match floor. The list is still shown either way — "rank, never filter"
       applies here too, and a party with a homebrewed monster still wants to see what
       came closest. What changes is whether the tool presents it as an answer. */
    const conf = window.confidence(shown);
    if (conf === "none") {
      notes.push("Nothing in your books explains this. These are the least bad matches, not answers.");
    } else if (conf === "low") {
      notes.push("No monster in your books explains this well — the best match here is weaker " +
        "than a real answer usually is. Your DM may have built this one themselves, or a " +
        "detail may be misremembered. Treat the list as leads, not an identification.");
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
          ${scoreBar(rel, r)}
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
    /* A tab is labelled by whatever is winning, but a leader below the no-match floor is
       not something to put a name to on a tab the user reads at a glance — it would be
       the most confident-looking part of the screen making the least supported claim. */
    if (cur) cur.best = conf === "ok" ? shown[0].name : "";
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
      // Same four words as the damage grid. Two vocabularies for one thing made the
      // reader translate between them.
      damage: DMG_STATES,
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

  /* ============================================================
     The detail panel — two tabs, because they answer different questions.

     "Is this it?" is a statblock question: the numbers, the actions, the traits. "What
     IS this?" is a lore question, and the answer is in the book's Info text, which the
     tool has loaded all along for the search index and never showed anyone.
     ============================================================ */
  const DETAIL_TABS = [["stat", "Stat block"], ["info", "Info"]];

  const ABILS = [["str", "STR"], ["dex", "DEX"], ["con", "CON"],
                 ["int", "INT"], ["wis", "WIS"], ["cha", "CHA"]];
  const mod = n => (typeof n === "number" ? (n >= 10 ? "+" : "") + Math.floor((n - 10) / 2) : "");

  function statBlockHtml(m) {
    const line = (k, v) => v ? `<div class="sb-line"><b>${esc(k)}</b> ${esc(v)}</div>` : "";
    const group = (label, list) => (list && list.length)
      ? `<div class="sb-group">${esc(label)}</div>` + list.map(t =>
          `<div class="sb-trait"><b>${esc(t.name)}.</b> ${esc(t.text)}</div>`).join("")
      : "";
    const abilities = ABILS.some(([k]) => typeof m[k] === "number")
      ? `<div class="sb-abils">` + ABILS.map(([k, label]) =>
          `<span><b>${label}</b> ${m[k] == null ? "\u2014" : esc(m[k])} <i>${esc(mod(m[k]))}</i></span>`).join("") +
        `</div>`
      : "";
    const casting = (m.spellcasting || []).map(sc =>
      `<div class="sb-trait"><b>${esc(sc.name)}.</b> ${esc(sc.text)}` +
      ((m.spells || []).length ? `<div class="hint">${esc(m.spells.map(spellTitle).join(", "))}</div>` : "") +
      `</div>`).join("");

    return `<div class="sb-line hint">${esc(m.size.join("/"))} ${esc(m.type)}` +
      `${m.typeTags.length ? " (" + esc(m.typeTags.join(", ")) + ")" : ""}, ${esc(m.alignment)} ` +
      `&mdash; ${esc(m.source)}${m.page ? " p." + m.page : ""}</div>` +
      line("AC", m.acText || m.ac) +
      line("HP", m.hpSpecial || (m.hpAvg ? m.hpAvg + (m.hpFormula ? " (" + m.hpFormula + ")" : "") : "")) +
      line("Speed", m.speedText) +
      abilities +
      line("Saving throws", m.save && Object.keys(m.save).length
        ? Object.keys(m.save).map(k => k.toUpperCase() + " " + m.save[k]).join(", ") : "") +
      line("Skills", m.skill && Object.keys(m.skill).length
        ? Object.keys(m.skill).map(k => cap(k) + " " + m.skill[k]).join(", ") : "") +
      line("Senses", m.senses.concat(m.passive ? ["passive Perception " + m.passive] : []).join(", ")) +
      line("Resistances", m.resistText) + line("Immunities", m.immuneText) +
      line("Vulnerabilities", m.vulnerableText) +
      line("Condition immunities", m.conditionImmune.join(", ")) +
      line("Languages", m.languages.join(", ")) + line("CR", m.cr) +
      group("Traits", m.traits) + (casting ? `<div class="sb-group">Spellcasting</div>` + casting : "") +
      group("Actions", m.actions) + group("Bonus actions", m.bonusActions) +
      group("Reactions", m.reactions) + group("Legendary actions", m.legendary);
  }

  /* The book's own Info text, whole. The search index takes four paragraphs of this;
     a reader who has opened the panel wants all of it. */
  function infoHtml(m) {
    const f = S.fluff && S.fluff[String(m.name).toLowerCase() + "|" + String(m.source || "").toLowerCase()];
    if (!f || !f.entries) {
      return `<span class="hint">No description text for this one. About half the corpus has ` +
             `none &mdash; it is the part of the books that is prose rather than rules, and ` +
             `plenty of statblocks never got any.</span>`;
    }
    const out = [];
    const walk = node => {
      if (typeof node === "string") {
        const t = String(node).trim();
        if (t) out.push(`<p>${esc(window.stripTags ? window.stripTags(t) : t)}</p>`);
        return;
      }
      if (Array.isArray(node)) { node.forEach(walk); return; }
      if (!node || typeof node !== "object") return;
      if (node.name) out.push(`<div class="sb-group">${esc(node.name)}</div>`);
      walk(node.entries || node.items || []);
    };
    walk(f.entries);
    return out.join("") || `<span class="hint">No description text for this one.</span>`;
  }

  function renderDetail() {
    const box = $("detail-module");
    if (!S.selected) { box.hidden = true; return; }
    const m = S.monsters.find(x => x.key === S.selected);
    if (!m) { box.hidden = true; return; }
    box.hidden = false;
    $("detail-title").textContent = m.name;

    const tabs = DETAIL_TABS.map(([id, label]) =>
      `<button class="dtab${S.detailTab === id ? " on" : ""}" data-dtab="${id}">${esc(label)}</button>`).join("");
    $("detail").innerHTML = `<div class="dtabs">${tabs}</div>` +
      `<div class="dbody">${S.detailTab === "info" ? infoHtml(m) : statBlockHtml(m)}</div>`;
  }

  /* Paint the swatch on each module heading from the same table the bar bands use, so
     the two can never disagree about what colour a category is. Once, at load. */
  function paintCategorySwatches() {
    document.querySelectorAll("[data-cat]").forEach(el => {
      const c = CATEGORY_BY_ID.get(el.dataset.cat);
      if (!c) return;
      el.style.background = c.colour;
      el.title = `${c.label} — this colour in the score bars`;
    });
  }

  function renderAll() {
    paintCategorySwatches();
    applyProseSize(); renderNameRead(); renderFightPicker(); renderBand();
    renderPickers(); renderDamage(); renderCombatRows(); renderSpells();
    renderSymptoms(); renderSources();
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

    if (t.id === "atk-add" || t.id === "sav-add") {
      e.preventDefault();
      S.obs[t.id === "atk-add" ? "attacks" : "saves"].push({});
      persist(); renderCombatRows();
      // Nothing to re-rank: an empty row is not an observation.
      return;
    }
    const spellRm = t.closest("[data-spell-remove]");
    if (spellRm) {
      e.preventDefault();
      toggleIn(S.obs.spells, spellRm.dataset.spellRemove);
      persist(); renderSpells(); renderResults(); renderSuggestions();
      return;
    }

    const rowdel = t.closest("[data-rowdel]");
    if (rowdel) {
      e.preventDefault();
      const list = S.obs[rowdel.dataset.rowdel];
      const gone = list.splice(Number(rowdel.dataset.idx), 1)[0];
      persist(); renderCombatRows();
      // Only worth re-ranking if the row said anything.
      if (rowHasContent(gone)) { renderResults(); renderSuggestions(); }
      return;
    }

    /* One mechanic under a symptom. Checked before the parent, since a sub-button sits
       inside the same row and `closest` would otherwise walk past it. */
    const mech = t.closest("[data-mech]");
    if (mech) {
      const sym = S.ontology.byId[mech.dataset.mechSym];
      if (sym) {
        toggleMechanic(sym, mech.dataset.mech);
        persist(); renderSymptoms(); renderResults(); renderSuggestions();
      }
      return;
    }
    const symBtn = t.closest("[data-sym-toggle]");
    if (symBtn) {
      const sym = S.ontology.byId[symBtn.dataset.symToggle];
      if (sym) {
        toggleSymptom(sym);
        /* The search box is NOT cleared and the row is NOT removed from the list.
           Both used to happen, and both are wrong now: the mechanics under a symptom
           live on that row, so a row that vanishes the moment you select it can never
           be narrowed. The chip strip above is the summary; the list is the control. */
        persist(); renderSymptoms(); renderResults(); renderSuggestions();
      }
      return;
    }
    const dtab = t.closest("[data-dtab]");
    if (dtab) {
      e.preventDefault();
      S.detailTab = dtab.dataset.dtab;
      renderDetail();
      return;
    }

    const kinBtn = t.closest("[data-kin]");
    if (kinBtn) {
      e.preventDefault();
      S.obs.heardName = kinBtn.dataset.kin;
      $("in-name").value = S.obs.heardName;
      renderNameRead();
      persist(); renderResults(); renderSuggestions();
      return;
    }

    const rm = t.closest("[data-sym-remove]");
    if (rm) {
      const sym = S.ontology.byId[rm.dataset.symRemove];
      if (sym) clearSym(sym); else toggleIn(S.obs.symptoms, rm.dataset.symRemove);
      persist(); renderSymptoms(); renderResults(); renderSuggestions();
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
      const codes = (S.srcVisible && S.srcVisible.get(g)) || [];
      codes.forEach(code => {
        if (mode === "ignore") delete S.sources[code];
        else S.sources[code] = mode;
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
    // The selects in a combat row. Text inputs are handled on `input` instead.
    if (e.target.dataset && e.target.dataset.row) { editRow(e.target); return; }
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

    if (e.target.id === "in-hide-named") {
      S.hideNamed = e.target.checked;
      persist(); renderResults(); renderSuggestions();
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
  /* KIN READS A DIFFERENT DOCUMENT FROM SEARCH, and has to.

     The search index folds in the statblock's own prose, which is what makes
     "heartstone" find the Night Hag. That same prose wrecks kinship: a Ghost's most
     distinctive words become Etherealness and Horrifying Visage, and the nearest
     neighbours become whichever obscure NPCs copied those traits — "ghost" came back
     Agony, Amun Sa, Celeste. What makes Specter and Wraith read like a Ghost is the
     LORE, and only the lore.

     So kin gets its own index, built without entry text. Lazily, because it costs about
     270ms and most sessions never type a name: nobody should pay for this at load. */
  function loreIndex() {
    if (!S.loreIndex && S.monsters.length && window.buildAppearanceIndex) {
      S.loreIndex = window.buildAppearanceIndex(S.monsters, S.fluff || {}, { entryFactor: 0 });
    }
    return S.loreIndex;
  }

  function renderNameRead() {
    const el = $("name-read");
    const q = (S.obs.heardName || "").trim();
    if (!q || !S.nameIndex) { el.textContent = ""; return; }
    const hit = window.looksLikeName(q, S.nameIndex, 0.5);
    if (!hit) {
      el.textContent = "No creature in your books goes by that. Left as a hint rather than an answer.";
      return;
    }
    const read = hit.exact
      ? `Matched \u201c${hit.name}\u201d exactly.`
      : `Closest name is \u201c${hit.name}\u201d. Ranked accordingly, not filtered to it.`;

    /* THE FAMILY, OFFERED RATHER THAN SCORED.

       A name is a word, and the word a GM used may not be the word on the statblock:
       "it's a ghost" gets said about Specters and Phantom Warriors constantly. String
       distance cannot get from "ghost" to "specter" — they share no letters — so
       names.js finds them through the corpus's own prose instead.

       SHOWN, NOT SCORED, and the difference is a measurement. Feeding these into the
       ranking was built and swept: 1.6 points of top-5 in the scenario most favourable
       to it, nothing at all in a realistic one, and top-1 slightly worse. Quietly
       moving scores on that is not defensible. Putting the names in front of someone
       who knows what they saw is a different proposition, and costs nothing if they
       ignore it. */
    const kin = window.kinScores
      ? window.kinScores(q, S.nameIndex, S.monsters, loreIndex(),
                         window.appearanceScore, 6)
      : new Map();
    const byKey = new Map(S.monsters.map(m => [m.key, m]));
    const names = [...kin.keys()].map(k => (byKey.get(k) || {}).name).filter(Boolean);

    el.innerHTML = esc(read) + (names.length
      ? `<div class="kin">Reads the same way: ` + names.map(n =>
          `<button class="kin-btn" data-kin="${esc(n)}">${esc(n)}</button>`).join("") + `</div>`
      : "");
  }

  /* One handler for every field of every combat row, addressed by data attributes
     rather than by id — rows come and go, and an id per field per row would have to be
     kept unique by hand. Text inputs answer to `input` so the ranking follows typing;
     the selects are caught by the `change` handler below. */
  function editRow(t) {
    const list = S.obs[t.dataset.row];
    const row = list && list[Number(t.dataset.idx)];
    if (!row) return false;
    const v = t.value.trim();
    if (v === "") delete row[t.dataset.field]; else row[t.dataset.field] = v;
    persist();
    renderResults(); renderSuggestions();
    /* The total, but never the rows — see renderAttackTotal. The row the user is
       typing in must survive its own keystroke. */
    renderAttackTotal();
    return true;
  }

  /* Commit a spell name. ACCEPTED WHETHER OR NOT ANYTHING CASTS IT: a spell nobody in
     your books has still scores — as a miss against everything, which is honest — and
     refusing it would mean arguing with a player about what they watched happen. The
     suggestion list is a convenience and never a constraint, which matters because the
     re-prepared caster is the case this module was built for.

     Stored lowercase so one canonical key backs every spelling; only the display is
     capitalised. */
  function addSpell(text) {
    const raw = String(text || "").trim().toLowerCase();
    if (!raw) return false;
    const canon = (S.spellVocab || []).find(sp => sp === raw) || raw;
    if (S.obs.spells.includes(canon)) return false;
    S.obs.spells.push(canon);
    persist(); renderSpells(); renderResults(); renderSuggestions();
    return true;
  }

  document.addEventListener("keydown", e => {
    if (e.target.id === "in-spell" && e.key === "Enter") {
      e.preventDefault();
      if (addSpell(e.target.value)) e.target.value = "";
    }
  });

  document.addEventListener("input", e => {
    if (e.target.id === "sym-search") { renderSymptoms(); return; }
    // Hides rows only — no state changes, so nothing to persist or re-rank.
    if (e.target.id === "src-search") { renderSources(); return; }
    /* Picking from the datalist fires `input`, not `change`, and there is no event that
       distinguishes a click on a suggestion from typing the same letters. Committing on
       an exact vocabulary match handles both: the moment what is typed IS a spell, it
       becomes a chip. Enter covers everything else. */
    if (e.target.id === "in-spell") {
      const v = e.target.value.trim().toLowerCase();
      if (v && (S.spellVocab || []).includes(v) && addSpell(v)) e.target.value = "";
      return;
    }
    if (e.target.dataset && e.target.dataset.row) { editRow(e.target); return; }
    if (ROLL_FIELDS[e.target.id]) {
      S.obs[ROLL_FIELDS[e.target.id]] = e.target.value;
      persist(); renderRanges(); renderResults(); renderSuggestions();
      return;
    }
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
    const first = $("sym-results").querySelector("[data-sym-toggle]");
    if (first) first.click();
  });

  load().catch(err => fatal("Failed to load: " + esc(err.message)));
})();
