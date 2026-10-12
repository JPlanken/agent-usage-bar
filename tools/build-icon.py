"""Build the status-bar icon font from provider SVGs (requires fonttools)."""
from pathlib import Path
from xml.etree import ElementTree
from fontTools.fontBuilder import FontBuilder
from fontTools.pens.ttGlyphPen import TTGlyphPen
from fontTools.pens.cu2quPen import Cu2QuPen
from fontTools.pens.transformPen import TransformPen
from fontTools.svgLib.path import parse_path

root = Path(__file__).resolve().parent.parent
glyphs = {'.notdef': TTGlyphPen(None).glyph()}
for provider in ('claude', 'codex'):
    svg = ElementTree.parse(root / f'resources/{provider}-logo.svg')
    pen = TTGlyphPen(None)
    transformed = TransformPen(Cu2QuPen(pen, 1.0, reverse_direction=True), (1000/24, 0, 0, -1000/24, 0, 850))
    for element in svg.iter('{http://www.w3.org/2000/svg}path'):
        parse_path(element.attrib['d'], transformed)
    glyphs[provider] = pen.glyph()
font = FontBuilder(1000, isTTF=True)
font.setupGlyphOrder(list(glyphs))
font.setupCharacterMap({0xE001: 'claude', 0xE002: 'codex'})
font.setupGlyf(glyphs)
font.setupHorizontalMetrics({name: (1000, 0) for name in glyphs})
font.setupHorizontalHeader(ascent=850, descent=-150)
font.setupNameTable({'familyName': 'Usage Bar Icons', 'styleName': 'Regular', 'uniqueFontIdentifier': 'UsageBarIcons-Regular', 'fullName': 'Usage Bar Icons', 'psName': 'UsageBarIcons-Regular'})
font.setupOS2(sTypoAscender=850, sTypoDescender=-150, usWinAscent=850, usWinDescent=150)
font.setupPost()
font.font.flavor = 'woff'
font.save(root / 'resources/usage-icons.woff')
