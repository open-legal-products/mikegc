/* MikeGC connectors and workflows film: a deterministic timeline rendered frame
   by frame. window.__seek(t) poses every element for time t (seconds). The
   engine and the screen-card helpers are the intake launch film's. */
"use strict";

const QS = new URLSearchParams(location.search);
const FORMAT = QS.get("f") || "16x9";
const CUES = window.__CUES || {};

// ---------------------------------------------------------------- timing cues
// The beat schedule and the music landmarks it lands on. render.cjs injects cues.json.
const C = Object.assign({ endcard: 63.547, end: 69.547, hits: {} }, CUES);

// ---------------------------------------------------------------- layout (16:9 only)
const LAYOUTS = {
    "16x9": {
        W: 1920, H: 1080, cx: 960, cy: 530,
        card: { x: 272, y: 64, w: 1376, h: 860 }, zChat: 1.3, zw: 1, zp: 1.3,
        capY: 984, capSize: 36,
        wmSize: 120, eyebrowSize: 34, subSize: 36, subDy: 112,
        featureSize: 34, titleSize: 120,
        logoSize: 96, logoY: 420, logoX0: 240, logoDx: 180, nameSize: 22,
        grid: { w: 1180, top: 300, head: 84, tileH: 84, gap: 20, pad: 36, icon: 36, font: 24 },
        thread: { w: 1200 },
        end: { wmY: 470, byY: 602, bySize: 24, glY: 656, glH: 44 },
    },
};
const L = LAYOUTS[FORMAT];
const stage = document.getElementById("stage");
stage.style.width = L.W + "px";
stage.style.height = L.H + "px";

// ---------------------------------------------------------------- engine
const EASE = {
    l: (p) => p,
    io: (p) => (p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2),
    o: (p) => 1 - Math.pow(1 - p, 3),
    i: (p) => p * p * p,
    s: (p) => 0.5 - Math.cos(Math.PI * p) / 2,
    b: (p) => { const c1 = 1.5, c3 = c1 + 1; return 1 + c3 * Math.pow(p - 1, 3) + c1 * Math.pow(p - 1, 2); },
    h: (p) => (p < 1 ? 0 : 1),
};
const tracks = new Map(); // el -> { prop: keys[] }
function A(el, prop, keys) {
    if (!tracks.has(el)) tracks.set(el, {});
    const k = keys.map(([t, v, e]) => ({ t, v, e: e || "io" })).sort((a, b) => a.t - b.t);
    const t = tracks.get(el);
    t[prop] = t[prop] ? [...t[prop], ...k].sort((a, b) => a.t - b.t) : k;
}
function lerp(a, b, p) {
    if (Array.isArray(a)) return a.map((x, i) => lerp(x, b[i], p));
    return a + (b - a) * p;
}
function valAt(keys, t) {
    if (t <= keys[0].t) return keys[0].v;
    const last = keys[keys.length - 1];
    if (t >= last.t) return last.v;
    for (let i = 1; i < keys.length; i++) {
        const b = keys[i];
        if (t <= b.t) {
            const a = keys[i - 1];
            const p = b.t === a.t ? 1 : (t - a.t) / (b.t - a.t);
            return lerp(a.v, b.v, EASE[b.e](p));
        }
    }
    return last.v;
}
const SPECIAL = {};
function seek(t) {
    for (const [el, props] of tracks) {
        const v = {};
        for (const p in props) v[p] = valAt(props[p], t);
        const tf = [];
        if ("x" in v || "y" in v) tf.push(`translate(${(v.x || 0).toFixed(2)}px, ${(v.y || 0).toFixed(2)}px)`);
        if ("s" in v) tf.push(`scale(${v.s.toFixed(4)})`);
        if (tf.length) el.style.transform = tf.join(" ");
        if ("o" in v) {
            el.style.opacity = Math.max(0, Math.min(1, v.o)).toFixed(3);
            el.style.visibility = v.o <= 0.001 ? "hidden" : "visible";
        }
        if ("b" in v) el.style.filter = v.b > 0.01 ? `blur(${v.b.toFixed(2)}px)` : "none";
        for (const p in v) if (SPECIAL[p]) SPECIAL[p](el, v[p]);
    }
}
// Discrete frame of an image sequence: children with data-i shown one at a time.
SPECIAL.frame = (el, v) => {
    const i = Math.round(v);
    if (el.__frame === i) return;
    el.__frame = i;
    for (const c of el.querySelectorAll("[data-i]")) c.style.visibility = +c.dataset.i === i ? "visible" : "hidden";
};
// Type-on: show the first n characters.
SPECIAL.chars = (el, v) => {
    const n = Math.floor(v + 1e-6);
    if (el.__n === n) return;
    el.__n = n;
    el.textContent = el.__full.slice(0, n);
};
// Camera inside a screen card: [fx, fy, zoomMultiplier] in screenshot px.
// The zoom is relative to fitting the shot's width (or a 1000 px tall window
// of it), so a tall shot pans rather than shrinking to fit.
SPECIAL.cam = (el, v) => {
    const { w, h } = el.__card;
    const iw = el.__w || 1600, ih = el.__h || 1000;
    const cover = Math.max(w / iw, h / Math.min(ih, 1000));
    const z = cover * v[2];
    let tx = w / 2 - v[0] * z, ty = h / 2 - v[1] * z;
    tx = Math.min(0, Math.max(w - iw * z, tx));
    ty = Math.min(0, Math.max(h - ih * z, ty));
    el.style.transform = `translate(${tx.toFixed(2)}px, ${ty.toFixed(2)}px) scale(${z.toFixed(5)})`;
};
SPECIAL.scrollY = (el, v) => { el.style.transform = `translateY(${(-v).toFixed(2)}px)`; };

