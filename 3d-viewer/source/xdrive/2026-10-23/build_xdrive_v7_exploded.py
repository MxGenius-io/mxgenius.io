"""Build the viewer-ready XDrive V7 exploded assembly from the archived 3MF.

The 3MF stores the five printable parts in plate layout.  This script restores
their shared assembly datums, adds a ten-second explode/reassemble animation,
and exports the GLB used by the MXGenius model viewer.
"""

import bpy
import json
import os
import struct
import zipfile
import xml.etree.ElementTree as ET
from mathutils import Vector
from mathutils.bvhtree import BVHTree


ROOT = r"D:\AAog\mxgenius.io"
SOURCE = os.path.join(ROOT, "3d-viewer", "source", "xdrive", "2026-10-23", "XDrive_V7_current.3mf")
OUTPUT = os.path.join(ROOT, "3d-viewer", "models", "XDrive_V7_ExplodedAssembly.glb")
PREVIEW_DIR = r"D:\AAog\.codex-tmp\xdrive-v7-inspect\v7-assembly"
os.makedirs(PREVIEW_DIR, exist_ok=True)

MM = 0.001
NS = {"m": "http://schemas.microsoft.com/3dmanufacturing/core/2015/02"}

# Plate-layout coordinates are translated onto shared reference datums.  The
# source 3MF contains independent print-bed parts and does not preserve a
# closed-assembly transform.  These values align the repeated perimeter and
# mounting-hole patterns without presenting that inferred pose as assembled.
REFERENCE_DATUM_MM = [
    (0.000, 0.000, 0.000),       # base tray
    (-2.879, 67.420, 3.500),     # rear I/O wall; vertical face at base rear
    (-2.968, 90.697, 17.500),    # upper U trim; 0.8 mm above base top
    (-102.864, 64.794, 3.500),   # internal carrier; rear edge at base rear
    (-109.220, -9.836, 27.700),  # upper plate; hole pattern aligned to carrier
]

# The viewer starts in a collision-free compact exploded view.  It expands to
# 1.4x these offsets and returns, so no frame collapses into an unverified pose.
COMPACT_EXPLODED_OFFSET_MM = [
    (0.0, 0.0, 0.0),
    (0.0, 45.0, 8.0),
    (-25.0, -42.0, 18.0),
    (20.0, 0.0, 40.0),
    (0.0, 0.0, 65.0),
]
EXPANDED_SCALE = 1.4

PART_NAMES = [
    "01 Base tray",
    "02 Rear I-O wall",
    "03 Upper U trim",
    "04 Internal board carrier",
    "05 Ventilated upper plate",
]

COLORS = [
    (0.62, 0.68, 0.78, 1.0),
    (0.025, 0.20, 0.62, 1.0),
    (0.72, 0.78, 0.90, 1.0),
    (0.025, 0.055, 0.13, 1.0),
    (0.03, 0.28, 0.80, 1.0),
]


def clear_scene():
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)
    for block in bpy.data.meshes:
        if block.users == 0:
            bpy.data.meshes.remove(block)


