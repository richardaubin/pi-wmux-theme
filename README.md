# pi-wmux-theme

A [pi](https://github.com/earendil-works/pi) extension that paints pi's panels with
[wmux](https://github.com/amirlehmam/wmux)'s current terminal palette, and keeps
doing it when you change wmux's theme in **Settings → Terminal**.

It runs only inside wmux; outside wmux it gets out of the way.

## Why

pi tints its user-message, tool, diff and search panels with colours it **derives
from the palette the terminal reports about itself** over OSC 10/11/4. Nothing can
answer that from inside a ConPTY shell — only the app attached to the pty can, and
xterm.js answers an OSC 11 query only when a real pty is attached to it, which in
wmux it never is (wmux's `PtyManager` owns the pty). So pi's request stays pending
and pi paints its built-in greys: the coloured blocks that are obvious in Windows
Terminal are nearly invisible in wmux.

wmux has a full palette (`resources/themes/*.theme`, plus a `userColorSchemes`
override in its own prefs) and only ever writes it to xterm — it never tells pi.

This package closes that gap without patching wmux: it generates pi's own theme
from wmux's palette and writes it to `<agent-dir>/themes/wmux.json`, the one path
pi hot-reloads. It watches the directory wmux saves its prefs in, so a theme change
in wmux recolours pi in about 150 ms — and while nothing changes it does nothing at
all.

## Install

```bash
pi install git:github.com/richardaubin/pi-wmux-theme
```

Try it once, without adding it to your settings:

```bash
pi -e git:github.com/richardaubin/pi-wmux-theme
```

Then restart pi inside a wmux terminal. pi selects the generated `wmux` theme
itself — no `/settings` step.

The repository used to be `pi-wmux-palette`. An install made under that name still works
(GitHub redirects the clone), but pi tracks a git package by its URL, so moving it over is
a remove plus an install:

```bash
pi remove git:github.com/richardaubin/pi-wmux-palette
pi install git:github.com/richardaubin/pi-wmux-theme
```

## Requirements

| | |
|---|---|
| OS | Windows (wmux is Windows-only) |
| Terminal | running inside wmux, with `WMUX=1` and `WMUX_SURFACE_ID` set by wmux |
| wmux | **2.54.0** or newer, with `resources/themes/*.theme` present and `%APPDATA%\wmux\settings.json` readable |
| pi | **1.4.0** or newer (`@earendil-works/pi-coding-agent`) |

The two version numbers are the ones this package is built and tested against
(wmux `v2.54.0`, pi `v1.4.0`). What it actually reads from wmux is the
`wmux-terminal-prefs` block in wmux's `settings.json` and the ghostty-format
`.theme` files — if wmux moves either, the extension writes nothing and pi keeps the
colours it already has rather than guessing.

Outside wmux the extension writes nothing and watches nothing: it only puts back the
theme setting a previous wmux session left behind, so Windows Terminal keeps its
own colours.

## Command

`/wmux-theme` — rebuild `<agent-dir>/themes/wmux.json` from wmux's current
palette and report which wmux theme and appearance it derived.

## Roll back

```bash
pi remove git:github.com/richardaubin/pi-wmux-theme
```

Then, if pi is still on the generated theme: set `theme` back in
`<agent-dir>/settings.json` and delete `<agent-dir>/themes/wmux.json`.

## Development

```bash
npm install     # pi's types, @types/node, typescript (all dev-only)
npm run check   # tsc --noEmit
npm test        # node --test (Node 23.6+ to strip the types)
```

`pi --extension ./extensions/wmux-theme.ts` loads it in one invocation while you
edit it.

## Versioning & releases

Versioned in [`CHANGELOG.md`](CHANGELOG.md): keep-a-changelog sections under
`[Unreleased]`, then bump `version` in `package.json`, add a `## [X.Y.Z] - date`
heading, and tag the commit:

```bash
git tag vX.Y.Z && git push && git push --tags
```

Your install here is unpinned, so it tracks the default branch:

```bash
pi update git:github.com/richardaubin/pi-wmux-theme   # newest commit
pi update                                               # all packages
pi install git:github.com/richardaubin/pi-wmux-theme@v1.1.1   # pin instead
```

## Credits

- **[wmux](https://github.com/amirlehmam/wmux)** — [Amir Lehmam](https://github.com/amirlehmam), MIT. The Windows terminal multiplexer for AI agents; its palette is what this extension reads. Without wmux this extension has no reason to exist.
- **[pi](https://github.com/earendil-works/pi)** — [Mario Zechner](https://github.com/earendil-works/pi) ([badlogic](https://github.com/badlogic)), MIT. The coding agent it colours, and the extension and package API it uses.
- Written by **Richard Aubin** ([richardaubin](https://github.com/richardaubin)).

MIT — see [LICENSE](LICENSE).
