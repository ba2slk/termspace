# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

Read `README.md` first — it covers what Termspace is, the session YAML format, keybindings
and the sandbox situation. This file covers what the README does not: how to work in the
code.

## Commands

```bash
npm run dev                         # run from source; renderer console goes to the terminal
npm test                            # unit tests (vitest)
npm run typecheck                   # main and renderer tsconfigs, separately
npm run verify:app                  # drive the real app and check it (see below)
npm run icons                       # build/icon.svg -> the PNGs the packager reads
npm run dist                        # AppImage into release/
npm run install:local               # install that AppImage into ~/Applications
```

One test file, or one case:

```bash
npx vitest run src/renderer/keymap.test.ts
npx vitest run -t 'Alt+U I O P'
npm run test:watch
```

The self-check runs four independent groups in parallel windows (~30s; `--serial` is ~70s):

```bash
npm run verify:app                  # core, chrome, motion, sessions — all at once
npm run verify:app -- core motion   # only these
npm run verify:app -- --serial      # one window, everything in order
```

`ELECTRON_DISABLE_SANDBOX=1` is needed for `npm run dev` where AppArmor blocks
unprivileged user namespaces; `verify:app` sets it itself.

## Architecture

Electron, three processes, one bridge.

- **`src/main`** — pty lifecycle, session and settings files, window. The only side with
  Node.
- **`src/preload`** — the entire renderer↔main surface, as one `api` object. No logic:
  it shares a page with arbitrary program output.
- **`src/renderer`** — the canvas, panes, chrome. Sandboxed.
- **`src/shared`** — types and pure data both sides import.

**The security boundary is enforced by the type checker.** `tsconfig.renderer.json` has no
`node` types, so importing `fs` in the renderer fails `npm run typecheck`. IPC channels are
allowlisted in `src/main/ipc-bridge.ts`.

### The canvas

Columns have **absolute pixel widths** on a canvas wider than the viewport; panes inside a
column have height *ratios* summing to 1. Narrowing the window lengthens the scroll range
rather than shrinking anything — this is the product's central property, so treat width as
absolute everywhere.

Scrolling is a `transform` on `.canvas-track`, not browser overflow. Canvas coordinates
start at the canvas's left edge, independent of scroll. Insets live in
`src/renderer/layout-geometry.ts` (`CANVAS_EDGE`, `CANVAS_BOTTOM`) and are mirrored by the
`--edge` token; change both together.

`desiredY` on the layout keeps ←→ focus moves reversible: without it, moving right then
left lands on a different pane.

### Pure modules, and everything else

Anything that can be decided without the DOM, Node or Electron lives in a module with a
`.test.ts` beside it — 36 test files today, spread over `src/renderer` (`layout-model`,
`layout-geometry`, `keymap`, `renderer-budget`, `wheel-physics`, `overview-model`,
`session-ring`, …), `src/main` (`session-schema`, `session-writer`, `pane-command`, `terminal-signals`,
`session-config`, `shell-integration`, …) and `src/shared` (`keybindings`, `ui-strings`,
`terminal-themes`, …). Six `*.dom.test.ts` files additionally exercise view modules under
happy-dom. New logic belongs beside one of these unless it genuinely needs a live surface.
That split is what keeps `npm test` around two seconds.

`renderer-budget` decides which panes hold a WebGL renderer and which freeze off screen;
the focused pane never freezes. `wheel-physics` is shared by the canvas and the terminal so
both directions feel the same.

### Sessions

One YAML file per session under `~/.config/termspace/sessions/`. **The app reads user files
and does not write them back** — splitting or resizing at runtime never touches the file.
The exceptions are the explicit saves: "save as" asks before overwriting a name that
exists, and the title-bar save rewrites the current session's own file, keeping the
previous version as `<id>.yaml.bak`.

A session's *id* is its file name; its *name* is the YAML `name:` field. They can differ.

### The self-check (`src/renderer/self-check/`)

The renderer drives its own UI and reports. It exists because pty spawning, key handling,
inertia and off-screen freezing cannot be seen from a unit test. When adding a check:

- **Measure pixels and computed styles, not class names.** Several real bugs passed every
  DOM query and only showed up in a `getBoundingClientRect()`.
- **Wait for a condition (`waitFor`), never a fixed sleep.** Four app instances share a
  machine; a pane split spawns a shell and can outlast any duration picked while idle.
