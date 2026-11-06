import { createRef } from "react";
import {
    act,
    render,
    screen,
    waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ChatInput, type ChatInputHandle } from "./ChatInput";

vi.mock("@/app/lib/mikeApi", () => ({
    listWorkflows: vi.fn(async () => []),
    uploadProjectDocument: vi.fn(),
    uploadStandaloneDocument: vi.fn(),
}));
vi.mock("@/app/hooks/useSelectedModel", () => ({
    useSelectedModel: () => ["claude-sonnet-4-6", vi.fn()],
    useSelectedReasoning: () => ["high", vi.fn()],
}));
vi.mock("@/app/hooks/useConfiguredModels", () => ({
    useConfiguredModels: () => [],
}));
vi.mock("@/app/contexts/UserProfileContext", () => ({
    useUserProfile: () => ({ profile: null }),
}));
vi.mock("@/app/lib/modelAvailability", () => ({
    getModelProvider: vi.fn(),
    isModelAvailable: vi.fn(() => true),
}));
vi.mock("./AddDocButton", () => ({ AddDocButton: () => null }));
vi.mock("./UploadOverlay", () => ({ UploadOverlay: () => null }));
vi.mock("../shared/FileTypeIcon", () => ({ FileTypeIcon: () => null }));
vi.mock("../modals/AddDocumentsModal", () => ({
    AddDocumentsModal: () => null,
}));
vi.mock("./AssistantWorkflowModal", () => ({
    AssistantWorkflowModal: () => null,
}));
vi.mock("../popups/ApiKeyMissingPopup", () => ({
    ApiKeyMissingPopup: () => null,
}));
vi.mock("./ModelToggle", () => ({ ModelToggle: () => null }));

class ResizeObserverMock {
    observe() {}
    disconnect() {}
    unobserve() {}
}

function renderInput(canSend: boolean | null = true) {
    const onSubmit = vi.fn();
    const ref = createRef<ChatInputHandle>();
    render(
        <ChatInput
            ref={ref}
            onSubmit={onSubmit}
            onCancel={vi.fn()}
            isLoading={false}
            canSend={canSend}
        />,
    );
    return { onSubmit, ref };
}

describe("ChatInput intake request", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.stubGlobal("ResizeObserver", ResizeObserverMock);
    });

    it("shows the request as a pill with a suggested prompt, and sends both only on Enter", async () => {
        const user = userEvent.setup();
        const { onSubmit, ref } = renderInput();

        act(() =>
            ref.current?.startIntake(
                { id: "request-1", title: "Review mutual NDA" },
                "Process this intake request.",
            ),
        );
        expect(screen.getByText("Review mutual NDA")).toBeInTheDocument();
        expect(screen.getByRole("combobox")).toHaveValue(
            "Process this intake request.",
        );
        expect(onSubmit).not.toHaveBeenCalled();

        await user.click(screen.getByRole("combobox"));
        await user.keyboard("{Enter}");
        await waitFor(() =>
            expect(onSubmit).toHaveBeenCalledWith(
                expect.objectContaining({
                    content: "Process this intake request.",
                    intake: { id: "request-1", title: "Review mutual NDA" },
                }),
            ),
        );
        expect(screen.queryByText("Review mutual NDA")).toBeNull();
    });

    it("keeps a draft already typed instead of the suggested prompt", async () => {
        const user = userEvent.setup();
        const { ref } = renderInput();

        await user.type(screen.getByRole("combobox"), "Check the term");
        act(() =>
            ref.current?.startIntake(
                { id: "request-1", title: "Review mutual NDA" },
                "Process this intake request.",
            ),
        );
        expect(screen.getByText("Review mutual NDA")).toBeInTheDocument();
        expect(screen.getByRole("combobox")).toHaveValue("Check the term");
    });

    it("sends without the request once its pill is removed", async () => {
        const user = userEvent.setup();
        const { onSubmit, ref } = renderInput();

        act(() =>
            ref.current?.startIntake(
                { id: "request-1", title: "Review mutual NDA" },
                "Process this intake request.",
            ),
        );
        await user.click(screen.getByRole("button", { name: /^Remove/ }));
        expect(screen.queryByText("Review mutual NDA")).toBeNull();
        await user.click(screen.getByRole("combobox"));
        await user.keyboard("{Enter}");
        await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
        expect(onSubmit.mock.calls[0][0].intake).toBeUndefined();
    });
});
