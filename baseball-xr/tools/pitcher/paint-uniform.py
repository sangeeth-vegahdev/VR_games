"""Paints a baseball uniform onto the CC0 base character's textures, and makes him a clean-shaven
young man.

Every body triangle was tagged with the uniform part of its dominant bone, and carries its rest-pose
3D position (uv-regions.mjs). Each triangle is rasterised into texture space with its 3D position
interpolated per pixel, so the uniform is laid out on the body itself: the pants end below the knee,
the socks run down to the cleats, the belt sits at the waist and the lettering is projected onto the
chest and back like a real print.

Look: scarlet jersey with white lettering ("ACES" across the chest, 17 on the back) outlined in navy,
navy long-sleeve undershirt, road-grey pants, navy belt, scarlet socks, black cleats.

Usage: python3 -I paint-uniform.py <regions.json> <char dir> <out dir> <font.ttf>
"""
import json
import sys

import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont

regions_path, char_dir, out_dir, font_path = sys.argv[1:5]
tris = json.load(open(regions_path))

base = Image.open(f"{char_dir}/T_Superhero_Male_Dark.png").convert("RGB")
normal = Image.open(f"{char_dir}/T_Superhero_Male_Normal.png").convert("RGB")
rough = Image.open(f"{char_dir}/T_Superhero_Male_Roughness.png").convert("RGB")
W, H = base.size

PARTS = ["skin", "jersey", "sleeve", "pants", "calf", "shoes"]
PID = {p: i for i, p in enumerate(PARTS)}

# ---------- 1. rasterise: part id and 3D position for every texel ----------
part = np.full((H, W), -1, dtype=np.int8)
xyz = np.zeros((H, W, 3), dtype=np.float32)
for name, uvs, ps in tris:
    a = np.array([[u * W, v * H] for u, v in uvs], dtype=np.float64)
    P = np.array(ps, dtype=np.float32)
    x0, y0 = np.floor(a.min(0)).astype(int)
    x1, y1 = np.ceil(a.max(0)).astype(int)
    x0, y0 = max(x0, 0), max(y0, 0)
    x1, y1 = min(x1, W - 1), min(y1, H - 1)
    if x1 < x0 or y1 < y0:
        continue
    gx, gy = np.meshgrid(np.arange(x0, x1 + 1) + 0.5, np.arange(y0, y1 + 1) + 0.5)
    (ax, ay), (bx, by), (cx, cy) = a
    den = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy)
    if abs(den) < 1e-12:
        continue
    l1 = ((by - cy) * (gx - cx) + (cx - bx) * (gy - cy)) / den
    l2 = ((cy - ay) * (gx - cx) + (ax - cx) * (gy - cy)) / den
    l3 = 1 - l1 - l2
    inside = (l1 >= -0.02) & (l2 >= -0.02) & (l3 >= -0.02)
    if not inside.any():
        continue
    pos = l1[..., None] * P[0] + l2[..., None] * P[1] + l3[..., None] * P[2]
    sub_part = part[y0 : y1 + 1, x0 : x1 + 1]
    sub_xyz = xyz[y0 : y1 + 1, x0 : x1 + 1]
    sub_part[inside] = PID[name]
    sub_xyz[inside] = pos[inside]

# Grow every island a few texels so texture filtering never pulls in a neighbour's colour.
for _ in range(10):
    empty = part < 0
    if not empty.any():
        break
    for dy, dx in ((0, 1), (0, -1), (1, 0), (-1, 0)):
        sp = np.roll(part, (dy, dx), (0, 1))
        sx = np.roll(xyz, (dy, dx), (0, 1))
        take = empty & (sp >= 0) & (part < 0)
        part[take] = sp[take]
        xyz[take] = sx[take]
X, Y, Z = xyz[..., 0], xyz[..., 1], xyz[..., 2]

