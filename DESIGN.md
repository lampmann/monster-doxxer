# Design

This records what's built, the decisions taken so far and why, and the open questions that need
answering before the next pieces are worth writing. The original handoff document is the spec;
this file is where it meets reality and where it has been deviated from.

## Status

| | |
|---|---|
| `src/normalize.js` | Built, 73 assertions. Ported from pmcrwf. |
| `src/score.js` | F1, F2, F3, F7 built, 62 assertions. Constants now measured, not guessed. |
| `src/discriminate.js` | F13 — what to try next, by information gain. |
| `ontology/symptoms.json` + `src/symptoms.js` | F8 built, 111 symptoms, 38 assertions. |
| `eval/` | §6 harness built, 29 assertions. **Everything above is measurable now.** |
| Numerics (F4, F5, F6) | F4 and F6 built, 39 assertions. **F5 measured and rejected** — below. |
| `index.html` + `src/app.js` | Built. Query form, ranked results with reasons, statblock panel. |
| Source filter (F16) | Built, tri-state include/exclude, 32 assertions. |
| Session evidence (F15) | Built — observations persist across a reload. |
| Discriminating tests (F13) | Built, 41 assertions, and measured. |
| `src/appearance.js` | F10 (lexical half), F11, F12 built, 45 assertions. **Embeddings not built** — below. |
| `src/names.js` | Matching a name the party heard. Not in the handoff; 38 assertions. |
| `src/encounter.js` | Party-plausibility tiebreak from level and fight size; 44 assertions. |
| `build/embed.py` + `src/embeddings.js` | F9 / F10's semantic half. Built; **index never built here** — below. |
| Tabs | One per monster, with per-tab evidence and encounter grouping. |
| No-match floor (§7) | Built, 9 assertions. Threshold measured by `eval/nomatch.js`, not guessed. |
| Volatile tier (§7) | Built, 7 assertions. Legendary/lair keep full credit, discounted penalty. |
| `src/ranges.js` | Bounds from dice the party rolled — AC, save DC, HP. 56 assertions. |
| Attack evidence | Save ability, attack kind, attacks per turn, save DC range. |
| `tests/ui.js` | Browser suite over `src/app.js`, 56 assertions. Opt-in: `doxx test-ui`. |

Current measurement, 500 sampled monsters against the full 4,528-record corpus:

```
                          top-1    top-5   top-20   median rank
handoff §6 corruption     41.2%    67.4%    82.2%       2
+ a description (F10)     49.4%    73.0%    86.4%       2
```

## Decisions

**Plain JavaScript, not TypeScript.** The handoff specifies TS. This is plain script with a
UMD-style wrapper, matching the idiom of the sibling project the author already maintains — it's
what they'll be reading and editing. Reversible later; adding types to working, tested code is a
much smaller job than debugging an unfamiliar toolchain now.

**The core runs under Node.** Not a stylistic choice. pmcrwf's tests need a browser and a
Playwright harness, and that round-trip is most of the iteration cost on a project like this one,
where the work is tuning numbers against data. `node tests/run.js` takes milliseconds. The UI will
be browser-only; everything that can be tested headlessly is.

**The build step is optional, not required.** The handoff's architecture is a Python build step
producing a static index, shipped to the browser. That's right for embeddings and for zero-setup,
but making it *mandatory* would mean the tool doesn't work at all without running Python first.
Instead: the app computes rarity tables, CR averages, symptom tags and BM25 in-browser from
whatever bestiary you point it at — all linear passes over ~4,500 records, comfortably under a
second — and *upgrades* to the prebuilt index when one is present.

**Ranking never filters, except by source.** F16's source filter is the single legitimate exception
and it's implemented as one, in `rank()`. Every other input is evidence.

**`src/` never touches the filesystem, `eval/` does.** The scorer has to run in a browser, so
anything that reads `data/` lives in `eval/corpus.js` and is required only by offline tools.

**The UI follows pmcrwf: deliberately minimal, function over form.** Same custom-property theming,
same square corners and hairline rules, same tri-state filter chips, no framework and no build step.
This gets read at a table, mid-fight, probably on a phone — it should answer a question, not present
an experience. The one piece of ornament is the score bar, and it earns its place: a ranked list
without magnitudes hides the difference between "clearly this" and "the least bad of 4,528".

**The form's order is the argument.** "What did it do?" is first because the symptom ontology is
worth roughly four times what any other evidence is. Numbers are last because they are the thing DMs
change. A player who fills in only the first box has already given the tool its best shot.

## What the harness changed

The constants were guesses. §6 says to corrupt real statblocks and measure top-5 recall instead of
trusting intuition, and doing it moved the headline number from **34.5% to 57.5%** — median rank
19 to 3. Almost none of that was tuning. Three findings, in descending order of how much they
mattered:

**The damage facet was silently broken and actively harmful.** Removing damage evidence entirely
*improved* recall by 20 points. `FACETS` never produced `immune:`/`resist:`/`vuln:` keys, but the
damage scorer asked the rarity table for exactly those — so every damage observation missed the
table, fell to the unseen-feature floor, and came back worth `maxWeight`. Fire immunity, which 7%
of the corpus has, was being scored as rarer than anything in the game and outweighing every
structural feature combined. Damage interactions are facets now, and `normal` derives its weight
from the same table rather than a hardcoded 0.5.

**F8 is worth more than everything else put together.** Ablation prices each facet by removing it:

```
without symptoms     -23.7 points of top-5
without type          -6.0
without damageDealt   -5.7
without size          -5.3
without senses        -4.3
without typeTags      -4.0
without movement      -2.0
without condImmune    -2.0
```

The handoff called the symptom ontology the highest-value hand-curated asset in the project. It is,
by a factor of four over the next facet.

**`missFactor` was wrong in the direction the guess was reasoned toward.** It was set to 0.6 on the
theory that a player may have misread what they saw. But dropout already models the player failing
to notice things and costs nothing by design (F2), so 0.6 was discounting the same doubt twice.
Recall climbs monotonically to ~1.3; it is 1.0 now, where a miss costs exactly what a match earns.

Three real defects in the normaliser and tagger surfaced only because the harness ran the whole
corpus through: `type` can nest a `{choose: [...]}` (the Empyrean is "celestial or fiend") and
crashed every facet that lowercased it; `damageTags` were passed through as 5e.tools' raw single
letters, so an observation of `fire` could never match `"F"`; and a symptom candidate whose regex
failed to compile matched *every* monster rather than none.

## Tabs, and what is shared between them

You are usually working out what several things were at once, so there is a tab per
monster, in pmcrwf's idiom: click the active tab to rename it, `×` to close, `+` to add.
A tab labels itself with whatever is currently winning until you name it — and VTT parties
usually have a DM-assigned name for each token, so naming is the expected path rather than
a nicety.

**What is per-tab and what is not is the only real decision here.** Observations belong to a
monster: the whole point is that the evidence for the thing in the doorway never blends into
the evidence for the thing on the ceiling, which is the "two monsters, one set of
observations" failure the handoff flagged from the start and which no amount of scoring can
recover from. Everything else — which books your DM owns, how big your party is — is a fact
about the TABLE and is shared.

## The party, and a prior that had to be demoted

Tell the tool your level and how many adventurers you have, and it works out the CR band a DM
building that encounter would be aiming at, from the DMG's own tables (p.82 thresholds,
p.274 XP-by-CR). Tabs can be grouped into a fight and given a count, because **the DMG
multiplies an encounter's XP by how crowded it is** — inverting that is what pushes each
individual monster's plausible CR down. One ogre is CR 1–7 for a level 3 party; one of eight
creatures in the same fight is CR 1/8–1. That difference is large and worth capturing.

**It was built as a capped score bonus and the harness demoted it to a tiebreak.** Measured
two ways — a party level chosen so the monster is in band, and one chosen so it is deliberately
out:

```
                        prior off    as a score    as a tiebreak
DM built to the party      64.3%         64.7%           65.3%
DM went off-piste          64.3%         56.3%           63.0%
```

As a score it was worth **+0.4 points when right and −8 when wrong**, and the tool cannot tell
which kind of DM it is talking to. The reason is structural: a band wide enough to be fair
boosts thousands of monsters equally, so it carries almost no information once the evidence has
spoken. Narrowing the band to a peak instead of a plateau was tried at three widths and did not
rescue it.

As a tiebreak it can only order candidates the evidence has already called identical — which
is the common case, as F13 established — so the downside collapses to about a point. That is
the same discipline the legacy prior follows: **a prior may arrange what the evidence could not
distinguish, and nothing more.**

## A name the party heard

