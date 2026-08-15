/* ============================================================
   F10, F11, F12 — matching what the thing looked like.

   The hardest evidence to use, because it is the evidence the DM is most likely
   to have changed. Reflavouring is exactly the case where the description is
   wrong and the monster is right, so F3 puts appearance in tier 3: a CAPPED
   BONUS that can never subtract. A player who describes a purple owlbear must
   not push the owlbear DOWN the list.

   Three parts:

   F10  A BM25 index over a synthesised "description document" per monster —
        name, size, type, tags, the first paragraph or two of fluff, and the
        names of its traits and actions. BM25 catches the distinctive nouns
        people actually remember: carapace, tentacles, mandibles.

   F11  Size, pulled out of the prose BEFORE it is scored. "About horse-sized"
        becomes Large, which is a tier 1 structural fact and earns full weight
        through the ordinary `size` facet — while the rest of the sentence stays
        a capped bonus. This is the highest-value line in the whole feature:
        players are bad at colours and good at "it was bigger than a horse".

   F12  Colour is downweighted hard and morphology is upweighted. Colour is the
        single most reflavoured attribute in the game — the DM who wants a
        surprise repaints the monster and changes nothing else. Limb count,
        wings, texture and how it moved survive reflavouring, because they are
        what the statblock actually implies.

   ON EMBEDDINGS (the second half of F10, and F9). Not built. They need a model,
   a Python build step and a shipped vector index, and before taking that on it
   is worth knowing what the lexical half is already worth — which the harness
   can now say, because it paraphrases appearance text. See DESIGN.md.
   ============================================================ */
