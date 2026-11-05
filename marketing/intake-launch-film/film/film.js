/* MikeGC Intake launch film: a deterministic timeline rendered frame by frame.
   window.__seek(t) poses every element for time t (seconds). */
"use strict";

const QS = new URLSearchParams(location.search);
const FORMAT = QS.get("f") || "16x9";
const CUES = window.__CUES || {};

// ---------------------------------------------------------------- timing cues
// Music and voiceover land on these. render.cjs injects measured values.
const C = Object.assign({
    vo: [0.40, 7.25, 10.25, 18.55, 28.35, 38.35, 48.45],
    chords: [10.62, 12.52, 14.42, 16.32], // the accented chords each logo lands on
    endcard: 54.0,
    end: 60.0,
    // Beat 1, set against the first line: "General Legal | has sponsored | MikeOSS | to design MikeGC | : a fork of Mike..."
    glIn: 0.45, sponsorsIn: 1.35, swap: 2.6, mikeIn: 2.8, gcType: 3.7, subIn: 4.6,
}, CUES);

// ---------------------------------------------------------------- layouts
const LAYOUTS = {
    "16x9": {
        W: 1920, H: 1080, cx: 960, cy: 530,
        card: { x: 272, y: 64, w: 1376, h: 860 }, dashEnd: [930, 470, 1.2], zw: 1, zp: 1.3,
        capY: 984, capSize: 36, footY: 1038, footSize: 22,
        wmSize: 120, glH: 56, sponsorsSize: 36, subSize: 36, subDy: 112,
        featureSize: 34, intakeSize: 120,
        corner: { left: 48, cy: 46, s: 0.3 },
        logoSize: 112, logoY: 300, logoXs: [330, 750, 1170, 1590],
        bubble: { mode: "under", w: 380, font: 25, top: 392 },
        queue: { w: 1180, rowH: 96, top: 300, font: 26 },
        thread: { w: 1200 },
        end: { wmY: 440, intakeY: 560, intakeSize: 72, tagY: 660, urlY: 718, sponsorY: 1000, tagSize: 36, urlSize: 28, sponsorSize: 22 },
    },
    "1x1": {
        W: 1080, H: 1080, cx: 540, cy: 520,
        card: { x: 40, y: 104, w: 1000, h: 760 }, dashEnd: [720, 520, 1.6], zw: 1.3, zp: 1.75,
        capY: 930, capSize: 36, footY: 990, footSize: 22,
        wmSize: 104, glH: 48, sponsorsSize: 32, subSize: 32, subDy: 100,
        featureSize: 30, intakeSize: 112,
        corner: { left: 36, cy: 44, s: 0.3 },
        logoSize: 92, logoY: 230, logoXs: [165, 415, 665, 915],
        bubble: { mode: "stack", w: 860, font: 24, top: 330, gap: 94 },
        queue: { w: 1000, rowH: 96, top: 290, font: 24 },
        thread: { w: 1000 },
        end: { wmY: 420, intakeY: 530, intakeSize: 66, tagY: 625, urlY: 680, sponsorY: 1000, tagSize: 32, urlSize: 26, sponsorSize: 21 },
    },
    "9x16": {
        W: 1080, H: 1920, cx: 540, cy: 900,
        card: { x: 40, y: 430, w: 1000, h: 1100 }, dashEnd: [680, 500, 1.25], zw: 1, zp: 1.35,
        capY: 1660, capSize: 40, footY: 1730, footSize: 24,
        wmSize: 116, glH: 52, sponsorsSize: 36, subSize: 34, subDy: 112,
        featureSize: 34, intakeSize: 132,
        corner: { left: 48, cy: 96, s: 0.32 },
        logoSize: 110, logoY: 560, logoXs: [165, 415, 665, 915],
        bubble: { mode: "stack", w: 900, font: 26, top: 680, gap: 104 },
        queue: { w: 1000, rowH: 104, top: 700, font: 26 },
        thread: { w: 1000 },
        end: { wmY: 800, intakeY: 925, intakeSize: 76, tagY: 1030, urlY: 1092, sponsorY: 1780, tagSize: 36, urlSize: 28, sponsorSize: 23 },
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
SPECIAL.cam = (el, v) => {
    const { w, h } = el.__card;
    const cover = Math.max(w / 1600, h / 1000);
    const z = cover * v[2];
    let tx = w / 2 - v[0] * z, ty = h / 2 - v[1] * z;
    tx = Math.min(0, Math.max(w - 1600 * z, tx));
    ty = Math.min(0, Math.max(h - 1000 * z, ty));
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
    const cam = h("div", { class: "cam" });
    cam.__card = r;
    for (const l of layers) cam.append(l);
    c.append(cam, h("div", { class: "edge" }));
    stage.append(c);
    c.__cam = cam;
    return c;
}
const img = (name, attrs = {}) => h("img", Object.assign({ class: "shot", src: `shots/${name}.png` }, attrs));
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
    else o.push([t1 + 0.3, 1], [t1 + 0.31, 0, "h"]);
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

// ================================================================ BEAT 1 · sponsor (0–7)
const GL_SVG = window.__GL_SVG;
const glWrap = h("div", { html: GL_SVG, style: { color: "var(--ink)", lineHeight: "0" } });
const glSvg = glWrap.querySelector("svg");
glSvg.setAttribute("height", L.glH);
glSvg.setAttribute("width", Math.round(L.glH * 116 / 18));
glSvg.querySelectorAll("path").forEach((p) => p.removeAttribute("style"));
const gl = anchor(L.cx, L.cy - 18, glWrap);
fadeIn(gl, C.glIn, 0.6, 16);
A(gl, "o", [[C.swap, 1], [C.swap + 0.3, 0, "io"]]);
A(gl, "y", [[C.swap, 0], [C.swap + 0.4, -44, "io"]]);

const sponsors = anchor(L.cx, L.cy + 62, textEl("sponsors", "", L.sponsorsSize, { fontWeight: 400, letterSpacing: "0.01em" }));
fadeIn(sponsors, C.sponsorsIn, 0.45, 10);
A(sponsors, "o", [[C.swap - 0.05, 1], [C.swap + 0.25, 0, "io"]]);
A(sponsors, "y", [[C.swap - 0.05, 0], [C.swap + 0.3, -20, "io"]]);

// The wordmark: mark + "Mike" + "GC".
const iconPx = Math.round(L.wmSize * 0.86);
const iconBox = h("div", { class: "icon", style: { width: iconPx + "px", height: iconPx + "px", marginRight: Math.round(L.wmSize * 0.1) + "px" } },
    h("img", { src: "assets/mikeoss-icon-orig.svg" }),
    h("img", { src: "assets/mikegc-icon.svg", class: "blue" }));
const gcSpan = h("span", { class: "gc", style: { display: "inline-block", textAlign: "left" } }, "GC");
gcSpan.__full = "GC";
const word = h("div", { class: "word", style: { fontSize: L.wmSize + "px" } }, "Mike", gcSpan);
const wmInner = h("div", { class: "wordmark" }, iconBox, word);
const wm = anchor(L.cx, L.cy - 22, wmInner);

const subtitle = anchor(L.cx, L.cy - 22 + L.subDy, textEl("A fork of Mike for in-house legal teams", "", L.subSize, { fontWeight: 400 }));

// ================================================================ BEAT 2 · feature (7–10)
const feature = anchor(L.cx, L.cy - 92, textEl("Its first feature", "", L.featureSize, { fontWeight: 400, opacity: 0.8 }));
const intake = anchor(L.cx, L.cy + 18, textEl("Intake", "serif", L.intakeSize));

// ================================================================ BEAT 3 · channels (10–18)
const CHANNELS = [
    { logo: "gmail.svg", text: "DPA for Brightwater: need sign-off this week", who: "Maya Chen" },
    { logo: "outlook.svg", text: "Can Legal check the Harbor & Pine renewal?", who: "Tom Becker" },
    { logo: "slack.svg", text: "<b>@MikeGC</b> can someone review Acme's NDA by Friday?", who: "Jordan Lee" },
    { logo: "teams.svg", text: "<b>@MikeGC</b> is this claim OK for the launch page?", who: "Alex Rivera" },
];
const Q = L.queue;
const qx = (L.W - Q.w) / 2;
const qHead = 84;
const qH = qHead + Q.rowH * 4 + 18;
const queue = h("div", { class: "abs glass queue", style: { left: qx + "px", top: Q.top + "px", width: Q.w + "px", height: qH + "px", transformOrigin: "50% 50%" } },
    h("div", { class: "head", style: { fontSize: Q.font + "px" } }, "Intake", h("span", { style: { opacity: 0.45, margin: "0 0.4em" } }, "·"), "Outstanding"),
    h("div", { class: "edge" }));
stage.append(queue);
const iconSlot = 40;
const rowEls = [];
CHANNELS.forEach((ch, i) => {
    const top = qHead + i * Q.rowH;
    if (i > 0) queue.insertBefore(h("div", { class: "rule", style: { top: top + "px" } }), queue.lastChild);
    const row = h("div", { class: "row", style: { top: top + "px", height: Q.rowH + "px", padding: `0 36px 0 ${36 + iconSlot + 22}px`, fontSize: Q.font + "px", gap: "24px" } },
        h("div", { style: { flex: "1", minWidth: "0" } },
            h("div", { class: "msg", html: ch.text.replace(/<b>/g, '<b style="font-weight:500;color:var(--gc)">') }),
            h("div", { class: "who", style: { fontSize: Math.round(Q.font * 0.72) + "px", marginTop: "4px" } }, ch.who)),
        h("div", { class: "st", style: { fontSize: Math.round(Q.font * 0.8) + "px" } }, h("span", { class: "dot" }), "New"));
    queue.insertBefore(row, queue.lastChild);
    rowEls.push(row);
});

const logos = [], bubbles = [];
CHANNELS.forEach((ch, i) => {
    const lg = anchor(L.logoXs[i], L.logoY, h("div", { class: "chan", style: { width: L.logoSize + "px", height: L.logoSize + "px" } }, h("img", { src: "assets/" + ch.logo })));
    logos.push(lg);
    const b = L.bubble;
    const bubble = h("div", { class: "bubble", style: { width: b.w + "px", fontSize: b.font + "px", textAlign: b.mode === "under" ? "center" : "left" }, html: ch.text });
    const by = b.mode === "under" ? b.top : b.top + i * b.gap;
    const bx = b.mode === "under" ? L.logoXs[i] : L.cx;
    // Anchor the bubble by its top centre.
    const ba = h("div", { class: "abs", style: { left: bx + "px", top: by + "px", width: "0", height: "0" } },
        h("div", { style: { position: "absolute", left: "0", top: "0", transform: "translate(-50%, 0)" } }, bubble));
    stage.append(ba);
    bubbles.push(ba);
});

// ================================================================ BEAT 4 · capture (18–28)
const TH = L.thread;
function thread(messages, opts = {}) {
    const r = L.card;
    const sc = r.w / TH.w;
    const innerH = r.h / sc;
    const c = h("div", { class: "abs glass", style: { left: r.x + "px", top: r.y + "px", width: r.w + "px", height: r.h + "px", transformOrigin: "50% 50%" } });
    const t = h("div", { class: "thread", style: { width: TH.w + "px", height: innerH + "px", transform: `scale(${sc})` } });
    const bar = h("div", { class: "bar" }, h("img", { src: "assets/slack.svg" }), h("span", { class: "ch" }, "# legal-requests"), h("span", { class: "sub" }, "Thread"));
    const body = h("div", { class: "body" });
    const scroll = h("div", { class: "scroll" });
    body.append(scroll);
    t.append(bar, body);
    c.append(t, h("div", { class: "edge" }));
    stage.append(c);
    const els = messages.map((m) => {
        const el = m.divider ? h("div", { class: "divider" }, m.divider) : msgEl(m);
        scroll.append(el);
        return el;
    });
    c.__scroll = scroll;
    c.__els = els;
    c.__viewH = innerH - 84;
    return c;
}
const AV = { JL: "#5b4fc4", PS: "#7c3aed" };
function msgEl(m) {
    const av = m.mike
        ? h("div", { class: "av", style: { background: "#fff", border: "1px solid #ececef" } }, h("img", { src: "assets/mikegc-icon.svg" }))
        : h("div", { class: "av", style: { background: AV[m.initials] || "#666" } }, m.initials);
    const head = h("div", {}, h("span", { class: "nm" }, m.name), m.app ? h("span", { class: "app" }, "APP") : null, h("span", { class: "tm" }, m.time));
    const tx = h("div", { class: "tx", html: m.html });
    const col = h("div", { style: { minWidth: "0" } }, head, tx);
    if (m.file) col.append(h("div", { class: "file" },
        h("div", { class: "fi", html: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/><path d="M8 13h8M8 17h6"/></svg>' }),
        h("div", {}, h("div", { class: "fn" }, m.file), h("div", { class: "fk" }, m.fileKind || "Word document"))));
    return h("div", { class: "msgx" }, av, col);
}
const M_JORDAN = { initials: "JL", name: "Jordan Lee", time: "10:14 AM", html: '<span class="mention">@MikeGC</span> can someone review Acme\'s NDA by Friday?', file: "Acme_NDA.docx" };
const M_ACK = { mike: true, name: "MikeGC", app: true, time: "10:14 AM", html: 'Logged for Legal: <span class="lnk">Review Acme\'s NDA</span>. Assigned to Priya Shah.' };
const M_ASK = { initials: "PS", name: "Priya Shah", app: true, time: "10:21 AM", html: "Is this mutual? Their draft only protects Acme." };
const M_REPLY = { initials: "JL", name: "Jordan Lee", time: "10:24 AM", html: "Mutual. We're sharing roadmaps." };
const M_RESOLVE = { initials: "PS", name: "Priya Shah", app: true, time: "10:31 AM", html: "Approved as a mutual NDA. Send Acme the attached redline.", file: "Acme_NDA.docx", fileKind: "Word document · redline" };

// ================================================================ build the timeline
const T = {};
function buildTimeline() {
    // --- Beat 1
    A(white, "o", [[0, 1], [0.9, 0, "io"]]);
    const wmW = wmInner.getBoundingClientRect().width; // with "GC" laid out below
    const gcW = gcSpan.getBoundingClientRect().width;
    gcSpan.style.width = gcW + "px"; // keep its space so the wordmark slides rather than jumps
    gcSpan.textContent = "";
    A(gcSpan, "chars", [[C.gcType, 0], [C.gcType + 0.36, 2, "l"]]);
    A(wm, "o", [[C.mikeIn, 0], [C.mikeIn + 0.55, 1, "o"]]);
    A(wm, "y", [[C.mikeIn, 34], [C.mikeIn + 0.6, 0, "o"]]);
    A(wm, "x", [[C.gcType, gcW / 2], [C.gcType + 0.6, 0, "io"]]);
    const blue = iconBox.querySelector(".blue");
    const black = iconBox.querySelector("img:not(.blue)");
    A(blue, "o", [[C.gcType + 0.4, 0], [C.gcType + 0.95, 1, "io"]]);
    A(black, "o", [[C.gcType + 0.4, 1], [C.gcType + 0.95, 0, "io"]]);
    fadeIn(subtitle, C.subIn, 0.5, 12);
    const b2 = C.b2 != null ? C.b2 : C.vo[1] - 0.2;
    A(subtitle, "o", [[b2 - 0.15, 1], [b2 + 0.2, 0, "io"]]);

    // --- Beat 2: the wordmark shrinks into the corner and stays there.
    const cs = L.corner.s;
    const cornerX = L.corner.left + (wmW * cs) / 2 - L.cx;
    const cornerY = L.corner.cy - (L.cy - 22);
    A(wm, "x", [[b2, 0], [b2 + 0.6, cornerX, "io"]]);
    A(wm, "y", [[b2, 0], [b2 + 0.6, cornerY, "io"]]);
    A(wm, "s", [[b2, 1], [b2 + 0.6, cs, "io"]]);
    const featureIn = C.featureIn != null ? C.featureIn : b2 + 0.4;
    const intakeIn = C.intakeIn != null ? C.intakeIn : b2 + 0.6;
    fadeIn(feature, featureIn, 0.45, 12);
    A(intake, "o", [[intakeIn, 0], [intakeIn + 0.6, 1, "o"]]);
    A(intake, "y", [[intakeIn, 46], [intakeIn + 0.65, 0, "o"]]);
    const b2out = C.chords[0] - 0.62;
    fadeOut(feature, b2out, 0.38, -30);
    fadeOut(intake, b2out, 0.38, -30);

    // --- Beat 3: each logo lands on a pair of accented chords.
    C.chords.forEach((c, i) => {
        const lg = logos[i];
        A(lg, "o", [[c - 0.26, 0], [c - 0.06, 1, "o"]]);
        A(lg, "y", [[c - 0.26, -70], [c, 5, "i"], [c + 0.14, 0, "o"]]);
        A(lg, "s", [[c - 0.26, 1.18], [c, 1, "i"]]);
        const b = bubbles[i];
        A(b, "o", [[c + 0.14, 0], [c + 0.48, 1, "o"]]);
        A(b, "y", [[c + 0.14, -12], [c + 0.5, 0, "o"]]);
    });
    const tq = C.queueIn != null ? C.queueIn : C.chords[3] + 1.0;
    T.queue = tq;
    A(queue, "o", [[tq - 0.05, 0], [tq + 0.4, 1, "o"]]);
    A(queue, "y", [[tq - 0.05, 50], [tq + 0.45, 0, "o"]]);
    CHANNELS.forEach((_, i) => {
        const d = i * 0.06;
        const rowCy = Q.top + qHead + i * Q.rowH + Q.rowH / 2;
        const iconCx = qx + 36 + iconSlot / 2;
        const lg = logos[i];
        A(lg, "x", [[tq + d, 0], [tq + d + 0.62, iconCx - L.logoXs[i], "io"]]);
        A(lg, "y", [[tq + d, 0], [tq + d + 0.62, rowCy - L.logoY, "io"]]);
        A(lg, "s", [[tq + d, 1], [tq + d + 0.62, iconSlot / L.logoSize, "io"]]);
        const b = bubbles[i];
        const bTop = L.bubble.mode === "under" ? L.bubble.top : L.bubble.top + i * L.bubble.gap;
        const bX = L.bubble.mode === "under" ? L.logoXs[i] : L.cx;
        A(b, "x", [[tq + d, 0], [tq + d + 0.55, qx + Q.w / 2 - bX, "io"]]);
        A(b, "y", [[tq + d, 0], [tq + d + 0.55, rowCy - 30 - bTop, "io"]]);
        A(b, "o", [[tq + d + 0.2, 1], [tq + d + 0.5, 0, "io"]]);
        A(b, "s", [[tq + d, 1], [tq + d + 0.55, 0.85, "io"]]);
        A(rowEls[i], "o", [[tq + d + 0.3, 0], [tq + d + 0.7, 1, "o"]]);
    });
    const b3end = C.vo[3] - 0.1;
    T.b4 = b3end;
    A(queue, "o", [[b3end - 0.4, 1], [b3end, 0, "io"]]);
    A(queue, "s", [[b3end - 0.4, 1], [b3end, 0.97, "io"]]);
    logos.forEach((lg) => A(lg, "o", [[b3end - 0.4, 1], [b3end, 0, "io"]]));

    // --- Beat 4: capture (Slack thread, then the request MikeGC recorded)
    const t4 = b3end - 0.1;
    const th1 = thread([M_JORDAN, { divider: "1 reply" }, M_ACK]);
    show(th1, t4, t4 + 4.35, "rise", "push");
    const [mJ, dv, mA] = th1.__els;
    fadeIn(mJ, t4 + 0.45, 0.4, 18);
    fadeIn(dv, t4 + 1.75, 0.3, 0);
    fadeIn(mA, t4 + 1.95, 0.4, 18);
    caption("Recorded from Slack", t4 + 0.5, C.vo[4] - 0.25);
    const s4t = t4 + 3.95;
    const s4 = card([img("s4_request")]);
    show(s4, s4t, C.vo[4] - 0.15, "push", "fade");
    const req = { title: { x: 410, y: 84, w: 210, h: 34 }, reviewer: { x: 1171, y: 216, w: 266, h: 60 }, requester: { x: 1171, y: 286, w: 266, h: 60 },
        target: { x: 1171, y: 356, w: 266, h: 60 }, documents: { x: 425, y: 336, w: 702, h: 30 }, created: { x: 1171, y: 484, w: 266, h: 56 } };
    // "MikeGC records the subject, the requester, the deadline and the documents."
    const v4 = C.vo[3];
    const g4 = C.g4 || { subject: v4 + 5.0, requester: v4 + 5.9, deadline: v4 + 7.0, documents: v4 + 7.8 };
    glow(s4.__cam, req.title, g4.subject, g4.requester + 0.5);
    glow(s4.__cam, req.requester, g4.requester, g4.deadline + 0.5);
    glow(s4.__cam, req.target, g4.deadline, g4.documents + 0.5);
    glow(s4.__cam, req.documents, g4.documents, g4.documents + 1.1);
    const punch4 = Math.max(g4.documents + 0.8, s4t + 3.2);
    camKeys(s4, [[s4t, [800, 500, "w"]], [punch4, [800, 500, "w"]], [punch4 + 0.6, [1304, 380, "p"]]]);
    glow(s4.__cam, req.reviewer, punch4 + 0.45, C.vo[4] - 0.2);
    glow(s4.__cam, req.created, punch4 + 0.75, C.vo[4] - 0.2);

    // --- Beat 5: triage and first pass
    const t5 = C.vo[4] - 0.2;
    T.b5 = t5;
    const rules = card([img("s5_rules")]);
    show(rules, t5, t5 + 2.9, "fade", "fade");
    const ruleRow = { x: 288, y: 166, w: 1284, h: 38 };
    camKeys(rules, [[t5, [800, 300, "w"]], [t5 + 0.9, [800, 300, "w"]], [t5 + 1.5, [760, 210, "p"]]]);
    glow(rules.__cam, ruleRow, t5 + 0.55);
    caption("Routed by your rules", t5 + 0.35, t5 + 2.95);
    const tq5 = t5 + 2.9;
    T.toast = tq5 + 0.55;
    const toast = h("div", { class: "toastlayer", style: { left: "556px", top: "20px", width: "488px", height: "94px", backgroundImage: "url(shots/s5_toast.png)", backgroundPosition: "-556px -20px" } });
    const queueShot = card([img("s5_queue_base"), toast]);
    show(queueShot, tq5, tq5 + 2.2, "fade", "fade");
    A(toast, "o", [[T.toast - 0.05, 0], [T.toast + 0.3, 1, "o"]]);
    A(toast, "y", [[T.toast - 0.05, -36], [T.toast + 0.4, 0, "o"]]);
    camKeys(queueShot, [[tq5, [800, 500, "w"]], [T.toast + 0.35, [800, 500, "w"]], [T.toast + 0.95, [800, 160, "p"]]]);
    cursor(queueShot.__cam, [[tq5, 1180, 420], [T.toast + 0.6, 1180, 420], [T.toast + 1.25, 1008, 92]], [[T.toast + 1.4, 1008, 92]]);
    const ta = tq5 + 2.2;
    const act = card([img("s5_activity")]);
    show(act, ta, ta + 2.55, "fade", "fade");
    camKeys(act, [[ta, [780, 640, "w"]], [ta + 0.3, [780, 640, "w"]], [ta + 0.9, [790, 760, "p"]]]);
    glow(act.__cam, { x: 462, y: 660, w: 664, h: 262 }, ta + 0.85);
    const t6 = C.vo[5] - 0.2;
    caption("First pass against your playbook", ta + 0.1, t6);
    caption("A first draft for a lawyer, not legal advice.", t5 + 0.35, t6, { foot: true, y: L.footY });
    const td = ta + 2.55;
    const doc = card([img("s5_doc")]);
    show(doc, td, t6, "fade", "fade");
    camKeys(doc, [[td, [940, 420, "w"]], [td + 0.25, [940, 420, "w"]], [td + 0.85, [938, 330, 1.5 * (L.zp / 1.3)]]]);
    glow(doc.__cam, { x: 850, y: 143, w: 46, h: 17 }, td + 0.9, null, 4);
    glow(doc.__cam, { x: 958, y: 372, w: 80, h: 18 }, td + 1.25, null, 4);
    glow(doc.__cam, { x: 731, y: 451, w: 414, h: 32 }, td + 1.6, null, 4);

    // --- Beat 6: requester loop
    T.b6 = t6;
    const typeFrames = h("div", {}, ...Array.from({ length: 10 }, (_, i) => img(`s6_type_${String(i).padStart(2, "0")}`, { "data-i": i })));
    const ask = card([typeFrames]);
    show(ask, t6, t6 + 2.6, "fade", "push");
    A(typeFrames, "frame", [[t6 + 0.25, 0], [t6 + 1.55, 9, "l"]]);
    camKeys(ask, [[t6, [776, 440, "p"]]]);
    cursor(ask.__cam, [[t6, 1250, 560], [t6 + 1.6, 1250, 560], [t6 + 2.05, 1058, 482]], [[t6 + 2.18, 1058, 482]]);
    caption("Ask the requester", t6 + 0.3, t6 + 4.75);
    const tt = t6 + 2.2;
    const th2 = thread([M_JORDAN, { divider: "3 replies" }, M_ACK, M_ASK, M_REPLY]);
    show(th2, tt, tt + 2.6, "push", "push");
    const [, , , mAsk, mRep] = th2.__els;
    fadeIn(mAsk, tt + 0.45, 0.4, 18);
    fadeIn(mRep, tt + 1.45, 0.4, 18);
    const tr = tt + 2.2;
    const qr = card([img("s6_queue_reply")]);
    show(qr, tr, tr + 1.75, "push", "fade");
    camKeys(qr, [[tr, [800, 400, "w"]], [tr + 0.55, [800, 400, "w"]], [tr + 1.1, [560, 190, "p"]]]);
    glow(qr.__cam, { x: 290, y: 167, w: 1280, h: 36 }, tr + 0.5);
    const trs = tr + 1.75;
    const rt = card([img("s6_resolve_typed")]);
    show(rt, trs, trs + 1.3, "fade", "fade");
    camKeys(rt, [[trs, [780, 860, "p"]]]);
    cursor(rt.__cam, [[trs, 1180, 700], [trs + 0.25, 1180, 700], [trs + 0.8, 984, 930]], [[trs + 0.95, 984, 930]]);
    caption("Answer in the thread", trs + 0.05, C.vo[6] - 0.2);
    const tdg = trs + 1.3;
    T.resolve = tdg + 0.9;
    const dlg = card([img("s6_resolve_dialog")]);
    show(dlg, tdg, tdg + 1.35, "fade", "push");
    camKeys(dlg, [[tdg, [800, 500, "p"]]]);
    cursor(dlg.__cam, [[tdg, 760, 760], [tdg + 0.2, 760, 760], [tdg + 0.75, 936, 684]], [[T.resolve, 936, 684]]);
    const tf = tdg + 1.15;
    const th3 = thread([M_JORDAN, { divider: "4 replies" }, M_ACK, M_ASK, M_REPLY, M_RESOLVE]);
    show(th3, tf, C.vo[6] - 0.15, "push", "fade");
    fadeIn(th3.__els[5], tf + 0.5, 0.45, 18);
    autoscroll(th3, 5, tf + 0.35);
    autoscroll(th2, 4, tt + 1.25);

    // --- Beat 7: oversight
    const t7 = C.vo[6] - 0.2;
    T.b7 = t7;
    const dash = card([img("s7_dashboard")]);
    show(dash, t7, C.endcard + 0.15, "fade", "fall");
    const v7 = C.vo[6];
    const d7 = C.d7 || { open: v7 + 0.45, overdue: v7 + 1.35, load: v7 + 2.4 };
    // Counts on "open" and "overdue", across the weekly chart, then the workload on "carrying the load".
    camKeys(dash, [
        [t7, [800, 500, "w"]], [d7.open - 0.55, [800, 500, "w"]],
        [d7.open + 0.05, [604, 160, "p"]], [d7.overdue + 0.45, [604, 160, "p"]],
        [d7.load + 0.15, [1256, 330, "p"]], [d7.load + 0.45, [1256, 330, "p"]],
        [d7.load + 1.25, L.dashEnd],
    ]);
    glow(dash.__cam, { x: 287, y: 77, w: 199, h: 102 }, d7.open, d7.overdue + 0.9);
    glow(dash.__cam, { x: 722, y: 77, w: 199, h: 102 }, d7.overdue, d7.overdue + 1.0);
    glow(dash.__cam, { x: 287, y: 489, w: 1286, h: 178 }, d7.load + 1.05);
    caption("See the whole queue", t7 + 0.35, C.endcard - 0.05);

    // --- Beat 8: end card
    const e = C.endcard;
    A(wm, "x", [[e, cornerX], [e + 0.65, 0, "io"]]);
    A(wm, "y", [[e, cornerY], [e + 0.65, L.end.wmY - (L.cy - 22), "io"]]);
    A(wm, "s", [[e, cs], [e + 0.65, 1, "io"]]);
    const eIntake = anchor(L.cx, L.end.intakeY, textEl("Intake", "serif", L.end.intakeSize));
    fadeIn(eIntake, e + 0.5, 0.5, 14);
    const tag = anchor(L.cx, L.end.tagY, textEl("Open source. Built for in-house legal.", "label", L.end.tagSize));
    fadeIn(tag, e + 1.0, 0.5, 12);
    const url = anchor(L.cx, L.end.urlY, textEl(C.url || "github.com/open-legal-products/mikegc", "", L.end.urlSize, { fontWeight: 400, opacity: 0.75 }));
    fadeIn(url, e + 1.3, 0.5, 10);
    const markPx = Math.round(L.end.sponsorSize * 1.25);
    const glMark = h("img", { src: "assets/general-legal-favicon.svg", style: { width: markPx + "px", height: markPx + "px", marginRight: Math.round(markPx * 0.5) + "px" } });
    const sp = h("div", { style: { display: "flex", alignItems: "center", fontSize: L.end.sponsorSize + "px", whiteSpace: "nowrap", letterSpacing: "0.02em" } },
        glMark, h("span", { style: { opacity: 0.7 } }, "Sponsored by "), h("span", { style: { fontWeight: 600 } }, "GENERAL LEGAL, LLP"));
    const spA = anchor(L.cx, L.end.sponsorY, sp);
    fadeIn(spA, e + 1.6, 0.5, 8);

    stage.append(white);
    window.__T = T;
}

// ---------------------------------------------------------------- boot
window.__ready = (async () => {
    await document.fonts.ready;
    await Promise.all([...document.images].map((i) => i.decode().catch(() => {})));
    buildTimeline();
    // Late-built images too.
    await Promise.all([...document.images].map((i) => i.decode().catch(() => {})));
    seek(0);
    return true;
})();
window.__seek = (t) => { seek(t); };
window.__C = C;
