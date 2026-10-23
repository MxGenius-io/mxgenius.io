"""Validate the viewer-ready XDrive V7 GLB structure and assembly pivots."""

import json
import math
import struct
from pathlib import Path


ROOT = Path(__file__).resolve().parents[4]
GLB = ROOT / "3d-viewer" / "models" / "XDrive_V7_ExplodedAssembly.glb"
JSON_CHUNK = 0x4E4F534A


def read_document(path):
    with path.open("rb") as handle:
        magic, version, _ = struct.unpack("<4sII", handle.read(12))
        assert magic == b"glTF" and version == 2
        while header := handle.read(8):
            length, chunk_type = struct.unpack("<II", header)
            payload = handle.read(length)
            if chunk_type == JSON_CHUNK:
                return json.loads(payload.decode("utf-8").rstrip("\x00 "))
    raise AssertionError("GLB has no JSON chunk")


document = read_document(GLB)
mesh_nodes = [node for node in document["nodes"] if "mesh" in node]
assert len(mesh_nodes) == 5, f"expected 5 mesh nodes, found {len(mesh_nodes)}"

for node in mesh_nodes:
    primitive = document["meshes"][node["mesh"]]["primitives"][0]
    position = document["accessors"][primitive["attributes"]["POSITION"]]
    local_center = [(low + high) * 0.5 for low, high in zip(position["min"], position["max"])]
    assert math.dist(local_center, (0.0, 0.0, 0.0)) < 1e-5, (
        f'{node.get("name", "mesh node")} pivot is outside its local bounds center: {local_center}'
    )

animations = document.get("animations", [])
assert len(animations) == 1, f"expected one merged animation, found {len(animations)}"
animation = animations[0]
assert animation.get("name") == "Explode and reassemble (10 seconds)"
assert len(animation["channels"]) == 5, f'expected 5 animation channels, found {len(animation["channels"])}'
assert {channel["target"]["path"] for channel in animation["channels"]} == {"translation"}

animated_nodes = {channel["target"]["node"] for channel in animation["channels"]}
mesh_node_indices = {index for index, node in enumerate(document["nodes"]) if "mesh" in node}
assert animated_nodes == mesh_node_indices, "animation does not address every mesh exactly once"
assert animation.get("extras", {}).get("durationSeconds") == 10

print(f"Validated {GLB.name}: 5 centered pivots, 5 translation tracks, one 10-second animation")