// ---------------------------------------------------------------- dom helpers
function h(tag, attrs = {}, ...kids) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
        if (k === "style" && typeof v === "object") Object.assign(el.style, v);
        else if (k === "html") el.innerHTML = v;
        else if (k === "class") el.className = v;
        else el.setAttribute(k, v);
    }
    for (const kid of kids.flat()) if (kid != null) el.append(kid.nodeType ? kid : document.createTextNode(kid));
    return el;
}
// An anchor: a zero-size point at (x, y); its child is centred on it, and
// scaling the anchor scales about that point.
function anchor(x, y, child, parent = stage) {
    const a = h("div", { class: "abs", style: { left: x + "px", top: y + "px", width: "0px", height: "0px" } });
    const inner = h("div", { style: { position: "absolute", left: "0", top: "0", transform: "translate(-50%, -50%)" } }, child);
    a.append(inner);
    parent.append(a);
    return a;
}
function fadeIn(el, t, d = 0.45, dy = 14) {
    A(el, "o", [[t, 0], [t + d, 1, "o"]]);
    if (dy) A(el, "y", [[t, dy], [t + d, 0, "o"]]);
}
function fadeOut(el, t, d = 0.35, dy = 0) {
    A(el, "o", [[t, 1], [t + d, 0, "io"]]);
    if (dy) A(el, "y", [[t, 0], [t + d, dy, "io"]]);
}
const textEl = (txt, cls, size, extra = {}) => h("div", { class: cls, style: Object.assign({ fontSize: size + "px", whiteSpace: "nowrap" }, extra) }, txt);

// ---------------------------------------------------------------- background
const bg = h("div", { id: "bg" });
const bg2 = h("div", { id: "bg2" });
const white = h("div", { id: "white" });
stage.append(bg, bg2);
A(bg, "x", [[0, 0], [C.end, -90, "l"]]);
A(bg, "y", [[0, 0], [C.end, -50, "l"]]);
A(bg2, "x", [[0, -40], [C.end, 140, "l"]]);
A(bg2, "y", [[0, -20], [C.end, 70, "l"]]);

// ---------------------------------------------------------------- captions
function caption(text, t0, t1, opts = {}) {
    const el = anchor(L.cx, opts.y || L.capY, textEl(text, opts.foot ? "foot" : "caption", opts.size || (opts.foot ? L.footSize : L.capSize)));
    A(el, "o", [[t0, 0], [t0 + 0.45, 1, "o"], [t1 - 0.35, 1], [t1, 0, "io"]]);
    A(el, "y", [[t0, 12], [t0 + 0.45, 0, "o"]]);
    return el;
}

