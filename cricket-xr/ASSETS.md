# Assets and licences

Everything outside the code is free to use. Nothing here needs attribution, but the sources are
credited anyway.

## What is used

| Files | What | Where it came from |
|---|---|---|
| `public/models/coach.glb` | The coach (animated low-poly character, with `idle`, `attack-melee-right`, `emote-yes`, `emote-no`) | Kenney (CC0) |
| `public/models/tree_*.glb`, `bush*.glb`, `fence.glb`, `tent.glb`, `rock_*.glb` | The village-green scenery | Kenney / Quaternius (CC0) |
| `public/audio/{hit,coin,hurt,level_up,ui}.ogg` | Sound effects (bat hit, catch, miss, round over, start) | Kenney sound packs (CC0) |
| `public/CC0-1.0.txt` | The CC0 1.0 legal text | |

The cricket bat, the ball, the pitch, the stumps, the sky, the scoreboard and the particle effects are
generated in code, not loaded from files.

## Provenance, and what I could not check

The files were taken from the `@netforge/asset-library-files` 0.2.0 package on npm, a third-party mirror
of CC0 packs by Kenney and Quaternius. Its `NOTICE` (copied here as `ASSETS-NOTICE.txt`) lists each pack,
its author, and where the CC0 licence was read. The original sites (kenney.nl, quaternius.com) were not
reachable from the environment this was built in, so I could not re-read each licence at the source, and
the package does not record which pack each individual file came from. Before submitting, it is worth
opening the two packs' pages and confirming they still say CC0.

## What was changed

The models shipped meshopt-compressed (`EXT_meshopt_compression`), which IWSDK's loader cannot read. They
were decoded once with glTF-Transform and saved as plain GLB, with no change to the geometry, textures or
animations.
