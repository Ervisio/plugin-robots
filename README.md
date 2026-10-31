# Browser Robots for Ervisio — alpha 0.1.1

A **real remote Chromium browser inside Ervisio** (not an iframe that sites can block). Open a browser session, navigate pages, click directly on a live screenshot, type into fields, scroll, use basic keyboard keys, save screenshots, and record/replay workflows using Playwright.

## Features

- Headless Chromium launched on the Ervisio server; its viewport appears **inside the plugin page** as regularly refreshed JPEG frames (~1 FPS). Click coordinates, typed text and keyboard shortcuts are forwarded back to Chromium.
- Multiple isolated contexts (up to four); navigation, back/forward/reload, screenshots.
- Record browser navigation, clicks, typing, scrolling and basic keystrokes into named workflows. Selectors are captured for more reliable click replay; coordinate fallback is available.
- Play workflows on the current browser. Replay uses the saved starting URL, sequential actions and reports success or failure.
- Input into a password field, or text explicitly marked **Secret**, is recorded as `{{PASSWORD}}` (or another chosen key) instead of a cleartext value. Secret values are entered when running a workflow, not stored in its JSON file.
- Workflows are stored on the server, surviving UI/runtime restarts. Active browser sessions do not survive runtime restarts.

## Installation (Linux)

1. Install Browser Robots from the Ervisio marketplace (signed plugin), then open the plugin page.
2. The page checks the Unix socket and **automatically starts the setup** when the runtime is absent. Approve Ervisio's administrator unlock once. No SSH or manual commands are needed.
3. Setup installs an isolated Node.js 22 runtime if necessary (x86_64/aarch64), Playwright, Chromium, and browser dependencies (automatically through apt on Debian/Ubuntu), then creates/enables/starts `ervisio-browser-robots.service`.
4. Setup is run in a transient systemd unit; it continues even if you close the UI. The plugin shows its state and provides **Show logs** and **Install / Repair** controls. Recorded workflows are preserved on repair.

This automatic setup currently expects marketplace installation in `/var/lib/ervisio/plugins/robots`. Developer-mode plugins loaded from arbitrary external paths must be installed/copied to this standard location, or the setup action will explain the missing path. Non-APT Linux distributions may need additional OS libraries for Chromium; inspect the installation log if browser launch fails.

The plugin declares a small set of allowlisted control commands. Only the installation/repair and diagnostic-log actions request administrator rights. Service status checks do not.

## Architecture

```text
Ervisio plugin frame (React via sdk.react)
   └── sdk.api.http("robots") [manifest path/method allowlist, admin]
        └── /run/ervisio-browser-robots/control.sock
             └── Node.js service (unprivileged ervisio-browser)
                  ├── Playwright → Chromium contexts
                  ├── JPEG screenshots, mouse and keyboard events
                  └── /var/lib/ervisio-browser-robots/workflows.json
```

## Limitations and security

- The displayed browser is **screenshot-based**; it is not full video streaming or an iframe. Typical business workflows are possible, but video, complex drag-and-drop, file uploads, browser extension installs and rich text editing are not supported yet. Keyboard handling is intentionally limited; browser screenshots are updated approximately once a second.
- Playwright runs **on the server**, not on the user's desktop: sites see the server's network location. This plugin does not access cookies or tabs from the user's personal browser. Authentication must be performed in the remote browser session.
- For security, this is an **admin-only plugin**. A browser can reach websites and services reachable from the server, including internal services. Use only websites/accounts that you own or are authorized to automate.
- Passwords in workflows are placeholders, but live authentication cookies and browser memory are held by Chromium until the session is closed. The app never persists a Chromium profile. Restrict admin access and avoid entering important personal credentials on shared servers.
- No stealth, anti-bot bypass, captcha solving, background schedules or distributed fleet support. Site-specific JavaScript automation may require a future advanced editor.
- Current UI is Italian-first (with the underlying Ervisio UI still respecting the selected theme); additional localization is planned.

## Development / tests

The plugin is a self-contained ES module (`plugin/index.js`). The runtime is Node CommonJS and loads `playwright` only when the first session is created, so its API and workflow tests can run without downloading Chromium. Run `node --test tests/*.test.cjs` and `node --check plugin/index.js`.

## Publishing

Package `plugin/` into a top-level directory named `robots/` in a release archive; update `manifest.json` and request review/signing in the Ervisio registry. The ZIP here is for developer mode, **not marketplace-signed**.
