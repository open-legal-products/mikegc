import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AnchorHTMLAttributes } from "react";
import type { IntakeDashboard as Dashboard } from "@mike/contracts";
import {
  IntakeDashboard,
  IntakeDashboardPage,
  axisTop,
  formatHours,
  slicePath,
} from "./IntakeDashboard";

const mocks = vi.hoisted(() => ({
  dashboard: vi.fn(),
  push: vi.fn(),
  notifyError: vi.fn(),
}));
vi.mock("@/app/lib/mikeApi", () => ({ getIntakeDashboard: mocks.dashboard }));
vi.mock("@/app/lib/userFacingError", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/app/lib/userFacingError")>()),
  notifyError: mocks.notifyError,
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: mocks.push }) }));
vi.mock("next/link", () => ({
  default: (props: AnchorHTMLAttributes<HTMLAnchorElement>) => <a {...props} />,
}));
vi.mock("@/app/contexts/WorkspaceContext", () => ({
  PERSONAL_WORKSPACE: "personal",
  useWorkspace: () => ({ accountId: "account-a", workspaceId: "org-a" }),
}));

const week = (week_start: string, created = 0, resolved = 0) => ({
  week_start,
  created,
  resolved,
});
const dashboard = (overrides: Partial<Dashboard> = {}): Dashboard => ({
  open: 4,
  new: 1,
  in_progress: 2,
  waiting: 1,
  unassigned: 1,
  overdue: 2,
  created: 6,
  resolved: 3,
  created_days: 30,
  resolved_days: 30,
  median_days: 30,
  weeks_shown: 8,
  median_hours_to_resolve: 52,
  weeks: [
    week("2026-09-07"),
    week("2026-09-14"),
    week("2026-09-21", 1),
    week("2026-09-28"),
    week("2026-10-05", 2, 1),
    week("2026-10-12"),
    week("2026-10-19", 1, 1),
    week("2026-10-26", 3, 1),
  ],
  workload: [
    {
      assignee_id: "lawyer-a",
      name: "Lawyer A",
      photo: null,
      open: 2,
      waiting: 1,
      overdue: 1,
    },
    {
      assignee_id: "lawyer-b",
      name: "Lawyer B",
      photo: null,
      open: 1,
      waiting: 0,
      overdue: 0,
    },
  ],
  ...overrides,
});

