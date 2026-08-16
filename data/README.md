# data/

Everything in this directory except this file is gitignored. Nothing from 5e.tools is committed to
this repository.

To run the tool against a real bestiary, put 5e.tools' data here:

```
data/
  bestiary/
    index.json
    bestiary-mm.json
    bestiary-vgm.json
    ...
    fluff-index.json         (optional — the manifest for the fluff files)
    fluff-bestiary-mm.json   (optional — appearance matching only)
    ...
  books.json                 (optional — book titles in the source filter)
  adventures.json            (optional — adventure titles, and the spoiler grouping)
```

Copy 5e.tools' `bestiary/` folder across whole and you are done: the fluff files ship inside it,
next to the statblocks. A separate `data/fluff-bestiary/` is also read, for anyone who already
split them out that way, but there is no reason to do so.

**Check the count.** Every entry point prints how many monsters it found prose for —
`4528 monsters ... 3367 described`. If that second number is **0**, the fluff files are missing or
somewhere else, and appearance matching is running on nothing but names and action titles. It will
not error; it will just score badly, which is much harder to notice.

`books.json` and `adventures.json` sit at the top of 5e.tools' `data/` folder. They are only used to
label F16's source filter: without them it still works and shows source codes (`MM`, `CoS`) instead
of titles, and loses the Books / Adventures split that makes "hide the adventure I'm playing" one
click.

`bestiary/index.json` is 5e.tools' own manifest mapping source codes to filenames; the loader reads
it to discover what you have rather than guessing at filenames.

## Why it isn't bundled

Statblock text and fluff prose are WotC's. The unit tests in `tests/` therefore run on synthetic
fixtures written by hand, not on real monsters — which is a limitation worth naming: they prove the
pipeline handles the *shapes* 5e.tools uses, and they prove the scorer's maths, but they cannot
prove the rarity weights are sensible against the real distribution. That takes the evaluation
harness and your own copy of the data.
