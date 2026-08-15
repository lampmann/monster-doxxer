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
  fluff-bestiary/          (optional — appearance matching only)
    fluff-bestiary-mm.json
    ...
```

`bestiary/index.json` is 5e.tools' own manifest mapping source codes to filenames; the loader reads
it to discover what you have rather than guessing at filenames.

## Why it isn't bundled

Statblock text and fluff prose are WotC's. The unit tests in `tests/` therefore run on synthetic
fixtures written by hand, not on real monsters — which is a limitation worth naming: they prove the
pipeline handles the *shapes* 5e.tools uses, and they prove the scorer's maths, but they cannot
prove the rarity weights are sensible against the real distribution. That takes the evaluation
harness and your own copy of the data.
