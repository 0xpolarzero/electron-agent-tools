# SPEC — `electron-agent-tools` (Playwright, CDP connect)

> A tiny TypeScript library + CLI that lets humans or LLMs **launch and drive an Electron Forge app** using **Playwright** (via `chromium.connectOverCDP`). No MCP; no bespoke CDP wiring.

## 0) Goals & non‑goals

* **Goals**
  * Provide a **small registry of tools** (library APIs + CLI entrypoints) to launch, inspect, and drive an Electron app: click buttons, type, read DOM/HTML, capture screenshots, harvest console/network, optional test‑only IPC.
  * **Deterministic JSON I/O** for each CLI command; suitable for LLM orchestration.
  * Use **Playwright for everything** (locator engine, waits, screenshots, console/network listeners).
  * **Headless/background OK**; GUI visibility not required (use Xvfb in CI on Linux).
  * **Safety & cleanup** on failure/SIGINT; artifacts and logs collected.

* **Non‑goals**
  * Not a general test framework.
  * No MCP servers; no distributed runners.

## 1) Runtime & packaging

* **Node**: ≥ 18 (uses built‑in `fetch`), CI uses Node 20+.
* **Package type**: ESM.
* **OS**: macOS, Windows, Linux. CI targets Linux with **Xvfb**.
* **Dependencies**:
  * runtime: `"playwright"` (use chromium).
  * optional: `"tree-kill"` (or manual child cleanup).
* **Dev dependencies**: `"typescript"`, `"@types/node"`, `"@biomejs/biome"`.

## 2) Launch & connection model

* App is launched via a command (default `pnpm start:debug`), environment includes:
  * `E2E=1`, `NODE_ENV=test`, `E2E_CDP_PORT=<port>`, `ELECTRON_ENABLE_LOGGING=1`.
* App must enable CDP in **main**:

  ```ts
  import { app } from 'electron';
  if (process.env.E2E_CDP_PORT) {
    app.commandLine.appendSwitch('remote-debugging-port', process.env.E2E_CDP_PORT);
  }
  ```

* Launcher polls `http://127.0.0.1:<port>/json/version` until it sees `webSocketDebuggerUrl`, then returns it.
* Driver connects to the **browser** WS endpoint via `chromium.connectOverCDP(wsUrl)`, enumerates **targets** (type `page`), and selects the main renderer:
  * Prefer URLs starting `app://`, `file://`, or `http://localhost:`; else match `pick.titleContains`/`pick.urlIncludes`.

## 3) CLI command registry (JSON in → JSON out)

All commands print **exactly one** JSON object to stdout:

Success:

```json
{ "ok": true, "data": { ... } }
```

Failure:

```json
{ "ok": false, "error": { "message": "...", "code": "E_CODE", "details": { ... } } }
```

General options (per command): `timeoutMs` (default 10000 unless noted), `retries` (default 0), `wsUrl` when a CDP connection is needed.

### 3.1 `launch-electron`

* **Purpose**: start the app, wait for CDP, return PID and WS URL.
* **Input**

  ```json
  { "port": 9223, "cwd": ".", "env": { }, "cmd": "pnpm start:debug", "timeoutMs": 40000 }
  ```

* **Output**

  ```json
  { "pid": 12345, "port": 9223, "wsUrl": "ws://127.0.0.1:9223/devtools/browser/...", "startedAt": "ISO", "logDir": ".e2e-artifacts/1700000000" }
  ```

* **Failure codes**: `E_SPAWN`, `E_CDP_TIMEOUT`, `E_PORT_IN_USE`.

### 3.2 `browser-tools <subcommand>`

Single binary dispatching subcommands; each takes a single JSON arg.

Subcommands and inputs (implemented via Playwright `Page`):

* **`list-windows`** → `{ "wsUrl": "…" }`  
  **Output**: `{ "pages":[ { "targetId","url","title" } ] }`

* **`dom-snapshot`** → `{ "wsUrl":"…", "truncateAt": 250000 }`  
  **Output**: `{ "url","title","outerHTML" }`

* **`list-selectors`** → `{ "wsUrl":"…", "max":200 }`  
  **Output**:

  ```json
  {
    "testIds": ["open-workspace-button", "..."],
    "roles": [ { "role":"button","name":"Open workspace","selector":"button" } ],
    "texts": [ { "text":"Open workspace","selector":"button" } ]
  }
  ```

* **`wait-text`** → `{ "wsUrl":"…", "text":"Open workspace", "timeoutMs":20000 }`  
  **Output**: `{ "visible": true }` (Use `page.getByText(text).waitFor({ state: 'visible' })`.)

