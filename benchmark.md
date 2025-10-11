# Benchmark Results

## Setup
- Node.js v18+, run with:

node src/main.js –config config/test_endpoints.json –concurrency 5 –retries 1 –timeout 8000

- Endpoints: GitHub 200, httpbin 400, httpbin 500, httpbin delay/2, DNS failure

## Manual Baseline
- curl per endpoint, stopwatch timing
- Total: ~13s (avg ~2.6s per endpoint)

## Automated Run
- 6 runs, avg time: ~5.0s (min–max 5–5s)
- Success rate: 2/5 (40%)
- Avg latency: ~2461 ms, P95: ~5631 ms
- Issues: 400 (1), 500 (1), DNS (1), Slow (1)
- Severity: 1 Low, 2 Medium, 2 High

## Result
- Runtime reduced: 13s → 5s (~62% faster)
- Tool scales with concurrency; manual grows linearly
- Exports CSV/HTML with diagnoses, severity, latency