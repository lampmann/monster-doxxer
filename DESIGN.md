# Design

This records what's built, the decisions taken so far and why, and the open questions that need
answering before the next pieces are worth writing. The original handoff document is the spec;
this file is where it meets reality and where it has been deviated from.

## Status

| | |
|---|---|
| `src/normalize.js` | Built, 70 assertions. Ported from pmcrwf. |
| `src/score.js` | F1, F2, F3, F7 built, 37 assertions. Constants unvalidated. |
| Symptom ontology (F8) | Not started. The highest-value asset in the project. |
| Numerics (F4, F5, F6) | Not started — has an open question, below. |
| Appearance (F10–F12) | Not started. |
| Discriminating tests (F13) | Not started. |
| UI, session evidence (F15) | Not started. |
| Evaluation harness (§6) | Not started. **Blocks trusting anything above.** |

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
whatever bestiary you point it at — all linear passes over ~3,000 records, comfortably under a
second — and *upgrades* to the prebuilt index when one is present. Degrades to bring-your-own-data,
upgrades to zero-install. No path is blocked.

**Ranking never filters, except by source.** F16's source filter is the single legitimate exception
and it's implemented as one, in `rank()`. Every other input is evidence.

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

(3) is almost certainly right and is what the code should do, but it needs the evaluation harness to
confirm it beats (2) — it's more machinery, and more machinery that isn't earning its keep is worse
than less. **Not implementing numerics until the harness exists.**

### Others, carried from the handoff

- A monster the DM built from scratch should rank as "no match". That needs a confidence floor, and
  the threshold has to come from the harness, not from taste.
- Legendary and lair actions: strong signals, but DMs add and remove them freely. Own trust tier?
- Two monsters, one merged set of observations.

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

## Constants

Every number in `score.js`'s `TUNING`, and the whole damage cost matrix, is a provisional guess with
the right *shape* and no validated magnitude. The tests deliberately assert relationships ("rarer
evidence outranks commoner evidence", "a contradiction costs more than a near miss") rather than
values, so the harness can move the numbers without rewriting the suite.

Do not tune these by intuition. The handoff is right that the honest method is to corrupt real
statblocks — delete 60% of fields, shift AC ±3, shift HP ±30%, swap a resistance, paraphrase the
description — and measure top-5 recall.
