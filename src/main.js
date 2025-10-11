/* 
 * API Error Diagnosis & Monitoring Tool
 * - Loads endpoints from a JSON config
 * - Probes each endpoint with fetch (timeout, retries)
 * - Diagnoses common error patterns (4xx/5xx/timeouts/DNS)
 * - Writes CSV and HTML reports to /output via reporters.js
 */

"use strict";

const fs = require("fs");
const path = require("path");
const { toCSV, toHTML, writeFileSafe } = require("./reporters");

// Small, dependency-free CLI arg parser
function parseArgs(argv) {
  const args = {
    config: "config/test_endpoints.json",
    concurrency: 5,
    retries: 1,
    timeout: 8000, // ms per attempt
    outputDir: "output",
    csv: "report.csv",
    html: "report.html",
    userAgent: "api-diagnosis-tool/1.0",
  };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    const next = argv[i + 1];
    if (a === "--config" && next) args.config = next;
    if (a === "--concurrency" && next) args.concurrency = Number(next);
    if (a === "--retries" && next) args.retries = Number(next);
    if (a === "--timeout" && next) args.timeout = Number(next);
    if (a === "--outputDir" && next) args.outputDir = next;
    if (a === "--csv" && next) args.csv = next;
    if (a === "--html" && next) args.html = next;
    if (a === "--ua" && next) args.userAgent = next;
  }
  return args;
}

// Utilities 
function nowISO() {
  return new Date().toISOString();
}

function sleep(ms) {
  return new Promise((res) => setTimeout(res, ms));
}

function withTimeout(promise, ms, controller) {
  const timer = setTimeout(function () { controller.abort(); }, ms);
  return promise.finally(function () { clearTimeout(timer); });
}

function safeJsonParse(text) {
  try {
    return { ok: true, data: JSON.parse(text) };
  } catch {
    return { ok: false, data: null };
  }
}

function valueOrDefault(v, def) {
  if (v === undefined || v === null) return def;
  return v;
}

// Diagnosis engine (simple implementation)
function diagnose(params) {
  // Return { issue, severity, recommendation }
  const error = params && params.error;
  const status = params && params.status;
  const textSnippet = params && params.textSnippet;
  const latencyMs = params && params.latencyMs;

  if (error) {
    if (/abort/i.test(error.message)) {
      return {
        issue: "Timeout",
        severity: "High",
        recommendation:
          "Increase API timeout, add retries/backoff, and profile server latency. Check slow DB queries or external dependencies.",
      };
    }
    if (/ENOTFOUND|DNS|getaddrinfo/i.test(error.message)) {
      return {
        issue: "DNS/Host Resolution Failure",
        severity: "High",
        recommendation:
          "Verify DNS records, VPC/peering rules, and environment variables for base URL. Try resolving host from same network.",
      };
    }
    if (/ECONNREFUSED|ECONNRESET/i.test(error.message)) {
      return {
        issue: "Connection Refused/Reset",
        severity: "High",
        recommendation:
          "Check service is listening, security groups, firewalls, mTLS requirements, and upstream rate-limits.",
      };
    }
    return {
      issue: "Network/Client Error",
      severity: "High",
      recommendation:
        "Inspect client network, TLS versions/ciphers, proxies, and any corporate egress rules.",
    };
  }

  if (typeof status === "number") {
    if (status >= 200 && status < 300) {
      // Look for slow success
      if (latencyMs > 1500) {
        return {
          issue: "Slow Response",
          severity: "Medium",
          recommendation:
            "Add server-side tracing (e.g., OpenTelemetry). Cache hot paths, index DB queries, or paginate large payloads.",
        };
      }
      return {
        issue: "OK",
        severity: "Low",
        recommendation: "No action required.",
      };
    }
    if (status >= 500) {
      return {
        issue: "Server Error (5xx)",
        severity: "High",
        recommendation:
          "Inspect server logs, Sentry/Apm traces. Handle edge cases, add circuit breaker, validate upstream dependencies.",
      };
    }
    if (status === 429) {
      return {
        issue: "Rate Limited (429)",
        severity: "Medium",
        recommendation:
          "Implement exponential backoff and jitter. Request higher limits or add client-side batching.",
      };
    }
    if (status === 401 || status === 403) {
      return {
        issue: "Auth/Permission Error",
        severity: "High",
        recommendation:
          "Verify tokens/keys, scopes/roles, clock skew, and CORS rules. Rotate secrets if necessary.",
      };
    }
    if (status >= 400) {
      // Heuristic check for validation hints
      const snippetForTest = textSnippet || "";
      const hasValidationWord = /invalid|missing|required|schema|format/i.test(
        snippetForTest
      );
      return {
        issue: "Client Error (4xx)",
        severity: hasValidationWord ? "Medium" : "Medium",
        recommendation:
          "Validate request payloads against API schema; ensure correct headers and query parameters.",
      };
    }
  }

  return {
    issue: "Unknown",
    severity: "Medium",
    recommendation:
      "Capture more telemetry (request/response bodies, headers) and re-run with higher verbosity.",
  };
}

