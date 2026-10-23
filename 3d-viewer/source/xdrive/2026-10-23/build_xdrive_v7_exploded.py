"""Build the viewer-ready XDrive V7 exploded assembly with its Pi board.

Run ``prepare_xdrive_v7_with_board.py`` first. The prepared scene preserves
the six build transforms stored in the Bambu 3MF. Blender only recenters each
part's pivot, applies web materials, and animates outward from that authored
closed pose.
"""

from __future__ import annotations

import json
import math
import struct
import traceback
from pathlib import Path

import bpy
import numpy as np
from mathutils import Matrix, Vector
from mathutils.bvhtree import BVHTree


ROOT = Path(r"D:\AAog\mxgenius.io")
CACHE = ROOT.parent / ".codex-tmp" / "xdrive-v7-with-board"
SOURCE = CACHE / "authored-assembly.glb"
MANIFEST = CACHE / "authored-assembly.json"
OUTPUT = ROOT / "3d-viewer" / "models" / "XDrive_V7_ExplodedAssembly.glb"
PREVIEW_DIR = ROOT.parent / ".codex-tmp" / "xdrive-v7-inspect" / "v7-with-board"
BLEND_OUTPUT = PREVIEW_DIR / "XDrive_V7_with_board.blend"
BUILD_LOG = PREVIEW_DIR / "build.log"
PREVIEW_DIR.mkdir(parents=True, exist_ok=True)

MM = 0.001

ROLE_BY_VERTEX_COUNT = {
    4927: "01 Base tray",
    2221: "02 Front I-O frame",
    1497: "03 Rear I-O frame",
    5046: "04 Internal board carrier",
    10056: "05 Ventilated upper plate",
}

PART_ORDER = (
    "01 Base tray",
    "02 Front I-O frame",
    "03 Rear I-O frame",
    "04 Internal board carrier",
    "05 Ventilated upper plate",
    "06 Raspberry Pi board",
)

# Three 5 mm counterbores in the authored upper plate define the visible case
# fasteners. These are presentation screws (M3-class socket heads) whose shaft
# axes and closed locations come from those existing holes.
SCREW_HOLES_MM = (
    (-34.44, 11.50),
    (-34.44, -27.00),
    (15.70, -27.00),
)
SCREW_SEAT_Z_MM = 42.50
SCREW_SHAFT_LENGTH_MM = 10.0
SCREW_SHAFT_RADIUS_MM = 1.50
SCREW_HEAD_HEIGHT_MM = 1.80
SCREW_HEAD_RADIUS_MM = 2.75

COLORS = {
    "01 Base tray": (0.92, 0.95, 1.0, 1.0),
    "02 Front I-O frame": (0.01, 0.07, 0.72, 1.0),
    "03 Rear I-O frame": (0.01, 0.07, 0.72, 1.0),
    "04 Internal board carrier": (0.72, 0.53, 0.0, 1.0),
    "05 Ventilated upper plate": (0.92, 0.95, 1.0, 1.0),
}

# These are pure explode vectors. The closed locations come directly from the
# 3MF build transforms and are never replaced by inferred assembly offsets.
EXPLODE_OFFSET = {
    "01 Base tray": Vector((0.0, 0.0, 0.0)),
    "02 Front I-O frame": Vector((0.0, 0.045, 0.012)),
    "03 Rear I-O frame": Vector((0.0, -0.045, 0.012)),
    "04 Internal board carrier": Vector((0.0, 0.0, 0.040)),
    "05 Ventilated upper plate": Vector((0.0, 0.0, 0.075)),
    "06 Raspberry Pi board": Vector((0.0, 0.0, 0.0)),
}


def clear_scene() -> None:
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)
    for block in list(bpy.data.meshes):
        if block.users == 0:
            bpy.data.meshes.remove(block)


def new_material(name: str, color: tuple[float, float, float, float]) -> bpy.types.Material:
    material = bpy.data.materials.new(f"{name} material")
    material.diffuse_color = color
    material.metallic = 0.04
    material.roughness = 0.36
    material.use_nodes = True
    principled = material.node_tree.nodes.get("Principled BSDF")
    principled.inputs["Base Color"].default_value = color
    principled.inputs["Metallic"].default_value = 0.04
    principled.inputs["Roughness"].default_value = 0.36
    return material


