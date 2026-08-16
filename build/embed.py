#!/usr/bin/env python3
"""Build the CLIP embedding index — F9 and the second half of F10.

    pip install open_clip_torch pillow
    python3 build/embed.py                       # text only, no artwork needed
    python3 build/embed.py --images              # also embed the official artwork
    python3 build/embed.py --queries q.txt       # encode arbitrary sentences, for eval

WHY A BUILD STEP AT ALL. Everything else in this project computes itself in the
browser in under a second. Embeddings cannot: the model is hundreds of megabytes
and the corpus is thousands of documents. So this runs once, offline, and emits a
small quantised index that the page fetches — which is the architecture the
handoff specified from the start, and the only part of it that actually needed to
be a build step.

WHY CLIP RATHER THAN A TEXT MODEL. Because the picture is often the better
document. The Monster Manual's opening paragraphs are frequently about ecology and
attitude, not shape — the beholder's entry talks about its arrogance before it
mentions eyestalks — while the artwork is unambiguously what the thing looked
like, which is what the player is describing. CLIP puts both in one space, so a
typed description can match either. It also means the same index can answer a VTT
token screenshot later, which perceptual hashing could not (see DESIGN.md).

WHAT IT WRITES, all into index/:

    appearance.json        manifest: model, dim, monster keys, query vocabulary
    appearance-mon.i8      one int8 vector per monster, L2-normalised, row-major
    appearance-vocab.i8    one int8 vector per vocabulary word

Vectors are normalised before quantising, so a single scale of 127 covers every
component and a dot product of the raw bytes is proportional to cosine.

ON WHAT MAY BE COMMITTED. DESIGN.md's rule: derived numbers are safe, source text
is not. These vectors are derived numbers keyed by name and source — they cannot
be read back as WotC's prose — so the index is committable, unlike a BM25 index
over the same documents. The artwork itself is never copied anywhere; only the
vectors leave this script.
"""
import argparse
import json
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(ROOT, "data")
OUT = os.path.join(ROOT, "index")

# Matches src/embeddings.js. Change one, change both.
SCALE = 127


# ---------------------------------------------------------------- corpus

def read_json(path):
    with open(path, encoding="utf8") as fh:
        return json.load(fh)


def load_bestiary():
    """Every monster, as {key, name, source, doc}. The description document is built
    the same way src/appearance.js builds it — name, size, type, trait and action
    names, then the opening fluff — so the lexical and semantic halves are indexing
    the same thing and their scores stay comparable."""
    idx_path = os.path.join(DATA, "bestiary", "index.json")
    if not os.path.exists(idx_path):
        sys.exit("No data/bestiary/index.json. See data/README.md — nothing from the "
                 "books is bundled with this tool, on purpose.")

    monsters = []
    for fname in read_json(idx_path).values():
        path = os.path.join(DATA, "bestiary", fname)
        if not os.path.exists(path):
            continue
        for m in read_json(path).get("monster", []):
            if m.get("name"):
                monsters.append(m)

    fluff = load_fluff()
    out = []
    for m in monsters:
        key = "%s|%s" % (m["name"], m.get("source", ""))
        out.append({
            "key": key,
            "name": m["name"],
            "source": m.get("source", ""),
            "doc": describe(m, fluff.get(key.lower(), "")),
            "prose": bool(fluff.get(key.lower(), "")),
        })

    # SAY THIS OUT LOUD. The prose is most of what CLIP has to work with: without it a
    # document is a name, a size, a type and a list of action titles, and the paraphrase
    # benchmark measures a missing directory rather than a model. Building anyway is the
    # right call — the index is still usable — but building QUIETLY is not.
    described = sum(1 for d in out if d["prose"])
    print("%d of %d monsters have descriptive prose" % (described, len(out)))
    if described < len(out) // 4:
        sys.stderr.write(
            "\n  WARNING: almost nothing here is described.\n"
            "  Expected data/bestiary/fluff-bestiary-*.json (where 5e.tools ships them)\n"
            "  or data/fluff-bestiary/*.json. Without those the semantic index has no\n"
            "  appearance to index and the benchmark will read as a model failure.\n\n")
    return out