* **`click`** → selector schema (below)  
  **Output**: `{ "clicked": true }`

* **`type`** → selector + `{ "value":"foo", "clearFirst":true }`  
  **Output**: `{ "typed": true }`

* **`get-dom`** → selector + `{ "as":"innerHTML"|"textContent" }`  
  **Output**: `{ "value": "…" }`

* **`screenshot`** → `{ "wsUrl":"…", "path":".e2e-artifacts/page.png", "fullPage": true }`  
  **Output**: `{ "path":"…" }`

* **`console-harvest`** → `{ "wsUrl":"…" }`  
  **Output**: `{ "events":[ { "type","text","ts" } ] }`

* **`network-harvest`** → `{ "wsUrl":"…" }`  
  **Output**: `{ "failed":[urls], "errorResponses":[ { "url","status" } ] }`

* **`ipc-call`** (optional; test‑only) → `{ "wsUrl":"…", "channel":"app:quit", "args":{} }`  
  **Output**: `{ "result": any }`  
  Guards: only when `NODE_ENV=test`.

* **`quit`** → `{ "wsUrl":"…", "forceAfterMs":5000 }`  
  **Output**: `{ "exited": true, "code": 0 }`  
  Attempts IPC quit; falls back to SIGINT/kill.

### 3.3 Selector schema (used by `click`, `type`, `get-dom`)

```ts
{
  "testid"?: string,
  "role"?: { "role": string, "name"?: string },
  "text"?: string,
  "css"?: string,
  "nth"?: number,
  "timeoutMs"?: number
}
```

**Resolution order**: `data-testid` → role/name → text substring → CSS. Implement via Playwright locators:

* `testid`: `page.getByTestId(sel.testid)`
* `role`: `page.getByRole(sel.role.role, { name: sel.role.name })`
* `text`: `page.getByText(sel.text, { exact: false })`
* `css`: `page.locator(sel.css)`

Use `locator.nth(nth ?? 0)` and rely on Playwright’s visibility/auto‑wait semantics.

## 4) Library API (TypeScript)

```ts
// src/lib/types.ts
export type ConnectOptions = { wsUrl: string; pick?: { titleContains?: string; urlIncludes?: string } };

export type Selector = {
  testid?: string;
  role?: { role: string; name?: string };
  text?: string;
  css?: string;
  nth?: number;
  timeoutMs?: number;
};

export type ConsoleEvent = { type: string; text: string; ts: number };
export type NetworkHarvest = { failed: string[]; errorResponses: { url: string; status: number }[] };

export interface Driver {
  click(sel: Selector): Promise<void>;
  type(sel: Selector & { value: string; clearFirst?: boolean }): Promise<void>;
  waitText(text: string, timeoutMs?: number): Promise<void>;
  screenshot(path: string, fullPage?: boolean): Promise<void>;
  dumpOuterHTML(truncateAt?: number): Promise<string>;
  listSelectors(max?: number): Promise<{
    testIds: string[];
    roles: { role: string; name: string | null; selector: string }[];
    texts: { text: string; selector: string }[];
  }>;
  flushConsole(): Promise<ConsoleEvent[]>;
  flushNetwork(): Promise<NetworkHarvest>;
  close(): Promise<void>;
}

// src/lib/playwright-driver.ts
export async function connectAndPick(opts: ConnectOptions): Promise<Driver>;
```

### 4.1 Playwright details (mandatory)

* Use `import { chromium } from 'playwright'`.
* Connect with `chromium.connectOverCDP(wsUrl)`.
* Enumerate contexts/pages from the connected browser; pick the renderer page using `pickTarget` scoring (preferred URL prefixes and `pick` filters).
* All actions use Playwright `Page`/`Locator`:
  * `click`: `locator.click()`
  * `type`: optional `locator.fill('')` then `locator.type(value)` (or `fill`) with `clearFirst`.
  * `waitText`: `page.getByText(text).waitFor({ state: 'visible', timeout })`.
  * `screenshot`: `page.screenshot({ path, fullPage })`.
  * `dumpOuterHTML`: `page.evaluate(() => document.documentElement.outerHTML)`.
  * `listSelectors`: evaluate in page to gather data-testid / role / text hints (same shape as before).
* Console capture: `page.on('console', ...)` and `page.on('pageerror', ...)` push into an array for `flushConsole`.
* Network capture: `page.on('requestfailed', …)` and `page.on('response', …)` (status ≥ 400) to fill `NetworkHarvest`.

## 5) Optional test‑only IPC shims

Unchanged from prior spec; preload/main test shims stay the same and are gated by `NODE_ENV=test` with channel `app:quit`.

## 6) Safety, timeouts, retries, cleanup

