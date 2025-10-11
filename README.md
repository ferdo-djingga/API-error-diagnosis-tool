# API Error Diagnosis & Monitoring Tool

A lightweight Node.js CLI that **probes API endpoints**, **diagnoses common failures** (timeouts, DNS, 4xx/5xx, rate limits), and **exports CSV + HTML** reports you can hand to a manager or attach in a ticket.

---

## Features

- **Config-driven**: define endpoints in `config/test_endpoints.json`
- **Retries + timeouts** per request (AbortController)
- **Concurrent** probing (tunable pool size)
- **Diagnosis engine** for common patterns with actionable recommendations
- **CSV & HTML** outputs (drop-in for Excel/Jira/Confluence)
- **Unit tests** (Jest) with mocked `fetch` (no network needed)

---

## Project Structure
API-Error-Diagnosis-and-Monitoring-Tool/
  ├─ src/
  │   ├─ main.js           # CLI in Node.js
  │   └─ reporters.js      # formats output
  ├─ config/
  │   └─ test_endpoints.json  # fake API URLs
  ├─ data/
  │   └─ sample_responses.json
  ├─ output/
  │   ├─ report.csv
  │   └─ report.html
  ├─ tests/
  │   └─ test_endpoints.test.js
  ├─ README.md
  └─ benchmark.md
___

## Project Instructions

### 1) Requirements

- **Node.js 18+** (uses built-in `fetch`)

### 2) Install (project local), Run the tool, and tests

```bash
npm init -y
npm install --save-dev jest

node src/main.js --config config/test_endpoints.json --concurrency 5 --retries 1 --timeout 8000

npm test