def load_fluff_raw():
    """name|source -> the raw fluff entry, from wherever the files actually are.

    5e.tools ships them INSIDE data/bestiary/ alongside the statblocks; data/README.md
    asked for a data/fluff-bestiary/ instead. Both are read, because finding neither is
    silent: every document collapses to a name and a list of action titles, the build
    succeeds, and the benchmark reports a model failure that is really a missing file."""
    raw = {}
    seen = set()
    for d, keep in [(os.path.join(DATA, "bestiary"),
                     lambda f: f.startswith("fluff-") and f.endswith(".json")),
                    (os.path.join(DATA, "fluff-bestiary"),
                     lambda f: f.endswith(".json"))]:
        if not os.path.isdir(d):
            continue
        for fname in sorted(os.listdir(d)):
            if not keep(fname) or fname in seen:
                continue
            seen.add(fname)
            try:
                for f in read_json(os.path.join(d, fname)).get("monsterFluff", []):
                    if f.get("name"):
                        raw["%s|%s" % (f["name"].lower(), f.get("source", "").lower())] = f
            except Exception:
                continue
    return raw


def load_fluff():
    """name|source -> the opening descriptive prose, with _copy resolved."""
    raw = load_fluff_raw()
    out = {}
    for key, f in raw.items():
        seen = 0
        while f.get("_copy") and seen < 5:
            base = raw.get("%s|%s" % (f["_copy"]["name"].lower(),
                                      f["_copy"].get("source", "").lower()))
            if not base:
                break
            f = base
            seen += 1
        out[key] = prose(f.get("entries", []))
    return out


def prose(entries, limit=4):
    """Flatten fluff entries to plain paragraphs, skipping tables and stat insets."""
    found = []

    def walk(node):
        if len(found) >= limit:
            return
        if isinstance(node, str):
            text = re.sub(r"\{@\w+\s+([^}|]+)(\|[^}]*)?\}", r"\1", node)
            text = re.sub(r"\{@\w+\}", "", text).strip()
            if len(text) > 40:
                found.append(text)
        elif isinstance(node, list):
            for n in node:
                walk(n)
        elif isinstance(node, dict):
            if node.get("type") in ("table", "inset"):
                return
            walk(node.get("entries") or node.get("items") or [])

    walk(entries)
    return " ".join(found[:limit])


def describe(m, fluff_text):
    size_names = {"T": "Tiny", "S": "Small", "M": "Medium",
                  "L": "Large", "H": "Huge", "G": "Gargantuan"}
    sizes = m.get("size") or []
    if isinstance(sizes, str):
        sizes = [sizes]
    mtype = m.get("type")
    if isinstance(mtype, dict):
        inner = mtype.get("type")
        mtype = (inner.get("choose", [""])[0] if isinstance(inner, dict) else inner) or ""
    parts = [
        m.get("name", ""),
        " ".join(size_names.get(s, str(s)) for s in sizes),
        mtype or "",
        " ".join(t.get("name", "") for t in (m.get("trait") or []) if isinstance(t, dict)),
        " ".join(a.get("name", "") for a in (m.get("action") or []) if isinstance(a, dict)),
        fluff_text,
    ]
    # CLIP's text encoder truncates at 77 tokens, so there is no point handing it more.
    return ". ".join(p for p in parts if p)[:600]


def artwork_path(m, fluff_raw):
    """Where the official image for this monster lives, if the user has the image pack."""
    entry = fluff_raw.get("%s|%s" % (m["name"].lower(), m["source"].lower()))
    if not entry:
        return None
    # `images` is sometimes present and null rather than absent, which is not the same
    # thing as an empty list and used to raise on the first such entry.
    for image in (entry.get("images") or []):
        if not isinstance(image, dict):
            continue
        href = image.get("href") or {}
        if href.get("path"):
            path = os.path.join(DATA, "img", href["path"])
            if os.path.exists(path):
                return path
    return None


# ---------------------------------------------------------------- vocabulary

STOP = set("a an the and or but of in on at to from with without into onto for by is are was "
           "were be been being it its they them their this that these those as if then than "
           "when while who which what where how so such not no nor can could will would".split())


