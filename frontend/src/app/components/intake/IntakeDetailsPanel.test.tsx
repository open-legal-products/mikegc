import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { IntakeRequest } from "@mike/contracts";
import {
  IntakeDescription,
  IntakeDetailsPanel,
  TargetDateField,
} from "./IntakeDetailsPanel";

const DESCRIPTION = [
  "Will Chen asked for a memo.",
  "",
  "--- Original message ---",
  "From: Will Chen <will@mikeoss.com> in Slack",
  "Sent: 3 Nov 2026, 14:11 UTC",
  "",
  "Will Chen, 3 Nov 2026, 14:11 UTC:",
  "hi",
  "",
  "Will Chen, 3 Nov 2026, 14:14 UTC:",
  "produce a memo on non-compete enforceability in ny",
].join("\n");

describe("IntakeDescription with an original message", () => {
  it("shows only the summary; the message reads in Messages", () => {
    render(
      <IntakeDescription
        value={DESCRIPTION}
        editable
        locked={false}
        onSave={vi.fn()}
      />,
    );
    expect(screen.getByText("Will Chen asked for a memo.")).toBeInTheDocument();
    expect(screen.queryByText(/Original message/)).not.toBeInTheDocument();
    expect(screen.queryByText(/produce a memo/)).not.toBeInTheDocument();
  });

  it("edits only the summary and keeps the message as it was", async () => {
    const user = userEvent.setup();
    const onSave = vi.fn();
    render(
      <IntakeDescription
        value={DESCRIPTION}
        editable
        locked={false}
        onSave={onSave}
      />,
    );
    await user.click(screen.getByRole("button", { name: "Edit request" }));
    const box = screen.getByRole("textbox", { name: "Request" });
    expect(box).toHaveValue("Will Chen asked for a memo.");
    await user.clear(box);
    await user.type(box, "A memo on New York non-competes.");
    await user.click(screen.getByRole("button", { name: "Submit" }));
    expect(onSave).toHaveBeenCalledWith(
      DESCRIPTION.replace(
        "Will Chen asked for a memo.",
        "A memo on New York non-competes.",
      ),
    );
  });

  it("limits the summary to the room the message under it leaves", async () => {
    const user = userEvent.setup();
    const description = `${DESCRIPTION}\n${"x".repeat(15000)}`;
    const original = description.slice(description.indexOf("--- Original message ---"));
    render(
      <IntakeDescription
        value={description}
        editable
        locked={false}
        onSave={vi.fn()}
      />,
    );
    await user.click(screen.getByRole("button", { name: "Edit request" }));
    // The summary and the message, two newlines apart, fit 20,000 characters.
    expect(screen.getByRole("textbox", { name: "Request" })).toHaveAttribute(
      "maxLength",
      String(20000 - original.length - 2),
    );
  });

  it("shows a description without one as written", () => {
    render(
      <IntakeDescription
        value="Just the message."
        editable={false}
        locked={false}
        onSave={vi.fn()}
      />,
    );
    expect(screen.getByText("Just the message.")).toBeInTheDocument();
  });
});

describe("IntakeDetailsPanel while another change is saving", () => {
  it("holds the requester and target date, as it does the menus", async () => {
    const user = userEvent.setup();
    const request: IntakeRequest = {
      id: "request-a",
      org_id: "org-a",
      subject: "Review the NDA",
      description: "Please review.",
      requester_name: "Jane Business",
      requester_email: "jane@business.test",
      requester_team: null,
      requested_by_date: null,
      state: "in_review",
      version: 1,
      assignee_id: null,
      assignee_name: null,
      created_by: "account-a",
      created_by_name: "Lawyer A",
      source: "manual",
      created_at: "2026-10-26T10:00:00Z",
      updated_at: "2026-10-26T10:00:00Z",
      clarify_stage: null,
      clarify_rounds: 0,
      clarify_max_rounds: 2,
      last_reply_at: null,
      new_reply: false,
      conversation: null,
      capabilities: {
        delete: false,
        edit: true,
        assign: false,
        note: false,
        wait: false,
        resume: false,
        resolve: false,
        cancel: false,
        reopen: false,
        send_to_requester: false,
        stop_asking: false,
      },
    };
    render(
      <IntakeDetailsPanel
        request={request}
        members={[]}
        accountId="account-a"
        locked
        onSave={vi.fn()}
        onAssign={vi.fn()}
        onStatus={vi.fn()}
      />,
    );
    expect(screen.getByLabelText("Target date")).toBeDisabled();
    await user.click(
      screen.getByRole("button", { name: "Requester: Jane Business" }),
    );
    expect(await screen.findByLabelText("Name")).toBeDisabled();
    expect(screen.getByLabelText("Email")).toBeDisabled();
  });
});

describe("TargetDateField", () => {
  it("asks for the year rather than letting the browser guess one", async () => {
    const user = userEvent.setup();
    const onSave = vi.fn();
    render(<TargetDateField value={null} overdue={false} onSave={onSave} />);
    const field = screen.getByLabelText("Target date");
    await user.type(field, "1 Dec");
    await user.tab();
    expect(onSave).not.toHaveBeenCalled();
    expect(field).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByText(/Enter a date such as/)).toBeInTheDocument();
  });
});