Not in the handoff, and it should have been. The whole premise is that players do not know
what they fought — but a DM narrates, and narration contains nouns. *"The barghest lunges at
you"* hands a table the word **barghest** without telling them it names a creature with a
statblock and a poison immunity. Plenty of players will have a name and no idea it is one.

**It is not appearance, and folding it into F10 would have been wrong twice over.** A
description is tier 3: capped, never subtracting, because the DM reflavours. A name the DM
said out loud is close to conclusive.

Matching is deliberately forgiving, because names arrive through the air, once. Exact forms
first (including 5e.tools' `alias` and `shortName`), then whole-string fuzzy matching sized by
length — "barghast" finds the Barghest, "owl bear" finds the Owlbear — then per-token scoring
weighted by how distinctive each word is across the corpus of names, because "giant" appears
in dozens of names and "barghest" in one.

**The first implementation was wrong and the UI caught it.** A name started as a flat bonus
added after F7 normalisation, like appearance. Then typing "barghest" *and* guessing the
creature type wrong dropped the Barghest out of the top three — because one contradicted field
costs the whole [-1,1] range of the normalised score, while a capped bonus could only add 0.8
back. A name is now an ordinary weighted feature at 9 nats, weighed against the other evidence
rather than added to the result, and "the DM called it a barghest, and I think it was a dragon"
resolves the way a person would resolve it.

It earns **credit only**. A candidate that is not the named creature is never docked; it simply
fails to earn the largest thing on offer, which under F7 is a strong demotion without ever
becoming a filter. That matters because the name may be wrong.

```
                              top-1    top-5
no name heard                 41.0%    64.3%
a name 30% of the time        57.0%    73.0%
always a name, 10% wrong      94.0%    97.3%
always a name, 50% WRONG      72.3%    82.0%
```

The last row is the one that justifies the design. Even when **half the names are completely
wrong**, the tool is well above the no-name baseline; a filter would have collapsed to around
50%. And `nameWeight` is the one constant where the principled derivation and the measurement
agree without argument: an exact name is the rarest possible observation, one in 4,528, about
8.4 nats — and 9 is what the sweep picks, under both the usually-right and the half-wrong
conditions.

## The semantic half: CLIP

`build/embed.py` encodes each monster and ships a quantised index; `src/embeddings.js`
consumes it in the browser and blends it with BM25, which is what F10 actually asks for.

**Why CLIP rather than a text model.** Because the picture is frequently the better
document. The Monster Manual's opening paragraphs are often about ecology and temperament —
the beholder's entry discusses its arrogance before it mentions eyestalks — while the
artwork is unambiguously what the thing looked like, which is what the player is describing.
CLIP puts text and images in one space, so a typed description can match either, and the
same index later answers a VTT token screenshot that perceptual hashing could not.

**The query-side compromise.** Ranking needs the query embedded, and the query only exists
at runtime, which naively means shipping the text encoder to the browser. Instead the build
step also emits vectors for a vocabulary (~8,000 words drawn from the corpus plus plain
English a player would reach for), and a query is the mean of its words' vectors. That is an
*approximation* of encoding the sentence — it loses word order and composition — chosen to
keep the page dependency-free. `build/embed.py --queries` encodes sentences properly, so the
approximation can be measured against the real thing rather than assumed adequate.

### What CLIP actually bought, measured

Built on hardware that could reach the weights: ViT-B-32/laion2b_s34b_b79k over 4,528
monsters, 2,632 with their official artwork mixed into the vector, 8,010 vocabulary words.
`eval/appearance.js --sweep`, 16 hand-written paraphrase queries. Every row below differs
only in how the QUERY gets its vector — same index, same monsters, same blend weight 0.35:

| query representation | top-1 | top-5 | top-20 |
|---|---|---|---|
| BM25 alone, no embeddings | 4/16 | 8/16 | 10/16 |
| flat mean of its words | 4/16 | 8/16 | 12/16 |
| IDF-weighted mean, unstemmed lookup (a bug, since fixed) | 4/16 | 8/16 | 13/16 |
| **IDF-weighted mean, stemmed lookup** ← ships | 4/16 | 8/16 | **12/16** |
| IDF-weighted mean, unseen words treated as rarest | 4/16 | 8/16 | 12/16 |
| sentence encoded by the model, blended 0.5 | 4/16 | **9/16** | 13/16 |
| semantic only — every averaged-query variant above | 0/16 | 0/16 | 0/16 |
| semantic only — sentence encoded properly | 1/16 | 3/16 | 7/16 |

**+2 of 16 at top-20, nothing at top-1 or top-5. That is what ships**, and it is
indistinguishable from a plain flat mean on this benchmark — both land at 4/8/12.

An earlier version of this section reported +3 (13/16), measured on a build with a real
bug: the IDF lookup wasn't stemming the query word, so "eyestalks" (df 0 unstemmed, 19
stemmed) fell through to the same neutral weight as a genuinely unseen word, while
"covered" — sentence glue — outweighed it. Fixed, with a regression test pinned to that
exact failure (`tests/appearance.test.js`, "query word weights for the embedding half").
The corrected version does NOT reproduce the higher number. This is worth stating plainly
rather than quietly editing away: fixing a real, demonstrated bug made the benchmark score
*tie or slightly worse* than the bug did.

That is not a reason to keep the bug. Sixteen queries cannot reliably distinguish a
12 from a 13 — that is a one-query swing, well inside noise — and the bug was
mechanistically, provably wrong regardless of what the aggregate number rewards. The
regression test exists because the benchmark cannot be trusted to catch a regression here;
it is not sensitive enough.

**The number that actually matters did not move at all, under any of the four weighting
schemes tried.** Semantic-only sits at exactly 0/16 — flat mean, buggy IDF, fixed IDF,
unseen-as-rarest, all identical zero — where chance across 4,528 monsters is about 0.07
expected hits at top-20. Properly-encoded sentences reach 7/16 from the identical vectors.
So the vectors can retrieve, and no way of averaging a bag of word vectors tried here can.
What ships is a reranker over whatever BM25 already surfaced, not the semantic search the
feature was named for.

### Three theories that were wrong, or didn't matter

`--vocab-prompt` wrapped each vocabulary word in a caption ("a photo of a {}"), on the
theory that a bare word and a sentence are different kinds of string to CLIP and land in
different neighbourhoods. Measured: semantic-only stayed at exactly 0/16 and the operating
point was unchanged at 4/8/12. Kept for reproducibility; not the default.

Weighting a query's words by rarity at all — the whole premise of this section — turned
out, once correctly implemented, to be a wash against not weighting them. It is kept
anyway (see above) because it is free and it is correct, not because the benchmark asked
for it.

### Mean-centring: tried, measured, rejected

CLIP's text embeddings are anisotropic, so raw cosine partly measures a direction every
document shares rather than what distinguishes them. `--center` subtracts the corpus mean to
remove it. It made things **worse** across the board — semantic-only top-20 fell from 7/16 to
4/16, the best blend from 13/16 to 12/16, and the mean-of-words query collapsed completely
(never-found 16/16). The flag is kept because the measurement is worth being able to
reproduce, and it is not the default.

The collapse also exposed an error in this file's earlier reasoning. It claimed centring was
safe for the browser's mean-of-words trick "because centring is linear". It isn't: `quantise()`
L2-normalises each vector *after* centring, so every word vector is renormalised individually
and the mean of renormalised centred vectors is not the centred mean. The 16/16 never-found is
that mistake showing up as a number.

### What is verified by test rather than by measurement

- The Python pipeline end to end: 4,528 documents, 8,010-word vocabulary, int8 quantisation
  round-tripping at cosine 0.9986.
- The browser side, on a hand-built four-dimensional space where synonyms are placed
  deliberately close — proving that *if* the space puts "orb" near "spheroid" the beholder is
  found, and proving every degradation path (34 assertions).
- The page degrades to BM25-only with no index present, silently and correctly.

## Appearance, and the half of F10 that is missing

`src/appearance.js` builds a BM25 index over a synthesised description document per
monster — name, size, type, tags, the opening fluff, and the names of its traits and
actions. Trait names matter more than they look: "Web", "Pounce", "Death Burst" are things
a player *saw*, and they exist for every monster including the quarter with no fluff prose.

**F11 pulls size out of the prose before anything else is scored,** which is the highest-value
line in the feature. "About horse-sized" becomes Large and earns full tier 1 weight through
the ordinary size facet, while the rest of the sentence stays a capped bonus. The handoff says
"before you score it" and it is right for a reason that only shows up when you run it: leave
the phrase in and BM25 obligingly returns **Draft Horse and Riding Horse**, because the word
was doing duty as a unit of measurement rather than describing a horse. Stripping it moved
Yeti from 5th to 3rd on that query.

