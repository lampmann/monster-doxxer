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
import random
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


class Missing(Exception):
    """The mirror genuinely does not have this file. Not a network problem."""


def make_session():
    """One connection, reused. Every file used to pay for its own TLS handshake, which
    on a lossy link is a fresh chance to fail — and `SSL: UNEXPECTED_EOF_WHILE_READING`
    is precisely what a cut connection looks like. Keep-alive removes most of those."""
    try:
        import requests
        from requests.adapters import HTTPAdapter
        from urllib3.util.retry import Retry
    except ImportError:
        return None                                   # urllib fallback below
    s = requests.Session()
    s.headers["User-Agent"] = "monster-doxxer"
    retry = Retry(total=5, connect=5, read=5, backoff_factor=1.5,
                  status_forcelist=[429, 500, 502, 503, 504],
                  allowed_methods=["GET"], raise_on_status=False)
    s.mount("https://", HTTPAdapter(max_retries=retry, pool_maxsize=8))
    return s


def verify(body, declared):
    """Reject a truncated download rather than storing it.

    THIS IS THE PART THAT MATTERS. A connection cut mid-transfer can hand back a short
    body without raising, and a half-written image that lands on disk is worse than one
    that never arrived: the next run skips it, the encoder reads it, and the index quietly
    contains a vector for a broken picture. So check the length the server promised, and
    check the file actually starts like the image it claims to be."""
    if not body:
        raise IOError("empty response")
    if declared is not None and len(body) != declared:
        raise IOError("truncated: got %d of %d bytes" % (len(body), declared))
    if body[:4] == b"RIFF" and body[8:12] != b"WEBP":
        raise IOError("not a webp")
    if len(body) < 128:
        raise IOError("implausibly small (%d bytes)" % len(body))
    return len(body)


def fetch(url, dest, session, tries=6, timeout=45):
    """One file, with backoff and jitter. Writes to a .part first, so an interrupted
    download is never mistaken for a finished one by the next run."""
    last = None
    for attempt in range(tries):
        try:
            if session is not None:
                r = session.get(url, timeout=timeout)
                if r.status_code == 404:
                    raise Missing()
                r.raise_for_status()
                declared = r.headers.get("Content-Length")
                body = r.content
            else:
                req = urllib.request.Request(url, headers={"User-Agent": "monster-doxxer"})
                with urllib.request.urlopen(req, timeout=timeout) as resp:
                    declared = resp.headers.get("Content-Length")
                    body = resp.read()
            n = verify(body, int(declared) if declared else None)

            tmp = dest + ".part"
            with open(tmp, "wb") as fh:
                fh.write(body)
            os.replace(tmp, dest)
            return n
        except Missing:
            return 0
        except urllib.error.HTTPError as e:
            if e.code == 404:
                return 0
            last = e
        except Exception as e:
            last = e
        # Jittered backoff: a link that just dropped is likely to drop again immediately,
        # and 2743 clients retrying in lockstep is its own problem.
        time.sleep(min(30, 1.5 ** attempt) * (0.6 + random.random() * 0.8))
    raise last if last else IOError("failed")


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--base", default=DEFAULT_BASE, help="mirror to fetch from")
    ap.add_argument("--sources", help="comma-separated source codes, e.g. MM,VGM")
    ap.add_argument("--limit", type=int, help="stop after this many files")
    ap.add_argument("--timeout", type=int, default=45)
    ap.add_argument("--passes", type=int, default=3,
                    help="repeat the whole sweep this many times, picking up failures")
    ap.add_argument("--verify", action="store_true",
                    help="re-check files already on disk and delete any that are damaged")
    args = ap.parse_args()

    sources = {s.strip().upper() for s in args.sources.split(",")} if args.sources else None
    paths = wanted(sources)
    if args.limit:
        paths = paths[:args.limit]
    if not paths:
        sys.exit("Nothing to fetch. Is data/bestiary/fluff-bestiary-*.json in place?")

    root = os.path.join(DATA, "img")

    if args.verify:
        # A download cut mid-transfer by an earlier, less careful version of this script
        # is the worst kind of failure: it looks finished. Every later run skips it, and
        # the encoder happily reads a broken picture into the index. Re-check and delete.
        bad = 0
        for path in paths:
            full = os.path.join(root, path)
            if not os.path.exists(full):
                continue
            try:
                with open(full, "rb") as fh:
                    verify(fh.read(), None)
            except Exception as e:
                os.remove(full)
                bad += 1
                sys.stderr.write("  removed %s (%s)\n" % (path, e))
        # .part files are by definition unfinished.
        for dirpath, _, files in os.walk(root):
            for f in files:
                if f.endswith(".part"):
                    os.remove(os.path.join(dirpath, f))
                    bad += 1
        print("verified %d files, removed %d damaged" % (len(paths), bad))

    todo = [p for p in paths if not os.path.exists(os.path.join(root, p))]
    print("%d images referenced, %d already on disk, %d to fetch"
          % (len(paths), len(paths) - len(todo), len(todo)))
    if not todo:
        return

    session = make_session()
    if session is None:
        print("(requests not installed — falling back to urllib, one handshake per file)")

    absent = set()                       # 404s, so later passes don't ask again
    got = total_bytes = 0
    bases = [args.base] + ([FALLBACK_BASE] if args.base == DEFAULT_BASE else [])

    for p in range(1, args.passes + 1):
        todo = [q for q in paths
                if q not in absent and not os.path.exists(os.path.join(root, q))]
        if not todo:
            break
        if p > 1:
            print("\npass %d: %d still missing" % (p, len(todo)))
        failed = []
        started = time.time()
        for i, path in enumerate(todo, 1):
            dest = os.path.join(root, path)
            os.makedirs(os.path.dirname(dest), exist_ok=True)
            # A mirror that 404s or dies may just be this mirror; try the other one.
            for bi, base in enumerate(bases):
                try:
                    n = fetch(base + "/" + urllib.parse.quote(path), dest,
                              session, timeout=args.timeout)
                    if n:
                        got += 1
                        total_bytes += n
                    elif bi == len(bases) - 1:
                        absent.add(path)
                    else:
                        continue
                    break
                except Exception as e:
                    if bi == len(bases) - 1:
                        failed.append((path, e))

            if i % 10 == 0 or i == len(todo):
                elapsed = max(time.time() - started, 1e-9)
                rate = total_bytes / elapsed / 1024
                left = (len(todo) - i) * (elapsed / i)
                sys.stderr.write(
                    "\r  %d/%d  %.0f KiB/s  ~%d min left  (%d absent, %d failed)      "
                    % (i, len(todo), rate, left / 60, len(absent), len(failed)))
        sys.stderr.write("\n")
        if not failed:
            break

    still = [q for q in paths
             if q not in absent and not os.path.exists(os.path.join(root, q))]
    print("\nfetched %d this run, %.0f MB" % (got, total_bytes / 1e6))
    if absent:
        print("%d referenced images are not on the mirror — normal, and harmless" % len(absent))
    if still:
        print("%d still missing after %d passes. Run this again — it only asks for what it\n"
              "lacks, so every run is cheaper than the last." % (len(still), args.passes))
    else:
        print("complete: every image the bestiary references is on disk")


if __name__ == "__main__":
    main()