def build_vocab(docs, extra_limit=8000):
    """Words a player might type. Drawn from the corpus's own description vocabulary,
    which is what the monsters are actually described with, plus the plain words the
    lexical scorer already treats as visual. Capped: every word costs `dim` bytes in
    the shipped index, so a long tail of hapax legomena is not worth carrying."""
    counts = {}
    for d in docs:
        for w in re.findall(r"[a-z]{3,}", d["doc"].lower()):
            if w not in STOP:
                counts[w] = counts.get(w, 0) + 1
    ranked = sorted(counts.items(), key=lambda kv: -kv[1])
    words = [w for w, _ in ranked[:extra_limit]]

    # Plain English a player reaches for that the books may never use themselves.
    plain = ("orb ball sphere round blob jelly slime goo bug insect beetle spider worm snake "
             "lizard bird fish crab shell armour armor plate spike horn claw fang tooth teeth "
             "wing tentacle eye eyes head mouth tail leg arm fur hair feather scale skin bone "
             "skeleton ghost floating flying swimming crawling burrowing glowing rotting "
             "burning frozen metal stone wooden giant huge tiny small massive tall short fat "
             "thin skinny hairy slimy spiky furry scaly bony red green blue black white grey "
             "brown purple golden pale dark man woman person dog cat wolf bear horse ape "
             "monkey elephant statue armour knight demon devil angel dragon").split()
    for w in plain:
        if w not in words:
            words.append(w)
    return words


# ---------------------------------------------------------------- encoding

def quantise(vectors):
    """L2-normalise then scale to int8. Returns a flat bytes object, row-major."""
    import numpy as np
    v = np.asarray(vectors, dtype="float32")
    norms = np.linalg.norm(v, axis=1, keepdims=True)
    norms[norms == 0] = 1.0
    v = v / norms
    q = np.clip(np.rint(v * SCALE), -SCALE, SCALE).astype("int8")
    return q.tobytes()


def centre(blocks):
    """Subtract the corpus mean direction from every vector (--center).

    WHY THIS MIGHT MATTER MORE THAN ANY OTHER KNOB. CLIP's text embeddings are famously
    anisotropic: they do not spread over the sphere, they crowd into a narrow cone, so any
    two of them have a high cosine before either one's meaning is considered. Ranking by
    raw cosine then measures mostly that shared direction — how generically document-like a
    document is — and the semantic residual that actually distinguishes a beholder from a
    bullywug is a small perturbation on top of it, easily swamped.

    Removing the mean removes the part every document has in common and leaves the part
    that differs. It is applied to the documents, the vocabulary and the queries with the
    SAME mean, which is what keeps them comparable — and because centring is linear, the
    browser's mean-of-words trick still lands where it should afterwards.

    This is a hypothesis with a good pedigree, not a measured result. --center exists so it
    can be tested rather than argued about."""
    import numpy as np
    stacked = np.concatenate([b for b in blocks if len(b)])
    mu = stacked.mean(axis=0, keepdims=True)
    return [b - mu if len(b) else b for b in blocks]


def encode(model_name, pretrained, texts, images, batch=64):
    """Returns (text_vectors, image_vectors_or_None). Imported here rather than at module
    scope so `--help` and the corpus loading work without torch installed."""
    import numpy as np
    import torch
    import open_clip

    model, _, preprocess = open_clip.create_model_and_transforms(model_name, pretrained=pretrained)
    tokenizer = open_clip.get_tokenizer(model_name)
    model.eval()

    text_out = []
    with torch.no_grad():
        for i in range(0, len(texts), batch):
            chunk = texts[i:i + batch]
            text_out.append(model.encode_text(tokenizer(chunk)).float().numpy())
            sys.stderr.write("\rtext %d/%d" % (min(i + batch, len(texts)), len(texts)))
    sys.stderr.write("\n")
    text_vectors = np.concatenate(text_out) if text_out else np.zeros((0, 512), "float32")

    image_vectors = None
    if images:
        from PIL import Image
        image_vectors = np.zeros((len(images), text_vectors.shape[1]), "float32")
        with torch.no_grad():
            for i, path in enumerate(images):
                if not path:
                    continue
                try:
                    tensor = preprocess(Image.open(path).convert("RGB")).unsqueeze(0)
                    image_vectors[i] = model.encode_image(tensor).float().numpy()[0]
                except Exception:
                    pass
                if i % 50 == 0:
                    sys.stderr.write("\rimages %d/%d" % (i, len(images)))
        sys.stderr.write("\n")
    return text_vectors, image_vectors


