/* ============================================================
   The named-trait catalogue.

   WHY THIS EXISTS ALONGSIDE THE SYMPTOM ONTOLOGY, NOT INSTEAD OF IT.

   The ontology answers "what did you see"; this answers "what was it called". They
   are not the same question and neither subsumes the other. A party who watched the
   wounds close should say so in their own words and let the ontology fan that out
   across regeneration, a leech attack, a healing trait and a potion. But a party
   whose GM said the words "Pack Tactics" out loud, or who has read the book, knows
   something the sentence cannot express, and making them guess which vague sentence
   the tool filed it under is worse than letting them name it.

   Ablating the symptom facet costs 28 points of top-5 recall, the largest single
   facet in the tool by a factor of three. So this is an ADDITIONAL way in. Nothing
   here removes a sentence from the ontology or a symptom from the index.

   ON THE DESCRIPTIONS. The objection to a trait list is that it makes you know the
   jargon before you can use it, which is the exact failure the ontology was built to
   avoid. The answer is that every entry carries a one-line gloss of what the trait
   DOES, and the search box reads the gloss as well as the name — so "wounds closed"
   finds Regeneration and "advantage when we flank" finds Pack Tactics without the
   name ever being typed. The grouping does the same job for browsing.

   These glosses are paraphrases of the mechanic, written here. No rules text is
   reproduced: this repository ships mechanics and code, never sourcebook content.

   ON WHAT IS INDEXED VERSUS WHAT IS OFFERED. The index carries EVERY canonical trait
   name in the corpus — 1,278 of them — so the rarity table (F1) prices each one
   against its true frequency. The catalogue below is the ~140 worth putting in front
   of a person. Adding an entry to the catalogue therefore needs no reindexing, and a
   trait nobody has curated still scores correctly if it arrives some other way.
   ============================================================ */
