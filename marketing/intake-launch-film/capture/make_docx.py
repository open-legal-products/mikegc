"""Fictional contracts with tracked changes, as raw OOXML, for the demo's document viewer.

    python3 make_docx.py docx/Acme_NDA.docx nda          # Acme's one-way NDA; MikeGC makes it mutual
    python3 make_docx.py docx/Brightwater_DPA.docx dpa   # Brightwater's DPA; Priya's redline from the Assistant

Every party, person and address is fictional. Paragraph text uses a small markup:
**bold**, [-deleted text-] and {+inserted text+}; a paragraph starting "[--" is
deleted whole.
"""
import os
import re
import sys
import zipfile
from xml.sax.saxutils import escape

from contracts import CONTRACTS

out_path = sys.argv[1]
doc = CONTRACTS[sys.argv[2] if len(sys.argv) > 2 else "nda"]
AUTHOR, DATE, FOOTER = doc["author"], doc["date"], doc["footer"]
_ids = [0]


def nid():
    _ids[0] += 1
    return _ids[0]


def rpr(bold=False, caps=False, size=None):
    parts = ""
    if bold:
        parts += "<w:b/>"
    if caps:
        parts += "<w:caps/>"
    if size:
        parts += f'<w:sz w:val="{size}"/><w:szCs w:val="{size}"/>'
    return f"<w:rPr>{parts}</w:rPr>" if parts else ""


def run(text, bold=False, caps=False, size=None, deleted=False):
    """One or more runs for plain text; tabs become <w:tab/>."""
    tag = "w:delText" if deleted else "w:t"
    out = []
    for n, part in enumerate(text.split("\t")):
        if n:
            out.append(f"<w:r>{rpr(bold, caps, size)}<w:tab/></w:r>")
        if part:
            out.append(f'<w:r>{rpr(bold, caps, size)}<{tag} xml:space="preserve">{escape(part)}</{tag}></w:r>')
    return "".join(out)


def runs(text, **fmt):
    """Runs for markup text: **bold**, [-del-], {+ins+} (a change may be **bold** inside)."""
    out = []
    b, c, z = fmt.get("bold", False), fmt.get("caps"), fmt.get("size")
    for tok in re.split(r"(\[-.+?-\]|\{\+.+?\+\}|\*\*.+?\*\*)", text):
        if not tok:
            continue
        if tok.startswith("[-") or tok.startswith("{+"):
            inner = tok[2:-2]
            bold = b
            if inner.startswith("**") and inner.endswith("**"):
                inner, bold = inner[2:-2], True
            if tok.startswith("[-"):
                out.append(f'<w:del w:id="{nid()}" w:author="{AUTHOR}" w:date="{DATE}">{run(inner, bold, c, z, deleted=True)}</w:del>')
            else:
                out.append(f'<w:ins w:id="{nid()}" w:author="{AUTHOR}" w:date="{DATE}">{run(inner, bold, c, z)}</w:ins>')
        elif tok.startswith("**"):
            out.append(run(tok[2:-2], True, c, z))
        else:
            out.append(run(tok, b, c, z))
    return "".join(out)


def para(text, *, align=None, indent=0, hanging=0, before=0, after=160, keep=False, bold=False, size=None, page_break=False):
    deleted = text.startswith("[--")
    if deleted:
        text = "[-" + text[3:]
    ppr = ""
    if keep:
        ppr += "<w:keepNext/>"
    if page_break:
        ppr += "<w:pageBreakBefore/>"
    ppr += f'<w:spacing w:before="{before}" w:after="{after}"/>'
    if indent or hanging:
        ppr += f'<w:ind w:left="{indent}" w:hanging="{hanging}"/>'
    if align:
        ppr += f'<w:jc w:val="{align}"/>'
    if deleted:
        ppr += f'<w:rPr><w:del w:id="{nid()}" w:author="{AUTHOR}" w:date="{DATE}"/></w:rPr>'
    return f"<w:p><w:pPr>{ppr}</w:pPr>{runs(text, bold=bold, size=size)}</w:p>"


def block(kind, text=""):
    if kind == "title":
        return para(text, align="center", after=280, bold=True, size=26)
    if kind == "subtitle":
        return para(text, align="center", after=280)
    if kind == "h":  # a numbered section heading
        return para(text, before=200, after=100, keep=True, bold=True)
    if kind == "annex":
        return para(f"**{text}**", align="center", after=200, page_break=True)
    if kind == "p":
        return para(text, align="both")
    if kind == "c":  # a numbered clause: "1.1\tText"
        return para(text, align="both", indent=720, hanging=720)
    if kind == "i":  # an item: "(a)\tText"
        return para(text, align="both", indent=1440, hanging=720, after=100)
    if kind == "sig":
        return para(text, after=60, keep=True)
    if kind == "gap":
        return para("", after=240)
    raise ValueError(kind)


body = "".join(block(kind, *rest) for kind, *rest in doc["blocks"])
W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main"
R = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"

document = (
    f'<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="{W}" xmlns:r="{R}"><w:body>{body}'
    '<w:sectPr><w:footerReference w:type="default" r:id="rId2"/>'
    '<w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720" w:gutter="0"/>'
    "</w:sectPr></w:body></w:document>"
)
footer = (
    f'<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:ftr xmlns:w="{W}" xmlns:r="{R}">'
    '<w:p><w:pPr><w:jc w:val="center"/></w:pPr>'
    f'<w:r><w:rPr><w:sz w:val="16"/></w:rPr><w:t xml:space="preserve">{escape(FOOTER)}  ·  Page </w:t></w:r>'
    '<w:r><w:rPr><w:sz w:val="16"/></w:rPr><w:fldChar w:fldCharType="begin"/></w:r>'
    '<w:r><w:rPr><w:sz w:val="16"/></w:rPr><w:instrText xml:space="preserve"> PAGE </w:instrText></w:r>'
    '<w:r><w:rPr><w:sz w:val="16"/></w:rPr><w:fldChar w:fldCharType="separate"/></w:r>'
    '<w:r><w:rPr><w:sz w:val="16"/></w:rPr><w:t>1</w:t></w:r>'
    '<w:r><w:rPr><w:sz w:val="16"/></w:rPr><w:fldChar w:fldCharType="end"/></w:r>'
    "</w:p></w:ftr>"
)
styles = (
    f'<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:styles xmlns:w="{W}">'
    '<w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Times New Roman" w:hAnsi="Times New Roman" w:cs="Times New Roman"/>'
    '<w:sz w:val="22"/><w:szCs w:val="22"/></w:rPr></w:rPrDefault>'
    '<w:pPrDefault><w:pPr><w:spacing w:after="160" w:line="264" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>'
    '<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style>'
    "</w:styles>"
)
content_types = (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
    '<Default Extension="xml" ContentType="application/xml"/>'
    '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>'
    '<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>'
    '<Override PartName="/word/footer1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml"/>'
    "</Types>"
)
rels = (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
    '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>'
    "</Relationships>"
)
doc_rels = (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
    '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>'
    '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/footer" Target="footer1.xml"/>'
    "</Relationships>"
)

os.makedirs(os.path.dirname(os.path.abspath(out_path)), exist_ok=True)
with zipfile.ZipFile(out_path, "w", zipfile.ZIP_DEFLATED) as z:
    z.writestr("[Content_Types].xml", content_types)
    z.writestr("_rels/.rels", rels)
    z.writestr("word/_rels/document.xml.rels", doc_rels)
    z.writestr("word/document.xml", document)
    z.writestr("word/styles.xml", styles)
    z.writestr("word/footer1.xml", footer)
print("wrote", out_path)
