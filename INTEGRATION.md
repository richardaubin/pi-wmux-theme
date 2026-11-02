# Integration branch — `integration/issue-1`

Temporary branch that collects the work tickets under issue #1
(*"React to wmux's prefs write instead of polling every 2s"*). It exists so the
tickets land one at a time on their own branches and are merged **here**, verified
together, before anything reaches `main`. Do not develop directly on this branch.

## Tickets

Landed in this order; each is merged from its own branch, never pushed here directly.

| Merge order | Issue | Title | Branch base |
| --- | --- | --- | --- |
| 1 | #2 | End-to-end seam: drive the extension from a test against a fake wmux and a fake pi | `main` |
| 2 | #4 | Replace pi's generated theme file atomically (temp + rename) | `main` (re-merge if it branched before #2) |
| 3 | #3 | Directory watch on wmux's prefs replaces the 2 s poll | after #2 — it is blocked by it |

## Why the order

`extensions/wmux-palette.ts` is the whole extension, so all three tickets touch one
file. #2 only **adds** a test file, so it merges clean under anything. #4 rewrites one
write call and #3 replaces the poll block; #3 therefore merges last, where it can be
reconciled against #4's atomic write instead of fighting it in three directions.

## Checks at each merge

```bash
npm run check     # tsc --noEmit
npm test          # node --test test/  (Node 23.6+ strips the types)
```

Both must pass after **every** merge, not only at the end. Then, before this branch
goes to `main`, the hand-check from #3 is run once against a live wmux: flip the theme
in wmux's **Settings → Terminal**, confirm pi recolours in about a fifth of a second
and that `/wmux-palette` names the new palette; start a session outside wmux and
confirm nothing is watching.

## Finishing

When every ticket above is merged and green, this branch merges to `main`, the
`[Unreleased]` section of `CHANGELOG.md` is cut into a release, and the branch is
deleted both locally and on the remote. `INTEGRATION.md` is deleted with it — it
describes the branch, not the package.