// Single endpoint probe 
async function probeEndpoint(endpoint, options, fetchImpl = global.fetch) {
  const method = (endpoint && endpoint.method) ? endpoint.method : "GET";
  const url = endpoint && endpoint.url;
  const headers = (endpoint && endpoint.headers) ? endpoint.headers : {};
  const body = endpoint && endpoint.body;
  const expectedStatus = endpoint && Object.prototype.hasOwnProperty.call(endpoint, "expectedStatus")
    ? endpoint.expectedStatus
    : undefined;

  const timeout = options && options.timeout;
  const retries = options && options.retries;
  const userAgent = options && options.userAgent;

  if (!url) {
    return {
      name: (endpoint && endpoint.name) ? endpoint.name : "(missing name)",
      method: method,
      url: url,
      ok: false,
      status: null,
      latencyMs: null,
      error: new Error("Missing URL"),
      diagnosis: diagnose({ error: new Error("Missing URL") }),
      textSnippet: null,
      expectedStatus: valueOrDefault(expectedStatus, null),
      attemptCount: 0,
      timestamp: nowISO(),
    };
  }

  let lastError = null;
  let attempt = 0;

  // Simple fixed backoff (500ms * attempt)
  while (attempt <= retries) {
    attempt++;
    const controller = new AbortController();
    const started = performance.now();

    try {
      const res = await withTimeout(
        fetchImpl(url, {
          method: method,
          signal: controller.signal,
          headers: (function () {
            const merged = { "User-Agent": userAgent };
            // Spread-like merge without syntax sugar
            if (headers) {
              Object.keys(headers).forEach(function (k) {
                merged[k] = headers[k];
              });
            }
            return merged;
          })(),
          body: (function () {
            if (body) {
              return JSON.stringify(body);
            }
            return undefined;
          })(),
        }),
        timeout,
        controller
      );

      const latencyMs = Math.round(performance.now() - started);
      const status = res.status;
      const text = await res.text();
      let textSnippet = text;
      if (text && text.length > 600) {
        textSnippet = text.slice(0, 600) + "…[truncated]";
      }

      const diag = diagnose({
        status: status,
        textSnippet: textSnippet,
        latencyMs: latencyMs,
      });

      let ok = (status >= 200 && status < 300);
      if (ok && expectedStatus !== undefined && expectedStatus !== null) {
        ok = ok && (status === expectedStatus);
      }

      return {
        name: (endpoint && endpoint.name) ? endpoint.name : url,
        method: method,
        url: url,
        ok: ok,
        status: status,
        latencyMs: latencyMs,
        error: null,
        diagnosis: diag,
        textSnippet: textSnippet,
        expectedStatus: valueOrDefault(expectedStatus, null),
        attemptCount: attempt,
        timestamp: nowISO(),
      };
    } catch (err) {
      lastError = err;
      // Backoff before retrying (unless final attempt)
      if (attempt <= retries) {
        await sleep(500 * attempt);
      }
    }
  }

  // All attempts failed
  const diag = diagnose({ error: lastError });
  return {
    name: (endpoint && endpoint.name) ? endpoint.name : "(error)",
    method: (endpoint && endpoint.method) ? endpoint.method : "GET",
    url: (endpoint && endpoint.url) ? endpoint.url : undefined,
    ok: false,
    status: null,
    latencyMs: null,
    error: lastError,
    diagnosis: diag,
    textSnippet: null,
    expectedStatus: valueOrDefault((endpoint && endpoint.expectedStatus), null),
    attemptCount: (options && options.retries) + 1,
    timestamp: nowISO(),
  };
}

// Concurrency controller (promise pool)
async function runWithConcurrency(items, limit, worker) {
  const results = [];
  let idx = 0;

  async function next() {
    if (idx >= items.length) return;
    const current = idx++;
    results[current] = await worker(items[current], current);
    return next();
  }

  const starters = Array(Math.min(limit, items.length))
    .fill(0)
    .map(function () { return next(); });
  await Promise.all(starters);
  return results;
}

// Public runner (exported for tests)
async function runDiagnostics(endpoints, options = {}, fetchImpl = global.fetch) {
  const merged = {
    concurrency: 5,
    retries: 1,
    timeout: 8000,
    userAgent: "api-diagnosis-tool/1.0",
  };

  // Shallow merge without spread
  if (options) {
    Object.keys(options).forEach(function (k) {
      merged[k] = options[k];
    });
  }

  const results = await runWithConcurrency(
    endpoints,
    merged.concurrency,
    function (ep) { return probeEndpoint(ep, merged, fetchImpl); }
  );

  return results;
}

// CLI entrypoint
async function main() {
  const args = parseArgs(process.argv);

  // Resolve paths
  const configPath = path.resolve(args.config);
  const outDir = path.resolve(args.outputDir);
  const csvPath = path.join(outDir, args.csv);
  const htmlPath = path.join(outDir, args.html);

  // Load endpoints config
  if (!fs.existsSync(configPath)) {
    console.error(`[ERROR] Config not found at ${configPath}`);
    process.exit(1);
  }
  const endpoints = JSON.parse(fs.readFileSync(configPath, "utf8"));

  // Run
  console.log(`[INFO] Probing ${endpoints.length} endpoints...`);
  const results = await runDiagnostics(endpoints, {
    concurrency: args.concurrency,
    retries: args.retries,
    timeout: args.timeout,
    userAgent: args.userAgent,
  });

  // Summarize
  const okCount = results.filter(function (r) { return r.ok; }).length;
  console.log(
    `[INFO] Completed: ${okCount}/${results.length} OK (${results.length - okCount} with issues)`
  );

  // Write reports
  const csv = toCSV(results);
  const html = toHTML(results, {
    generatedAt: nowISO(),
    title: "API Diagnosis Report",
  });

  await writeFileSafe(csvPath, csv);
  await writeFileSafe(htmlPath, html);

  console.log(`[INFO] Wrote CSV -> ${csvPath}`);
  console.log(`[INFO] Wrote HTML -> ${htmlPath}`);
}

if (require.main === module) {
  // Run as CLI
  main().catch(function (e) {
    console.error("[FATAL]", e);
    process.exit(1);
  });
}

// Exports for tests
module.exports = {
  parseArgs,
  diagnose,
  probeEndpoint,
  runDiagnostics,
};