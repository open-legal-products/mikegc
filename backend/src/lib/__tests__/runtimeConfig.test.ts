import { describe, expect, it } from "vitest";
import {
  diagnosticErrorTags,
  diagnosticEvent,
} from "../observability/sentryPrivacy";
import {
  uploadConversionTimeoutMs,
  uploadJobWallClockMs,
  uploadProcessingConfiguration,
  gmailSharedMailboxGrants,
  gmailSharedMailboxWarnings,
  storagePublicEndpointWarnings,
  uploadSessionRateLimitConfiguration,
  validateRuntimeConfiguration,
} from "../runtimeConfig";

const validProduction = {
  NODE_ENV: "production",
  SUPABASE_URL: "https://project.supabase.co",
  SUPABASE_PUBLISHABLE_KEY: "publishable-key",
  SUPABASE_SECRET_KEY: "service-role-key",
  FRONTEND_URL: "https://app.example.test",
  API_PUBLIC_URL: "https://app.example.test/api",
} as NodeJS.ProcessEnv;

describe("runtime authentication configuration", () => {
  it("accepts a complete production configuration", () => {
    expect(() => validateRuntimeConfiguration(validProduction)).not.toThrow();
  });

  it("rejects insecure production callback configuration", () => {
    expect(() =>
      validateRuntimeConfiguration({
        ...validProduction,
        FRONTEND_URL: "http://app.example.test",
        API_PUBLIC_URL: "http://app.example.test/api",
      }),
    ).toThrow(/FRONTEND_URL must use https in production/);
  });

  // MIKE-BACKEND-2: the backend image defaults NODE_ENV=production, so a bare
  // `docker run` with no public URLs dies here. The message must name the
  // variables AND the switch a local run actually needs.
  it("tells a local run of the production image how to proceed", () => {
    expect(() =>
      validateRuntimeConfiguration({
        ...validProduction,
        FRONTEND_URL: undefined,
        API_PUBLIC_URL: undefined,
      }),
    ).toThrow(
      /FRONTEND_URL is required in production\n- API_PUBLIC_URL is required in production\n\n.*set NODE_ENV=development/s,
    );
  });

  it("does not suggest NODE_ENV when only non-production settings are wrong", () => {
    expect(() =>
      validateRuntimeConfiguration({
        ...validProduction,
        SUPABASE_SECRET_KEY: undefined,
      }),
    ).toThrow(/^(?![\s\S]*NODE_ENV)[\s\S]*SUPABASE_SECRET_KEY is required$/);
  });

  it("does not weaken the https rule for production URLs", () => {
    expect(() =>
      validateRuntimeConfiguration({
        ...validProduction,
        FRONTEND_URL: "http://localhost:3000",
        API_PUBLIC_URL: "http://localhost:3000/api",
      }),
    ).toThrow(/FRONTEND_URL must use https in production/);
  });

  it("accepts local http URLs outside production", () => {
    expect(() =>
      validateRuntimeConfiguration({
        ...validProduction,
        NODE_ENV: "development",
        FRONTEND_URL: "http://localhost:3000",
        API_PUBLIC_URL: "http://localhost:3000/api",
      }),
    ).not.toThrow();
  });

  it("requires a handoff encryption secret when Word auth is enabled", () => {
    expect(() =>
      validateRuntimeConfiguration({
        ...validProduction,
        WORD_ADDIN_URL: "https://word.example.test",
      }),
    ).toThrow(/AUTH_HANDOFF_ENCRYPTION_SECRET/);
  });

  it("rejects the .env.example placeholder download and key-encryption secrets", () => {
    expect(() =>
      validateRuntimeConfiguration({
        ...validProduction,
        DOWNLOAD_SIGNING_SECRET: "replace-with-a-random-32-byte-hex-string",
        USER_API_KEYS_ENCRYPTION_SECRET: "your-long-random-secret",
      }),
    ).toThrow(/DOWNLOAD_SIGNING_SECRET[\s\S]*USER_API_KEYS_ENCRYPTION_SECRET/s);
  });

  it("rejects real secrets that are too short to be meaningful", () => {
    expect(() =>
      validateRuntimeConfiguration({
        ...validProduction,
        DOWNLOAD_SIGNING_SECRET: "too-short",
        USER_API_KEYS_ENCRYPTION_SECRET: "also-short",
      }),
    ).toThrow(/DOWNLOAD_SIGNING_SECRET[\s\S]*USER_API_KEYS_ENCRYPTION_SECRET/s);
  });

  describe.each([
    "DOWNLOAD_SIGNING_SECRET",
    "USER_API_KEYS_ENCRYPTION_SECRET",
  ])("%s", (name) => {
    it.each([" ", "\t\r\n", " ".repeat(32)])(
      "rejects a whitespace-only value %j",
      (value) => {
        expect(() =>
          validateRuntimeConfiguration({ ...validProduction, [name]: value }),
        ).toThrow(`${name} must contain at least 32 characters`);
      },
    );

    it.each([undefined, ""])("allows an absent or empty value %j", (value) => {
      expect(() =>
        validateRuntimeConfiguration({ ...validProduction, [name]: value }),
      ).not.toThrow();
    });

    it("accepts a value at the minimum length", () => {
      expect(() =>
        validateRuntimeConfiguration({
          ...validProduction,
          [name]: "a".repeat(32),
        }),
      ).not.toThrow();
    });
  });

  it("accepts the legacy anon key name for the user-session client", () => {
    expect(() =>
      validateRuntimeConfiguration({
        ...validProduction,
        SUPABASE_PUBLISHABLE_KEY: undefined,
        SUPABASE_ANON_KEY: "legacy-anon-key",
      }),
    ).not.toThrow();
  });
});

