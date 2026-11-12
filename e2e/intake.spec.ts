import { randomUUID } from "node:crypto";
import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { readApiEnv } from "./users";
import { completeOnboardingIfRequired } from "./onboarding";
import { PDF_FIXTURE } from "./helpers";

// Real browser, gateway, auth and SQL. Faults drop committed responses and
// rate-limit a replay to prove history navigation cannot duplicate a write.
test("Legal creates a business request, works it and resolves it exactly once", async ({
  browser,
  baseURL,
}) => {
  test.setTimeout(process.env.REACT_STRESS === "1" ? 300000 : 150000);
  const supabase = readApiEnv("SUPABASE_URL")!;
  const key = readApiEnv("SUPABASE_SECRET_KEY")!;
  const headers = {
    apikey: key,
    Authorization: `Bearer ${key}`,
    "Content-Type": "application/json",
  };
  const org = randomUUID();
  const people: { id: string; email: string; password: string; page: Page }[] =
    [];
  const errors: string[] = [];
  async function admin(path: string, method: string, body?: unknown) {
    const response = await fetch(supabase + path, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (!response.ok)
      throw new Error(
        `Test fixture ${method} ${path}: ${response.status} ${await response.text()}`,
      );
    const text = await response.text();
    return text ? JSON.parse(text) : null;
  }
  let passed = false;
  try {
    for (const name of ["Lawyer A", "Lawyer B"]) {
      const email = `intake-browser-${randomUUID()}@test.local`;
      const password = `IntakeTest-${randomUUID()}!`;
      const user = await admin("/auth/v1/admin/users", "POST", {
        email,
        password,
        email_confirm: true,
        user_metadata: { full_name: `Intake ${name}` },
      });
      const context = await browser.newContext({ baseURL });
      const page = await context.newPage();
      page.setDefaultTimeout(15000);
      page.on("pageerror", (error) => errors.push(error.message));
      page.on("console", (message) => {
        if (
          /maximum update depth|too many re-renders|getSnapshot.*cached|ResizeObserver loop/i.test(
            message.text(),
          )
        )
          errors.push(message.text());
      });
      if (process.env.REACT_STRESS === "1") {
        const cdp = await context.newCDPSession(page);
        await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });
      }
      people.push({ id: user.id, email, password, page });
      await page.goto("/login");
      await page.locator("#email").fill(email);
      await page.locator("#password").fill(password);
      await page.getByRole("button", { name: "Log in", exact: true }).click();
      await completeOnboardingIfRequired(page);
    }
    await admin("/rest/v1/organizations", "POST", {
      id: org,
      name: "Intake browser team",
      created_by: people[0].id,
    });
    await admin(
      "/rest/v1/org_members",
      "POST",
      people.map((p, i) => ({
        org_id: org,
        user_id: p.id,
        role: i === 0 ? "owner" : "member",
      })),
    );
    for (const p of people)
      await p.page
        .context()
        .addInitScript(
          ({ id, org }) =>
            localStorage.setItem(`mike.activeWorkspace.${id}`, org),
          { id: p.id, org },
        );
    const [lawyerA, lawyerB] = people.map((p) => p.page);

    // Intake is on by default and every member can create requests.
    await lawyerA.goto("/assistant");
    await lawyerA.getByRole("button", { name: "Intake", exact: true }).click();
    await expect(
      lawyerA.getByRole("button", { name: "New request" }),
    ).toBeEnabled();
    await lawyerA.getByRole("button", { name: "New request" }).focus();
    await lawyerA.keyboard.press("Enter");
    await expect(lawyerA).toHaveURL(/\/intake\/new/);
    await lawyerA
      .getByLabel("Subject", { exact: true })
      .fill("Synthetic supplier NDA");
    await lawyerA.getByLabel("Requester", { exact: true }).fill("Jane Business");
    await lawyerA
      .getByLabel("Requester email", { exact: true })
      .fill("jane.business@example.test");
    await lawyerA
      .getByLabel("Request", { exact: true })
      .fill("Please check the supplier's confidentiality terms.");
    await lawyerA.getByLabel("Target date", { exact: true }).fill("2026-11-10");
    await lawyerA.getByLabel("Target date", { exact: true }).press("Enter");
    await lawyerA.locator('input[type="file"]').setInputFiles(PDF_FIXTURE);
    await expect(lawyerA.getByText("test.pdf", { exact: true })).toBeVisible();
    await lawyerA.goBack();
    await expect(lawyerA).toHaveURL(/\/intake\/requests(\?|$)/);
    await lawyerA.goForward();
    await expect(lawyerA.getByLabel("Subject", { exact: true })).toHaveValue(
      "Synthetic supplier NDA",
    );
    await expect(lawyerA.getByLabel("Requester", { exact: true })).toHaveValue(
      "Jane Business",
    );
    await expect(lawyerA.getByText("test.pdf", { exact: true })).toBeVisible();
    // New requests start assigned to their creator.
    await expect(
      lawyerA.getByRole("button", { name: "Reviewer: Intake Lawyer A" }),
    ).toBeVisible();
    const submissions: unknown[] = [];
    await lawyerA.route("**/api/intake/*/requests", async (route) => {
      if (route.request().method() !== "POST") return route.continue();
      submissions.push(route.request().postDataJSON());
      if (submissions.length === 2)
        return route.fulfill({
          status: 429,
          contentType: "application/json",
          body: JSON.stringify({ detail: "Try again later." }),
        });
      const response = await route.fetch();
      expect(response.ok()).toBe(true);
      if (submissions.length === 1) await route.abort("failed");
      else await route.fulfill({ response });
    });
    await lawyerA.getByRole("button", { name: "Create request" }).click();
    await expect(
      lawyerA.getByRole("button", { name: "Check again" }),
    ).toBeEnabled();
    await lawyerA.goBack();
    await lawyerA.goForward();
    await expect(lawyerA.getByLabel("Subject", { exact: true })).toBeDisabled();
    await lawyerA.getByRole("button", { name: "Check again" }).click();
    await expect(lawyerA).toHaveURL(/\/intake\/[0-9a-f-]+\?org=/);
    expect(submissions).toHaveLength(3);
    expect(submissions[1]).toEqual(submissions[0]);
    expect(submissions[2]).toEqual(submissions[0]);
    const stored = await admin(
      `/rest/v1/intake_requests?org_id=eq.${org}&select=id,assignee_id,requester_name`,
      "GET",
    );
    expect(stored).toEqual([
      expect.objectContaining({
        assignee_id: people[0].id,
        requester_name: "Jane Business",
      }),
    ]);
    const detailURL = lawyerA.url();
    // The contract uploads after the request is saved and is linked to it.
    const documents = lawyerA.getByRole("region", { name: "Documents" });
    // Each look reloads the page, so it must leave the page time to render:
    // on a throttled development build two seconds ended before the list was
    // drawn, and the next reload began, until the whole wait ran out.
    const render = process.env.REACT_STRESS === "1" ? 20000 : 2000;
    await expect(async () => {
      await lawyerA.reload();
      await expect(
        documents.getByRole("button", { name: "Open test.pdf" }),
      ).toBeVisible({ timeout: render });
    }).toPass({ timeout: process.env.REACT_STRESS === "1" ? 120000 : 60000 });

    // A note draft survives Back/Forward and is saved without a version.
    // A document added with it waits with the draft and is tagged on the note.
    // The comment box is always open on an outstanding request.
    await lawyerA.getByLabel("Add comment").fill("Called Jane; draft is coming.");
    await lawyerA
      .getByLabel("Add comment")
      .locator("xpath=..")
      .locator('input[type="file"]')
      .setInputFiles(PDF_FIXTURE);
    await lawyerA.goBack();
    await lawyerA.goForward();
    await expect(lawyerA.getByLabel("Add comment")).toHaveValue(
      "Called Jane; draft is coming.",
    );
    await expect(
      lawyerA.getByRole("list", { name: "Documents to add with the note" }),
    ).toContainText("test.pdf");
    await lawyerA.getByRole("button", { name: "Submit" }).click();
    await expect(
      lawyerA.getByText("Called Jane; draft is coming.", { exact: true }),
    ).toBeVisible();
    await expect(lawyerA.getByLabel("Add comment")).toHaveValue("");
    const activity = lawyerA.getByRole("region", { name: "Activity" });
    // The note's document uploads from this tab once the note is saved, and
    // a reload would cancel it, so wait until it has finished first.
    const noteDocuments = activity.getByRole("list", {
      name: "Documents added with the note",
    });
    // The saved file and its upload placeholder can show together for a moment.
    await expect(noteDocuments.getByTitle(/^test\.pdf/).first()).toBeVisible();
    await expect(noteDocuments.getByTitle("test.pdf · Uploading")).toHaveCount(
      0,
      { timeout: 60000 },
    );
    await expect(async () => {
      await lawyerA.reload();
      await expect(
        activity.getByRole("button", { name: "Open test.pdf" }),
      ).toBeVisible({ timeout: render });
    }).toPass({ timeout: process.env.REACT_STRESS === "1" ? 120000 : 60000 });
    await expect(
      documents.getByRole("button", { name: "Open test.pdf" }),
    ).toHaveCount(2);

    // A colleague finds it among the outstanding requests, takes it and waits on Jane.
    await lawyerB.goto("/intake");
    await expect(lawyerB).toHaveURL(/\/intake\/requests$/);
    await expect(
      lawyerB.getByRole("button", { name: "Outstanding", exact: true }),
    ).toHaveAttribute("aria-pressed", "true");
    await lawyerB.getByRole("link", { name: "Synthetic supplier NDA" }).click();
    // Every member can open the attachment, not only its uploader.
    const opened = lawyerB.waitForResponse(
      (response) =>
        /\/api\/single-documents\/[0-9a-f-]+$/.test(response.url()) &&
        response.request().method() === "GET",
    );
    await lawyerB
      .getByRole("region", { name: "Documents" })
      .getByRole("button", { name: "Open test.pdf" })
      .first()
      .click();
    expect((await opened).status()).toBe(200);
    await lawyerB.reload();
    // The details panel holds the facts, the assignee and the status.
    const summaryB = lawyerB.getByRole("complementary", { name: "Details" });
    await summaryB
      .getByRole("button", { name: "Reviewer: Intake Lawyer A" })
      .click();
    await lawyerB
      .getByRole("menuitemradio", { name: "Myself" })
      .click();
    await expect(
      lawyerB
        .getByRole("region", { name: "Activity" })
        .getByText(/assigned this to Intake Lawyer B/),
    ).toBeVisible();
    const status = (name: string) =>
      summaryB.getByRole("button", { name: `Status: ${name}` });
    await status("In progress").click();
    await lawyerB
      .getByRole("menuitemradio", { name: "Waiting on requester" })
      .click();
    await status("Waiting on requester").click();
    await lawyerB.getByRole("menuitemradio", { name: "In progress" }).click();
    await expect(status("In progress")).toBeVisible();

    // A lost resolve response is reconciled, not resent as a second change.
    const resolution =
      "Approved with edits.\nUse the agreed confidentiality period.\n" +
      "LongReference".repeat(30);
    let dropped = false;
    const commands: unknown[] = [];
    await lawyerB.route("**/api/intake/*/requests/*/resolve", async (route) => {
      commands.push(route.request().postDataJSON());
      const response = await route.fetch();
      if (!dropped) {
        expect(response.ok()).toBe(true);
        dropped = true;
        await route.abort("failed");
      } else await route.fulfill({ response });
    });
    await status("In progress").click();
    await lawyerB.getByRole("menuitemradio", { name: "Resolved" }).click();
    // Resolved opens the note form; the note becomes the resolution.
    await lawyerB.getByLabel("Add comment").fill(resolution);
    await lawyerB.getByRole("button", { name: "Resolve request" }).click();
    await expect(summaryB.getByText("Resolved", { exact: true })).toBeVisible();
    expect(commands).toHaveLength(2);
    expect(commands[0]).toEqual(commands[1]);
    // The resolution reads once, in the timeline.
    const activityB = lawyerB.getByRole("region", { name: "Activity" });
    await expect(activityB.getByText(resolution, { exact: true })).toHaveCount(1);

    await lawyerA.goto(detailURL);
    await expect(
      lawyerA
        .getByRole("region", { name: "Activity" })
        .getByText(resolution, { exact: true }),
    ).toBeVisible();
    await expect(
      lawyerA.getByRole("button", { name: "Reopen", exact: true }),
    ).toBeVisible();
    await lawyerA.setViewportSize({ width: 375, height: 812 });
    for (const dark of [false, true]) {
      // Exercise the same root class and color-scheme used by applyDarkMode.
      await lawyerA.evaluate((enabled) => {
        document.documentElement.classList.toggle("dark", enabled);
        document.documentElement.style.colorScheme = enabled ? "dark" : "light";
      }, dark);
      expect(
        await lawyerA.evaluate(
          () => document.documentElement.scrollWidth <= window.innerWidth,
        ),
      ).toBe(true);
      const scan = await new AxeBuilder({ page: lawyerA }).analyze();
      expect(scan.violations.filter((v) => v.impact === "critical")).toEqual(
        [],
      );
      await lawyerA.screenshot({
        path: test.info().outputPath(`intake-${dark ? "dark" : "light"}.png`),
        fullPage: true,
      });
      const text = lawyerA
        .getByRole("region", { name: "Activity" })
        .getByText(resolution, { exact: true });
      await text.scrollIntoViewIfNeeded();
      expect(
        await text.evaluate((node) => node.scrollWidth <= node.clientWidth),
      ).toBe(true);
    }

    // Closed requests can be reopened, and cancelling records a reason.
    const summaryA = lawyerA.getByRole("complementary", { name: "Details" });
    await summaryA.getByRole("button", { name: "Status: Resolved" }).click();
    await lawyerA.getByRole("menuitem", { name: "Reopen" }).click();
    await expect(summaryA.getByText("In progress", { exact: true })).toBeVisible();
    await summaryA.getByRole("button", { name: "Status: In progress" }).click();
    await lawyerA.getByRole("menuitemradio", { name: "Cancelled" }).click();
    await lawyerA
      .getByRole("dialog")
      .getByLabel("Why is this being cancelled?")
      .fill("Jane withdrew the request.");
    await lawyerA
      .getByRole("dialog")
      .getByRole("button", { name: "Cancel request" })
      .click();
    // The reason reads in the timeline, and the request can be reopened there.
    await expect(
      lawyerA
        .getByRole("region", { name: "Activity" })
        .getByText("Jane withdrew the request.", { exact: true }),
    ).toBeVisible();
    await expect(
      lawyerA.getByRole("button", { name: "Reopen", exact: true }),
    ).toBeVisible();

    // Any member can delete a request; it leaves the queue for everyone.
    await lawyerA.getByRole("button", { name: "More actions" }).click();
    await lawyerA.getByRole("menuitem", { name: "Delete request" }).click();
    await lawyerA
      .getByRole("dialog", { name: "Delete this request?" })
      .getByRole("button", { name: "Delete request" })
      .click();
    await expect(lawyerA).toHaveURL(/\/intake\/requests$/);
    // It was cancelled, so it would be listed under Cancelled were it kept.
    await lawyerA.getByRole("button", { name: "Cancelled", exact: true }).click();
    await expect(lawyerA).toHaveURL(/\/intake\/requests\?tab=cancelled$/);
    await expect(lawyerA.getByText("No requests found")).toBeVisible();
    await expect(
      lawyerA.getByRole("link", { name: "Synthetic supplier NDA" }),
    ).toHaveCount(0);
    expect(errors).toEqual([]);
    passed = true;
  } finally {
    // Attachments keep the organization referenced, so remove them first.
    // A cleanup failure must not hide the failure that ended the test.
    try {
      await admin(`/rest/v1/documents?org_id=eq.${org}`, "DELETE");
      await admin(`/rest/v1/organizations?id=eq.${org}`, "DELETE");
      for (const p of people) {
        await p.page.context().close();
        await admin(`/auth/v1/admin/users/${p.id}`, "DELETE");
      }
    } catch (error) {
      if (passed) throw error;
      console.error(error);
    }
  }
});
