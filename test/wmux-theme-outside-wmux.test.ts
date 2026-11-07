/**
 * End-to-end seam, the other side of the gate (issue #2): a session whose environment says
 * it is not inside wmux. There the extension has to be INERT — pi is left with whatever
 * theme its own settings name, so it must not be asked to paint anything, told anything, or
 * given a command to run. Its own file because the extension reads WMUX/WMUX_SURFACE_ID once,
 * at module load, and one process carries one module instance — see the header of test/fakes.ts.
 */
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { after, test } from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { fakePi, fakeWmux, writeWmuxPrefs } from "./fakes.ts";

const fx = fakeWmux({ inWmux: false }); // WMUX and WMUX_SURFACE_ID deliberately unset
after(fx.cleanup);

const { default: wmuxTheme } = await import("../extensions/wmux-theme.ts");

test("a session started outside wmux registers nothing: no handler, no /wmux-theme", () => {
  const pi = fakePi("dark");
  wmuxTheme(pi.api);

  assert.deepEqual([...pi.handlers.keys()], [], "the extension subscribed to pi's lifecycle outside wmux");
  assert.deepEqual([...pi.commands.keys()], [], "the extension added a command to pi outside wmux");
});

test("…so pi keeps the theme its own settings name: nothing written, painted, or said", async () => {
  const pi = fakePi("wmux"); // pi left on the generated theme by an older install — still not this extension's business
  wmuxTheme(pi.api);
  await pi.startSession();

  assert.deepEqual(pi.themes, [], "the extension switched pi's theme outside wmux");
  assert.deepEqual(pi.notices, [], "the extension talked to the user outside wmux");
  assert.equal(existsSync(fx.themeOut), false);
  assert.equal(existsSync(fx.themesDir), false); // it does not even create the directory pi watches
});

/**
 * Inert means inert: no theme file at session_start is not enough, since a wmux window left
 * open on this machine saves its prefs later and used to drive pi's theme from it.
 */
test("…and no watch is armed, so a wmux prefs save afterwards still changes nothing", async () => {
  const pi = fakePi("wmux");
  wmuxTheme(pi.api);
  await pi.startSession();

  writeWmuxPrefs(fx.prefsFile, "seam-dark"); // a real wmux save: temp sibling, then rename over settings.json
  await delay(500); // several times the extension's 150 ms rebuild debounce
  assert.equal(existsSync(fx.themeOut), false, "a session outside wmux armed a watch: a wmux prefs save rebuilt pi's theme");
  assert.deepEqual(pi.themes, []);
});
