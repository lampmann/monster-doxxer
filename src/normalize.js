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

  function resolveCopy(raw, index, depth) {
    if (!raw._copy) return raw;
    if ((depth || 0) > 5) return raw;                        // cyclic/very deep chains: keep the stub
    const base = index[rawKey(raw._copy.name, raw._copy.source)];
    if (!base) return raw;                                   // base lives in a file the user didn't load
    const out = deepClone(resolveCopy(base, index, (depth || 0) + 1));
    let partial = !!raw._copy._templates;
    Object.keys(raw).forEach(k => { if (k !== "_copy") out[k] = deepClone(raw[k]); });
    out.name = raw.name; out.source = raw.source;
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
    return {
      name: actionName(a.name), kind,
      text: plain,
      isAttack: !!(atkM && (hitM || spellAtk)),
      atkKinds: kinds.map(k => ATK_KIND[k] || k),
      hit: hitM ? Number(hitM[1]) : null,
      dmg,
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
      traits: parseActionList(raw.trait, "trait"),
      actions,
      bonusActions: parseActionList(raw.bonus, "bonus"),
      reactions: parseActionList(raw.reaction, "reaction"),
      legendary: parseActionList(raw.legendary, "legendary"),
      hasLair: !!(raw.legendaryGroup || (typeof raw.cr === "object" && raw.cr && raw.cr.lair)),
      spellcasting: asArray(raw.spellcasting).map(sc => ({
        name: sc.name || "Spellcasting",
        text: stripTags(flattenEntries(sc.headerEntries)),
      })),
      environment: raw.environment || [],
      // 5e.tools' own curated mechanic labels. A free head start on the symptom ontology (F8):
      // "Regeneration", "Pack Tactics", "Undead Fortitude" are already named here, so a symptom can
      // map to a tag set first and only fall back to scanning trait prose for the tail.
      traitTags: raw.traitTags || [], actionTags: raw.actionTags || [],
      damageTags: asArray(raw.damageTags).map(t => DMG_TAG[t] || String(t).toLowerCase()),
      srd: !!raw.srd || !!raw.basicRules,
      partial: !!raw._partialCopy, copiedFrom: raw._copiedFrom || "",
      hasAttacks: actions.some(a => a.isAttack),
    };
  }

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
