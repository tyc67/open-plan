"""Makes the CJK test font (roadmap C2b) from Noto Sans TC: the regular weight (400) of the variable font, only the
characters in characters.txt, and a new family name, "Open Plan Test TC" (the OFL asks a modified font not to use the
reserved name, and a distinct name shows that the test uses this file, not an installed font).

Run it in an isolated environment, outside the repository's dependencies:
  uv run --no-project --isolated --with fonttools==4.66.1 python make-test-font.py <NotoSansTC[wght].ttf>
"""
import hashlib, pathlib, sys
from fontTools.ttLib import TTFont
from fontTools.varLib import instancer
from fontTools import subset

SOURCE_SHA256 = '864727d210d54f2537bbe23b3a839436c3992af72de9322af5270897246bd44f'
FAMILY = 'Open Plan Test TC'
here = pathlib.Path(__file__).parent
source = pathlib.Path(sys.argv[1])
digest = hashlib.sha256(source.read_bytes()).hexdigest()
if digest != SOURCE_SHA256: sys.exit(f'Unexpected source font: SHA-256 {digest}, expected {SOURCE_SHA256}.')

font = TTFont(source, recalcTimestamp=False)
font = instancer.instantiateVariableFont(font, {'wght': 400})
options = subset.Options()
options.name_IDs = ['*']
options.notdef_outline = True
subsetter = subset.Subsetter(options)
subsetter.populate(text=(here / 'characters.txt').read_text(encoding='utf-8').rstrip('\n'))
subsetter.subset(font)
for record in font['name'].names:
    if record.nameID in (1, 16): record.string = FAMILY
    elif record.nameID in (2, 17): record.string = 'Regular'
    elif record.nameID == 4: record.string = f'{FAMILY} Regular'
    elif record.nameID == 6: record.string = 'OpenPlanTestTC-Regular'
    elif record.nameID == 3: record.string = f'{FAMILY} Regular; subset for tests'
font['head'].created = font['head'].modified = 0       # fixed times, so the same input gives the same bytes
out = here / 'OpenPlanTestTC.ttf'
font.save(out)
print(out.name, out.stat().st_size, 'bytes, SHA-256', hashlib.sha256(out.read_bytes()).hexdigest())
