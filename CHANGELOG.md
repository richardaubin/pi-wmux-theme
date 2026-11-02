# Changelog

All notable changes to **pi-wmux-palette** are documented here.
Format: [Keep a Changelog](https://keepachangelog.com/), versioning: [Semantic Versioning](https://semver.org/).

Releases are git tags `vX.Y.Z` pointing at the commit that bumped `version` in
`package.json`. An unpinned install (`git:github.com/richardaubin/pi-wmux-palette`)
tracks the default branch, so `pi update git:github.com/richardaubin/pi-wmux-palette`
moves it to the newest commit; a pinned install (`…@v1.0.0`) stays where you put it.

To cut a release: edit this file, bump `version`, commit, `git tag vX.Y.Z`, `git push && git push --tags`.

## [Unreleased]

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

- The dev-checkout fallback for wmux's `resources/themes` now points at
  `L:\repos\wmux\resources\themes` — the old `L:\repos\wmux\wmux\…` path never
  existed, so a theme name found only in a wmux checkout resolved to nothing.
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
