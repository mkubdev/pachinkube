#!/usr/bin/env python3
"""Generate public/assets/models/manifest.json from the exported GLBs."""
import json
import os
import struct

HERE = os.path.dirname(os.path.abspath(__file__))
MODELS = os.path.join(HERE, "..", "public", "assets", "models")


def glb_stats(path):
    """Pull tri count and extensions straight out of the GLB header."""
    with open(path, "rb") as f:
        data = f.read()
    off, gltf = 12, None
    while off < len(data):
        clen, ctype = struct.unpack_from("<I4s", data, off)
        if ctype == b"JSON":
            gltf = json.loads(data[off + 8: off + 8 + clen])
            break
        off += 8 + clen + (-clen % 4)
    if not gltf:
        return {}
    tris = 0
    for mesh in gltf.get("meshes", []):
        for prim in mesh.get("primitives", []):
            draco = prim.get("extensions", {}).get("KHR_draco_mesh_compression")
            idx = prim.get("indices")
            if draco is None and idx is not None:
                tris += gltf["accessors"][idx]["count"] // 3
            elif draco is not None:
                # Draco hides the index accessor; fall back to the stored count.
                acc = gltf["accessors"][idx] if idx is not None else None
                tris += (acc["count"] // 3) if acc else 0
    return {
        "triangles": tris,
        "extensions": gltf.get("extensionsUsed", []),
        "materials": [m.get("name") for m in gltf.get("materials", [])],
    }


def main():
    models = sorted(f for f in os.listdir(MODELS) if f.endswith(".glb"))
    entries = []
    for name in models:
        path = os.path.join(MODELS, name)
        entries.append({
            "id": os.path.splitext(name)[0],
            "url": f"assets/models/{name}",
            "bytes": os.path.getsize(path),
            **glb_stats(path),
        })
    out = os.path.join(MODELS, "manifest.json")
    with open(out, "w") as f:
        json.dump({"models": entries}, f, indent=2)
    print(f"manifest: {len(entries)} model(s) -> {out}")


if __name__ == "__main__":
    main()
