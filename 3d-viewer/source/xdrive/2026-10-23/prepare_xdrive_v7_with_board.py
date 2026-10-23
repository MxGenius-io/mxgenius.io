"""Prepare the authored XDrive V7 3MF assembly for Blender.

The Bambu 3MF stores six build items with the closed-pose transforms shown in
the slicer. This step preserves those transforms, reduces the two-million-face
Pi mesh, and bakes its original 8K texture into lightweight vertex colors. A
1K texture copy is also retained in the build cache for visual auditing.
"""

from __future__ import annotations

import io
import json
import zipfile
import xml.etree.ElementTree as ET
from pathlib import Path

import fast_simplification
import numpy as np
import trimesh
from PIL import Image


ROOT = Path(__file__).resolve().parents[4]
SOURCE = Path(__file__).with_name("XDrive_V7_with_board.3mf")
CACHE = ROOT.parent / ".codex-tmp" / "xdrive-v7-with-board"
AUTHORED_GLB = CACHE / "authored-assembly.glb"
BOARD_TEXTURE = CACHE / "board-basecolor-1024.png"
MANIFEST = CACHE / "authored-assembly.json"

NS = {"m": "http://schemas.microsoft.com/3dmanufacturing/core/2015/02"}
BOARD_OBJECT_ID = "11"
BOARD_TARGET_TRIANGLES = 120_000


def triangle_property_indices(triangle: ET.Element) -> tuple[int, int, int]:
    p1 = int(triangle.attrib["p1"])
    p2 = int(triangle.attrib.get("p2", p1))
    p3 = int(triangle.attrib.get("p3", p2))
    return p1, p2, p3


def baked_vertex_colors(
    vertices: np.ndarray,
    faces: np.ndarray,
    loop_uv: np.ndarray,
    image: Image.Image,
) -> np.ndarray:
    pixels = np.asarray(image, dtype=np.uint8)
    height, width = pixels.shape[:2]
    wrapped = np.mod(loop_uv, 1.0)
    x = np.clip(np.rint(wrapped[:, 0] * (width - 1)).astype(np.int32), 0, width - 1)
    y = np.clip(np.rint((1.0 - wrapped[:, 1]) * (height - 1)).astype(np.int32), 0, height - 1)
    loop_colors = pixels[y, x, :3]
    vertex_ids = faces.reshape(-1)
    counts = np.bincount(vertex_ids, minlength=len(vertices)).astype(np.float64)
    counts[counts == 0] = 1.0
    colors = np.empty((len(vertices), 3), dtype=np.float64)
    for channel in range(3):
        colors[:, channel] = np.bincount(
            vertex_ids,
            weights=loop_colors[:, channel],
            minlength=len(vertices),
        ) / counts
    return colors


def simplify_board(board: trimesh.Trimesh, vertex_colors: np.ndarray) -> trimesh.Trimesh:
    vertices = np.ascontiguousarray(board.vertices, dtype=np.float64)
    faces = np.ascontiguousarray(board.faces, dtype=np.int32)
    dec_vertices, dec_faces, collapses = fast_simplification.simplify(
        vertices,
        faces,
        target_count=BOARD_TARGET_TRIANGLES,
        agg=8.0,
        return_collapses=True,
        preserve_border=True,
    )
    replay_vertices, replay_faces, original_to_decimated = fast_simplification.replay_simplification(
        vertices,
        faces,
        collapses,
    )
    if replay_vertices.shape != dec_vertices.shape or replay_faces.shape != dec_faces.shape:
        raise RuntimeError("Board simplification replay changed mesh dimensions")

    valid = original_to_decimated >= 0
    mapped = original_to_decimated[valid]
    counts = np.bincount(mapped, minlength=len(dec_vertices)).astype(np.float64)
    counts[counts == 0] = 1.0
    dec_colors = np.empty((len(dec_vertices), 4), dtype=np.uint8)
    for channel in range(3):
        sums = np.bincount(
            mapped,
            weights=vertex_colors[valid, channel],
            minlength=len(dec_vertices),
        )
        dec_colors[:, channel] = np.clip(np.rint(sums / counts), 0, 255).astype(np.uint8)
    dec_colors[:, 3] = 255

    simplified = trimesh.Trimesh(vertices=dec_vertices, faces=dec_faces, process=False)
    simplified.visual = trimesh.visual.ColorVisuals(mesh=simplified, vertex_colors=dec_colors)
    return simplified


