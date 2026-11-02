/**
 * End-to-end seam, the source-checkout layout: a wmux run from a checkout points WMUX_CLI at
 * its BUILT `dist/cli`, while the `.theme` files stay in `resources/` — the one shape where
 * reading the themes directory off WMUX_CLI needs more than one `..`, and the case that once
 * made a theme found only in a checkout resolve to nothing. Its own file because the
 * extension reads WMUX_CLI once, at module load — see the header of test/fakes.ts.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { after, test } from "node:test";
import { fakePi, fakeWmux } from "./fakes.ts";

const fx = fakeWmux({ inWmux: true, cliLayout: "checkout" }); // WMUX_CLI in dist/cli, themes in resources/themes
after(fx.cleanup);

const { default: wmuxPalette } = await import("../extensions/wmux-palette.ts");

test("a wmux running from a source checkout still finds its themes", async () => {
  const pi = fakePi("dark");
  wmuxPalette(pi.api);
  await pi.startSession();

  // No themes directory found would mean no theme file at all: wmux's palette would resolve
  // to an empty one and buildWmuxTheme returns null.
  const theme = JSON.parse(readFileSync(fx.themeOut, "utf-8"));
  assert.equal(theme.vars.text, "#f0f0f0"); // the fixture palette's foreground, from resources/themes
  assert.ok(pi.notices.some((n) => n.includes("seam-dark")), `no notice names the wmux theme: ${pi.notices}`);
});
