# Monster Doxxer

You fought something. You don't know what it was. You know roughly how hard it was to hit, what
bounced off it, how it moved, and that it did *something* the DM described but wouldn't name.

Monster Doxxer takes those observations and ranks the D&D 5e (2014) bestiary by how well each
monster explains them.

**Status: early, but usable, and the numbers are measured.** The normalisation pipeline, the
evidence scorer, the symptom ontology and the browser UI all exist and are tested, and an
evaluation harness picks the scoring constants instead of leaving them to taste. **Every feature
in the original design is built**, along with two of the three questions its author left open. See
[DESIGN.md](DESIGN.md) for what's built, what was measured and rejected, and what the numbers
rest on.

Against the full 4,528-monster corpus, given the observations a party would plausibly have after
one fight: **the right monster is in the top 5 about 67% of the time**, and 73% if they can also
say what it looked like. Median rank 2.

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

## Using it

The page has to be *served*, not opened as a file — it reads the bestiary out of `data/`, and
browsers block that over `file://`. The launcher does it in one word:

```sh
./doxx          # start the server (or reuse one) and open the tool
./doxx stop     # stop it
./doxx test     # run the tests (milliseconds)
./doxx test-ui  # drive the real page in a browser (needs Playwright)
```

**On Windows**, `doxx` is a POSIX shell script and won't run in `cmd`. Use `doxxer.cmd`
instead — same behaviour, and it works from any directory once its folder is on `PATH`:

```bat
doxxer          :: start the server (or reuse one) and open the tool
doxxer stop     :: stop it
doxxer phone    :: print the address to open on your phone, same Wi-Fi
doxxer test     :: run the test suite
```

To make `doxxer` work from anywhere, add the repo folder to your user `PATH` once:

```powershell
[Environment]::SetEnvironmentVariable(
  "Path", [Environment]::GetEnvironmentVariable("Path", "User") + ";C:\path\to\Monster-Doxxer", "User")
```

Then open a **new** terminal — `PATH` is read at startup, so the window you ran that in
won't see it.

Failing all of that, any static server over this folder does the same job:
`python -m http.server 8932`, then open <http://localhost:8932/index.html>.

Then describe what you saw. The form is ordered by how much each kind of evidence is actually
worth, so the first box — *what did it do?* — is the one that matters. Type what you'd say at the
table (&ldquo;it healed between rounds&rdquo;, &ldquo;my sword bounced off&rdquo;) and pick the
match. Every result shows what argued for it and what argued against.

**Books.** Click a source once to **include** it, again to **exclude** it, again to clear. Include
when you know which books your DM owns. Exclude to stop an adventure you're halfway through from
spoiling itself — which is why exclude exists separately rather than being &ldquo;include
everything else&rdquo;: nobody should have to click 106 books to hide one.

**The dice are better evidence than anyone's memory**, so the Numbers box takes them
directly. Type the attack totals that hit and the ones that missed, and the tool works out
the Armour Class exactly:

> *"16, 8, 13, which hit?"* — *"16 hits, the rest miss."* → **AC is between 14 and 16.**

The same two boxes appear for save DCs (saves you passed and failed) and hit points
(damage it survived, damage that dropped it). Measured, this is worth **+7 points of top-1
recall** over a remembered number — not because ranges are clever, but because dice don't
lie and memory does.

It never becomes a filter. A monster outside the range is scored by how far outside, not
removed: someone had bless up, the GM applied cover, a total went in the wrong box. And if
the bounds contradict each other, the tool says so in red rather than quietly picking a
half to believe.

Observations persist across a reload, so you can keep adding to them as the fight goes on.

## Several monsters at once

There is a tab per monster, because you are usually working out what two or three things
were. Click the active tab to give it a name — VTTs hand out names like "Ogre B", and that
is more use than whatever the tool currently guesses. Each tab keeps its own evidence;
mixing two monsters' observations together is the one mistake no amount of ranking recovers
from.

