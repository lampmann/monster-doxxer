/* ============================================================
   5e.tools bestiary normalisation.

   Ported from pmcrwf's src/monster-library.js, which had already solved this
   problem for a different purpose (browsing and adding statblocks to a
   character sheet). Lifted rather than re-derived because the awkward parts
   below encode a lot of quiet knowledge about the shapes 5e.tools' data
   actually takes, and getting any of them wrong corrupts the rarity counts
   that the whole scorer is built on.

   The six things raw bestiary JSON does that a naive reader gets wrong:

   1. _copy. About 30% of monsters are declared as a diff against another
      monster, with a _mod block of edits, and the base may live in a
      different file. Resolve this FIRST, over the whole corpus at once —
      not file-by-file. A copy that never resolves is a second statblock
      with its base's features missing, which skews every rarity weight.
   2. ac is an array of conditional entries (base armour vs mage armour).
   3. cr becomes an object when the monster has a lair or coven variant.
   4. type becomes an object when it carries tags.
   5. hp.special replaces the usual average/formula outright.
   6. speed entries can be objects carrying a condition.

   Runs in Node and in the browser. Node matters: it means the normaliser and
   the scorer can be tested without a browser harness, which is most of the
   iteration cost in a project like this.
   ============================================================ */
(function (root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else Object.assign(root, api);
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  /* ---------- 5e.tools code tables (short, fixed, prose-free) ---------- */
  const SIZES = { T: "Tiny", S: "Small", M: "Medium", L: "Large", H: "Huge", G: "Gargantuan" };
  const ALIGN = {
    L: "lawful", N: "neutral", C: "chaotic", G: "good", E: "evil",
    U: "unaligned", A: "any alignment", NX: "neutral", NY: "neutral",
  };
  const SENSE_TAGS = { B: "Blindsight", D: "Darkvision", SD: "Superior Darkvision", T: "Tremorsense", U: "Truesight" };
  const CR_NUM = { "0": 0, "1/8": 0.125, "1/4": 0.25, "1/2": 0.5 };
  /* damageTags ship as single letters. Expanded here rather than at the point of use: the
     scorer matches a user's observation ("it hit me with fire") against these values, and a
     facet value of "f" can never match the word the user actually types. */
  const DMG_TAG = {
    A: "acid", B: "bludgeoning", C: "cold", F: "fire", O: "force", L: "lightning",
    N: "necrotic", P: "piercing", I: "poison", S: "slashing", Y: "psychic", R: "radiant", T: "thunder",
  };
  const SPEED_KINDS = ["walk", "burrow", "climb", "fly", "swim"];
  const ABIL_KEYS = ["str", "dex", "con", "int", "wis", "cha"];
  const ATK_KIND = {
    mw: "Melee Weapon Attack", rw: "Ranged Weapon Attack",
    ms: "Melee Spell Attack", rs: "Ranged Spell Attack", m: "Melee Attack",
  };

  const capWord = s => (s ? String(s)[0].toUpperCase() + String(s).slice(1) : "");
  const asArray = v => (v == null ? [] : Array.isArray(v) ? v : [v]);

  /* ---------- text ---------- */
  function flattenEntries(entries) {
    const out = [];
    (entries || []).forEach(e => {
      if (typeof e === "string") out.push(e);
      else if (e && Array.isArray(e.entries)) out.push(flattenEntries(e.entries));
      else if (e && Array.isArray(e.items)) out.push(flattenEntries(e.items));
    });
    return out.join("\n");
  }
  function stripTags(s) {   // {@tag ...} markup -> plain text
    return (s || "")
      .replace(/{@(?:h|hit)}/gi, "Hit: ")
      .replace(/{@\w+ ([^}]+)}/g, (m, p) => { const a = p.split("|"); return (a.length > 2 && a[a.length - 1]) ? a[a.length - 1] : a[0]; })
      .replace(/{@\w+}/g, "");
  }

  /* ============================================================
     _copy resolution
     A copy inherits every field of its base, then its own literal fields
     override, then _mod operations apply. The spell-list modes and
     _templates are not applied — those records still resolve to a correct
     base statblock and are flagged `partial`, so the scorer can down-weight
     them rather than treating an incomplete block as authoritative.
     ============================================================ */
  const rawKey = (name, source) => String(name || "").toLowerCase() + "|" + String(source || "").toLowerCase();
  const deepClone = o => JSON.parse(JSON.stringify(o));

  function replaceTxtDeep(node, find, repl) {
    if (typeof node === "string") {
      const re = new RegExp(find.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi");
      return node.replace(re, m => (m[0] === m[0].toUpperCase() ? capWord(repl) : repl));
    }
    if (Array.isArray(node)) return node.map(n => replaceTxtDeep(n, find, repl));
    if (node && typeof node === "object") {
      const out = {};
      // "name" is a string like any other here — 5e.tools' replaceTxt renames actions too.
      Object.keys(node).forEach(k => { out[k] = replaceTxtDeep(node[k], find, repl); });
      return out;
    }
    return node;
  }
  const modItems = m => asArray(m.items);
  const namesOf = m => asArray(m.names).map(n => String(n).toLowerCase());

  function applyMod(target, prop, mod) {
    const mode = mod.mode;
    if (mode === "replaceTxt") {
      const scope = prop === "*" ? Object.keys(target) : [prop];
      scope.forEach(k => {
        if (k === "name" || k === "source" || k === "_copy") return;   // never rewrite the record's identity
        target[k] = replaceTxtDeep(target[k], mod.replace, mod.with);
      });
      return;
    }
    if (mode === "setProp") { target[mod.prop] = mod.value; return; }
    if (mode === "addSkills") {
      target.skill = Object.assign({}, target.skill);
      Object.entries(mod.skills || {}).forEach(([k, v]) => { target.skill[k] = typeof v === "number" ? (v > 0 ? "+" + v : String(v)) : v; });
      return;
    }
    const arr = Array.isArray(target[prop]) ? target[prop].slice() : [];
    if (mode === "appendArr") target[prop] = arr.concat(modItems(mod));
    else if (mode === "prependArr") target[prop] = modItems(mod).concat(arr);
    else if (mode === "insertArr") { arr.splice(Number(mod.index) || 0, 0, ...modItems(mod)); target[prop] = arr; }
    else if (mode === "appendIfNotExistsArr") {
      const have = new Set(arr.map(e => String(e && e.name || e).toLowerCase()));
      target[prop] = arr.concat(modItems(mod).filter(e => !have.has(String(e && e.name || e).toLowerCase())));
    } else if (mode === "removeArr") {
      const kill = new Set(namesOf(mod));
      target[prop] = arr.filter(e => !kill.has(String(e && e.name || e).toLowerCase()));
    } else if (mode === "replaceArr") {
      const find = String(mod.replace && mod.replace.name || mod.replace || "").toLowerCase();
      const i = arr.findIndex(e => String(e && e.name || e).toLowerCase() === find);
      if (i >= 0) { arr.splice(i, 1, ...modItems(mod)); target[prop] = arr; }
      else target[prop] = arr.concat(modItems(mod));   // base changed shape upstream — append rather than drop
    }
    // unsupported (spell-list) modes fall through untouched; resolveCopy flags the record `partial`
  }

  const SPELL_MODES = new Set(["replaceSpells", "addSpells", "removeSpells"]);

  /* Publication metadata, which a _copy must NOT inherit.

     A copy is a different creature printed in a different book; it borrows the base's
     MECHANICS, not its bibliography. Letting these ride along made 879 of the 1,141
     copies claim SRD membership they don't have — The Bagman is a _copy of the Troll,
     so it arrived flagged as a Basic Rules monster, and any prior built on "is this a
     monster everyone owns" was reading 19% of the corpus wrong. Page numbers inherited
     the same way and pointed into the wrong book.

     Only inherited values are dropped: a copy that declares its own srd or page keeps it. */
  const PUBLICATION_FIELDS = ["srd", "srd52", "basicRules", "basicRules2024",
    "page", "otherSources", "additionalSources", "reprintedAs"];

  function resolveCopy(raw, index, depth) {
    if (!raw._copy) return raw;
    if ((depth || 0) > 5) return raw;                        // cyclic/very deep chains: keep the stub
    const base = index[rawKey(raw._copy.name, raw._copy.source)];
    if (!base) return raw;                                   // base lives in a file the user didn't load
    const out = deepClone(resolveCopy(base, index, (depth || 0) + 1));
    let partial = !!raw._copy._templates;
    Object.keys(raw).forEach(k => { if (k !== "_copy") out[k] = deepClone(raw[k]); });
    out.name = raw.name; out.source = raw.source;
    PUBLICATION_FIELDS.forEach(k => { if (!(k in raw)) delete out[k]; });
    Object.entries(raw._copy._mod || {}).forEach(([prop, spec]) => {
      asArray(spec).forEach(mod => {
        if (!mod || !mod.mode) return;
        if (SPELL_MODES.has(mod.mode)) { partial = true; return; }
        applyMod(out, prop, mod);
      });
    });
    delete out._copy;
    out._partialCopy = partial;
    out._copiedFrom = raw._copy.name;
    return out;
  }

  /* ============================================================
     Flatteners
     ============================================================ */
  function acInfo(ac) {
    const list = asArray(ac);
    let num = null; const parts = [];
    list.forEach(a => {
      if (typeof a === "number") { if (num == null) num = a; parts.push(String(a)); return; }
      if (!a || typeof a !== "object") return;
      if (a.special) { parts.push(a.special); return; }
      if (typeof a.ac === "number" && num == null) num = a.ac;
      const from = (a.from || []).map(f => stripTags(String(f))).join(", ");
      parts.push(String(a.ac) + (from ? " (" + from + ")" : "") + (a.condition ? " " + stripTags(a.condition) : ""));
    });
    return { ac: num, acText: parts.join(", ") };
  }
  function hpInfo(hp) {
    if (!hp || typeof hp !== "object") return { avg: null, formula: "", special: "" };
    if (hp.special) return { avg: null, formula: "", special: stripTags(hp.special) };
    return { avg: typeof hp.average === "number" ? hp.average : null, formula: hp.formula || "", special: "" };
  }
  function speedInfo(sp) {
    if (typeof sp === "number") return { speeds: { walk: sp }, text: sp + " ft.", hover: false };
    if (!sp || typeof sp !== "object") return { speeds: {}, text: "", hover: false };
    const speeds = {}, parts = [];
    SPEED_KINDS.forEach(k => {
      const v = sp[k]; if (v == null) return;
      const n = typeof v === "object" ? v.number : v;
      if (typeof n !== "number") return;
      speeds[k] = n;
      parts.push((k === "walk" ? "" : k + " ") + n + " ft." + (typeof v === "object" && v.condition ? " " + stripTags(v.condition) : ""));
    });
    if (sp.canHover) parts.push("(hover)");
    return { speeds, text: parts.join(", "), hover: !!sp.canHover };
  }
  /* type is a string, or an object with tags, or — for a handful of planar things —
     an object whose `type` is itself a {choose:[...]} of several creature types. The
     Empyrean is celestial OR fiend and the book does not say which.

     Both are kept. Under "rank, never filter" a monster that could be either should
     be credited for either: a player who reports fighting a fiend has not ruled the
     Empyrean out. `type` stays a string so every existing reader keeps working; the
     alternates ride alongside in `alt`. */
  function typeInfo(t) {
    if (typeof t === "string") return { type: t, alt: [], tags: [] };
    if (!t || typeof t !== "object") return { type: "", alt: [], tags: [] };
    const tags = (t.tags || []).map(x => (typeof x === "string" ? x : (x && x.tag) || "")).filter(Boolean);
    const inner = t.type;
    if (inner && typeof inner === "object") {
      const choices = asArray(inner.choose).filter(x => typeof x === "string");
      return { type: choices[0] || "", alt: choices.slice(1), tags };
    }
    return { type: typeof inner === "string" ? inner : "", alt: [], tags };
  }
  function alignText(al) {
    const list = asArray(al);
    if (!list.length) return "";
    const words = [];
    list.forEach(a => {
      if (typeof a === "string") words.push(ALIGN[a] || a);
      else if (a && a.special) words.push(stripTags(a.special));
      else if (a && a.alignment) words.push(asArray(a.alignment).map(c => ALIGN[c] || c).join(" ") + (a.chance ? ` (${a.chance}%)` : ""));
    });
    const joined = words.join(" ");
    return joined === "neutral neutral" ? "neutral" : joined;
  }
  /* resist/immune/vulnerable/conditionImmune. Keep the flat list (evidence) AND the full text
     (display + the note itself is evidence): "immune to fire" and "immune to fire from nonmagical
     attacks" are very different facts when a player reports that their fire spell did nothing. */
  function dmgTypes(list, key) {
    const flat = [], parts = [];
    asArray(list).forEach(e => {
      if (typeof e === "string") { flat.push(e); parts.push(e); return; }
      if (!e || typeof e !== "object") return;
      if (e.special) { parts.push(stripTags(e.special)); return; }
      const inner = asArray(e[key]).map(x => (typeof x === "string" ? x : ""));
      inner.filter(Boolean).forEach(x => flat.push(x));
      const txt = inner.filter(Boolean).join(", ");
      parts.push([e.preNote ? stripTags(e.preNote) : "", txt, e.note ? stripTags(e.note) : ""].filter(Boolean).join(" "));
    });
    return { flat: [...new Set(flat)], text: parts.filter(Boolean).join("; ") };
  }
  function crToNum(cr) {
    const s = String(cr);
    if (CR_NUM[s] != null) return CR_NUM[s];
    const n = Number(s);
    return Number.isFinite(n) ? n : null;
  }

  /* ---------- actions ---------- */
  function actionName(name) {
    return stripTags(String(name || "")
      .replace(/\{@recharge (\d+)\}/gi, (m, n) => (n === "6" ? "(Recharge 6)" : `(Recharge ${n}-6)`))
      .replace(/\{@recharge\}/gi, "(Recharge 6)"));
  }
  /* ---------- what one action does, in numbers ----------

     The party does not report "it has a Melee Weapon Attack" — they report "it hit
     Ana for 14 slashing and knocked her prone". Matching that needs the damage TYPE,
     the damage DICE and the CONDITION per entry, not rolled up to the monster: a
     creature with a fire breath weapon and a slashing claw is not a creature whose
     claw deals fire, and monster-level tags cannot tell those apart.

     "{@damage 2d8 + 5} slashing damage" — the type is the word after the tag, so the
     dice and the type are read together and stay paired. */
  const DMG_TYPES = ["acid", "bludgeoning", "cold", "fire", "force", "lightning",
                     "necrotic", "piercing", "poison", "psychic", "radiant",
                     "slashing", "thunder"];
  const DMG_TYPE_RE = new RegExp("(" + DMG_TYPES.join("|") + ")", "i");

  /* "2d8 + 5" -> { n: 2, sides: 8, mod: 5, min: 7, max: 21, avg: 14 }. Returns null for
     anything that is not plain dice — "half the damage taken" and similar exist and
     should contribute nothing rather than a made-up number. */
  function parseDice(expr) {
    const m = /^\s*(\d+)\s*d\s*(\d+)\s*(?:([+-])\s*(\d+))?\s*$/i.exec(String(expr || ""));
    if (!m) {
      const flat = /^\s*(\d+)\s*$/.exec(String(expr || ""));
      return flat ? { n: 0, sides: 0, mod: +flat[1], min: +flat[1], max: +flat[1], avg: +flat[1] } : null;
    }
    const n = +m[1], sides = +m[2];
    const mod = m[4] ? (m[3] === "-" ? -(+m[4]) : +m[4]) : 0;
    if (!n || !sides) return null;
    return { n, sides, mod, min: n + mod, max: n * sides + mod, avg: n * (sides + 1) / 2 + mod };
  }

  /* The conditions a player would name having been on the receiving end of. Deliberately
     not 5e's full list: "incapacitated" is a consequence of paralysis nobody reports
     separately, and "unconscious" at zero hit points is not something the monster did. */
  const CONDITIONS = ["blinded", "charmed", "deafened", "frightened", "grappled",
                      "invisible", "paralyzed", "petrified", "poisoned", "prone",
                      "restrained", "stunned", "unconscious", "exhaustion"];
  const COND_RE = new RegExp("\\b(" + CONDITIONS.join("|") + "|paralysed|petrified)\\b", "gi");

  /* Area effects, because "how many of us did it catch" is the question a party can
     answer and "how many targets" is not. A 20-foot cone caught three of us; a claw
     caught one. */
  const AREA_RE = /(\d+)[- ]foot\s+(cone|line|cube|sphere|radius|square|cylinder)/i;

  function parseAction(a, kind) {
    const raw = flattenEntries(a.entries);
    const plain = stripTags(raw);
    const atkM = /\{@atk ([^}]+)\}/i.exec(raw);
    const kinds = atkM ? atkM[1].split(",").map(s => s.trim()) : [];
    const hitM = /\{@hit ([^}|]+)\}/i.exec(raw);
    const spellAtk = /\{@hitYourSpellAttack/i.test(raw);
    const dmg = [...raw.matchAll(/\{@damage ([^}|]+)\}/gi)].map(m => m[1].trim());
    const dcM = /\{@dc (\d+)\}/i.exec(raw);
    const saveM = /(Strength|Dexterity|Constitution|Intelligence|Wisdom|Charisma) saving throw/i.exec(plain);
    const reachM = /reach (\d+)\s*ft/i.exec(plain);
    const rangeM = /range (\d+)(?:\/(\d+))?\s*ft/i.exec(plain);

    /* Each damage roll paired with the type that follows it. The window is short on
       purpose — "2d6 fire damage, and the target must make a Dex save or take 2d6
       cold" would otherwise credit the first roll with both types. */
    const damages = [];
    const seenTypes = [];
    let dm;
    const DMG_RE = /\{@damage ([^}|]+)(?:\|[^}]*)?\}([^.;]{0,40})/gi;
    while ((dm = DMG_RE.exec(raw)) !== null) {
      const tm = DMG_TYPE_RE.exec(stripTags(dm[2] || ""));
      const type = tm ? tm[1].toLowerCase() : "";
      if (type && seenTypes.indexOf(type) < 0) seenTypes.push(type);
      damages.push({ expr: dm[1].trim(), type, dice: parseDice(dm[1].trim()) });
    }

    const conds = [];
    let cm;
    COND_RE.lastIndex = 0;
    while ((cm = COND_RE.exec(plain)) !== null) {
      const c = cm[1].toLowerCase().replace("paralysed", "paralyzed");
      if (conds.indexOf(c) < 0) conds.push(c);
    }
    const areaM = AREA_RE.exec(plain);

    return {
      name: actionName(a.name), kind,
      text: plain,
      isAttack: !!(atkM && (hitM || spellAtk)),
      atkKinds: kinds.map(k => ATK_KIND[k] || k),
      hit: hitM ? Number(hitM[1]) : null,
      dmg,
      damages,                                   // [{ expr, type, dice }]
      dmgTypes: seenTypes,
      conditions: conds,
      area: areaM ? { size: Number(areaM[1]), shape: areaM[2].toLowerCase() } : null,
      dc: dcM ? Number(dcM[1]) : null,
      saveAbil: saveM ? saveM[1].slice(0, 3) : "",
      reach: reachM ? Number(reachM[1]) : null,
      range: rangeM ? (rangeM[2] ? rangeM[1] + "/" + rangeM[2] : rangeM[1]) : null,
    };
  }
  const parseActionList = (list, kind) =>
    asArray(list).filter(a => a && typeof a === "object").map(a => parseAction(a, kind));

  function sanitizeSkills(sk) {
    if (!sk || typeof sk !== "object") return {};
    const out = {};
    Object.entries(sk).forEach(([k, v]) => { if (k !== "other" && (typeof v === "string" || typeof v === "number")) out[k] = String(v); });
    return out;
  }

  /* ============================================================
     One resolved monster -> the flat record the scorer reads
     ============================================================ */
  function parseMonster(raw) {
    const { ac, acText } = acInfo(raw.ac);
    const hp = hpInfo(raw.hp);
    const sp = speedInfo(raw.speed);
    const ty = typeInfo(raw.type);
    const cr = typeof raw.cr === "object" && raw.cr ? (raw.cr.cr || raw.cr.coven || "") : (raw.cr || "");
    const abil = {}; ABIL_KEYS.forEach(k => { abil[k] = typeof raw[k] === "number" ? raw[k] : 10; });
    const res = dmgTypes(raw.resist, "resist");
    const imm = dmgTypes(raw.immune, "immune");
    const vul = dmgTypes(raw.vulnerable, "vulnerable");
    const actions = parseActionList(raw.action, "action");
    const traits = parseActionList(raw.trait, "trait");
    const bonusActions = parseActionList(raw.bonus, "bonus");
    const reactions = parseActionList(raw.reaction, "reaction");
    const legendary = parseActionList(raw.legendary, "legendary");
    /* Everything the creature can visibly DO, in one list. A player reports "it forced
       a Dex save" about the monster, not about which block the save lived in — and
       cannot tell which block it was anyway. */
    const everyEntry = [].concat(traits, actions, bonusActions, reactions, legendary);
    return {
      name: raw.name, source: raw.source || "", page: raw.page || null,
      key: raw.name + "|" + (raw.source || ""),
      size: asArray(raw.size).map(c => SIZES[c] || c),
      type: ty.type, typeAlt: ty.alt, typeTags: ty.tags,
      alignment: alignText(raw.alignment),
      ac, acText,
      hpAvg: hp.avg, hpFormula: hp.formula, hpSpecial: hp.special,
      speeds: sp.speeds, speedText: sp.text, hover: sp.hover,
      ...abil,
      save: raw.save || {}, skill: sanitizeSkills(raw.skill),
      senses: asArray(raw.senses).filter(s => typeof s === "string"),
      senseTags: (raw.senseTags || []).map(t => SENSE_TAGS[t] || t),
      passive: typeof raw.passive === "number" ? raw.passive : null,
      languages: asArray(raw.languages).filter(s => typeof s === "string"),
      cr: String(cr), crNum: crToNum(cr),
      resistText: res.text, resist: res.flat,
      immuneText: imm.text, immune: imm.flat,
      vulnerableText: vul.text, vulnerable: vul.flat,
      conditionImmune: dmgTypes(raw.conditionImmune, "conditionImmune").flat,
      traits,
      actions,
      bonusActions,
      reactions,
      legendary,
      hasLair: !!(raw.legendaryGroup || (typeof raw.cr === "object" && raw.cr && raw.cr.lair)),
      /* 5e.tools marks unique adventure NPCs — Sandesyl Morgia, Jim Darkmagic, a named
         cultist from one module. 1,220 of 4,528 records, 27% of the corpus. They are
         real statblocks and can genuinely be what you fought, so they are never dropped;
         but a party that knows it is not in that adventure wants them out of the way.
         See F16's filter, which this feeds. */
      isNamed: !!raw.isNamedCreature,
      spellcasting: asArray(raw.spellcasting).map(sc => ({
        name: sc.name || "Spellcasting",
        text: stripTags(flattenEntries(sc.headerEntries)),
      })),
      /* ---- what it cast, and how ----

         TWO KINDS OF FACT, AND THEY AGE DIFFERENTLY. Which spells a caster has
         prepared is the single most-changed thing on any statblock — a GM swapping
         fireball for lightning bolt has not changed the monster, they have changed
         Tuesday. But WHETHER it casts innately or from prepared slots, off which
         ability, from which class list, is structural: it comes from what the creature
         IS, and a GM who changes it has built a different monster.

         So they are separated here and priced differently by the scorer: spell names
         are volatile evidence (full credit, discounted miss), the shape of the
         spellcasting is ordinary evidence. */
      spells: spellNames(raw.spellcasting),
      castingKind: castingKinds(raw.spellcasting),
      castingAbility: uniq(asArray(raw.spellcasting)
        .map(sc => String(sc.ability || "").toLowerCase()).filter(Boolean)),
      castingClass: castingClasses(raw.spellcasting),
      environment: raw.environment || [],
      // 5e.tools' own curated mechanic labels. A free head start on the symptom ontology (F8):
      // "Regeneration", "Pack Tactics", "Undead Fortitude" are already named here, so a symptom can
      // map to a tag set first and only fall back to scanning trait prose for the tail.
      traitTags: raw.traitTags || [], actionTags: raw.actionTags || [],
      damageTags: asArray(raw.damageTags).map(t => DMG_TAG[t] || String(t).toLowerCase()),
      srd: !!raw.srd || !!raw.basicRules,
      partial: !!raw._partialCopy, copiedFrom: raw._copiedFrom || "",
      hasAttacks: actions.some(a => a.isAttack),

      /* ---- what the party can SEE it do, aggregated to the monster ----

         Every one of these is already parsed per entry; the scorer needs them rolled
         up, because a player reports "it forced a Dex save" about the creature, not
         about one of its four actions. Traits, actions, bonus actions, reactions and
         legendary actions all count: a save is a save whichever block it came from,
         and the party cannot tell which block it came from anyway. */
      saveAbilities: uniq(everyEntry.map(a => String(a.saveAbil || "").toLowerCase())
        .filter(Boolean)),
      // "Melee Weapon Attack" -> "melee weapon". The distinctions that survive at a
      // table are melee/ranged and weapon/spell; the rest is phrasing.
      attackKinds: uniq(everyEntry.reduce((acc, a) => acc.concat(
        (a.atkKinds || []).map(k => String(k).toLowerCase()
          .replace(/\s*attack\s*$/, "").trim())), []).filter(k => k.length > 2)),
      // Every save DC it can impose, so a DC range can be matched against any of them.
      saveDcs: uniq(everyEntry.map(a => a.dc).filter(n => typeof n === "number" && n > 0)),
      // How many attack rolls it can make in a turn, when the statblock says so.
      attacksPerTurn: multiattackCount(everyEntry),
      // Every condition it can put on you — the one thing a player never fails to notice.
      inflicts: uniq(everyEntry.reduce((acc, a) => acc.concat(a.conditions || []), [])),
      /* Every entry in one list, in the order a player would meet them. The combat
         scorer matches an observed attack against ONE of these rather than against the
         monster's rolled-up tags, so it needs them whole and not flattened. Built here
         rather than re-concatenated per candidate at rank time, because ranking walks
         4,528 monsters and does it for every keystroke. */
      everyEntry,
    };
  }

  const uniq = list => Array.from(new Set(list));

  /* Every spell it can cast, from wherever the statblock keeps them: at-will, daily,
     per-rest, on a recharge, out of slots, or as a legendary action. All flattened to
     one list, because a player reports "it cast counterspell", not "it cast counterspell
     from its third-level slots". */
  const SPELL_BUCKETS = ["will", "rest", "restLong", "daily", "recharge", "charges", "legendary", "ritual"];
  function spellNames(spellcasting) {
    const out = [];
    const take = v => {
      if (v == null) return;
      if (Array.isArray(v)) { v.forEach(take); return; }
      if (typeof v === "object") { Object.keys(v).forEach(k => take(v[k])); return; }
      /* "{@spell invisibility} (self only)" -> "invisibility". The parenthetical is a
         rider on how it is cast, not part of the name. */
      const m = /\{@spell ([^}|]+)/i.exec(String(v));
      const name = (m ? m[1] : stripTags(String(v))).trim().toLowerCase()
        .replace(/\s*\(.*$/, "").replace(/\*+$/, "").trim();
      if (name) out.push(name);
    };
    asArray(spellcasting).forEach(sc => {
      SPELL_BUCKETS.forEach(k => take(sc[k]));
      if (sc.spells) Object.keys(sc.spells).forEach(lvl => take((sc.spells[lvl] || {}).spells));
    });
    return uniq(out);
  }

  /* Innate or prepared, and whether it was psionic — which is the one a party notices
     without being told, because nothing was said and nothing was waved.

     Two phrasings mean innate and only one of them says so. The older statblocks write
     "can innately cast the following spells"; the newer ones write "casts one of the
     following spells, requiring no material components", which is the same claim in
     different words and was landing in a useless catch-all bucket of 668. */
  function castingKinds(spellcasting) {
    const out = [];
    asArray(spellcasting).forEach(sc => {
      const name = String(sc.name || "");
      const hay = name + " " + stripTags(flattenEntries(sc.headerEntries));
      if (/\bpsionic/i.test(hay)) out.push("psionic");
      if (/innate|requiring no (?:material|spell|verbal|somatic|components)/i.test(hay)) out.push("innate");
      else out.push("prepared");
    });
    return uniq(out);
  }

  /* "the following cleric spells prepared" -> cleric. A party cannot name the class,
     but they can often say what the spells FELT like, and the tool can work backwards. */
  const CASTER_CLASSES = ["artificer", "bard", "cleric", "druid", "paladin",
                          "ranger", "sorcerer", "warlock", "wizard"];
  const CLASS_RE = new RegExp("\\b(" + CASTER_CLASSES.join("|") + ")\\b", "gi");
  function castingClasses(spellcasting) {
    const out = [];
    asArray(spellcasting).forEach(sc => {
      const hay = stripTags(flattenEntries(sc.headerEntries));
      let m; CLASS_RE.lastIndex = 0;
      while ((m = CLASS_RE.exec(hay)) !== null) out.push(m[1].toLowerCase());
    });
    return uniq(out);
  }



  /* How many attack rolls it can make in a turn, read out of Multiattack prose.

     That prose is irregular enough that one pattern cannot cover it, and getting this
     wrong is worse than saying nothing — a monster wrongly credited with 2 attacks
     argues AGAINST itself when the party reports 3. So the order below is a priority
     list, and every rule in it exists because the naive version got a real statblock
     wrong.

     FIRST, THROW AWAY THE SENTENCES THAT DON'T ADD ATTACKS. Multiattack prose is
     usually one sentence of substance followed by qualifications, and the
     qualifications are full of numbers that are not extra attacks:

       "makes three Rend attacks. It can replace one attack with a use of Spellcasting"
       "makes two Iron Fist attacks and two Stomping Foot attacks. After one of the
        attacks, the duergar can move up to half its speed"
       "makes three Soul Burst attacks. Alternatively, ... three Reaping Scythe attacks"

     Summing across those gave the Duergar Despot EIGHT attacks and the Death Giant
     six. A sentence that replaces, substitutes or offers an alternative describes the
     same attacks differently; a count that refers back ("one OF THE attacks") is
     anaphora, not arithmetic. Both are dropped before anything is counted.

     THEN, three shapes in priority order, because they mean different things:

       "makes two attacks: one with its bite and one with its claws"
           The count is stated up front and then broken down. Summing would give 4.
           Take the stated total and stop.

       "makes two Branch attacks, two Radiant Pellet attacks, or one of each"
           Alternatives, not additions. Summing gives 4 for a creature that makes 2.
           Take the largest single option.

       "makes one Bite attack and two Claw attacks"
           Genuinely additive. Sum them: 3.

     LAST, THE VERB FORM. Older statblocks write "attacks twice with her flail and
     once with Matalotok" — no noun "attacks" to anchor on, so the clause pattern sees
     nothing. Counted only as a fallback, so it can never double-count a statblock the
     noun form already understood.

     Anything with no count at all — "a number of attacks equal to half this spell's
     level", "as many bite attacks as it has heads" — yields 0 and simply contributes
     no evidence, which is the right answer for a number that isn't fixed. */
  const WORD_NUM = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6,
                     seven: 7, eight: 8, nine: 9, ten: 10 };
  const COUNT = "one|two|three|four|five|six|seven|eight|nine|ten|\\d+";
  const countWord = w => WORD_NUM[String(w).toLowerCase()] ||
                         (Number.isFinite(+w) ? +w : 0);

  /* A count, then up to six words of attack name, then "attack"/"attacks". Six
     because "two Chilling Grasp or Arcane Bolt attacks" is five and the Alhoon is
     not the longest name in the book. */
  const ATTACK_CLAUSE =
    new RegExp("\\b(" + COUNT + ")\\s+(?:[\\w'’-]+\\s+){0,6}?attacks?\\b", "gi");
  // "one of the attacks", "up to four of these attacks" — refers back, adds nothing.
  const ANAPHORIC =
    new RegExp("\\b(?:" + COUNT + ")\\s+of\\s+(?:these|those|the|its|his|her|their)\\s+attacks?\\b", "gi");
  // Sentences that restate rather than extend.
  const RESTATES = /\b(?:replace[sd]?|replacing|substitut|instead of|in place of|alternatively)\b/i;
  // "twice with her flail", "once with Matalotok".
  const VERB_FORM = /\b(once|twice|thrice|three times|four times|five times)\s+with\b/gi;
  const TIMES = { once: 1, twice: 2, thrice: 3, "three times": 3, "four times": 4, "five times": 5 };

  function multiattackCount(entries) {
    const ma = entries.find(a => /^multiattack$/i.test(String(a.name || "")));
    if (!ma) return 0;

    /* Split on sentence ends, drop the ones that only rephrase, then blank out the
       back-references that survive inside the sentences that are left. */
    const text = String(ma.text || "")
      .split(/(?<=\.)\s+/)
      .filter(s => !RESTATES.test(s))
      .join(" ")
      .replace(ANAPHORIC, " ");

    // 1. A stated total, followed by a breakdown. "can make seven attacks:" counts.
    const stated = text.match(new RegExp("\\bmakes?\\s+(" + COUNT + ")\\s+attacks\\s*[:;]", "i"));
    if (stated) return guard(countWord(stated[1]));

    const counts = [];
    let m;
    ATTACK_CLAUSE.lastIndex = 0;
    while ((m = ATTACK_CLAUSE.exec(text)) !== null) {
      const n = countWord(m[1]);
      if (n > 0) counts.push(n);
    }

    // 4. Fallback only: the verb form, which has no noun to anchor on.
    if (!counts.length) {
      VERB_FORM.lastIndex = 0;
      let v, total = 0;
      while ((v = VERB_FORM.exec(text)) !== null) total += TIMES[v[1].toLowerCase()] || 0;
      if (total > 0 && /\battacks?\b/i.test(text)) return guard(total);
      return 0;
    }

    // 2. Alternatives — the largest single option, not their sum.
    if (/\bor\b/i.test(text)) return guard(Math.max.apply(null, counts));

    // 3. Additive.
    return guard(counts.reduce((a, b) => a + b, 0));
  }

  /* A statblock claiming more than ten attack rolls in a turn has almost certainly
     been misparsed. Say nothing rather than something absurd: 0 costs the monster no
     evidence, a wrong 8 actively argues against it. */
  const guard = n => (n > 10 ? 0 : n);

  /* ============================================================
     Whole-corpus ingest. Index every raw record FIRST, then resolve, because
     a _copy may point at a base in another file (see the header).
     ============================================================ */
  function ingest(rawLists) {
    const index = {};
    rawLists.forEach(list => asArray(list).forEach(m => { if (m && m.name) index[rawKey(m.name, m.source)] = m; }));
    const seen = new Set(); const out = []; const skipped = [];
    Object.values(index).forEach(m => {
      const k = m.name + "|" + (m.source || "");
      if (seen.has(k)) return;
      try { out.push(parseMonster(resolveCopy(m, index, 0))); seen.add(k); }
      catch (e) { skipped.push({ name: m && m.name, error: String(e) }); }
    });
    out.sort((a, b) => a.name.localeCompare(b.name));
    return { monsters: out, skipped };
  }

  return {
    SIZES, SENSE_TAGS, SPEED_KINDS, ABIL_KEYS, DMG_TAG,
    flattenEntries, stripTags,
    replaceTxtDeep, applyMod, resolveCopy,
    acInfo, hpInfo, speedInfo, typeInfo, alignText, dmgTypes, crToNum,
    parseAction, parseMonster, ingest,
  };
});
