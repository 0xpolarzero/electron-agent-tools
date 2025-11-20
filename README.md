# electron-agent-tools

MCP‑free scripts + a tiny TypeScript API that let humans (and LLMs) **launch and drive your Electron Forge app** over the
**Chrome DevTools Protocol (CDP)**—no Playwright, no Spectron.

- **CLI**: single‑purpose commands with deterministic JSON in/out
- **API**: minimal driver built on raw CDP (`chrome-remote-interface`)
- **Selectors**: `data-testid` → role/text → CSS
- Optional **test‑only IPC probes** (`NODE_ENV=test`)

## Install

```bash
pnpm add -D electron-agent-tools
# (the package includes chrome-remote-interface)
