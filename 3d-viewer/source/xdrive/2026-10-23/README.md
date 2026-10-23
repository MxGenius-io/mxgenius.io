# XDrive enclosure source progression

This directory preserves the source geometry supplied for the XDrive viewer update.

| Repository file | Original file | Role | Geometry check |
| --- | --- | --- | --- |
| `XDrive_V5_progression.stl` | `XDdrive V5.stl` | Earlier enclosure reference showing the mechanical progression | Watertight mesh containing 12 connected components |
| `XDrive_V7_current.3mf` | `xDrive V7.3mf` | Current printable enclosure source | Five build objects; each top-level object is watertight |

The V7 3MF is the authority for the next viewer model. Its five parts remain separate so an authored exploded assembly can replace `XDrive_Rev3_ExplodedAssembly.glb` without losing the assembly sequence.

The 3MF stores the objects in print-plate positions. Their final assembled transforms and explosion directions must be authored and visually verified before the live Rev3 viewer entry is replaced.

The accompanying build video will be stored through Git LFS; this repository already tracks `*.mp4` with LFS.
