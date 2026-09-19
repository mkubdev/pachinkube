"""
Procedural PACHINKUBE cabinet, built in Blender and exported as GLB.

Runs inside Blender (via MCP execute_blender_code). The caller sets CAB_CONFIG:
    out      path to the .glb
    preview  optional path for a preview PNG
Board coordinates match src/sim: origin at bottom-centre, x in [-3, 3],
y in [0, 10]; pegs at z = 0, backdrop at z = -0.35. Everything is flat shaded.

Axis note: glTF is Y-up and the exporter maps Blender Z -> glTF Y and
Blender Y -> glTF -Z. All geometry below is authored in *board* coordinates
(x right, y up, z toward the camera) and converted with `B()` / `S()`.
"""
import math
import os

import bpy
import mathutils

CFG = {
    "width": 6.0,
    "height": 10.0,
    "frame": 0.55,      # frame bar thickness
    "depth": 0.9,       # z extent of the frame
    "launch": 1.4,      # extra headroom above the board for the drop area
    "out": None,
    "preview": None,
}
CFG.update(CAB_CONFIG)  # noqa: F821 - injected by the caller

report = {"steps": []}
step = lambda m, **d: report["steps"].append({"step": m, **d})  # noqa: E731

bpy.ops.outliner.orphans_purge(do_recursive=True)
prev_scene = bpy.context.window.scene
work = bpy.data.scenes.new("cab_work")
bpy.context.window.scene = work


def mat(name, color, metallic=0.6, roughness=0.35):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    bsdf = m.node_tree.nodes["Principled BSDF"]
    bsdf.inputs["Base Color"].default_value = (*color, 1.0)
    bsdf.inputs["Metallic"].default_value = metallic
    bsdf.inputs["Roughness"].default_value = roughness
    return m


def B(x, y, z):
    """Board (x, y, z) -> Blender (x, -z, y) so the glTF export is upright."""
    return (x, -z, y)


def S(sx, sy, sz):
    """Board extents -> Blender extents under the same mapping."""
    return (sx, sz, sy)


def box(name, size, loc, material):
    bpy.ops.mesh.primitive_cube_add(size=1.0, location=B(*loc))
    o = bpy.context.active_object
    o.name = name
    o.scale = S(*size)
    bpy.ops.object.transform_apply(scale=True)
    o.data.materials.append(material)
    return o


def bevel(o, width, segments=2):
    b = o.modifiers.new("bevel", "BEVEL")
    b.width = width
    b.segments = segments
    b.limit_method = "ANGLE"