describe("upload-session rate-limit configuration", () => {
  it("uses safe defaults when overrides are absent or invalid", () => {
    expect(
      uploadSessionRateLimitConfiguration({
        RATE_LIMIT_UPLOAD_SESSION_MUTATION_MAX: "0",
        RATE_LIMIT_UPLOAD_SESSION_POLL_MAX: "not-a-number",
      }),
    ).toEqual({
      mutationWindowMinutes: 15,
      mutationMax: 300,
      pollingWindowMinutes: 15,
      pollingMax: 3_000,
      sessionCreationMaxPerHour: 50,
    });
  });

  it("accepts positive environment overrides", () => {
    expect(
      uploadSessionRateLimitConfiguration({
        RATE_LIMIT_UPLOAD_SESSION_MUTATION_WINDOW_MINUTES: "10",
        RATE_LIMIT_UPLOAD_SESSION_MUTATION_MAX: "900",
        RATE_LIMIT_UPLOAD_SESSION_POLL_WINDOW_MINUTES: "20",
        RATE_LIMIT_UPLOAD_SESSION_POLL_MAX: "6000",
        RATE_LIMIT_UPLOAD_SESSION_CREATE_MAX_PER_HOUR: "250",
      }),
    ).toEqual({
      mutationWindowMinutes: 10,
      mutationMax: 900,
      pollingWindowMinutes: 20,
      pollingMax: 6_000,
      sessionCreationMaxPerHour: 250,
    });
  });

  it("clamps an hourly creation limit the database cannot represent", () => {
    expect(
      uploadSessionRateLimitConfiguration({
        RATE_LIMIT_UPLOAD_SESSION_CREATE_MAX_PER_HOUR: "9999999999",
      }).sessionCreationMaxPerHour,
    ).toBe(1_000_000);
  });
});

describe("upload-processing configuration", () => {
  it("uses an eight-job pool with at most two active jobs per user by default", () => {
    expect(uploadProcessingConfiguration({})).toEqual({
      concurrency: 8,
      maxRunningPerUser: 2,
    });
  });

  it("accepts positive overrides and keeps the per-user cap within the pool", () => {
    expect(
      uploadProcessingConfiguration({
        UPLOAD_PROCESSING_CONCURRENCY: "8",
        UPLOAD_PROCESSING_MAX_RUNNING_PER_USER: "20",
      }),
    ).toEqual({
      concurrency: 8,
      maxRunningPerUser: 8,
    });
  });

  it("bounds accidental oversized pools", () => {
    expect(
      uploadProcessingConfiguration({
        UPLOAD_PROCESSING_CONCURRENCY: "1000",
      }),
    ).toEqual({
      concurrency: 64,
      maxRunningPerUser: 2,
    });
  });
});