**F12 downweights colour to a fifth and upweights morphology and texture.** IDF already
handles "rare words matter"; what it cannot know is that some words are rare *and*
unreliable. Colour is the first thing a DM changes.

**The bonus is applied after F7 normalisation and never enters the denominator.** That is what
makes tier 3 actually safe: a description can only ever add. If it fed the denominator, every
monster that failed to match would be diluted by it — a penalty wearing a bonus's clothes, and
precisely the thing that would punish a correctly-identified but reflavoured monster.

### What it is worth, and two measurements that disagree for a good reason

The harness paraphrases a monster by sampling visual words out of its own fluff:
**64.3% → 74.3% top-5** on the same sample. That is a real gain and it is also an upper bound,
because the query uses the book's vocabulary.

`node eval/appearance.js` is the other measurement: sixteen hand-written queries in the words
somebody would actually use. **8/16 in the top 5, median rank 6, one never found.** Gelatinous
Cube, Manticore, Shambling Mound, Rust Monster and Death Dog land in the top three. Beholder
does not — the player says a floating *orb*, the Monster Manual says the body is *spheroid*,
and no amount of lexical matching bridges that.

That gap is the embedding half of F10, and it is **not built**. It needs a model, a Python
build step and a shipped vector index, and the honest position is that the lexical half was
worth building first and measuring before taking that on. `eval/appearance.js` exists so that
if embeddings are ever built, there is a number that has to move.

Two things were tried and reported rather than quietly dropped. Varying how much fluff to index
(1 to 10 paragraphs) changes almost nothing. And a `--synonyms` knob that swaps the book's word
for the player's ("spheroid" → "orb") fires in a third of queries and moves recall by nothing at
all: losing *one* word out of six barely dents BM25. The catastrophic case is a description
where *every* word is the player's own, which is exactly what the hand-written benchmark is.

## The legacy prior, and a bug it uncovered

Ties are settled by a prior on which monster a party is likelier to have fought, approximated from
release order. Best signal first: SRD / Basic Rules membership; then when the creature *first*
appeared across all its printings; then how often it has been reprinted; then which printing to
show, oldest first, because this tool targets 5e 2014 and the Monster Manual entry is the one a 2014
table will have open. Dates come from 5e.tools' `books.json` / `adventures.json` and are optional.

**Building it exposed a normalisation bug that had been quietly poisoning the signal.** A `_copy`
was inheriting its base's *publication metadata* along with its mechanics — so The Bagman, a `_copy`
of the Troll, arrived flagged as an SRD monster, and page numbers pointed into the wrong book.
**879 of the 1,141 copies claimed SRD membership they do not have**, and the SRD count fell from an
inflated 1,212 to 333 once fixed — which matches the real SRD. The first version of this tiebreak
was built on that corrupted flag, which is why it had been ranking "Scrag" and "The Bagman" above
"Troll".

Reprints are now also collapsed in the results: "Ghost (MM)" and "Ghost (XMM)" are one answer to a
player and were burning two of the twelve slots anyone actually reads. The surviving row is whichever
printing the prior prefers, and the others are listed beside it rather than hidden.

**What the harness can and cannot say about this.** It samples monsters uniformly, so a prior
favouring canonical monsters helps exactly as often as it hurts there, while real parties fight a
wildly non-uniform slice of the bestiary. The check it *can* run — that this does not make things
worse — was run, and top-5 went 65.8% → 67.4%. Treat that as "no harm done", not as validation.

## Constants, and what they rest on

`eval/run.js --sweep <name>` re-derives any of these. They are no longer guesses, but they are not
all equally well founded.

| Constant | Value | Basis |
|---|---|---|
| `missFactor` | 1.0 | Swept. Flat 0.8–1.3; 1.0 is the principled point in that range. |
| `maxWeight` | 8 | Swept, insensitive. |
| `damageCostFactor` | 0.1 | Swept — see the caveat below. |
| `minSymptomConfidence` | 0.5 | **The harness cannot test this.** See below. |
| `partialPenalty` | 0.9 | Not yet swept; affects 202 records. |
| `acWeight` / `hpWeight` | 3.2 | Swept. Minimax, not best-case — see below. |
| `NUMERIC.mode` | `raw` | Measured against three alternatives; see F5 above. |
| `appearanceCap` | 0.25 | Swept — and overruled, see below. |
| `nameWeight` | 9 | Swept, and agrees with the derivation. The best-founded constant here. |
| party prior | tiebreak | Measured as a score, rejected, demoted. See above. |

Two of these deserve their caveats stated rather than buried.

**`damageCostFactor` — the harness says 0 and it is being overruled to 0.1.** At every lie rate
tested, never penalising a damage contradiction scores best. That is a stronger claim than the
measurement supports: with one true answer in 4,528, a contradiction penalty lands mostly on the
true monster (which carries the planted lie) rather than spreading across the wrong ones. 0.1 keeps
F2's direction at a measured cost of ~0.5 points. If a better harness still says 0, the honest move
is to delete the penalty, not to keep a constant nothing supports.

**`minSymptomConfidence` — the harness structurally cannot measure it.** It reports that discounting
low-confidence symptoms only hurts. But it draws its symptom observations from each monster's own
tags, so every symptom it generates is true by construction — and the case the discount exists for,
where a loose regex attached a symptom the monster cannot actually produce, is exactly the case the
harness never generates. Set to 0.5, half strength, for ~0.7 points. This needs a test set of real
player reports, which does not exist yet.

**`appearanceCap` — the harness says 0.6 and it is being overruled to 0.25.** Recall climbs
as the appearance bonus is allowed to grow, but the harness's descriptions are drawn from the
book's own vocabulary, so appearance is unusually *reliable* there. On real paraphrase it hits
8 of 16, and a cap of 0.6 would let a bad prose match outrank a monster whose mechanics fit —
exactly what F3's tier 3 exists to prevent, and worst precisely when the DM has reflavoured.
0.25 keeps 74.0% of the available 75.3%.

**`acWeight` / `hpWeight` — chosen to be never much worse, not to win.** Recall keeps climbing as
the numbers are trusted more, up to about 6 nats, *provided the monster is at its book numbers*.
That gain reverses under rebuild: at ±8 CR, a weight of 6 scores 57.5% against 59.0% at 3.2. Since
"the DM adjusts numbers constantly" is the premise the entire tool rests on, the value that is
never much worse than the best beats the value that wins the easy case.

**A limit worth stating plainly.** Every observation the harness generates is derived from the
statblock it is trying to find, and the true answer is always in the corpus. It does not model
reflavouring, two monsters merged into one set of observations, or a monster the DM wrote from
scratch. The absolute numbers are an upper bound. What is trustworthy is the *ordering* between two
tunings, which is all a tuning harness is really for. `eval/corrupt.js` keeps the unmodelled list
next to the code that would have to model it.

## Legendary and lair actions — F3's fourth tier, handoff §7

> "Should legendary and lair actions be a separate trust tier? They are strong signals but
> GMs add and remove them freely."

Yes, and the tier is **asymmetric** rather than merely weaker — which is the part the
question does not anticipate. What one of these observations is worth depends entirely on
which direction it points:

- **As evidence FOR a candidate**, it is as good as any other symptom and keeps full credit.
  Legendary actions really are rare (454 of 4,528 monsters, 10.0%; a lair, 294, 6.5%), so a
  party that watched something act out of turn has genuinely narrowed the field.
- **As evidence AGAINST a candidate**, it is close to worthless. Promoting an ordinary
  monster to a boss is one of the commonest things a GM does, and the party's report is then
  true of the *fight* and false of the *statblock*. Charging the real answer full price for
  that is the failure the tier exists to prevent.

So `TUNING.volatileMissFactor` scales `missFactor` only, and only for symptoms the ontology
marks `volatile`. Credit is untouched.

**Which symptoms are volatile is a data question and stays in the data.** `ontology/symptoms.json`
grows a `volatile` flag, `src/symptoms.js` compiles the marked ids into a set, and the scorer
receives it as an option — `score.js` never learns an ontology id by name.

### Measuring it

Removal needed no new machinery and turns out to cost nothing: dropout already deletes
observations, and F2 charges nothing for a feature the party never mentioned. A DM who strips
legendary actions off a dragon is already free.

Addition is the untested half, so `eval/corrupt.js` gained `bossDriftRate` — pick a monster
with neither legendary actions nor a lair, and report the symptom anyway.

```
--boss-drift 0.15, n=400          top-1   top-5   top-20
  volatileMissFactor = 0          42.3%   66.0%   79.0%
  volatileMissFactor = 0.1        42.3%   66.0%   78.8%
  volatileMissFactor = 0.25       42.0%   66.0%   78.5%   <- current
  volatileMissFactor = 1  (off)   41.5%   65.0%   77.5%
```

