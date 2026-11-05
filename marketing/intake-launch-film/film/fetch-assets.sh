#!/usr/bin/env bash
# Gather the film's assets into film/assets and film/shots.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
REPO="$(cd "$HERE/../../.." && pwd)"
A="$HERE/assets"
mkdir -p "$A" "$HERE/shots"

# From this repository.
cp "$REPO/frontend/src/app/icon.svg" "$A/mikegc-icon.svg"
cp "$REPO/frontend/public/icons/integrations/outlook.svg" "$A/outlook.svg"
cp "$REPO/frontend/public/icons/integrations/teams.svg" "$A/teams.svg"
cp "$REPO/frontend/src/app/fonts/inter-latin.woff2" "$A/inter-latin.woff2"
cp "$REPO/frontend/src/app/fonts/eb-garamond-latin.woff2" "$A/eb-garamond-latin.woff2"
# The black MikeOSS mark, as it was before the MikeGC rebrand (555d8cd).
git -C "$REPO" show 555d8cd^:frontend/src/app/icon.svg > "$A/mikeoss-icon-orig.svg"
# Slack's mark, from the inline SVG the settings page draws.
python3 - "$REPO/frontend/src/app/components/settings/SlackLogo.tsx" "$A/slack.svg" <<'EOF'
import re, sys
paths = re.findall(r'<path\s+fill="([^"]+)"\s+d="([^"]+)"', open(sys.argv[1]).read())
open(sys.argv[2], "w").write('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">'
    + "".join(f'<path fill="{f}" d="{d}"/>' for f, d in paths) + "</svg>")
EOF

# Gmail: Google's vector logo (public domain on Wikimedia Commons); the repo's PNG is 96 px.
curl -fsS -A "mikegc-launch-film" -o "$A/gmail.svg" \
  "https://upload.wikimedia.org/wikipedia/commons/7/7e/Gmail_icon_%282020%29.svg"

# General Legal: the header logo (mark and outlined wordmark) and the mark alone.
curl -fsS -o "$A/general-legal-favicon.svg" https://general.legal/favicon.svg
curl -fsS https://general.legal | python3 -c '
import json, re, sys
h = sys.stdin.read()
i = h.find("<svg viewBox=\"0 0 116 18\"")
svg = h[i:h.find("</svg>", i) + 6]
svg = re.sub(r" class=\"[^\"]*\"", "", svg).replace("<svg ", "<svg width=\"116\" height=\"18\" ", 1)
open(sys.argv[1], "w").write("window.__GL_SVG = " + json.dumps(svg) + ";\n")
' "$HERE/gl.js"

cp "$HERE/../capture/shots/"*.png "$HERE/../capture/shots/shots.json" "$HERE/shots/"
echo "assets ready"