describe("upload worker deadlines", () => {
  it("uses two-minute conversions and a fifteen-minute job budget by default", () => {
    expect(uploadConversionTimeoutMs({})).toBe(120_000);
    expect(uploadJobWallClockMs({})).toBe(900_000);
  });

  it("accepts overrides inside the supported range", () => {
    expect(
      uploadConversionTimeoutMs({ UPLOAD_CONVERT_TIMEOUT_MS: "45000" }),
    ).toBe(45_000);
    expect(uploadJobWallClockMs({ UPLOAD_JOB_WALL_CLOCK_MS: "300000" })).toBe(
      300_000,
    );
  });

  it("clamps overrides that would disable or never reach the deadline", () => {
    expect(uploadConversionTimeoutMs({ UPLOAD_CONVERT_TIMEOUT_MS: "1" })).toBe(
      10_000,
    );
    expect(
      uploadConversionTimeoutMs({ UPLOAD_CONVERT_TIMEOUT_MS: "9999999" }),
    ).toBe(600_000);
    expect(uploadJobWallClockMs({ UPLOAD_JOB_WALL_CLOCK_MS: "1" })).toBe(
      60_000,
    );
    expect(
      uploadJobWallClockMs({ UPLOAD_JOB_WALL_CLOCK_MS: "9999999999" }),
    ).toBe(3_600_000);
  });

  it("falls back to the defaults for unparseable values", () => {
    expect(
      uploadConversionTimeoutMs({ UPLOAD_CONVERT_TIMEOUT_MS: "soon" }),
    ).toBe(120_000);
    expect(uploadJobWallClockMs({ UPLOAD_JOB_WALL_CLOCK_MS: "-5" })).toBe(
      900_000,
    );
  });
});

it("identifies invalid configuration fields without sending their values", () => {
  let failure: unknown;
  try {
    validateRuntimeConfiguration({
      NODE_ENV: "production",
      SUPABASE_URL: "PRIVATE_URL",
      SUPABASE_SECRET_KEY: "PRIVATE_KEY",
    });
  } catch (error) {
    failure = error;
  }
  const event = diagnosticEvent({ tags: diagnosticErrorTags(failure) });
  expect(event.tags).toEqual({
    failure_code: "configuration_invalid",
    configuration_fields:
      "API_PUBLIC_URL,FRONTEND_URL,SUPABASE_PUBLISHABLE_KEY,SUPABASE_URL",
  });
  expect(JSON.stringify(event)).not.toContain("PRIVATE");
});

// MIKE-FRONTEND-28/3D/2Z: the compose default R2_PUBLIC_ENDPOINT_URL
// (http://localhost:9000) on an install opened from a real host made every
// browser upload fail with "Failed to fetch" and nothing at boot said why.
describe("storagePublicEndpointWarnings", () => {
  const at = (frontend: string, publicEndpoint: string, internal = "http://storage:9000") =>
    storagePublicEndpointWarnings({
      FRONTEND_URL: frontend,
      R2_PUBLIC_ENDPOINT_URL: publicEndpoint,
      R2_ENDPOINT_URL: internal,
    } as NodeJS.ProcessEnv);

  it.each([
    ["https://mike.firm.example", "http://localhost:9000", /loopback/],
    ["http://192.168.1.20:3000", "http://127.0.0.1:9000", /loopback/],
    ["https://mike.firm.example", "", /internal service name/],
    ["https://mike.firm.example", "http://storage.firm.example:9000", /mixed content/],
  ])("warns for FRONTEND_URL %s with public storage %s", (frontend, endpoint, reason) => {
    const warnings = at(frontend, endpoint);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatch(reason);
  });

  it.each([
    ["http://localhost:3000", "http://localhost:9000"],
    ["https://mike.firm.example", "https://storage.firm.example"],
    ["https://mike.firm.example", "https://mike.firm.example"],
  ])("is quiet for FRONTEND_URL %s with public storage %s", (frontend, endpoint) => {
    expect(at(frontend, endpoint)).toEqual([]);
  });
});

