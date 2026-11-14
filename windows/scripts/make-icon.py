"""Draws build/icon.png and build/icon.ico (an original mark: play triangle + bookmark ribbon).
   python3 scripts/make-icon.py   (needs Pillow; the generated files are committed, so CI does not need this)"""
from PIL import Image, ImageDraw, ImageChops
import os

S = 4                       # supersampling
N = 1024 * S
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'build')
os.makedirs(OUT, exist_ok=True)

def lerp(a, b, t): return tuple(int(a[i] + (b[i] - a[i]) * t) for i in range(3))

# background: rounded square with a vertical gradient
top, bot = (44, 74, 124), (15, 24, 42)
bg = Image.new('RGB', (N, N))
px = ImageDraw.Draw(bg)
for y in range(N):
    px.line([(0, y), (N, y)], fill=lerp(top, bot, y / (N - 1)))
mask = Image.new('L', (N, N), 0)
ImageDraw.Draw(mask).rounded_rectangle([32 * S, 32 * S, N - 32 * S, N - 32 * S], radius=224 * S, fill=255)

img = Image.new('RGBA', (N, N), (0, 0, 0, 0))
img.paste(bg, (0, 0), mask)
d = ImageDraw.Draw(img)

# play triangle with rounded corners
tri = [(395 * S, 335 * S), (395 * S, 705 * S), (725 * S, 520 * S)]
d.polygon(tri, fill=(236, 238, 242, 255))
d.line(tri + [tri[0], tri[1]], fill=(236, 238, 242, 255), width=70 * S, joint='curve')
for p in tri:
    d.ellipse([p[0] - 35 * S, p[1] - 35 * S, p[0] + 35 * S, p[1] + 35 * S], fill=(236, 238, 242, 255))

# bookmark ribbon in the accent colour, top right (inside the straight part of the edge)
rib = [(610 * S, 32 * S), (770 * S, 32 * S), (770 * S, 330 * S), (690 * S, 262 * S), (610 * S, 330 * S)]
d.polygon(rib, fill=(124, 176, 255, 255))

# keep everything inside the rounded square
alpha = ImageChops.multiply(img.getchannel('A'), mask)
img.putalpha(alpha)

big = img.resize((1024, 1024), Image.LANCZOS)
big.resize((512, 512), Image.LANCZOS).save(os.path.join(OUT, 'icon.png'))
big.save(os.path.join(OUT, 'icon.ico'), sizes=[(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)])
print('wrote', os.path.normpath(OUT))