(function (root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else Object.assign(root, api);
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const asArray = v => (v == null ? [] : Array.isArray(v) ? v : [v]);

  /* ============================================================
     Tokenising
     ============================================================ */
  const STOP = new Set(("a an the and or but of in on at to from with without into onto for by " +
    "is are was were be been being it its it's they them their there this that these those " +
    "as if then than when while who whom which what where how so such not no nor can could " +
    "will would shall should may might must have has had do does did done one two other " +
    "creature creatures monster monsters thing things like also often usually sometimes many " +
    "more most some any all both each every few own same very just about over under").split(" "));

  /* Deliberately crude stemming: plurals and a couple of endings. A real stemmer would
     conflate more, and would also conflate things a player means differently ("winged"
     and "wing" are the same, "horned" and "horn" are the same, but "scaled" and "scale"
     matter to nobody). Crude and predictable beats clever and surprising here. */
  function stem(w) {
    if (w.length > 4 && /ies$/.test(w)) return w.slice(0, -3) + "y";
    if (w.length > 3 && /(ses|xes|zes|ches|shes)$/.test(w)) return w.slice(0, -2);
    if (w.length > 3 && /s$/.test(w) && !/ss$/.test(w)) return w.slice(0, -1);
    return w;
  }

  function tokens(text) {
    return String(text || "").toLowerCase()
      .replace(/[^a-z0-9\s-]/g, " ")
      .split(/[\s-]+/)
      .filter(w => w.length > 2 && !STOP.has(w))
      .map(stem);
  }

  /* ============================================================
     F12 — what a word is worth

     BM25's IDF already handles "rare words matter more". What it cannot know is
     that some words are rare AND unreliable. Colour is the obvious case: "green"
     is reasonably distinctive across the corpus and almost worthless as evidence,
     because it is the first thing a DM changes.
     ============================================================ */
  const COLOURS = new Set(("red green blue yellow orange purple violet black white grey gray " +
    "brown pink crimson scarlet azure emerald golden gold silver silvery bronze copper ivory " +
    "ebony pale dark light bright vivid ruddy sallow ashen amber jade indigo turquoise " +
    "colored coloured coloration hue tinted").split(" ").map(stem));

  /* Morphology: the shape of the thing. These survive reflavouring, because they are what
     the statblock's mechanics imply — a creature with a fly speed has wings in almost every
     reskin, and one with a burrow speed has claws rather than hooves. */
  const MORPHOLOGY = new Set(("wing winged limb leg arm claw talon fang tusk horn antler " +
    "tentacle tendril carapace chitin shell scale plate hide fur feather bristle spine quill " +
    "eye head mouth maw jaw beak mandible tail stinger hoof paw pincer segment " +
    "humanoid serpentine insectoid skeletal amorphous bipedal quadruped winglike " +
    "armored armoured spiked barbed bloated gaunt sinuous").split(" ").map(stem));

  /* Texture, material and build. Not morphology exactly — these describe the surface and
     bearing of a thing rather than its parts — but they survive reflavouring for the same
     reason and a player reaches for them constantly ("slimy", "armoured", "skeletal"). */
  const TEXTURE = new Set(("slimy slick smooth rough leathery scaly furry hairy shaggy bristly " +
    "spiny thorny warty knobbly wrinkled cracked charred molten frozen icy wet dripping " +
    "stone stony metal metallic iron steel bone bony wooden crystal glassy waxy oily " +
    "translucent transparent gelatinous ethereal wispy smoky cloudy ragged tattered " +
    "gaunt lithe squat hunched towering massive hulking spindly bloated withered").split(" ").map(stem));

  /* What people compare monsters to. A player says "like a big dog" far more often than
     they say "canine quadruped", so these are what the paraphrase should reach for. */
  const CREATURE_NOUNS = new Set(("wolf dog cat lion tiger bear ape monkey horse bull ox goat " +
    "snake serpent lizard crocodile frog toad fish shark eel squid octopus crab spider " +
    "scorpion insect beetle ant wasp bee moth worm slug bat bird crow eagle owl vulture " +
    "rat mouse boar pig elephant whale dragon skeleton corpse statue tree plant fungus " +
    "man woman person child giant knight").split(" ").map(stem));

  /* Everything a player would actually use to describe a thing they saw. The harness draws
     its paraphrases from this vocabulary; without that constraint it samples lore prose and
     measures something else entirely. */
  const VISUAL = new Set([...MORPHOLOGY, ...COLOURS, ...TEXTURE, ...CREATURE_NOUNS]);
  const isVisual = w => VISUAL.has(stem(String(w || "").toLowerCase()));

  const WEIGHTS = { colour: 0.2, morphology: 1.6, texture: 1.4, plain: 1 };
  function termWeight(t) {
    if (COLOURS.has(t)) return WEIGHTS.colour;
    if (MORPHOLOGY.has(t)) return WEIGHTS.morphology;
    if (TEXTURE.has(t) || CREATURE_NOUNS.has(t)) return WEIGHTS.texture;
    return WEIGHTS.plain;
  }

  /* ============================================================
     F11 — size out of prose

     Explicit words first, then comparisons, then measurements. A player almost
     never says "it was Large"; they say it was the size of a horse, or that it
     filled the corridor.
     ============================================================ */
  const SIZES = ["tiny", "small", "medium", "large", "huge", "gargantuan"];
  const SIZE_WORDS = {
    tiny: "tiny", small: "small", medium: "medium", large: "large",
    huge: "huge", gargantuan: "gargantuan",
  };
  /* What people compare things to. Chosen for how often they actually get said at a
     table, not for taxonomic tidiness. */
  const SIZE_LIKE = {
    tiny: ["rat", "cat", "bird", "insect", "beetle", "sparrow", "mouse", "frog", "imp", "toy"],
    small: ["dog", "goblin", "badger", "child", "halfling", "monkey", "chicken", "hound"],
    medium: ["human", "man", "woman", "person", "elf", "orc", "wolf", "adult"],
    large: ["horse", "bear", "ox", "cow", "bull", "lion", "tiger", "shark", "cart", "car"],
    huge: ["elephant", "truck", "whale", "tree", "giant", "house", "wagon", "barn"],
    gargantuan: ["ship", "building", "castle", "mountain", "tower", "cathedral", "titan", "island"],
  };
  const SIZE_ADJECTIVE = {
    tiny: ["diminutive", "minuscule", "miniature"],
    small: ["stocky", "squat"],
    large: ["hulking", "oversized"],
    huge: ["towering", "massive", "enormous", "immense", "colossal"],
    gargantuan: ["titanic", "mountainous", "leviathan"],
  };
  /* Height in feet, from 5e's own size categories. Ranges rather than points, because
     "about fifteen feet tall" should land on Huge without needing an exact match. */
  const SIZE_BY_FEET = [
    [0, 2.5, "tiny"], [2.5, 4, "small"], [4, 7, "medium"],
    [7, 12, "large"], [12, 20, "huge"], [20, Infinity, "gargantuan"],
  ];
  const NUMBER_WORDS = {
    one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9,
    ten: 10, twelve: 12, fifteen: 15, twenty: 20, thirty: 30, forty: 40, fifty: 50,
  };

  /* Returns { size, via, rest } or null.

     `via` is kept so the UI can say WHY it decided the thing was Large — a tier 1 fact
     inferred on the user's behalf has to be visible and correctable, not silently folded
     into the query.

     `rest` is the description with the size phrase REMOVED, and it is the whole reason
     the handoff says to parse size out "before you score it". Leave "about horse-sized"
     in the text and BM25 dutifully matches Draft Horse and Riding Horse — the word was
     doing a job as a unit of measurement, not describing a horse. */
  function extractSize(text) {
    const raw = String(text || "").toLowerCase();
    if (!raw.trim()) return null;
    const found = (size, via, re) => ({ size, via, rest: raw.replace(re, " ").replace(/\s+/g, " ").trim() });

    for (const s of SIZES) {
      const re = new RegExp("\\b" + SIZE_WORDS[s] + "\\b", "g");
      if (re.test(raw)) return found(s, `“${s}”`, new RegExp("\\b" + SIZE_WORDS[s] + "\\b", "g"));
    }

    // "the size of a horse", "horse-sized", "as big as a bear"
    for (const s of SIZES) {
      for (const thing of SIZE_LIKE[s] || []) {
        const src = "\\b" + thing + "[- ]?(?:sized|size)\\b|\\bsize of (?:a|an|the) " + thing +
          "\\b|\\b(?:big|large|small|tall) as (?:a|an|the) " + thing + "\\b";
        if (new RegExp(src).test(raw)) return found(s, `compared to a ${thing}`, new RegExp(src, "g"));
      }
    }

    const feetSrc = "(\\d+|[a-z]+)\\s*(?:-|\\s)?(?:feet|foot|ft)\\b";
    const feet = new RegExp(feetSrc).exec(raw);
    if (feet) {
      const n = /^\d+$/.test(feet[1]) ? Number(feet[1]) : NUMBER_WORDS[feet[1]];
      if (n) {
        const row = SIZE_BY_FEET.find(([lo, hi]) => n >= lo && n < hi);
        if (row) return found(row[2], `${n} feet`, new RegExp(feetSrc, "g"));
      }
    }

    for (const s of SIZES) {
      for (const adj of SIZE_ADJECTIVE[s] || []) {
        const re = new RegExp("\\b" + adj + "\\b");
        if (re.test(raw)) return found(s, `“${adj}”`, new RegExp("\\b" + adj + "\\b", "g"));
      }
    }
    return null;
  }

  /* The text BM25 should actually see: the description with any size phrase taken out,
     because F11 has already turned that into a full-weight structural observation and
     scoring it twice would both double-count it and drag in literal matches. */
  function withoutSize(text) {
    const read = extractSize(text);
    return read ? read.rest : String(text || "");
  }

  /* ============================================================
     Description documents

     One synthesised paragraph per monster, per F10: name, size, type, tags, the
     opening fluff, and the names of its traits and actions. Trait names matter more
     than they look — "Web", "Pounce", "Death Burst" are things a player SAW, and they
     are present for every monster including the 49% with no fluff prose at all.
     ============================================================ */
  function fluffProse(entries, maxParas) {
    const out = [];
    const walk = node => {
      if (out.length >= (maxParas || 2)) return;
      if (typeof node === "string") {
        // Skip 5e.tools' italic stat-line headers and table captions.
        const t = node.replace(/\{@[^}]+\}/g, m => (m.split("|")[0].replace(/\{@\w+\s*/, "").replace(/\}/, "")));
        if (t.trim().length > 40) out.push(t.trim());
        return;
      }
      if (Array.isArray(node)) { node.forEach(walk); return; }
      if (node && typeof node === "object") {
        if (node.type === "table" || node.type === "inset") return;   // stat tables aren't description
        walk(node.entries || node.items || []);
      }
    };
    walk(entries || []);
    return out.slice(0, maxParas || 2).join(" ");
  }

  function describe(m, prose) {
    return [
      m.name,
      (m.size || []).join(" "),
      m.type,
      (m.typeTags || []).join(" "),
      (m.traits || []).map(t => t.name).join(" "),
      (m.actions || []).map(t => t.name).join(" "),
      prose || "",
    ].filter(Boolean).join(". ");
  }

  /* Resolve fluff `_copy` the same way the bestiary does — about a quarter of fluff
     records are deltas, and skipping them would leave a thousand monsters looking
     undescribed when their text is one indirection away. */
  function fluffMap(lists) {
    const index = Object.create(null);
    asArray(lists).forEach(list => asArray(list).forEach(f => {
      if (f && f.name) index[String(f.name).toLowerCase() + "|" + String(f.source || "").toLowerCase()] = f;
    }));
    const out = Object.create(null);
    Object.keys(index).forEach(k => {
      let f = index[k], depth = 0;
      while (f && f._copy && depth++ < 5) {
        const base = index[String(f._copy.name).toLowerCase() + "|" + String(f._copy.source || "").toLowerCase()];
        if (!base) break;
        f = Object.assign({}, base, { name: f.name, source: f.source, _copy: base._copy });
      }
      out[k] = f;
    });
    return out;
  }

  /* ============================================================
     F10 — BM25
     ============================================================ */
  const K1 = 1.5, B = 0.75;
  /* How much fluff to take. The visual description is usually near the top, but not always
     at the very top — 5e.tools' opening paragraph is often ecology or attitude, with the
     shape of the thing a paragraph or two later. Chosen by measurement, below. */
  const PARAGRAPHS = 4;

  function buildIndex(monsters, fluff, opts) {
    const paras = (opts && opts.paras) || PARAGRAPHS;
    const docs = [];
    const df = Object.create(null);
    let totalLen = 0;

    monsters.forEach(m => {
      const f = fluff && fluff[String(m.name).toLowerCase() + "|" + String(m.source || "").toLowerCase()];
      const text = describe(m, f ? fluffProse(f.entries, paras) : "");
      const ts = tokens(text);
      const tf = Object.create(null);
      ts.forEach(t => { tf[t] = (tf[t] || 0) + 1; });
      Object.keys(tf).forEach(t => { df[t] = (df[t] || 0) + 1; });
      totalLen += ts.length;
      docs.push({ key: m.key, tf, len: ts.length, hasProse: !!(f && f.entries) });
    });

    const N = docs.length || 1;
    return {
      docs, df, N, avgLen: totalLen / N,
      idf(t) { return Math.log(1 + (N - (df[t] || 0) + 0.5) / ((df[t] || 0) + 0.5)); },
      withProse: docs.filter(d => d.hasProse).length,
    };
  }

  /* Score every monster against what the player typed. Returns a Map of key -> [0,1],
     scaled by the best hit so the caller gets a comparable fraction rather than a raw
     BM25 total, which has no natural ceiling. */
  function score(queryText, index) {
    const out = new Map();
    const qs = tokens(withoutSize(queryText));
    if (!qs.length || !index) return out;

    // Query terms weighted per F12, so "big hairy white ape" leans on hairy and ape.
    const qw = Object.create(null);
    qs.forEach(t => { qw[t] = (qw[t] || 0) + termWeight(t); });
    const terms = Object.keys(qw);

    let best = 0;
    index.docs.forEach(d => {
      let s = 0;
      terms.forEach(t => {
        const f = d.tf[t];
        if (!f) return;
        const norm = f * (K1 + 1) / (f + K1 * (1 - B + B * d.len / (index.avgLen || 1)));
        s += index.idf(t) * norm * qw[t];
      });
      if (s > 0) { out.set(d.key, s); if (s > best) best = s; }
    });

    if (best > 0) out.forEach((v, k) => out.set(k, v / best));
    return out;
  }

  /* Exported as `appearanceScore` rather than `score`: in the browser these modules
     assign onto the global object, and a name that generic would collide with the next
     module that wants it. */
  return { tokens, stem, STOP, COLOURS, MORPHOLOGY, TEXTURE, CREATURE_NOUNS, VISUAL, isVisual,
           WEIGHTS, termWeight, PARAGRAPHS,
           SIZES, SIZE_LIKE, extractSize, withoutSize, fluffProse, fluffMap, describe,
           buildAppearanceIndex: buildIndex, appearanceScore: score };
});
