/**
 * End-to-end seam, the other side of the gate (issue #2): a session whose
 * environment says it is not inside wmux. Its own file because the extension reads
 * WMUX/WMUX_SURFACE_ID once, at module load, and one process carries one module
 * instance — see the header of test/fakes.ts.
 */
import assert from "node:assert/strict";
import { existsSync, writeFileSync } from "node:fs";
import path from "node:path";
import { after, test } from "node:test";
import { fakePi, fakeWmux } from "./fakes.ts";

const fx = fakeWmux({ inWmux: false }); // WMUX and WMUX_SURFACE_ID deliberately unset
after(fx.cleanup);

const { default: wmuxPalette } = await import("../extensions/wmux-palette.ts");

test("a session started outside wmux leaves pi's theme file unwritten", async () => {
  writeFileSync(fx.originalThemeFile, "dark", "utf-8"); // what the earlier wmux session left behind
  const pi = fakePi("wmux"); // …and left pi on the generated theme
  wmuxPalette(pi.api);
  await pi.startSession();

  assert.equal(existsSync(fx.themeOut), false);
  assert.equal(existsSync(path.join(fx.agentDir, "themes")), false);
  assert.deepEqual(pi.themes, ["dark"]); // put back, not left on wmux
});

test("…and puts back the theme the earlier wmux session picked", async () => {
  writeFileSync(fx.originalThemeFile, "gruvbox", "utf-8");
  const pi = fakePi("wmux");
  wmuxPalette(pi.api);
  await pi.startSession();

  assert.deepEqual(pi.themes, ["gruvbox"]); // the name kept in wmux-palette-original-theme.txt
  assert.ok(pi.notices.some((n) => n.includes("not inside wmux")), `no notice explains it: ${pi.notices}`);
});
