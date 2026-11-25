// Capture the film's product shots from the real MikeGC frontend with demo data.
// Writes PNGs (1600x1000 CSS px at 2x) and shots.json with regions of interest
// in CSS px, relative to the screenshot.
//   node capture.cjs [prefix...]     e.g. node capture.cjs c_ w_ q_
const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");
const mock = require("./mock.cjs");
const { setup, BASE } = require("./setup.cjs");

const OUT = path.join(__dirname, "shots");
fs.mkdirSync(OUT, { recursive: true });
const meta = {};
const only = process.argv.slice(2);
const want = (n) => !only.length || only.some((o) => n.startsWith(o));

async function box(locator) {
    const b = await locator.boundingBox({ timeout: 4000 });
    if (!b) return null;
    return { x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height) };
}
// The smallest box around several regions.
function union(...rs) {
    rs = rs.filter(Boolean);
    if (!rs.length) return null;
    const x = Math.min(...rs.map((r) => r.x)), y = Math.min(...rs.map((r) => r.y));
    const x2 = Math.max(...rs.map((r) => r.x + r.w)), y2 = Math.max(...rs.map((r) => r.y + r.h));
    return { x, y, w: x2 - x, h: y2 - y };
}
// The glass card (rounded panel) around the element with this text: the
// nearest ancestor at least minWidth wide with a background and rounded corners.
async function cardOf(page, text, minWidth) {
    return page.evaluate(({ text, minWidth }) => {
        const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
        let n;
        while ((n = walker.nextNode())) {
            if (!n.textContent.includes(text)) continue;
            let el = n.parentElement;
            while (el) {
                const cs = getComputedStyle(el);
                const b = el.getBoundingClientRect();
                if (b.width >= minWidth && parseFloat(cs.borderTopLeftRadius) >= 8 && cs.backgroundColor !== "rgba(0, 0, 0, 0)")
                    return { x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height) };
                el = el.parentElement;
            }
        }
        return null;
    }, { text, minWidth });
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
        try { r[k] = loc && typeof loc.then === "function" ? await loc : (loc && loc.boundingBox ? await box(loc) : loc); }
        catch (e) { r[k] = null; console.log("no box", name, k); }
    }
    meta[name] = r;
    console.log("shot", name, JSON.stringify(r));
}
async function go(page, url) {
    await page.goto(BASE + url, { waitUntil: "networkidle", timeout: 120000 });
    await page.waitForTimeout(1200);
}
// Where the viewer draws the tracked changes, for the film's highlights.
const revisionBoxes = (page) => page.evaluate(() => [...document.querySelectorAll(".docx-revision")]
    .map((el) => { const b = el.getBoundingClientRect(); return { x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height) }; })
    .filter((b) => b.w > 0 && b.y > 60 && b.y < 990));
const tile = (page, name) => page.locator(`section[aria-label="${name} connector"]`).first();

