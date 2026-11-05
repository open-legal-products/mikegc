// A browser signed in to the demo workspace: every /api call is answered from
// mock.cjs, the clock is fixed at Mon 9 Nov 2026 10:16 London, and the Next.js
// dev indicator is hidden. Run directly to screenshot pages while adding mocks:
//   node setup.cjs /intake/requests /intake/dashboard
const { chromium } = require("playwright");
const path = require("path");
const mock = require("./mock.cjs");

const BASE = process.env.MIKEGC_URL || "http://localhost:3100";
const OUT = path.join(__dirname, "out");

async function setup(browser, { scale = 1 } = {}) {
    const context = await browser.newContext({
        viewport: { width: 1600, height: 1000 },
        deviceScaleFactor: scale,
        locale: "en-GB",
        timezoneId: "Europe/London",
        colorScheme: "light",
    });
    await context.addInitScript(({ org }) => {
        try { localStorage.setItem("mike.activeWorkspace.u-priya", org); } catch {}
    }, { org: mock.ORG });
    await context.addInitScript(() => {
        const style = () => { const s = document.createElement("style"); s.textContent = "nextjs-portal{display:none!important}"; document.documentElement.appendChild(s); };
        if (document.documentElement) style(); else document.addEventListener("DOMContentLoaded", style);
    });
    const page = await context.newPage();
    await page.clock.install({ time: new Date("2026-11-09T10:16:00Z") });
    page.on("pageerror", (e) => console.log("PAGEERROR", e.message.slice(0, 200)));
    page.on("console", (m) => { if (m.type() === "error") console.log("CONSOLE", m.text().slice(0, 200)); });
    await page.route("**/api/**", async (route) => {
        const req = route.request();
        const url = new URL(req.url());
        let body = null;
        try { body = req.postDataJSON(); } catch {}
        const res = mock.handle(req.method(), url.pathname, url.searchParams, body);
        if (!res) return route.fulfill({ status: 200, contentType: "application/json", body: "[]" });
        if (res[2]) return route.fulfill({ status: res[0], contentType: res[2], body: res[1] });
        return route.fulfill({ status: res[0], contentType: "application/json", body: JSON.stringify(res[1]) });
    });
    return { context, page };
}

module.exports = { setup, BASE, OUT };

if (require.main === module) {
    (async () => {
        const browser = await chromium.launch();
        const { page } = await setup(browser);
        const targets = process.argv.slice(2);
        for (const t of targets) {
            await page.goto(BASE + t, { waitUntil: "networkidle", timeout: 120000 });
            await page.waitForTimeout(2500);
            const file = path.join(OUT, "probe-" + t.replace(/[^a-z0-9]+/gi, "_") + ".png");
            await page.screenshot({ path: file });
            console.log("shot", file);
        }
        console.log("UNKNOWN", [...mock.unknown].join("\n"));
        await browser.close();
    })();
}
