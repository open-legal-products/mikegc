import { describe, expect, it, vi } from "vitest";
import type { IntakeAutomationSettings } from "@mike/contracts";

vi.mock("@/app/contexts/WorkspaceContext", () => ({
  PERSONAL_WORKSPACE: "personal",
}));

import {
  MAX_INTAKE_DOMAINS,
  NOTHING_COMMITTED,
  intakeAutomationChanges,
  intakeAutomationDraft,
  intakeDomainInputError,
  intakeDraftAfterFailure,
  intakeAutosaveDraft,
  intakeDraftAfterSave,
  intakeDraftWithSwitches,
  moveIntakeRule,
  newIntakeRule,
  normalizeIntakeDomain,
} from "./intakeAutomation";

const saved: IntakeAutomationSettings = {
  email: {
    enabled: true,
    provider: "graph",
    mailbox: "intake@example.com",
    allowed_domains: ["example.com"],
    from_name: "Legal",
    graph: { tenant_id: "t1", client_id: "c1", secret_set: true },
    notification_url: "https://api.example.test/webhooks/intake/graph/1",
    gmail: { client_id: null, key_set: false, deployment_key: false },
    status: { subscription_expires_at: null, last_read_at: null, error: null },
  },
  slack: {
    enabled: false,
    events_url: "https://api.example.test/webhooks/intake/slack/1",
    configured: true,
    team_id: "T1",
    team_name: "Acme",
    bot_user_id: "U1",
    missing_scopes: [],
    message_events_seen: true,
  },
  teams: {
    enabled: false,
    events_url: "https://api.example.test/webhooks/intake/teams/1",
    configured: false,
    app_id: null,
    tenant_id: null,
    files_access: null,
  },
  models: {
    available: ["claude-haiku-4-5", "claude-sonnet-5-5"],
    triage: "claude-haiku-4-5",
    triage_available: true,
    preprocessing: "claude-sonnet-5-5",
    preprocessing_available: true,
  },
  rules: [
    {
      condition: "NDAs",
      assignee_id: "a",
      preprocess: false,
      preprocess_with: null,
    },
  ],
  recent: [],
};

describe("moveIntakeRule", () => {
  const [a, b, c] = ["A", "B", "C"].map((condition) =>
    newIntakeRule({ condition }),
  );
  const names = (rules: { condition: string }[]) =>
    rules.map((rule) => rule.condition).join("");
  it("drops a rule before or after another", () => {
    expect(names(moveIntakeRule([a, b, c], c.key, a.key, "before"))).toBe(
      "CAB",
    );
    expect(names(moveIntakeRule([a, b, c], a.key, c.key, "after"))).toBe("BCA");
    expect(names(moveIntakeRule([a, b, c], a.key, c.key, "before"))).toBe(
      "BAC",
    );
  });
  it("leaves the rules as they are when nothing moves", () => {
    const rules = [a, b, c];
    expect(moveIntakeRule(rules, a.key, a.key, "after")).toBe(rules);
    expect(moveIntakeRule(rules, a.key, b.key, "before")).toBe(rules);
    expect(moveIntakeRule(rules, "missing", b.key, "after")).toBe(rules);
  });
});

describe("normalizeIntakeDomain", () => {
  it("keeps a domain as the API does, lowercase", () => {
    expect(normalizeIntakeDomain(" Example.COM ")).toBe("example.com");
    expect(normalizeIntakeDomain("@example.com")).toBe("example.com");
    expect(normalizeIntakeDomain("jane@legal.example.co.uk")).toBe(
      "legal.example.co.uk",
    );
    expect(normalizeIntakeDomain("*.example.com")).toBe("example.com");
    expect(normalizeIntakeDomain("xn--80ak6aa92e.com")).toBe(
      "xn--80ak6aa92e.com",
    );
  });

  it("refuses what is not a domain", () => {
    for (const text of [
      "",
      "example",
      "exa mple.com",
      "-a.com",
      "a.c",
      "http://a.com",
    ])
      expect(normalizeIntakeDomain(text)).toBeNull();
  });
});