def bake_authored_pose_and_center_pivot(obj: bpy.types.Object) -> None:
    # Trimesh preserves each 3MF build-item matrix. Bake that exact matrix into
    # the mesh, convert millimetres to metres, then move the origin to the local
    # bounds center without changing a single world-space vertex.
    obj.data.transform(obj.matrix_world)
    obj.matrix_world = Matrix.Identity(4)
    # glTF is Y-up while the authored 3MF and viewer presentation are Z-up.
    obj.data.transform(Matrix.Rotation(-math.pi / 2.0, 4, "X"))
    obj.data.transform(Matrix.Scale(MM, 4))
    bounds_min = Vector(tuple(min(vertex.co[axis] for vertex in obj.data.vertices) for axis in range(3)))
    bounds_max = Vector(tuple(max(vertex.co[axis] for vertex in obj.data.vertices) for axis in range(3)))
    pivot = (bounds_min + bounds_max) * 0.5
    for vertex in obj.data.vertices:
        vertex.co -= pivot
    obj.location = pivot
    obj.data.update()


def load_parts() -> list[bpy.types.Object]:
    if not all(path.exists() for path in (SOURCE, MANIFEST)):
        raise RuntimeError("Prepared XDrive assets are missing; run prepare_xdrive_v7_with_board.py first")
    bpy.ops.import_scene.gltf(filepath=str(SOURCE))
    imported = [obj for obj in bpy.context.scene.objects if obj.type == "MESH"]
    if len(imported) != 6:
        raise RuntimeError(f"Expected six authored meshes, found {len(imported)}")

    by_role = {}
    board_assigned = False
    for obj in imported:
        vertex_count = len(obj.data.vertices)
        role = ROLE_BY_VERTEX_COUNT.get(vertex_count)
        if role is None:
            if board_assigned:
                raise RuntimeError(f"Unrecognized XDrive mesh with {vertex_count} vertices")
            role = "06 Raspberry Pi board"
            board_assigned = True
        obj.name = role
        obj.data.name = f"{role} mesh"
        obj["assembly_role"] = role[3:]
        obj["source_revision"] = "XDrive V7 with authored board"
        bake_authored_pose_and_center_pivot(obj)
        by_role[role] = obj

    for role, obj in by_role.items():
        if role == "06 Raspberry Pi board":
            if not obj.data.materials:
                obj.data.materials.append(new_material(role, (0.04, 0.25, 0.10, 1.0)))
            for material in obj.data.materials:
                material.diffuse_color = (0.04, 0.25, 0.10, 1.0)
            print(f"Prepared board: {len(obj.data.vertices)} vertices / {len(obj.data.polygons)} triangles")
        else:
            obj.data.materials.clear()
            obj.data.materials.append(new_material(role, COLORS[role]))

    if set(by_role) != set(PART_ORDER):
        raise RuntimeError(f"Incomplete XDrive role map: {sorted(by_role)}")
    return [by_role[role] for role in PART_ORDER]


