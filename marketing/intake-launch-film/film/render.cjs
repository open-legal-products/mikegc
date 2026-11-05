// Render the film: stills for review, or video frames piped to ffmpeg.
//   node render.cjs stills <format> <t1,t2,...> [outDir]
//   node render.cjs video <format> <out.mp4> [--fps 30] [--workers 3] [--from s] [--to s]
const { chromium } = require("playwright");
const http = require("http");
const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");

const ROOT = __dirname;
const SIZES = { "16x9": [1920, 1080], "1x1": [1080, 1080], "9x16": [1080, 1920] };
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".svg": "image/svg+xml", ".png": "image/png", ".woff2": "font/woff2", ".json": "application/json" };

function serve() {
    return new Promise((resolve) => {
        const server = http.createServer((req, res) => {
            const p = path.join(ROOT, decodeURIComponent(new URL(req.url, "http://x").pathname));
            if (!p.startsWith(ROOT) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) { res.writeHead(404); return res.end(); }
            res.writeHead(200, { "Content-Type": TYPES[path.extname(p)] || "application/octet-stream" });
            fs.createReadStream(p).pipe(res);
        });
        server.listen(0, "127.0.0.1", () => resolve(server));
    });
}

function cues() {
    const f = path.join(ROOT, "cues.json");
    return fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, "utf8")) : {};
}

async function openPage(browser, port, format) {
    const [W, H] = SIZES[format];
    const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
    page.on("pageerror", (e) => console.error("PAGEERROR", e.message));
    page.on("console", (m) => { if (m.type() === "error") console.error("CONSOLE", m.text()); });
    await page.addInitScript((c) => { window.__CUES = c; }, cues());
    await page.goto(`http://127.0.0.1:${port}/index.html?f=${format}`, { waitUntil: "load" });
    await page.evaluate(() => window.__ready);
    return page;
}

function arg(name, def) {
    const i = process.argv.indexOf(name);
    return i > 0 ? process.argv[i + 1] : def;
}

(async () => {
    const [mode, format] = process.argv.slice(2, 4);
    const server = await serve();
    const port = server.address().port;
    const browser = await chromium.launch();
    try {
        if (mode === "timing") {
            const page = await openPage(browser, port, format || "16x9");
            const T = await page.evaluate(() => ({ ...window.__T, end: window.__C.end, endcard: window.__C.endcard }));
            fs.writeFileSync(path.join(ROOT, "timing.json"), JSON.stringify(T, null, 2));
            console.log(JSON.stringify(T));
        } else if (mode === "stills") {
            const times = process.argv[4].split(",").map(Number);
            const outDir = process.argv[5] || path.join(ROOT, "stills");
            fs.mkdirSync(outDir, { recursive: true });
            const page = await openPage(browser, port, format);
            for (const t of times) {
                await page.evaluate((t) => window.__seek(t), t);
                const f = path.join(outDir, `${format}_${t.toFixed(2)}.png`);
                await page.screenshot({ path: f });
                console.log(f);
            }
            console.log("T", JSON.stringify(await page.evaluate(() => window.__T)));
        } else if (mode === "video") {
            const out = path.resolve(process.argv[4]);
            const fps = +arg("--fps", 30);
            const workers = +arg("--workers", 3);
            const page0 = await openPage(browser, port, format);
            const end = +arg("--to", await page0.evaluate(() => window.__C.end));
            const from = +arg("--from", 0);
            await page0.close();
            const total = Math.round((end - from) * fps);
            const per = Math.ceil(total / workers);
            const tmp = out + ".parts";
            fs.mkdirSync(tmp, { recursive: true });
            const started = Date.now();
            const parts = await Promise.all(Array.from({ length: workers }, async (_, w) => {
                const a = w * per, b = Math.min(total, a + per);
                const file = path.join(tmp, `part${w}.mp4`);
                if (a >= b) return null;
                const page = await openPage(browser, port, format);
                const ff = spawn("ffmpeg", ["-y", "-loglevel", "error", "-f", "image2pipe", "-framerate", String(fps), "-c:v", "mjpeg", "-i", "-",
                    "-c:v", "libx264", "-preset", "medium", "-crf", "12", "-pix_fmt", "yuv444p", "-g", String(fps), file], { stdio: ["pipe", "inherit", "inherit"] });
                for (let i = a; i < b; i++) {
                    const t = from + i / fps;
                    await page.evaluate((t) => window.__seek(t), t);
                    const buf = await page.screenshot({ type: "jpeg", quality: 96 });
                    if (!ff.stdin.write(buf)) await new Promise((r) => ff.stdin.once("drain", r));
                    if (w === 0 && (i - a) % 60 === 0) console.log(`frame ${i - a}/${b - a} worker0, ${((Date.now() - started) / 1000).toFixed(0)}s`);
                }
                ff.stdin.end();
                await new Promise((r) => ff.on("close", r));
                await page.close();
                return file;
            }));
            const list = path.join(tmp, "list.txt");
            fs.writeFileSync(list, parts.filter(Boolean).map((p) => `file '${p}'`).join("\n"));
            await new Promise((r) => spawn("ffmpeg", ["-y", "-loglevel", "error", "-f", "concat", "-safe", "0", "-i", list, "-c", "copy", out], { stdio: "inherit" }).on("close", r));
            console.log("wrote", out, `${((Date.now() - started) / 1000).toFixed(0)}s`);
        }
    } finally {
        await browser.close();
        server.close();
    }
})();