describe("the shared Gmail account's grants (INTAKE_GMAIL_SHARED_MAILBOXES)", () => {
  const acme = "3f2a1b4c-0000-4000-8000-00000000000a";
  const globex = "9c1d2e3f-0000-4000-8000-00000000000b";
  const grants = (value: string | undefined) =>
    Object.fromEntries(
      gmailSharedMailboxGrants({ INTAKE_GMAIL_SHARED_MAILBOXES: value } as NodeJS.ProcessEnv),
    );

  it("grants nothing when unset or empty", () => {
    expect(grants(undefined)).toEqual({});
    expect(grants("")).toEqual({});
    expect(grants("  \n ")).toEqual({});
  });
  it("reads addresses and domains per organization, separated by commas, spaces or lines", () => {
    expect(
      grants(`${acme}=intake@acme.com, ${globex}=@globex.com\n${acme}=legal@acme.com\t${acme}=@acme.co.uk`),
    ).toEqual({
      [acme]: ["intake@acme.com", "legal@acme.com", "@acme.co.uk"],
      [globex]: ["@globex.com"],
    });
  });
  it("compares organization IDs, addresses and domains without regard to case", () => {
    expect(grants(`${acme.toUpperCase()}=Intake@Acme.COM`)).toEqual({ [acme]: ["intake@acme.com"] });
  });
  it("grants nothing for an entry it cannot read, and still reads the others", () => {
    const malformed = [
      "intake@acme.com", // no organization
      `${acme}`, // no mailbox
      `${acme}=`, // no mailbox
      `${acme}=acme.com`, // a bare domain: neither an address nor @domain
      `${acme}=@`, // no domain
      `${acme}=@localhost`, // no dot
      `${acme}=a@b@acme.com`, // two @
      `${acme}=*@acme.com=x`, // a second =
      `not-a-uuid=intake@acme.com`,
      `${acme.slice(0, 35)}=intake@acme.com`, // a short ID
      `"${acme}=intake@acme.com"`, // quoted
      `${acme}:intake@acme.com`, // wrong separator
      `${acme}=intake@acme.com;${globex}=@globex.com`, // semicolons
    ];
    for (const entry of malformed) expect(grants(entry), entry).toEqual({});
    expect(grants(`${malformed.join(" ")} ${globex}=@globex.com`)).toEqual({
      [globex]: ["@globex.com"],
    });
  });
  it("never treats a wildcard or a pattern as one: an entry is an exact address or domain", () => {
    // Read as literal text, so they can only ever match that literal mailbox.
    expect(grants(`${acme}=*@acme.com`)).toEqual({ [acme]: ["*@acme.com"] });
    expect(grants(`${acme}=@*.com`)).toEqual({ [acme]: ["@*.com"] });
  });

  describe("warnings at boot", () => {
    const warnings = (env: Record<string, string | undefined>) =>
      gmailSharedMailboxWarnings(env as NodeJS.ProcessEnv);
    it("says nothing when the shared account is not in use, or is granted", () => {
      expect(warnings({})).toEqual([]);
      // Grants without a key are harmless: there is no account to use.
      expect(warnings({ INTAKE_GMAIL_SHARED_MAILBOXES: `${acme}=@acme.com` })).toEqual([]);
      expect(
        warnings({
          INTAKE_GMAIL_SERVICE_ACCOUNT_KEY: "{}",
          INTAKE_GMAIL_SHARED_MAILBOXES: `${acme}=@acme.com`,
        }),
      ).toEqual([]);
    });
    it("warns when the shared key is set and no organization is granted a mailbox", () => {
      for (const list of [undefined, "", `${acme}=acme.com`]) {
        const said = warnings({
          INTAKE_GMAIL_SERVICE_ACCOUNT_KEY: "{}",
          INTAKE_GMAIL_SHARED_MAILBOXES: list,
        });
        expect(said.at(-1)).toMatch(/grants no organization a mailbox/);
      }
    });
    it("counts entries it cannot read without printing them", () => {
      const said = warnings({
        INTAKE_GMAIL_SERVICE_ACCOUNT_KEY: "{}",
        INTAKE_GMAIL_SHARED_MAILBOXES: `${acme}=@acme.com ${acme}=secret-typo.example intake@oops.example`,
      });
      expect(said).toHaveLength(1);
      expect(said[0]).toMatch(/has 2 entries that are not/);
      expect(said.join(" ")).not.toMatch(/secret-typo|oops\.example|3f2a1b4c/);
    });
  });
});