Tell it your party's level and size, and which tabs are in the same fight, and it works out
the CR band a DM building that fight would be aiming at — one ogre is a very different
proposition from one of eight. It never changes a score and never rules anything out; it
only decides the order among monsters the evidence can't separate.

## If you caught a name

DMs narrate, and narration has nouns. If yours said "the barghest lunges at you", you have the
answer and may not know it. Put the name in the first box — spelling doesn't matter, you heard
it rather than read it, and *barghast* finds the Barghest just as well.

A name is treated as the strongest single thing you can say, but it is still evidence and not a
filter: your DM may have renamed the thing, or you may have caught the wrong word. Even when
half the names given are outright wrong, the tool still does better than with no name at all.

## Describing it

Type what it looked like in your own words. Two things happen:

- Size gets pulled out and used properly — "about horse-sized" becomes Large, which is a
  structural fact and counts for full weight. The tool tells you it did that, and you can
  override it.
- The rest is matched against the books' descriptions as a **capped bonus that can never
  count against a monster**. If your DM repainted the thing purple, saying so must not push
  the real answer down the list.

Distinctive nouns work best out of the box — *carapace*, *tentacles*, *eyestalks* — because
the default matching is lexical: it matches words, and the Monster Manual says a beholder is
"spheroid" where you'd say "a floating orb". `node eval/appearance.js` measures exactly that gap.

To narrow it, build the CLIP index once:

```sh
pip install open_clip_torch pillow
python3 build/fetch_images.py        # the official artwork, ~2700 files, resumable
python3 build/embed.py --images      # embeds the descriptions AND the artwork
node eval/appearance.js --sweep      # the table that decides whether it helped
```

**Measured, on the full bestiary with artwork: +2 of 16 at top-20 (10 → 12), and nothing at
top-1 or top-5.** That's a rerank of what BM25 already found, not retrieval — on its own
the embedding half scores 0/16, no matter how the query's words are weighted before
averaging. DESIGN.md has the full table, including a bug that briefly made the number
look better than this, and why the honest figure is smaller.

Everything works without the index; you just keep the lexical half only.

## What to try next

Three or four observations usually leave a dozen monsters that explain them equally well. When that
happens the tool says so, and then tells you the cheapest question that would tell them apart:

> **Hit it with poison damage** — Wraith, Wight and 4 others shrug it off entirely; Vampire,
> Vampire Spawn and 4 others take it normally.

Tap what happened and the list updates. It only ever suggests things you can actually do in a round
— hit it with something, try to frighten it, watch for a specific tell. Measured against a control
that already knows which tests carry information, following the advice is worth about 3 points of
top-5 recall and visibly shrinks the tie.

## Running the tests

No dependencies, no install:

```sh
node tests/run.js       # 11 suites, 519 assertions, milliseconds
```

The browser suite is separate, because a browser costs forty seconds and the point of the Node
suites is that they cost nothing:

```sh
npm install --no-save playwright && npx playwright install chromium
./doxx test-ui          # 35 assertions, driving the real page
```

It skips rather than fails if Playwright isn't there — it is a testing tool, not a dependency of
the thing being tested.

## Measuring it

Point `data/` at a bestiary (see [data/README.md](data/README.md)), then corrupt real statblocks
and see how often the ranker still finds them:

```sh
node eval/run.js                     # top-1 / top-5 / top-20 recall
node eval/run.js --ablate            # what each kind of evidence is worth
node eval/run.js --sweep missFactor  # re-derive a scoring constant
node eval/run.js --show 10           # the worst failures, with reasons
node eval/run.js --cr-shift 4        # what if the DM rebuilt it four CRs up?
node eval/run.js --suggest           # does F13's advice actually beat guessing?
node eval/run.js --heard 1           # what a name the party caught is worth
node eval/appearance.js              # 16 hand-written descriptions, known answers
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
