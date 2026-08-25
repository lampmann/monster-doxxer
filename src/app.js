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
  const blankObs = () => ({ symptoms: [], type: "", size: "", movement: [], senses: [],
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

    /* The spell vocabulary, out of the corpus rather than out of a hardcoded list —
       unlike the picker vocabularies, which are fixed on purpose. There is no fixed set
       of spells a monster might cast, only the set the loaded books actually use, and
       offering a spell no monster has would be offering a guaranteed dead end. Commonest
       first so the autocomplete's first suggestions are the ones you are likeliest to
       have seen. */
    const spellCount = new Map();
    S.monsters.forEach(m => (m.spells || []).forEach(sp =>
      spellCount.set(sp, (spellCount.get(sp) || 0) + 1)));
    S.spellVocab = [...spellCount.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .map(([sp]) => sp);
    const dl = $("spell-list");
    if (dl) dl.innerHTML = S.spellVocab.map(sp => `<option value="${esc(sp)}">`).join("");

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
    { key: "count",  label: "how many",   ph: "2",       w: "4rem",   type: "number" },
    { key: "kind",   label: "what kind",  opts: () => ATTACK_KINDS },
    { key: "rolls",  label: "it rolled",  ph: "22, 17",  w: "6rem" },
    { key: "reach",  label: "how far",    ph: "10",      w: "4.5rem", type: "number", suffix: "ft." },
    { key: "dmg",    label: "damage",     ph: "14, 9 or 2d8+5", w: "8rem" },
    { key: "dmgType", label: "of what",   opts: () => DAMAGE_TYPES },
    { key: "condition", label: "and left us", opts: () => CONDITIONS },
  ];
  const SAVE_FIELDS = [
    { key: "abil",   label: "save",       opts: () => ABILITIES },
    { key: "dc",     label: "DC",         ph: "18",      w: "4.5rem" },
    { key: "area",   label: "area",       ph: "30",      w: "4.5rem", type: "number", suffix: "ft." },
    { key: "dmg",    label: "damage",     ph: "56 or 16d6", w: "7rem" },
    { key: "dmgType", label: "of what",   opts: () => DAMAGE_TYPES },
    { key: "condition", label: "and left us", opts: () => CONDITIONS },
  ];

  const rowHasContent = r => !!r && Object.keys(r)
    .some(k => r[k] !== "" && r[k] != null);

  function renderRowField(f, row, list, i) {
    const val = row[f.key] == null ? "" : String(row[f.key]);
    const attrs = `data-row="${list}" data-idx="${i}" data-field="${esc(f.key)}"`;
    const inner = f.opts
      ? `<select class="rowsel" ${attrs}><option value=""></option>` +
        f.opts().map(o => `<option value="${esc(o)}"${o === val ? " selected" : ""}>${esc(o)}</option>`).join("") +
        `</select>`
      : `<input type="${f.type || "text"}" class="txt rowin" ${attrs} ` +
        `style="width:${f.w || "5rem"}" placeholder="${esc(f.ph || "")}" value="${esc(val)}" autocomplete="off">`;
    return `<label class="rowfield"><span class="hint">${esc(f.label)}</span>${inner}` +
           (f.suffix ? `<span class="hint">${esc(f.suffix)}</span>` : "") + `</label>`;
  }

  /* The spells the party named, as removable chips. Same shape as the symptom chips
     because it is the same interaction: a growing list of things you saw. */
  function renderSpells() {
    const el = $("spell-chosen");
    if (!el) return;
    el.innerHTML = (S.obs.spells || []).map(sp =>
      `<button class="chip on" data-spell-remove="${esc(sp)}" title="remove">${esc(sp)}</button>`).join("");
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
      return `<tr><td class="dt">${esc(d)}</td>${cells}</tr>`;
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

  function symLabel(s) {
    const mech = window.mechanicsLabel ? window.mechanicsLabel(s) : "";
    return esc(s.player) + (mech ? ` <span class="sym-mech">(${esc(mech)})</span>` : "");
  }

  function renderSymptoms() {
    const chosen = S.obs.symptoms.map(id => {
      const s = S.ontology.byId[id];
      const mech = s && window.mechanicsLabel ? window.mechanicsLabel(s) : "";
      return `<button class="chip on" data-sym-remove="${esc(id)}" ` +
             `title="${esc(mech ? "looks for: " + mech : "remove")}">` +
             `${esc(s ? s.player : id)}</button>`;
    }).join("");
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
      const taken = new Set(S.obs.symptoms);
      const groups = new Map();
      S.ontology.symptoms.forEach(s => {
        if (taken.has(s.id) || collectedElsewhere(s)) return;
        const g = s.group || "other";
        if (!groups.has(g)) groups.set(g, []);
        groups.get(g).push(s);
      });
      if (!groups.size) { box.innerHTML = `<span class="hint">Everything is already picked.</span>`; return; }
      box.innerHTML = [...groups.entries()]
        .sort((a, b) => b[1].length - a[1].length)
        .map(([g, list]) =>
          `<div class="sym-group"><div class="sym-group-label">${esc(GROUP_LABELS[g] || g)}</div>` +
          list.map(s => `<button class="sym-hit" data-sym-add="${esc(s.id)}">${symLabel(s)}</button>`).join("") +
          `</div>`).join("");
      return;
    }

    const hits = window.lookup(S.ontology, q, 12)
      .filter(h => !S.obs.symptoms.includes(h.id) && !collectedElsewhere(S.ontology.byId[h.id]));
    box.innerHTML = hits.length
      ? hits.map(h => `<button class="sym-hit" data-sym-add="${esc(h.id)}">` +
          `${symLabel(S.ontology.byId[h.id] || h)}</button>`).join("")
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

  /* Commit a spell name. Accepted whether or not the corpus has it: a spell nobody in
     your books casts still scores — as a miss against everything, which is honest —
     and refusing the input would mean arguing with a player about what they saw.
     Matched case-insensitively against the vocabulary so the stored value is the
     canonical one and two spellings cannot become two chips. */
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
    const first = $("sym-results").querySelector("[data-sym-add]");
    if (first) first.click();
  });

  load().catch(err => fatal("Failed to load: " + esc(err.message)));
})();