# Which way is "front"? The face is the forward-most part of the head.
head = (part == PID["skin"]) & (Y > 1.55)
front_sign = 1.0 if Z[head].mean() > 0 else -1.0
F = Z * front_sign  # + is in front of the body
print("front is", "+Z" if front_sign > 0 else "-Z")

# ---------- 2. clothing mask: cleaned of jagged per-triangle hems ----------
def clean(mask, close=13, grow=3):
    m = Image.fromarray((mask * 255).astype(np.uint8))
    m = m.filter(ImageFilter.MaxFilter(close)).filter(ImageFilter.MinFilter(close))
    m = m.filter(ImageFilter.GaussianBlur(3)).point(lambda x: 255 if x > 110 else 0)
    if grow:
        m = m.filter(ImageFilter.MaxFilter(grow))
    return np.asarray(m) > 127


def fill_holes(mask):
    """Fills regions the outside cannot reach (holes inside an island, such as the navel)."""
    m = Image.fromarray((mask * 255).astype(np.uint8))
    outside = m.copy()
    ImageDraw.floodfill(outside, (0, 0), 128)
    return np.asarray(outside) != 128


# Each garment is cleaned on its own (so closing never bridges two separate UV islands); the
# navel, which the base mesh weights to another bone, is filled from inside the jersey.
GARMENTS = {
    "jersey": [PID["jersey"]],
    "sleeve": [PID["sleeve"]],
    "legs": [PID["pants"], PID["calf"]],
    "shoes": [PID["shoes"]],
}
gmask = {}
for name, ids in GARMENTS.items():
    m = clean(np.isin(part, ids))
    if name in ("jersey", "legs"):
        m = fill_holes(m)
    gmask[name] = m
