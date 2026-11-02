/**
 * End-to-end seam, the trigger (issue #3): what makes the extension re-read wmux, and
 * what must not. Its own file because these tests have to own the whole watcher
 * lifecycle — the instances started by test/wmux-theme-session.test.ts would still be
 * watching a fixture directory of their own, and every file gets its own process and its
 * own fixture under `node --test` (see the header of test/fakes.ts).
 */
import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { setTimeout as delay } from "node:timers/promises";
import path from "node:path";
import { after, test } from "node:test";
import { DARK_THEME, LIGHT_THEME, fakePi, fakeWmux, wmuxSave, writeWmuxPrefs } from "./fakes.ts";

const fx = fakeWmux({ inWmux: true });
after(fx.cleanup);

const { default: wmuxTheme } = await import("../extensions/wmux-theme.ts");

/**
 * The watcher runs on its own clock, so these tests wait for the effect rather than
 * sleeping a fixed amount: QUIET_WAIT is several times the rebuild debounce it is
 * waiting out, and REBUILD_DEADLINE is well under the 2 000 ms poll the watch replaces,
 * so a rebuild that only happens on a schedule cannot make the positive assertion pass.
 */
const QUIET_WAIT = 500;
const REBUILD_DEADLINE = 1000;

type ThemeFile = { appearance: string; vars: Record<string, string>; export: Record<string, string> };

const readTheme = (): ThemeFile | undefined => {
  try {
    return JSON.parse(readFileSync(fx.themeOut, "utf-8")) as ThemeFile;
  } catch {
    return undefined; // not written yet, or caught mid-write
  }
};

/** poll until the generated file says what it should; null if it never does in time */
async function themeWhenAppearance(appearance: string): Promise<ThemeFile | null> {
  const deadline = Date.now() + REBUILD_DEADLINE;
  for (;;) {
    const theme = readTheme();
    if (theme?.appearance === appearance) return theme;
    if (Date.now() >= deadline) return null;
    await delay(25);
  }
}

/**
 * How these tests make "a rebuild happened" observable at all. A rebuild that reads
 * unchanged prefs writes nothing, because of the write-only-if-changed guard, so the
 * signal comes from wmux's `.theme` FILE: a rebuild re-reads it, and it lives in the
 * fixture's themes dir, which is deliberately NOT watched. Rewriting it therefore
 * changes what the NEXT rebuild produces without touching any watched name.
 */
const setWmuxThemeFile = (text: string) => writeFileSync(path.join(fx.themeFilesDir, "seam-dark.theme"), text, "utf-8");

/**
 * The decoys the name filter has to ignore, written in wmux's own atomic shape (temp sibling
 * + rename). wmux keeps plenty besides its prefs in that one directory: its pty ledger, its
 * version stamp (app-version.txt), its log directory, its Chromium profile and its pipe
 * token; plus
 * session state and rotating backups (session.json, session.json.bak[.1-3]) and
 * metadata.json(.bak) are files sitting in the real %APPDATA%\wmux. NONE of them was seen
 * generating an event while watching: the only churn the live watch log recorded is
 * `change sessions` twice roughly every 30 s, which is why `sessions` is on this list.
 */
const WMUX_CHURN = ["session.json", "session.json.bak.3", "pty-ledger.json", "app-version.txt", "metadata.json", "pipe-token", "settings.json.tmp"];
const WMUX_CHURN_DIRS = ["sessions", "logs", "chromium"];

test("wmux saving its prefs rebuilds the theme file; every other write in that directory does not", async (t) => {
  const pi = fakePi("dark");
  wmuxTheme(pi.api);
  await pi.startSession(); // cold start first: the file must exist before pi is asked to select it
  assert.equal(readTheme()?.appearance, "dark");

  setWmuxThemeFile(LIGHT_THEME); // from here, any rebuild would produce pi's light base

  // wmux's own churn, in its own atomic shape (temp sibling + rename), including the
  // temp file of the prefs themselves — the case a filter sloppier than an exact name
  // match would react to.
  for (const file of WMUX_CHURN) wmuxSave(path.join(fx.prefsDir, file), "{}");
  for (const dir of WMUX_CHURN_DIRS) mkdirSync(path.join(fx.prefsDir, dir), { recursive: true });
  await delay(QUIET_WAIT);
  assert.equal(readTheme()?.appearance, "dark", "a change that does not name settings.json rebuilt pi's theme");

  // The same atomic write, this time naming the prefs file: that is what changing the
  // theme in wmux's Settings → Terminal ends as. The prefs still name seam-dark, so the
  // only thing the rebuild can pick up is the .theme file rewritten above.
  const started = Date.now();
  writeWmuxPrefs(fx.prefsFile, "seam-dark");
  const theme = await themeWhenAppearance("light");
  t.diagnostic(`prefs save → rebuilt theme file in ${Date.now() - started} ms (deadline ${REBUILD_DEADLINE}, old poll up to 2000)`);
  assert.ok(theme, `a prefs save did not rebuild the theme within ${REBUILD_DEADLINE} ms`);
  assert.equal(theme.vars.text, "#1a1a1a"); // the light fixture's foreground …
  assert.equal(theme.export.pageBg, "#f5f5f5"); // … and background, i.e. it really re-read

  await pi.endSession();
});

test("session_shutdown releases the watch, so a later save changes nothing", async () => {
  const pi = fakePi("dark");
  wmuxTheme(pi.api);
  await pi.startSession();

  setWmuxThemeFile(DARK_THEME); // the same live proof as above, before the shutdown
  writeWmuxPrefs(fx.prefsFile, "seam-dark");
  assert.ok(await themeWhenAppearance("dark"), "the watch was not live at session_start to begin with");

  await pi.endSession();
  await pi.endSession(); // idempotent: closing twice must not throw

  setWmuxThemeFile(LIGHT_THEME); // a rebuild would now go back to pi's light base
  writeWmuxPrefs(fx.prefsFile, "seam-dark");
  await delay(QUIET_WAIT);
  assert.equal(readTheme()?.appearance, "dark", "a save after session_shutdown still rebuilt the theme — the watch was left open");
});
