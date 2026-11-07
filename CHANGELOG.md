# Changelog

All notable changes to **pi-wmux-theme** are documented here.
Format: [Keep a Changelog](https://keepachangelog.com/), versioning: [Semantic Versioning](https://semver.org/).

Releases are git tags `vX.Y.Z` pointing at the commit that bumped `version` in
`package.json`. An unpinned install (`git:github.com/richardaubin/pi-wmux-theme`)
tracks the default branch, so `pi update git:github.com/richardaubin/pi-wmux-theme`
moves it to the newest commit; a pinned install (`…@v1.0.0`) stays where you put it.

To cut a release: edit this file, bump `version`, commit, `git tag vX.Y.Z`, `git push && git push --tags`.

## [Unreleased]

### Fixed

- **pi started outside wmux is no longer affected at all.** Earlier versions selected the
  generated theme by name, and pi writes a theme named to it into its global
  `<agent-dir>/settings.json` — so the choice made inside wmux followed pi into Windows
  Terminal, where wmux's palette says nothing about that terminal's colours. The extension
  then undid that at `session_start`, which meant pi still started on the wmux colours, then
  flipped, and said so. Now the theme is handed to pi as a **value** (the `Theme` loaded from
  `<agent-dir>/themes/wmux.json`), the only shape pi paints without persisting: the session
  shows it, pi's `theme` setting is never touched, and nothing is left to undo.
- Outside wmux the extension now registers **nothing** — no `session_start` handler, no
  `/wmux-theme` command, no write, no watch — instead of registering an undo for the leaked
  setting. pi paints exactly what its own settings name.

### Changed

- A rebuild from a wmux theme change repaints the session itself (pi's own reload of its
  themes directory only covers a theme selected by name, and this is no longer one).
- **Removed** the rollback marker `<agent-dir>/wmux-theme-original-theme.txt` (and the
  pre-rename `wmux-palette-original-theme.txt` it also read): there is no longer a theme
  setting to roll back. An install upgrading from 1.1.x or older keeps whatever `theme` the
  old version wrote — set it back once, in `<agent-dir>/settings.json` or with `/settings`.

## [1.1.2] - 2026-11-02

### Changed

- **The package is now `pi-wmux-theme`** (it was `pi-wmux-palette`, "palette" being the wrong
  word for what it produces): the command is `/wmux-theme`, the extension file is
  `extensions/wmux-theme.ts`, the GitHub repository is `pi-wmux-theme`, and every notice and
  log line starts with `wmux theme:` / `[wmux-theme]`. **Breaking** for an existing install in
  one way only: pi identifies a git package by its repository URL, so an install made under the
  old name keeps loading that entry (GitHub redirects the clone, so it still updates) — moving
  it to the new URL is `pi remove git:github.com/richardaubin/pi-wmux-palette` followed by
  `pi install git:github.com/richardaubin/pi-wmux-theme`. Nothing said about wmux's own
  vocabulary changed: wmux's `palette = N=#hex` theme slots, the 16-slot colour palette, and the
  palette a terminal reports over OSC 4/10/11 are still called palettes, in code and in prose.
- The rollback marker is now `<agent-dir>/wmux-theme-original-theme.txt`. A marker saved under
  the old name is still read, which is what an install upgraded in place needs: the marker is
  not rewritten while pi is already on the generated theme, so reading only the new name would
  have restored `system` instead of the theme that session had.

## [1.1.1] - 2026-11-02

### Fixed

- wmux **run from a source checkout** finds its `resources/themes` again. That directory is now
  derived from `WMUX_CLI` — `resources/cli/wmux.js` when wmux is installed (themes one level
  up), the built `dist/cli/wmux.js` when it runs from a checkout (themes two levels up, in
  `resources/`) — instead of falling back to two hardcoded paths, one of which matched only
  one machine's checkout.

## [1.1.0] - 2026-11-02

### Changed

- wmux's preferences are **watched** instead of re-read every 2 s. One watch on the
  directory holding `%APPDATA%\wmux\settings.json`, rebuilt only for the events naming
  that file (wmux saves by renaming a `settings.json.tmp` over it, which is why a
  directory is watched and not the file), with a 150 ms trailing timer collapsing the 4–6
  events one save produces. Changing the theme in wmux's **Settings → Terminal**
  now recolours pi in about 150 ms instead of up to 2 s, there are no idle reads, and a
  session has no timer. A watch that errors is closed and re-armed after 5 s, and a rebuild a
  save had already queued before it died still runs; there is deliberately no backstop
  interval, so a change made while pi was not watching lands at the next session start.

### Fixed

- The fallback for wmux's `resources/themes` when wmux runs from a source checkout now
  points at a directory that exists — the path it looked at never did, so a theme name
  found only in a checkout resolved to nothing.
- `themes/wmux.json` is now replaced atomically — written to a temp file beside it,
  then renamed over it, the way wmux saves its own preferences — and the temp file is
  deleted if the write or the rename fails. Several panes rewrite that one file in
  place, and one that died mid-write left a truncated file pi silently failed to parse:
  every pane kept stale colours and nothing retried until the next change. The rollback
  marker `wmux-palette-original-theme.txt`, which every pane rewrites too, is replaced the
  same way — a truncated one made a later session outside wmux restore garbage as its theme
  name.

## [1.0.0] - 2026-11-02

First packaged release. Previously this was an unversioned single file,
`<agent-dir>/extensions/wmux-palette.js`.

### Added

- `extensions/wmux-palette.ts`: generates pi's `wmux` theme at
  `<agent-dir>/themes/wmux.json` from wmux's **current** palette — wmux's own
  `resources/themes/*.theme` files, with wmux's `userColorSchemes` preference
  overriding it — and re-reads wmux's preferences every 2 s, so changing the theme
  in wmux's **Settings → Terminal** recolours pi without restarting pi.
- The `wmux` theme is selected automatically at `session_start`; the theme name you
  had before is remembered in `<agent-dir>/wmux-palette-original-theme.txt` for rollback.
- `/wmux-palette` command: rebuild the theme file on demand and report which wmux
  theme and dark/light appearance it derived.
- Outside wmux (`WMUX=1` / `WMUX_SURFACE_ID` unset) the extension writes nothing and
  polls nothing, and puts back the theme a previous wmux session left behind, so
  Windows Terminal keeps its own colours. In print and JSON mode (`ctx.hasUI` false)
  the theme file is written but the theme is not switched.
- `PI_HYPERLINKS=1` inside wmux — pi cannot detect that wmux draws OSC 8 links.
- `test/wmux-palette.test.ts` (`npm test`, Node 23.6+): the wmux `.theme` parser,
  the dark/light decision from the background colour, and palette-slot → pi-role
  mapping including the empty-palette fallback.
