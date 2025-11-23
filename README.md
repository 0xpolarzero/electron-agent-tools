# electron-agent-tools

Playwright-powered CLI and TypeScript helpers to launch, attach to, and drive Electron apps over CDP. Built for scripting, CI, and LLM agents with JSON-in/JSON-out commands.

## What it does
- `browser-tools <subcmd>`: JSON-only CLI to click, type, wait, screenshot, dump DOM, and stream logs.
- `launch-electron start|quit`: spawn an Electron app with CDP enabled and collect artifacts.
- Tiny API: `connectAndPick(opts)` and `getWsUrl({ port })` wrap `chromium.connectOverCDP` and target selection.
- Unified logs: every run writes `.e2e-artifacts/<prefix>/run.log` containing stdout/stderr, renderer/preload/main console, IPC, network, and lifecycle lines.

## Quickstart
1) Install: `pnpm add -D electron-agent-tools`

### Using the CLI
2) Launch your app with CDP exposed:
```bash
E2E_CDP_PORT=9333 pnpm exec electron path/to/main.js &
```
3) Discover the debugger URL, then drive the app:
```bash
WS_URL=$(node -e "import { getWsUrl } from 'electron-agent-tools'; (async()=>console.log(await getWsUrl({ port: 9333 })))();")
npx browser-tools wait-text '{"wsUrl":"'"$WS_URL"'","text":"Open workspace"}'
npx browser-tools click '{"wsUrl":"'"$WS_URL"'","testid":"open-workspace-button"}'
npx browser-tools screenshot '{"wsUrl":"'"$WS_URL"'","path":".e2e-artifacts/smoke.png"}'
```
Artifacts land in `.e2e-artifacts/<timestamp>` with a `last-run` symlink for convenience.

### Using TypeScript
```ts
import { launchElectron, connectAndPick } from 'electron-agent-tools'

// Launch the app and get a ready-to-use CDP endpoint
const { wsUrl, quit } = await launchElectron({
  command: 'pnpm',
  args: ['exec', 'electron', 'fixtures/main.js'],
  headless: true,
})

// Drive it with Playwright under the hood
const driver = await connectAndPick({ wsUrl })
await driver.click({ testid: 'open-workspace-button' })
await driver.waitText('Open workspace')

// Clean shutdown (also kills the spawned Electron)
await quit()
```

Check `examples/` for a ready-to-run smoke test against the bundled fixture app.

## Debugging helpers
- **Unified run.log**: each run emits `[ISO] [source] [level] message` lines across stdout/stderr, console (renderer/preload/main/isolated), IPC traces, network failures, screenshots, and DOM dumps.
- **World-aware eval**: `driver.evalInPreload`, `evalInRendererMainWorld`, `evalInIsolatedWorld` let you probe exactly where globals live.
- **Lifecycle hooks**: `onRendererReload` / `onPreloadReady` plus `waitForBridge()` for contextIsolation + Vite reloads.
- **Deterministic injection**: `injectGlobals(obj, { persist: true })` replays helpers into renderer + preload on every navigation.
- **State snapshots**: `snapshotGlobals(['foo','bar'])`, `dumpDOM(selector?)`, and `waitForTextAcrossReloads` help debug flaky UIs.
- **DevTools in headless**: `getRendererInspectorUrl()` builds a `devtools://…` link for the current renderer target.

## Development
- `pnpm install`
- `pnpm build`
- `pnpm check`  # biome + typecheck
- `pnpm test`   # runs the examples against the fixture app (headless in CI)

## License
MIT
