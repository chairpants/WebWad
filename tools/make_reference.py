"""Reference output from the Python exporter, for the JS port to match.

The exporter in ../ROTT is the authority: its selftests check what it decodes
against ROTT's own source. This script imports it read-only and writes down
what a correct decode looks like -- sizes and checksums -- so the port can be
held to it without shipping either the WAD or 14 MB of decoded art.

    python tools/make_reference.py [path-to-ROTT-checkout] [path-to-WAD]
"""
import hashlib
import json
import os
import sys

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DEFAULT_SRC = os.path.join(os.path.dirname(HERE), "ROTT")

# One of each kind the decoder has to get right: a plain shape, a tall actor
# frame, a transpatch (the 254-run translucency), a weapon view frame, and a
# raw wall texture that has no patch header at all.
LUMPS = ["MONKMEAL", "LWGS1", "ANGS1", "BAZOOKA1", "GODHAND1", "EXPLOS1",
         "FWALL1", "SKEL1", "LIPLEAD1", "SPRING1"]
RAW = [("WALL1", 4096)]


def main():
    src = sys.argv[1] if len(sys.argv) > 1 else DEFAULT_SRC
    wadpath = sys.argv[2] if len(sys.argv) > 2 else os.path.join(src, "HUNTBGIN.WAD")
    sys.path.insert(0, src)
    import rott
    import rott_gfx

    wad = rott.Wad(wadpath)
    sha = lambda b: hashlib.sha256(bytes(b)).hexdigest()[:16]
    out = {
        "wad": os.path.basename(wadpath),
        "bytes": os.path.getsize(wadpath),
        "lumps": len(wad.lumps),
        "pal": sha(wad.pal),
        "patches": {},
        "raw": {},
    }
    for name in LUMPS:
        q = rott_gfx.patch_indexed(wad, name)
        if not q:
            continue
        out["patches"][name] = {
            "w": q["w"], "h": q["h"], "orig": q["orig"], "top": q["top"],
            "idx": sha(q["idx"]), "mask": sha(q["mask"]),
        }
    for name, size in RAW:
        b = wad.by_name(name)
        if b is not None and len(b) == size:
            out["raw"][name] = {"bytes": len(b), "sha": sha(b)}

    # The level file: every used slot, its name, and a checksum of each
    # decompressed plane, so the RLEW expansion is pinned as well.
    rtlpath = os.path.join(src, "HUNTBGIN.RTL")
    blob, maps = rott.load(rtlpath)
    out["rtl"] = {"file": os.path.basename(rtlpath),
                  "bytes": os.path.getsize(rtlpath), "levels": []}
    for m in maps:
        if not m["used"]:
            continue
        pl = rott.planes(blob, m)
        out["rtl"]["levels"].append({
            "n": m["n"], "name": m["name"],
            "planes": [sha(bytes(w & 0xff for w in p) + bytes(w >> 8 for w in p))
                       for p in pl],
        })

    path = os.path.join(HERE, "test", "reference.json")
    with open(path, "w", encoding="utf-8") as f:
        json.dump(out, f, indent=1, sort_keys=True)
        f.write("\n")
    print("wrote %s: %d patches, %d raw, %d levels"
          % (path, len(out["patches"]), len(out["raw"]), len(out["rtl"]["levels"])))


if __name__ == "__main__":
    main()
