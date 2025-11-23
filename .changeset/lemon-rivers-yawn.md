---
"electron-agent-tools": patch
---

- stream all runtime signals into per-run `run.log` and remove harvest/flush APIs
- drop console/ipc/network harvest/DOM snapshot CLI commands; keep screenshot/dom-dump artifacts in run dir
- expose runLogPath from launch, reuse last-run artifacts, and update docs/tests to match the new logging model
