/**
 * End-to-end seam (issue #2): the whole extension, driven from a test against a
 * fake wmux and a fake pi. No wmux process, no pi process.
 *
 * This file is separate from test/wmux-palette.test.ts on purpose: the extension
 * reads its paths and its in-wmux gate at module load, so the fixture has to be in
 * place BEFORE the module is imported, and a static import would beat the fixture.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { after, test } from "node:test";
import { fakePi, fakeWmux, writeWmuxPrefs } from "./fakes.ts";

const fx = fakeWmux({ inWmux: true });
after(fx.cleanup);

const { default: wmuxPalette } = await import("../extensions/wmux-palette.ts");

// Expected colours are read off the fixture in test/fakes.ts by hand: a palette slot
// appears as itself, and a mix is base + (target - base) * t rounded (mix("#101010",
// "#0000ff", 0.28) → r 16-4.48=11.5→0c, b 16+66.9=82.9→53).
test("a session started inside wmux writes pi's theme from the fixture palette", async () => {
  const pi = fakePi("dark");
  wmuxPalette(pi.api);
  await pi.startSession();

  const theme = JSON.parse(readFileSync(fx.themeOut, "utf-8"));
  assert.equal(theme.name, "wmux");
  assert.equal(theme.appearance, "dark"); // a #101010 background needs pi's dark base
  assert.equal(theme.vars.text, "#f0f0f0"); // the fixture's foreground
  assert.equal(theme.vars.blue, "#0000ff"); // palette slots land in pi's colour roles
  assert.equal(theme.vars.green, "#00ff00");
  assert.equal(theme.vars.violet, "#ff00ff");
  assert.equal(theme.vars.red, "#ee0000"); // wmux's userColorSchemes override wins over the file
  assert.equal(theme.vars.muted, "#929292"); // #f0f0f0 tinted 42% toward #101010
  assert.equal(theme.vars.blueBg, "#0c0c53");
  assert.equal(theme.colors.toolErrorBg, "#583232"); // #101010 tinted 30% toward palette 9
  assert.equal(theme.export.pageBg, "#101010"); // the fixture's background
});

test("it selects that theme in pi by the name it wrote, and says which wmux theme it derived", async () => {
  const pi = fakePi("dark");
  wmuxPalette(pi.api);
  await pi.startSession();

  const name = (JSON.parse(readFileSync(fx.themeOut, "utf-8")) as { name: string }).name;
  assert.deepEqual(pi.themes, [name]); // pi is asked for the theme by the name the file carries
  assert.equal(path.basename(fx.themeOut), `${name}.json`); // …which is the file pi hot-reloads
  assert.ok(pi.notices.some((n) => n.includes("seam-dark")), `no notice names the wmux theme: ${pi.notices}`);
  assert.equal(readFileSync(fx.originalThemeFile, "utf-8"), "dark"); // the pick it replaced, kept for the undo outside wmux
});

test("a wmux theme whose background is light gets pi's light base", async () => {
  const pi = fakePi("dark");
  wmuxPalette(pi.api);
  await pi.startSession();

  // wmux saving its prefs is what the watcher ticket will trigger on; here the
  // extension's own /wmux-palette handler is the re-read, so no clock is involved.
  writeWmuxPrefs(fx.prefsFile, "seam-light");
  await pi.runCommand();

  const theme = JSON.parse(readFileSync(fx.themeOut, "utf-8"));
  assert.equal(theme.appearance, "light");
  assert.equal(theme.vars.text, "#1a1a1a");
  assert.equal(theme.export.pageBg, "#f5f5f5");
  assert.equal(theme.vars.blue, "#0000ff"); // same palette slots, the light base underneath
});
