---
"electron-agent-tools": patch
---

Auto-inject an EPIPE guard into spawned Electron/Node processes via NODE_OPTIONS and keep the guard idempotent so consumers no longer need local pipe hacks, while keeping CLI runs able to exit cleanly.
