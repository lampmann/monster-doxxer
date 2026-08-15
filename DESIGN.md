# Design

This records what's built, the decisions taken so far and why, and the open questions that need
answering before the next pieces are worth writing. The original handoff document is the spec;
this file is where it meets reality and where it has been deviated from.

## Status

| | |
|---|---|
| `src/normalize.js` | Built, 73 assertions. Ported from pmcrwf. |
| `src/score.js` | F1, F2, F3, F7 built, 37 assertions. Constants now measured, not guessed. |
| `ontology/symptoms.json` + `src/symptoms.js` | F8 built, 111 symptoms, 38 assertions. |
| `eval/` | §6 harness built, 29 assertions. **Everything above is measurable now.** |
| Numerics (F4, F5, F6) | Not started — has an open question, below. |
| Appearance (F10–F12) | Not started. |
| Discriminating tests (F13) | Not started. |
| UI, session evidence (F15) | Not started. |

Current measurement, 400 sampled monsters against the full 4,528-record corpus:

```
                          top-1    top-5   top-20   median rank
handoff §6 corruption     35.5%    57.5%    76.5%       3
+ misremembering          32.5%    56.0%    69.8%       4
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

**A limit worth stating plainly.** Every observation the harness generates is derived from the
statblock it is trying to find, and the true answer is always in the corpus. It does not model
reflavouring, two monsters merged into one set of observations, or a monster the DM wrote from
scratch. The absolute numbers are an upper bound. What is trustworthy is the *ordering* between two
tunings, which is all a tuning harness is really for. `eval/corrupt.js` keeps the unmodelled list
next to the code that would have to model it.

## Open questions

### F5's residual is underspecified, and it matters

The handoff says: store numeric features as residuals from the CR average, because homebrew tuning
shifts the whole power scale but leaves the shape intact. Store `AC − expected AC at this CR`.

That works for indexing the corpus. It does not obviously work for the *query*, because the user
does not know the CR — that's most of what they're trying to find out. There is no CR to take a
residual from.

Three ways out:

1. **Ask for an estimate.** Party level plus "how hard was it" gives a usable CR band. Cheap, but
   leans on a judgement players are bad at.
2. **Compare raw values with a wide tolerance.** Simple, and abandons the property F5 exists for.
3. **Infer the CR from the numbers themselves.** Invert the corpus CR→mean-AC and CR→mean-HP tables
   to get an implied CR from what was observed, then compare each candidate's residual against the
   observation's residual at that implied CR. This is the only option that actually survives "the
   DM rebuilt it three CRs higher", because both sides get normalised to their own scale.

(3) is almost certainly right. The harness now exists to settle it, and it already carries the
corrupted `ac` and `hp` on every generated observation, waiting for a scorer to read them.

### Others, carried from the handoff

- A monster the DM built from scratch should rank as "no match". That needs a confidence floor, and
  the harness cannot set the threshold yet: it never generates a query whose answer is absent from
  the corpus. Generating those is a prerequisite for answering this.
- Legendary and lair actions: strong signals, but DMs add and remove them freely. Own trust tier?
- Two monsters, one merged set of observations.
- The `by name` / `by key` gap in the harness output is the reprint rate, and it is small. If it
  grows, duplicate consolidation becomes a real feature rather than a reporting detail.

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
