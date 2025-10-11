"use strict";

const fs = require("fs");
const path = require("path");

/**
 * Convert results array to CSV
 */
function toCSV(results) {
  const header = [
    "timestamp",
    "name",
    "method",
    "url",
    "status",
    "ok",
    "latency_ms",
    "issue",
    "severity",
    "expected_status",
    "attempts",
    "error_message",
    "response_snippet",
  ];

  function safe(value) {
    // Convert undefined/null to empty string, stringify everything else.
    let s = "";
    if (value !== undefined && value !== null) {
      s = String(value);
    }
    // Escape quotes for CSV and normalize newlines (avoid regex with ? for clarity)
    s = s.replace(/"/g, '""');
    s = s.replace(/\r\n/g, " ");
    s = s.replace(/\n/g, " ");
    return s;
  }

  const rows = results.map(function (r) {
    // Derive fields safely without optional chaining or ternaries.

    // diagnosis.issue
    let issue = "";
    if (r && r.diagnosis && r.diagnosis.issue) {
      issue = r.diagnosis.issue;
    }

    // diagnosis.severity
    let severity = "";
    if (r && r.diagnosis && r.diagnosis.severity) {
      severity = r.diagnosis.severity;
    }

    // expectedStatus with empty-string default for null/undefined
    let expectedStatus = "";
    if (r && r.expectedStatus !== undefined && r.expectedStatus !== null) {
      expectedStatus = r.expectedStatus;
    }

    // error.message if present
    let errorMessage = "";
    if (r && r.error && r.error.message) {
      errorMessage = r.error.message;
    }

    // response snippet (truncate to 200 chars if present)
    let snippet = "";
    if (r && r.textSnippet) {
      snippet = String(r.textSnippet);
      if (snippet.length > 200) {
        snippet = snippet.slice(0, 200);
      }
    }

    // Build the row (quote every field for simplicity/robustness)
    const fields = [
      r && r.timestamp,
      r && r.name,
      r && r.method,
      r && r.url,
      r && r.status,
      r && r.ok,
      r && r.latencyMs,
      issue,
      severity,
      expectedStatus,
      r && r.attemptCount,
      errorMessage,
      snippet,
    ];

    return fields.map(function (x) {
      return '"' + safe(x) + '"';
    }).join(",");
  });

  return [header.join(","), ...rows].join("\n");
}

/**
 * Convert results array to a minimal standalone HTML report.
 * Beginner-friendly style (no optional chaining, no ??, no ternaries).
 */
function toHTML(results, options) {
  // Defaults for options
  let generatedAt = "";
  let title = "Report";
  if (options) {
    if (options.generatedAt !== undefined && options.generatedAt !== null) {
      generatedAt = options.generatedAt;
    }
    if (options.title !== undefined && options.title !== null) {
      title = options.title;
    }
  }

  function esc(s) {
    let str = "";
    if (s !== undefined && s !== null) {
      str = String(s);
    }
    str = str.replace(/&/g, "&amp;");
    str = str.replace(/</g, "&lt;");
    str = str.replace(/>/g, "&gt;");
    return str;
  }

  function row(r) {
    // Determine CSS class based on ok/severity (no ternaries)
    let cls = "sev-med";
    if (r && r.ok) {
      cls = "ok";
    } else if (r && r.diagnosis && r.diagnosis.severity === "High") {
      cls = "sev-high";
    }

    // Safe field access without optional chaining / nullish coalescing
    let ts = r && r.timestamp ? r.timestamp : "";
    let name = r && r.name ? r.name : "";
    let method = r && r.method ? r.method : "";
    let url = r && r.url ? r.url : "";
    let status = (r && r.status !== undefined && r.status !== null) ? r.status : "";
    let okText = (r && r.ok) ? "✅" : "❌";
    let latency = (r && r.latencyMs !== undefined && r.latencyMs !== null) ? r.latencyMs : "";
    let issue = (r && r.diagnosis && r.diagnosis.issue) ? r.diagnosis.issue : "";
    let severity = (r && r.diagnosis && r.diagnosis.severity) ? r.diagnosis.severity : "";
    let expected = (r && r.expectedStatus !== undefined && r.expectedStatus !== null) ? r.expectedStatus : "";
    let attempts = (r && r.attemptCount !== undefined && r.attemptCount !== null) ? r.attemptCount : "";
    let err = (r && r.error && r.error.message) ? r.error.message : "";
    let snippet = (r && r.textSnippet) ? r.textSnippet : "";

    return (
      '<tr class="' + esc(cls) + '">' +
      "<td>" + esc(ts) + "</td>" +
      "<td>" + esc(name) + "</td>" +
      "<td>" + esc(method) + "</td>" +
      '<td class="url"><a href="' + esc(url) + '" target="_blank" rel="noreferrer">' + esc(url) + "</a></td>" +
      "<td>" + esc(status) + "</td>" +
      "<td>" + esc(okText) + "</td>" +
      "<td>" + esc(latency) + "</td>" +
      "<td>" + esc(issue) + "</td>" +
      "<td>" + esc(severity) + "</td>" +
      "<td>" + esc(expected) + "</td>" +
      "<td>" + esc(attempts) + "</td>" +
      "<td>" + esc(err) + "</td>" +
      "<td><pre>" + esc(snippet) + "</pre></td>" +
      "</tr>"
    );
  }

  // Build HTML
  const rowsHtml = results.map(row).join("\n");

  return (
'<!doctype html>\n' +
'<html lang="en">\n' +
'<head>\n' +
'<meta charset="utf-8"/>\n' +
"<title>" + esc(title) + "</title>\n" +
'<meta name="viewport" content="width=device-width, initial-scale=1"/>\n' +
"<style>\n" +
"  :root {\n" +
"    --bg: #0b1020;\n" +
"    --card: #121a2e;\n" +
"    --text: #e8eefc;\n" +
"    --muted: #aab7d4;\n" +
"    --ok: #153a2a;\n" +
"    --med: #3b2a10;\n" +
"    --high: #3a1216;\n" +
"    --border: #2a3556;\n" +
"    --accent: #6aa6ff;\n" +
"  }\n" +
"  body {\n" +
"    margin: 0; padding: 24px; font-family: system-ui, -apple-system, Segoe UI, Roboto, sans-serif;\n" +
"    background: var(--bg); color: var(--text);\n" +
"  }\n" +
"  h1 { margin: 0 0 6px 0; font-weight: 700; }\n" +
"  .meta { color: var(--muted); margin-bottom: 16px; }\n" +
"  table { width: 100%; border-collapse: collapse; background: var(--card); border-radius: 12px; overflow: hidden; }\n" +
"  th, td { padding: 10px 12px; border-bottom: 1px solid var(--border); vertical-align: top; font-size: 14px; }\n" +
"  th { text-align: left; color: var(--accent); background: #0d152a; position: sticky; top: 0; z-index: 1; }\n" +
"  tr.ok { background: rgba(21, 58, 42, 0.35); }\n" +
"  tr.sev-med { background: rgba(59, 42, 16, 0.35); }\n" +
"  tr.sev-high { background: rgba(58, 18, 22, 0.45); }\n" +
"  .url a { color: #cfe1ff; text-decoration: none; }\n" +
"  .url a:hover { text-decoration: underline; }\n" +
"  pre { margin: 0; max-height: 120px; overflow: auto; white-space: pre-wrap; }\n" +
"  .legend { margin: 12px 0 18px; font-size: 13px; color: var(--muted); }\n" +
"  .legend span { padding: 4px 8px; border-radius: 8px; margin-right: 8px; }\n" +
"  .tag-ok { background: var(--ok); color: #cfeee0; }\n" +
"  .tag-med { background: var(--med); color: #f6e6c9; }\n" +
"  .tag-high { background: var(--high); color: #ffd6dc; }\n" +
"</style>\n" +
"</head>\n" +
"<body>\n" +
"  <h1>" + esc(title) + "</h1>\n" +
"  <div class=\"meta\">Generated at " + esc(generatedAt) + "</div>\n" +
"  <div class=\"legend\">\n" +
"    <span class=\"tag-ok\">OK</span>\n" +
"    <span class=\"tag-med\">Medium Severity</span>\n" +
"    <span class=\"tag-high\">High Severity</span>\n" +
"  </div>\n" +
"  <table>\n" +
"    <thead>\n" +
"      <tr>\n" +
"        <th>Timestamp</th>\n" +
"        <th>Name</th>\n" +
"        <th>Method</th>\n" +
"        <th>URL</th>\n" +
"        <th>Status</th>\n" +
"        <th>OK</th>\n" +
"        <th>Latency (ms)</th>\n" +
"        <th>Issue</th>\n" +
"        <th>Severity</th>\n" +
"        <th>Expected</th>\n" +
"        <th>Attempts</th>\n" +
"        <th>Error</th>\n" +
"        <th>Response Snippet</th>\n" +
"      </tr>\n" +
"    </thead>\n" +
"    <tbody>\n" +
rowsHtml +
"\n    </tbody>\n" +
"  </table>\n" +
"</body>\n" +
"</html>"
  );
}

/**
 * Write a file, creating parent directories if missing.
 */
async function writeFileSafe(targetPath, content) {
  const dir = path.dirname(targetPath);
  await fs.promises.mkdir(dir, { recursive: true });
  await fs.promises.writeFile(targetPath, content, "utf8");
}

module.exports = {
  toCSV,
  toHTML,
  writeFileSafe,
};