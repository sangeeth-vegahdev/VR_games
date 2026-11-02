"""Paints a coach's training kit (top, trousers, trainers) onto the CC0 base character's textures.

Each body triangle was tagged by its dominant bone (uv-regions.mjs). Clothed areas get a cream
cloth colour shaded by the original texture's light and shadow, a fine weave, a softened normal
map (so muscles read as cloth folds, not bare skin) and a matte roughness. Writes 1024 px JPEG/PNG.
Usage: python3 -I paint-kit.py <regions.json> <char dir> <out dir>
"""
import json
import sys

import numpy as np
from PIL import Image, ImageDraw, ImageFilter

regions_path, char_dir, out_dir = sys.argv[1:4]
tris = json.load(open(regions_path))

base = Image.open(f"{char_dir}/T_Superhero_Male_Dark.png").convert("RGB")
normal = Image.open(f"{char_dir}/T_Superhero_Male_Normal.png").convert("RGB")
rough = Image.open(f"{char_dir}/T_Superhero_Male_Roughness.png").convert("RGB")
W, H = base.size

COLORS = {
    "shirt": (30, 48, 92),  # navy training top
    "trousers": (34, 38, 50),  # charcoal track trousers
    "shoes": (236, 236, 232),  # white trainers
}
ORDER = ["shoes", "trousers", "shirt"]  # later regions win where masks overlap

def fill_holes(mask):
    """Fills regions of the mask that the outside cannot reach (holes inside an island)."""
    outside = mask.copy()
    ImageDraw.floodfill(outside, (0, 0), 128)
    a = np.asarray(outside)
    return Image.fromarray(np.where(a == 128, 0, 255).astype(np.uint8))


masks = {}
for name in ORDER:
    m = Image.new("L", (W, H), 0)
    d = ImageDraw.Draw(m)
    for region, uvs in tris:
        if region == name:
            d.polygon([(u * W, v * H) for u, v in uvs], fill=255)
    # Close small holes (navel, single stray triangles), smooth the jagged per-triangle hems,
    # then grow a little so texture filtering never pulls skin colour across a seam.
    m = m.filter(ImageFilter.MaxFilter(15)).filter(ImageFilter.MinFilter(15))
    m = m.filter(ImageFilter.GaussianBlur(4)).point(lambda x: 255 if x > 110 else 0)
    if name != "shoes":
        m = fill_holes(m)  # e.g. the navel, which the base mesh weights to a different bone
    masks[name] = m.filter(ImageFilter.MaxFilter(5))

b = np.asarray(base, dtype=np.float32) / 255.0
lum = (0.3 * b[..., 0] + 0.59 * b[..., 1] + 0.11 * b[..., 2])
lum_blur = np.asarray(Image.fromarray((lum * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(3)), dtype=np.float32) / 255.0

nz = np.asarray(normal, dtype=np.float32)[..., 2] / 255.0
nz_blur = np.asarray(Image.fromarray((nz * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(5)), dtype=np.float32) / 255.0

rng = np.random.default_rng(3)
weave = rng.normal(0, 1, (H, W)).astype(np.float32)
weave = np.asarray(Image.fromarray(((weave * 20) + 128).clip(0, 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(0.7)), dtype=np.float32) / 255.0 - 0.5

out = b.copy()
n = np.asarray(normal, dtype=np.float32)
r = np.asarray(rough, dtype=np.float32)
flat = np.array([128, 128, 255], dtype=np.float32)
cloth_any = np.zeros((H, W), dtype=np.float32)

for name in ORDER:
    m = np.asarray(masks[name], dtype=np.float32) / 255.0
    if m.max() == 0:
        continue
    # Shade from the normal map's facing (folds and creases), not from the old skin colour,
    # so the dark shorts under the trousers do not show through.
    mean = nz_blur[m > 0.5].mean()
    shade = np.clip(0.95 + 0.8 * (nz_blur - mean), 0.78, 1.04) + 0.06 * weave
    col = np.array(COLORS[name], dtype=np.float32) / 255.0
    cloth = np.clip(col[None, None, :] * shade[..., None], 0, 1)
    out = out * (1 - m[..., None]) + cloth * m[..., None]
    cloth_any = np.maximum(cloth_any, m)

# Cloth: keep a little of the body's normal detail (folds), matte, non-metal.
k = (cloth_any * 0.85)[..., None]
n = n * (1 - k) + flat[None, None, :] * k
r[..., 1] = r[..., 1] * (1 - cloth_any) + 225 * cloth_any  # roughness lives in G
r[..., 2] = r[..., 2] * (1 - cloth_any)  # metal in B

SIZE = (1024, 1024)
Image.fromarray((out * 255).clip(0, 255).astype(np.uint8)).resize(SIZE, Image.LANCZOS).save(f"{out_dir}/coach_basecolor.jpg", quality=88)
Image.fromarray(n.clip(0, 255).astype(np.uint8)).resize(SIZE, Image.LANCZOS).save(f"{out_dir}/coach_normal.jpg", quality=90)
Image.fromarray(r.clip(0, 255).astype(np.uint8)).resize(SIZE, Image.LANCZOS).save(f"{out_dir}/coach_rough.jpg", quality=85)
prev = Image.fromarray((out * 255).clip(0, 255).astype(np.uint8)).resize((768, 768))
prev.save(f"{out_dir}/coach_basecolor_preview.png")
print("ok")
