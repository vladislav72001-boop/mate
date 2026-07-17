from PIL import Image
from pathlib import Path
import base64

src = Image.open('mate.png').convert('RGBA')
print('source', src.size)

public = Path('public')

def save_png(img, path):
    img.save(path, format='PNG', optimize=True)
    print(path, Path(path).stat().st_size)

def sized(n):
    return src.resize((n, n), Image.Resampling.NEAREST)

save_png(sized(48), public / 'favicon-48.png')
save_png(sized(96), public / 'favicon-96.png')
save_png(sized(192), public / 'icon-192.png')
save_png(sized(192), public / 'apple-touch-icon.png')
save_png(sized(512), public / 'icon-512.png')
save_png(sized(64), public / 'favicon.png')
save_png(sized(64), public / 'mate-logo.png')
save_png(src, public / 'mate.png')

sizes = [16, 32, 48]
ico_images = [sized(s) for s in sizes]
ico_images[0].save(public / 'favicon.ico', format='ICO', sizes=[(s, s) for s in sizes])
print('favicon.ico', (public / 'favicon.ico').stat().st_size)

b64 = base64.b64encode((public / 'favicon-48.png').read_bytes()).decode('ascii')
svg = f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48" role="img" aria-label="Mate Delivery">
  <image href="data:image/png;base64,{b64}" width="48" height="48" preserveAspectRatio="xMidYMid meet"/>
</svg>
'''
(public / 'favicon.svg').write_text(svg, encoding='utf-8')
print('favicon.svg', (public / 'favicon.svg').stat().st_size)
print('done')