(async () => {
    const browser = await chromium.launch();
    const { page } = await setup(browser, { scale: 2 });

    // --- Connectors in Settings -------------------------------------------------------
    if (want("c_settings")) {
        await go(page, "/settings/connectors");
        await page.mouse.move(1590, 990);
        await shot(page, "c_settings", {
            installed: union(await box(tile(page, "Google Drive")), await box(tile(page, "Notion"))),
            savedFor: page.getByText("Saved for Alia", { exact: false }).first(),
            discover: union(await box(tile(page, "Airtable")), await box(tile(page, "Lawve"))),
            linearAdd: page.getByRole("button", { name: "Add Linear connector" }),
            gmail: tile(page, "Gmail"),
        });
        mock.steps.addLinear();
        await go(page, "/settings/connectors");
        await page.mouse.move(1590, 990);
        await shot(page, "c_settings_added", {
            linear: tile(page, "Linear"),
            gmail: tile(page, "Gmail"),
            installed: union(await box(tile(page, "Google Drive")), await box(tile(page, "Linear"))),
        });
    }
    if (want("c_gmail")) {
        mock.steps.addLinear();
        await go(page, "/settings/connectors");
        await page.getByRole("button", { name: "Manage Gmail" }).click();
        await page.waitForTimeout(900);
        // Scroll the tool list to its end, where the write tools are.
        await page.evaluate(() => {
            const list = [...document.querySelectorAll("[role=dialog] div")].find((el) => getComputedStyle(el).overflowY === "auto" && el.textContent.includes("Search email"));
            if (list) list.scrollTop = list.scrollHeight;
        });
        await page.mouse.move(1590, 990);
        await shot(page, "c_gmail", {
            dialog: cardOf(page, "Ask for permission for write actions", 600),
            account: rowBox(page, "priya@alia.ai", 600),
            readOnly: rowBox(page, "Disable all write tools", 600),
            approval: rowBox(page, "Mike asks you in the chat before", 600),
            send: rowBox(page, "Send email", 560),
            del: rowBox(page, "Delete draft", 560),
        });
    }

    // --- The Assistant with Drive, CourtListener and Gmail -------------------------------
    if (want("c_chat")) {
        await go(page, "/assistant/chat/" + mock.CONNECTOR_CHAT.id);
        await page.mouse.move(1590, 990);
        await shot(page, "c_chat_approval", {
            prompt: cardOf(page, "Find the Harbor & Pine MSA", 400),
            popup: cardOf(page, "Mike wants to run this action", 700),
            action: cardOf(page, "Harbor & Pine MSA: liability cap", 600),
            approve: page.getByRole("button", { name: "Approve", exact: true }),
        });
        await page.getByText("Completed in 4 steps").first().click();
        await page.waitForTimeout(900);
        await page.mouse.move(1590, 990);
        await shot(page, "c_chat_steps", {
            prompt: cardOf(page, "Find the Harbor & Pine MSA", 400),
            steps: union(await box(page.getByText("Google Drive: Search files").first()), await box(page.getByText(/citations/i).first())),
            stepsCard: cardOf(page, "Google Drive: Search files", 700),
            drive: page.getByText("Google Drive: Search files").first(),
            caselaw: page.getByText("Searched case law").first(),
        });
        mock.steps.approve();
        await go(page, "/assistant/chat/" + mock.CONNECTOR_CHAT.id);
        await page.mouse.wheel(0, 3000);
        await page.waitForTimeout(800);
        const groups = page.getByText(/^Completed in \d+ steps?$/);
        await groups.last().click();
        await page.waitForTimeout(900);
        await page.mouse.wheel(0, 3000);
        await page.waitForTimeout(800);
        await page.mouse.move(1590, 990);
        await shot(page, "c_chat_sent", {
            sent: page.getByText("Gmail: Send email").first(),
            sentCard: cardOf(page, "Gmail: Send email", 700),
            done: page.getByText("Sent to Tom from priya@alia.ai.").first(),
        });
    }

    // --- The workflows library -----------------------------------------------------------
    if (want("w_list")) {
        await go(page, "/workflows");
        await page.mouse.move(1590, 990);
        await shot(page, "w_list", {
            table: union(await rowBox(page, "Contract Intake", 1000), await rowBox(page, "Commercial Agreement Tabular Review", 1000)),
            gc: union(await rowBox(page, "Contract Intake", 1000), await rowBox(page, "Obligation Tracking", 1000)),
            tabs: union(await box(page.getByRole("button", { name: "All", exact: true }).first()), await box(page.getByRole("button", { name: "Add-ons", exact: true }).first())),
        });
    }
    if (want("w_detail")) {
        await go(page, "/workflows/assistant/wf-contract-markup");
        await page.mouse.move(1590, 990);
        await shot(page, "w_detail", {
            title: page.getByText("Contract Markup", { exact: true }).first(),
            levels: union(await box(page.getByText("**Light**", { exact: false }).first()), await box(page.getByText("**Full**", { exact: false }).first())),
            use: page.getByRole("button", { name: "Use", exact: true }).first(),
        });
    }

    // --- A quick action: Contract Markup on the MSA --------------------------------------
    if (want("q_")) {
        await go(page, "/assistant");
        await page.mouse.move(1590, 990);
        const pill = page.getByRole("button", { name: "Contract Markup", exact: true });
        await shot(page, "q_home", {
            quick: union(await box(page.getByText("Quick actions", { exact: true }).first()), await box(page.getByRole("button", { name: "Contract Intake", exact: true })), await box(page.getByRole("button", { name: "Obligation Tracking", exact: true }))),
            markup: pill,
        });
        await pill.click();
        await page.waitForTimeout(1200);
        await page.getByText("Harbor_Pine_MSA.docx", { exact: true }).first().click();
        await page.waitForTimeout(500);
        await page.mouse.move(1590, 990);
        await shot(page, "q_picker", {
            msa: rowBox(page, "Harbor_Pine_MSA.docx", 600),
            confirm: page.getByRole("button", { name: "Confirm", exact: true }),
            dialog: cardOf(page, "Add Documents", 600),
        });
        await page.getByRole("button", { name: "Confirm", exact: true }).click();
        await page.waitForTimeout(900);
        await page.mouse.move(1590, 990);
        await shot(page, "q_composer", {
            pills: union(await box(page.getByText("Contract Markup", { exact: true }).first()), await box(page.getByText("Harbor_Pine_MSA.docx", { exact: true }).first())),
            composer: cardOf(page, "Execute this workflow on the selected documents.", 700),
            send: page.getByRole("button", { name: /send/i }).last(),
        });

        await go(page, "/assistant/chat/" + mock.MARKUP_CHAT.id);
        await page.getByText("Completed in 3 steps").first().click();
        await page.waitForTimeout(900);
        await page.mouse.move(1590, 990);
        await shot(page, "q_chat", {
            steps: union(await box(page.getByText(/Contract Markup/).nth(2)), await box(page.getByText(/Harbor_Pine_MSA \(Alia markup\)\.docx/).first())),
            applied: page.getByText(/Applied|workflow/i).first(),
            table: page.locator("table").first(),
        });
        const changes = page.getByText("4 tracked changes").first();
        await changes.scrollIntoViewIfNeeded();
        await changes.click();
        await page.waitForTimeout(700);
        await page.mouse.wheel(0, 3000);
        await page.waitForTimeout(800);
        await page.mouse.move(1590, 990);
        // The second change's own View button opens the document at section 11,
        // where both liability changes are. (The first change's text, "twelve (12)
        // months", also appears earlier, in section 3.2.)
        const viewFirst = page.getByRole("button", { name: "View", exact: true }).nth(2);
        await shot(page, "q_changes", {
            changes,
            view: viewFirst,
            card: rowBox(page, "4 tracked changes", 700),
        });
        await viewFirst.click();
        await page.waitForTimeout(4500);
        await page.mouse.move(1590, 990);
        await shot(page, "q_doc", { revisions: await revisionBoxes(page) });
    }

    const file = path.join(OUT, "shots.json");
    const prev = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : {};
    fs.writeFileSync(file, JSON.stringify({ ...prev, ...meta }, null, 2));
    console.log("UNKNOWN", [...mock.unknown].join(" | "));
    await browser.close();
})();
