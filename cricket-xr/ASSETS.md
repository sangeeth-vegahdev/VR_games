# Assets and licences

Everything outside the code is free to use. The models and sounds are CC0 (no attribution needed, but the
sources are credited anyway); the hand model is MIT, whose only condition is keeping its licence text,
which ships as `public/LICENSE-webxr-input-profiles.txt`.

## What is used

| Files | What | Where it came from |
|---|---|---|
| `public/models/coach.glb` | The coach: a realistic rigged human (`Superhero_Male_FullBody`) with the `Idle_Loop` clip | Quaternius "Universal Base Characters" (Standard) and "Universal Animation Library" (Standard), both CC0 1.0. Changed: see below |
| `public/models/tree_*.glb`, `bush*.glb`, `fence.glb`, `tent.glb`, `rock_*.glb` | The village-green scenery | Kenney / Quaternius (CC0) |
| `public/audio/{hit,coin,hurt,level_up,ui}.ogg` | Sound effects (bat hit, catch, miss, round over, start) | Kenney sound packs (CC0) |
| `public/models/hand-left.glb`, `hand-right.glb` | The player's hands: a rigged hand (25 joints) that hand tracking drives, drawn solid in skin tone. The right hand is also the mouse hand on a PC | `generic-hand` from `@webxr-input-profiles/assets` 1.0.20 on npm (MIT, Copyright 2019 Amazon), unchanged |
| `public/LICENSE-webxr-input-profiles.txt` | The MIT licence text for the hand model | |
| `public/CC0-1.0.txt` | The CC0 1.0 legal text | |
| `public/LICENSE-quaternius-base-characters.txt` | The licence note shipped with the coach's source pack | Quaternius, unchanged |

The cricket bat, the coach's cap, the ball (red leather, stitched seam), the grass and pitch textures, the
stumps, boundary rope, sightscreen, the sky, the scoreboard and the particle effects are generated in code,
not loaded from files. The coach's swing, toss and reactions are key poses in `src/coach.js`.

The hand model is the same file the Immersive Web SDK would otherwise download from a CDN
(cdn.jsdelivr.net) when a hand connects. It was taken from the npm package so the game works offline and on
networks that block that CDN; its licence was read from the package's `LICENSE.md`.

## Provenance, and what I could not check

The files were taken from the `@netforge/asset-library-files` 0.2.0 package on npm, a third-party mirror
of CC0 packs by Kenney and Quaternius. Its `NOTICE` (copied here as `ASSETS-NOTICE.txt`) lists each pack,
its author, and where the CC0 licence was read. The original sites (kenney.nl, quaternius.com) were not
reachable from the environment this was built in, so I could not re-read each licence at the source, and
the package does not record which pack each individual file came from. Before submitting, it is worth
opening the two packs' pages and confirming they still say CC0.

## The coach

The two Quaternius packs were taken from a GitHub repository that redistributes the free Standard
versions unchanged together with their licence files (`NafisRayan/Animate-Rigged-Humanoid-No-Blender`).
Their `License_Standard.txt` and `License.txt` both read "CC0 1.0 Universal (CC0 1.0) Public Domain
Dedication", models by @Quaternius. The packs' own page is quaternius.com.

`tools/coach/` rebuilds `coach.glb` from those packs, and changes this much:
- A training kit (navy top, charcoal trousers, white trainers) is painted onto the body texture, using
  each triangle's dominant bone to find the shirt, trousers and shoes; the normal map is softened under
  the cloth. Textures are 1024 px JPEG.
- The separate hair mesh is left out (the game gives him a cap). Unused vertex streams are dropped.
- The `Idle_Loop` clip from the animation library is copied onto the character (same skeleton).

## What was changed (scenery)

The models shipped meshopt-compressed (`EXT_meshopt_compression`), which IWSDK's loader cannot read. They
were decoded once with glTF-Transform and saved as plain GLB, with no change to the geometry, textures or
animations.