def load_parts():
    with zipfile.ZipFile(SOURCE) as archive:
        model = ET.fromstring(archive.read("3D/3dmodel.model"))

    objects = []
    reference_locations = []
    sources = [obj for obj in model.findall(".//m:resources/m:object", NS) if obj.find("m:mesh", NS) is not None]
    for index, source_object in enumerate(sources):
        mesh_xml = source_object.find("m:mesh", NS)
        source_vertices_mm = [
            Vector(tuple(float(vertex.attrib[axis]) for axis in "xyz"))
            for vertex in mesh_xml.find("m:vertices", NS)
        ]
        bounds_min = Vector(tuple(min(vertex[axis] for vertex in source_vertices_mm) for axis in range(3)))
        bounds_max = Vector(tuple(max(vertex[axis] for vertex in source_vertices_mm) for axis in range(3)))
        pivot_mm = (bounds_min + bounds_max) * 0.5
        # Keep every object's origin inside its own geometry.  The 3MF stores
        # all parts in a shared print-bed coordinate system; leaving those
        # coordinates on the mesh puts the animation pivots far outside the
        # individual parts and makes viewer manipulation look like clipping.
        vertices = [tuple((vertex - pivot_mm) * MM) for vertex in source_vertices_mm]
        triangles = [
            (int(face.attrib["v1"]), int(face.attrib["v2"]), int(face.attrib["v3"]))
            for face in mesh_xml.find("m:triangles", NS)
        ]
        mesh = bpy.data.meshes.new(f"{PART_NAMES[index]} mesh")
        mesh.from_pydata(vertices, [], triangles)
        mesh.update()
        obj = bpy.data.objects.new(PART_NAMES[index], mesh)
        bpy.context.collection.objects.link(obj)
        material = bpy.data.materials.new(f"{PART_NAMES[index]} material")
        material.diffuse_color = COLORS[index]
        material.metallic = 0.04
        material.roughness = 0.34
        material.use_nodes = True
        principled = material.node_tree.nodes.get("Principled BSDF")
        principled.inputs["Base Color"].default_value = COLORS[index]
        principled.inputs["Metallic"].default_value = 0.04
        principled.inputs["Roughness"].default_value = 0.34
        obj.data.materials.append(material)
        reference_location = (pivot_mm + Vector(REFERENCE_DATUM_MM[index])) * MM
        obj.location = reference_location
        obj["assembly_role"] = PART_NAMES[index][3:]
        obj["source_revision"] = "XDrive V7"
        obj["pivot_source_mm"] = tuple(round(value, 4) for value in pivot_mm)
        objects.append(obj)
        reference_locations.append(reference_location)
    return objects, reference_locations


def animate(objects, reference_locations):
    scene = bpy.context.scene
    scene.frame_start = 1
    scene.frame_end = 250
    scene.render.fps = 25
    compact_frames = (1, 30, 240, 250)
    expanded_frames = (110, 165)
    for index, obj in enumerate(objects):
        offset = Vector(COMPACT_EXPLODED_OFFSET_MM[index]) * MM
        compact = reference_locations[index] + offset
        expanded = reference_locations[index] + offset * EXPANDED_SCALE
        for frame in compact_frames:
            obj.location = compact
            obj.keyframe_insert(data_path="location", frame=frame, group="Assembly motion")
        for frame in expanded_frames:
            obj.location = expanded
            obj.keyframe_insert(data_path="location", frame=frame, group="Assembly motion")
        if obj.animation_data and obj.animation_data.action:
            obj.animation_data.action.name = f"XDrive V7 explode {index + 1:02d}"


def validate_reference_datums(objects):
    bpy.context.view_layer.update()

    def z_bounds(obj):
        values = [(obj.matrix_world @ Vector(corner)).z for corner in obj.bound_box]
        return min(values), max(values)

    base = z_bounds(objects[0])
    trim = z_bounds(objects[2])
    carrier = z_bounds(objects[3])
    upper = z_bounds(objects[4])
    gaps_mm = ((trim[0] - base[1]) / MM, (upper[0] - carrier[1]) / MM)
    for gap in gaps_mm:
        if abs(gap - 0.8) > 0.01:
            raise RuntimeError(f"Unexpected XDrive reference clearance: {gap:.3f} mm")
    print(f"Reference clearances: trim/base={gaps_mm[0]:.3f} mm, upper/carrier={gaps_mm[1]:.3f} mm")


def validate_animation_clearances(objects):
    scene = bpy.context.scene
    sample_frames = (1, 30, 50, 80, 110, 145, 165, 190, 220, 240, 250)
    for frame in sample_frames:
        scene.frame_set(frame)
        bpy.context.view_layer.update()
        trees = [
            BVHTree.FromPolygons(
                [obj.matrix_world @ vertex.co for vertex in obj.data.vertices],
                [[vertex for vertex in polygon.vertices] for polygon in obj.data.polygons],
                all_triangles=True,
            )
            for obj in objects
        ]
        for left in range(len(trees)):
            for right in range(left + 1, len(trees)):
                if trees[left].overlap(trees[right]):
                    raise RuntimeError(
                        f"XDrive parts {left + 1} and {right + 1} clip at animation frame {frame}"
                    )
    print(f"Animation clearance check passed at {len(sample_frames)} sampled frames")


