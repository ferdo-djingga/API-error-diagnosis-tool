/**
 * Jest tests (no real network calls)
 *  - diagnose() logic for key branches
 *  - runDiagnostics() integrating a mocked fetch
 *  - reporters.toCSV formatting is correct
 */
"use strict";

const { diagnose, runDiagnostics } = require("../src/main");
const { toCSV } = require("../src/reporters");

function makeMockFetch(sequence) {
  // sequence: array of { status, bodyText, delayMs, throwError? }
  let i = 0;
  return async function mockFetch(_url, _opts) {
    const s = sequence[i++] ?? sequence[sequence.length - 1];
    if (s.delayMs) await new Promise((r) => setTimeout(r, s.delayMs));
    if (s.throwError) throw s.throwError;
    return {
      status: s.status,
      async text() {
        return s.bodyText ?? "";
      },
    };
  };
}

describe("diagnose()", () => {
  test("OK fast", () => {
    const d = diagnose({ status: 200, textSnippet: "{}", latencyMs: 120 });
    expect(d.issue).toBe("OK");
    expect(d.severity).toBe("Low");
  });

  test("Slow success", () => {
    const d = diagnose({ status: 200, textSnippet: "ok", latencyMs: 3000 });
    expect(d.issue).toBe("Slow Response");
  });

  test("Server 500", () => {
    const d = diagnose({ status: 500, textSnippet: "boom", latencyMs: 50 });
    expect(d.issue).toBe("Server Error (5xx)");
  });

  test("Client 400 with validation hint", () => {
    const d = diagnose({
      status: 400,
      textSnippet: "missing required field",
      latencyMs: 50,
    });
    expect(d.issue).toBe("Client Error (4xx)");
  });

  test("Timeout error", () => {
    const d = diagnose({
      error: new Error("The operation was aborted"),
    });
    expect(d.issue).toBe("Timeout");
  });

  test("DNS error", () => {
    const d = diagnose({
      error: new Error("ENOTFOUND api.service.local"),
    });
    expect(d.issue).toBe("DNS/Host Resolution Failure");
  });
});

describe("runDiagnostics()", () => {
  test("integrates with mocked fetch", async () => {
    const endpoints = [
      { name: "ok", method: "GET", url: "https://x/ok", expectedStatus: 200 },
      { name: "bad", method: "GET", url: "https://x/bad" },
      { name: "boom", method: "GET", url: "https://x/boom" },
    ];

    const mockFetch = makeMockFetch([
      { status: 200, bodyText: '{"ok":true}' },
      { status: 500, bodyText: "internal error" },
      { throwError: new Error("ENOTFOUND x") },
    ]);

    const results = await runDiagnostics(
      endpoints,
      { concurrency: 2, retries: 0, timeout: 1000 },
      mockFetch
    );

    // ok
    expect(results[0].ok).toBe(true);
    expect(results[0].status).toBe(200);

    // server error
    expect(results[1].ok).toBe(false);
    expect(results[1].status).toBe(500);
    expect(results[1].diagnosis.issue).toMatch(/Server Error/);

    // DNS error
    expect(results[2].ok).toBe(false);
    expect(results[2].error).toBeTruthy();
    expect(results[2].diagnosis.issue).toMatch(/DNS/);
  });
});

describe("toCSV()", () => {
  test("creates header and rows", () => {
    const csv = toCSV([
      {
        timestamp: "2025-01-01T00:00:00.000Z",
        name: "ok",
        method: "GET",
        url: "https://x/ok",
        status: 200,
        ok: true,
        latencyMs: 42,
        diagnosis: { issue: "OK", severity: "Low" },
        expectedStatus: 200,
        attemptCount: 1,
        error: null,
        textSnippet: '{"ok":true}',
      },
    ]);

    const lines = csv.split("\n");
    expect(lines.length).toBeGreaterThan(1);

    // Header is unquoted by design
    const header = lines[0];
    expect(header).toBe(
      "timestamp,name,method,url,status,ok,latency_ms,issue,severity,expected_status,attempts,error_message,response_snippet"
    );

    // First data row should be quoted fields and include the expected values
    const row = lines[1];
    expect(row).toMatch(/"ok","GET","https:\/\/x\/ok"/);

    // Column count check (13 columns)
    const headerCols = header.split(",");
    const rowCols = row.match(/("([^"]|"")*"|[^,]+)/g);
    expect(headerCols.length).toBe(13);
    expect(rowCols.length).toBe(13);
  });
});