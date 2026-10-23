# XDrive enclosure source progression

This directory preserves the source geometry supplied for the XDrive viewer update.

| Repository file | Original file | Role | Geometry check |
| --- | --- | --- | --- |
| `XDrive_V5_progression.stl` | `XDdrive V5.stl` | Earlier enclosure reference showing the mechanical progression | Watertight mesh containing 12 connected components |
| `XDrive_V7_current.3mf` | `xDrive V7.3mf` | Current printable enclosure source | Five build objects; each top-level object is watertight |

The V7 3MF is the authority for the viewer model. Its five parts remain separate in `XDrive_V7_ExplodedAssembly.glb`, with a ten-second explode-and-reassemble sequence.

The 3MF stores the objects in print-plate positions. `build_xdrive_v7_exploded.py` restores the shared rear datum, carrier heights, and enclosure stack before exporting the GLB. The script also writes assembled and exploded verification renders to the local inspection directory.

The accompanying build video will be stored through Git LFS; this repository already tracks `*.mp4` with LFS.