The tier is worth about **+1.0 top-5 and +1.5 top-20** at a realistic drift rate, and the
direction is monotone at every rate tested (0, 0.15, 0.6).

### Why not 0, when the harness prefers it

At every drift rate the harness rates 0 best or joint-best, and 0.25 sits inside the noise
band (66.0% at 0, 0.1 and 0.25 alike). The constant is 0.25 anyway, for the same reason
`damageCostFactor` and `minSymptomConfidence` were overruled: **the control run is blind to
the case that argues for keeping a penalty.**

With `--boss-drift 0` the sweep is perfectly flat — identical to three decimals at every
value from 0 to 1. That is not evidence that the penalty is worthless; it is evidence the
harness cannot see it. When the party's report is honest, the penalty lands uniformly on the
~4,000 candidates lacking the feature, and a uniform shift barely reorders anything under F7
normalisation. The information it carries is real (a lair is a 6.5% feature) and shows up in
the honest case the harness structurally under-samples, because it draws symptoms from each
monster's own tags.

0.25 keeps a quarter of the penalty for no measurable cost. Setting 0 would assert that a
party reporting lair actions tells you *nothing* about a candidate with no lair, which is
false.

## The no-match confidence floor — handoff §7

> "How should the tool handle a monster the GM built from scratch, where the correct answer
> is 'no match'? A confidence floor is needed, and the threshold must come from the harness."

**What was there before.** The UI flagged "nothing explains this" only when the top candidate
scored at or below 1e-9 — the floor for matching *literally zero* features. A homebrew that
happens to breathe fire, fly and sit near CR 5 matches plenty by coincidence and sails past
that. Measured against simulated homebrew, the old check called **99.5% of them confident**.
It caught an almost-impossible case and missed the real one.

**How the threshold was derived.** `eval/nomatch.js` scores every sampled monster twice
against the same corrupted observations: once against the full corpus (the answer exists),
once against the corpus with that monster and all its reprints removed (the answer does not).
`TUNING.noMatchThreshold = 0.46` is the **5th percentile of the score a true answer's winner
achieves** — so ~95% of genuine matches stay above it. Stable across seeds: 0.4615, 0.4627,
0.4648, 0.4708, 0.4722.

