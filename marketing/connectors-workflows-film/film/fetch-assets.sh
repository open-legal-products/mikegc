#!/usr/bin/env bash
# Gather the film's assets into film/assets and film/shots.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
REPO="$(cd "$HERE/../../.." && pwd)"
INTAKE="$REPO/marketing/intake-launch-film"
A="$HERE/assets"
mkdir -p "$A/avatars" "$HERE/shots"

# From this repository.
cp "$REPO/frontend/src/app/icon.svg" "$A/mikegc-icon.svg"
cp "$REPO/frontend/src/app/fonts/inter-latin.woff2" "$A/inter-latin.woff2"
cp "$REPO/frontend/src/app/fonts/eb-garamond-latin.woff2" "$A/eb-garamond-latin.woff2"
cp "$REPO/frontend/public/icons/integrations/courtlistener.svg" "$A/courtlistener.svg"
# Slack, Airtable, Linear, Lawve and Notion: the inline SVGs the connectors page draws.
python3 - "$REPO/frontend/src/app/components/settings/SlackLogo.tsx" \
  "$REPO/frontend/src/app/(pages)/settings/connectors/page.tsx" "$A" <<'PY'
import re, sys
slack, page, out = sys.argv[1], open(sys.argv[2]).read(), sys.argv[3]
paths = re.findall(r'<path\s+fill="([^"]+)"\s+d="([^"]+)"', open(slack).read())
open(f"{out}/slack.svg", "w").write('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">'
    + "".join(f'<path fill="{f}" d="{d}"/>' for f, d in paths) + "</svg>")
fn = page[page.index("function ConnectorBrandIcon"):page.index("function googleSetupGuideUrl")]
def svg(chunk, fill=None):
    m = re.search(r"<svg([^>]*)>(.*?)</svg>", chunk, re.S)
    view = re.search(r'viewBox="([^"]+)"', m.group(1)).group(1)
    body = re.sub(r'\s+className="[^"]*"', "", m.group(2))
    body = re.sub(r"\s+", " ", body).replace("/>", "/>\n")
    if fill:
        body = body.replace("<path ", f'<path fill="{fill}" ')
    return f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="{view}">{body}</svg>\n'
for name, fill in (("Airtable", None), ("Linear", "#5E6AD2"), ("Lawve", None)):
    i = fn.index(f'name === "{name}"')
    open(f"{out}/{name.lower()}.svg", "w").write(svg(fn[i:], fill))
# Notion is the fallback after the last named brand.
open(f"{out}/notion.svg", "w").write(svg(fn[fn.rindex("return (") :], "#000"))
PY

# Google's vector logos (public domain on Wikimedia Commons); the repo's PNGs are 96 px.
for f in "gmail.svg:7/7e/Gmail_icon_%282020%29.svg" \
         "google-drive.svg:1/12/Google_Drive_icon_%282020%29.svg" \
         "google-calendar.svg:a/a5/Google_Calendar_icon_%282020%29.svg"; do
  [ -s "$A/${f%%:*}" ] || { curl -fsS -A "mikegc-feature-film" -o "$A/${f%%:*}" "https://upload.wikimedia.org/wikipedia/commons/${f#*:}"; sleep 2; }
done

# General Legal's logo, as the intake film draws it (see its fetch-assets.sh).
if [ -f "$INTAKE/film/gl.js" ]; then cp "$INTAKE/film/gl.js" "$HERE/gl.js"; else
curl -fsS https://general.legal | python3 -c '
import json, re, sys
h = sys.stdin.read()
i = h.find("<svg viewBox=\"0 0 116 18\"")
svg = h[i:h.find("</svg>", i) + 6]
svg = re.sub(r" class=\"[^\"]*\"", "", svg).replace("<svg ", "<svg width=\"116\" height=\"18\" ", 1)
open(sys.argv[1], "w").write("window.__GL_SVG = " + json.dumps(svg) + ";\n")
' "$HERE/gl.js"; fi

cp "$HERE/../capture/shots/"*.png "$HERE/../capture/shots/shots.json" "$HERE/shots/"
# The fictional people's photos (public-domain, AI-generated faces) from the intake film.
cp "$INTAKE/capture/avatars/"*.jpg "$A/avatars/"
echo "assets ready"