// ---------------------------------------------------------------- screen cards
const shotMeta = window.__SHOTS || {};
function card(layers, opts = {}) {
    const r = opts.rect || L.card;
    const c = h("div", { class: "abs glass", style: { left: r.x + "px", top: r.y + "px", width: r.w + "px", height: r.h + "px", transformOrigin: "50% 50%" } });
    const ih = opts.h || 1000;
    const cam = h("div", { class: "cam", style: { height: ih + "px" } });
    cam.__card = r;
    cam.__w = 1600;
    cam.__h = ih;
    for (const l of layers) cam.append(l);
    c.append(cam, h("div", { class: "edge" }));
    stage.append(c);
    c.__cam = cam;
    return c;
}
const img = (name, attrs = {}) => {
    const el = h("img", Object.assign({ class: "shot", src: `shots/${name}.png` }, attrs));
    const size = (shotMeta[name] || {}).size;
    if (size) el.style.height = size.h + "px";
    return el;
};
// A region the capture recorded in a shot, padded; `fallback` if it has none.
function region(name, key, pad = 6, fallback = null) {
    const r = (shotMeta[name] || {})[key];
    return r ? { x: r.x - pad, y: r.y - pad, w: r.w + 2 * pad, h: r.h + 2 * pad } : fallback;
}
const centre = (r) => [r.x + r.w / 2, r.y + r.h / 2];
function camKeys(c, keys) {
    A(c.__cam, "cam", keys.map(([t, [fx, fy, z], e]) => [t, [fx, fy, z === "w" ? L.zw : z === "p" ? L.zp : z], e]));
}
// Enter and leave the frame. kind: "fade" (a cut inside the same window) or "push".
// A "fade" entrance fades the card in on top of the one before, which stays
// opaque underneath until the new one is fully in, so there is no dip.
function show(c, t0, t1, enter = "fade", leave = "fade") {
    const o = [], x = [], y = [], s = [];
    if (enter === "push") { o.push([t0, 0], [t0 + 0.5, 1, "o"]); x.push([t0, 140], [t0 + 0.55, 0, "o"]); }
    else if (enter === "rise") { o.push([t0, 0], [t0 + 0.5, 1, "o"]); y.push([t0, 60], [t0 + 0.55, 0, "o"]); }
    else o.push([t0, 0], [t0 + 0.3, 1, "io"]);
    if (leave === "push") { o.push([t1 - 0.45, 1], [t1, 0, "io"]); x.push([t1 - 0.5, 0], [t1, -140, "i"]); }
    else if (leave === "fall") { o.push([t1 - 0.35, 1], [t1, 0, "io"]); s.push([t1 - 0.4, 1], [t1, 0.97, "io"]); }
    // Once the next card is fully in, ease this one out underneath it so its
    // shadow fades rather than vanishing in one frame.
    else o.push([t1 + 0.3, 1], [t1 + 0.52, 0, "io"]);
    A(c, "o", o);
    if (x.length) A(c, "x", x);
    if (y.length) A(c, "y", y);
    if (s.length) A(c, "s", s);
}
// Scroll a thread so element i is fully in view by time t.
function autoscroll(th, i, t) {
    const el = th.__els[i];
    const need = el.offsetTop + el.offsetHeight + 28 - th.__viewH;
    if (need > 0) A(th.__scroll, "scrollY", [[t, 0], [t + 0.5, need, "io"]]);
}
function glow(cam, r, t0, t1, pad = 6) {
    const g = h("div", { class: "glow", style: { left: r.x - pad + "px", top: r.y - pad + "px", width: r.w + 2 * pad + "px", height: r.h + 2 * pad + "px" } });
    cam.append(g);
    A(g, "o", t1 ? [[t0, 0], [t0 + 0.4, 1, "o"], [t1 - 0.4, 1], [t1, 0]] : [[t0, 0], [t0 + 0.4, 1, "o"]]);
    return g;
}
// The tracked changes the capture found in a document shot, merged into
// up to `max` blocks (runs on one line, then lines close together).
function revisionBlocks(name, max = 3) {
    const boxes = ((shotMeta[name] || {}).revisions || []).slice().sort((a, b) => a.y - b.y || a.x - b.x);
    const lines = [];
    for (const b of boxes) {
        const l = lines.find((l) => Math.abs(l.y - b.y) < 6);
        if (l) { const x2 = Math.max(l.x + l.w, b.x + b.w); l.x = Math.min(l.x, b.x); l.w = x2 - l.x; l.h = Math.max(l.h, b.h); }
        else lines.push({ ...b });
    }
    const blocks = [];
    for (const l of lines) {
        const last = blocks[blocks.length - 1];
        if (last && l.y - (last.y + last.h) < 12) {
            const x2 = Math.max(last.x + last.w, l.x + l.w), y2 = l.y + l.h;
            last.x = Math.min(last.x, l.x); last.w = x2 - last.x; last.h = y2 - last.y;
        } else blocks.push({ ...l });
    }
    return blocks.slice(0, max);
}
const CURSOR_SVG = `<svg viewBox="0 0 22 30" width="22" height="30"><path d="M2 2 L2 24 L7.5 18.8 L11.2 27.6 L15 26 L11.4 17.4 L19 17.4 Z" fill="#111" stroke="#fff" stroke-width="1.6" stroke-linejoin="round"/></svg>`;
function cursor(cam, path, clicks = []) {
    const cur = h("div", { class: "cursor", html: CURSOR_SVG });
    cam.append(cur);
    A(cur, "x", path.map(([t, x, , e]) => [t, x, e || "io"]));
    A(cur, "y", path.map(([t, , y, e]) => [t, y, e || "io"]));
    A(cur, "o", [[path[0][0] - 0.01, 0], [path[0][0], 1, "h"]]);
    for (const [t, x, y] of clicks) {
        const ring = h("div", { class: "ring", style: { left: x + "px", top: y + "px" } });
        cam.append(ring);
        A(ring, "o", [[t, 0], [t + 0.05, 1, "o"], [t + 0.45, 0, "o"]]);
        A(ring, "s", [[t, 0.4], [t + 0.45, 1.25, "o"]]);
        A(cur, "s", [[t - 0.08, 1], [t, 0.86, "o"], [t + 0.14, 1, "o"]]);
    }
    return cur;
}

// ================================================================ BEAT 1 · title (0–8)
// General Legal's header logo (mark and outlined wordmark, drawn in currentColor).
function glLogo(height) {
    const wrap = h("div", { html: window.__GL_SVG, style: { color: "var(--ink)", lineHeight: "0" } });
    const svg = wrap.querySelector("svg");
    svg.setAttribute("height", height);
    svg.setAttribute("width", Math.round(height * 116 / 18));
    svg.querySelectorAll("path").forEach((p) => p.removeAttribute("style"));
    return wrap;
}
const iconPx = Math.round(L.wmSize * 0.86);
const wordmark = () => h("div", { class: "wordmark" },
    h("div", { class: "icon", style: { width: iconPx + "px", height: iconPx + "px", marginRight: Math.round(L.wmSize * 0.1) + "px" } },
        h("img", { src: "assets/mikegc-icon.svg" })),
    h("div", { class: "word", style: { fontSize: L.wmSize + "px" } }, "Mike", h("span", { class: "gc" }, "GC")));
const eyebrow = anchor(L.cx, L.cy - 22 - 132, textEl("Feature demo", "", L.eyebrowSize, { fontWeight: 400, opacity: 0.7, letterSpacing: "0.01em" }));
const wm = anchor(L.cx, L.cy - 22, wordmark());
const subtitle = anchor(L.cx, L.cy - 22 + L.subDy, textEl("For in-house legal teams", "", L.subSize, { fontWeight: 400 }));

// ================================================================ BEAT 2 · the two features (8–10.7)
const feature = anchor(L.cx, L.cy - 92, textEl("In this demo", "", L.featureSize, { fontWeight: 400, opacity: 0.8 }));
const word1 = h("span", { style: { display: "inline-block" } }, "Connectors");
const word2 = h("span", { style: { display: "inline-block", marginLeft: "0.28em" } }, h("span", { style: { opacity: 0.55 } }, "&"), " Workflows");
const titles = anchor(L.cx, L.cy + 18, h("div", { class: "serif", style: { fontSize: L.titleSize + "px", whiteSpace: "nowrap" } }, word1, word2));

