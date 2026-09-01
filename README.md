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
say what it looked like. Median rank 2. Describing one attack it made in any detail is worth
another **9 points of top-5**, and 10 of top-1 — the single most valuable thing you can add
after the symptoms themselves.

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

**Except when the players do hear the name.** Some GMs say "make a save against its Frightful
Presence" out loud, and some players have read the book — and a party that knows the name knows
something no sentence in the ontology can express. So the same box offers a second list: 170
named traits in [`src/traits.js`](src/traits.js), grouped by what they do, each with a one-line
description of the effect. The search reads the descriptions as well as the names, so "wounds
closed" finds Regeneration and "it grabbed me" finds Grappler — you never have to know the
jargon to use it. Naming traits takes top-5 from 66.0% to 73.5%.

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
match. Every result shows what argued for it and what argued against, and its score bar is split by where the score came from — hover it for the breakdown, and match the colours to the swatch on each part of the form.

**If the GM said the name.** Each sentence lists the mechanics it looks for, and each of
those is its own button. Picking the sentence means "any of these"; clicking a mechanic
off narrows it. Worth doing when you heard the word: *"One specific spell had no effect"*
returns the Helmed Horror, while *Antimagic Susceptibility* on its own returns the
animated objects.

**Opening a result** shows its stat block and, on a second tab, the book's own description
of it &mdash; with the monster's token beside it, if you have the images
(`python3 build/fetch_images.py --tokens`).

**How far it got in a turn** is a floor, not a target. Moving less than your speed is what
happens on nearly every turn, so anything faster fits just as well; only something too slow
to have crossed the ground is argued against.

**Books.** Click a source once to **include** it, again to **exclude** it, again to clear. Include
when you know which books your DM owns. Exclude to stop an adventure you're halfway through from
spoiling itself — which is why exclude exists separately rather than being &ldquo;include
everything else&rdquo;: nobody should have to click 106 books to hide one.

## How it fought

One row per thing it did. Each row is matched against a **single action** on the
statblock, which is the whole point: *"a melee attack that burned me"* finds creatures
whose claw deals fire, not every dragon that happens to own a breath weapon. Say how many
it made, what it rolled to hit, how far away it was, how much damage and of what type,
and what it left you with. Saves ask the ability, the size of the area, and — better than
either — **the saves you rolled**: one passed and one failed pins the DC between them, the
same trick the AC boxes use. Fill in what you remember and leave the rest blank.

Measured, one attack row on its own is worth **+10 points of top-1 recall** and finds the
monster in the top 20 nearly half the time from that alone. Reach turns out to be the
single most useful field &mdash; "how far away was it" is both highly discriminating and
something a party can always answer.

Attack rolls per turn is worked out from the rows rather than asked for separately, and
echoed back, so you can see what the tool concluded.

## If it cast anything

Name the spells you recognised — **any** spell, whether or not the box suggests it. Nothing
in the bestiary casts Melf's Minute Meteors, and that is exactly the point: a GM who
re-prepared a caster is who this module is for. These are held **loosely on purpose**: a GM re-preparing
a caster's spells is the most ordinary thing in the game, so a spell the statblock lacks
barely counts against it &mdash; the tool says so on the line rather than leaving you to
wonder. *How* it cast is a different matter. Innate, prepared or psionic, and off which
ability, comes from what the creature is rather than from what the GM felt like today, so
that is weighed in full.

## The numbers

**The dice are better evidence than anyone's memory**, so the Numbers box takes only them
&mdash; there is nowhere to type a remembered AC or hit-point total, because the rolls give
both without anyone having to estimate, and measure better. Type the attack totals that hit and the ones that missed, and the tool works out
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

Tell it your party's level and size, and which tabs are in the same fight — drag one tab onto
another to put them together, drag it to an edge to reorder, same as pmcrwf's character tabs —
and it works out the CR band a DM building that fight would be aiming at — one ogre is a very different
proposition from one of eight. It never changes a score and never rules anything out; it
only decides the order among monsters the evidence can't separate.

## If you caught a name

DMs narrate, and narration has nouns. If yours said "the barghest lunges at you", you have the
answer and may not know it. Put the name in the first box — spelling doesn't matter, you heard
it rather than read it, and *barghast* finds the Barghest just as well.

A name is treated as the strongest single thing you can say, but it is still evidence and not a
filter: your DM may have renamed the thing, or you may have caught the wrong word. Even when
half the names given are outright wrong, the tool still does better than with no name at all.

It also shows you **the creatures that name tends to mean**. GMs say "it's a ghost" about
Specters and Wraiths, and no amount of spelling gets you from one to the other — so the tool
reads the books instead, and offers the monsters whose descriptions read the same way. Click one
to adopt it. These are offered rather than scored, and DESIGN.md has the measurement that says
why.

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
node tests/run.js       # 12 suites, milliseconds
```

The browser suite is separate, because a browser costs forty seconds and the point of the Node
suites is that they cost nothing:

```sh
npm install --no-save playwright && npx playwright install chromium
./doxx test-ui          # 72 assertions, driving the real page
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
node eval/run.js --combat 1          # what one described attack is worth
node eval/run.js --spells 1 --reprep 0.6   # spells, and the GM re-prepping them
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
