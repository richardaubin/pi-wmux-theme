# pi-wmux-palette — instructions for any agent working in this folder

A standalone **pi package** (one extension), published at
<https://github.com/richardaubin/pi-wmux-palette>. It is *not* part of the wmux
source tree: pi also loads the parent folders' `AGENTS.md` (wmux), but nothing here
changes wmux or pi. A task that needs a wmux-side change belongs in that repo instead.

## What it is

- `extensions/wmux-palette.ts` is the whole extension: it reads wmux's palette from
  wmux's own preferences plus `resources/themes/*.theme`, writes pi's theme to
  `<agent-dir>/themes/wmux.json`, and re-reads every 2 s, so changing wmux's theme in
  **Settings → Terminal** recolours pi without restarting pi. It also selects that
  theme at `session_start` and answers `/wmux-palette`.
- **Why it exists:** pi tints its panels from the palette the terminal reports about
  itself over OSC 10/11/4. Inside a ConPTY shell nothing can answer that query, so
  pi's request stays pending and it paints its built-in greys. wmux holds the palette
  but only writes it to xterm. Writing a theme file is the only path pi hot-reloads.
- Outside wmux (`WMUX=1` / `WMUX_SURFACE_ID` unset): no writes, no polling, and it
  restores the theme setting a wmux session left behind.

## Rules that come from pi (docs: `@earendil-works/pi-coding-agent/docs/extensions.md`, `packages.md`)

- Resolve `<agent-dir>` from `PI_CODING_AGENT_DIR`, else `~/.pi/agent`. **Never** from
  the extension's own path — an installed package lives in `<agent-dir>/git/…`, not
  `<agent-dir>/extensions/`.
- No timers or watchers in the extension factory: start the poll in `session_start`,
  clear it idempotently in `session_shutdown`, and `unref()` the interval.
- Guard UI with `ctx.hasUI`: print and JSON mode must not call `ctx.ui.setTheme`
  (still write the theme file, so colours are ready for the next interactive run).
- `@earendil-works/pi-coding-agent` is a `peerDependency` with `"*"` — never move it
  to `dependencies` (the host provides it). Keep `keywords: ["pi-package"]` and the
  explicit `pi.extensions` manifest in `package.json`.
- No build step: keep the TS erasable-only (`tsconfig.json`), so pi can strip types
  from the source as-is.

## Verify a change here

```bash
npm run check                       # tsc --noEmit
npm test                            # node --test test/ (Node 23.6+ strips the types)
pi update git:github.com/richardaubin/pi-wmux-palette    # pull into the live checkout
```

A running pi keeps the extension it loaded — restart pi inside wmux to test the
installed package. To try an uncommitted copy in one invocation:
`pi -e ./extensions/wmux-palette.ts`. To check generated colours without a session,
import `buildWmuxTheme()` in a scratch script and diff it against
`<agent-dir>/themes/wmux.json`.

## Release

Add a bullet under `[Unreleased]` in `CHANGELOG.md` **as part of the change**. On
release: rename it to `## [X.Y.Z] - date`, bump `version` in `package.json`, then
`git tag vX.Y.Z && git push && git push --tags`. No CI, and it is not on npm — so
`pi install pi-wmux-palette` does not work yet, only the git source.

## Do not re-investigate

"Let wmux answer pi's OSC 4/10/11 queries instead" — dead end, checked 2026-11-02:
the query is issued by a ConPTY child with no TUI in between to answer, xterm.js only
answers OSC 11 when a real pty is attached to it (wmux's `PtyManager` owns the pty and
writes the palette into xterm), and wmux never emits `OSC P dn;rgb;ST` replies. It
would need an injection point on wmux's pty→xterm path and `\x1b\\` terminators in its
OSC parser.

## Docs type

Durable facts and rules for agents belong **in this file**; user-facing "what it does
/ how to install" belongs in `README.md`; what changed belongs in `CHANGELOG.md`.
Do not commit session handoff notes — delete them once absorbed.

## This machine

- `<agent-dir>` = `L:\.config\pi\agent` (`PI_CODING_AGENT_DIR` is a User env var).
- `settings.json` → `packages` has `git:github.com/richardaubin/pi-wmux-palette`
  (unpinned, tracks `main`); checkout at `<agent-dir>/git/github.com/richardaubin/pi-wmux-palette`.
- pi's setting `theme` is `"wmux"`; the name it had before is kept in
  `<agent-dir>/wmux-palette-original-theme.txt`. Roll back: `pi remove git:…`, restore
  that theme name, delete `<agent-dir>/themes/wmux.json`.
- `L:\repos\wmux` is a separate repo whose worktree lists this folder as untracked —
  leave it untracked.