// ================================================================ BEAT 3 · connectors (10.7–17.8)
const CONNECTORS = [
    ["google-drive.svg", "Google Drive"], ["gmail.svg", "Gmail"], ["google-calendar.svg", "Google Calendar"],
    ["courtlistener.svg", "CourtListener"], ["slack.svg", "Slack"], ["notion.svg", "Notion"],
    ["linear.svg", "Linear"], ["airtable.svg", "Airtable"], ["lawve.svg", "Lawve"],
];
// A glass card of connector tiles, three to a row, each with an on switch.
// With `filled`, the tiles carry their icons and names; otherwise they arrive.
function connectorGrid(x, top, w, filled, tileH = L.grid.tileH, toggles_ = true) {
    const G = L.grid;
    const tw = (w - 2 * G.pad - 2 * G.gap) / 3;
    const hgt = G.head + 3 * tileH + 2 * G.gap + 32;
    const card = h("div", { class: "abs glass queue", style: { left: x + "px", top: top + "px", width: w + "px", height: hgt + "px", transformOrigin: "50% 50%" } },
        h("div", { class: "head", style: { fontSize: G.font + 2 + "px" } }, "Connectors", h("span", { style: { opacity: 0.45, margin: "0 0.4em" } }, "·"), "Installed"));
    const slots = [], toggles = [];
    CONNECTORS.forEach(([file, name], i) => {
        const tx = G.pad + (i % 3) * (tw + G.gap), ty = G.head + Math.floor(i / 3) * (tileH + G.gap);
        const tile = h("div", { class: "tile", style: { left: tx + "px", top: ty + "px", width: tw + "px", height: tileH + "px" } });
        const tg = h("div", { class: "toggle" }, h("div", { class: "knob" }));
        if (toggles_) tile.append(tg);
        if (filled) {
            tile.append(h("img", { class: "ticon", src: "assets/" + file, style: { width: G.icon + "px", height: G.icon + "px" } }),
                h("div", { class: "tname", style: { fontSize: G.font + "px" } }, name));
        }
        card.append(tile);
        toggles.push(tg);
        // Stage coordinates of the icon's centre and the name's left edge.
        slots.push({ tile, iconX: x + tx + 24 + G.icon / 2, iconY: top + ty + tileH / 2, nameX: x + tx + 24 + G.icon + 18, nameY: top + ty + tileH / 2 });
    });
    card.append(h("div", { class: "edge" }));
    stage.append(card);
    card.__slots = slots;
    card.__toggles = toggles;
    return card;
}
const G = L.grid;
const grid = connectorGrid((L.W - G.w) / 2, G.top, G.w, false);
const logos = [], names = [];
CONNECTORS.forEach(([file, name], i) => {
    const x = L.logoX0 + i * L.logoDx;
    logos.push(anchor(x, L.logoY, h("div", { class: "chan", style: { width: L.logoSize + "px", height: L.logoSize + "px" } }, h("img", { src: "assets/" + file }))));
    names.push(anchor(x, L.logoY + L.logoSize / 2 + 34, textEl(name, "label", L.nameSize, { opacity: 0.8 })));
});

// ================================================================ shared scene pieces
const TH = L.thread;
// An email in a mailbox: a neutral mail view with the Gmail logo, not Gmail's own UI.
function mailCard(m) {
    const r = L.card;
    const sc = r.w / TH.w;
    const innerH = r.h / sc;
    const c = h("div", { class: "abs glass", style: { left: r.x + "px", top: r.y + "px", width: r.w + "px", height: r.h + "px", transformOrigin: "50% 50%" } });
    const t = h("div", { class: "thread", style: { width: TH.w + "px", height: innerH + "px", transform: `scale(${sc})` } });
    const bar = h("div", { class: "bar" }, h("img", { src: "assets/gmail.svg" }), h("span", { class: "ch" }, "Inbox"), h("span", { class: "sub" }, m.mailbox));
    const scroll = h("div", { class: "scroll" });
    const subj = h("div", { class: "subj" }, m.subject);
    const msg = msgEl(m);
    const head = msg.querySelector(".nm").parentElement;
    head.querySelector(".nm").after(h("span", { class: "addr" }, `<${m.addr}>`));
    head.after(h("div", { class: "to" }, m.to));
    msg.classList.add("mail");
    scroll.append(subj, msg);
    t.append(bar, h("div", { class: "body" }, scroll));
    c.append(t, h("div", { class: "edge" }));
    stage.append(c);
    c.__msg = msg;
    return c;
}
function msgEl(m) {
    const av = h("div", { class: "av", style: { background: "#e5e7eb" } }, h("img", { class: "photo", src: `assets/avatars/${m.photo}.jpg` }));
    const head = h("div", {}, h("span", { class: "nm" }, m.name), h("span", { class: "tm" }, m.time));
    const tx = h("div", { class: "tx", html: m.html });
    return h("div", { class: "msgx" }, av, h("div", { style: { minWidth: "0" } }, head, tx));
}
const TOM_MAIL = {
    mailbox: "tom@alia.ai", subject: "Harbor & Pine MSA: liability cap",
    photo: "priya", name: "Priya Shah", addr: "priya@alia.ai", to: "to Tom Becker", time: "10:13 AM",
    html: "Hi Tom,<br><br>I've reviewed Harbor &amp; Pine's draft MSA for the renewal. Section 11.2 would cap Harbor &amp; Pine's liability at the fees we paid in the previous three months, about $54,000, with no exceptions. California courts will generally enforce a cap like this between businesses, though it can't cover fraud, wilful injury or a violation of law.<br><br>I'd ask for the cap to be raised to 12 months' fees, with data breaches and confidentiality left outside it. I'll send Harbor &amp; Pine a markup this week.<br><br>Priya",
};