# Where two garments meet (jersey and undershirt at the elbow), the triangle-by-triangle split
# zig-zags. Smooth it: each texel takes the garment that dominates its neighbourhood.
names = list(GARMENTS)
scores = np.stack([
    np.asarray(Image.fromarray((gmask[k] * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(14)), dtype=np.float32)
    for k in names
])
clothed = np.zeros((H, W), dtype=bool)
for m in gmask.values():
    clothed |= m
winner = np.argmax(scores, axis=0)
G = {k: clothed & (winner == i) for i, k in enumerate(names)}

# ---------- 3. what each clothed texel is ----------
KNEE_HEM = 0.40  # pants end just below the knee (metres above the floor)
pants_top = max(q[1] for name, _, ps in tris if name == "pants" for q in ps)
BELT = (pants_top - 0.055, pants_top)

COL = {
    "jersey": (176, 24, 36),  # scarlet
    "sleeve": (26, 36, 72),  # navy undershirt
    "pants": (178, 180, 184),  # road grey
    "belt": (24, 30, 58),
    "sock": (168, 22, 34),
    "cleat": (22, 22, 26),
    "sole": (232, 232, 228),
    "letter": (250, 250, 246),
    "outline": (20, 30, 66),
}

jersey = G["jersey"]
sleeve = G["sleeve"]
legs = G["legs"]
pants = legs & (Y >= KNEE_HEM)
sock = legs & (Y < KNEE_HEM)
belt = pants & (Y >= BELT[0]) & (Y <= BELT[1])
shoes = G["shoes"]
sole = shoes & (Y < 0.025)

# ---------- 4. shading shared by all cloth ----------
b = np.asarray(base, dtype=np.float32) / 255.0
n = np.asarray(normal, dtype=np.float32)
r = np.asarray(rough, dtype=np.float32)
nz = n[..., 2] / 255.0
nz_blur = np.asarray(Image.fromarray((nz * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(5)), dtype=np.float32) / 255.0
rng = np.random.default_rng(5)
weave = rng.normal(0, 1, (H, W)).astype(np.float32)
weave = np.asarray(Image.fromarray(((weave * 20) + 128).clip(0, 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(0.7)), dtype=np.float32) / 255.0 - 0.5


def cloth(mask, rgb, sheen=0.8, grain=0.06):
    if not mask.any():
        return np.zeros((H, W, 3), dtype=np.float32)
    mean = nz_blur[mask].mean()
    shade = np.clip(0.95 + sheen * (nz_blur - mean), 0.78, 1.05) + grain * weave
    return np.clip(np.array(rgb, dtype=np.float32)[None, None, :] / 255.0 * shade[..., None], 0, 1)


out = b.copy()
layers = [
    (jersey, "jersey"),
    (sleeve, "sleeve"),
    (pants, "pants"),
    (sock, "sock"),
    (belt, "belt"),
    (shoes, "cleat"),
    (sole, "sole"),
]
for mask, key in layers:
    c = cloth(mask, COL[key], sheen=0.5 if key in ("cleat", "belt") else 0.8)
    out[mask] = c[mask]

# ---------- 5. lettering, projected onto the body ----------
font_cache = {}


def font(size):
    if size not in font_cache:
        font_cache[size] = ImageFont.truetype(font_path, size)
    return font_cache[size]


def decal(text, size_px, w_px, h_px, outline_px, slant=0.0):
    """Text image: white letters with a navy outline, on transparent. Returns (fill, outline) masks."""
    img = Image.new("L", (w_px, h_px), 0)
    ol = Image.new("L", (w_px, h_px), 0)
    f = font(size_px)
    d = ImageDraw.Draw(img)
    do = ImageDraw.Draw(ol)
    bbox = d.textbbox((0, 0), text, font=f)
    tx = (w_px - (bbox[2] - bbox[0])) / 2 - bbox[0]
    ty = (h_px - (bbox[3] - bbox[1])) / 2 - bbox[1]
    do.text((tx, ty), text, font=f, fill=255, stroke_width=outline_px, stroke_fill=255)
    d.text((tx, ty), text, font=f, fill=255)
    if slant:
        coeffs = (1, slant, -slant * h_px / 2, 0, 1, 0)
        img = img.transform(img.size, Image.AFFINE, coeffs, Image.BICUBIC)
        ol = ol.transform(ol.size, Image.AFFINE, coeffs, Image.BICUBIC)
    return np.asarray(img, dtype=np.float32) / 255.0, np.asarray(ol, dtype=np.float32) / 255.0


def project(mask, fill, outline, x_left, x_right, y_top, y_bottom):
    """Lays a decal on the clothed texels whose 3D (x, y) falls in the given box."""
    h_px, w_px = fill.shape
    u = (X - x_left) / (x_right - x_left)
    v = (y_top - Y) / (y_top - y_bottom)
    hit = mask & (u >= 0) & (u < 1) & (v >= 0) & (v < 1)
    ui = (u[hit] * (w_px - 1)).astype(int)
    vi = (v[hit] * (h_px - 1)).astype(int)
    fo = outline[vi, ui][:, None]
    ff = fill[vi, ui][:, None]
    letter = np.array(COL["letter"], np.float32) / 255.0
    edge = np.array(COL["outline"], np.float32) / 255.0
    px = out[hit]
    px = px * (1 - fo) + edge * fo
    px = px * (1 - ff) + letter * ff
    # keep the cloth's folds on the print
    shade = np.clip(0.95 + 0.8 * (nz_blur[hit] - nz_blur[mask].mean()), 0.82, 1.03)[:, None]
    out[hit] = np.where((fo + ff) > 0, np.clip(px * shade, 0, 1), out[hit])


torso = jersey & (np.abs(X) < 0.2)
# Chest: "ACES" in a slanted script, across the chest. Front view: the body's +X is the viewer's
# right when the front is +Z, so x runs left to right as-is (mirrored if the front is -Z).
fill, ol = decal("Aces", 300, 1100, 400, 18, slant=0.25)
cx = (-0.15, 0.15) if front_sign > 0 else (0.15, -0.15)
project(torso & (F > 0.02), fill, ol, cx[0], cx[1], 1.38, 1.26)
# Back: a big 17. Seen from behind, left and right swap.
fill, ol = decal("17", 380, 520, 440, 22)
bx = (0.13, -0.13) if front_sign > 0 else (-0.13, 0.13)
project(torso & (F < -0.02), fill, ol, bx[0], bx[1], 1.42, 1.17)
# Sleeve numbers would sit on the upper arms; left plain, as most clubs do.

# ---------- 6. the young man: clean-shaven, fresher skin ----------
skin = ~clothed
# Stubble lives on the lower face, which sits in the texture's top-left block (the face UV island).
# A soft ellipse over the jaw, chin and upper lip only (the eyes and brows sit above it).
gy, gx = np.mgrid[0:H, 0:W]
ell = ((gx - 350) / 300.0) ** 2 + ((gy - 615) / 150.0) ** 2
face = np.clip((1.25 - ell) / 0.5, 0, 1).astype(np.float32)
face = np.asarray(Image.fromarray((face * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(20)), dtype=np.float32) / 255.0
hsv = b.copy()
lum = 0.3 * b[..., 0] + 0.59 * b[..., 1] + 0.11 * b[..., 2]
lum_cheek = np.median(lum[150:330, 120:580])
sat = b.max(-1) - b.min(-1)
sat_cheek = np.median(sat[150:330, 120:580])
red = (b[..., 0] - b[..., 1]) > 0.28  # lips: leave them
beard = (~red & skin).astype(np.float32)
amount = np.clip((lum_cheek - lum) / 0.12, 0, 1) * 0.85 + np.clip((sat_cheek - sat) / 0.10, 0, 1) * 0.6
amount = np.clip(amount, 0, 1) * beard
amount = np.asarray(Image.fromarray((amount * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(6)), dtype=np.float32) / 255.0
amount *= face
amount *= np.clip(face * 3, 0, 1)
cheek_col = np.median(b[150:330, 120:580].reshape(-1, 3), axis=0)
# keep the face's own light and shade, at the cheek's colour
shade = np.clip(lum / max(lum_cheek, 1e-3), 0.85, 1.1)[..., None]
clean_face = np.clip(cheek_col[None, None, :] * (0.55 + 0.45 * shade), 0, 1)
out = out * (1 - amount[..., None]) + clean_face * amount[..., None]

# A slightly fairer, rosier tone than the base texture, so he reads as a different person from the
# Cricket Catch coach (who uses the texture as it comes).
tone = np.array([1.06, 1.0, 0.95], dtype=np.float32)
lift = 0.035
sk = skin[..., None]
out = np.where(sk, np.clip(out * tone + lift, 0, 1), out)

# ---------- 7. normal and roughness under the cloth ----------
cl = clothed.astype(np.float32)
flat = np.array([128, 128, 255], dtype=np.float32)
k = (cl * 0.85)[..., None]
n = n * (1 - k) + flat[None, None, :] * k
r[..., 1] = r[..., 1] * (1 - cl) + np.where(shoes, 150, 225) * cl  # roughness in G; cleats a bit glossier
r[..., 2] = r[..., 2] * (1 - cl)  # metal in B

SIZE = (1024, 1024)
Image.fromarray((out * 255).clip(0, 255).astype(np.uint8)).resize(SIZE, Image.LANCZOS).save(f"{out_dir}/pitcher_basecolor.jpg", quality=90)
Image.fromarray(n.clip(0, 255).astype(np.uint8)).resize(SIZE, Image.LANCZOS).save(f"{out_dir}/pitcher_normal.jpg", quality=90)
Image.fromarray(r.clip(0, 255).astype(np.uint8)).resize(SIZE, Image.LANCZOS).save(f"{out_dir}/pitcher_rough.jpg", quality=85)
Image.fromarray((out * 255).clip(0, 255).astype(np.uint8)).resize((768, 768)).save(f"{out_dir}/pitcher_preview.png")
print("ok; pants top y =", round(float(pants_top), 3))
