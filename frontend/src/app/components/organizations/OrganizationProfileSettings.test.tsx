import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MikeApiError, type OrgProfile } from "@/app/lib/mikeApi";
import { OrganizationProfileSettings } from "./OrganizationProfileSettings";

// The Profile section of an organization's settings. What this pins:
//
//   - every field loads into its own labelled control; only Legal entities
//     and Other context carry a description, and no text box can be resized
//   - the headquarters country and the jurisdictions are picked from lists
//   - one Save sends only the fields that changed, cleared ones as null
//   - text over a field's limit is named inline and cannot be saved
//   - a failed save keeps the draft and offers a retry that saves again
//   - a failed load is a whole-screen error with "Try again"

const mocks = vi.hoisted(() => ({
  getOrgProfile: vi.fn(),
  updateOrgProfile: vi.fn(),
  notifyError: vi.fn(),
}));

vi.mock("@/app/lib/mikeApi", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/app/lib/mikeApi")>()),
  getOrgProfile: mocks.getOrgProfile,
  updateOrgProfile: mocks.updateOrgProfile,
}));
vi.mock("@/app/lib/userFacingError", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/app/lib/userFacingError")>()),
  notifyError: mocks.notifyError,
}));

const EMPTY: OrgProfile = {
  about: null,
  industry: null,
  headquarters_city: null,
  headquarters_country: null,
  jurisdictions: [],
  legal_entities: null,
  legal_team_scope: null,
  additional_context: null,
  updated_at: null,
};

const country = () => screen.getByRole("button", { name: "Headquarters country" });
const jurisdictions = () => screen.getByRole("button", { name: "Jurisdictions" });

