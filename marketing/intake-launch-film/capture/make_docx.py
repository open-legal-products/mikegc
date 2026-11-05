"""A short fictional NDA with MikeGC's tracked changes, as raw OOXML."""
import sys, zipfile
from xml.sax.saxutils import escape

DATE = "2026-11-09T10:15:00Z"
rid = [0]
def nid():
    rid[0] += 1
    return rid[0]

def run(text, bold=False):
    rpr = "<w:rPr><w:b/></w:rPr>" if bold else ""
    return f'<w:r>{rpr}<w:t xml:space="preserve">{escape(text)}</w:t></w:r>'
def ins(text):
    return f'<w:ins w:id="{nid()}" w:author="MikeGC" w:date="{DATE}"><w:r><w:t xml:space="preserve">{escape(text)}</w:t></w:r></w:ins>'
def dele(text):
    return f'<w:del w:id="{nid()}" w:author="MikeGC" w:date="{DATE}"><w:r><w:delText xml:space="preserve">{escape(text)}</w:delText></w:r></w:del>'
def para(*parts, style=None, center=False):
    ppr = ""
    if style or center:
        ppr = "<w:pPr>" + (f'<w:pStyle w:val="{style}"/>' if style else "") + ('<w:jc w:val="center"/>' if center else "") + "</w:pPr>"
    return f"<w:p>{ppr}{''.join(parts)}</w:p>"
def deleted_para(text):
    i = nid()
    return (f'<w:p><w:pPr><w:rPr><w:del w:id="{i}" w:author="MikeGC" w:date="{DATE}"/></w:rPr></w:pPr>'
            + dele(text) + "</w:p>")

body = [
    para(run("MUTUAL NON-DISCLOSURE AGREEMENT", bold=True), center=True) .replace("MUTUAL ", "") ,
]
# Title: insert "MUTUAL " as a tracked insertion
body = [para(ins("MUTUAL "), run("NON-DISCLOSURE AGREEMENT", bold=True), center=True)]
body += [
    para(run("This Agreement is made on 9 November 2026 between Acme, Inc. (\"Acme\") and Example Ltd (\"Example\"), each a \"Party\".")),
    para(run("1. Confidential Information.", bold=True), run(" \"Confidential Information\" means all information disclosed by "),
         dele("Acme to Example"), ins("one Party (the \"Discloser\") to the other (the \"Recipient\")"),
         run(", whether in writing, orally or by demonstration, that is marked confidential or would reasonably be understood to be confidential.")),
    para(run("2. Obligations.", bold=True), run(" "), dele("Example"), ins("The Recipient"),
         run(" shall keep the Confidential Information confidential, use it only to evaluate a possible business relationship between the Parties, and disclose it only to its employees and advisers who need to know it.")),
    para(run("3. Exclusions.", bold=True), run(" These obligations do not apply to information that is or becomes public through no fault of the "),
         dele("Example"), ins("Recipient"), run(", was already known to the "), dele("Example"), ins("Recipient"),
         run(", or is independently developed without use of the Confidential Information.")),
    para(run("4. Term.", bold=True), run(" The obligations in this Agreement continue for "), dele("seven (7)"), ins("three (3)"),
         run(" years from the date of the last disclosure.")),
    para(run("5. Return of information.", bold=True), run(" On request, the "), dele("Example"), ins("Recipient"),
         run(" shall return or destroy the Confidential Information, except copies kept under a legal or regulatory requirement.")),
    deleted_para("6. Residuals. Nothing in this Agreement restricts Acme from using any information retained in the unaided memory of its personnel."),
    para(run("7. Governing law.", bold=True), run(" This Agreement is governed by the laws of the State of Delaware.")),
]

document = ('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
 '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" '
 'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">'
 '<w:body>' + "".join(body) +
 '<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="708" w:footer="708" w:gutter="0"/></w:sectPr>'
 '</w:body></w:document>')

styles = ('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
 '<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">'
 '<w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:cs="Calibri"/><w:sz w:val="22"/></w:rPr></w:rPrDefault>'
 '<w:pPrDefault><w:pPr><w:spacing w:after="200" w:line="300" w:lineRule="auto"/><w:jc w:val="both"/></w:pPr></w:pPrDefault></w:docDefaults>'
 '<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style>'
 '</w:styles>')

content_types = ('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
 '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
 '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
 '<Default Extension="xml" ContentType="application/xml"/>'
 '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>'
 '<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>'
 '</Types>')
rels = ('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
 '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
 '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>'
 '</Relationships>')
doc_rels = ('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
 '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
 '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>'
 '</Relationships>')

with zipfile.ZipFile(sys.argv[1], "w", zipfile.ZIP_DEFLATED) as z:
    z.writestr("[Content_Types].xml", content_types)
    z.writestr("_rels/.rels", rels)
    z.writestr("word/_rels/document.xml.rels", doc_rels)
    z.writestr("word/document.xml", document)
    z.writestr("word/styles.xml", styles)
print("ok")
