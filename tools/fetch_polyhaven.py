#!/usr/bin/env python3
"""
Download a Poly Haven asset into .cache/polyhaven/<id>/.

Network lives here (WSL side) so the Blender script never touches SSL.
Only the maps we actually need are fetched -- for flat-shaded low-poly,
normal and ARM maps are dead weight, so they are skipped by default.
"""
import argparse
import json
import os
import sys
import urllib.request

API = "https://api.polyhaven.com"
# Poly Haven rejects urllib's default User-Agent with a 403.
UA = {"User-Agent": "a_game-asset-pipeline/0.1 (+blender-mcp)"}
CACHE = os.path.join(os.path.dirname(__file__), "..", ".cache", "polyhaven")


def get_json(url):
    req = urllib.request.Request(url, headers=UA)
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.load(r)


def download(url, dest):
    os.makedirs(os.path.dirname(dest), exist_ok=True)
    if os.path.exists(dest) and os.path.getsize(dest) > 0:
        return os.path.getsize(dest), True
    req = urllib.request.Request(url, headers=UA)
    with urllib.request.urlopen(req, timeout=120) as r, open(dest, "wb") as f:
        f.write(r.read())
    return os.path.getsize(dest), False


def wanted(name, keep_maps):
    """Texture files we care about. Non-texture files (.bin) always pass."""
    if "textures/" not in name.replace("\\", "/"):
        return True
    return any(m in name for m in keep_maps)


def fetch_hdri(asset_id, res):
    """Download a Radiance .hdr straight into public/assets/env for three's RGBELoader."""
    files = get_json(f"{API}/files/{asset_id}")
    if "hdri" not in files:
        sys.exit(f"{asset_id}: not an HDRI")
    tiers = files["hdri"]
    if res not in tiers:
        sys.exit(f"{asset_id}: resolution {res} not in {list(tiers)}")
    entry = tiers[res].get("hdr") or next(iter(tiers[res].values()))
    out_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "public", "assets", "env"))
    dest = os.path.join(out_dir, f"{asset_id}_{res}.hdr")
    size, cached = download(entry["url"], dest)
    print(json.dumps({"asset_id": asset_id, "hdr": dest, "bytes": size, "cached": cached}, indent=2))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("asset_id")
    ap.add_argument("--res", default="1k")
    ap.add_argument("--keep-maps", default="diff",
                    help="comma-separated map substrings to fetch (default: diff only)")
    ap.add_argument("--type", default="model", choices=["model", "hdri"],
                    help="model -> glTF into .cache; hdri -> .hdr into public/assets/env")
    a = ap.parse_args()

    if a.type == "hdri":
        return fetch_hdri(a.asset_id, a.res)

    keep_maps = [m.strip() for m in a.keep_maps.split(",") if m.strip()]
    files = get_json(f"{API}/files/{a.asset_id}")
    if "gltf" not in files:
        sys.exit(f"{a.asset_id}: no glTF format available")
    if a.res not in files["gltf"]:
        sys.exit(f"{a.asset_id}: resolution {a.res} not in {list(files['gltf'])}")

    entry = files["gltf"][a.res]["gltf"]
    out_dir = os.path.abspath(os.path.join(CACHE, a.asset_id))
    os.makedirs(out_dir, exist_ok=True)

    gltf_name = entry["url"].rsplit("/", 1)[-1]
    total = 0
    skipped = []
    size, cached = download(entry["url"], os.path.join(out_dir, gltf_name))
    total += size

    for rel, meta in entry.get("include", {}).items():
        if not wanted(rel, keep_maps):
            skipped.append(rel)
            continue
        size, cached = download(meta["url"], os.path.join(out_dir, rel))
        total += size

    info = get_json(f"{API}/info/{a.asset_id}")
    print(json.dumps({
        "asset_id": a.asset_id,
        "name": info.get("name"),
        "authors": info.get("authors"),
        "gltf": os.path.join(out_dir, gltf_name),
        "dir": out_dir,
        "downloaded_bytes": total,
        "skipped_maps": skipped,
    }, indent=2))


if __name__ == "__main__":
    main()
