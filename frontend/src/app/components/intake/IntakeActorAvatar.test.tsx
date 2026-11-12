import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import {
  IntakeActorAvatar,
  IntakeMikeGCMark,
  isMikeGCEvent,
  isMikeGCRequest,
} from "./IntakeActorAvatar";

describe("IntakeActorAvatar", () => {
  it("shows the person's initials, hidden from assistive technology", () => {
    const { container } = render(<IntakeActorAvatar name="Sam Colleague" />);
    const mark = container.firstElementChild!;
    expect(mark).toHaveAttribute("aria-hidden", "true");
    expect(mark).toHaveAttribute("data-actor", "person");
    expect(mark).toHaveTextContent("SC");
  });

  it("shows a neutral mark for an automatic change", () => {
    const { container } = render(<IntakeActorAvatar name={null} />);
    const mark = container.firstElementChild!;
    expect(mark).toHaveAttribute("data-actor", "automatic");
    expect(mark).toHaveTextContent("");
    expect(mark.querySelector("svg")).not.toBeNull();
  });

  it("shows MikeGC's mark, not initials, for what MikeGC did", () => {
    const { container } = render(<IntakeActorAvatar name="MikeGC" mikegc />);
    const mark = container.firstElementChild!;
    expect(mark).toHaveAttribute("aria-hidden", "true");
    expect(mark).toHaveAttribute("data-actor", "mikegc");
    expect(mark).toHaveTextContent("");
    expect(mark.querySelector("svg.lucide-bot")).not.toBeNull();
  });

  it("draws the same mark beside a request MikeGC created", () => {
    const { container } = render(<IntakeMikeGCMark />);
    const mark = container.firstElementChild!;
    expect(mark).toHaveAttribute("aria-hidden", "true");
    expect(mark).toHaveAttribute("data-actor", "mikegc");
    expect(mark.querySelector("svg.lucide-bot")).not.toBeNull();
  });
});

describe("what MikeGC did", () => {
  it("is an entry with no actor that reads as MikeGC", () => {
    expect(isMikeGCEvent({ actor_id: null, actor_name: "MikeGC" })).toBe(true);
    // An automatic change has no name; a member called MikeGC has an ID.
    expect(isMikeGCEvent({ actor_id: null, actor_name: null })).toBe(false);
    expect(isMikeGCEvent({ actor_id: "u1", actor_name: "MikeGC" })).toBe(false);
  });

  it("is a request from email or Slack with no creator", () => {
    expect(isMikeGCRequest({ created_by: null, source: "gmail" })).toBe(true);
    expect(isMikeGCRequest({ created_by: null, source: "slack" })).toBe(true);
    // A typed request whose creator's account was erased is not MikeGC's.
    expect(isMikeGCRequest({ created_by: null, source: "manual" })).toBe(false);
    expect(isMikeGCRequest({ created_by: "u1", source: "gmail" })).toBe(false);
  });
});
