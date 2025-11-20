You are to implement a TypeScript library + CLI named **electron-agent-tools** exactly per the SPEC below.
**MANDATORY**: Use **Playwright** (prefer `chromium.connectOverCDP`) for all browser automation. DO NOT use MCP or bespoke CDP plumbing.

Refer to docs/specs.md for the full specification.

=== SPEC SUMMARY (authoritative) ===
- Node >=18, ESM package. Dependencies: Playwright.
- Provide:
  1) CLI: `launch-electron` and `browser-tools <subcmd>`.
  2) Library API: `connectAndPick(opts)` returns a Driver thinly wrapping **Playwright Page** with methods:
     click, type, waitText, screenshot, dumpOuterHTML, listSelectors, flushConsole, flushNetwork, close.
  3) Selector strategy: prefer Playwright locators (data-testid -> role/name -> text -> CSS). Visibility handling left to Playwright.
  4) Launch: spawn configurable command (default `pnpm start:debug`), env: E2E=1, NODE_ENV=test, E2E_CDP_PORT, ELECTRON_ENABLE_LOGGING=1.
     Poll http://127.0.0.1:<port>/json/version for `webSocketDebuggerUrl`. Output JSON {ok:true,data:{pid,port,wsUrl,startedAt,logDir}}.
  5) Each CLI subcommand consumes one JSON arg and prints EXACTLY one JSON result (success or error).
  6) Driver connects with `chromium.connectOverCDP(wsUrl)` and uses Playwright APIs for all actions and harvesting.
  7) Artifacts directory `.e2e-artifacts/<timestamp>/` for logs/screenshots/etc created by commands as appropriate.
  8) Optional test-only IPC preload/main guarded by NODE_ENV=test with channel `app:quit`.
  9) Include examples in /examples: smoke.mjs, smoke.sh, dom-dump.mjs (as described in the SPEC).
 10) Include a working **fixture Electron app** under /fixtures/mini-app that renders `Open workspace` + button with data-testid
      `open-workspace-button` which, when clicked, changes the H1 to `Select a folder`. Its script `start:debug` must run Electron.
 11) Provide tests under /tests that run the examples against the fixture (Node built-in test runner). 
      The tests must: install fixture deps, run smoke.mjs (or CLI flow), then assert `.e2e-artifacts/smoke.png` exists.
 12) CI workflow `.github/workflows/ci.yml`: pnpm install, Biome lint/format check, TypeScript build, and run tests under Xvfb on Linux.
 13) Release workflow `.github/workflows/release.yml`: on tag `v*.*.*`, build and `npm publish --provenance --access public` 
      using `NPM_TOKEN` secret.
 14) Provide `package.json`, `tsconfig.json`, `biome.json`, and README.md (short setup + examples). 
      `package.json` must expose bins and the library API via `exports`, and include scripts:
      - build, lint, format, check, test (node --test).
 15) Error codes: E_SPAWN, E_CDP_TIMEOUT, E_NO_PAGE, E_SELECTOR, E_WAIT_TIMEOUT, E_FS, E_IPC_GUARD, E_INTERNAL. 
      Surface them in the CLI JSON error output.

=== IMPLEMENTATION GUIDELINES ===
- Keep functions small; add concise comments and JSDoc/TSDoc on public APIs.
- All CLIs must read a single JSON arg (from argv[1]) and print a single JSON line to stdout, nothing else.
- Use Node's built-in fetch for /json/version polling.
- Connect with `chromium.connectOverCDP` and pick the main renderer page; use Playwright `Page` methods for clicks, typing, waits, screenshots, console/network listeners, etc.
