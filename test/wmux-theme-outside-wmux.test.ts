/**
 * End-to-end seam, the other side of the gate (issue #2): a session whose
 * environment says it is not inside wmux. Its own file because the extension reads
 * WMUX/WMUX_SURFACE_ID once, at module load, and one process carries one module
 * instance — see the header of test/fakes.ts.
 */
import assert from "node:assert/strict";
import { existsSync, writeFileSync } from "node:fs";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { after, test } from "node:test";
import { fakePi, fakeWmux, writeWmuxPrefs } from "./fakes.ts";

const fx = fakeWmux({ inWmux: false }); // WMUX and WMUX_SURFACE_ID deliberately unset
after(fx.cleanup);

const { default: wmuxTheme } = await import("../extensions/wmux-theme.ts");

test("a session started outside wmux leaves pi's theme file unwritten", async () => {
  writeFileSync(fx.originalThemeFile, "dark", "utf-8"); // what the earlier wmux session left behind
  const pi = fakePi("wmux"); // …and left pi on the generated theme
  wmuxTheme(pi.api);
  await pi.startSession();

  assert.equal(existsSync(fx.themeOut), false);
  assert.equal(existsSync(path.join(fx.agentDir, "themes")), false);
  assert.deepEqual(pi.themes, ["dark"]); // put back, not left on wmux
});

test("…and puts back the theme the earlier wmux session picked", async () => {
  writeFileSync(fx.originalThemeFile, "gruvbox", "utf-8");
  const pi = fakePi("wmux");
  wmuxTheme(pi.api);
  await pi.startSession();

  assert.deepEqual(pi.themes, ["gruvbox"]); // the name kept in wmux-theme-original-theme.txt
  assert.ok(pi.notices.some((n) => n.includes("not inside wmux")), `no notice explains it: ${pi.notices}`);
});

/**
 * An install upgraded in place has its saved theme only under the marker's OLD name — the
 * marker is never rewritten while pi is already on "wmux" — so undoing has to find it there
 * rather than fall back to "system" and lose the theme that session had.
 */
test("…and still finds a marker saved under the name from before the package was renamed", async () => {
  writeFileSync(fx.originalThemeFilePreRename, "gruvbox", "utf-8");
  const pi = fakePi("wmux");
  wmuxTheme(pi.api);
  await pi.startSession();

  assert.deepEqual(pi.themes, ["gruvbox"]); // not "system", which is what a new-name-only read would give
});

/**
 * The other half of the outside-wmux promise: it is not just that no theme was written at
 * session_start, nothing is WATCHED either, so a wmux that saves its prefs later (a wmux
 * window left open on this machine) must still not make this session write pi's theme.
 */
test("…and arms no watch, so a wmux prefs save afterwards still writes no theme file", async () => {
  const pi = fakePi("wmux");
  wmuxTheme(pi.api);
  await pi.startSession();

  writeWmuxPrefs(fx.prefsFile, "seam-dark"); // a real wmux save: temp sibling, then rename over settings.json
  await delay(500); // several times the extension's 150 ms rebuild debounce
  assert.equal(existsSync(fx.themeOut), false, "a session outside wmux armed a watch: a wmux prefs save rebuilt pi's theme");
});
