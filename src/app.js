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

  /* ---------- state ---------- */
  const S = {
    monsters: [], rarity: null, numerics: null, legacy: null, ontology: null, srcRows: [],
    obs: { symptoms: [], type: "", size: "", movement: [], senses: [], condImmune: [], damage: {} },
    ac: null, hp: null, retuned: false,
    sources: {},              // { CODE: "ignore" | "include" | "exclude" }
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

    status.textContent = `${S.monsters.length} monsters, ${S.ontology.symptoms.length} symptoms` +
      (books || adventures ? "" : " (add data/books.json for book titles)");

    restore();
    renderAll();
  }

  /* ============================================================
     F15 — session evidence. The fight is still going; the tool should not
     forget what you told it because you reloaded the page.
     ============================================================ */
  function persist() {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify({
        obs: S.obs, ac: S.ac, hp: S.hp, retuned: S.retuned, sources: S.sources,
      }));
    } catch (e) { /* private browsing, quota — not worth interrupting a fight over */ }
  }
  function restore() {
    let d = null;
    try { d = JSON.parse(localStorage.getItem(STORE_KEY)); } catch (e) { return; }
    if (!d) return;
    if (d.obs) Object.assign(S.obs, d.obs);
    S.ac = d.ac == null ? null : d.ac;
    S.hp = d.hp == null ? null : d.hp;
    S.retuned = !!d.retuned;
    S.sources = d.sources || {};
    $("in-ac").value = S.ac == null ? "" : S.ac;
    $("in-hp").value = S.hp == null ? "" : S.hp;
    $("in-retuned").checked = S.retuned;
  }
  function clearSession() {
    S.obs = { symptoms: [], type: "", size: "", movement: [], senses: [], condImmune: [], damage: {} };
    S.ac = S.hp = null; S.retuned = false; S.sources = {}; S.selected = null;
    $("in-ac").value = ""; $("in-hp").value = ""; $("in-retuned").checked = false;
    $("sym-search").value = "";
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
      box.innerHTML = `<span class="hint">Nothing observed yet. Start with what it did &mdash; ` +
        `that box is worth more than all the others together.</span>`;
      return;
    }

    const spec = window.toSpec(S.sources);
    const ranked = window.rank(S.monsters, obs, S.rarity, {
      sources: spec, numerics: S.numerics, retuned: S.retuned, legacy: S.legacy,
      collapseByName: true, limit: WINDOW, keepMonster: true,
    });
    S.ranked = ranked;

    if (!ranked.length) {
      box.innerHTML = `<span class="error">Every book is excluded, so there is nothing left to rank.</span>`;
      return;
    }

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
    const top = ranked[0].score;
    const tied = ranked.filter(r => Math.abs(r.score - top) < 1e-9).length;
    if (tied > 1) {
      // Counted over the wider window, so "12" never means "12, and we stopped looking".
      const n = tied >= WINDOW ? `${WINDOW}+` : String(tied);
      notes.push(`The top ${n} explain your observations equally well — the order between ` +
        `them is a guess. One more observation would separate them.`);
    }
    const noteHtml = notes.length ? `<div class="hint block">${notes.map(esc).join(" ")}</div>` : "";

    box.innerHTML = noteHtml + ranked.slice(0, SHOWN).map((r, i) => {
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

    if (t.closest("#btn-clear")) clearSession();
  });

  document.addEventListener("change", e => {
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

  document.addEventListener("input", e => {
    if (e.target.id === "sym-search") { renderSymptoms(); return; }
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
