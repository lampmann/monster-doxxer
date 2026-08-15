# Monster Doxxer

You fought something. You don't know what it was. You know roughly how hard it was to hit, what
bounced off it, how it moved, and that it did *something* the DM described but wouldn't name.

Monster Doxxer takes those observations and ranks the D&D 5e (2014) bestiary by how well each
monster explains them.

**Status: early, but it works and the numbers are measured.** The normalisation pipeline, the
evidence scorer and the symptom ontology exist and are tested, and there is an evaluation harness
that picks the scoring constants instead of leaving them to taste. There is no UI yet, no
appearance matching, and no numeric scoring. See [DESIGN.md](DESIGN.md) for what's built and what
isn't.

Against the full 4,528-monster corpus, given the observations a party would plausibly have after
one fight: **the right monster is in the top 5 about 65% of the time**, with a median rank of 2.

## The one idea

**Rank, never filter.**

There is no `WHERE ac = 15` anywhere in this codebase. A single hard constraint throws away the
right answer the moment the DM adjusts one number, and DMs adjust numbers constantly — they
reflavour the description, they buff the HP, they hide the signature mechanic to protect the
surprise. Every input here is soft evidence with a tolerance, and the output is a ranking over the
whole bestiary with its reasoning shown.

## The other idea

**The players never hear the mechanic's name.** They see the wounds close; nobody says
"Regeneration". So the bestiary is indexed by *observable consequence* — 111 hand-written symptoms
in [`ontology/symptoms.json`](ontology/symptoms.json), each mapping to the set of mechanics that
could have produced it, with a likelihood on every edge because an observation almost never has
one cause.

That file is the single most valuable thing in the project, and it is not a close call. Ablation
says removing it costs 24 points of top-5 recall; the next facet down costs 6.

## Running the tests

No dependencies, no install:

```sh
node tests/run.js
```

## Measuring it

Point `data/` at a bestiary (see [data/README.md](data/README.md)), then corrupt real statblocks
and see how often the ranker still finds them:

```sh
node eval/run.js                     # top-1 / top-5 / top-20 recall
node eval/run.js --ablate            # what each kind of evidence is worth
node eval/run.js --sweep missFactor  # re-derive a scoring constant
node eval/run.js --show 10           # the worst failures, with reasons
node eval/run.js --cr-shift 4        # what if the DM rebuilt it four CRs up?
node eval/coverage.js                # how the symptom ontology lands on real prose
```

The constants in `src/score.js` came out of this and should keep coming out of it. Tuning them by
intuition is how you get a tool that feels right and is wrong.

## Data

Nothing from 5e.tools is committed to this repository — `data/` is gitignored. See
[data/README.md](data/README.md) for what to put there.

This is the same rule the sibling project [pmcrwf](https://github.com/lampmann/pmcrwf) follows, and
it is load-bearing rather than decorative: the code here ships mechanics, never sourcebook content.
It has a real consequence for the planned prebuilt index — see DESIGN.md, "What may be committed".

## Credit

The normalisation pipeline in `src/normalize.js` is lifted from pmcrwf's `src/monster-library.js`,
where it had already been beaten into shape against the real bestiary. It encodes a lot of quiet
knowledge about the awkward shapes 5e.tools' JSON takes; re-deriving it would have meant
rediscovering the same bugs.
