#!/usr/bin/env python3
"""Move inline base64 images out of index.html into assets/ (efficiency #7).

Every `data:image/<type>;base64,...` literal in index.html (JS strings, CSS url(), <link href>) is written to
assets/<group>-<sha1 of the bytes, 10 hex>.<ext> and replaced by that relative path. Names are content hashes, so a
changed image always gets a new file name (safe for the service worker's cache-first assets) and identical
images share one file. Re-running is safe: it only touches literals that are still inline.

    python3 tools/extract-assets.py            # rewrite index.html, write assets/
    python3 tools/extract-assets.py --check    # exit 1 if any inline base64 image is left (for CI / before pushing)
"""
import base64, hashlib, os, re, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
HTML = os.path.join(ROOT, 'index.html')
OUT = os.path.join(ROOT, 'assets')
EXT = {'webp': 'webp', 'png': 'png', 'jpeg': 'jpg', 'jpg': 'jpg', 'gif': 'gif', 'avif': 'avif'}
RX = re.compile(r'data:image/(webp|png|jpeg|jpg|gif|avif);base64,([A-Za-z0-9+/=]+)')

def group(src, pos):
    """A readable prefix from the code around the literal (which asset table or CSS rule it belongs to)."""
    before = src[:pos]
    for name, tag in (('GG_SKULL_ASSETS', 'skull'), ('GG_GATHER_ASSETS', 'gather'), ('GG_GEM_ASSETS', 'gem')):
        i = before.rfind('const ' + name)
        if i >= 0 and '};' not in before[i:] and '];' not in before[i:]:
            return tag
    near = src[max(0, pos - 120):pos]
    if 'apple-touch-icon' in near or 'rel="icon"' in near: return 'icon'
    if '#board.gath' in near: return 'gather-board'
    if 'remaster' in near: return 'bg'
    return 'img'

def main():
    src = open(HTML, encoding='utf-8').read()
    hits = list(RX.finditer(src))
    if '--check' in sys.argv:
        print(f'{len(hits)} inline base64 image(s) in index.html')
        sys.exit(1 if hits else 0)
    if not hits:
        print('Nothing to extract: index.html has no inline base64 images.'); return
    os.makedirs(OUT, exist_ok=True)
    out, last, made, saved = [], 0, {}, 0
    for m in hits:
        data = base64.b64decode(m.group(2))
        name = f'{group(src, m.start())}-{hashlib.sha1(data).hexdigest()[:10]}.{EXT[m.group(1)]}'
        path = os.path.join(OUT, name)
        if name not in made:
            if not os.path.exists(path):
                with open(path, 'wb') as f: f.write(data)
            made[name] = len(data)
        out.append(src[last:m.start()]); out.append('assets/' + name); last = m.end()
        saved += len(m.group(0)) - len('assets/' + name)
    out.append(src[last:])
    with open(HTML, 'w', encoding='utf-8') as f: f.write(''.join(out))
    print(f'Extracted {len(hits)} inline images into {len(made)} files in assets/ ({sum(made.values())//1024} KB); '
          f'index.html is {saved//1024} KB smaller.')

if __name__ == '__main__':
    main()
