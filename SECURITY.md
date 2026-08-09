# Security Policy

Termspace spawns real shells (node-pty) and renders arbitrary program output,
so it takes the Electron hardening surface seriously: `contextIsolation`,
`nodeIntegration: false`, `sandbox: true`, a `default-src 'none'` CSP, and a
renderer tsconfig with no Node types so the process boundary is enforced by the
type checker. The preload surface is a fixed list of named channels with no
generic `invoke` escape hatch.

## Reporting a vulnerability

Please use GitHub's private vulnerability reporting on this repository
(Security → Report a vulnerability) rather than a public issue. Reports that
include a way to reproduce — a session YAML, a program to run in a pane, or a
sequence of UI steps — get fixed fastest.

Only the latest release is supported.