describe("OrganizationProfileSettings", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getOrgProfile.mockResolvedValue({
      ...EMPTY,
      about: "We make accounting software.",
      industry: "Software",
      jurisdictions: ["England and Wales", "Delaware"],
      updated_at: "2026-11-12T00:00:00Z",
    });
  });

  it("loads every field into a labelled control, with nothing to save yet", async () => {
    render(<OrganizationProfileSettings orgId="org-1" />);

    const about = await screen.findByLabelText("What does your organization do?");
    expect(about).toHaveValue("We make accounting software.");
    expect(mocks.getOrgProfile).toHaveBeenCalledWith("org-1");
    expect(screen.getByLabelText("Industry")).toHaveValue("Software");
    expect(screen.getByLabelText("Headquarters city")).toHaveValue("");
    expect(country()).toHaveTextContent("Country");
    expect(jurisdictions()).toHaveAccessibleDescription("England and Wales, Delaware");
    for (const label of ["Legal entities", "Scope of legal team", "Other context"])
      expect(screen.getByLabelText(label)).toHaveValue("");
    expect(screen.getByRole("group", { name: "Headquarters" })).toBeInTheDocument();

    // Only two fields explain themselves; the rest speak for themselves.
    expect(screen.getByLabelText("Legal entities")).toHaveAccessibleDescription(
      "Lets Mike tell which party to a contract is yours.",
    );
    expect(screen.getByLabelText("Other context")).toHaveAccessibleDescription(
      "Standard positions, preferred governing law, risk appetite, or anything else that helps.",
    );
    expect(about).not.toHaveAccessibleDescription();
    expect(screen.getByLabelText("Industry")).not.toHaveAccessibleDescription();

    // No text box has a resize handle; each grows with its text.
    const boxes = ["Legal entities", "Scope of legal team", "Other context"].map(
      (label) => screen.getByLabelText(label),
    );
    for (const box of [about, ...boxes]) expect(box).toHaveClass("resize-none");
    expect(
      screen.getByText("Tell Mike about your organization. The assistant and the intake agent use these details."),
    ).toBeInTheDocument();

    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
    expect(
      screen.queryByRole("button", { name: "Discard changes" }),
    ).not.toBeInTheDocument();
  });

  it("picks the headquarters country and the jurisdictions from lists, and saves only what changed", async () => {
    const user = userEvent.setup();
    mocks.updateOrgProfile.mockResolvedValue({
      ...EMPTY,
      about: "We make accounting software.",
      headquarters_city: "London",
      headquarters_country: "United Kingdom",
      jurisdictions: ["European Union", "England and Wales"],
      updated_at: "2026-11-12T01:00:00Z",
    });
    render(<OrganizationProfileSettings orgId="org-1" />);

    await user.clear(await screen.findByLabelText("Industry"));
    await user.type(screen.getByLabelText("Headquarters city"), "  London  ");
    await user.click(country());
    await user.click(screen.getByRole("menuitemradio", { name: "United Kingdom" }));
    expect(country()).toHaveTextContent("United Kingdom");

    await user.click(jurisdictions());
    expect(
      screen.getByRole("menuitemcheckbox", { name: "Delaware" }),
    ).toHaveAttribute("aria-checked", "true");
    await user.click(screen.getByRole("menuitemcheckbox", { name: "Delaware" }));
    // The menu stays open; a pick joins the list in the menu's order.
    await user.click(screen.getByRole("menuitemcheckbox", { name: "European Union" }));
    await user.keyboard("{Escape}");
    expect(jurisdictions()).toHaveAccessibleDescription(
      "European Union, England and Wales",
    );

    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(mocks.updateOrgProfile).toHaveBeenCalledWith("org-1", {
      industry: null,
      headquarters_city: "London",
      headquarters_country: "United Kingdom",
      jurisdictions: ["European Union", "England and Wales"],
    });
    expect(await screen.findByText("Saved")).toBeInTheDocument();
    expect(screen.getByLabelText("Headquarters city")).toHaveValue("London");
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
  });

  it("clears every jurisdiction at once, and a country back to none", async () => {
    const user = userEvent.setup();
    mocks.getOrgProfile.mockResolvedValue({
      ...EMPTY,
      headquarters_country: "Singapore",
      jurisdictions: ["Singapore", "Hong Kong SAR"],
    });
    mocks.updateOrgProfile.mockResolvedValue(EMPTY);
    render(<OrganizationProfileSettings orgId="org-1" />);

    await user.click(await screen.findByRole("button", { name: "Jurisdictions" }));
    // A jurisdiction saved some other way is still listed, to untick.
    expect(
      screen.getByRole("menuitemcheckbox", { name: "Hong Kong SAR" }),
    ).toHaveAttribute("aria-checked", "true");
    await user.click(screen.getByRole("menuitem", { name: "Clear all" }));
    expect(jurisdictions()).toHaveTextContent("Select jurisdictions");

    await user.click(country());
    await user.click(screen.getByRole("menuitemradio", { name: "Not set" }));
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(mocks.updateOrgProfile).toHaveBeenCalledWith("org-1", {
      headquarters_country: null,
      jurisdictions: [],
    });
  });

  it("puts the saved profile back on discard", async () => {
    const user = userEvent.setup();
    render(<OrganizationProfileSettings orgId="org-1" />);

    await user.type(await screen.findByLabelText("Industry"), " and services");
    await user.click(jurisdictions());
    await user.click(screen.getByRole("menuitem", { name: "Clear all" }));
    await user.click(screen.getByRole("button", { name: "Discard changes" }));

    expect(screen.getByLabelText("Industry")).toHaveValue("Software");
    expect(jurisdictions()).toHaveAccessibleDescription("England and Wales, Delaware");
    expect(mocks.updateOrgProfile).not.toHaveBeenCalled();
  });

  it("names text over a field's limit and will not save it", async () => {
    const user = userEvent.setup();
    render(<OrganizationProfileSettings orgId="org-1" />);

    const industry = await screen.findByLabelText("Industry");
    await user.clear(industry);
    await user.click(industry);
    await user.paste("x".repeat(201));

    expect(screen.getByRole("alert")).toHaveTextContent(
      "Industry must be 200 characters or fewer.",
    );
    expect(industry).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByText("201 / 200")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();

    await user.clear(industry);
    await user.click(screen.getByLabelText("Headquarters city"));
    await user.paste("x".repeat(101));
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Headquarters city must be 100 characters or fewer.",
    );
    await user.clear(screen.getByLabelText("Headquarters city"));
    await user.click(screen.getByLabelText("What does your organization do?"));
    await user.paste("x".repeat(2001));
    expect(screen.getByRole("alert")).toHaveTextContent(
      "This answer must be 2,000 characters or fewer.",
    );
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
  });

  it("keeps the draft when a save fails, and saves it again from the notice", async () => {
    const user = userEvent.setup();
    const failure = new MikeApiError({ message: "Internal server error", status: 500 });
    mocks.updateOrgProfile
      .mockRejectedValueOnce(failure)
      .mockResolvedValueOnce({
        ...EMPTY,
        about: "We make accounting software.",
        industry: "Fintech",
        jurisdictions: ["England and Wales", "Delaware"],
      });
    render(<OrganizationProfileSettings orgId="org-1" />);

    const industry = await screen.findByLabelText("Industry");
    await user.clear(industry);
    await user.type(industry, "Fintech");
    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(mocks.notifyError).toHaveBeenCalledTimes(1));
    const [error, options] = mocks.notifyError.mock.calls[0]!;
    expect(error).toBe(failure);
    expect(options).toMatchObject({ action: "save the organization profile" });
    expect(industry).toHaveValue("Fintech");

    options.onRetry();
    await waitFor(() => expect(mocks.updateOrgProfile).toHaveBeenCalledTimes(2));
    expect(mocks.updateOrgProfile).toHaveBeenLastCalledWith("org-1", {
      industry: "Fintech",
    });
    expect(await screen.findByText("Saved")).toBeInTheDocument();
  });

  it("offers to try again when the profile cannot be loaded", async () => {
    const user = userEvent.setup();
    mocks.getOrgProfile
      .mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockResolvedValueOnce(EMPTY);
    render(<OrganizationProfileSettings orgId="org-1" />);

    await user.click(await screen.findByRole("button", { name: "Try again" }));

    expect(
      await screen.findByLabelText("What does your organization do?"),
    ).toHaveValue("");
    expect(mocks.getOrgProfile).toHaveBeenCalledTimes(2);
  });
});