describe("intakeAutomationChanges", () => {
  it("sends nothing for an untouched draft", () => {
    expect(
      intakeAutomationChanges(saved, intakeAutomationDraft(saved)),
    ).toEqual({});
  });

  it("sends each changed field and only those", () => {
    const draft = {
      ...intakeAutomationDraft(saved),
      emailEnabled: false,
      slackEnabled: true,
      botToken: "  xoxb-1 ",
    };
    expect(intakeAutomationChanges(saved, draft)).toEqual({
      email_enabled: false,
      slack_enabled: true,
      slack_bot_token: "xoxb-1",
    });
  });

  it("sends every complete rule, in order, when one changes", () => {
    const draft = {
      ...intakeAutomationDraft(saved),
      rules: [
        newIntakeRule({ condition: " Employment", assigneeId: "c" }),
        newIntakeRule({ condition: "NDAs ", assigneeId: "a" }),
        // Not yet complete, so not sent.
        newIntakeRule({ condition: "Leases" }),
        newIntakeRule({ condition: "  ", assigneeId: "b" }),
      ],
    };
    expect(intakeAutomationChanges(saved, draft)).toEqual({
      rules: [
        {
          condition: "Employment",
          assignee_id: "c",
          preprocess: false,
          preprocess_with: null,
        },
        {
          condition: "NDAs",
          assignee_id: "a",
          preprocess: false,
          preprocess_with: null,
        },
      ],
    });
    // Whitespace, or a rule still being written, is not a change.
    expect(
      intakeAutomationChanges(saved, {
        ...intakeAutomationDraft(saved),
        rules: [
          newIntakeRule({ condition: " NDAs ", assigneeId: "a" }),
          newIntakeRule(),
        ],
      }),
    ).toEqual({});
  });

  it("leaves a typed domain to its field", () => {
    const typed = { ...intakeAutomationDraft(saved), domainInput: "Acme.test" };
    expect(intakeAutomationChanges(saved, typed)).toEqual({});
    const invalid = { ...typed, domainInput: "acme" };
    expect(intakeDomainInputError(invalid)).toBe(
      "Enter a domain like example.com.",
    );
  });

  it("allows at most the domains the API keeps", () => {
    const full = {
      ...intakeAutomationDraft(saved),
      domains: Array.from(
        { length: MAX_INTAKE_DOMAINS },
        (_, i) => `d${i}.test`,
      ),
      domainInput: "one-more.test",
    };
    expect(intakeDomainInputError(full)).toBe(
      "Up to 50 domains can be listed.",
    );
  });
});

describe("intakeDraftAfterSave", () => {
  it("shows what the server kept and clears a sent secret", () => {
    const draft = {
      ...intakeAutomationDraft(saved),
      domains: ["b.test", "a.test"],
      signingSecret: " s3cret ",
      slackEnabled: true,
    };
    const sent = intakeAutomationChanges(saved, draft);
    const kept: IntakeAutomationSettings = {
      ...saved,
      email: { ...saved.email, allowed_domains: ["a.test", "b.test"] },
      slack: { ...saved.slack, enabled: true },
    };
    const next = intakeDraftAfterSave(draft, sent, kept);
    // Rules weren't sent, so they stay the same rules.
    expect(next.rules).toBe(draft.rules);
    expect({ ...next, rules: [] }).toEqual({
      ...intakeAutomationDraft(kept),
      rules: [],
    });
    expect(intakeAutomationChanges(kept, next)).toEqual({});
  });

  it("shows the conditions the server kept, leaving rules being written alone", () => {
    const typing = newIntakeRule({ condition: "Disputes ", assigneeId: "a" });
    const cleaned = newIntakeRule({
      condition: "Leases\u0000",
      assigneeId: "b",
    });
    const unfinished = newIntakeRule({ condition: "Hiring" });
    const draft = {
      ...intakeAutomationDraft(saved),
      rules: [typing, unfinished, cleaned],
    };
    const sent = intakeAutomationChanges(saved, draft);
    const kept: IntakeAutomationSettings = {
      ...saved,
      rules: [
        {
          condition: "Disputes",
          assignee_id: "a",
          preprocess: false,
          preprocess_with: null,
        },
        {
          condition: "Leases",
          assignee_id: "b",
          preprocess: false,
          preprocess_with: null,
        },
      ],
    };
    const next = intakeDraftAfterSave(draft, sent, kept);
    // A pause after a space keeps the space; the same rules keep their keys.
    expect(next.rules).toEqual([
      { ...typing, saved: { condition: "Disputes", assigneeId: "a" } },
      unfinished,
      {
        ...cleaned,
        condition: "Leases",
        saved: { condition: "Leases", assigneeId: "b" },
      },
    ]);
    expect(intakeAutomationChanges(kept, next)).toEqual({});
  });

  it("keeps what was edited while the save was out", () => {
    const sentDraft = {
      ...intakeAutomationDraft(saved),
      domains: ["example.com", "a.test"],
      botToken: "xoxb-1",
    };
    const sent = intakeAutomationChanges(saved, sentDraft);
    const later = {
      ...sentDraft,
      domains: ["example.com", "a.test", "b.test"],
      botToken: "xoxb-2",
      domainInput: "acme.test",
    };
    const kept = {
      ...saved,
      email: { ...saved.email, allowed_domains: ["example.com", "a.test"] },
    };
    const next = intakeDraftAfterSave(later, sent, kept);
    expect(next.domains).toEqual(["example.com", "a.test", "b.test"]);
    expect(next.botToken).toBe("xoxb-2");
    expect(next.domainInput).toBe("acme.test");
  });
});

