import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { IntakePill } from "./IntakePill";

describe("IntakePill", () => {
    it("in a composer, removes the request by name without submitting", async () => {
        const onRemove = vi.fn();
        render(
            <form>
                <IntakePill title="Review mutual NDA" onRemove={onRemove} />
            </form>,
        );
        const remove = screen.getByRole("button", {
            name: "Remove intake request Review mutual NDA",
        });
        expect(remove).toHaveAttribute("type", "button");
        await userEvent.click(remove);
        expect(onRemove).toHaveBeenCalledTimes(1);
    });

    it("on a sent message, is a plain label", () => {
        render(<IntakePill title="Review mutual NDA" />);
        expect(screen.getByText("Review mutual NDA")).toBeInTheDocument();
        expect(screen.getByText(", intake request")).toBeInTheDocument();
        expect(screen.queryByRole("button")).toBeNull();
    });
});
