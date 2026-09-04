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
        { n: "magic resistance", d: "advantage on saving throws against spells and other magical effects" },
        { n: "spell immunity", d: "immune to a handful of specific spells chosen by whoever created it" },
        { n: "limited magic immunity", d: "can't be affected or detected by low-level spells unless it wants to be; advantage on saves against everything else magical" },
        { n: "spell turning", d: "advantage on saves against a spell that targets only it; on a successful save the spell can rebound onto the caster instead" },
        { n: "immutable form", d: "immune to spells and effects that would change its shape", k: "polymorph petrify" },
        { n: "antimagic cone", d: "projects an antimagic field in a cone from its eye", k: "beholder eye" },
        { n: "turn resistance", d: "advantage on saves against effects that turn undead", k: "cleric channel divinity" },
        { n: "turn immunity", d: "immune to effects that turn undead" },
        { n: "fey ancestry", d: "advantage on saves against being Charmed; immune to magical sleep", k: "elf charm sleep" },
        { n: "gnome cunning", d: "advantage on Intelligence, Wisdom, and Charisma saves against magic", k: "int wis cha" },
      ],
    },
    {
      id: "saves", label: "Saving Throws",
      traits: [
        { n: "legendary resistance", d: "can choose to succeed on a failed saving throw instead, a limited number of times a day", k: "reroll refused failed save" },
        { n: "avoidance", d: "on a save that would normally halve the damage, takes none on a success and half on a failure" },
        { n: "evasion", d: "on a Dexterity save that would normally halve the damage, takes none on a success and half on a failure", k: "fireball breath half damage" },
        { n: "indomitable", d: "can reroll a failed saving throw, keeping the new result" },
        { n: "dwarven resilience", d: "advantage on saves against poison; resistant to poison damage" },
        { n: "duergar resilience", d: "advantage on saves against poison, spells, and illusions, and against being Charmed or Paralysed" },
        { n: "brave", d: "advantage on saves against being Frightened" },
        { n: "dark devotion", d: "advantage on saves against being Charmed or Frightened" },
        { n: "insanity", d: "advantage on saves against being Charmed or Frightened" },
      ],
    },
    {
      id: "mind", label: "Mind and Psychic Defense",
      traits: [
        { n: "mental fortitude", d: "advantage on saves against being Charmed or Frightened; can't be put to sleep by magic" },
        { n: "shielded mind", d: "immune to scrying and to any effect that would sense its emotions, read its thoughts, or find its location; can only be reached telepathically if it allows it" },
        { n: "telepathic shroud", d: "immune to effects that sense its emotions or read its thoughts, and to all divination spells" },
        { n: "alien mind", d: "reading its thoughts, or hurting it with psychic damage, stuns whoever tried", k: "psychic backlash" },
        { n: "axiomatic mind", d: "can't be compelled to act against its own nature or its instructions" },
        { n: "inscrutable", d: "immune to attempts to sense its emotions or read its thoughts, and to divination spells it refuses; Insight checks to gauge its sincerity have disadvantage" },
        { n: "divine awareness", d: "knows when it's being lied to" },
      ],
    },
    {
      id: "healing", label: "Healing and Regeneration",
      traits: [
        { n: "regeneration", d: "regains hit points at the start of its turn, unless it took a specific kind of damage since its last turn; dies for good only if it starts its turn at 0 hit points without regenerating", k: "healed between rounds wounds closed itself troll fire acid" },
        { n: "fiendish regeneration", d: "regains hit points at the start of its turn, unless it took radiant damage since its last turn; dies for good only if it starts its turn at 0 hit points without regenerating" },
        { n: "undead fortitude", d: "when reduced to 0 hit points, can make a Constitution save to drop to 1 instead; doesn't work against radiant damage or a critical hit", k: "zombie stood up again" },
        { n: "rejuvenation", d: "if destroyed, forms a new body some days later at a specific place tied to it, back to full hit points", k: "came back ghost lich" },
        { n: "demonic restoration", d: "if killed outside the Abyss, gets a new body there instantly, back to full hit points" },
        { n: "diabolical restoration", d: "if killed outside the Nine Hells, gets a new body there instantly, back to full hit points" },
        { n: "fiendish restoration", d: "if killed off its home plane, gets a new body there instantly, back to full hit points" },
        { n: "undead restoration", d: "if destroyed, reforms with full hit points some time later, unless stopped by a specific kind of magic" },
        { n: "elemental restoration", d: "if killed off its home plane, gets a new body there some days later, back to full hit points" },
        { n: "darklord restoration", d: "if killed, returns to full hit points days or weeks later, in a place tied to it" },
        { n: "second wind", d: "can heal itself once, as a bonus action, mid-fight" },
        { n: "relentless", d: "a hit that would drop it to 0 hit points leaves it at 1 instead, as long as the damage isn't too large" },
        { n: "damage absorption", d: "immune to a specific damage type; taking that damage heals it instead", k: "healed when we hit it absorbed fire lightning cold got stronger" },
      ],
    },
    {
      id: "defence", label: "Misc Defense",
      traits: [
        { n: "psychic defense", d: "unarmoured, but its Wisdom adds to its AC anyway" },
        { n: "damage transfer", d: "while grappling something, only takes half the damage done to it — the rest goes to whatever it's holding", k: "shared hurt its host" },
        { n: "parry", d: "adds to its AC against one attack, as a reaction", k: "reaction blocked deflect" },
        { n: "displacement", d: "projects an illusion of being near where it actually is, so attacks against it have disadvantage; a hit disrupts this until its next turn", k: "displacer illusion offset" },
        { n: "blurred form", d: "attacks against it have disadvantage unless it's incapacitated" },
        { n: "slippery", d: "advantage on checks and saves made to escape a grapple" },
        { n: "superior invisibility", d: "can turn invisible as a bonus action and stay that way while fighting, until it loses concentration", k: "we never saw it unseen invisible went invisible" },
        { n: "invisible in water", d: "invisible while fully submerged" },
        { n: "transparent", d: "almost impossible to notice while it hasn't moved or attacked; anything that walks into its space unaware is surprised by it", k: "gelatinous cube glass clear" },
        { n: "unarmored defense", d: "unarmoured, but its Wisdom adds to its AC anyway" },
        { n: "flyby", d: "doesn't provoke an opportunity attack when it flies out of reach", k: "no opportunity attack darted away" },
      ],
    },
    {
      id: "weakness", label: "Weaknesses",
      traits: [
        { n: "antimagic susceptibility", d: "incapacitated while inside an antimagic field; dispel magic can knock it out", k: "dispel animated object" },
        { n: "sunlight sensitivity", d: "disadvantage on attacks and on Perception checks that rely on sight, while in sunlight", k: "daylight torch drow" },
        { n: "sunlight hypersensitivity", d: "takes damage, or worse, if it starts its turn in sunlight" },
        { n: "sunlight weakness", d: "disadvantage on attacks, checks, and saves while in sunlight" },
        { n: "sun sickness", d: "disadvantage on checks, attacks, and saves in sunlight; dies if it stays in it too long" },
        { n: "light sensitivity", d: "disadvantage on attacks and on Perception checks that rely on sight, in bright light of any kind" },
        { n: "vampire weaknesses", d: "can't enter a home uninvited, is hurt by running water and sunlight, can be staked while incapacitated, and turns to stone rather than dying if reduced to 0 hit points otherwise", k: "vampire holy symbol" },
        { n: "aversion to fire", d: "disadvantage on attacks and checks for a round after taking fire damage" },
        { n: "water susceptibility", d: "takes damage from contact with water — moving through it, being splashed, or standing in rain", k: "doused splashed" },
        { n: "water dependency", d: "needs to be submerged for part of the day, or starts to suffer for it" },
      ],
    },
    {
      id: "proximity", label: "Proximity Hazards",
      traits: [
        { n: "heated body", d: "burns anything that touches it or hits it in melee", k: "hot metal glowing" },
        { n: "corrosive form", d: "touching it, or hitting it in melee, deals acid damage; nonmagical metal or wooden weapons corrode and are eventually destroyed", k: "acid ate my sword" },
        { n: "stench", d: "anything that stays close to it has to save or be poisoned", k: "reeked nauseated poisoned smell" },
        { n: "fear aura", d: "anything that starts its turn nearby has to save or become Frightened", k: "dread terror radius" },
        { n: "fire aura", d: "anything nearby takes fire damage each round, or on touching or hitting it" },
        { n: "cold aura", d: "anything nearby takes cold damage each round, or on touching or hitting it" },
        { n: "whispering aura", d: "anything nearby takes psychic damage each round unless it saves" },
        { n: "poisonous skin", d: "touching its bare skin, or grappling it, risks poisoning" },
        { n: "distress spores", d: "when it's hurt, others of its kind nearby sense it" },
        { n: "frightful presence", d: "as an action, forces everyone nearby to save or become Frightened of it", k: "roar terror dragon fear" },
        { n: "death burst", d: "explodes when it dies; anything close has to save against the damage", k: "exploded died blew up on death" },
        { n: "death throes", d: "does one last burst of damage or effect to everything nearby when it dies" },
      ],
    },
    {
      id: "movement", label: "Movement",
      traits: [
        { n: "freedom of movement", d: "ignores difficult terrain; magic can't slow it, paralyse it, or restrain it, and it can shrug off a nonmagical restraint or grapple" },
        { n: "incorporeal movement", d: "can move through creatures and objects as if they were difficult terrain; takes force damage if it ends its turn inside one", k: "ghost passed through phased" },
        { n: "air form", d: "made of air — can enter another creature's space and squeeze through gaps as narrow as an inch" },
        { n: "fire form", d: "made of fire — can squeeze through gaps as narrow as an inch, and sets alight anything it touches or moves into" },
        { n: "water form", d: "made of water — can enter another creature's space and squeeze through gaps as narrow as an inch" },
        { n: "spider climb", d: "can climb difficult surfaces, including upside down on ceilings, without a check" },
        { n: "web walker", d: "ignores movement restrictions from webbing" },
        { n: "glide", d: "falls slower than normal and can glide horizontally as it descends" },
        { n: "limited flight", d: "can fly for a single turn, as a bonus action" },
        { n: "standing leap", d: "jumps much further than normal, and doesn't need a running start to do it" },
        { n: "running leap", d: "with a running start, jumps much further than normal" },
        { n: "feline agility", d: "can double its speed for a turn, then has to stand still on a later turn before doing it again" },
        { n: "ice walk", d: "crosses ice and snow without difficulty or risk of slipping" },
        { n: "sure-footed", d: "advantage on saves against being knocked prone" },
        { n: "earth glide", d: "can burrow through solid, unworked earth and stone without disturbing it" },
        { n: "tunneler", d: "can burrow through solid rock, leaving a tunnel behind" },
        { n: "tree stride", d: "can step into one tree and out of another some distance away, as part of its move" },
        { n: "misty escape", d: "when dropped to 0 hit points away from its resting place, turns to mist and flees instead of falling unconscious, and must reach that resting place before time runs out or be destroyed", k: "vampire vanished smoke" },
        { n: "teleport", d: "can teleport a short distance, as a bonus action" },
        { n: "nimble escape", d: "can Disengage or Hide as a bonus action every turn", k: "goblin disengage bonus action" },
        { n: "cunning action", d: "can Dash, Disengage, or Hide as a bonus action every turn" },
        { n: "amorphous", d: "can squeeze through gaps as narrow as an inch", k: "ooze crack under the door" },
        { n: "amphibious", d: "can breathe air and water" },
        { n: "limited amphibiousness", d: "can breathe air and water, but has to submerge periodically or start suffocating" },
        { n: "water breathing", d: "can only breathe underwater; can hold its breath for a while out of it" },
        { n: "hold breath", d: "can hold its breath for a long time out of water" },
        { n: "animated", d: "an object with no legs or similar way to move, so it flies and hovers instead of walking", k: "furniture object moved on its own hovered" },
      ],
    },
    {
      id: "senses", label: "Senses",
      traits: [
        { n: "devil's sight", d: "magical darkness doesn't block its darkvision", k: "saw us in the dark pitch black unaffected by darkness" },
        { n: "ethereal sight", d: "can see into the Ethereal Plane from the Material Plane, and vice versa" },
        { n: "web sense", d: "while touching its web, knows exactly where anything else touching that web is" },
        { n: "creature sense", d: "aware of intelligent creatures within a wide radius, and roughly how smart each one is" },
        { n: "otherworldly perception", d: "can sense anything invisible or on the Ethereal Plane nearby, and pinpoint it if it moves" },
        { n: "keen senses", d: "advantage on Perception checks that rely on smell, hearing, or sight", k: "sniffed us out heard smelled tracked" },
        { n: "echolocation", d: "can't use its blindsight while deafened", k: "bat clicks deafened" },
        { n: "labyrinthine recall", d: "perfectly remembers every route it's ever taken", k: "minotaur maze never lost" },
        { n: "wakeful", d: "at least one of its heads stays awake while the rest of it sleeps" },
      ],
    },
    {
      id: "talk", label: "Communication",
      traits: [
        { n: "limited telepathy", d: "sends telepathic messages within a limited range; either restricted to creatures of its own kind, or one-way with no reply possible" },
        { n: "telepathic bond", d: "stays in silent telepathic contact with its master or bonded creature, wherever they are" },
        { n: "telepathic hub", d: "relays telepathic messages between several creatures who couldn't otherwise talk to each other" },
        { n: "shark telepathy", d: "can command sharks nearby through telepathy" },
        { n: "speak with beasts and plants", d: "can talk with beasts and plants as if they shared a language" },
        { n: "speak with frogs and toads", d: "can get simple ideas across to frogs and toads" },
        { n: "mimicry", d: "can copy sounds and voices it's heard closely enough to fool a listener", k: "cried for help copied speech" },
      ],
    },
    {
      id: "extra", label: "Extra Actions",
      traits: [
        { n: "multiattack", d: "attacks more than once on its turn" },
        { n: "combat ready", d: "advantage on initiative rolls", k: "went first acted before us fast initiative" },
      ],
    },
    {
      id: "conditional", label: "Conditional Offense",
      traits: [
        { n: "pack tactics", d: "advantage on an attack if an ally is next to the target", k: "flanking wolves gang up" },
        { n: "martial advantage", d: "extra damage, once per turn, when it hits a target that has one of its allies next to it", k: "hobgoblin extra damage ally" },
        { n: "sneak attack", d: "extra damage once per turn, if it has advantage on the attack or an ally is next to the target" },
        { n: "assassinate", d: "advantage on attacks in the first round against anyone who hasn't acted yet, and any hit against a surprised target is a critical", k: "surprise round critical" },
        { n: "surprise attack", d: "extra damage against a surprised target, in the first round of combat" },
        { n: "charge", d: "extra damage — sometimes a shove or knockdown too — if it runs a good distance straight at a target before hitting it", k: "ran at us gore" },
        { n: "trampling charge", d: "if it runs a good distance straight at a target before hitting it, the target can be knocked prone, opening it up to another attack as a bonus action" },
        { n: "pounce", d: "if it runs a good distance straight at a target before hitting it, the target can be knocked prone, opening it up to another attack as a bonus action" },
        { n: "dive attack", d: "extra damage on a melee hit if it dove at the target from the air first" },
        { n: "rampage", d: "if it drops a creature with a melee hit, it can move and make another attack, as a bonus action", k: "killed then attacked again" },
        { n: "ambusher", d: "advantage on attacks in the first round against anyone it surprised", k: "snuck up on us ambush" },
        { n: "blood frenzy", d: "advantage on melee attacks against anything already hurt", k: "smelled blood advantage bloodied" },
        { n: "reckless", d: "can trade defence for offence at the start of its turn — advantage on its melee attacks, but attacks against it get advantage too, until its next turn", k: "barbarian advantage both ways" },
        { n: "berserk", d: "when badly hurt, has a chance each turn to lose control and attack whatever's nearest — creature or object — until it's destroyed, healed up, or talked down by its creator" },
        { n: "brute", d: "its weapon attacks deal an extra die of damage" },
        { n: "aggressive", d: "can close the distance to a target as a bonus action" },
        { n: "marshal undead", d: "nearby undead under its command fight harder and resist being turned" },
      ],
    },
    {
      id: "grapple", label: "Grapple and Restrain",
      traits: [
        { n: "grappler", d: "advantage on attacks against anything it's already grappling", k: "grabbed grappled held onto me caught" },
        { n: "adhesive", d: "anything that touches it gets stuck; escaping is harder than a normal grapple", k: "glued mimic stuck" },
        { n: "swallow", d: "swallows a creature whole with a bite or similar attack", k: "ate him gulped inside its stomach" },
        { n: "tentacles", d: "attacks with tentacles" },
        { n: "ooze cube", d: "fills its whole space; anything that enters gets engulfed, and pulling someone out takes an action, a check, and some damage to whoever tries" },
      ],
    },
    {
      id: "offence", label: "Misc Offense",
      traits: [
        { n: "breath weapon", d: "exhales something damaging in a cone or a line, usable only once every so often", k: "breathed fire cone line recharge" },
        { n: "petrifying gaze", d: "meeting its eyes risks turning to stone — gradually on a close save, all at once on a bad one — and can be avoided by looking away", k: "medusa basilisk look away" },
        { n: "firearms knowledge", d: "knows how to reload firearms fast enough to fire them every turn" },
        { n: "potent cantrip", d: "adds its spellcasting modifier to the damage of its cantrips" },
        { n: "spell storing", d: "can hold one spell, cast into it by someone else, and unleash it later on command" },
      ],
    },
    {
      id: "magicatk", label: "Magic-Enhanced Attacks",
      traits: [
        { n: "magic weapons", d: "its weapon attacks count as magical" },
        { n: "angelic weapons", d: "its weapon attacks count as magical and deal extra radiant damage" },
        { n: "divine eminence", d: "can spend a spell slot, as a bonus action, to add extra radiant damage to its melee hits for the rest of the turn" },
        { n: "empowered attacks", d: "its attacks count as magical, so resistance or immunity to nonmagical weapons doesn't help against them" },
        { n: "siege monster", d: "deals double damage to objects and structures", k: "smashed the wall building" },
      ],
    },
    {
      id: "heads", label: "Multiple Heads",
      traits: [
        { n: "two heads", d: "advantage on Perception checks and on saves against being Blinded, Charmed, Deafened, Frightened, Stunned, or knocked unconscious", k: "advantage perception" },
        { n: "multiple heads", d: "has several heads; loses one for every burst of damage it takes in a single turn, and only dies when all of them are gone — though it can grow more back between fights", k: "hydra" },
        { n: "reactive heads", d: "gets an extra reaction for each head beyond its first, usable only for opportunity attacks" },
      ],
    },
    {
      id: "stealth", label: "Stealth & Appearance",
      traits: [
        { n: "false appearance", d: "indistinguishable from an ordinary object as long as it stays still", k: "looked like a statue chest rock" },
        { n: "camouflage", d: "advantage on Stealth checks to hide, in the right terrain", k: "blended in stone snow plants" },
        { n: "chameleon skin", d: "advantage on Stealth checks to hide" },
        { n: "shapechanger", d: "can change shape into something else and back, as an action; its statistics mostly stay the same", k: "turned into a wolf mist person" },
        { n: "shadow stealth", d: "can Hide as a bonus action while in dim light or darkness", k: "hid in the dark bonus action" },
        { n: "the colors of age", d: "its colour changes as it ages, and older ones know more spells" },
      ],
    },
    {
      id: "nature", label: "Creature Nature & Type",
      traits: [
        { n: "disintegration", d: "when it dies, its body crumbles to dust, leaving only what it was carrying", k: "no corpse dust nothing left behind" },
        { n: "unusual nature", d: "doesn't need to breathe, eat, drink, or sleep" },
        { n: "elemental demise", d: "when it dies, its body dissolves away entirely, leaving only what it was carrying", k: "vanished corpse dissolved" },
        { n: "beast of burden", d: "counts as one size larger for how much it can carry" },
        { n: "illumination", d: "sheds light of its own", k: "glowed shed bright light" },
        { n: "special equipment", d: "carries specific named gear, often magical, beyond what an ordinary member of its kind would have" },
        { n: "swarm", d: "a mass of small creatures acting as one; can share a space with other creatures, squeezes through tiny gaps, and can't regain hit points", k: "rats bats insects cloud" },
        { n: "ashen creature", d: "when destroyed, collapses into a pile of ash, dropping whatever it was carrying" },
        { n: "bound", d: "magically tied to an amulet; its wearer can call it from anywhere on the same plane, and can share damage with it at close range" },
        { n: "water bound", d: "dies if it leaves the water it's tied to, or if that water is destroyed" },
        { n: "constructed nature", d: "doesn't need air, food, drink, or sleep; the magic animating it fails for good once it's reduced to 0 hit points" },
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
