#!/usr/bin/env python3
"""Fetch just the monster artwork, one file at a time, resumably.

    python3 build/fetch_images.py                 # everything the fluff references
    python3 build/fetch_images.py --sources MM    # one book, for a quick trial
    python3 build/fetch_images.py --limit 50      # a handful, to prove it works

WHY NOT JUST CLONE THE IMAGE REPO. Because a sparse clone pulls thousands of objects
in a single stream, and on a slow or flaky connection one drop loses the lot —
`fetch-pack: unexpected disconnect` and you start again from nothing. This fetches
each file independently, skips anything already on disk, and retries with backoff.
Interrupt it whenever you like and run it again; it picks up where it stopped.

WHAT IT FETCHES. Not the whole pack — the fluff files are the manifest, so this asks
only for images some monster actually points at, into exactly the layout
build/embed.py expects:

    data/img/bestiary/MM/Aboleth.webp

Nothing here is committed. data/ is gitignored, and the artwork stays WotC's: the
embedding build reads these pixels and writes only vectors.
"""
import argparse
import os
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from embed import DATA, load_fluff_raw                        # noqa: E402

# Verified reachable at the time of writing. The mirrors rotate; --base overrides.
DEFAULT_BASE = "https://raw.githubusercontent.com/5etools-mirror-3/5etools-img/main"
FALLBACK_BASE = "https://raw.githubusercontent.com/5etools-mirror-2/5etools-img/main"


def wanted(sources=None):
    """Every image path the bestiary fluff references, de-duplicated and sorted."""
    paths = set()
    for entry in load_fluff_raw().values():
        # `images` is sometimes present and null, not merely absent.
        for image in (entry.get("images") or []):
            if not isinstance(image, dict):
                continue
            path = (image.get("href") or {}).get("path")
            if not path:
                continue
            if sources:
                parts = path.split("/")
                if len(parts) < 2 or parts[1].upper() not in sources:
                    continue
            paths.add(path)
    return sorted(paths)


def fetch(url, dest, tries=4, timeout=30):
    """One file, with backoff. Writes to a .part first so an interrupted download is
    never mistaken for a finished one on the next run."""
    for attempt in range(tries):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "monster-doxxer"})
            with urllib.request.urlopen(req, timeout=timeout) as r:
                body = r.read()
            if not body:
                raise IOError("empty response")
            tmp = dest + ".part"
            with open(tmp, "wb") as fh:
                fh.write(body)
            os.replace(tmp, dest)
            return len(body)
        except urllib.error.HTTPError as e:
            if e.code == 404:
                return 0                                   # genuinely absent; don't retry
            if attempt == tries - 1:
                raise
        except Exception:
            if attempt == tries - 1:
                raise
        time.sleep(2 ** attempt)
    return 0


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--base", default=DEFAULT_BASE, help="mirror to fetch from")
    ap.add_argument("--sources", help="comma-separated source codes, e.g. MM,VGM")
    ap.add_argument("--limit", type=int, help="stop after this many files")
    ap.add_argument("--timeout", type=int, default=30)
    args = ap.parse_args()

    sources = {s.strip().upper() for s in args.sources.split(",")} if args.sources else None
    paths = wanted(sources)
    if args.limit:
        paths = paths[:args.limit]
    if not paths:
        sys.exit("Nothing to fetch. Is data/bestiary/fluff-bestiary-*.json in place?")

    root = os.path.join(DATA, "img")
    todo = [p for p in paths if not os.path.exists(os.path.join(root, p))]
    print("%d images referenced, %d already on disk, %d to fetch"
          % (len(paths), len(paths) - len(todo), len(todo)))
    if not todo:
        return

    got = failed = missing = 0
    total_bytes = 0
    started = time.time()
    for i, path in enumerate(todo, 1):
        dest = os.path.join(root, path)
        os.makedirs(os.path.dirname(dest), exist_ok=True)
        url = args.base + "/" + urllib.parse.quote(path)
        try:
            n = fetch(url, dest, timeout=args.timeout)
            if n:
                got += 1
                total_bytes += n
            else:
                missing += 1
        except Exception as e:
            failed += 1
            sys.stderr.write("\n  %s: %s\n" % (path, e))

        if i % 10 == 0 or i == len(todo):
            elapsed = max(time.time() - started, 1e-9)
            rate = total_bytes / elapsed / 1024
            left = (len(todo) - i) * (elapsed / i)
            sys.stderr.write("\r  %d/%d  %.0f KiB/s  ~%d min left  (%d missing, %d failed)   "
                             % (i, len(todo), rate, left / 60, missing, failed))
    sys.stderr.write("\n")

    print("fetched %d, %.0f MB" % (got, total_bytes / 1e6))
    if missing:
        print("%d referenced images are not on the mirror — normal, and harmless" % missing)
    if failed:
        print("%d failed. Run this again: it skips what it already has." % failed)


if __name__ == "__main__":
    main()
