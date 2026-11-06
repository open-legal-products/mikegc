import { describe, expect, it, vi } from "vitest";
import type { IntakeActionEvent } from "@mike/contracts";

type StreamParams = {
  tools: { function: { name: string } }[];
  callbacks: { onContentDelta: (text: string) => void };
  runTools: (
    calls: { id: string; name: string; input: Record<string, unknown> }[],
  ) => Promise<unknown>;
};
const { streamChatWithTools } = vi.hoisted(() => ({
  streamChatWithTools:
    vi.fn<(...args: [StreamParams]) => Promise<{ fullText: string }>>(),
}));
vi.mock("../../../../lib/llm", async () => ({
  ...(await vi.importActual<Record<string, unknown>>(
    "../../../../lib/llm/models",
  )),
  streamChatWithTools,
}));
vi.mock("../../../../lib/mcpConnectors", () => ({
  buildUserMcpTools: vi.fn(async () => []),
}));

import { runLLMStream } from "../streaming";
import { isMeaningfulTextlessAssistantOutput } from "../contextBuilders";
import { runToolCalls } from "../tools/toolDispatcher";
import {
  INTAKE_ACTION_TOOL_NAME,
  intakeActionEvent,
} from "../tools/intakeActions";
import { SUBAGENT_EXCLUDED_TOOL_NAMES } from "../tools/delegateTools";

const request = { orgId: "org-1", requestId: "request-1" };

function call(id: string, args: Record<string, unknown>) {
  return {
    id,
    function: { name: INTAKE_ACTION_TOOL_NAME, arguments: JSON.stringify(args) },
  };
}

function streamOptions(write = vi.fn()) {
  return {
    model: "gemini-3.8-flash",
    apiMessages: [{ role: "user", content: "Resolve this request." }],
    docStore: new Map(),
    docIndex: {},
    userId: "user-1",
    db: {} as never,
    write,
    includeAskInputs: false,
    allowDocumentMutation: false,
  };
}

describe("propose_intake_status_change", () => {
  it("is offered only in a chat started from an intake request", async () => {
    const offered: boolean[] = [];
    streamChatWithTools.mockImplementation(async ({ tools }) => {
      offered.push(
        tools.some((tool) => tool.function.name === INTAKE_ACTION_TOOL_NAME),
      );
      return { fullText: "Done." };
    });
    await runLLMStream(streamOptions());
    await runLLMStream({ ...streamOptions(), intakeRequest: request });
    expect(offered).toEqual([false, true]);
    expect(SUBAGENT_EXCLUDED_TOOL_NAMES.has(INTAKE_ACTION_TOOL_NAME)).toBe(true);
    streamChatWithTools.mockReset();
  });

  it("streams and persists a card for the chat's own request", async () => {
    streamChatWithTools.mockImplementationOnce(async ({ callbacks, runTools }) => {
      callbacks.onContentDelta("Confirm to resolve it.");
      await runTools([
        {
          id: "card-1",
          name: INTAKE_ACTION_TOOL_NAME,
          // A request the model names is ignored: the card is for the chat's.
          input: { action: "resolve", note: " Signed. ", request_id: "other" },
        },
      ]);
      return { fullText: "" };
    });
    const write = vi.fn();
    const { events } = await runLLMStream({
      ...streamOptions(write),
      intakeRequest: request,
    });
    const streamed = events.find(
      (event): event is IntakeActionEvent => event.type === "intake_action",
    );
    const card: IntakeActionEvent = {
      type: "intake_action",
      card_id: streamed!.card_id,
      org_id: "org-1",
      request_id: "request-1",
      action: "resolve",
      note: "Signed.",
    };
    expect(events).toContainEqual(card);
    expect(isMeaningfulTextlessAssistantOutput(card)).toBe(true);
    expect(write.mock.calls.map(([frame]) => frame).join("")).toContain(
      `data: ${JSON.stringify(card)}\n\n`,
    );
  });

  it("tells the model nothing changed until the user confirms", async () => {
    const result = await runToolCalls(
      [call("call-1", { action: "wait" })],
      new Map(),
      "user-1",
      {} as never,
      vi.fn(),
      undefined, undefined, undefined, undefined, undefined, undefined,
      undefined, undefined, undefined,
      { intakeRequest: request },
    );
    expect(result.intakeActionEvents).toHaveLength(1);
    const content = JSON.parse(
      (result.toolResults[0] as { content: string }).content,
    );
    expect(content).toMatchObject({
      card_id: result.intakeActionEvents[0].card_id,
      proposed: true,
    });
  });

  it("gives every proposal its own card, even when call IDs repeat", async () => {
    // Local models' recovered calls restart at the same ID each turn.
    const propose = () =>
      runToolCalls(
        [call("call_0_0", { action: "wait" })],
        new Map(),
        "user-1",
        {} as never,
        vi.fn(),
        undefined, undefined, undefined, undefined, undefined, undefined,
        undefined, undefined, undefined,
        { intakeRequest: request },
      );
    const [first, second] = [await propose(), await propose()];
    expect(first.intakeActionEvents[0].card_id).not.toBe(
      second.intakeActionEvents[0].card_id,
    );
    expect(first.intakeActionEvents[0].card_id).not.toBe("call_0_0");
  });

  it("refuses outside an intake chat and without a reason to cancel", async () => {
    const write = vi.fn();
    const outside = await runToolCalls(
      [call("card-1", { action: "resolve" })],
      new Map(),
      "user-1",
      {} as never,
      write,
    );
    expect(outside.intakeActionEvents).toEqual([]);
    expect(write).not.toHaveBeenCalled();
    expect(
      JSON.parse((outside.toolResults[0] as { content: string }).content),
    ).toHaveProperty("error");

    expect(intakeActionEvent("card-2", { action: "cancel" }, request)).toEqual({
      error: "Give the reason for cancelling in note.",
    });
    expect(intakeActionEvent("card-3", { action: "delete" }, request)).toHaveProperty(
      "error",
    );
  });

  it("keeps a note only where the change takes one", () => {
    expect(
      intakeActionEvent("card-1", { action: "reopen", note: "Again" }, request),
    ).toEqual({
      event: {
        type: "intake_action",
        card_id: "card-1",
        org_id: "org-1",
        request_id: "request-1",
        action: "reopen",
      },
    });
    expect(
      intakeActionEvent("card-2", { action: "cancel", note: "Duplicate" }, request),
    ).toMatchObject({ event: { action: "cancel", note: "Duplicate" } });
  });
});
