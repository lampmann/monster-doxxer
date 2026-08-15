# Monster Doxxer

You fought something. You don't know what it was. You know roughly how hard it was to hit, what
bounced off it, how it moved, and that it did *something* the DM described but wouldn't name.

Monster Doxxer takes those observations and ranks the D&D 5e (2014) bestiary by how well each
monster explains them.

**Status: early. The normalisation pipeline and the evidence scorer exist and are tested. There is
no UI yet, no symptom ontology yet, and the scoring constants are provisional guesses that nothing
has validated.** See [DESIGN.md](DESIGN.md) for what's built and what isn't.

## The one idea

**Rank, never filter.**

There is no `WHERE ac = 15` anywhere in this codebase. A single hard constraint throws away the
right answer the moment the DM adjusts one number, and DMs adjust numbers constantly — they
reflavour the description, they buff the HP, they hide the signature mechanic to protect the
surprise. Every input here is soft evidence with a tolerance, and the output is a ranking over the
whole bestiary with its reasoning shown.

## Running the tests

No dependencies, no install:

```sh
node tests/run.js
```

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
