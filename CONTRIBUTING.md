# Contributing

Thanks for looking under the hood. The short version: the bar for any change is
that the checks pass, and [CLAUDE.md](CLAUDE.md) is the map of how the code is
organized — read it first, it is written for exactly this purpose.

## Setting up

```bash
npm install       # Node 22+; needs python3, make, g++ for the native node-pty build
npm run dev       # run from source; the renderer console goes to your terminal
```

`postinstall` rebuilds node-pty against the Electron ABI, which takes a minute
or three. If `npm install` fails halfway and then "succeeds", the Electron
binary download may have been skipped — on an `Electron uninstall` error, run
`node node_modules/electron/install.js`.

Ubuntu 24.04+ blocks unprivileged user namespaces by default; if the app dies
on a sandbox error, launch with `ELECTRON_DISABLE_SANDBOX=1 npm run dev`. See
the README's Sandboxing section for the proper fix.

## Building the app

```bash
npm run dist            # AppImage → release/
npm run install:local   # copy to ~/Applications + register a desktop launcher
```

`install:local` writes only inside your home directory, no sudo:

- `~/Applications/Termspace.AppImage`
- `~/.local/share/applications/termspace.desktop`
- `~/.local/share/icons/hicolor/*/apps/termspace.png`

It installs the AppImage matching `package.json`, not the newest file by name.

## The bar for a PR

```bash
npm test            # unit tests over the pure modules, ~2s
npm run typecheck   # main and renderer tsconfigs, separately
npm run verify:app  # launches the real app and drives its own UI (~60s, Linux)
```

All three must pass. For porting PRs (macOS/Windows), `verify:app` passing on
your platform *is* the acceptance test.

`npm run verify:app` guards what unit tests cannot reach: whether ptys spawn,
keys land, the canvas glides, off-screen panes freeze. It uses a temp
`XDG_CONFIG_HOME`, so your real config is never touched. The checks run as four
independent groups in parallel windows:

```bash
npm run verify:app -- core motion   # just these groups
npm run verify:app -- --serial      # one window, everything in order
```

One test file, or one case:

```bash
npx vitest run src/renderer/keymap.test.ts
npx vitest run -t 'Alt+U I O P'
npm run test:watch
```

## Conventions

Details are in [CLAUDE.md](CLAUDE.md); the short list:

- Logic that doesn't need the DOM, Node, or Electron lives in a pure module
  with a `.test.ts` beside it. New logic belongs there unless it genuinely
  needs a live surface.
- `npm run typecheck` enforces the security boundary: the renderer tsconfig has
  no `node` types, so importing `fs` in the renderer fails the type check.
- UI strings go in `src/shared/ui-strings.ts`, in both locales. Never
  hard-code chrome copy at a call site.
- Design values (colours, radii, durations) live in
  `src/renderer/styles/tokens.css` and are referenced through `var()`.
- Code comments are English and say *why*, not *what*. The story behind a
  decision goes in [docs/engineering-notes.md](docs/engineering-notes.md).
- Commit messages are a single `type: what` subject line, no body.

## Reporting bugs

An issue with the output of `npm run verify:app`, your distro and desktop
(X11/Wayland), and steps to reproduce is ideal. Screenshots help a lot for
layout issues — several real bugs here were only visible in pixels.