// The workflows catalog repository, as a neutral file list (not a code host's own UI).
const CATALOG = [
    ["contract-intake", "MikeGC", "Apache-2.0"], ["contract-markup", "MikeGC", "Apache-2.0"], ["obligation-tracking", "MikeGC", "Apache-2.0"],
    ["proofread", "Anna Guo", "MIT"], ["compare-documents", "Open Legal Products", "MIT"], ["extract-key-terms", "Open Legal Products", "MIT"],
    ["draft-from-template", "Open Legal Products", "MIT"], ["commercial-agreement-tabular-review", "Open Legal Products", "MIT"],
];
const FOLDER_SVG = '<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="#6b7280" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"/></svg>';
const BOOK_SVG = '<svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="#14140F" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H19a1 1 0 0 1 1 1v18a1 1 0 0 1-1 1H6.5a1 1 0 0 1 0-5H20"/></svg>';
function repoCard() {
    const w = 1240, rowH = 70, head = 132, x = (L.W - w) / 2, top = 112;
    const hgt = head + CATALOG.length * rowH + 22;
    const c = h("div", { class: "abs glass queue repo", style: { left: x + "px", top: top + "px", width: w + "px", height: hgt + "px", transformOrigin: "50% 50%" } },
        h("div", { class: "rhead" }, h("div", { class: "rtitle", html: BOOK_SVG + "<span>MikeGC Legal Workflows</span>" }),
            h("div", { class: "rurl" }, "github.com/open-legal-products/", h("b", {}, "mikegc-workflows"))));
    const rows = CATALOG.map(([key, author, lic], i) => {
        const row = h("div", { class: "rrow", style: { top: head + i * rowH + "px", height: rowH + "px" } },
            h("div", { class: "rk", html: FOLDER_SVG + `<span>${key}</span>` }), h("div", { class: "ra" }, author), h("div", { class: "rl" }, lic));
        if (i > 0) c.append(h("div", { class: "rule", style: { top: head + i * rowH + "px" } }));
        c.append(row);
        return row;
    });
    c.append(h("div", { class: "edge" }));
    stage.append(c);
    c.__rows = rows;
    c.__x = x; c.__top = top; c.__head = head; c.__rowH = rowH; c.__w = w;
    return c;
}
// The recap's workflows card: the eight names, the three quick actions marked.
const WORKFLOWS = ["Contract Intake", "Contract Markup", "Obligation Tracking", "Proofread", "Compare Documents", "Extract Key Terms", "Draft from Template", "Commercial Agreement Tabular Review"];
function workflowsCard(x, top, w, hgt) {
    const head = 84, rowH = (hgt - head - 24) / WORKFLOWS.length;
    const c = h("div", { class: "abs glass queue", style: { left: x + "px", top: top + "px", width: w + "px", height: hgt + "px", transformOrigin: "50% 50%" } },
        h("div", { class: "head", style: { fontSize: G.font + 2 + "px" } }, "Workflows"));
    const labels = [];
    WORKFLOWS.forEach((name, i) => {
        const row = h("div", { class: "wrow", style: { top: head + i * rowH + "px", height: rowH + "px" } }, h("span", {}, name));
        if (i < 3) { const q = h("span", { class: "qa" }, "Quick action"); row.append(q); labels.push(q); }
        if (i > 0) c.append(h("div", { class: "rule", style: { top: head + i * rowH + "px" } }));
        c.append(row);
    });
    c.append(h("div", { class: "edge" }));
    stage.append(c);
    c.__labels = labels;
    return c;
}

// The chapter title for the workflows half.
const chapterLabel = anchor(L.cx, L.cy - 92, textEl("The MikeGC workflows library", "", L.featureSize, { fontWeight: 400, opacity: 0.8 }));
const chapterWord = anchor(L.cx, L.cy + 18, textEl("Workflows", "serif", L.titleSize));

