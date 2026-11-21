#!/usr/bin/env python3
"""Cache-busting: tag every local CSS/JS reference with ?v=<version>.

Run after changing anything:   python3 tickle/stamp.py
GitHub Pages caches files for ~10 minutes; a new version tag makes browsers
fetch fresh copies of everything at once (no mix of old and new files).
"""
import pathlib, re, time

root = pathlib.Path(__file__).parent
v = time.strftime('%Y%m%d%H%M')
files = [root / 'index.html', *sorted((root / 'js').glob('*.js'))]
pat = re.compile(r"""((?:href|src)="|from ')((?:\./|js/)?[\w./-]+\.(?:js|css))(?:\?v=\w+)?(["'])""")
for f in files:
    text = f.read_text()
    new = pat.sub(lambda m: f"{m.group(1)}{m.group(2)}?v={v}{m.group(3)}", text)
    if new != text:
        f.write_text(new)
print('stamped', v)
