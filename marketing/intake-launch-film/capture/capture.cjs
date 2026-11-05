// Capture the film's product shots from the real MikeGC frontend with demo data.
// Writes PNGs (1600x1000 CSS px at 2x) and shots.json with regions of interest
// in CSS px, relative to the screenshot.
const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");
const mock = require("./mock.cjs");
const { setup, BASE } = require("./setup.cjs");

const OUT = path.join(__dirname, "shots");
fs.mkdirSync(OUT, { recursive: true });
const meta = {};
const only = process.argv.slice(2);

async function box(locator) {
    const b = await locator.boundingBox({ timeout: 4000 });
    if (!b) return null;
    return { x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height) };
}
// The nearest ancestor of the element with this text that is at least minWidth wide.
async function rowBox(page, text, minWidth = 1000) {
    return page.evaluate(({ text, minWidth }) => {
        const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
        let n;
        while ((n = walker.nextNode())) {
            if (!n.textContent.includes(text)) continue;
            let el = n.parentElement;
            while (el && el.getBoundingClientRect().width < minWidth) el = el.parentElement;
            if (!el) return null;
            const b = el.getBoundingClientRect();
            return { x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height) };
        }
        return null;
    }, { text, minWidth });
}
async function shot(page, name, regions = {}) {
    await page.waitForTimeout(600);
    await page.screenshot({ path: path.join(OUT, name + ".png") });
    const r = {};
    for (const [k, loc] of Object.entries(regions)) {
        try { r[k] = typeof loc.then === "function" ? await loc : (loc && loc.boundingBox ? await box(loc) : loc); }
        catch (e) { r[k] = null; console.log("no box", name, k); }
    }
    meta[name] = r;
    console.log("shot", name, JSON.stringify(r));
}
async function go(page, url) {
    await page.goto(BASE + url, { waitUntil: "networkidle", timeout: 120000 });
    await page.waitForTimeout(1200);
}
const REQ = `/intake/${mock.ACME_ID}?org=${mock.ORG}`;
const want = (n) => !only.length || only.some((o) => n.startsWith(o));

