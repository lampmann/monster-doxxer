# index/

Build artefacts from `build/embed.py` — the CLIP embedding index that powers the
semantic half of appearance matching (F9, F10).

Nothing here is required. Without it the tool ranks on BM25 alone, exactly as it did
before, and `eval/appearance.js` says so. With it, the same benchmark grows three
extra rows comparing lexical, semantic and blended scoring.

```
pip install open_clip_torch pillow
python3 build/embed.py              # text only
python3 build/embed.py --images     # also embed the official artwork
node eval/appearance.js --sweep     # did it actually help?
```

Files:

    appearance.json        manifest — model, dimensions, monster keys, query vocabulary
    appearance-mon.i8      one int8 vector per monster
    appearance-vocab.i8    one int8 vector per vocabulary word

## Why it isn't committed here

DESIGN.md's rule is that derived numbers are safe to commit and source text is not, and
these vectors are derived numbers — they cannot be read back as WotC's prose, unlike a
BM25 index over the same documents. So committing one is *permitted*.

It is left out anyway because an index is large (a few MB), specific to the model and
image pack that built it, and cheap to rebuild. If you want to host the tool on GitHub
Pages with the semantic half working for visitors who have no data of their own, add
yours deliberately with `git add -f index/`.
