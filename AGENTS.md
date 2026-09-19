# Repository Guidelines

> For complete repository-specific conventions, read and follow `CLAUDE.md`.
> When this file and `CLAUDE.md` differ, `CLAUDE.md` takes precedence.

## Project Overview

Termspace is a Linux/macOS Electron terminal workspace: terminal panes occupy a horizontal canvas wider than the viewport. Columns have fixed pixel widths; panes in a column use height ratios. The layout is persisted as YAML session files.

The stack is Node.js >=22, npm with committed lockfile v3, Electron/electron-vite, strict TypeScript, Vitest + happy-dom, xterm.js, and node-pty. `npm install` runs `electron-rebuild` for node-pty and requires `python3`, `make`, and `g++` to build its native component.

Read `README.md` first for user-facing behavior, session YAML, keyboard shortcuts, and sandbox notes.

## Architecture & Data Flow

- `src/main/` owns Node/Electron capabilities: PTYs, filesystem and session YAML, settings, native window lifecycle, shell integration, updater, and IPC handlers.
- `src/preload/index.ts` exposes one typed `contextBridge` API. It contains no application logic because it shares a page with arbitrary terminal output.
- `src/renderer/` is sandboxed and owns DOM/xterm UI, canvas views, and session runtime coordination.
- `src/shared/` contains process-neutral protocol types and pure data/helpers; it must not depend on Electron or the DOM.

For an API change, follow the full path: `src/shared/protocol.ts` → `src/preload/index.ts` → `src/main/ipc-bridge.ts` handler → `src/renderer/api.ts` and renderer caller. Keep IPC explicit: invoke/handle for requests and send/on for signals; preload listeners return unsubscribe functions.

PTY output flows from `pty-host` through `OutputBatcher`, IPC, preload subscriptions, then `SessionRuntime` into xterm. Saving flows from a renderer `LayoutSnapshot` to main, where live PTY state enriches it before YAML persistence and schema handling.

## Key Directories

- `src/main/` — Electron/Node implementation and persistence boundaries.
- `src/preload/` — typed renderer-to-main bridge only.
- `src/renderer/` — canvas, panes, chrome views, xterm integration, self-check.
- `src/shared/` — protocol, UI catalogs, bindings, settings defaults, themes, pure helpers.
- `src/renderer/styles/` — design tokens and app CSS; design values belong in `tokens.css`.
- `scripts/` — local install, icon generation, and live-app verification tooling.
- `docs/` — session format, engineering notes, and manual QA coverage.

## Development Commands

```bash
npm run dev
ELECTRON_DISABLE_SANDBOX=1 npm run dev  # Ubuntu/AppArmor sandbox workaround
npm run build
npm run preview
npm test
npm run test:watch
npm run typecheck
npm run verify:app
npm run verify:app -- core motion
npm run verify:app -- --serial
npx vitest run src/renderer/keymap.test.ts
npx vitest run -t 'Alt+U I O P'
npm run icons
npm run dist
npm run dist:mac
npm run install:local
```

`install:local` installs the artifact matching `package.json`'s version. Generated `out/` and `release/` content is ignored; do not edit it.

## Code Conventions & Common Patterns

- Preserve the process boundary: `tsconfig.renderer.json` intentionally has no Node types. Node/Electron work belongs in main; renderer capabilities go through the typed preload API.
- Keep main, preload, and renderer entry points wired through `electron.vite.config.ts`. Production CSP is intentionally tight. Keep node-pty unpacked in electron-builder configuration.
- Model layout through immutable pure functions in `layout-model.ts`; geometry and pixel calculations belong in `layout-geometry.ts`; DOM/session coordination belongs in `session-runtime.ts`.
- Column widths are absolute pixels; pane heights are ratios. Canvas scrolling uses a transform, not browser overflow. Preserve these product invariants.
- `--gap` and `--edge` in `src/renderer/styles/tokens.css` mirror layout constants. Update both sides together. Use design tokens through `var()`; do not add scattered visual literals.
- Handle malformed session entries and PTY spawn failures in the affected pane/error card rather than failing an entire session. PTY spawn returns `{ ok, message }`.
- Runtime teardown must unsubscribe IPC listeners, clear timers/observers, dispose terminals/views, and kill associated PTYs.
- UI chrome copy belongs in `src/shared/ui-strings.ts` in both English and Korean; do not hard-code chrome text at call sites.
- Branch platform differences inline. Keep Linux and macOS binding tables paired with equivalent action/chord positions. Route config/data paths through the shared helper; maintain both bash and zsh shell hooks.
- Use English comments that explain *why*, not merely what. Prefer existing patterns and colocated pure logic over new abstractions.

## Important Files

- `README.md` — product behavior, sessions, keybindings, development orientation.
- `CONTRIBUTING.md` — contributor workflow.
- `package.json`, `package-lock.json` — scripts, runtime/tool versions, lockfile.
- `electron.vite.config.ts` — main/preload/renderer entry points and CSP transform.
- `tsconfig.main.json`, `tsconfig.renderer.json` — strict compiler and process boundaries.
- `vitest.config.ts` — Node and happy-dom test projects.
- `electron-builder.yml` — packaging, including node-pty handling.
- `src/main/index.ts` — application lifecycle and startup/shutdown.
- `src/main/ipc-bridge.ts` — IPC allowlists and handler registration.
- `src/main/pty-host.ts` — native PTY lifecycle.
- `src/main/session-config.ts`, `src/main/session-schema.ts` — YAML file handling and validation.
- `src/preload/index.ts` — exposed bridge implementation.
- `src/shared/protocol.ts` — authoritative cross-process contract.
- `src/shared/ui-strings.ts` — localized UI catalog.
- `src/renderer/main.ts` — renderer bootstrap and application composition.
- `src/renderer/session-runtime.ts` — live session/pane coordination and teardown.
- `src/renderer/layout-model.ts`, `src/renderer/layout-geometry.ts` — pure layout state and geometry.
- `src/renderer/canvas-view.ts` — canvas rendering and transform scrolling.
- `src/renderer/styles/tokens.css` — visual design tokens.
- `scripts/verify-app.mjs`, `docs/MANUAL-QA.md` — live-app check runner and coverage guidance.

## Runtime/Tooling Preferences

Use npm and the committed lockfile. Electron-Vite builds main, preload, and renderer separately. Keep Electron security settings and the production CSP intact.

Use the repository tools and narrow, targeted checks. Do not edit generated build/package output. CI uses `npm ci`, typechecking, tests, and a macOS serial self-check. Release tags must match the package version.

## Testing & QA

Place pure-logic tests beside the module as `*.test.ts`; place DOM tests as `*.dom.test.ts`. Vitest runs those in separate Node and happy-dom projects.

Before completing code changes, run the applicable checks; for visible or main-process work, run:

```bash
npm test
npm run typecheck
npm run verify:app
```

The live-app self-check is gated by `import.meta.env.VITE_SELFCHECK` with dot syntax. It should measure pixels/computed styles, wait for conditions rather than fixed sleeps, and report unmeasurable focus/occlusion states as skipped rather than failures. Keep self-check groups independent and clean up state they create.
