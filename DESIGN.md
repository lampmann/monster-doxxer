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
| Appearance (F10–F12) | Not started. The last unbuilt feature. |

Current measurement, 500 sampled monsters against the full 4,528-record corpus:

```
                          top-1    top-5   top-20   median rank
handoff §6 corruption     41.0%    65.8%    83.2%       2
+ misremembering          38.2%    62.6%    79.8%       3
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

- A monster the DM built from scratch should rank as "no match". That needs a confidence floor, and
  the harness cannot set the threshold yet: it never generates a query whose answer is absent from
  the corpus. Generating those is a prerequisite for answering this.
- Legendary and lair actions: strong signals, but DMs add and remove them freely. Own trust tier?
- Two monsters, one merged set of observations.
- The `by name` / `by key` gap in the harness output is the reprint rate, and it is small. If it
  grows, duplicate consolidation becomes a real feature rather than a reporting detail.
- Ties are frequent enough that F13 (suggest the test that best splits the leaders) is now the
  obvious next feature rather than a nice-to-have: the UI can already tell you it is stuck, and the
  ontology already marks which symptoms a party can provoke in one round (`testable`).

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
