import { randomUUID } from "node:crypto";
import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { readApiEnv } from "./users";
import { completeOnboardingIfRequired } from "./onboarding";
import { PDF_FIXTURE } from "./helpers";

// Real browser, gateway, auth and SQL. Faults drop committed responses and
// rate-limit a replay to prove history navigation cannot duplicate a write.
test("Legal records a business request, works it and resolves it exactly once", async ({
  browser,
  baseURL,
}) => {
  test.setTimeout(150000);
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

    // Intake is on by default and every member can record requests.
    await lawyerA.goto("/assistant");
    await lawyerA.getByRole("button", { name: "Intake", exact: true }).click();
    await expect(
      lawyerA.getByRole("button", { name: "New request" }),
    ).toBeEnabled();
    await lawyerA.getByRole("button", { name: "New request" }).focus();
    await lawyerA.keyboard.press("Enter");
    const requestType = lawyerA.getByRole("group", { name: "Request type" });
    await expect(requestType).toBeVisible();
    await requestType.getByRole("button", { name: "Contract review" }).click();
    await lawyerA
      .getByLabel("Subject", { exact: true })
      .fill("Synthetic supplier NDA");
    await lawyerA.getByLabel("Requester", { exact: true }).fill("Jane Business");
    await lawyerA
      .getByLabel("Email (optional)")
      .fill("jane.business@example.test");
    await lawyerA.getByLabel("Team (optional)").fill("Procurement");
    await lawyerA
      .getByLabel("What do they need?")
      .fill("Please check the supplier's confidentiality terms.");
    await lawyerA.getByLabel("Target date (optional)").fill("2026-11-10");
    await lawyerA.getByLabel("Timezone").fill("Europe/Stockholm");
    await lawyerA.locator('input[type="file"]').setInputFiles(PDF_FIXTURE);
    await expect(lawyerA.getByText("test.pdf", { exact: true })).toBeVisible();
    await lawyerA.goBack();
    await expect(lawyerA).toHaveURL(/\/assistant/);
    await lawyerA.goForward();
    await expect(lawyerA.getByLabel("Subject", { exact: true })).toHaveValue(
      "Synthetic supplier NDA",
    );
    await expect(lawyerA.getByLabel("Requester", { exact: true })).toHaveValue(
      "Jane Business",
    );
    await expect(
      requestType.getByRole("button", { name: "Contract review" }),
    ).toHaveAttribute("aria-pressed", "true");
    await expect(lawyerA.getByText("test.pdf", { exact: true })).toBeVisible();
    await expect(lawyerA.getByLabel("Timezone")).toHaveValue("Europe/Stockholm");
    await expect(lawyerA.getByLabel("Assign to me")).toBeChecked();
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
    await lawyerA.getByRole("button", { name: "Record request" }).click();
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
    await expect(async () => {
      await lawyerA.reload();
      await expect(
        documents.getByRole("button", { name: "test.pdf" }),
      ).toBeVisible({ timeout: 2000 });
    }).toPass({ timeout: 60000 });

    // A note draft survives Back/Forward and is saved without a version.
    await lawyerA.getByLabel("Add a note").fill("Called Jane; draft is coming.");
    await lawyerA.goBack();
    await lawyerA.goForward();
    await expect(lawyerA.getByLabel("Add a note")).toHaveValue(
      "Called Jane; draft is coming.",
    );
    await lawyerA.getByRole("button", { name: "Add note" }).click();
    await expect(
      lawyerA.getByText("Called Jane; draft is coming.", { exact: true }),
    ).toBeVisible();
    await expect(lawyerA.getByLabel("Add a note")).toHaveValue("");

    // A colleague finds it in the shared queue, takes it and waits on Jane.
    await lawyerB.goto("/intake");
    await lawyerB
      .getByRole("button", { name: "Filter by assigned lawyer" })
      .click();
    await lawyerB.getByRole("menuitem", { name: "Assigned to me" }).click();
    await expect(
      lawyerB.getByRole("link", { name: "Synthetic supplier NDA" }),
    ).toHaveCount(0);
    await lawyerB
      .getByRole("button", { name: "Filter by assigned lawyer" })
      .click();
    await lawyerB.getByRole("menuitem", { name: "Everyone" }).click();
    await lawyerB.getByRole("link", { name: "Synthetic supplier NDA" }).click();
    // Every member can open the attachment, not only its uploader.
    const opened = lawyerB.waitForResponse(
      (response) =>
        /\/api\/single-documents\/[0-9a-f-]+$/.test(response.url()) &&
        response.request().method() === "GET",
    );
    await lawyerB
      .getByRole("region", { name: "Documents" })
      .getByRole("button", { name: "test.pdf" })
      .click();
    expect((await opened).status()).toBe(200);
    await lawyerB.reload();
    await lawyerB.getByRole("button", { name: "Assign to me" }).click();
    await expect(
      lawyerB.getByText("Assigned to Intake Lawyer B", { exact: true }),
    ).toBeVisible();
    await lawyerB
      .getByRole("button", { name: "Mark waiting on requester" })
      .click();
    await expect(
      lawyerB
        .getByRole("definition")
        .getByText("Waiting on requester", { exact: true }),
    ).toBeVisible();
    await lawyerB.getByRole("button", { name: "Resume" }).click();
    await expect(
      lawyerB.getByRole("definition").getByText("In progress", { exact: true }),
    ).toBeVisible();

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
    await lawyerB.getByRole("button", { name: "Resolve", exact: true }).click();
    const dialog = lawyerB.getByRole("dialog");
    await dialog.getByLabel("Resolution").fill(resolution);
    await dialog.getByRole("button", { name: "Resolve", exact: true }).click();
    await expect(
      lawyerB.getByRole("definition").getByText("Resolved", { exact: true }),
    ).toBeVisible();
    expect(commands).toHaveLength(2);
    expect(commands[0]).toEqual(commands[1]);
    const outcome = lawyerB.getByRole("region", { name: "Resolution" });
    await expect(outcome.getByText(resolution, { exact: true })).toHaveCount(1);

    await lawyerA.goto(detailURL);
    await expect(lawyerA.getByRole("region", { name: "Resolution" })).toBeVisible();
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
        .getByRole("region", { name: "Resolution" })
        .getByText(resolution, { exact: true });
      await text.scrollIntoViewIfNeeded();
      expect(
        await text.evaluate((node) => node.scrollWidth <= node.clientWidth),
      ).toBe(true);
    }

    // Closed requests can be reopened, and cancelling records a reason.
    await lawyerA.getByRole("button", { name: "Reopen" }).click();
    await expect(
      lawyerA.getByRole("definition").getByText("In progress", { exact: true }),
    ).toBeVisible();
    await lawyerA.getByRole("button", { name: "Cancel request" }).click();
    await lawyerA
      .getByRole("dialog")
      .getByLabel("Why is this being cancelled?")
      .fill("Jane withdrew the request.");
    await lawyerA
      .getByRole("dialog")
      .getByRole("button", { name: "Cancel request" })
      .click();
    await expect(
      lawyerA
        .getByRole("region", { name: "Cancellation reason" })
        .getByText("Jane withdrew the request.", { exact: true }),
    ).toBeVisible();
    expect(errors).toEqual([]);
  } finally {
    await admin(`/rest/v1/organizations?id=eq.${org}`, "DELETE");
    for (const p of people) {
      await p.page.context().close();
      await admin(`/auth/v1/admin/users/${p.id}`, "DELETE");
    }
  }
});