(async () => {
    const browser = await chromium.launch();
    const { page } = await setup(browser, { scale: 2 });

    // --- Beat 4: the request MikeGC recorded -----------------------------------
    if (want("s4")) {
        await go(page, REQ);
        const sidebar = page.locator("aside, [data-slot=details], section").filter({ hasText: "Created by" }).last();
        await shot(page, "s4_request", {
            sidebar: sidebar,
            reviewer: page.getByText("Reviewer", { exact: true }).first(),
            created: page.getByText("Created by", { exact: true }).first(),
            title: page.getByRole("heading", { name: "Review Acme's NDA" }).last(),
        });
    }

    // --- Beat 5: first pass -----------------------------------------------------
    if (want("s5_activity")) {
        await go(page, REQ);
        const note = page.getByText("I reviewed Acme_NDA.docx", { exact: false }).first();
        await page.getByText("Activity", { exact: true }).first().scrollIntoViewIfNeeded();
        await page.mouse.wheel(0, 260);
        await page.waitForTimeout(500);
        await shot(page, "s5_activity", {
            note,
            preprocessed: page.getByText("preprocessed this request").first(),
            activity: page.getByText("Activity", { exact: true }).first(),
        });
    }
    if (want("s5_doc")) {
        await go(page, REQ);
        await page.getByText("Acme_NDA.docx").first().click();
        await page.waitForTimeout(3500);
        const ins = page.getByText("three (3)").first();
        await shot(page, "s5_doc", {
            page: page.locator("text=NON-DISCLOSURE AGREEMENT").first(),
            term: ins,
            mutual: page.getByText("MUTUAL", { exact: true }).first(),
            residuals: page.getByText("Residuals.").first(),
            versions: page.getByText("Versions", { exact: true }).first(),
        });
        try {
            await ins.hover();
            await page.waitForTimeout(900);
            await shot(page, "s5_doc_hover", { term: ins });
        } catch (e) { console.log("hover failed", e.message); }
        await page.keyboard.press("Escape");
    }
    if (want("s5_rules")) {
        await go(page, "/settings/intake/rules");
        await shot(page, "s5_rules", {
            row: rowBox(page, "The request is about an NDA"),
            condition: page.getByText("The request is about an NDA").first(),
            playbook: page.getByText("NDA playbook").first(),
        });
    }
    if (want("s5_toast")) {
        await go(page, "/intake/requests");
        await shot(page, "s5_queue_base", {});
        mock.queueNewRequestToast();
        await page.clock.runFor(31000);
        await page.waitForTimeout(1500);
        const toast = page.getByText("New Intake Request").first();
        const card = page.locator("[data-sonner-toast], li[role=status], [role=status], [role=alert]").filter({ hasText: "New Intake Request" }).first();
        await shot(page, "s5_toast", { title: toast, card });
    }

    // --- Beat 6: requester loop ----------------------------------------------------
    if (want("s6_ask")) {
        await go(page, REQ);
        await page.getByRole("button", { name: /^Messages/ }).first().click();
        await page.waitForTimeout(500);
        const composer = page.getByPlaceholder("What do you need from the requester?");
        await composer.scrollIntoViewIfNeeded();
        await page.mouse.wheel(0, 200);
        await composer.fill("Is this mutual? Their draft only protects Acme.");
        const ask = page.getByRole("button", { name: "Ask requester" });
        await ask.hover();
        await shot(page, "s6_ask_typed", {
            composer, ask,
            panel: page.getByRole("button", { name: /^Messages/ }).first(),
        });
    }
    if (want("s6_type")) {
        await go(page, REQ);
        await page.getByRole("button", { name: /^Messages/ }).first().click();
        await page.waitForTimeout(500);
        const composer = page.getByPlaceholder("What do you need from the requester?");
        await composer.scrollIntoViewIfNeeded();
        await page.mouse.wheel(0, 200);
        await page.mouse.move(1300, 760);
        const text = "Is this mutual? Their draft only protects Acme.";
        const counts = [0, 4, 9, 15, 20, 26, 31, 37, 42, text.length];
        for (let i = 0; i < counts.length; i++) {
            await composer.fill(text.slice(0, counts[i]));
            await composer.focus();
            await page.waitForTimeout(250);
            await page.screenshot({ path: path.join(OUT, `s6_type_${String(i).padStart(2, "0")}.png`) });
        }
        meta.s6_type = { count: counts.length, composer: await box(composer), ask: await box(page.getByRole("button", { name: "Ask requester" })) };
        console.log("typed", JSON.stringify(meta.s6_type));
    }
    if (want("s6_asked")) {
        mock.steps.asked();
        await go(page, REQ);
        await page.getByRole("button", { name: /^Messages/ }).first().click();
        await page.waitForTimeout(500);
        const q = page.getByText("Is this mutual? Their draft only protects Acme.").first();
        await q.scrollIntoViewIfNeeded();
        await page.mouse.wheel(0, 120);
        await shot(page, "s6_asked", { question: q, panel: page.getByRole("button", { name: /^Messages/ }).first(), status: page.getByText("Waiting on requester").first() });
    }
    if (want("s6_reply")) {
        mock.steps.replied();
        await go(page, "/intake/requests");
        await shot(page, "s6_queue_reply", { row: rowBox(page, "Review Acme's NDA"), newReply: page.getByText("New reply").first() });
        await go(page, REQ);
        await page.getByRole("button", { name: /^Messages/ }).first().click();
        await page.waitForTimeout(500);
        const r = page.getByText("Mutual. We're sharing roadmaps.").first();
        await r.scrollIntoViewIfNeeded();
        await page.mouse.wheel(0, 120);
        await shot(page, "s6_replied", { reply: r, question: page.getByText("Is this mutual? Their draft only protects Acme.").first() });
    }
    if (want("s6_resolve")) {
        mock.steps.replied();
        await go(page, REQ);
        const box1 = page.getByPlaceholder("What happened, what the requester said, what was sent");
        await box1.scrollIntoViewIfNeeded();
        await page.mouse.wheel(0, 300);
        await box1.fill("Approved as a mutual NDA. Obligations now run both ways, the term is 3 years and the residuals clause is gone.");
        const resolveBtn = page.getByRole("button", { name: "Resolve request" }).first();
        await resolveBtn.hover();
        await shot(page, "s6_resolve_typed", { box: box1, resolve: resolveBtn });
        await resolveBtn.click();
        await page.waitForTimeout(900);
        const dialog = page.getByRole("dialog").first();
        const toggle = dialog.getByRole("switch").first();
        if ((await toggle.getAttribute("aria-checked")) !== "true") await toggle.click();
        await page.waitForTimeout(400);
        const msg = dialog.locator("textarea").first();
        await msg.fill("Approved as a mutual NDA. Send Acme the attached redline.");
        const cb = dialog.locator("input[type=checkbox]").first();
        if (!(await cb.isChecked())) await cb.check();
        const primary = dialog.getByRole("button", { name: /Resolve and reply|Resolve request/ }).first();
        await primary.hover();
        await shot(page, "s6_resolve_dialog", { dialog, primary, toggle, message: msg, doc: cb });
        await page.keyboard.press("Escape");
    }
    if (want("s6_resolved")) {
        mock.steps.resolved();
        await go(page, REQ);
        const res = page.getByText("resolved this").first();
        await res.scrollIntoViewIfNeeded();
        await page.mouse.wheel(0, 200);
        await shot(page, "s6_resolved", { resolved: res, status: page.getByText("Resolved", { exact: true }).first() });
    }

    // --- Beat 7: dashboard -------------------------------------------------------------
    if (want("s7")) {
        await go(page, "/intake/dashboard");
        await page.mouse.move(5, 500);
        await shot(page, "s7_dashboard", {
            open: page.getByText("Open", { exact: true }).first(),
            unassigned: page.getByText("Unassigned", { exact: true }).first(),
            overdue: page.getByText("Overdue", { exact: true }).first(),
            chart: page.getByText("Requests per week").first(),
            workload: page.getByText("Workload", { exact: true }).first(),
        });
    }

    const file = path.join(OUT, "shots.json");
    const prev = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : {};
    fs.writeFileSync(file, JSON.stringify({ ...prev, ...meta }, null, 2));
    console.log("UNKNOWN", [...mock.unknown].join(" | "));
    await browser.close();
})();
