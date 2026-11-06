"""Builds index.html: one self-contained page with every script and the texture atlas inlined.
Usage:  python3 build.py
"""
import base64, pathlib
root = pathlib.Path(__file__).parent
order = ['core', 'world', 'render', 'entities', 'audio', 'storage', 'relay', 'skins', 'net', 'servers', 'atmos', 'game', 'ui', 'ui_mp', 'main']
js = '\n'.join((root / 'src' / 'js' / f'{n}.js').read_text(encoding='utf-8') for n in order)
js = js.replace('__ATLAS_JSON__', (root / 'textures' / 'atlas.json').read_text(encoding='utf-8').strip())
js = js.replace('__ATLAS_B64__', base64.b64encode((root / 'textures' / 'atlas.png').read_bytes()).decode())
html = (root / 'src' / 'template.html').read_text(encoding='utf-8').replace('__SCRIPTS__', js)
out = root / 'index.html'
out.write_text(html, encoding='utf-8')
print('built', out, len(html) // 1024, 'KB')