def world_bounds(objects):
    corners = [obj.matrix_world @ Vector(corner) for obj in objects for corner in obj.bound_box]
    lo = Vector(tuple(min(point[axis] for point in corners) for axis in range(3)))
    hi = Vector(tuple(max(point[axis] for point in corners) for axis in range(3)))
    return lo, hi


def add_preview_camera(objects):
    scene = bpy.context.scene
    camera_data = bpy.data.cameras.new("Preview camera")
    camera_data.lens = 62
    camera_data.clip_start = 0.001
    camera = bpy.data.objects.new("Preview camera", camera_data)
    bpy.context.collection.objects.link(camera)
    scene.camera = camera

    lo, hi = world_bounds(objects)
    center = (lo + hi) * 0.5
    size = max(hi - lo)
    camera.location = center + Vector((size * 1.55, -size * 1.80, size * 1.15))
    camera.rotation_euler = (center - camera.location).to_track_quat("-Z", "Y").to_euler()
    return camera


def configure_preview():
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
    scene.render.film_transparent = False


def render_preview(objects):
    scene = bpy.context.scene
    configure_preview()
    add_preview_camera(objects)
    for frame, filename in ((1, "compact-exploded.png"), (145, "expanded-exploded.png")):
        scene.frame_set(frame)
        # Reframe at each state so neither preview clips the assembly.
        camera = scene.camera
        lo, hi = world_bounds(objects)
        center = (lo + hi) * 0.5
        size = max(hi - lo)
        camera.location = center + Vector((size * 1.55, -size * 1.80, size * 1.15))
        camera.rotation_euler = (center - camera.location).to_track_quat("-Z", "Y").to_euler()
        scene.render.filepath = os.path.join(PREVIEW_DIR, filename)
        bpy.ops.render.render(write_still=True)


def merge_glb_animations(path):
    with open(path, "rb") as handle:
        magic, version, _ = struct.unpack("<4sII", handle.read(12))
        chunks = []
        while True:
            header = handle.read(8)
            if not header:
                break
            length, chunk_type = struct.unpack("<II", header)
            chunks.append((chunk_type, handle.read(length)))
    if magic != b"glTF" or version != 2:
        raise RuntimeError("Unexpected GLB header")
    json_type = 0x4E4F534A
    json_index = next(i for i, (kind, _) in enumerate(chunks) if kind == json_type)
    document = json.loads(chunks[json_index][1].decode("utf-8").rstrip("\x00 "))
    animations = document.get("animations", [])
    samplers = []
    channels = []
    for animation in animations:
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
        "extras": {"revision": "XDrive V7", "durationSeconds": 10},
    }]
    encoded = json.dumps(document, separators=(",", ":")).encode("utf-8")
    encoded += b" " * ((4 - len(encoded) % 4) % 4)
    chunks[json_index] = (json_type, encoded)
    total = 12 + sum(8 + len(payload) for _, payload in chunks)
    with open(path, "wb") as handle:
        handle.write(struct.pack("<4sII", b"glTF", 2, total))
        for kind, payload in chunks:
            handle.write(struct.pack("<II", len(payload), kind))
            handle.write(payload)


def export_glb(objects):
    bpy.context.scene.frame_set(1)
    bpy.ops.object.select_all(action="DESELECT")
    for obj in objects:
        obj.select_set(True)
    bpy.context.view_layer.objects.active = objects[0]
    bpy.ops.export_scene.gltf(
        filepath=OUTPUT,
        export_format="GLB",
        use_selection=True,
        export_animations=True,
        export_frame_range=True,
        export_force_sampling=True,
    )
    merge_glb_animations(OUTPUT)


clear_scene()
parts, reference_locations = load_parts()
validate_reference_datums(parts)
animate(parts, reference_locations)
validate_animation_clearances(parts)
render_preview(parts)
export_glb(parts)
print(f"Wrote {OUTPUT}")