def combine(text_vectors, image_vectors, image_weight):
    """One vector per monster. Where artwork exists it is mixed in, because it is
    frequently the better description — the prose talks about temperament, the picture
    is what the thing looked like. Monsters without art keep their text vector alone,
    which is why this is a weighted mix rather than a replacement."""
    import numpy as np
    if image_vectors is None:
        return text_vectors
    out = np.array(text_vectors, dtype="float32", copy=True)
    for i in range(len(out)):
        if np.any(image_vectors[i]):
            t = out[i] / (np.linalg.norm(out[i]) or 1)
            m = image_vectors[i] / (np.linalg.norm(image_vectors[i]) or 1)
            out[i] = (1 - image_weight) * t + image_weight * m
    return out


# ---------------------------------------------------------------- main

def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--model", default="ViT-B-32")
    ap.add_argument("--pretrained", default="laion2b_s34b_b79k")
    ap.add_argument("--images", action="store_true",
                    help="also embed official artwork from data/img (needs the 5e.tools image pack)")
    ap.add_argument("--image-weight", type=float, default=0.5,
                    help="how much of a monster's vector comes from its picture (0..1)")
    ap.add_argument("--vocab-size", type=int, default=8000)
    ap.add_argument("--center", "--centre", dest="center", action="store_true",
                    help="subtract the corpus mean before quantising (see centre())")
    ap.add_argument("--queries", help="file of one query per line; encode these too, for eval")
    ap.add_argument("--limit", type=int, help="only the first N monsters, for a quick trial run")
    args = ap.parse_args()

    docs = load_bestiary()
    if args.limit:
        docs = docs[:args.limit]
    print("%d monsters" % len(docs))

    images = None
    if args.images:
        fluff_raw = load_fluff_raw()
        images = [artwork_path(d, fluff_raw) for d in docs]
        print("%d of them have artwork on disk" % sum(1 for p in images if p))

    vocab = build_vocab(docs, args.vocab_size)
    print("%d vocabulary words" % len(vocab))

    texts = [d["doc"] for d in docs] + vocab
    query_lines = []
    if args.queries:
        with open(args.queries, encoding="utf8") as fh:
            query_lines = [ln.strip() for ln in fh if ln.strip()]
        texts += query_lines

    text_vectors, image_vectors = encode(args.model, args.pretrained, texts,
                                         images + [None] * (len(texts) - len(docs)) if images else None)

    n = len(docs)
    monster_vectors = combine(text_vectors[:n],
                              image_vectors[:n] if image_vectors is not None else None,
                              args.image_weight)
    vocab_vectors = text_vectors[n:n + len(vocab)]
    query_vectors = text_vectors[n + len(vocab):]

    if args.center:
        # One mean, shared by all three blocks, or they stop being comparable.
        monster_vectors, vocab_vectors, query_vectors = centre(
            [monster_vectors, vocab_vectors, query_vectors])
        print("centred on the corpus mean")

    os.makedirs(OUT, exist_ok=True)
    with open(os.path.join(OUT, "appearance-mon.i8"), "wb") as fh:
        fh.write(quantise(monster_vectors))
    with open(os.path.join(OUT, "appearance-vocab.i8"), "wb") as fh:
        fh.write(quantise(vocab_vectors))

    manifest = {
        "model": "%s/%s" % (args.model, args.pretrained),
        "dim": int(monster_vectors.shape[1]),
        "withImages": bool(args.images),
        "centred": bool(args.center),
        "imageWeight": args.image_weight if args.images else 0,
        "keys": [d["key"] for d in docs],
        "vocab": vocab,
    }
    with open(os.path.join(OUT, "appearance.json"), "w", encoding="utf8") as fh:
        json.dump(manifest, fh)

    if query_lines:
        qv = query_vectors
        with open(os.path.join(OUT, "appearance-queries.json"), "w", encoding="utf8") as fh:
            json.dump({"queries": query_lines, "dim": manifest["dim"]}, fh)
        with open(os.path.join(OUT, "appearance-queries.i8"), "wb") as fh:
            fh.write(quantise(qv))
        print("encoded %d eval queries" % len(query_lines))

    size = os.path.getsize(os.path.join(OUT, "appearance-mon.i8"))
    print("wrote index/ — %d monsters x %d dims, %.1f MB" % (n, manifest["dim"], size / 1e6))
    print("now run:  node eval/appearance.js     (the number that has to move)")


if __name__ == "__main__":
    main()