def create_screw_mesh(name: str, material: bpy.types.Material) -> bpy.types.Object:
    """Create a compact socket-head screw with its pivot on the shaft axis."""
    shaft_length = SCREW_SHAFT_LENGTH_MM * MM
    head_height = SCREW_HEAD_HEIGHT_MM * MM

    bpy.ops.mesh.primitive_cylinder_add(
        vertices=24,
        radius=SCREW_SHAFT_RADIUS_MM * MM,
        depth=shaft_length,
        location=(0.0, 0.0, -shaft_length * 0.5),
    )
    shaft = bpy.context.object
    bpy.ops.mesh.primitive_cylinder_add(
        vertices=32,
        radius=SCREW_HEAD_RADIUS_MM * MM,
        depth=head_height,
        location=(0.0, 0.0, head_height * 0.5),
    )
    head = bpy.context.object

    # A shallow hex socket makes the axial rotation readable in the viewer.
    bpy.ops.mesh.primitive_cylinder_add(
        vertices=6,
        radius=1.18 * MM,
        depth=0.85 * MM,
        location=(0.0, 0.0, head_height - 0.25 * MM),
    )
    cutter = bpy.context.object
    modifier = head.modifiers.new("Hex socket", "BOOLEAN")
    modifier.operation = "DIFFERENCE"
    modifier.solver = "EXACT"
    modifier.object = cutter
    bpy.context.view_layer.objects.active = head
    bpy.ops.object.modifier_apply(modifier=modifier.name)
    bpy.data.objects.remove(cutter, do_unlink=True)

    bpy.ops.object.select_all(action="DESELECT")
    shaft.select_set(True)
    head.select_set(True)
    bpy.context.view_layer.objects.active = head
    bpy.ops.object.join()
    screw = bpy.context.object
    screw.name = name
    screw.data.name = f"{name} mesh"
    screw.data.materials.append(material)

    bevel = screw.modifiers.new("Manufactured edge", "BEVEL")
    bevel.width = 0.12 * MM
    bevel.segments = 2
    bevel.limit_method = "ANGLE"
    bpy.context.view_layer.objects.active = screw
    bpy.ops.object.modifier_apply(modifier=bevel.name)

    bounds_min = Vector(tuple(min(vertex.co[axis] for vertex in screw.data.vertices) for axis in range(3)))
    bounds_max = Vector(tuple(max(vertex.co[axis] for vertex in screw.data.vertices) for axis in range(3)))
    center = (bounds_min + bounds_max) * 0.5
    for vertex in screw.data.vertices:
        vertex.co -= center
    screw.data.update()
    screw["assembly_role"] = "Upper-plate mounting screw"
    screw["hardware_class"] = "Representative M3 socket head"
    screw["pivot_axis"] = "local Z"
    # Return the offset from shaft/head interface to the centered object origin.
    screw["seat_to_origin_m"] = center.z
    return screw


def add_screws() -> list[bpy.types.Object]:
    material = new_material("Mounting screws", (0.035, 0.045, 0.060, 1.0))
    material.metallic = 0.88
    material.roughness = 0.22
    principled = material.node_tree.nodes.get("Principled BSDF")
    principled.inputs["Metallic"].default_value = 0.88
    principled.inputs["Roughness"].default_value = 0.22

    screws = []
    for index, (x_mm, y_mm) in enumerate(SCREW_HOLES_MM, start=1):
        screw = create_screw_mesh(f"{6 + index:02d} Upper plate screw {index}", material)
        screw.location = Vector((
            x_mm * MM,
            y_mm * MM,
            SCREW_SEAT_Z_MM * MM + screw["seat_to_origin_m"],
        ))
        screws.append(screw)
    return screws


def animate(parts: list[bpy.types.Object], screws: list[bpy.types.Object]) -> None:
    scene = bpy.context.scene
    scene.frame_start = 1
    scene.frame_end = 250
    scene.render.fps = 25
    # Load expanded so the viewer frames the full motion envelope. The enclosure
    # closes first, then each screw seats with an axial turn. Disassembly runs in
    # reverse so no plate moves through an installed fastener.
    exploded_frames = (1, 30, 240, 250)
    closed_frames = (100, 212)
    for obj in parts:
        closed = obj.location.copy()
        exploded = closed + EXPLODE_OFFSET[obj.name]
        for frame in closed_frames:
            obj.location = closed
            obj.keyframe_insert(data_path="location", frame=frame, group="Assembly motion")
        for frame in exploded_frames:
            obj.location = exploded
            obj.keyframe_insert(data_path="location", frame=frame, group="Assembly motion")
        if obj.animation_data and obj.animation_data.action:
            obj.animation_data.action.name = f"XDrive V7 explode {obj.name[:2]}"

    for index, screw in enumerate(screws):
        closed = screw.location.copy()
        raised = closed + Vector((0.0, 0.0, (95.0 + index * 8.0) * MM))
        assembly_start = 105 + index * 11
        assembly_end = assembly_start + 18
        removal_sequence = len(screws) - 1 - index
        removal_start = 170 + removal_sequence * 11
        removal_end = removal_start + 18

        for frame in (1, 30, 100, assembly_start):
            screw.location = raised
            screw.rotation_euler.z = 0.0
            screw.keyframe_insert(data_path="location", frame=frame, group="Fastener motion")
            screw.keyframe_insert(data_path="rotation_euler", frame=frame, group="Fastener motion")
        for frame in (assembly_end, 165, removal_start):
            screw.location = closed
            screw.rotation_euler.z = -math.tau * 4.0
            screw.keyframe_insert(data_path="location", frame=frame, group="Fastener motion")
            screw.keyframe_insert(data_path="rotation_euler", frame=frame, group="Fastener motion")
        for frame in (removal_end, 240, 250):
            screw.location = raised
            screw.rotation_euler.z = 0.0
            screw.keyframe_insert(data_path="location", frame=frame, group="Fastener motion")
            screw.keyframe_insert(data_path="rotation_euler", frame=frame, group="Fastener motion")
        if screw.animation_data and screw.animation_data.action:
            screw.animation_data.action.name = f"XDrive V7 fastener {index + 1:02d}"


