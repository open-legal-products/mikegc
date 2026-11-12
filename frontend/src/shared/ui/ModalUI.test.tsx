import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ModalUI } from "./ModalUI";

describe("ModalUI", () => {
    it("renders shared modal chrome, content, and action slots", async () => {
        const onClose = vi.fn();
        const user = userEvent.setup();

        render(
            <ModalUI
                open
                onClose={onClose}
                breadcrumbs={["Documents", "Add documents"]}
                ariaLabel="Add documents"
                primaryAction={<button type="button">Confirm</button>}
            >
                <p>Select documents</p>
            </ModalUI>,
        );

        expect(
            screen.getByRole("dialog", { name: "Add documents" }),
        ).toHaveClass("liquid-glass-modal");
        expect(screen.getByText("Select documents")).toBeVisible();
        expect(screen.getByRole("button", { name: "Confirm" })).toBeVisible();

        await user.click(screen.getByRole("button", { name: "Close" }));
        expect(onClose).toHaveBeenCalledOnce();
    });

    it("closes on Escape", () => {
        const onClose = vi.fn();

        render(
            <ModalUI open onClose={onClose} ariaLabel="Example">
                Content
            </ModalUI>,
        );

        fireEvent.keyDown(window, { key: "Escape" });
        expect(onClose).toHaveBeenCalledOnce();
    });

    it("leaves Escape to a control inside the dialog that handled it", () => {
        const onClose = vi.fn();

        render(
            <ModalUI open onClose={onClose} ariaLabel="Example">
                <input
                    aria-label="Search"
                    onKeyDown={(event) => {
                        if (event.key === "Escape") event.preventDefault();
                    }}
                />
            </ModalUI>,
        );

        fireEvent.keyDown(screen.getByRole("textbox", { name: "Search" }), {
            key: "Escape",
        });
        expect(onClose).not.toHaveBeenCalled();
    });
});

it("disables all dismissal paths during a protected write, then restores them", async () => {
    const close = vi.fn();
    const user = userEvent.setup();
    const view = render(<ModalUI open closeDisabled onClose={close} breadcrumbs={["Protected write"]}>Saving</ModalUI>);
    const button = await screen.findByRole("button", { name: "Close" });
    expect(button).toBeDisabled();
    await user.click(button);
    fireEvent.keyDown(window, { key: "Escape" });
    fireEvent.mouseDown(screen.getByRole("dialog").parentElement!);
    expect(close).not.toHaveBeenCalled();
    view.rerender(<ModalUI open onClose={close} breadcrumbs={["Protected write"]}>Ready</ModalUI>);
    expect(screen.getByRole("button", { name: "Close" })).toBeEnabled();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(close).toHaveBeenCalledOnce();
});
