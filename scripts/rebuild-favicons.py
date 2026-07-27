from PIL import Image
from pathlib import Path
import base64
import shutil

candidates = [
    'public/icon-512.png',
    'public/apple-touch-icon.png',
    'public/mate.png',
]
src = None
for cand in candidates:
    im = Image.open(cand).convert('RGBA')
    print(cand, im.size)
    if im.size[0] >= 192:
        src = im
        break
if src is None:
    src = Image.open('public/mate.png').convert('RGBA')
print('using', src.size)

public = Path('public')


def sized(n: int) -> Image.Image:
    return src.resize((n, n), Image.Resampling.LANCZOS)


def save_png(img: Image.Image, path: Path) -> None:
    img.save(path, format='PNG', optimize=True)
    print(path, path.stat().st_size)


save_png(sized(32), public / 'mate-icon-32.png')
save_png(sized(48), public / 'mate-icon-48.png')
save_png(sized(96), public / 'mate-icon-96.png')
save_png(sized(180), public / 'mate-apple-touch.png')
save_png(sized(192), public / 'mate-icon-192.png')
save_png(sized(512), public / 'mate-icon-512.png')

sizes = [16, 32, 48]
imgs = [sized(s) for s in sizes]
imgs[0].save(public / 'mate-favicon.ico', format='ICO', sizes=[(s, s) for s in sizes])
print('mate-favicon.ico', (public / 'mate-favicon.ico').stat().st_size)

b64 = base64.b64encode((public / 'mate-icon-48.png').read_bytes()).decode('ascii')
svg = (
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48" '
    'role="img" aria-label="Mate Delivery">\n'
    f'  <image href="data:image/png;base64,{b64}" width="48" height="48" '
    'preserveAspectRatio="xMidYMid meet"/>\n'
    '</svg>\n'
)
(public / 'mate-favicon.svg').write_text(svg, encoding='utf-8')

legacy = [
    ('mate-favicon.ico', 'favicon.ico'),
    ('mate-favicon.svg', 'favicon.svg'),
    ('mate-icon-48.png', 'favicon-48.png'),
    ('mate-icon-96.png', 'favicon-96.png'),
    ('mate-icon-32.png', 'favicon.png'),
    ('mate-icon-192.png', 'icon-192.png'),
    ('mate-icon-512.png', 'icon-512.png'),
    ('mate-apple-touch.png', 'apple-touch-icon.png'),
]
for src_name, dst_name in legacy:
    shutil.copyfile(public / src_name, public / dst_name)
print('legacy paths synced')
