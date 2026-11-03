# Rebuilding the pitcher model

`public/models/pitcher.glb` is built from two free CC0 packs by Quaternius:

- Universal Base Characters (Standard): `Base Characters/Godot - UE/Superhero_Male_FullBody.gltf`, its
  `.bin` and textures.
- Universal Animation Library (Standard): `Unreal-Godot/UAL1_Standard.glb`.

Both are at quaternius.com (and mirrored, unchanged, in the GitHub repository
`NafisRayan/Animate-Rigged-Humanoid-No-Blender`). Put the character files in one folder (`char/`).
Two image names the `.gltf` refers to are missing from the pack; copy them:
`T_Hair_1_Normal.png` to `T_Hair_1_Normal_png.png`, and `T_Eye_Normal.png` to `T_Eye_Normal_png.png`.

```bash
npm i @gltf-transform/core@4 @gltf-transform/functions@4    # in a scratch folder with these scripts
node uv-regions.mjs char/Superhero_Male_FullBody.gltf regions.json
python3 paint-uniform.py regions.json char out /usr/share/fonts/truetype/dejavu/DejaVuSerif-Bold.ttf   # needs Pillow and NumPy
# also write out/hair_basecolor.jpg and out/hair_normal.jpg: char/T_Hair_1_BaseColor.png and
# char/T_Hair_1_Normal.png resized to 512 px (they are only used by the eyebrows)
node build-pitcher.mjs char UAL1_Standard.glb out pitcher.glb Idle_Loop
```

- `uv-regions.mjs` tags each body triangle jersey, undershirt sleeve, pants, calf, shoes or skin by its
  dominant bone, with its rest-pose 3D position.
- `paint-uniform.py` rasterises those triangles into texture space with the 3D position per texel, paints
  the uniform (scarlet jersey with "Aces" and 17 projected on, navy undershirt, road-grey pants to below the
  knee, navy belt, scarlet socks, black cleats), softens the normal map under the cloth, cleans the stubble
  off the jaw and warms the skin tone. Any bold TrueType font works for the lettering.
- `build-pitcher.mjs` swaps in the painted textures, copies the idle clip, drops unused vertex data and writes
  one GLB (about 1 MB).
