# pi-wmux-palette

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
pi hot-reloads. It re-reads wmux's prefs every 2 s, so a theme change in wmux lands
in pi within a couple of seconds.

## Install

```bash
pi install git:github.com/richardaubin/pi-wmux-palette
```

Try it once, without adding it to your settings:

```bash
pi -e git:github.com/richardaubin/pi-wmux-palette
```

Then restart pi inside a wmux terminal. pi selects the generated `wmux` theme
itself — no `/settings` step.

## Requirements

| | |
|---|---|
| OS | Windows (wmux is Windows-only) |
| Terminal | running inside wmux, with `WMUX=1` and `WMUX_SURFACE_ID` set by wmux |
| wmux | an install or checkout with `resources/themes/*.theme`, plus readable `%APPDATA%\wmux\settings.json` |
| pi | 1.x (`pi-coding-agent`) |

Outside wmux the extension writes nothing and polls nothing: it only puts back the
theme setting a previous wmux session left behind, so Windows Terminal keeps its
own colours.

## Command

`/wmux-palette` — rebuild `<agent-dir>/themes/wmux.json` from wmux's current
palette and report which wmux theme and appearance it derived.

## Roll back

```bash
pi remove git:github.com/richardaubin/pi-wmux-palette
```

Then, if pi is still on the generated theme: set `theme` back in
`<agent-dir>/settings.json` and delete `<agent-dir>/themes/wmux.json`.

## Development

```bash
npm install     # pi's types, @types/node, typescript (all dev-only)
npm run check   # tsc --noEmit
npm test        # node --test (Node 23.6+ to strip the types)
```

`pi --extension ./extensions/wmux-palette.ts` loads it in one invocation while you
edit it.

## Credits

- **[wmux](https://github.com/amirlehmam/wmux)** — [Amir Lehmam](https://github.com/amirlehmam), MIT. The Windows terminal multiplexer for AI agents; its palette is what this extension reads. Without wmux this extension has no reason to exist.
- **[pi](https://github.com/earendil-works/pi)** — [Mario Zechner](https://github.com/earendil-works/pi) ([badlogic](https://github.com/badlogic)), MIT. The coding agent it colours, and the extension and package API it uses.
- Written by **Richard Aubin** ([richardaubin](https://github.com/richardaubin)).

MIT — see [LICENSE](LICENSE).
