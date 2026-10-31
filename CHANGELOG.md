## 0.1.1 — Automatic runtime setup

- Auto-detect a missing control socket on opening the plugin, and start installation through Ervisio administrator unlock (no manual shell).
- Run installation as a persistent transient systemd unit with in-page progress, status, diagnostic logs, and one-click repair.
- Install an isolated Node.js 22 where the host has no suitable Node, plus Playwright/Chromium and APT OS libraries.
- Preserve recorded workflows and browser data on repair.

# Changelog

## 0.1.0

- First community marketplace alpha of Browser Robots: a remote Chromium browser with recorded and replayable workflows.
- Include the companion Playwright runtime and preserve secret placeholders in recorded workflows.
- Package the documented plugin directory. Author: Ervisio Community.
