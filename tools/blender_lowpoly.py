"""
Turn a downloaded Poly Haven glTF into a flat-shaded low-poly GLB.

Runs inside Blender. The caller defines a dict named ``PH_CONFIG`` and then
execs this file. Work happens in a throwaway scene so the user's open scene
is never touched.

PH_CONFIG keys:
    src         path to the downloaded .gltf
    out         path to write the .glb
    tris        target triangle count        (default 1200)
    texture     max texture edge in px, or 0 to drop textures entirely
    name        object name for the exported asset
"""
import os

import bpy

CFG = {
    "tris": 1200,
    "texture": 512,
    "name": "asset",
    # Draco on by default: flat shading splits normals per face, so vertices
    # cannot be shared and the vertex buffer roughly triples. Measured on a
    # 1200-tri barrel: 139 KB uncompressed vs 56 KB with Draco.
    "draco": True,
}
CFG.update(PH_CONFIG)  # noqa: F821 - injected by the caller

report = {"steps": []}


def step(msg, **data):
    report["steps"].append({"step": msg, **data})


def tri_count(obj):
    """Triangle count of the evaluated mesh, i.e. after modifiers."""
    dg = bpy.context.evaluated_depsgraph_get()
    me = obj.evaluated_get(dg).to_mesh()
    n = len(me.loop_triangles) or sum(max(len(p.vertices) - 2, 0) for p in me.polygons)
    if n == 0:
        me.calc_loop_triangles()
        n = len(me.loop_triangles)
    obj.evaluated_get(dg).to_mesh_clear()
    return n


# Leftover datablocks from a previous run make Blender suffix names (.001),
# which would change the node/mesh names the game code looks up.
bpy.ops.outliner.orphans_purge(do_recursive=True)

# --- isolated workspace -----------------------------------------------------
prev_scene = bpy.context.window.scene
work = bpy.data.scenes.new("ph_work")
bpy.context.window.scene = work
step("created throwaway scene", scene=work.name, preserved=prev_scene.name)

try:
    # --- import -------------------------------------------------------------
    bpy.ops.import_scene.gltf(filepath=CFG["src"])
    meshes = [o for o in work.objects if o.type == "MESH"]
    if not meshes:
        raise RuntimeError("glTF imported no mesh objects")
    step("imported", objects=len(work.objects), meshes=len(meshes))

    # --- join into one object ----------------------------------------------
    bpy.ops.object.select_all(action="DESELECT")
    for o in meshes:
        o.select_set(True)
    bpy.context.view_layer.objects.active = meshes[0]
    if len(meshes) > 1:
        bpy.ops.object.join()
    obj = bpy.context.view_layer.objects.active
    obj.name = CFG["name"]
    obj.data.name = CFG["name"]
    for slot in obj.material_slots:
        if slot.material:
            slot.material.name = CFG["name"] + "_mat"
    before = tri_count(obj)
    step("joined", name=obj.name, tris=before)

    # --- decimate to budget -------------------------------------------------
    target = int(CFG["tris"])
    if before > target:
        dec = obj.modifiers.new("ph_decimate", "DECIMATE")
        dec.decimate_type = "COLLAPSE"
        dec.ratio = max(target / before, 0.002)
        step("decimate", ratio=round(dec.ratio, 5), target=target)

    # Guarantee triangles in the export (glTF wants them anyway).
    tri = obj.modifiers.new("ph_triangulate", "TRIANGULATE")
    tri.keep_custom_normals = False

    bpy.ops.object.select_all(action="DESELECT")
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.convert(target="MESH")  # bake modifiers down
    obj = bpy.context.view_layer.objects.active
    after = tri_count(obj)
    step("decimated", tris_before=before, tris_after=after)

    # --- flat shading -------------------------------------------------------
    # Blender 4.1+ dropped use_auto_smooth; shade_flat() alone is correct here.
    bpy.ops.object.shade_flat()
    step("shaded flat")

    # --- strip maps the flat-shaded look cannot use -------------------------
    dropped, kept = [], []
    for slot in obj.material_slots:
        mat = slot.material
        if not mat or not mat.use_nodes:
            continue
        nodes = mat.node_tree.nodes
        bsdf = next((n for n in nodes if n.type == "BSDF_PRINCIPLED"), None)
        for node in list(nodes):
            if node.type != "TEX_IMAGE":
                continue
            img = node.image
            missing = img is None or tuple(img.size) == (0, 0) or not img.has_data
            # Base Color is the only map that survives; the rest is invisible
            # once shading is flat and normal/roughness detail is gone.
            # NOTE: compare nodes by name, never with `is` -- Blender returns a
            # fresh Python wrapper on each access, so identity checks break.
            feeds_base = bsdf is not None and any(
                l.to_node.name == bsdf.name and l.to_socket.name == "Base Color"
                for l in node.outputs["Color"].links
            )
            if feeds_base and not missing and CFG["texture"]:
                edge = int(CFG["texture"])
                if max(img.size) > edge:
                    img.scale(edge, edge)
                kept.append({"image": img.name, "size": list(img.size)})
            else:
                dropped.append(img.name if img else node.name)
                nodes.remove(node)

        # Helper nodes left with no input would still drive Metallic/Roughness
        # to garbage (roughness 0 = mirror). Remove them and set sane values.
        for node in list(nodes):
            if node.type in {"NORMAL_MAP", "SEPARATE_COLOR", "MAPPING", "TEX_COORD"}:
                if not any(sock.links for sock in node.inputs):
                    nodes.remove(node)
        if bsdf:
            bsdf.inputs["Metallic"].default_value = 0.0
            bsdf.inputs["Roughness"].default_value = 0.8
    step("materials simplified", kept=kept, dropped=dropped)

    # --- export -------------------------------------------------------------
    os.makedirs(os.path.dirname(CFG["out"]), exist_ok=True)
    bpy.ops.object.select_all(action="DESELECT")
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    bpy.ops.export_scene.gltf(
        filepath=CFG["out"],
        export_format="GLB",
        use_selection=True,
        export_apply=True,
        export_yup=True,
        export_image_format="WEBP" if CFG["texture"] else "NONE",
        export_image_quality=80,
        export_draco_mesh_compression_enable=bool(CFG["draco"]),
        export_draco_mesh_compression_level=6,
    )
    report["out"] = CFG["out"]
    report["bytes"] = os.path.getsize(CFG["out"])
    report["tris"] = after

finally:
    # Always restore the user's scene, even if the pipeline blew up.
    bpy.context.window.scene = prev_scene
    bpy.data.scenes.remove(work, do_unlink=True)
    step("restored scene", scene=prev_scene.name)

result = report