describe("rule preprocessing", () => {
  it("sends preprocessing with each rule, its workflow or playbook by kind and id", () => {
    const draft = {
      ...intakeAutomationDraft(saved),
      rules: [
        newIntakeRule({
          condition: "NDAs",
          assigneeId: "a",
          preprocess: true,
          preprocessWith: {
            kind: "playbook",
            id: "pb-1",
            name: "NDA playbook",
          },
        }),
      ],
    };
    expect(intakeAutomationChanges(saved, draft)).toEqual({
      rules: [
        {
          condition: "NDAs",
          assignee_id: "a",
          preprocess: true,
          preprocess_with: { kind: "playbook", id: "pb-1" },
        },
      ],
    });
  });

  it("treats a rule as unchanged when only its workflow's name differs", () => {
    const named = {
      ...saved,
      rules: [
        {
          condition: "NDAs",
          assignee_id: "a",
          preprocess: true,
          preprocess_with: {
            kind: "workflow" as const,
            id: "wf-1",
            name: "NDA first pass",
          },
        },
      ],
    };
    const draft = intakeAutomationDraft(named);
    draft.rules[0] = {
      ...draft.rules[0],
      preprocessWith: { kind: "workflow", id: "wf-1", name: null },
    };
    expect(intakeAutomationChanges(named, draft)).toEqual({});
    // Once saved, the rule shows the name the server gives it.
    const sent = {
      rules: [
        {
          condition: "NDAs",
          assignee_id: "a",
          preprocess: true,
          preprocess_with: { kind: "workflow" as const, id: "wf-1" },
        },
      ],
    };
    expect(
      intakeDraftAfterSave(draft, sent, named).rules[0]?.preprocessWith,
    ).toEqual({ kind: "workflow", id: "wf-1", name: "NDA first pass" });
  });
});

describe("intakeDraftAfterFailure", () => {
  it("turns a sent switch back and keeps typed text", () => {
    const draft = {
      ...intakeAutomationDraft(saved),
      slackEnabled: true,
      domainInput: "acme.test",
    };
    const sent = intakeAutomationChanges(saved, draft);
    expect(intakeDraftAfterFailure(draft, sent, saved)).toEqual({
      ...draft,
      slackEnabled: false,
    });
  });
});
describe("intakeDraftWithSwitches", () => {
  it("sets a failed switch and model again, unless one was changed since", () => {
    const sent = { slack_enabled: true, triage_model: "claude-sonnet-5-5" };
    // The failure turned both back; the model was then chosen again.
    const draft = {
      ...intakeAutomationDraft(saved),
      preprocessingModel: null,
      triageModel: "gpt-6",
    };
    expect(intakeDraftWithSwitches(draft, sent, saved)).toEqual({
      ...draft,
      slackEnabled: true,
      triageModel: "gpt-6",
    });
    expect(
      intakeDraftWithSwitches(intakeAutomationDraft(saved), sent, saved),
    ).toMatchObject({ slackEnabled: true, triageModel: "claude-sonnet-5-5" });
  });
});

describe("a saved rule being retyped", () => {
  it("keeps saving as it was while its condition is cleared, and other rules still save", () => {
    const draft = intakeAutomationDraft(saved);
    const cleared = {
      ...draft,
      rules: [{ ...draft.rules[0]!, condition: "" }],
    };
    // Nothing to save: clearing it doesn't delete it.
    expect(intakeAutomationChanges(saved, cleared)).toEqual({});
    const another = newIntakeRule({ condition: "Leases", assigneeId: "b" });
    expect(
      intakeAutomationChanges(saved, {
        ...cleared,
        rules: [...cleared.rules, another],
      }).rules,
    ).toEqual([
      {
        condition: "NDAs",
        assignee_id: "a",
        preprocess: false,
        preprocess_with: null,
      },
      {
        condition: "Leases",
        assignee_id: "b",
        preprocess: false,
        preprocess_with: null,
      },
    ]);
    // Retyped, it saves as the new text.
    expect(
      intakeAutomationChanges(saved, {
        ...draft,
        rules: [{ ...draft.rules[0]!, condition: "NDAs and leases" }],
      }).rules?.[0],
    ).toMatchObject({ condition: "NDAs and leases" });
  });
});

