import { render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AssistantMessage } from "./AssistantMessage";
import type { AssistantEvent } from "../shared/types";

const { getIntakeRequest } = vi.hoisted(() => ({
    getIntakeRequest: vi.fn(),
}));
vi.mock("@/app/lib/mikeApi", async (importOriginal) => ({
    ...(await importOriginal<typeof import("@/app/lib/mikeApi")>()),
    getIntakeRequest,
    commandIntakeRequest: vi.fn(),
}));

const proposal = (
    cardId: string,
    action: "resolve" | "cancel",
): AssistantEvent => ({
    type: "intake_action",
    card_id: cardId,
    org_id: "org-1",
    request_id: "request-1",
    action,
    ...(action === "cancel" ? { note: "Duplicate" } : {}),
});

describe("AssistantMessage intake proposals", () => {
    beforeEach(() => {
        vi.stubGlobal(
            "ResizeObserver",
            class {
                observe() {}
                disconnect() {}
            },
        );
        getIntakeRequest.mockResolvedValue({
            id: "request-1",
            subject: "Review mutual NDA",
            state: "in_review",
            clarify_stage: null,
            version: 2,
            capabilities: {
                resolve: true,
                cancel: true,
                wait: true,
                resume: false,
                reopen: false,
            },
        });
    });

    it("shows proposal cards between the prose and offers only the chat's newest", async () => {
        render(
            <AssistantMessage
                events={[
                    { type: "content", text: "I can resolve it." },
                    proposal("card-a", "resolve"),
                    { type: "content", text: "Or cancel it as a duplicate." },
                    proposal("card-b", "cancel"),
                ]}
                latestIntakeCardId="card-b"
            />,
        );
        const older = screen.getByRole("region", { name: "Resolve request" });
        const newest = screen.getByRole("region", { name: "Cancel request" });
        expect(
            await within(older).findByText(
                "A later proposal replaces this one.",
            ),
        ).toBeInTheDocument();
        expect(within(older).queryByRole("button")).toBeNull();
        expect(
            await within(newest).findByRole("button", {
                name: "Cancel request",
            }),
        ).toBeEnabled();
        expect(
            screen
                .getByText("I can resolve it.")
                .compareDocumentPosition(older) &
                Node.DOCUMENT_POSITION_FOLLOWING,
        ).toBeTruthy();
    });
});