(function (root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else Object.assign(root, api);
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  /* Trailing parentheticals are scoping notes, not part of the name: "Regeneration
     (Troll Form Only)", "Magic Resistance (Aberration Form Only)". Dropping them
     collapses forty-odd spellings onto the trait everyone means. */
  const canon = s => String(s == null ? "" : s)
    .replace(/\s*\([^()]*\)\s*$/, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();

  /* Spellings the corpus uses for one mechanic, folded onto one key. Two kinds live
     here and they are worth telling apart:

       - genuine variants of the same rule ("Legendary Resistances" is 5e.tools' tag
         spelling of the trait "Legendary Resistance"; the keen-sense traits are one
         mechanic named six ways, which is why 5e.tools' own tag collapses them too)
       - outright typos in the source data ("Aversion of Fire")

     Both have to fold or the rarity table splits one 470-monster feature into two
     halves and prices each as twice as rare as it is. */
  const ALIASES = {
    "legendary resistances": "legendary resistance",
    "keen smell": "keen senses",
    "keen sight": "keen senses",
    "keen hearing": "keen senses",
    "keen hearing and smell": "keen senses",
    "keen hearing and sight": "keen senses",
    "keen sight and smell": "keen senses",
    "keen sight and hearing": "keen senses",
    "stone camouflage": "camouflage",
    "plant camouflage": "camouflage",
    "snow camouflage": "camouflage",
    "swamp camouflage": "camouflage",
    "sand camouflage": "camouflage",
    "forest camouflage": "camouflage",
    "aversion of fire": "aversion to fire",
    "fear of fire": "aversion to fire",
    "vampire weakness": "vampire weaknesses",
    "fire absorption": "damage absorption",
    "lightning absorption": "damage absorption",
    "cold absorption": "damage absorption",
    "healing absorption": "damage absorption",
  };

  const fold = n => ALIASES[n] || n;

  /* Editorial furniture in the data rather than anything the creature does. These
     appear as trait entries and would otherwise be indexed and offered. */
  const NOT_A_TRAIT = new Set([
    "roleplaying information", "5etools note", "uniqueness", "malison type",
    "variant", "variants", "note", "description",
  ]);

  /* ============================================================
     What one monster's traits are, as canonical keys.

     Three sources, unioned:
       - the names of its trait entries, which is the long tail
       - 5e.tools' curated traitTags, which catch monsters whose trait is spelled
         differently but tagged the same (135 monsters are tagged Magic Resistance
         without a trait entry of that name)
       - its actionTags, for the handful of mechanics that live in the action block
         and are still what a player would call a trait: a breath weapon, a parry,
         a swallow

     Action NAMES are deliberately NOT indexed. Every weapon on every statblock is an
     action entry, and "Bite", "Claw" and "Slam" would drown the vocabulary in three
     features that say nothing.
     ============================================================ */
  function traitsOf(m) {
    const out = new Set();
    const add = v => { const k = fold(canon(v)); if (k && !NOT_A_TRAIT.has(k)) out.add(k); };
    (m.traits || []).forEach(t => add(t && t.name));
    (m.traitTags || []).forEach(add);
    (m.actionTags || []).forEach(add);
    return [...out];
  }

  function tagAll(monsters) {
    (monsters || []).forEach(m => { m.traitNames = traitsOf(m); });
    return monsters;
  }

  /* ============================================================
     The catalogue.

     `n` is the canonical key — it must match what traitsOf produces, or the entry
     offers evidence no monster can have. `d` is the gloss: what a player would have
     watched happen, in one line, so the entry can be found without its name. `k`
     is extra search vocabulary that belongs in neither — the words someone would
     actually type, which are usually not the words in the description.

     Groups are functional, so browsing works: you know what you saw it DO, and the
     group heading is that. The grouping itself is the owner's, revised from a first
     pass of mine that put twenty-eight entries under one heading.

     ON THE ACCURACY OF THE GLOSSES. Eighteen of them were wrong or loose in the first
     version and were corrected against the corpus's own trait text — Disintegration is
     the creature crumbling on its OWN death rather than something it did to us,
     Empowered Attacks is "counts as magical" rather than "hits harder", Insanity is
     advantage on a save rather than immunity, Psychic Defense is unarmoured AC rather
     than anything psychic. A wrong gloss is worse than no entry: it is the only thing
     the person reads before deciding, and it is what the search matches on. Check new
     ones against the real text before adding them.
     ============================================================ */
  const GROUPS = [
    {
      id: "antimagic", label: "Antimagic",
      traits: [
        { n: "magic resistance", d: "advantage on saving throws against spells and magical effects" },
        { n: "spell immunity", d: "certain named spells did nothing to it at all" },
        { n: "limited magic immunity", d: "immune to low-level spells outright, advantage against the rest" },
        { n: "spell turning", d: "a spell aimed at it rebounded on the caster" },
        { n: "immutable form", d: "could not be changed in shape or size — polymorph and petrification failed", k: "polymorph petrify" },
        { n: "antimagic cone", d: "projected a cone from its eye in which magic did not function", k: "beholder eye" },
        { n: "turn resistance", d: "advantage against a cleric's attempt to turn undead", k: "cleric channel divinity" },
        { n: "turn immunity", d: "could not be turned by a cleric at all" },
        { n: "fey ancestry", d: "could not be put to sleep by magic, and resisted being charmed", k: "elf charm sleep" },
        { n: "gnome cunning", d: "advantage on mental saves against magic specifically", k: "int wis cha" },
      ],
    },
    {
      id: "saves", label: "Saving Throws",
      traits: [
        { n: "legendary resistance", d: "simply chose to succeed on a save it had already failed, a few times a day", k: "reroll refused failed save" },
        { n: "avoidance", d: "took no damage at all from an effect it saved against, and half if it failed" },
        { n: "evasion", d: "dodged an area effect entirely on a successful Dexterity save", k: "fireball breath half damage" },
        { n: "indomitable", d: "rerolled a saving throw it had failed" },
        { n: "dwarven resilience", d: "advantage against poison, and resistance to poison damage" },
        { n: "duergar resilience", d: "advantage against poison, illusions, and attempts to charm or paralyse it" },
        { n: "brave", d: "advantage on saves against being frightened" },
        { n: "dark devotion", d: "advantage on saves against being charmed or frightened, out of fanaticism" },
        { n: "insanity", d: "advantage on saves against being charmed or frightened, being too far gone to care" },
      ],
    },
    {
      id: "mind", label: "Mind and Psychic Defense",
      traits: [
        { n: "mental fortitude", d: "immune to being charmed or frightened, and to having its mind read" },
        { n: "shielded mind", d: "nothing magical could read its thoughts, sense its emotions, or find it at range" },
        { n: "telepathic shroud", d: "immune to mind-reading, and could not be scried on or tracked by divination" },
        { n: "alien mind", d: "reading its thoughts, or hurting it with psychic damage, stunned whoever tried", k: "psychic backlash" },
        { n: "axiomatic mind", d: "could not be made to act against its own nature or its orders" },
        { n: "inscrutable", d: "its intentions could not be read and it was immune to attempts to sense its emotions" },
        { n: "divine awareness", d: "knew when it was being lied to" },
      ],
    },
    {
      id: "healing", label: "Healing and Regeneration",
      traits: [
        { n: "regeneration", d: "closed its own wounds every round unless we hurt it the right way first", k: "healed between rounds troll fire acid" },
        { n: "fiendish regeneration", d: "healed itself every round, and could be stopped only by a specific kind of damage" },
        { n: "undead fortitude", d: "dropped to nothing and got straight back up, unless the blow was radiant or a critical", k: "zombie stood up again" },
        { n: "rejuvenation", d: "we destroyed it and it re-formed later somewhere else", k: "came back ghost lich" },
        { n: "demonic restoration", d: "killing it here only sent it home — it re-forms in the Abyss" },
        { n: "diabolical restoration", d: "killing it here only sent it home — it re-forms in the Nine Hells" },
        { n: "fiendish restoration", d: "killing it here only sent it back to its home plane, where it re-forms" },
        { n: "undead restoration", d: "destroyed away from its home it simply re-forms there" },
        { n: "elemental restoration", d: "killing it here only sent it back to its own plane, where it re-forms" },
        { n: "darklord restoration", d: "we killed it, and days or weeks later it was back, whole, in its own domain" },
        { n: "second wind", d: "healed itself once, as a quick action, mid-fight" },
        { n: "relentless", d: "a blow that should have dropped it left it standing on one hit point" },
        { n: "damage absorption", d: "a damage type we used healed it instead of hurting it", k: "healed when we hit it absorbed fire lightning cold got stronger" },
      ],
    },
    {
      id: "defence", label: "Misc Defense",
      traits: [
        { n: "psychic defense", d: "wore no armour and was hard to hit anyway, on presence of mind alone" },
        { n: "damage transfer", d: "the damage we did to it was passed on to something it was attached to", k: "shared hurt its host" },
        { n: "parry", d: "raised its weapon as we swung and turned the blow aside", k: "reaction blocked deflect" },
        { n: "displacement", d: "it was never quite where it appeared to be, so the first swing always missed", k: "displacer illusion offset" },
        { n: "blurred form", d: "its outline swam, and attacks against it were made at a disadvantage" },
        { n: "slippery", d: "advantage on escaping a grapple or anything holding it" },
        { n: "superior invisibility", d: "stayed invisible even while attacking us", k: "we never saw it unseen" },
        { n: "invisible in water", d: "we could not see it while it was submerged" },
        { n: "transparent", d: "near-invisible when still, and easy to walk into", k: "gelatinous cube glass clear" },
        { n: "unarmored defense", d: "wore no armour and was hard to hit anyway" },
        { n: "flyby", d: "flew out of our reach after striking, and we got no swing at it", k: "no opportunity attack darted away" },
      ],
    },
    {
      id: "weakness", label: "Weaknesses",
      traits: [
        { n: "antimagic susceptibility", d: "went inert inside an antimagic field, and could be shut down by dispel magic", k: "dispel animated object" },
        { n: "sunlight sensitivity", d: "fought badly in direct sunlight — disadvantage to attack and to see", k: "daylight torch drow" },
        { n: "sunlight hypersensitivity", d: "took damage every round it stood in sunlight" },
        { n: "sunlight weakness", d: "everything it did in sunlight was at a disadvantage" },
        { n: "sun sickness", d: "sunlight sickened it and it could not act properly in daylight" },
        { n: "light sensitivity", d: "bright light of any kind, not just the sun, put it off its aim" },
        { n: "vampire weaknesses", d: "running water, garlic, an invitation it had not been given, a stake", k: "vampire holy symbol" },
        { n: "aversion to fire", d: "flinched from fire and could be driven back with a torch" },
        { n: "water susceptibility", d: "water itself burned it", k: "doused splashed" },
        { n: "water dependency", d: "started to suffocate out of water" },
      ],
    },
    {
      id: "proximity", label: "Proximity Hazards",
      traits: [
        { n: "heated body", d: "touching it, or hitting it in melee, burned us", k: "hot metal glowing" },
        { n: "corrosive form", d: "our weapons corroded on contact, and the floor under it dissolved", k: "acid ate my sword" },
        { n: "stench", d: "the smell of it made us sick if we stood close", k: "reeked nauseated poisoned smell" },
        { n: "fear aura", d: "standing near it frightened us, with nothing rolled to attack", k: "dread terror radius" },
        { n: "fire aura", d: "the air around it burned anything that came close" },
        { n: "cold aura", d: "the air around it froze anything that came close" },
        { n: "whispering aura", d: "voices near it wore at our minds" },
        { n: "poisonous skin", d: "touching it, or hitting it bare-handed, poisoned us" },
        { n: "distress spores", d: "burst into spores when hurt, and everything nearby suffered for it" },
        { n: "frightful presence", d: "its mere presence panicked us, with no attack made", k: "roar terror dragon fear" },
        { n: "death burst", d: "exploded when it died", k: "blew up on death" },
        { n: "death throes", d: "its death did serious damage to everything around it" },
      ],
    },
    {
      id: "movement", label: "Movement",
      traits: [
        { n: "freedom of movement", d: "nothing could slow it, hold it or shrink the ground it covered" },
        { n: "incorporeal movement", d: "walked through a wall, taking a little damage for ending inside one", k: "ghost passed through phased" },
        { n: "air form", d: "made of air, so it could pass through the narrowest crack" },
        { n: "fire form", d: "made of fire, so touching it burned and it slipped through any gap" },
        { n: "water form", d: "made of water, so it flowed through any opening" },
        { n: "spider climb", d: "walked up a sheer wall, and across the ceiling, without rolling for it" },
        { n: "web walker", d: "moved through webbing as if it were open floor" },
        { n: "glide", d: "could not truly fly, but fell slowly and far" },
        { n: "limited flight", d: "flew only in short bursts, and had to come down" },
        { n: "standing leap", d: "jumped an unreasonable distance from a standstill" },
        { n: "running leap", d: "cleared a great distance with a short run-up" },
        { n: "feline agility", d: "doubled its speed in a burst, then had to spend a round without moving" },
        { n: "ice walk", d: "crossed ice and snow without slipping or slowing" },
        { n: "sure-footed", d: "could not be knocked down or shoved off balance" },
        { n: "earth glide", d: "swam through solid rock, leaving no tunnel behind it" },
        { n: "tunneler", d: "dug through solid stone and left a tunnel we could follow" },
        { n: "tree stride", d: "stepped into one tree and out of another far away" },
        { n: "misty escape", d: "turned to mist when badly hurt and fled to somewhere it rests", k: "vampire vanished smoke" },
        { n: "teleport", d: "vanished from one spot and reappeared in another" },
        { n: "nimble escape", d: "hid or backed off every round without giving up its attack", k: "goblin disengage bonus action" },
        { n: "cunning action", d: "dashed, hid or disengaged every round on top of everything else" },
        { n: "amorphous", d: "squeezed through a gap far narrower than its body", k: "ooze crack under the door" },
        { n: "amphibious", d: "breathed both air and water" },
        { n: "limited amphibiousness", d: "breathed water but had to surface for air eventually" },
        { n: "water breathing", d: "breathed only water, and would drown in air" },
        { n: "hold breath", d: "stayed under for a very long time on one breath" },
        { n: "animated", d: "an object with no legs, so it hovered and flew rather than walking", k: "furniture object moved on its own hovered" },
      ],
    },
    {
      id: "senses", label: "Senses",
      traits: [
        { n: "devil's sight", d: "saw perfectly through magical darkness, including its own", k: "saw us in the dark pitch black unaffected by darkness" },
        { n: "ethereal sight", d: "saw into the Ethereal Plane, so hiding there did not work" },
        { n: "web sense", d: "knew exactly where anything touching its web was" },
        { n: "creature sense", d: "knew where every thinking creature for miles was, and how clever each one was" },
        { n: "otherworldly perception", d: "sensed anything invisible, or on the Ethereal Plane, close by" },
        { n: "keen senses", d: "found us by smell, hearing or sight when it had no business doing so", k: "sniffed us out heard smelled tracked" },
        { n: "echolocation", d: "sensed us by sound, and was blinded when deafened", k: "bat clicks deafened" },
        { n: "labyrinthine recall", d: "remembered perfectly every route it had ever walked", k: "minotaur maze never lost" },
        { n: "wakeful", d: "one of its heads stayed awake while the rest of it slept" },
      ],
    },
    {
      id: "talk", label: "Communication",
      traits: [
        { n: "limited telepathy", d: "spoke into the minds of its own kind only" },
        { n: "telepathic bond", d: "was in silent contact with a master or a pack at a distance" },
        { n: "telepathic hub", d: "relayed thought between several creatures at once, like a switchboard" },
        { n: "shark telepathy", d: "commanded sharks silently at range" },
        { n: "speak with beasts and plants", d: "held a conversation with animals or plants" },
        { n: "speak with frogs and toads", d: "held a conversation with frogs and toads" },
        { n: "mimicry", d: "imitated a voice or a sound well enough to fool us", k: "cried for help copied speech" },
      ],
    },
    {
      id: "extra", label: "Extra Actions",
      traits: [
        { n: "multiattack", d: "took several attacks in one turn" },
        { n: "combat ready", d: "advantage on initiative — it was always moving before we were", k: "went first acted before us fast initiative" },
      ],
    },
    {
      id: "conditional", label: "Conditional Offense",
      traits: [
        { n: "pack tactics", d: "hit far more often when one of its allies was next to us", k: "flanking wolves gang up" },
        { n: "martial advantage", d: "hit much harder when one of its allies was next to the target", k: "hobgoblin extra damage ally" },
        { n: "sneak attack", d: "did huge extra damage when it caught someone out of position" },
        { n: "assassinate", d: "the very first strike of the fight was devastating, before anyone had acted", k: "surprise round critical" },
        { n: "surprise attack", d: "extra damage on a target that had not acted yet" },
        { n: "charge", d: "extra damage when it closed the distance at a run first", k: "ran at us gore" },
        { n: "trampling charge", d: "knocked a target flat by running it down, then attacked it on the ground" },
        { n: "pounce", d: "knocked us over on the way in and kept attacking" },
        { n: "dive attack", d: "came down out of the air and hit far harder for it" },
        { n: "rampage", d: "dropped one of us and immediately bit something else", k: "killed then attacked again" },
        { n: "ambusher", d: "advantage against anything it had surprised" },
        { n: "blood frenzy", d: "attacked wounded targets far more accurately", k: "smelled blood advantage bloodied" },
        { n: "reckless", d: "attacked wildly, hitting more often but leaving itself open", k: "barbarian advantage both ways" },
        { n: "berserk", d: "lost control at some point and attacked whatever was nearest" },
        { n: "brute", d: "its plain weapon hits did unusually heavy damage for the weapon" },
        { n: "aggressive", d: "closed the distance to us as a free extra move" },
        { n: "marshal undead", d: "the undead around it were steadier, and harder for a cleric to turn" },
      ],
    },
    {
      id: "grapple", label: "Grapple and Restrain",
      traits: [
        { n: "grappler", d: "advantage on attacks against anything it was already holding", k: "grabbed grappled held onto me caught" },
        { n: "adhesive", d: "we stuck to it and could not pull free", k: "glued mimic stuck" },
        { n: "swallow", d: "swallowed one of us whole", k: "ate him gulped inside its stomach" },
        { n: "tentacles", d: "attacked with tentacles" },
        { n: "ooze cube", d: "filled its whole space as a solid block, and engulfed what walked in" },
      ],
    },
    {
      id: "offence", label: "Misc Offense",
      traits: [
        { n: "breath weapon", d: "exhaled something at us in a cone or a line", k: "breathed fire cone line recharge" },
        { n: "petrifying gaze", d: "met our eyes and started turning us to stone", k: "medusa basilisk look away" },
        { n: "firearms knowledge", d: "knew how to use guns, which most creatures do not" },
        { n: "potent cantrip", d: "its cantrips still did half damage to targets that saved" },
        { n: "spell storing", d: "held a spell put into it by someone else and cast it later" },
      ],
    },
    {
      id: "magicatk", label: "Magic-Enhanced Attacks",
      traits: [
        { n: "magic weapons", d: "its own attacks counted as magical, so resistance to ordinary weapons did not help us" },
        { n: "angelic weapons", d: "its weapons flared with radiant light and did extra damage" },
        { n: "divine eminence", d: "poured a spell into a weapon hit for extra radiant damage" },
        { n: "empowered attacks", d: "its own attacks counted as magical, so resistance to ordinary weapons did not help us" },
        { n: "siege monster", d: "did double damage to doors, walls and structures", k: "smashed the wall building" },
      ],
    },
    {
      id: "heads", label: "Multiple Heads",
      traits: [
        { n: "two heads", d: "two heads, so it was very hard to surprise or blind", k: "advantage perception" },
        { n: "multiple heads", d: "many heads, each of which had to be dealt with", k: "hydra" },
        { n: "reactive heads", d: "each extra head bought it another reaction each round" },
      ],
    },
    {
      id: "stealth", label: "Stealth & Appearance",
      traits: [
        { n: "false appearance", d: "sat perfectly still and passed for an ordinary object", k: "looked like a statue chest rock" },
        { n: "camouflage", d: "was almost impossible to spot against the terrain it lived in", k: "blended in stone snow plants" },
        { n: "chameleon skin", d: "changed its own colour to match its surroundings" },
        { n: "shapechanger", d: "changed shape into something else entirely", k: "turned into a wolf mist person" },
        { n: "shadow stealth", d: "vanished into dim light as a quick action", k: "hid in the dark bonus action" },
        { n: "the colors of age", d: "its colour changed as it aged, and the older ones knew more magic" },
      ],
    },
    {
      id: "nature", label: "Creature Nature & Type",
      traits: [
        { n: "disintegration", d: "its own body crumbled to dust when it died, leaving only its gear", k: "no corpse dust nothing left behind" },
        { n: "unusual nature", d: "did not need to breathe, eat, drink or sleep" },
        { n: "elemental demise", d: "its body disintegrated when it died, leaving only its equipment", k: "vanished corpse dissolved" },
        { n: "beast of burden", d: "carried far more than its size suggested" },
        { n: "illumination", d: "it gave off light of its own", k: "glowed shed bright light" },
        { n: "special equipment", d: "carried named gear, often magical, beyond a monster's usual kit" },
        { n: "swarm", d: "was not one creature but a mass of small ones acting together", k: "rats bats insects cloud" },
        { n: "ashen creature", d: "collapsed into a pile of ash when destroyed, dropping whatever it carried" },
        { n: "bound", d: "was magically bound to an amulet, and came when its wearer called" },
        { n: "water bound", d: "died if it left the water it was bound to" },
        { n: "constructed nature", d: "was built, not born — it needed no air, food, drink or sleep" },
      ],
    },
  ];

  /* Title case for display. The catalogue keys are lowercase because that is what the
     facet compares, but "magic resistance" in a button reads like a mistake. Small
     words stay lowercase unless they lead. */
  const SMALL = new Set(["a", "an", "and", "as", "at", "by", "for", "in", "of", "on", "or", "the", "to", "with"]);
  function title(k) {
    return String(k).split(" ").map((w, i) =>
      (i > 0 && SMALL.has(w)) ? w : w.charAt(0).toUpperCase() + w.slice(1)
    ).join(" ");
  }

  /* Flattened, with the group carried on each entry so a search hit can still say
     where it came from. Built once; the catalogue is static data. */
  const ALL = [];
  const BY_KEY = Object.create(null);
  GROUPS.forEach(g => g.traits.forEach(t => {
    const e = { key: t.n, name: title(t.n), desc: t.d, group: g.id, groupLabel: g.label, extra: t.k || "" };
    ALL.push(e);
    BY_KEY[e.key] = e;
  }));

  /* ============================================================
     Search.

     Over the name, the gloss and the extra vocabulary together — which is the whole
     point of the gloss. Scored so that a name match beats a description match beats
     a fuzzy one, because someone typing "regeneration" wants Regeneration first and
     someone typing "wounds closed" has no name in mind at all.
     ============================================================ */
  const tokens = s => String(s || "").toLowerCase().match(/[a-z']+/g) || [];

  /* Words that carry no signal in a description of a monster. Without this the search
     is worse than useless on a typed sentence: everything a player writes is mostly
     these, and a common word matched against enough entries buries the one real term.

     They are stripped, not down-weighted, because down-weighting still lets thirty
     weak hits outvote one strong one. */
  const STOP = new Set(("a an and are as at be by can could did do does for from had has have " +
    "he her him his i in into is it its me my not of on one or our out she that the their them " +
    "then there they this to us was we were what when which who will with you your").split(" "));

  /* Prefix, not substring. "swallow" contains "wall" and "ethereal" contains "the", so
     a substring test ranked Swallow first for "walked through the wall" and put
     Incorporeal Movement — which the description matches word for word — third.
     Comparing whole tokens by prefix keeps the loose plural and tense matching that
     made substrings attractive without the accidents. */
  function hitsToken(list, w) {
    for (const t of list) {
      if (t === w) return true;
      /* Prefix either way, but only once there is enough word to be a prefix OF.
         Four is the floor because three lets "off" match "of" and "sword" match
         nothing useful, which is how Beast of Burden came top for "my sword
         bounced off". */
      const short = Math.min(t.length, w.length);
      if (short >= 4 && (t.startsWith(w) || w.startsWith(t))) return true;
    }
    return false;
  }

  function search(q, limit) {
    const query = String(q || "").trim().toLowerCase();
    if (!query) return [];
    const qs = tokens(query).filter(w => w.length > 2 && !STOP.has(w));
    /* An all-stopword query still deserves the phrase pass rather than nothing. */
    if (!qs.length && query.length < 3) return [];
    const out = [];
    for (const e of ALL) {
      const name = e.key;
      const hay = (e.desc + " " + e.extra).toLowerCase();
      const nameToks = tokens(name);
      const descToks = tokens(e.desc);
      /* `extra` is scored between the name and the gloss, because it is neither: it
         is the words a person actually types, curated for exactly this. One of them
         should be enough to surface an entry on its own, which one gloss word is
         deliberately not. */
      const extraToks = tokens(e.extra);
      let s = 0;
      /* The whole phrase, where it lands. Kept as a substring test on purpose: a
         person typing an exact multi-word name or an exact phrase from the gloss
         means it, and there is no accident to have when the needle is that long. */
      if (name === query) s += 100;
      else if (name.startsWith(query)) s += 60;
      else if (name.includes(query)) s += 40;
      if (query.length > 4 && hay.includes(query)) s += 12;
      /* Then word by word, so a two-word query landing one word in the name and one
         in the gloss still beats an entry that matches neither well. */
      for (const w of qs) {
        if (hitsToken(nameToks, w)) s += 8;
        else if (hitsToken(extraToks, w)) s += 6;
        else if (hitsToken(descToks, w)) s += 3;
      }
      /* A single weak gloss word is not a match. Below this, "my sword bounced off"
         — which no trait in the catalogue is about — returned five unrelated entries
         that each happened to share one common word with it, and an honest empty
         state is far more use than that. One name word, or two gloss words. */
      if (s >= 6) out.push({ entry: e, score: s });
    }
    out.sort((a, b) => b.score - a.score || a.entry.key.localeCompare(b.entry.key));
    return out.slice(0, limit || 12).map(r => r.entry);
  }

  /* How many monsters in the corpus carry each catalogued trait. Used only to tell
     the person that a trait exists but nothing has it — a catalogue entry that
     matches zero monsters is a bug in the catalogue, and this is how it shows up. */
  function counts(monsters) {
    const c = Object.create(null);
    (monsters || []).forEach(m => (m.traitNames || traitsOf(m)).forEach(k => {
      c[k] = (c[k] || 0) + 1;
    }));
    return c;
  }

  return {
    TRAIT_GROUPS: GROUPS, TRAIT_ALL: ALL, TRAIT_BY_KEY: BY_KEY, TRAIT_ALIASES: ALIASES,
    traitCanon: canon, traitFold: fold, traitsOf, tagTraits: tagAll,
    searchTraits: search, traitCounts: counts, traitTitle: title,
  };
});