def world_bounds(objects: list[bpy.types.Object]) -> tuple[Vector, Vector]:
    corners = [obj.matrix_world @ Vector(corner) for obj in objects for corner in obj.bound_box]
    lo = Vector(tuple(min(point[axis] for point in corners) for axis in range(3)))
    hi = Vector(tuple(max(point[axis] for point in corners) for axis in range(3)))
    return lo, hi


def validate_authored_pose(parts: list[bpy.types.Object], screws: list[bpy.types.Object]) -> None:
    scene = bpy.context.scene
    scene.frame_set(145)
    bpy.context.view_layer.update()
    lo, hi = world_bounds(parts)
    actual = np.array((tuple(lo), tuple(hi))) / MM
    expected = np.array(json.loads(MANIFEST.read_text(encoding="utf-8"))["sceneBoundsMillimeters"])
    if not np.allclose(actual, expected, atol=0.02):
        raise RuntimeError(f"Authored pose bounds changed: expected={expected.tolist()}, actual={actual.tolist()}")
    for index, (screw, (x_mm, y_mm)) in enumerate(zip(screws, SCREW_HOLES_MM), start=1):
        if not np.allclose((screw.location.x / MM, screw.location.y / MM), (x_mm, y_mm), atol=0.01):
            raise RuntimeError(f"Screw {index} is not aligned to its authored upper-plate hole")
    print(f"Authored pose bounds preserved: {tuple(round(value / MM, 3) for value in (hi - lo))} mm")


def validate_exploded_clearance(parts: list[bpy.types.Object]) -> None:
    scene = bpy.context.scene
    scene.frame_set(1)
    bpy.context.view_layer.update()
    trees = {}
    for obj in parts:
        trees[obj.name] = BVHTree.FromPolygons(
            [obj.matrix_world @ vertex.co for vertex in obj.data.vertices],
            [[vertex for vertex in polygon.vertices] for polygon in obj.data.polygons],
            all_triangles=True,
        )
    allowed_pair = frozenset(("01 Base tray", "06 Raspberry Pi board"))
    for left in range(len(parts)):
        for right in range(left + 1, len(parts)):
            pair = frozenset((parts[left].name, parts[right].name))
            if pair == allowed_pair:
                continue
            if trees[parts[left].name].overlap(trees[parts[right].name]):
                raise RuntimeError(f"Exploded parts still clip: {parts[left].name} / {parts[right].name}")
    print("Exploded pose clearance check passed")


def configure_preview() -> None:
    scene = bpy.context.scene
    scene.world.color = (0.018, 0.026, 0.050)
    scene.render.engine = "BLENDER_WORKBENCH"
    scene.display.shading.light = "STUDIO"
    scene.display.shading.studio_light = "paint.sl"
    scene.display.shading.color_type = "MATERIAL"
    scene.display.shading.show_shadows = True
    scene.display.shading.show_cavity = True
    scene.display.shading.cavity_type = "WORLD"
    scene.display.shading.background_type = "VIEWPORT"
    scene.display.shading.background_color = (0.025, 0.045, 0.090)
    scene.render.resolution_x = 1400
    scene.render.resolution_y = 1000
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = "PNG"


