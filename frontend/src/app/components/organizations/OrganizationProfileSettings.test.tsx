import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MikeApiError, type OrgProfile } from "@/app/lib/mikeApi";
import { OrganizationProfileSettings } from "./OrganizationProfileSettings";

// The Profile section of an organization's settings. What this pins:
//
//   - every field loads into its own labelled control, with its description
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
  headquarters: null,
  jurisdictions: null,
  legal_entities: null,
  legal_team: null,
  additional_context: null,
  updated_at: null,
};

describe("OrganizationProfileSettings", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getOrgProfile.mockResolvedValue({
      ...EMPTY,
      about: "We make accounting software.",
      industry: "Software",
      updated_at: "2026-11-12T00:00:00Z",
    });
  });

  it("loads every field, labelled and described, with nothing to save yet", async () => {
    render(<OrganizationProfileSettings orgId="org-1" />);

    expect(await screen.findByLabelText("About")).toHaveValue(
      "We make accounting software.",
    );
    expect(mocks.getOrgProfile).toHaveBeenCalledWith("org-1");
    expect(screen.getByLabelText("Industry")).toHaveValue("Software");
    for (const label of [
      "Headquarters",
      "Jurisdictions",
      "Legal entities",
      "Legal team",
      "Other context",
    ])
      expect(screen.getByLabelText(label)).toHaveValue("");
    expect(screen.getByLabelText("Legal entities")).toHaveAccessibleDescription(
      "The companies in the group, so Mike can tell which party to a contract is yours.",
    );
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
    expect(
      screen.queryByRole("button", { name: "Discard changes" }),
    ).not.toBeInTheDocument();
  });

  it("saves only what changed, a cleared field as null, and shows what the server kept", async () => {
    const user = userEvent.setup();
    mocks.updateOrgProfile.mockResolvedValue({
      ...EMPTY,
      about: "We make accounting software.",
      headquarters: "London",
      updated_at: "2026-11-12T01:00:00Z",
    });
    render(<OrganizationProfileSettings orgId="org-1" />);

    await user.clear(await screen.findByLabelText("Industry"));
    await user.type(screen.getByLabelText("Headquarters"), "  London  ");
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(mocks.updateOrgProfile).toHaveBeenCalledWith("org-1", {
      industry: null,
      headquarters: "London",
    });
    expect(await screen.findByText("Saved")).toBeInTheDocument();
    expect(screen.getByLabelText("Headquarters")).toHaveValue("London");
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
  });

  it("puts the saved text back on discard", async () => {
    const user = userEvent.setup();
    render(<OrganizationProfileSettings orgId="org-1" />);

    await user.type(await screen.findByLabelText("Industry"), " and services");
    await user.click(screen.getByRole("button", { name: "Discard changes" }));

    expect(screen.getByLabelText("Industry")).toHaveValue("Software");
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
  });

  it("keeps the draft when a save fails, and saves it again from the notice", async () => {
    const user = userEvent.setup();
    const failure = new MikeApiError({ message: "Internal server error", status: 500 });
    mocks.updateOrgProfile
      .mockRejectedValueOnce(failure)
      .mockResolvedValueOnce({ ...EMPTY, about: "We make accounting software.", industry: "Fintech" });
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

    expect(await screen.findByLabelText("About")).toHaveValue("");
    expect(mocks.getOrgProfile).toHaveBeenCalledTimes(2);
  });
});