beforeEach(() => {
  vi.clearAllMocks();
  // The page header measures its breadcrumbs against the viewport.
  vi.stubGlobal(
    "matchMedia",
    vi.fn().mockReturnValue({
      matches: true,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }),
  );
  mocks.dashboard.mockResolvedValue(dashboard());
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("IntakeDashboard", () => {
  it("names the period of the figure on screen until the next one arrives", async () => {
    const user = userEvent.setup();
    let arrive: (value: Dashboard) => void = () => {};
    render(<IntakeDashboard orgId="org-a" />);
    const menu = await screen.findByRole("button", {
      name: "Created period: Last 30 days",
    });
    mocks.dashboard.mockReturnValue(
      new Promise<Dashboard>((resolve) => {
        arrive = resolve;
      }),
    );
    await user.click(menu);
    await user.click(screen.getByRole("menuitemradio", { name: "Last 7 days" }));
    await waitFor(() => expect(mocks.dashboard).toHaveBeenCalledTimes(2));
    // The 30-day figure is still on screen, marked busy, under its own period.
    expect(screen.getByText("6")).toHaveAttribute("aria-busy", "true");
    expect(
      screen.getByRole("button", { name: "Created period: Last 30 days" }),
    ).toBeInTheDocument();
    arrive(dashboard({ created: 17, created_days: 7 }));
    expect(
      await screen.findByRole("button", { name: "Created period: Last 7 days" }),
    ).toBeInTheDocument();
    expect(screen.getByText("17")).not.toHaveAttribute("aria-busy");
  });

  it("keeps the dashboard and its period when a change of period fails", async () => {
    const user = userEvent.setup();
    render(<IntakeDashboard orgId="org-a" />);
    const menu = await screen.findByRole("button", {
      name: "Created period: Last 30 days",
    });
    const failure = new Error("offline");
    mocks.dashboard.mockRejectedValueOnce(failure);
    await user.click(menu);
    await user.click(screen.getByRole("menuitemradio", { name: "Last 7 days" }));
    await waitFor(() =>
      expect(mocks.notifyError).toHaveBeenCalledWith(failure, {
        action: "load the dashboard",
      }),
    );
    expect(screen.queryByText("Unable to load the dashboard")).toBeNull();
    expect(screen.getByText("6")).not.toHaveAttribute("aria-busy");
    expect(
      screen.getByRole("button", { name: "Created period: Last 30 days" }),
    ).toBeInTheDocument();
    // The periods on screen are not read again.
    expect(mocks.dashboard).toHaveBeenCalledTimes(2);
  });

  it("reads each period figure over the period chosen from its own menu", async () => {
    const user = userEvent.setup();
    render(<IntakeDashboard orgId="org-a" />);
    await user.click(
      await screen.findByRole("button", {
        name: "Created period: Last 30 days",
      }),
    );
    await user.click(
      screen.getByRole("menuitemradio", { name: "Last 12 months" }),
    );
    await waitFor(() =>
      expect(mocks.dashboard).toHaveBeenLastCalledWith(
        "org-a",
        expect.any(String),
        { weeks: 8, created_days: 365, resolved_days: 30, median_days: 30 },
      ),
    );
    // The figures stay on screen while the next ones load.
    expect(screen.getByText("Unassigned")).toBeInTheDocument();
    await user.click(
      screen.getByRole("button", { name: "Requests per week period: Last 8 weeks" }),
    );
    await user.click(screen.getByRole("menuitemradio", { name: "Last 26 weeks" }));
    await waitFor(() =>
      expect(mocks.dashboard).toHaveBeenLastCalledWith(
        "org-a",
        expect.any(String),
        { weeks: 26, created_days: 365, resolved_days: 30, median_days: 30 },
      ),
    );
    expect(
      screen.getByRole("button", { name: "Resolved period: Last 30 days" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", {
        name: "Median time to resolve period: Last 30 days",
      }),
    ).toBeInTheDocument();
  });

  it("shows where an organization's requests stand, in the viewer's timezone", async () => {
    render(<IntakeDashboard orgId="org-a" />);
    expect(await screen.findByText("Unassigned")).toBeInTheDocument();
    expect(mocks.dashboard).toHaveBeenCalledWith(
      "org-a",
      Intl.DateTimeFormat().resolvedOptions().timeZone,
      { weeks: 8, created_days: 30, resolved_days: 30, median_days: 30 },
    );
    expect(
      screen.getByText("Median time to resolve").nextSibling,
    ).toHaveTextContent("2.2 days");
    const pie = screen.getByRole("img", {
      name: "Open requests by status: 1 new, 2 in progress, 1 waiting on requester",
    });
    // A quarter, a half and a quarter, each named with its share.
    expect(
      Array.from(pie.querySelectorAll("title"), (title) => title.textContent),
    ).toEqual([
      "New: 1 (25%)",
      "In progress: 2 (50%)",
      "Waiting on requester: 1 (25%)",
    ]);
    const workload = screen.getByRole("region", { name: "Workload" });
    expect(
      within(workload)
        .getAllByRole("row")
        .slice(1)
        .map((row) => row.textContent),
    ).toEqual([
      "LALawyer A. Show their requests.211",
      "LBLawyer B. Show their requests.100",
    ]);
  });

  it("links open, unassigned and overdue to their requests; the rest are read-only", async () => {
    render(<IntakeDashboard orgId="org-a" />);
    await screen.findByText("Unassigned");
    expect(
      [/^Open/, /^Unassigned/, /^Overdue/].map((name) =>
        screen.getByRole("link", { name }).getAttribute("href"),
      ),
    ).toEqual([
      "/intake/requests",
      "/intake/requests?scope=unassigned",
      "/intake/requests?scope=overdue&sort=target",
    ]);
    expect(screen.getByRole("link", { name: /^Overdue/ })).toHaveAccessibleName(
      "Overdue2. Show these requests.",
    );
    for (const name of [/^Created/, /^Resolved/, /^Median time to resolve/])
      expect(screen.queryByRole("link", { name })).not.toBeInTheDocument();
    expect(screen.getByText("Median time to resolve").closest("a")).toBeNull();
  });

  it("opens a status's outstanding requests from its legend entry", async () => {
    mocks.dashboard.mockResolvedValue(dashboard({ open: 3, waiting: 0 }));
    render(<IntakeDashboard orgId="org-a" />);
    const status = await screen.findByRole("region", {
      name: "Open requests by status",
    });
    expect(
      within(status)
        .getAllByRole("link")
        .map((link) => link.getAttribute("href")),
    ).toEqual([
      "/intake/requests?status=submitted",
      "/intake/requests?status=in_review",
    ]);
    expect(
      within(status).getByRole("link", { name: /^New/ }),
    ).toHaveAccessibleName("New133%. Show these requests.");
    // A status with nothing open is read-only.
    expect(
      within(status).queryByRole("link", { name: /^Waiting on requester/ }),
    ).not.toBeInTheDocument();
  });

  it("opens each lawyer's outstanding requests from their workload row", async () => {
    render(<IntakeDashboard orgId="org-a" />);
    const workload = await screen.findByRole("region", { name: "Workload" });
    expect(
      within(workload)
        .getAllByRole("link")
        .map((link) => [link.textContent, link.getAttribute("href")]),
    ).toEqual([
      [
        "LALawyer A. Show their requests.",
        "/intake/requests?assignee=lawyer-a",
      ],
      [
        "LBLawyer B. Show their requests.",
        "/intake/requests?assignee=lawyer-b",
      ],
    ]);
  });

  it("gives each week's counts on focus, and in its accessible name", async () => {
    render(<IntakeDashboard orgId="org-a" />);
    const latest = await screen.findByRole("img", {
      name: /: 3 created, 1 resolved$/,
    });
    fireEvent.focus(latest);
    expect(latest).toHaveTextContent(/3\s*created/);
    fireEvent.blur(latest);
    expect(latest).not.toHaveTextContent("created");
  });

  it("leaves out who holds what in Personal, where it is always the owner", async () => {
    render(<IntakeDashboard orgId="personal" />);
    expect(await screen.findByText("Overdue")).toBeInTheDocument();
    expect(screen.queryByText("Unassigned")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("region", { name: "Workload" }),
    ).not.toBeInTheDocument();
  });

  it("says so when there is nothing to chart", async () => {
    mocks.dashboard.mockResolvedValue(
      dashboard({
        open: 0,
        new: 0,
        in_progress: 0,
        waiting: 0,
        median_hours_to_resolve: null,
        weeks: [week("2026-10-26")],
        workload: [],
      }),
    );
    render(<IntakeDashboard orgId="org-a" />);
    expect(await screen.findByText("No open requests.")).toBeInTheDocument();
    expect(
      screen.getByText("No requests were created or resolved in these weeks."),
    ).toBeInTheDocument();
    expect(
      screen.getByText("No open requests are assigned."),
    ).toBeInTheDocument();
    expect(screen.getByText("None yet")).toBeInTheDocument();
  });

  it("explains a failed load and tries again on request", async () => {
    mocks.dashboard
      .mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockResolvedValueOnce(dashboard());
    render(<IntakeDashboard orgId="org-a" />);
    const retry = await screen.findByRole("button", { name: "Try again" });
    expect(screen.getByRole("alert")).not.toHaveTextContent("Failed to fetch");
    fireEvent.click(retry);
    expect(await screen.findByText("Unassigned")).toBeInTheDocument();
    expect(mocks.dashboard).toHaveBeenCalledTimes(2);
  });
});

describe("IntakeDashboardPage", () => {
  it("is /intake/dashboard, switching back to the requests from its header", async () => {
    render(<IntakeDashboardPage />);
    expect(screen.getByRole("button", { name: "Dashboard" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(
      await screen.findByRole("link", { name: /^Overdue/ }),
    ).toHaveAttribute("href", "/intake/requests?scope=overdue&sort=target");
    fireEvent.click(screen.getByRole("button", { name: "Requests" }));
    expect(mocks.push).toHaveBeenLastCalledWith("/intake/requests");
  });

  it("leaves New request to the requests list", async () => {
    render(<IntakeDashboardPage />);
    await screen.findByRole("link", { name: /^Overdue/ });
    expect(
      screen.queryByRole("button", { name: "New request" }),
    ).not.toBeInTheDocument();
  });

  it("reads Intake › Dashboard, and Intake leads back to the requests", async () => {
    render(<IntakeDashboardPage />);
    expect(
      screen.getByRole("heading", { name: "Intake: Dashboard" }),
    ).toBeInTheDocument();
    mocks.push.mockClear();
    // The header also keeps a hidden copy of its crumbs for measuring.
    fireEvent.click(screen.getAllByRole("button", { name: "Intake" })[0]);
    expect(mocks.push).toHaveBeenCalledWith("/intake/requests");
    await screen.findByText("Unassigned");
  });
});

describe("dashboard formatting", () => {
  it("says hours under a day and days beyond", () => {
    expect(formatHours(null)).toBe("None yet");
    expect(formatHours(1)).toBe("1 hour");
    expect(formatHours(5.25)).toBe("5.3 hours");
    expect(formatHours(24)).toBe("1 day");
    expect(formatHours(60)).toBe("2.5 days");
  });

  it("draws pie slices clockwise from 12 o'clock", () => {
    expect(slicePath(0, 0.25)).toBe("M50 50L50 0A50 50 0 0 1 100 50Z");
    expect(slicePath(0.25, 1)).toBe("M50 50L100 50A50 50 0 1 1 50 0Z");
  });

  it("tops the axis at an even number that fits", () => {
    expect([1, 2, 3, 5, 9, 10, 11, 45, 120].map(axisTop)).toEqual([
      2, 2, 4, 6, 10, 10, 20, 60, 200,
    ]);
  });
});