def replace_board(scene: trimesh.Scene, simplified_board: trimesh.Trimesh) -> trimesh.Scene:
    rebuilt = trimesh.Scene()
    for node_name in scene.graph.nodes_geometry:
        transform, geometry_name = scene.graph.get(node_name)
        geometry = simplified_board if geometry_name == BOARD_OBJECT_ID else scene.geometry[geometry_name]
        rebuilt.add_geometry(
            geometry,
            node_name=node_name,
            geom_name=geometry_name,
            transform=transform,
        )
    return rebuilt


def prepare() -> None:
    CACHE.mkdir(parents=True, exist_ok=True)
    source_scene = trimesh.load(SOURCE, force="scene", process=False)
    source_bounds = source_scene.bounds.copy()

    with zipfile.ZipFile(SOURCE) as archive:
        root = ET.fromstring(archive.read("3D/3dmodel.model"))
        texture_group = next(
            (
                element
                for element in root.iter()
                if element.tag.rsplit("}", 1)[-1] == "texture2dgroup" and element.attrib.get("id") == "19"
            ),
            None,
        )
        if texture_group is None:
            raise RuntimeError("The board texture coordinate group is missing")
        coordinates = np.empty((len(texture_group), 2), dtype=np.float32)
        for index, coordinate in enumerate(texture_group):
            coordinates[index] = (float(coordinate.attrib["u"]), float(coordinate.attrib["v"]))

        board_xml = root.find(f".//m:resources/m:object[@id='{BOARD_OBJECT_ID}']/m:mesh", NS)
        if board_xml is None:
            raise RuntimeError("The Raspberry Pi mesh is missing")
        triangles = board_xml.find("m:triangles", NS)
        if triangles is None:
            raise RuntimeError("The Raspberry Pi mesh has no triangles")
        loop_uv = np.empty((len(triangles) * 3, 2), dtype=np.float32)
        for index, triangle in enumerate(triangles):
            loop_uv[index * 3 : index * 3 + 3] = coordinates[list(triangle_property_indices(triangle))]

        original_image = Image.open(io.BytesIO(archive.read("3D/Texture/texture_0.png"))).convert("RGB")
        image = original_image.copy()
        image.thumbnail((1024, 1024), Image.Resampling.LANCZOS)
        image.save(BOARD_TEXTURE, optimize=True)

    source_board = source_scene.geometry[BOARD_OBJECT_ID]
    colors = baked_vertex_colors(source_board.vertices, source_board.faces, loop_uv, image)
    simplified_board = simplify_board(source_board, colors)
    scene = replace_board(source_scene, simplified_board)
    AUTHORED_GLB.write_bytes(scene.export(file_type="glb"))

    manifest = {
        "source": SOURCE.name,
        "sourceSizeBytes": SOURCE.stat().st_size,
        "sceneBoundsMillimeters": source_bounds.tolist(),
        "meshCount": len(scene.geometry),
        "boardObjectId": BOARD_OBJECT_ID,
        "boardSourceVertices": int(len(source_board.vertices)),
        "boardSourceTriangles": int(len(source_board.faces)),
        "boardPreparedVertices": int(len(simplified_board.vertices)),
        "boardPreparedTriangles": int(len(simplified_board.faces)),
        "boardColorSource": "1024px texture baked to vertex colors",
        "nodes": {},
    }
    for node_name in scene.graph.nodes_geometry:
        transform, geometry_name = scene.graph.get(node_name)
        geometry = scene.geometry[geometry_name]
        manifest["nodes"][node_name] = {
            "geometry": geometry_name,
            "vertices": int(len(geometry.vertices)),
            "triangles": int(len(geometry.faces)),
            "transform": transform.tolist(),
        }
    MANIFEST.write_text(json.dumps(manifest, indent=2), encoding="utf-8")

    print(f"Wrote {AUTHORED_GLB} ({AUTHORED_GLB.stat().st_size} bytes)")
    print(
        "Board reduction: "
        f"{len(source_board.faces)} -> {len(simplified_board.faces)} triangles, "
        f"texture baked from {image.width}x{image.height} source"
    )
    print(f"Authored bounds: {source_bounds.tolist()} mm")


if __name__ == "__main__":
    prepare()
