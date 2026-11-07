/**
 * End-to-end seam (issue #2): the whole extension, driven from a test against a
 * fake wmux and a fake pi. No wmux process, no pi process.
 *
 * This file is separate from test/wmux-theme.test.ts on purpose: the extension
 * reads its paths and its in-wmux gate at module load, so the fixture has to be in
 * place BEFORE the module is imported, and a static import would beat the fixture.
 */
import assert from "node:assert/strict";
import { chmodSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { after, test } from "node:test";
import { fakePi, fakeWmux, writeWmuxPrefs } from "./fakes.ts";

const fx = fakeWmux({ inWmux: true });
after(fx.cleanup);

const { default: wmuxTheme } = await import("../extensions/wmux-theme.ts");

// Expected colours are read off the fixture in test/fakes.ts by hand: a palette slot
// appears as itself, and a mix is base + (target - base) * t rounded (mix("#101010",
// "#0000ff", 0.28) → r 16-4.48=11.5→0c, b 16+66.9=82.9→53).
test("a session started inside wmux writes pi's theme from the fixture palette", async () => {
  const pi = fakePi("dark");
  wmuxTheme(pi.api);
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
  assert.deepEqual(readdirSync(path.dirname(fx.themeOut)), ["wmux.json"]); // …and the directory pi watches holds nothing else: no half-written temp left behind
});

test("it shows pi the theme it wrote, as a value pi will not persist", async () => {
  const pi = fakePi("dark"); // pi's own theme setting, which this extension must leave alone
  wmuxTheme(pi.api);
  await pi.startSession();

  const name = (JSON.parse(readFileSync(fx.themeOut, "utf-8")) as { name: string }).name;
  assert.deepEqual(pi.themes, [name]); // pi is shown the theme the file carries — and fakePi throws on a NAME, which is what pi would write to settings.json
  assert.equal(path.basename(fx.themeOut), `${name}.json`); // …loaded from the file it was built from
  assert.ok(pi.notices.some((n) => n.includes("seam-dark")), `no notice names the wmux theme: ${pi.notices}`);
  assert.deepEqual(
    readdirSync(fx.agentDir).filter((entry) => entry.includes("original")),
    [],
    "the extension left a rollback marker behind — it no longer touches pi's theme setting, so it has nothing to undo",
  );
});

/**
 * Several panes rewrite this one file, so it has to be REPLACED (temp + rename),
 * never rewritten in place — a reader, pi's own theme reload, must never see a
 * document that is half old and half new. The fingerprint of a replace is that the
 * path points at a different file object afterwards: Node reports NTFS's file index
 * as `ino`, and an in-place write keeps the same one (measured on this machine).
 */
test("a rewrite replaces the theme file instead of rewriting it in place", async () => {
  const pi = fakePi("dark");
  wmuxTheme(pi.api);
  await pi.startSession();

  const before = statSync(fx.themeOut);
  writeWmuxPrefs(fx.prefsFile, "seam-light"); // wmux saving its prefs is what the watcher ticket will trigger on
  await pi.runCommand(); // …here the extension's own /wmux-theme handler is the re-read, so no clock is involved

  const after = statSync(fx.themeOut);
  assert.notEqual(after.ino, before.ino); // a new file object took its place, the old one was never emptied
  assert.equal(JSON.parse(readFileSync(fx.themeOut, "utf-8")).appearance, "light"); // …and the reader gets a whole document

  await pi.runCommand(); // nothing changed in wmux, so the write-if-changed guard skips it
  assert.equal(statSync(fx.themeOut).ino, after.ino); // …and that really means no rewrite, and no temp file
});

/**
 * The temp file must not survive a failed write or a failed replace: a leftover in
 * <agent-dir>/themes is where pi looks for themes, and the previous file is what pi
 * keeps painting until the next successful write.
 *
 * chmod 444 sets the read-only attribute on Windows, which is what makes the rename
 * fail. On POSIX a file mode only stops other users, and these tests run as the
 * owner, so the case is skipped there rather than passing for the wrong reason.
 */
(process.platform === "win32" ? test : test.skip)("a failed replace keeps the previous theme file and leaves no temp file", async () => {
  const pi = fakePi("dark");
  wmuxTheme(pi.api);
  await pi.startSession();
  const before = readFileSync(fx.themeOut, "utf-8");

  chmodSync(fx.themeOut, 0o444);
  try {
    writeWmuxPrefs(fx.prefsFile, "seam-dark"); // a different palette, so a write IS attempted
    await pi.runCommand();
  } finally {
    chmodSync(fx.themeOut, 0o666); // else the fixture's own cleanup cannot delete it
  }

  assert.equal(readFileSync(fx.themeOut, "utf-8"), before); // pi keeps a complete theme it can parse
  assert.deepEqual(readdirSync(path.dirname(fx.themeOut)), ["wmux.json"]); // …and the temp file was cleaned up
});

test("a wmux theme whose background is light gets pi's light base", async () => {
  const pi = fakePi("dark");
  wmuxTheme(pi.api);
  await pi.startSession();

  writeWmuxPrefs(fx.prefsFile, "seam-light");
  await pi.runCommand();

  const theme = JSON.parse(readFileSync(fx.themeOut, "utf-8"));
  assert.equal(theme.appearance, "light");
  assert.equal(theme.vars.text, "#1a1a1a");
  assert.equal(theme.export.pageBg, "#f5f5f5");
  assert.equal(theme.vars.blue, "#0000ff"); // same palette slots, the light base underneath
});