try:
    W, H, F, D, L = CFG["width"], CFG["height"], CFG["frame"], CFG["depth"], CFG["launch"]
    body = mat("cabinet_body", (0.05, 0.05, 0.08), metallic=0.75, roughness=0.3)
    trim = mat("cabinet_trim", (0.55, 0.57, 0.62), metallic=1.0, roughness=0.2)
    neon = mat("cabinet_neon", (1.0, 0.18, 0.58), metallic=0.0, roughness=0.5)  # emissive set in three
    neon.node_tree.nodes["Principled BSDF"].inputs["Emission Color"].default_value = (1.0, 0.18, 0.58, 1.0)
    neon.node_tree.nodes["Principled BSDF"].inputs["Emission Strength"].default_value = 4.0

    inner_top = H + L
    zc = -0.15  # frame centred slightly behind the play plane
    parts = []

    # Four frame bars around the opening. Outer faces slightly proud of the board.
    parts.append(box("frame_left", (F, inner_top + 2 * F, D), (-W / 2 - F / 2 - 0.35, inner_top / 2, zc), body))
    parts.append(box("frame_right", (F, inner_top + 2 * F, D), (W / 2 + F / 2 + 0.35, inner_top / 2, zc), body))
    parts.append(box("frame_top", (W + 2 * F + 0.7, F, D), (0, inner_top + F / 2, zc), body))
    parts.append(box("frame_bottom", (W + 2 * F + 0.7, F * 1.6, D), (0, -F * 0.8 - 0.55, zc), body))

    # Chrome trim strips along the inner edge of each side bar.
    for sx in (-1, 1):
        parts.append(box(f"trim_{'l' if sx < 0 else 'r'}", (0.08, inner_top, 0.12),
                         (sx * (W / 2 + 0.31), inner_top / 2, 0.42), trim))
    # Neon groove: a thin recessed bar across the top frame and the pocket rail.
    parts.append(box("neon_top", (W + 0.5, 0.07, 0.07), (0, inner_top + 0.12, 0.35), neon))
    parts.append(box("neon_bottom", (W + 0.5, 0.05, 0.07), (0, -0.62, 0.36), neon))

    # Corner bolts: low-poly cylinders.
    bolt = mat("cabinet_bolt", (0.7, 0.72, 0.78), metallic=1.0, roughness=0.25)
    for sx in (-1, 1):
        for y in (-0.55 - F * 0.8, inner_top + F / 2):
            bpy.ops.mesh.primitive_cylinder_add(vertices=8, radius=0.09, depth=0.08,
                                                location=B(sx * (W / 2 + F / 2 + 0.35), y, zc + D / 2 + 0.02),
                                                rotation=(math.pi / 2, 0, 0))  # axis toward the camera
            b = bpy.context.active_object
            b.name = "bolt"
            b.data.materials.append(bolt)
            parts.append(b)

    for p in parts[:4]:
        bevel(p, 0.06, 2)

    # Join, flat shade, name deterministically.
    bpy.ops.object.select_all(action="DESELECT")
    for p in parts:
        p.select_set(True)
    bpy.context.view_layer.objects.active = parts[0]
    bpy.ops.object.join()
    cab = bpy.context.active_object
    bpy.ops.object.convert(target="MESH")
    cab.name = cab.data.name = "cabinet"
    bpy.ops.object.shade_flat()
    tris = sum(max(len(poly.vertices) - 2, 0) for poly in cab.data.polygons)
    step("built", tris=tris, materials=[m.name for m in cab.data.materials])

    os.makedirs(os.path.dirname(CFG["out"]), exist_ok=True)
    bpy.ops.object.select_all(action="DESELECT")
    cab.select_set(True)
    bpy.context.view_layer.objects.active = cab
    bpy.ops.export_scene.gltf(
        filepath=CFG["out"], export_format="GLB", use_selection=True, export_apply=True,
        export_yup=True, export_image_format="NONE",
        export_draco_mesh_compression_enable=True, export_draco_mesh_compression_level=6,
    )
    report["out"] = CFG["out"]
    report["bytes"] = os.path.getsize(CFG["out"])
    report["tris"] = tris

    if CFG.get("preview"):
        cam = bpy.data.objects.new("cam", bpy.data.cameras.new("cam"))
        work.collection.objects.link(cam)
        target = mathutils.Vector(B(0, inner_top / 2, 0))
        cam.location = target + mathutils.Vector(B(0.9, 0.5, 1.4)).normalized() * 18.0
        cam.rotation_euler = (target - cam.location).to_track_quat("-Z", "Y").to_euler()
        work.camera = cam
        sun = bpy.data.objects.new("sun", bpy.data.lights.new("sun", type="SUN"))
        sun.data.energy = 3.0
        sun.rotation_euler = (0.8, 0.3, 0.6)
        work.collection.objects.link(sun)
        world = bpy.data.worlds.new("w")
        world.use_nodes = True
        world.node_tree.nodes["Background"].inputs[0].default_value = (0.03, 0.03, 0.05, 1)
        work.world = world
        work.render.engine = "BLENDER_EEVEE"
        work.render.resolution_x = work.render.resolution_y = 720
        work.render.filepath = CFG["preview"]
        bpy.ops.render.render(write_still=True)
        report["preview"] = CFG["preview"]
finally:
    bpy.context.window.scene = prev_scene
    bpy.data.scenes.remove(work, do_unlink=True)

result = report
