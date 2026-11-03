# Assets and licences

Everything outside the code is free to use. The pitcher and the sounds are CC0 (no attribution needed, but
the sources are credited anyway); the hand model is MIT, whose only condition is keeping its licence text,
which ships as `public/LICENSE-webxr-input-profiles.txt`.

## What is used

| Files | What | Where it came from |
|---|---|---|
| `public/models/pitcher.glb` | The pitcher: a realistic rigged human (`Superhero_Male_FullBody`) with the `Idle_Loop` clip, painted into a baseball uniform | Quaternius "Universal Base Characters" (Standard) and "Universal Animation Library" (Standard), both CC0 1.0. Changed: see below |
| `public/audio/{coin,hurt,level_up,ui}.ogg` | Sound effects (catch chime, miss, round over, start) | Kenney sound packs (CC0) |
| `public/models/hand-left.glb`, `hand-right.glb` | The player's hands: a rigged hand (25 joints) that hand tracking drives, drawn solid in skin tone | `generic-hand` from `@webxr-input-profiles/assets` 1.0.20 on npm (MIT, Copyright 2019 Amazon), unchanged |
| `public/LICENSE-webxr-input-profiles.txt` | The MIT licence text for the hand model | |
| `public/CC0-1.0.txt` | The CC0 1.0 legal text | |
| `public/LICENSE-quaternius-base-characters.txt` | The licence note shipped with the pitcher's source pack | Quaternius, unchanged |

Made in code, not loaded from files: the catcher's mitt and the pitcher's glove, the pitcher's cap, the
baseball (leather, seam and stitching), the whole ballpark (grass, infield and home-plate textures, mound,
rubber, plate, bases, wall, ad boards, batter's eye, scoreboard, stands, crowd, light towers, stars), the
HUD and the particle effects. The pitcher's delivery, reactions and walk back are key poses in
`src/pitcher.js`. The mitt's pop, the whoosh of the pitch and the crowd are generated with Web Audio.

The jersey lettering ("Aces", "17") was drawn with DejaVu Serif Bold (Bitstream Vera licence, which permits
this) and baked into the pitcher's texture; no font file ships with the game.

## The pitcher

Built from the same two Quaternius packs as the Cricket Catch coach, taken from a GitHub repository that
redistributes the free Standard versions unchanged together with their licence files
(`NafisRayan/Animate-Rigged-Humanoid-No-Blender`). Their `License_Standard.txt` and `License.txt` both read
"CC0 1.0 Universal (CC0 1.0) Public Domain Dedication", models by @Quaternius. The packs' own page is
quaternius.com, which could not be reached from the environment this was built in; it is worth opening it
before submitting and confirming it still says CC0.

`tools/pitcher/` rebuilds `pitcher.glb` from those packs, and changes this much:
- A baseball uniform is painted onto the body texture. Each texel's garment comes from its triangle's
  dominant bone and its 3D position (so the pants end below the knee and the socks start there, the belt sits
  at the waist, and the lettering is projected onto the chest and back). The normal map is softened under
  the cloth. Textures are 1024 px JPEG.
- He is made a different-looking, younger man from the Cricket Catch coach: the stubble is cleaned off the
  jaw and the skin tone is a little fairer and rosier.
- The `Idle_Loop` clip from the animation library is copied onto the character (same skeleton). Unused
  vertex streams are dropped.

The hand model is the same file the Immersive Web SDK would otherwise download from a CDN when a hand
connects; it ships with the game so it works offline and on networks that block that CDN.