* Every command accepts `timeoutMs`; default 10s (launch: 40s).
* Retries for click/type: default 0; on retry, re‑resolve locator.
* **Artifacts** directory: `.e2e-artifacts/<timestamp>/`. Store:
  * Electron stdout/stderr (`launch-electron`)
  * `screenshot` outputs
  * `dom-snapshot` outputs (when requested)
  * harvested `console-harvest.json`, `network-harvest.json`
* **Shutdown** policy:
  * Preferred: `ipc-call app:quit` (if enabled).
  * Else: SIGINT child; after `forceAfterMs`, SIGKILL (tree‑kill on Windows).
* **Security**: CDP bound to `127.0.0.1`; enabled only when `E2E_CDP_PORT` is present; never ship enabled in production builds.

## 7) Repo layout

```
.
├─ src/
│  ├─ cli/launch-electron.ts
│  ├─ cli/browser-tools.ts        # dispatches subcommands
│  ├─ lib/playwright-driver.ts
│  ├─ lib/types.ts
│  ├─ preload.test.ts             # optional
│  └─ main.test.ts                # optional
├─ examples/
│  ├─ smoke.mjs                   # API example
│  ├─ smoke.sh                    # CLI example (jq)
│  └─ dom-dump.mjs
├─ fixtures/mini-app/             # minimal Electron app for CI tests
│  ├─ package.json
│  ├─ main.ts
│  └─ index.html
├─ tests/
│  └─ examples.test.mjs           # runs the examples against the fixture app
├─ .github/workflows/
│  ├─ ci.yml
│  └─ release.yml
├─ biome.json
├─ tsconfig.json
├─ package.json
└─ README.md
```

## 8) Examples (shipped)

Same behaviors as before, but implemented with Playwright APIs.

## 9) Fixture app for CI

Same minimal Electron app as before; unchanged.

## 10) Tests (run examples)

Same flow: install fixture deps, run `examples/smoke.mjs`, assert `.e2e-artifacts/smoke.png` exists. Examples may accept `LAUNCH_JSON` to skip launching inside the example.

## 11) CI (lint/format/build/test) — `.github/workflows/ci.yml`

Identical structure; ensure Playwright runtime deps available (Ubuntu: `npx playwright install --with-deps chromium` or rely on bundled chromium already installed by Playwright).

## 12) Release to npm — `.github/workflows/release.yml`

Unchanged: tag `v*.*.*` triggers publish with provenance using `NPM_TOKEN`.

## 13) `package.json` (library)

Update dependencies to use Playwright:

```json
{
  "name": "electron-agent-tools",
  "version": "0.1.0",
  "description": "Playwright-based tools to launch and drive Electron apps (CLI + tiny TS API).",
  "type": "module",
  "license": "MIT",
  "engines": { "node": ">=18" },
  "exports": {
    ".": { "types": "./dist/lib/types.d.ts", "default": "./dist/index.js" },
    "./lib": { "types": "./dist/lib/types.d.ts", "default": "./dist/lib/index.js" }
  },
  "main": "dist/index.js",
  "types": "dist/lib/types.d.ts",
  "files": [ "dist", "README.md" ],
  "bin": {
    "launch-electron": "./dist/cli/launch-electron.js",
    "browser-tools": "./dist/cli/browser-tools.js"
  },
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "lint": "biome lint .",
    "format": "biome format --write .",
    "check": "biome ci . && tsc -p tsconfig.json --noEmit",
    "test": "node --test tests/*.test.mjs"
  },
  "dependencies": {
    "playwright": "^<latest version>"
  },
  "devDependencies": {
    "@biomejs/biome": "^<latest version>",
    "@types/node": "^<latest version>",
    "typescript": "^<latest version>",
    "electron": "^<latest version>" // only for the fixture app in CI
  }
}
```

## 14) `tsconfig.json`

Unchanged unless Playwright types need additional libs (DOM already included).

## 15) `biome.json`

Unchanged.

## 16) README (short, human‑oriented)

Update language to say **Playwright-based** tooling; note that the automation connects with `chromium.connectOverCDP`.

## 17) Error codes (normative)

* `E_SPAWN`: failed to launch command.
* `E_CDP_TIMEOUT`: `/json/version` never exposed a WS URL within timeout.
* `E_NO_PAGE`: no renderer page target matched.
* `E_SELECTOR`: selector not found or not visible.
* `E_WAIT_TIMEOUT`: condition not met in time.
* `E_FS`: filesystem write failure.
* `E_IPC_GUARD`: IPC call attempted outside `NODE_ENV=test`.
* `E_INTERNAL`: unexpected error.
