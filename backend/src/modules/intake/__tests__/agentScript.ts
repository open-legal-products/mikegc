import type {
  NormalizedToolCall,
  StreamChatParams,
  StreamChatResult,
} from "../../../lib/llm";

/**
 * A stand-in for the intake agent's model: each step is the tool calls it
 * makes, run through the real tools. What the tools answered, step by step,
 * is kept in `results`, and every request the agent made in `requests`.
 * The run stops where the real loop would: after the step limit, or when a
 * tool ends it.
 */
export type ScriptedCall = { name: string; input: Record<string, unknown> };

export function scripted(steps: ScriptedCall[][]) {
  const results: string[][] = [];
  const requests: StreamChatParams[] = [];
  const stream = async (params: StreamChatParams): Promise<StreamChatResult> => {
    requests.push(params);
    const limit = params.maxIterations ?? steps.length;
    for (const [i, step] of steps.slice(0, limit).entries()) {
      const calls: NormalizedToolCall[] = step.map((call, j) => ({
        id: `call-${i}-${j}`,
        name: call.name,
        input: call.input,
      }));
      try {
        const out = await params.runTools!(calls);
        results.push(out.map((r) => r.content));
      } catch (error) {
        results.push(["(the run ended)"]);
        throw error;
      }
    }
    return { fullText: "" };
  };
  return { stream, results, requests };
}

export const recordCall = (fields: Record<string, unknown> = {}): ScriptedCall => ({
  name: "record_request",
  input: {
    subject: "Review Supplier Co NDA",
    summary: "Jane needs the Supplier Co NDA reviewed by Friday.",
    requester_name: "Jane Business",
    requester_email: "jane@acme.test",
    due_date: "2026-11-06",
    attachments: [1],
    ...fields,
  },
});
export const ruleCall = (rule: unknown): ScriptedCall => ({ name: "choose_rule", input: { rule } });
export const replyCall = (text: string): ScriptedCall => ({ name: "reply", input: { text } });
export const updateCall = (fields: Record<string, unknown>): ScriptedCall => ({
  name: "update_request",
  input: fields,
});