**What was deliberately not used.** The same harness computes the cut that best *separates*
present from absent, and that number is rejected: it swings 0.58–0.63 across those same
seeds, and the separation it maximises is weak (Youden's J ≈ 0.15). The weakness is
structural, not a scoring fault — leave-one-out removes one monster but leaves its cousins,
and a Dire Wolf explaining a Wolf's observations is the tool working, not failing. Fitting a
threshold to that overlap would be fitting to an artifact of the experiment.

### What this feature is not

It is **not a homebrew detector**, and the numbers say so plainly: at 0.46 it correctly flags
only about **16%** of simulated homebrew. It cannot do better, because a homebrew assembled
from ordinary parts is genuinely well explained by the books — "construct, AC 20, 350 hp" is
the Runic Colossus whether or not your DM wrote it. The floor catches monsters that are
*unusual in combination*, and nothing else.

What it actually answers is the narrower question the data can settle: **"is this score
unusually low for a genuine match?"** When it fires, the cause could equally be a homebrewed
creature or a badly misremembered detail, and the tool cannot distinguish those — so the
wording it drives says both and claims neither.

The list is still shown when the floor fires. "Rank, never filter" applies here too: a party
facing a homebrew still wants to see what came closest. What changes is that the tool stops
presenting it as an identification, and the tab label stops asserting a name.

### Why three buckets and not a percentage

`confidence()` returns `none` / `low` / `ok`. Rendering "72% confident" from a separation this
weak would imply a precision the measurement does not have — the same discipline the legacy
and CR priors are held to elsewhere in this file.

## F13 — what to try next

After ranking, find the observation that would best split the leaders, and say so.
`src/discriminate.js` treats the leading candidates' scores as a distribution, partitions
them by what each possible test would reveal, and ranks tests by expected information gain.

**Only tests a party can actually perform.** This constraint does real work. "Does it have a
burrow speed" splits the field beautifully and is useless advice, because you cannot make a
monster burrow. You *can* hit it with radiant damage, try to frighten it, or watch to see
whether it heals — so the menu is damage types, condition immunities, and the symptoms the
ontology marks `testable`. That flag was added speculatively when the ontology was written;
this is what it was for.

The UI closes the loop in one tap: each suggestion carries its possible answers as buttons,
so the party hits the thing, taps "no effect", and the ranking updates.

**Measured** (`node eval/run.js --suggest`) by simulating the round: rank a corrupted query,
take the top suggestion, answer it from the true statblock, re-rank.

```
                          top-1    top-5   mean rank   tied at top
no extra test             39.3%    65.6%        9.7          3.0
+ arbitrary damage type   40.5%    66.0%        9.2          3.0
+ any useful test         40.1%    66.8%        9.5          2.9
+ F13's suggestion        42.1%    69.6%        9.0          2.7
```

Two things about that table are worth stating plainly. First, the control is not "nothing" —
any extra evidence helps, and proving that would prove nothing about F13. The comparison that
matters is against *any useful test*, a deliberately strong control that already knows which
tests carry information, which a player does not. F13 beats it on every column.

Second, **top-5 recall is the wrong headline for this feature** and reporting only it undersells
it. The true monster is usually already in the list; what F13 does is thin the crowd around it.
"Tied at top" is the number it exists to shrink, and it is the number the UI apologises for.

## Two fixes the UI forced

Neither is cosmetic, and neither would have surfaced without running the thing.

**Ties are the normal case, and the tiebreak was arbitrary.** Three or four observations routinely
leave twenty candidates on identical scores. The old tiebreak was alphabetical, so a query that
correctly identified a troll answered "Aquatic Troll, Blinded Troll, Dragonpriest…" with the actual
Troll sixteenth — off the bottom of the list. See "the legacy prior" below for what replaced it.

The UI also *says* when results are tied, rather than presenting a confident-looking order it has
not earned.

**Symptom lookup ranked common words above distinctive ones.** Typing "it felt me through the floor"
returned *it walked straight through a wall* first, because that symptom lists "it went through the
floor" among its alternate phrasings and plain token overlap counts "through" for as much as "felt".
Lookup now weights each word by how distinctive it is across the ontology's own phrasings (IDF), and
searches the symptom's id as well — the ids are written as sentences precisely so they can be read
aloud, and leaving them out lost matches where the id said it more plainly than the prose did.

## Open questions

### F5's residual — settled, and the answer is no

**Resolved: F5 is implemented, measured, and off.** Option 2, the one this document dismissed as
"abandons the property F5 exists for", wins. The reasoning that made option 3 look obvious was
wrong in a way that only showed up when someone did the algebra.

The question was: residuals need a CR, and the query has none, because the CR is most of what the
user is trying to find out. Option 3 was to infer the CR from the observed numbers, then compare
residuals at that implied CR. It does not work, and it cannot:

> Infer the CR from HP by inverting the CR→HP curve. Now take HP's residual at that CR. It is
> **zero**. Always, exactly, by construction — the inversion and the residual are the same
> operation run in opposite directions. The residual carries no information about HP at all.

The measurement agreed before the cause was found: residual mode scored 55.8% against 55.2% for
switching numbers off entirely, and 61.4% for comparing them raw. Two corrected formulations were
built and measured too:

- **hybrid** — HP raw, AC as a residual at the CR that HP implies. Ties raw (62.0% vs 61.5%).
- **joint** — fit one CR to *both* numbers by least squares, then take both residuals. Two
  observations against one free parameter cannot zero both, so information genuinely survives.
  This is the mathematically correct version of F5, and it *loses*: 59.3% against raw's 61.5%.

And the case F5 was designed for was tested directly, since §6's independent ±3 AC / ±30% HP jitter
does not model it. `--cr-shift N` relocates a monster N CRs up or down the power curve while
preserving its residuals — a DM rebuilding a monster for a different party. Raw still wins at every
rebuild severity:

```
                  no rebuild   ±2 CR   ±4 CR   ±6 CR
raw                     61.5    61.3    60.3    59.5
hybrid                  62.0    61.3    59.5    59.0
joint                   59.3    59.5    57.5    58.0
residual                55.8    54.8    54.8    55.0
off                     55.2    54.0    54.0    54.0
```

Why raw wins even under a coherent rebuild: the absolute power level is itself strong identifying
evidence, and the residual throws it away to buy robustness against a case that is rare and, when
it happens, only partially damaging. A monster rebuilt six CRs up is still a *big* monster, and raw
log-HP still ranks it near other big monsters. F6's toggle already covers the heavy-rebuild case,
and covers it better, because it is opt-in — the user knows whether their DM rebuilds statblocks
and the scorer does not.

`residual` and `joint` are kept as selectable modes (`--numeric`) rather than deleted, so the
finding stays reproducible and nobody re-derives option 3 from first principles in six months.
The self-cancelling property is pinned in `tests/numerics.test.js` as arithmetic rather than as a
benchmark result.

The CR curve itself stays and earns its keep elsewhere: `inferCr` answers "what CR did this fight
like", which is worth showing the user directly and is the natural input to F13's test suggestions.

### Others, carried from the handoff

- ~~A monster the DM built from scratch should rank as "no match".~~ **Built** — `eval/nomatch.js`
  generates exactly those queries by leave-one-out, and the threshold comes from them.
- **Two monsters, one merged set of observations.** Deliberately not built. Tabs already cover the
  case where the party KNOWS it fought two things, which is the common one; what is left is the
  party that has not realised, and the evidence then explains nothing well — which the no-match
  floor now says out loud. Judged too niche for the work it would take.
- The `by name` / `by key` gap in the harness output is the reprint rate, and it is small. If it
  grows, duplicate consolidation becomes a real feature rather than a reporting detail.
- **Reverse image search of a VTT token.** Measured, and the obvious approach does not scale.
  5e.tools ships official artwork for 2,747 monsters, so a purely local perceptual-hash match
  is possible with no external service. Simulating what a VTT token actually is — a circular
  crop of the art, resized small, recoloured, with a border ring — and matching it back by
  pHash:

  ```
  index size    top-1    top-5
          50      46%      72%
         100      43%      61%
         200      35%      60%
         478      28%      47%
  ```

  It degrades steadily with corpus size, and that is the BEST case: the token has to be cut
  from the official art. Most VTT tokens are third-party pack art or custom images, which are
  not near-duplicates of anything and which perceptual hashing cannot touch at all. A 64-bit
  hash simply does not have the capacity to separate 2,747 images under that much distortion.

  The version that would work is semantic rather than pixel matching — a CLIP image embedding
  compared against the artwork vectors. **That index now exists** (`build/embed.py --images`);
  what is still missing is the runtime image encoder, since a screenshot cannot be embedded
  from a shipped word vocabulary the way typed text can. Encoding one image in the browser is
  a far smaller problem than encoding the corpus, so this is now a bounded piece of work
  rather than an open question.

## Bounds from the dice, and why they beat memory

The first playtest transcript made the case better than any design note could:

> **Lamp:** we shoot with ebarb and rof — 16, 8, 13, which hit?
> **GM:** 16 hits. The rest miss.

The party does not know the Armour Class and never will. But they know exactly what
they rolled and exactly which rolls landed, and that pins AC to **(13, 16]** — no
estimating, no remembering, and nothing the GM can fudge after the fact.

`src/ranges.js` exists because the same shape shows up three times:

| Evidence | Bound |
|---|---|
| hit at 16, missed at 13 | AC ∈ (13, 16] |
| passed a save on 18, failed on 12 | DC ∈ (12, 18] |
| survived 40 damage, dropped at 55 | HP ∈ (40, 55] |

Successes give an **inclusive upper** bound, failures an **exclusive lower** one, every
time. One function, three uses, and the off-by-one that would otherwise be invisible is
pinned by tests at every boundary.

### It is measured, and it is worth a lot

`eval/corrupt.js --rolls` generates d20 totals around each monster's real AC and splits
them into hits and misses, which is what a table actually produces:

```
                     top-1    top-5   top-20
  remembered AC      41.0%    64.3%    81.7%
  rolled bounds      48.0%    68.7%    88.0%
```

**+7 points of top-1 and +6 of top-20.** The honest reading is not that intervals are
magically better than point estimates — it is that *dice do not lie and memory does*.
The remembered path carries `acShift` noise because players misremember; the rolled path
does not, because the table watched it happen. That asymmetry is real, not an artefact.

### Still not a filter

A monster outside the range is scored by how far outside it sits, never removed. The
bounds are only as good as the assumption that every roll was against the same target
with constant modifiers, and real tables break that constantly — bless, cover, a
different attacker's bonus, a total typed into the wrong box. "Rank, never filter"
applies here more than anywhere, because this is the most confident-looking evidence the
tool accepts.

Inside the range, every value scores identically. A range is **a hard region with a soft
outside**, not a tolerance curve with a flat top: there is no reason to prefer the middle
of an interval the dice permit to its edge.

### Contradictions are reported, never reconciled

A lower bound at or above the upper bound cannot happen for one target with constant
modifiers, so the tool was told something untrue. It says so, in red, naming both
numbers — and contributes *no* evidence rather than picking an end to trust. Guessing
which half to believe would be inventing evidence.

### The natural 20 problem, unsolved on purpose

A 20 always hits and a 1 always misses whatever the AC, so those rolls bound nothing —
but the user types a **total** and the die is not recoverable from it. Fixing this
properly means asking for the die and the modifier separately, which is more typing than
the evidence is worth mid-fight. The UI warns instead.

## What it did with its turn

The transcript shows what a GM narrates that the form could not previously accept:
*"he shoots two bolts of force at you"*, *"make a dex save"*. The first version took
three facets — `attackKind`, `saveAbility`, `attacksPerTurn` — all rolled up to the
monster. **That flattening was the bug**, and it took a second round of playtesting to
see it.

Rolled up to the monster, *"a melee attack that dealt fire damage"* matches any creature
with a melee attack and, somewhere else entirely, a fire breath weapon. That is most
dragons. The party did not see a creature with two properties; they saw **one action**
with both, and all the discriminating power of the observation is in the pairing.

So an observed attack or save is now a **row**, scored against a *single entry* on the
candidate and taking the best fit across them. The same query returns Azer, Magmin,
Salamander and Fire Elemental — creatures whose own melee attack burns — where the
flattened version returned Balor, Solar and Chimera.

### What a row asks, and what it is worth

Mostly numbers the party read off the table and previously had no way to say. Each field
is independent, blank costs nothing, and rarity comes from the same F1 table as
everything else wherever a facet exists for it.

| Attack row | Save row |
|---|---|
| how many it made | which save |
| what it rolled to hit | the DC |
| reach or range | the size of the area |
| damage — totals **or** `2d8+5` | damage, same two forms |
| damage type | damage type |
| what it left us with | what it left us with |

Measured in isolation, one attack row against all 4,528 monsters, each field earning its
place:

| Fields given | top-1 | top-5 | top-20 |
|---|---|---|---|
| kind only | 0.4% | 0.4% | 1.2% |
| + damage type | 1.2% | 4.0% | 10.0% |
| + damage amount | 2.4% | 8.8% | 21.2% |
| + reach | 8.4% | 20.0% | 32.8% |
| + attack rolls | 9.2% | 21.2% | 33.6% |
| + condition | 11.2% | 24.0% | 44.4% |

Kind alone is worth essentially nothing, which is the flattened version's epitaph: it
was three facets and the strongest of them was noise. Reach is the biggest single jump,
because "how far away was it" is both highly discriminating and something a party can
always answer.

In the full harness, `--combat 1` against the same control (n=300, seed 1):

| | top-1 | top-5 | top-20 |
|---|---|---|---|
| control | 36.0% | 64.0% | 81.3% |
| with a combat row | 46.3% | 73.0% | 86.0% |

**An upper bound**, and it matters why: the harness generates a row from one real entry
and thins it, so it models a party *forgetting* half of an action. It never models them
misattributing damage from one attack to another, which is the mistake the pairing is
most vulnerable to.

### The saves you rolled

The save row asks for the DC, and also for the saves the party made against it — because
those bound the DC without anyone having announced it. A passed save is an inclusive upper
bound and a failed one an exclusive lower bound, the same shape as `ranges.js` uses for AC,
save DCs and HP. It is the better of the two fields: a GM has to say a DC out loud for you
to know it, and nobody has to say anything for you to have rolled.

Scored **per row** rather than through `obs.dcRange`. A row is one action, and the claim
being made is that these saves were against *that action's* DC; the monster-level
`dcRange` still exists for a party who cannot say which action a save belonged to.

"Failed on 19" alone returns Kraken, Pit Fiend and Tarrasque — the DC-20-and-up creatures —
from one number nobody had to be told.

### Three faults behind one Treant

One rock thrown at 180 feet, and a Treant scored at 31% with the same observation argued
both for and against it. Three unrelated bugs, all visible in one line of output.

**A thrown weapon has two ranges and both are true.** `entryDistance` took the short one,
reasoning that a party in melee would report that — but *range 60/180 ft.* means the thing
can hit you at a hundred and eighty, and a party hit at a hundred and eighty says so. The
Treant's own Rock was a MISS against a rock it had just thrown.

**One attack is not a claim about the turn.** Row counts were summed into `attacksPerTurn`
and compared against Multiattack. The Treant's Multiattack reads *"two **slam** attacks"* —
melee, nothing to do with the rock — so reporting one thrown rock cost it 4.2 nats for
contradicting a routine it never performed. Multiattack nearly always names the attacks it
counts, so it describes a turn only when those are the attacks you saw. A total of one
can never be that routine, and is most often the fragment of the fight the party happened
to be on the end of. Two or more still counts.

**One row, one line.** A partial match pushed a hit *and* a miss carrying the same words,
so a single observation appeared under `+` and under `−` at once — the tool contradicting
itself about one thing the party saw. The arithmetic was always the net; the explanation
was not. It now lands once on the side of the net and names which field failed — *"the
closest is Slam, but fire damage, 40 damage, restrained doesn't fit"* — rather than
"doesn't match all of it", which left the reader to work out which part.

### The harness could not express the bug, which is why it survived

Worth recording as a lesson about the harness rather than the scorer. `--combat` generated
a row's distance as `e.reach`, or the first number of a two-part range — precisely the case
that already worked. It could not produce the observation that failed, so it reported
success while the feature was broken in the field.

It now picks either range, and against a harness that can finally fail:

| | top-1 | top-5 | top-20 |
|---|---|---|---|
| short range only | 50.3% | 77.7% | 89.3% |
| either range | **51.3%** | **79.3%** | **90.3%** |

The combat figure had also drifted up to ~51% from the 46.3% recorded when combat rows
landed, and it is tempting to bank that as this change's doing. It is not: that number
predates the stemmer and attack-markup fixes, and isolating this change against the old
harness moved nothing at all. The gain here is the point or so above.

### Two things deliberately not asked

**Number of targets.** The statblocks say "one target" for essentially every attack roll
in the game, so the field would be a box that never discriminates. Area effects do vary
and *"it caught three of us"* is answerable, so the area's size is taken instead.

**Attack rolls per turn, as its own question.** It is derived from the row counts.
Asking twice invites the two answers to disagree, and the rows already know: two claws
and a bite is three attack rolls. The derived total is echoed back, because a wrong
total here is what the playtest reported.

### The data this needed

`normalize.js` previously carried damage types only per monster, via 5e.tools'
`damageTags`. Matching a row needs them per entry, paired with the dice that dealt them.

| Per entry | Coverage |
|---|---|
| damage rolls parsed as dice | 99.5% of 8,998 |
| ...carrying a damage type | 98.0% |
| attacks with a damage type | 97.9% of 5,990 |
| saves naming a condition | 56.2% of 3,204 |
| `attacksPerTurn` from Multiattack | 96.8% of 2,721 |

The dice parse has an independent check available and it was worth taking: the statblock
prints its own average next to the expression, and the parsed dice agree with it **99.2%**
of the time.

### Multiattack, which needed three rules and not a looser pattern

`attacksPerTurn` used to read 65% of Multiattack entries, because the pattern allowed
exactly one word between the count and "attacks" — so "makes two **Manifested Force**
attacks" read as zero, and the Mind's Eye Matter Smith's real 2 was scored as a mismatch
against a party that counted 2.

Widening the gap alone made the tail worse. Multiattack prose is one sentence of
substance followed by qualifications, and the qualifications are full of numbers that are
not extra attacks:

> "makes three Rend attacks. **It can replace one attack** with a use of Spellcasting"
> "makes two Iron Fist attacks and two Stomping Foot attacks. **After one of the attacks**, the duergar can move"

Summing across those gave the Duergar Despot eight attacks. A sentence that replaces,
substitutes or offers an alternative restates; a count that refers back is anaphora, not
arithmetic. Both are dropped, then: a stated total with a colon wins outright, "or" means
alternatives so take the max, otherwise sum. The remaining 87 are genuinely uncountable —
*"equal to half this spell's level"*, *"as many bite attacks as it has heads"* — and
yield 0, which costs the monster no evidence rather than inventing a number that argues
against it.

## A name reaches further than it spells

"It's a ghost" gets said about Specters, Wraiths and Phantom Warriors. String distance
cannot follow that: they share no letters with *ghost*, and every trick that gets from
"ghost" to "ghast" gets no nearer "specter" than to "sceptre".

**This is not word embedding**, and the distinction is worth keeping straight, because
the obvious version was already tried and measured — CLIP's text encoder scores 0/16 on
retrieval over this corpus. What works instead is the corpus's own prose: find the
monster the name means, take the most distinctive words out of *its* description, and ask
which other monsters those words describe. No model, no build step, no shipped index.

| Typed | Reaches |
|---|---|
| ghost | Phantom Warrior, Specter, Ghost Dragon, Obzedat Ghost, Atropal, Wraith |
| beholder | Oculorb, Spectator, Gauth, Eyedrake, Gazer, Mindwitness |
| troll | Troll Limb, Ice Troll, Troll Mutate, Rot Troll, Spirit Troll, Dire Troll |

Restricted to the same creature type, which is the whole difference between useful and
embarrassing — unrestricted, *ghost* reached Animated Table and *owlbear* reached Oxen,
both on generic prose about size and habitat. Weighting in shared symptoms was tried and
made it **worse**: it swamps the prose with whichever obscure NPCs carry the same tag
set, and *ghost* came back Spirit, Agony, Amun Sa, Celeste.

### Shown, not scored — and why that is a measurement

Feeding kin into the ranking was built, wired into the harness and swept.

It needed a corruption model of its own first. `mishearRate` replaces the name with a
random creature, so no kin relationship to the truth exists by construction and the
feature measured exactly zero. `--kin-heard` names a **relative** instead — drawn by
creature type, deliberately *not* by the prose similarity the feature ranks on, so the
test is not marking its own homework.

In the scenario most favourable to it, every single query carrying a relative's name
rather than the creature's:

| `kinFactor` | top-1 | top-5 | top-20 |
|---|---|---|---|
| 0 | 40.4% | 62.4% | 78.4% |
| 0.25 | 40.0% | 63.2% | 79.2% |
| 1 | 40.0% | **64.0%** | 79.2% |

1.6 points of top-5 across the entire range, top-1 slightly *worse*, and nothing at all
at a realistic mishear rate. That is not enough to justify a silent score change and a
constant the harness cannot defend, so the scoring branch was deleted.

The names are offered instead. Putting them in front of someone who knows what they saw
costs nothing if they ignore it, and one click adopts the name — at which point it is
scored as an ordinary heard name, by the path that *is* measured. The harness flags
remain so the result can be re-tested rather than re-litigated.

## What the appearance box actually searches

The **description document**: the name, size, type and tags, every trait and action name,
up to four paragraphs of 5e.tools' Info text, and — since a playtester found it missing —
the statblock's own prose.

That last part was a real hole and worth recording. The document took trait and action
*names* and never their bodies, so a Night Hag's "Night Hag Items" was indexed and the
heartstone described inside it was not. Searching **heartstone** returned nothing at all,
though the Night Hag is one of three creatures in the corpus that has one. The most
distinctive noun a statblock owns is routinely in the body of a trait, never in its title.

### The stemmer was splitting singulars from their plurals

A playtester reported that *"white winged horse"* returned Draft Horse, Sea Horse and
Winged Bull above the Pegasus. Two plausible explanations were tested and both were
wrong. The actual bug was two lines of the stemmer, and it had been damaging every query
since the index was written:

```
stem("horse")  -> "horse"
stem("horses") -> "hors"
```

`horses` ends in `-ses`, so the rule meant for *glasses → glass* fired. `horse` has no
plural suffix to strip and stayed whole. Two tokens that can never be equal — so a query
for a winged **horse** could not match a Pegasus whose own book text calls it exactly
that. Every noun whose singular ends in a silent *e* split the same way: house, scale,
tentacle, snake, plate, carapace.

No better plural rule fixes it, because *glasses* is glass+es and *horses* is horse+s and
nothing in the spelling says which. Both forms are converged instead — strip the plural,
then strip a trailing *e* from what survives, guarded on length so *cone* does not become
*con*.

**Two wrong theories, recorded because they were reasonable.** A coverage term — reward
documents that explain more of the query, exactly what the symptom lookup does — pushed
the Pegasus *down*, 15 → 17 → 19 as the exponent rose. Lowering `K1`, so a word repeated
four times could not outvote three distinct ones, was worse: 9 → 18 → 26. Both are
written beside the constants they failed to justify.

### The weight is a trade, and it was measured

Statblock prose is several times longer than the visual description, and BM25 divides by
document length — at full weight a creature with fifteen actions looks like a poor match
for its own appearance. Against the 16 hand-written cases:

| `entryFactor` | top-1 | top-5 | top-20 |
|---|---|---|---|
| 0 | 4/16 | **8/16** | 10/16 |
| 0.5 | 4/16 | 7/16 | **11/16** |

(Both rows predate the stemmer fix. With it, and with `b` at 0.3, the benchmark stands at
**6/16 top-1, 9/16 top-5, 12/16 top-20, median rank 3** — against 4 / 8 / 10 and median 5
before either fix, and the Pegasus at rank 1 rather than 20.)

Bulette drops out of the top 5 (5 → 9); Owlbear (29 → 18) and Unicorn (20 → 12) come into
the top 20. Roughly a wash on the benchmark the index was built for, in exchange for a
class of query that previously returned nothing. 0.5, 0.75 and 1.0 measure identically,
so the setting takes the least dilution that achieves it.

### Kin needed its own index, and the test suite is what noticed

Folding entry text in broke the name-kinship feature, silently and badly: a Ghost's most
distinctive words became *Etherealness* and *Horrifying Visage*, its nearest neighbours
became whichever obscure NPCs had copied those traits, and "ghost" came back **Agony,
Amun Sa, Celeste** instead of Specter and Wraith. What makes a Specter read like a Ghost
is the lore and only the lore.

So kin builds a second index without entry text — lazily, because it costs about 270ms
and most sessions never type a name. Two features, two documents, for a reason each.

What still limits both is that the matching is lexical. *"Swamp-dwelling"* misses because
the books say *marsh* and *bog*. That is the vocabulary gap `eval/appearance.js` exists to
measure, and the one the CLIP experiment failed to close.

## Tabs, actually draggable

A round of playtest fixes made the fight grouping *visible* — boxed, labelled "Fight N" —
without giving it pmcrwf's actual mechanism for *setting* it. "pmcrwf-style tab-grouping
doesn't seem to work" was a fair description of what shipped: the only way to move a tab
between fights was still a dropdown several screens below the strip it affects.

Ported directly from pmcrwf's character tabs (`/workspace/pmcrwf/src/characters.js`, read
rather than reimplemented from memory):