// ================================================================ build the timeline
const T = {};
function buildTimeline() {
    const H = C.hits;
    // --- Beat 1: "Feature demo", the wordmark on wave 1's chord, the subtitle.
    A(white, "o", [[0, 1], [0.9, 0, "io"]]);
    fadeIn(eyebrow, C.eyebrowIn, 0.6, 12);
    A(wm, "o", [[C.mikeIn - 0.2, 0], [C.mikeIn + 0.4, 1, "o"]]);
    A(wm, "y", [[C.mikeIn - 0.2, 34], [C.mikeIn + 0.05, -3, "o"], [C.mikeIn + 0.5, 0, "io"]]);
    A(wm, "s", [[C.mikeIn - 0.2, 1.04], [C.mikeIn + 0.05, 1, "o"]]);
    fadeIn(subtitle, C.subIn, 0.5, 12);
    const b2 = C.b2;
    for (const el of [eyebrow, subtitle]) A(el, "o", [[b2 - 0.15, 1], [b2 + 0.25, 0, "io"]]);
    A(wm, "o", [[b2, 1], [b2 + 0.45, 0, "io"]]);
    A(wm, "y", [[b2, 0], [b2 + 0.5, -36, "io"]]);

    // --- Beat 2: "Connectors" and "& Workflows" on wave 3's two chords.
    fadeIn(feature, C.featureIn, 0.45, 12);
    for (const [el, t] of [[word1, C.word1], [word2, C.word2]]) {
        A(el, "o", [[t - 0.22, 0], [t + 0.1, 1, "o"]]);
        A(el, "y", [[t - 0.22, 40], [t, -2, "o"], [t + 0.3, 0, "io"]]);
    }
    fadeOut(feature, C.b2out, 0.38, -30);
    fadeOut(titles, C.b2out, 0.38, -30);

    // --- Beat 3: each connector's logo lands on a chord or accent, then they gather into one card.
    H.logos.forEach((c, i) => {
        const lg = logos[i];
        A(lg, "o", [[c - 0.26, 0], [c - 0.06, 1, "o"]]);
        A(lg, "y", [[c - 0.26, -70], [c, 5, "i"], [c + 0.14, 0, "o"]]);
        A(lg, "s", [[c - 0.26, 1.18], [c, 1, "i"]]);
        A(names[i], "o", [[c + 0.1, 0], [c + 0.42, 1, "o"]]);
        A(names[i], "y", [[c + 0.1, -10], [c + 0.45, 0, "o"]]);
    });
    const tq = H.gather;
    A(grid, "o", [[tq - 0.05, 0], [tq + 0.4, 1, "o"]]);
    A(grid, "y", [[tq - 0.05, 50], [tq + 0.45, 0, "o"]]);
    const nameScale = G.font / L.nameSize;
    CONNECTORS.forEach((_, i) => {
        const d = i * 0.035, slot = grid.__slots[i];
        const lx = L.logoX0 + i * L.logoDx, nameY = L.logoY + L.logoSize / 2 + 34;
        const lg = logos[i];
        A(lg, "x", [[tq + d, 0], [tq + d + 0.62, slot.iconX - lx, "io"]]);
        A(lg, "y", [[tq + d, 0], [tq + d + 0.62, slot.iconY - L.logoY, "io"]]);
        A(lg, "s", [[tq + d, 1], [tq + d + 0.62, G.icon / L.logoSize, "io"]]);
        const nw = names[i].firstChild.getBoundingClientRect().width * nameScale;
        A(names[i], "x", [[tq + d, 0], [tq + d + 0.62, slot.nameX + nw / 2 - lx, "io"]]);
        A(names[i], "y", [[tq + d, 0], [tq + d + 0.62, slot.nameY - nameY, "io"]]);
        A(names[i], "s", [[tq + d, 1], [tq + d + 0.62, nameScale, "io"]]);
        A(grid.__toggles[i], "o", [[tq + d + 0.45, 0], [tq + d + 0.75, 1, "o"]]);
    });
    caption("Connect the tools your team already uses", tq + 0.3, H.settings - 0.05);

    // From here on every cut, entrance and click lands on a musical hit in C.hits
    // (see make_cues.py): a cut is centred on its hit.
    const LEAD = { fade: 0.1, push: 0.05, rise: 0.05 };
    function onBeat(c, h, n, enter = "fade", nextEnter = "fade", leave = "fade") {
        const t0 = h - LEAD[enter];
        const t1 = leave === "push" ? n + 0.2 : leave === "fall" ? n + 0.15 : n - LEAD[nextEnter];
        show(c, t0, t1, enter, leave);
        return t0;
    }
    function clickOn(cam, from, to, t, travel = 0.55) {
        cursor(cam, [[t - travel - 0.6, ...from], [t - travel - 0.13, ...from], [t - 0.13, ...to]], [[t, ...to]]);
    }
    const meta = (name) => shotMeta[name] || {};

    const b3end = H.settings - 0.05;
    A(grid, "o", [[b3end - 0.4, 1], [b3end, 0, "io"]]);
    A(grid, "s", [[b3end - 0.4, 1], [b3end, 0.97, "io"]]);
    [...logos, ...names].forEach((el) => A(el, "o", [[b3end - 0.4, 1], [b3end, 0, "io"]]));

    // --- Beat 4: Settings > Connectors. Installed, per workspace; add Linear; Gmail's Manage dialog.
    T.b4 = H.settings;
    const set1 = card([img("c_settings")]);
    const ts = onBeat(set1, H.settings, H.added, "rise", "fade");
    const m1 = meta("c_settings");
    const inst = m1.installed || { x: 706, y: 188, w: 712, h: 210 };
    camKeys(set1, [[ts, [1140, 330, 1.7]], [H.discover - 0.25, [1140, 330, 1.7]], [H.discover + 0.35, [1140, 450, 1.7]]]);
    glow(set1.__cam, m1.savedFor ? { ...m1.savedFor, w: 380 } : { x: 706, y: 152, w: 380, h: 20 }, H.savedFor - 0.1, H.discover + 0.1, 6);
    const addBtn = m1.linearAdd || { x: 1354, y: 483, w: 47, h: 28 };
    clickOn(set1.__cam, [1250, 700], centre(addBtn), H.addClick, 0.5);
    caption("Set up in Settings, for each workspace", H.settings + 0.2, H.discover - 0.05);
    caption("Add another in a click", H.discover, H.gmail - 0.1);
    const set2 = card([img("c_settings_added")]);
    const ta = onBeat(set2, H.added, H.gmail);
    const m2 = meta("c_settings_added");
    camKeys(set2, [[ta, [1140, 450, 1.7]], [H.added + 0.4, [1140, 450, 1.7]], [H.gmailClick - 0.9, [1140, 330, 1.7]]]);
    glow(set2.__cam, m2.linear || { x: 706, y: 410, w: 350, h: 62 }, H.added + 0.1, H.gmailClick - 0.1, 4);
    const gm = m2.gmail || { x: 1068, y: 188, w: 350, h: 62 };
    clickOn(set2.__cam, [1250, 330], [gm.x + 120, gm.y + gm.h / 2], H.gmailClick, 0.5);
    const gmail = card([img("c_gmail")]);
    const tg = onBeat(gmail, H.gmail, H.chat, "fade", "push", "push");
    const m3 = meta("c_gmail");
    const approvalRow = m3.approval || { x: 493, y: 351, w: 614, h: 38 };
    const writeRows = m3.send && m3.del ? { x: m3.send.x - 8, y: m3.send.y - 10, w: m3.send.w + 16, h: m3.del.y + m3.del.h - m3.send.y + 20 } : { x: 498, y: 595, w: 604, h: 128 };
    camKeys(gmail, [[tg, [800, 500, 1.6]], [H.approvalRow - 0.3, [800, 500, 1.6]], [H.approvalRow + 0.3, [800, 430, 1.9]],
        [H.writeTools - 0.3, [800, 430, 1.9]], [H.writeTools + 0.3, [800, 600, 1.9]]]);
    glow(gmail.__cam, approvalRow, H.approvalRow, H.writeTools + 0.1, 8);
    glow(gmail.__cam, writeRows, H.writeTools + 0.1, null, 4);
    caption("Choose what each connector can do", H.gmail, H.approvalRow - 0.1);
    caption("Changes wait for your approval", H.approvalRow, H.chat - 0.05);

    // --- Beat 5: the Assistant reads Drive, checks case law, and asks before it sends.
    T.b5 = H.chat;
    const steps = card([img("c_chat_steps")]);
    const tc = onBeat(steps, H.chat, H.approval, "push", "fade");
    const m4 = meta("c_chat_steps");
    camKeys(steps, [[tc, [930, 260, 1.5]], [H.steps - 0.35, [930, 260, 1.5]], [H.steps + 0.25, [930, 320, 1.7]]]);
    glow(steps.__cam, m4.prompt || { x: 680, y: 76, w: 666, h: 64 }, H.prompt, H.steps - 0.1, 6);
    glow(steps.__cam, m4.stepsCard || { x: 514, y: 216, w: 832, h: 178 }, H.steps, H.approval, 6);
    caption("Ask, and it searches Drive and checks case law", H.prompt, H.approval - 0.1);
    const appr = card([img("c_chat_approval")]);
    const tp = onBeat(appr, H.approval, H.sent);
    const m5 = meta("c_chat_approval");
    const action = m5.action || { x: 519, y: 651, w: 822, h: 288 };
    camKeys(appr, [[tp, [930, 720, 1.6]]]);
    glow(appr.__cam, action, H.approval + 0.15, H.approve + 0.2, 6);
    clickOn(appr.__cam, [1120, 860], m5.approve ? centre(m5.approve) : [1309, 963], H.approve, 0.6);
    caption("It asks before it sends anything", H.approval, H.sent - 0.1);
    const sent = card([img("c_chat_sent")]);
    const tsn = onBeat(sent, H.sent, H.mail, "fade", "push", "push");
    const m6 = meta("c_chat_sent");
    camKeys(sent, [[tsn, [930, 600, 1.5]]]);
    const sc = m6.sentCard || { x: 514, y: 618, w: 832, h: 106 };
    glow(sent.__cam, m6.done ? { x: sc.x, y: sc.y, w: sc.w, h: m6.done.y + m6.done.h - sc.y } : sc, H.sent + 0.2, null, 6);
    caption("Sent from Priya's own Gmail", H.sent, H.chapter - 0.05);
    const mail = mailCard(TOM_MAIL);
    onBeat(mail, H.mail, H.chapter, "push", "fade", "fall");
    fadeIn(mail.__msg, H.mailMsg - 0.05, 0.4, 18);

    // --- The workflows chapter.
    T.chapter = H.chapter;
    fadeIn(chapterLabel, H.chapter + 0.15, 0.45, 12);
    A(chapterWord, "o", [[H.chapterWord - 0.2, 0], [H.chapterWord + 0.4, 1, "o"]]);
    A(chapterWord, "y", [[H.chapterWord - 0.2, 46], [H.chapterWord + 0.45, 0, "o"]]);
    fadeOut(chapterLabel, H.list - 0.45, 0.38, -30);
    fadeOut(chapterWord, H.list - 0.45, 0.38, -30);

    // --- Beat 6: the library, and one workflow's instructions.
    const list = card([img("w_list")]);
    const tl = onBeat(list, H.list, H.detail, "push", "fade");
    const m7 = meta("w_list");
    camKeys(list, [[tl, [930, 330, 1.2]], [H.gcRows - 0.2, [930, 330, 1.2]], [H.gcRows + 0.45, [750, 280, 1.7]]]);
    glow(list.__cam, m7.gc || { x: 287, y: 165, w: 1286, h: 120 }, H.gcRows, H.detail, 4);
    caption("Eight workflows, ready for every member", H.list + 0.1, H.detail - 0.1);
    const det = card([img("w_detail")]);
    const td = onBeat(det, H.detail, H.home, "fade", "push", "push");
    camKeys(det, [[td, [930, 430, "w"]], [H.detailZoom - 0.3, [930, 430, "w"]], [H.detailZoom + 0.4, [701, 520, 1.9]]]);
    caption("Plain-language instructions you can edit", H.detail, H.home - 0.05);

    // --- Beat 7: Contract Markup as a quick action, on the MSA.
    const home = card([img("q_home")]);
    const th = onBeat(home, H.home, H.picker, "push", "fade");
    const m8 = meta("q_home");
    camKeys(home, [[th, [930, 560, 1.6]]]);
    glow(home.__cam, m8.quick ? { x: m8.quick.x - 10, y: m8.quick.y - 4, w: m8.quick.w + 20, h: m8.quick.h + 8 } : { x: 725, y: 629, w: 411, h: 70 }, H.quick, H.picker, 4);
    clickOn(home.__cam, [1150, 820], m8.markup ? centre(m8.markup) : [918, 679], H.qaClick, 0.5);
    caption("One click from the Assistant", H.home + 0.1, H.result - 0.1);
    const pick = card([img("q_picker")]);
    const tk = onBeat(pick, H.picker, H.composer);
    const m9 = meta("q_picker");
    camKeys(pick, [[tk, [800, 500, 1.6]]]);
    glow(pick.__cam, m9.msa || { x: 485, y: 364, w: 630, h: 32 }, H.picker + 0.1, null, 4);
    clickOn(pick.__cam, [860, 600], m9.confirm ? centre(m9.confirm) : [1080, 771], H.confirm, 0.45);
    const comp = card([img("q_composer")]);
    const tco = onBeat(comp, H.composer, H.result);
    const m10 = meta("q_composer");
    camKeys(comp, [[tco, [930, 500, 1.6]]]);
    if (m10.pills) glow(comp.__cam, { x: m10.pills.x - 26, y: m10.pills.y - 6, w: m10.pills.w + 48, h: m10.pills.h + 12 }, H.composer + 0.15, H.send, 4);
    clickOn(comp.__cam, [1150, 700], m10.send ? centre(m10.send) : [1322, 538], H.send, 0.55);
    const res = card([img("q_chat")]);
    const tr = onBeat(res, H.result, H.doc);
    const m11 = meta("q_chat");
    camKeys(res, [[tr, [930, 560, 1.5]]]);
    glow(res.__cam, m11.table || { x: 514, y: 574, w: 832, h: 320 }, H.table, H.doc + 0.1, 6);
    caption("A redline with tracked changes, in a copy", H.result, H.repo - 0.05);
    const doc = card([img("q_doc")]);
    const tdc = onBeat(doc, H.doc, H.repo, "fade", "push", "push");
    const blocks = revisionBlocks("q_doc", 2);
    const focus = blocks.length ? [1215, blocks[0].y + 30] : [1215, 600];
    camKeys(doc, [[tdc, [1200, 520, "w"]], [H.docGlow - 0.45, [1200, 520, "w"]], [H.docGlow + 0.1, [...focus, 1.9]]]);
    blocks.forEach((b, i) => glow(doc.__cam, b, H.docGlow + i * 0.18, null, 4));

    // --- Beat 8: the catalog, in the open; then the recap.
    const repo = repoCard();
    onBeat(repo, H.repo, H.recap, "push", "fade", "fall");
    repo.__rows.forEach((r, i) => fadeIn(r, H.repoRows - 0.2 + i * 0.07, 0.35, 10));
    const gcRows = h("div", { class: "glow", style: { left: "18px", top: repo.__head - 6 + "px", width: repo.__w - 36 + "px", height: 3 * repo.__rowH + 12 + "px" } });
    repo.insertBefore(gcRows, repo.lastChild);
    A(gcRows, "o", [[H.repoGlow, 0], [H.repoGlow + 0.4, 1, "o"]]);
    caption("Open source, as Agent Skills you can reuse", H.repo + 0.2, H.recap - 0.05);

    const recapTop = 272, leftW = 1000, rightW = 680, gap = 40, rx = (L.W - leftW - rightW - gap) / 2;
    const left = connectorGrid(rx, recapTop, leftW, true, 96, false);
    const leftH = parseFloat(left.style.height);
    const right = workflowsCard(rx + leftW + gap, recapTop, rightW, leftH);
    for (const [c, d] of [[left, 0], [right, 0.12]]) {
        A(c, "o", [[H.recap + d - 0.05, 0], [H.recap + d + 0.45, 1, "o"]]);
        A(c, "y", [[H.recap + d - 0.05, 50], [H.recap + d + 0.5, 0, "o"]]);
        A(c, "o", [[C.endcard - 0.4, 1], [C.endcard, 0, "io"]]);
        A(c, "s", [[C.endcard - 0.4, 1], [C.endcard, 0.97, "io"]]);
    }
    right.__labels.forEach((q, i) => fadeIn(q, H.quickLabels + i * 0.08, 0.35, 0));
    caption("Your tools and your workflows, in MikeGC", H.recapCaption, C.endcard - 0.05);

    // --- End card: the MikeGC wordmark, "Sponsored by" and General Legal's logo.
    const e = C.endcard;
    const endWm = anchor(L.cx, L.end.wmY, wordmark());
    A(endWm, "o", [[e, 0], [e + 0.7, 1, "o"]]);
    A(endWm, "y", [[e, 26], [e + 0.75, 0, "o"]]);
    const by = anchor(L.cx, L.end.byY, textEl("Sponsored by", "", L.end.bySize, { fontWeight: 400, opacity: 0.7, letterSpacing: "0.01em" }));
    fadeIn(by, e + 0.75, 0.5, 10);
    const glEnd = anchor(L.cx, L.end.glY, glLogo(L.end.glH));
    fadeIn(glEnd, e + 0.9, 0.5, 10);

    stage.append(white);
    window.__T = T;
}

// ---------------------------------------------------------------- boot
window.__ready = (async () => {
    await document.fonts.ready;
    await Promise.all([...document.images].map((i) => i.decode().catch(() => {})));
    buildTimeline();
    await Promise.all([...document.images].map((i) => i.decode().catch(() => {})));
    seek(0);
    return true;
})();
window.__seek = (t) => { seek(t); };
window.__C = C;