describe("intakeAutosaveDraft", () => {
  const none = NOTHING_COMMITTED;
  const unset: IntakeAutomationSettings = {
    ...saved,
    email: { ...saved.email, enabled: false, provider: null, mailbox: null },
    slack: { ...saved.slack, enabled: false, configured: false },
  };

  it("holds a channel turned on until it can run", () => {
    const draft = {
      ...intakeAutomationDraft(unset),
      emailEnabled: true,
      slackEnabled: true,
    };
    expect(
      intakeAutomationChanges(unset, intakeAutosaveDraft(unset, draft, none)),
    ).toEqual({});
  });

  it("turns Slack on with both its secrets, once each is complete", () => {
    const draft = {
      ...intakeAutomationDraft(unset),
      slackEnabled: true,
      signingSecret: "s3cret",
      botToken: "xoxb-1",
    };
    expect(
      intakeAutomationChanges(
        unset,
        intakeAutosaveDraft(unset, draft, {
          ...none,
          signingSecret: true,
        }),
      ),
    ).toEqual({ slack_signing_secret: "s3cret" });
    expect(
      intakeAutomationChanges(
        unset,
        intakeAutosaveDraft(unset, draft, {
          ...none,
          signingSecret: true,
          botToken: true,
        }),
      ),
    ).toEqual({
      slack_enabled: true,
      slack_signing_secret: "s3cret",
      slack_bot_token: "xoxb-1",
    });
  });

  it("sends a channel turned on or off once it is set up", () => {
    const draft = {
      ...intakeAutomationDraft(saved),
      emailEnabled: false,
      slackEnabled: true,
    };
    expect(
      intakeAutomationChanges(saved, intakeAutosaveDraft(saved, draft, none)),
    ).toEqual({ email_enabled: false, slack_enabled: true });
  });
});

describe("the requester loop's settings", () => {
  it("sends the sender name trimmed, and never an empty one", () => {
    const draft = intakeAutomationDraft(saved);
    expect(
      intakeAutomationChanges(saved, { ...draft, fromName: " Legal team " }),
    ).toEqual({ email_from_name: "Legal team" });
    expect(intakeAutomationChanges(saved, { ...draft, fromName: "  " })).toEqual(
      {},
    );
  });

  it("holds email turned on until a mailbox is connected", () => {
    const unconnected: IntakeAutomationSettings = {
      ...saved,
      email: { ...saved.email, enabled: false, provider: null },
    };
    const draft = { ...intakeAutomationDraft(unconnected), emailEnabled: true };
    expect(
      intakeAutomationChanges(
        unconnected,
        intakeAutosaveDraft(unconnected, draft, NOTHING_COMMITTED),
      ),
    ).toEqual({});
  });

  it("saves Teams IDs once typed in full, and turns Teams on with all three", () => {
    const draft = {
      ...intakeAutomationDraft(saved),
      teamsEnabled: true,
      teamsAppId: "app-1",
      teamsTenantId: "tenant-1",
      teamsSecret: "s3cret",
    };
    // Part-typed: nothing goes, and the switch waits.
    expect(
      intakeAutomationChanges(
        saved,
        intakeAutosaveDraft(saved, draft, NOTHING_COMMITTED),
      ),
    ).toEqual({});
    expect(
      intakeAutomationChanges(
        saved,
        intakeAutosaveDraft(saved, draft, {
          ...NOTHING_COMMITTED,
          teamsAppId: true,
        }),
      ),
    ).toEqual({ teams_app_id: "app-1" });
    const all = {
      ...NOTHING_COMMITTED,
      teamsAppId: true,
      teamsTenantId: true,
      teamsSecret: true,
    };
    const sent = intakeAutomationChanges(
      saved,
      intakeAutosaveDraft(saved, draft, all),
    );
    expect(sent).toEqual({
      teams_enabled: true,
      teams_app_id: "app-1",
      teams_tenant_id: "tenant-1",
      teams_client_secret: "s3cret",
    });
    const after = intakeDraftAfterSave(draft, sent, {
      ...saved,
      teams: {
        ...saved.teams,
        enabled: true,
        configured: true,
        app_id: "app-1",
        tenant_id: "tenant-1",
      },
    });
    // The secret is never shown again; the IDs show as saved.
    expect(after).toMatchObject({
      teamsEnabled: true,
      teamsAppId: "app-1",
      teamsTenantId: "tenant-1",
      teamsSecret: "",
    });
  });
});
