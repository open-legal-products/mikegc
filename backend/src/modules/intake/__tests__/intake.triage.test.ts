import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Db } from "../../../lib/supabase";

const mocks = vi.hoisted(() => ({
  getOrgRole: vi.fn(),
  getEffectiveApiKeys: vi.fn(),
  envApiKeys: vi.fn(),
}));
vi.mock("../../../lib/access", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../lib/access")>()),
  getOrgRole: mocks.getOrgRole,
}));
vi.mock("../../user/user.service", () => ({
  getEffectiveApiKeys: mocks.getEffectiveApiKeys,
  envApiKeys: mocks.envApiKeys,
}));
import { parseModelJson } from "../intake.shared";
import {
  availableIntakeModels,
  composeDescription,
  defaultPreprocessingModel,
  defaultTriageModel,
  fallbackFields,
  isCalendarDate,
  resolveIntakeModel,
  type InboundMessage,
} from "../intake.triage";

const message = (overrides: Partial<InboundMessage> = {}): InboundMessage => ({
  source: "gmail",
  sender: { name: "Jane Business", email: "jane@acme.test" },
  sentAt: new Date("2026-11-02T09:14:00Z"),
  subject: "NDA with Supplier Co",
  subjectHint: "NDA with Supplier Co",
  text: "Hi Legal, please review the attached NDA from Supplier Co by Friday. Copy bob@acme.test.",
  candidates: [
    { name: "nda.docx", file_type: "docx", size: 2048, key: "k0", url: null },
    { name: "logo.pdf", file_type: "pdf", size: 100, key: "k1", url: null },
  ],
  skipped: [{ name: "photo.png", reason: "type" }],
  ...overrides,
});
beforeEach(() => {
  vi.clearAllMocks();
  mocks.envApiKeys.mockReturnValue({});
});

describe("reading the model's answer", () => {
  it("accepts fenced, prefixed and slightly broken JSON", () => {
    expect(parseModelJson('```json\n{"subject": "A"}\n```')).toEqual({ subject: "A" });
    expect(parseModelJson('Here you go: {"subject": "A",}')).toEqual({ subject: "A" });
    expect(parseModelJson("no json at all")).toBeNull();
    expect(parseModelJson("[1, 2]")).toBeNull();
  });
  it("only accepts real calendar dates", () => {
    expect(isCalendarDate("2026-11-06")).toBe(true);
    for (const bad of ["2026-02-30", "2026-13-01", "06/11/2026", "1800-01-01", 20261106, null])
      expect(isCalendarDate(bad), String(bad)).toBe(false);
  });
});

describe("the request recorded from a message", () => {
  it("names the sender when there's no subject, and says when there was no text", () => {
    const plain = message({ source: "slack", subject: null, subjectHint: null, text: "" });
    expect(fallbackFields(plain)).toEqual({
      subject: "Request from Jane Business",
      requester_name: "Jane Business",
      requester_email: "jane@acme.test",
    });
    expect(composeDescription({ summary: null, message: plain })).toMatch(/^\(The message had no text\.\)/);
  });
  it("puts the summary above the original message, with the files left off below", () => {
    const description = composeDescription({ summary: "Jane needs the NDA reviewed.", message: message() });
    expect(description).toMatch(
      /^Jane needs the NDA reviewed\.\n\n--- Original message ---\nFrom: Jane Business <jane@acme\.test> in Gmail\nSent: 2 Nov 2026, 09:14 UTC\nSubject: NDA with Supplier Co\n\nHi Legal/,
    );
    expect(description).toMatch(/--- Not attached ---\n- photo\.png: not a PDF, Word, Excel or PowerPoint file$/);
  });
  it("fits the description in 20,000 characters, keeping the list of skipped files", () => {
    const description = composeDescription({
      summary: "Summary.",
      message: message({ text: "a".repeat(50_000) }),
    });
    expect(description.length).toBeLessThanOrEqual(20_000);
    expect(description).toContain("[Message shortened to fit.]");
    expect(description).toMatch(/photo\.png/);
  });
});

describe("choosing the triage model", () => {
  const db = {} as Db;
  const org = "00000000-0000-4000-8000-000000000001";
  const admin = "00000000-0000-4000-8000-000000000002";
  it("runs the chosen model on the organization's keys as the admin who saved the settings", async () => {
    mocks.getOrgRole.mockResolvedValue("admin");
    mocks.getEffectiveApiKeys.mockResolvedValue({ openai: "sk-org" });
    await expect(resolveIntakeModel(db, org, admin, "gpt-6.1-sol")).resolves.toEqual({
      model: "gpt-6.1-sol",
      apiKeys: { openai: "sk-org" },
    });
    expect(mocks.getEffectiveApiKeys).toHaveBeenCalledWith(admin, org, db);
  });
  it("doesn't triage without a chosen model, or once its key has gone", async () => {
    mocks.getOrgRole.mockResolvedValue("admin");
    mocks.getEffectiveApiKeys.mockResolvedValue({ openai: "sk-org" });
    await expect(resolveIntakeModel(db, org, admin, null)).resolves.toBeNull();
    await expect(resolveIntakeModel(db, org, admin, "claude-sonnet-5-5")).resolves.toBeNull();
  });
  it("uses only the deployment's keys once that person no longer administers it", async () => {
    mocks.getOrgRole.mockResolvedValue("member");
    mocks.envApiKeys.mockReturnValue({ claude: "sk-env" });
    await expect(resolveIntakeModel(db, org, admin, "claude-haiku-4-5")).resolves.toEqual({
      model: "claude-haiku-4-5",
      apiKeys: undefined,
    });
    expect(mocks.getEffectiveApiKeys).not.toHaveBeenCalled();
    mocks.envApiKeys.mockReturnValue({});
    await expect(resolveIntakeModel(db, org, null, "claude-haiku-4-5")).resolves.toBeNull();
  });
  it("offers every model with a key, starting new settings on a low-cost one", async () => {
    mocks.getOrgRole.mockResolvedValue("admin");
    mocks.getEffectiveApiKeys.mockResolvedValue({ openai: "sk-org" });
    const models = await availableIntakeModels(db, org, admin);
    expect(models).toContain("gpt-6.1-sol");
    expect(models).toContain("gpt-6-luna");
    expect(models.some((id) => id.startsWith("claude-"))).toBe(false);
    expect(defaultTriageModel(models)).toBe("gpt-6-luna");
    expect(defaultPreprocessingModel(models)).toBe("gpt-6.1-sol");
    expect(defaultTriageModel([])).toBeNull();
  });
});