- Drop on the **middle** of a tab — the two share a fight.
- Drop on an **edge** — reorder there instead.
- A fight moves as a **whole block**; dragging one member drags all of them, so a drag can
  never silently split a fight in two.
- Live feedback while the gesture is in progress — a ring for "group", an inset bar for
  "reorder", the dragged tab dimmed — because a drag with two possible outcomes and no
  feedback is a guess.
- A button (pmcrwf's ⛓) that peels one tab back out of a group. Ungrouping was never a
  drag gesture upstream either.

`groupIntoFight` and `reorderTab` both re-splice `S.tabs` afterwards so a fight stays
contiguous in the array, which is what lets `renderTabs` draw one as a single box by
walking the tabs in their own order and grouping contiguous runs — exactly how pmcrwf
keeps a character group contiguous on its own bar.

**Verified live before it was trusted**, which caught something worth recording: new tabs
all default into the *same* fight together, so dragging one straight onto another does
nothing at first — there is nothing to merge that is not already merged. Not a bug; the
test splits two tabs apart before exercising the merge, the only way to reach a second
fight from scratch.

One latent gap closed in passing: the dropdown's "+ a separate fight" path set a tab's
fight directly without ever re-splicing the array, so picking an *existing* fight from
that list (not just minting a new one) could have rendered as two boxes for what was
really one fight. It now runs through the same `keepFightContiguous` the drag path uses.

### Three more faults, and the test helper that hid them

The port was reported broken twice more, and all three remaining faults were real. Two
shared a single cause.

**Left-to-right with exactly two tabs.** An "after" drop computed its anchor as *the tab
following the drop target* — which, past the last tab, is nothing. A null anchor had no
target to compare fights against, so it took the branch that moves the whole fight; with
everything in one fight that was every tab, spliced back in at the end unchanged. The
report's own detail was the diagnosis: *"having 3+ tabs fixes this"* is exactly what you
would see, because with three the anchor is a real tab and the branch never runs.

**The gap between tabs.** A flex gap plus the group box's padding leaves a genuine band
of pixels where the cursor is over the container and over no tab at all. That resolved to
"no target" and fell into the same dead path — so the most natural place to aim when
dropping something *between* two tabs did nothing. A miss now resolves to the nearest tab
by edge distance and the side of it the cursor is on, and `dragover` uses the same
resolution so the marker always agrees with what releasing will do. Grouping is
deliberately unreachable from a gap: the gap means "put it here", a tab's middle means
"put it with this".

**Grouping.** Merging across fights already worked. The default did not: every tab starts
in one fight, so dragging one onto another is a legitimate no-op — and the box was drawn
only once a *second* fight existed, so the grouped default looked identical to no
grouping at all. Nothing happened and nothing explained why. The box now shows from the
first pair onward, which makes the no-op legible and puts the way out (the split button)
on screen at the same time.

**Why the suite missed all of it.** It used `page.dragAndDrop`, which papers over exactly
the two things these bugs lived in: where within a tab you release, and whether you are
over a tab at all. The tab tests now drive `mouse.down` / `mouse.move` / `mouse.up` at
measured offsets and cover each reported case — two tabs left-to-right, a drop into the
gap, a drop on the last tab's right edge, and grouping both within and across fights.
A convenience helper that cannot express a bug's precondition cannot test for it.

### The port carried a real bug, and "verify it live" is what caught it

"The live feedback works, but not the grouping and reordering" — the report was right,
and checking it against a real mouse drag (rather than trusting that the first live test
had covered it) found reordering genuinely broken, in the most common state there is: two
fresh tabs, still sharing the fight every tab starts in, dragged onto each other's edge.
Nothing moved.

The cause was the direct port of pmcrwf's `reorderCharacter`:

```js
const block = moved.group ? groupMembers(moved.group) : [moved];
```

pmcrwf's characters start **ungrouped**, so this line is almost always just the one
character — a group there is the rare, opt-in state. Every tab here starts in the **same
fight**, so the direct port moved the whole fight whenever mover and target shared one,
which is the common case, not the rare one. The block being moved then included the
target itself, `rest` (everything outside the block) no longer contained it,
`rest.findIndex` came back `-1`, and the block spliced back in exactly where it started —
a silent no-op on the first two tabs anyone would ever drag.

Grouping was unaffected — `groupIntoFight` already treats "already share a fight" as a
no-op on purpose — and neither was reordering *across* fights, which is exactly why the
first round of tests missed it: they only ever exercised reordering after first splitting
tabs into different fights. The fix moves only the single dragged tab when it and the
target already share a fight, and the whole fight only when they do not — which is the
one case the block-move exists to protect, a drag that would otherwise silently split a
fight in two.

### The box was in the DOM for three rounds and was never once drawn

A fourth report, and the shortest cause yet: the fight box was painted
`1px solid var(--border-hair)` — `#eee` — around tabs whose own borders are
`--btn-border`, `#999`, on a white page. A container a shade **lighter than its own
contents** is not a container anyone sees. The run of tabs read as a run of tabs, and the
only thing marking a fight was the 11px "Fight 1" caption beside it.

That is the same complaint the three rounds above each set out to fix, and each of them
diagnosed it correctly — the grouping is invisible, so a grouping you set looks exactly
like one you did not. Each then changed the *markup*: added the box, added the label,
then showed the box from the first pair rather than only once a second fight existed. The
element was present and correct from the first of those rounds. Nothing was drawing it.

pmcrwf paints the same box `1px dashed var(--link-border)`, and that one declaration is
why its groups read at a glance:

- **Dashed** distinguishes the box from the solid-bordered buttons inside it, instead of
  contributing a fourth solid rectangle to a pile of them.
- **The accent blue** is the one colour on the page that already means *a relationship*
  rather than *a frame* — it is what marks the active tab and the drag feedback.

Copied verbatim, along with `align-items: stretch` and pmcrwf's tighter padding: the box
now hugs the tabs rather than floating around them, and a box that hugs is read as
holding its contents.

One straight omission from the original port fixed alongside it: `.doxx-tab-x` had no
`:hover` rule, so the × that **deletes a tab** sat at 55% opacity permanently and was the
only control on the strip that never acknowledged the cursor. pmcrwf's
`.char-tab-x:hover` had it all along.

**Why the suite kept passing.** The existing assertions counted `.tab-group` elements and
the tabs inside each one — both of which the markup satisfied from round one, while the
box was invisible. The new assertion measures the border's **contrast against the page**,
because that is what "can you see it" actually means. The first draft of it compared the
border colour to the background for *inequality* and passed against the broken CSS, which
is the bug in miniature: `#eee` is not `#fff`, so a string comparison calls a hairline
visible. The check is a luminance ratio with the bar at 2:1 — not a legibility standard,
just the line between a border and a rumour. The shipped hairline sits at about 1.1; the
accent blue is above 7.

Both new assertions were confirmed to fail against the previous stylesheet before the fix
was kept. An assertion never seen red is not known to test anything.

## Where a score came from

The bar read 24% and nothing else, so two monsters tied at 24% looked identical when one
had earned it from a name and the other from three symptoms. The evidence lines below
name every feature, which is the opposite failure: complete and unreadable at a glance.

The bar is one band per module of the form now, coloured to a swatch on that module's
heading, and hovering gives the arithmetic. The bands are computed from the same numbers
the score is — each category's credit minus its penalties over the same F7 denominator —
so they sum to it exactly rather than approximately, and a test asserts that they do. A
facet belonging to no category falls into "other" rather than vanishing: a band that
silently dropped evidence would make the arithmetic lie.

## Naming the mechanic, when the GM said it out loud

The ontology's second idea is that the players never hear the mechanic's name, so every
sentence in it is deliberately vague: *"One specific spell had no effect whatsoever"* has
to cover Spell Immunity, an immunity to one named spell, and Antimagic Susceptibility,
because from the table those look identical.

Except when they don't. GMs narrate, and narration sometimes contains the actual word —
and a party that heard it knew something much more specific than the sentence could
express, with nowhere to put it.

So every mechanic under a symptom is its own button, in a select-all relationship with
the sentence above it. The invariant the rest of the code rests on is that a symptom is
**either** in `symptoms` (all of it) **or** has keys in `mechanics` (some of it), never
both — so the existing, measured symptom path is untouched whenever the parent button is
used, and the new one only engages when someone deliberately narrows.

The narrowing is worth having:

| Query | Top results |
|---|---|
| *"One specific spell had no effect"* | Helmed Horror, Snake Horror |
| ...narrowed to **Antimagic Susceptibility** | Flying Sword, Animated Armor, Rug of Smothering |
| *"It vanished"* | Imp, Quasit, Sprite |
| ...narrowed to **Incorporeal Movement** | Ghost, Wraith, Banshee, Specter |

F1 prices this without being told to. A mechanic is rarer than the symptom it rolls up
to, being one of several things that could have produced it, so `mechanic:incorporeal
movement` carries **4.04 nats** where `symptom:it-vanished` carries **1.82**. The
confidence discount carries over unchanged too: a mechanic scales by its own candidate's
`p`, exactly as a symptom scales by the best `p` among its candidates.

Two consequences fell out of the interaction and are worth naming, because both were
existing behaviour that had to go:

- **Selecting a symptom no longer removes it from the list**, and no longer clears the
  search box. The mechanics live on that row; a row that vanishes the moment you select
  it can never be narrowed. The chip strip is the summary, the list is the control.
- **A symptom with one candidate gets no sub-button.** It would be a control that could
  never disagree with its parent. It keeps the *name* in brackets, though, since naming
  the mechanic is what tells apart eleven sentences that read alike.

## What it cast, and how

Two facts about a caster, and **they age differently**. Which spells it has prepared is
the most-edited line on any statblock; a GM swapping fireball for lightning bolt has
changed Tuesday, not the monster. Whether it casts innately or from slots, off which
ability, from whose list, comes from what the creature *is*.

So spell names are priced as **volatile evidence** — full credit for a match, a quarter
penalty for a miss — reusing F3's fourth tier, the same asymmetry the legendary and lair
symptoms get. `castingKind`, `castingAbility` and `castingClass` are ordinary evidence at
full weight in both directions.

This is the rare case where the harness fully supports the design decision, and both
halves needed measuring — a discount that is lenient to wrong candidates could cost more
in the good case than it buys in the bad one:

| re-prep rate | volatile | full price | difference |
|---|---|---|---|
| 0 | 51.7 / 75.0 | 51.7 / 75.0 | **identical** |
| 0.6 | 41.7 / 70.0 | 39.7 / 69.0 | **+2.0 / +1.0** |

Free when the GM has not re-prepared, worth two points of top-1 when they have.

Extraction reaches 1,399 of the 1,401 casters and 398 distinct spells, with the rarity
spread F1 needs (*mage hand* 447, plenty of singletons). Classifying *how* it casts
needed two phrasings rather than one: older blocks say "can innately cast", newer ones
say "casts one of the following spells, requiring no material components", which is the
same claim in different words. Keying on "innate" alone dumped 668 blocks — the largest
group — into a catch-all bucket that meant nothing.

### A vocabulary that was wrong, and why

The spell suggestions were built from the loaded corpus alone, on the reasoning that
offering a spell no monster casts is offering a guaranteed dead end.

That reasoning is wrong, and this feature's own premise is what says so. Spell names are
priced as volatile *because GMs re-prepare casters constantly*. A GM who hands their
archmage Melf's Minute Meteors — which nothing in the bestiary casts — is not an edge
case, it is the case the module was built for, and the suggestion list refused to admit
the spell existed. Free text was always accepted; the list is what implied otherwise.

So the box reads `data/spells` when it is there (optional, like the fluff and the CLIP
index), falls back to the corpus when it is not, and takes anything typed either way. The
suggestions are a convenience and never a constraint.

Names are stored and matched lowercase, so one canonical key backs every spelling and
"Fire Bolt" cannot become a second chip beside "fire bolt". Only the display is
capitalised, and only when the real name is not already known — which is the only way to
get *Abi-Dalzim* and *Otiluke* right, since the bestiary writes every spell lowercase.

## Testing the UI

`src/app.js` is the largest file in the project and was, until `tests/ui.js`, the only one with
no assertions against it. Every UI defect found so far was found by a person driving the page by
hand — a tab label lagging one render behind the ranking it names, a `score` read before its
initialiser ran, a blend emitting zero-valued entries that made "lexical only" look like it had
found things it had not. None of those are visible by reading the code.

**It is opt-in, and the mechanism is the filename.** `tests/run.js` auto-discovers `*.test.js`;
this one is `ui.js`, so it is not picked up. That is deliberate: the Node suites run in
milliseconds and that is *why* they get run, per the decision at the top of this file. A browser
adds forty seconds and would change how often anyone reaches for them.

```sh
./doxx test        # 11 suites, 519 assertions, milliseconds
./doxx test-ui     # 35 assertions through a real browser
./doxx test-ui --headed --keep
```

**It skips rather than fails when Playwright is missing**, exiting 0 with the install line. The
project has no `package.json` and no runtime dependencies, and a missing optional dev tool is not
a broken build — the same "degrade, never fail" rule the app follows for a missing CLIP index.

Two things it is careful about, both learned by getting them wrong first:

- **Every assertion drives a real control.** Earlier drafts had `||` escape hatches that passed
  whether or not the thing under test existed, and a source-filter test that silently asserted
  against a full corpus. An assertion that cannot fail is worse than no assertion.
- **The filter re-renders on every change**, so a list of buttons collected up front goes stale
  and later clicks land on detached nodes. The suite re-queries between clicks. This is exactly
  the class of bug it exists to catch, and it caught it in the test first.

## What may be committed

`data/` is gitignored and no sourcebook content is in the repository. This constrains the prebuilt
index, and the constraint is easy to violate by accident:

- **Safe:** rarity weights, CR averages, symptom tags, quantised embedding vectors — all keyed by
  name + source. Derived numbers, not content.
- **Not safe:** a BM25 index over description documents. Those hold the fluff prose in substantially
  reconstructible form. Shipping one would put WotC's text in the repository by a side door.

So the index ships the numeric artefacts, and anything that needs prose — appearance matching,
displaying a statblock — reads it from the user's own `data/`. Ranking stays zero-setup, which is
the part that needs to be; display doesn't.

`ontology/symptoms.json` is ours and is committed. It contains no WotC prose: the regexes describe
*shapes* of rules text, and the player-facing phrasings are written from scratch.

Book and adventure *titles* for F16's filter come from 5e.tools' `books.json` / `adventures.json`,
read from the user's own `data/` at runtime and not committed. Both are optional: without them the
filter shows source codes instead of titles, which is worse but not broken. That is the right
failure — the tool should not refuse to rank monsters because it cannot pretty-print a book name.