def frame_camera(camera: bpy.types.Object, objects: list[bpy.types.Object]) -> None:
    lo, hi = world_bounds(objects)
    center = (lo + hi) * 0.5
    size = max(hi - lo)
    camera.location = center + Vector((size * 1.55, -size * 1.80, size * 1.15))
    camera.rotation_euler = (center - camera.location).to_track_quat("-Z", "Y").to_euler()


def render_previews(objects: list[bpy.types.Object]) -> None:
    configure_preview()
    camera_data = bpy.data.cameras.new("Preview camera")
    camera_data.lens = 62
    camera_data.clip_start = 0.001
    camera = bpy.data.objects.new("Preview camera", camera_data)
    bpy.context.collection.objects.link(camera)
    bpy.context.scene.camera = camera
    for frame, filename in ((145, "authored-closed.png"), (1, "authored-exploded.png")):
        bpy.context.scene.frame_set(frame)
        frame_camera(camera, objects)
        bpy.context.scene.render.filepath = str(PREVIEW_DIR / filename)
        bpy.ops.render.render(write_still=True)


def merge_glb_animations(path: Path) -> None:
    with path.open("rb") as handle:
        magic, version, _ = struct.unpack("<4sII", handle.read(12))
        chunks = []
        while header := handle.read(8):
            length, chunk_type = struct.unpack("<II", header)
            chunks.append((chunk_type, handle.read(length)))
    if magic != b"glTF" or version != 2:
        raise RuntimeError("Unexpected GLB header")
    json_type = 0x4E4F534A
    json_index = next(index for index, (kind, _) in enumerate(chunks) if kind == json_type)
    document = json.loads(chunks[json_index][1].decode("utf-8").rstrip("\x00 "))
    samplers = []
    channels = []
    for animation in document.get("animations", []):
        offset = len(samplers)
        samplers.extend(animation.get("samplers", []))
        for channel in animation.get("channels", []):
            copied = dict(channel)
            copied["sampler"] = channel["sampler"] + offset
            channels.append(copied)
    document["animations"] = [{
        "name": "Explode and reassemble (10 seconds)",
        "samplers": samplers,
        "channels": channels,
        "extras": {
            "revision": "XDrive V7 with authored board",
            "durationSeconds": 10,
            "closedPoseSource": "3MF build transforms",
            "fastenerCount": 3,
        },
    }]
    encoded = json.dumps(document, separators=(",", ":")).encode("utf-8")
    encoded += b" " * ((4 - len(encoded) % 4) % 4)
    chunks[json_index] = (json_type, encoded)
    total = 12 + sum(8 + len(payload) for _, payload in chunks)
    with path.open("wb") as handle:
        handle.write(struct.pack("<4sII", b"glTF", 2, total))
        for kind, payload in chunks:
            handle.write(struct.pack("<II", len(payload), kind))
            handle.write(payload)


def export_glb(objects: list[bpy.types.Object]) -> None:
    bpy.context.scene.frame_set(1)
    bpy.ops.object.select_all(action="DESELECT")
    for obj in objects:
        obj.select_set(True)
    bpy.context.view_layer.objects.active = objects[0]
    bpy.ops.export_scene.gltf(
        filepath=str(OUTPUT),
        export_format="GLB",
        use_selection=True,
        export_animations=True,
        export_frame_range=True,
        export_force_sampling=True,
    )
    merge_glb_animations(OUTPUT)


def main() -> None:
    clear_scene()
    parts = load_parts()
    screws = add_screws()
    objects = parts + screws
    animate(parts, screws)
    validate_authored_pose(parts, screws)
    validate_exploded_clearance(parts)
    render_previews(objects)
    bpy.ops.wm.save_as_mainfile(filepath=str(BLEND_OUTPUT))
    export_glb(objects)
    BUILD_LOG.write_text(
        "SUCCESS\n"
        f"output={OUTPUT}\n"
        f"sizeBytes={OUTPUT.stat().st_size}\n"
        f"boardVertices={len(parts[-1].data.vertices)}\n"
        f"boardTriangles={len(parts[-1].data.polygons)}\n"
        f"fasteners={len(screws)}\n",
        encoding="utf-8",
    )
    print(f"Wrote {OUTPUT}")


try:
    main()
except Exception:
    BUILD_LOG.write_text("FAILED\n" + traceback.format_exc(), encoding="utf-8")
    raise