- **Distinguish "broken" from "unmeasurable".** A window without focus cannot read the
  clipboard and an occluded one produces no frames. Report `skipped`, not `FAIL` — a check
  that cries wolf stops being read.
- Keep each group's checks independent of the others, and undo what they leave behind
  (an extra pane changes what the next check can do in a small window).

The check is gated on `import.meta.env.VITE_SELFCHECK`. **Read `import.meta.env` with dot
access.** Vite only substitutes that form; through a bracket the branch never folds and the
whole self-check ships in the release.

## Conventions

**Code comments are English, and say why rather than what.** Keep them short. The story
behind a decision — the symptom, what was tried, why the obvious fix was wrong — goes in
`docs/engineering-notes.md`, not above the code. Someone reading the code should not have
to walk through an incident report.

**UI strings live in `src/shared/ui-strings.ts`, in both locales.** The renderer picks a
catalog once at startup (`src/renderer/i18n.ts`) — from the `locale` setting when it is
set, otherwise the system's. The choice rides in on the page URL because every view bakes
its strings in as it is built, which is also why changing the language needs a restart.
Never hard-code chrome copy at a call site. Each locale must read as its own language, not as a translation of the
other: name the setting, don't explain the mechanism ("스크롤 가속", not "휠 한 번에
얼마나 멀리 가는지"); menu items are actions ("Add a column to the left" / "왼쪽에 새
컬럼 추가하기"). Diagnostics — config validation, console output, fatal dialogs — are
English-only and stay at their call sites. The self-check asserts copy through the same
catalog, so it passes under any locale.

**Design values live only in `src/renderer/styles/tokens.css`.** Colours, radii,
durations, scrollbar thickness — referenced through `var()` everywhere else. The app has
exactly one shadow (`--shadow-overlay`), for menus over live content. `--gap` and
`--edge` are canvas geometry, mirrored in layout code with a comment naming the token;
spacing *inside* chrome views (flex gaps, paddings) may be literal px. Where a value
cannot go through `var()` — main's window background, xterm's theme object — the literal
carries a comment naming the token it mirrors.

**Platform differences are branched inline, not abstracted.** `process.platform` in main,
`IS_MAC` from `src/renderer/platform.ts` in the renderer. There is no platform layer and
there will not be one until Windows actually lands
(`docs/specs/2026-08-10-macos-support-design.md`). The platform that needs no workaround
keeps the plain path; the workaround is the exception written around it. A change that
touches:

- *keybindings* — edit `DEFAULT_BINDINGS` and `DEFAULT_BINDINGS_MAC` together, with the
  same number of chords per action (a unit test pins the counts; by convention the same
  index is the same logical shortcut). Every `chordFromEvent`, `formatChord` and
  `normalizeBindings` call site passes the platform explicitly: `isMac` defaults to
  `false`, so a forgotten argument compiles and is wrong only at runtime.
- *window options or native menus* — the darwin branch in `src/main/window-manager.ts`.
  On mac Cmd+C/V come from the application menu, and must stay bound to the copy and
  paste actions.
- *config or data paths* — go through the shared config-dir helper. Never resolve XDG by
  hand. `~/.config` is deliberate on mac too.
- *shells* — both the bash and the zsh hook in `src/main/shell-integration.ts`.

Verification is three layers: pure logic in unit tests, anything visible in the mac CI
job's `verify:app`, and what only hardware can show — IME, trackpad, Gatekeeper — in
`docs/MANUAL-QA.md` under "macOS (real hardware)".

**Commit messages are English and concise** — a single `type: what` subject line, no body.
The story behind a change belongs in `docs/engineering-notes.md`, not the commit. See `git log`.

Releases: `npm version <patch|minor>`, commit, `npm run dist`, `npm run install:local`, tag.
The installer picks the AppImage matching `package.json` — never the newest by name.
Pushing the tag triggers `.github/workflows/release.yml`, which typechecks, tests, builds
the AppImage and publishes it with SHA256SUMS — and fails if the tag does not match
`package.json`. The GitHub release artifact is the canonical one; `install:local` is for
this machine.

## Documents

- `docs/engineering-notes.md` — incidents behind the code as it stands
- `docs/MANUAL-QA.md` — what the self-check covers and why each item exists
- `docs/sessions.md` — the session file format, in full: what a save captures and why
- `docs/specs/` — the founding design and one dated spec per feature. Untracked working
  notes: present on the author's machine, absent from a clone.
