import assert from "node:assert/strict";
import test from "node:test";
import { appearanceFor, mix, parseWmuxTheme, wmuxTokens } from "../extensions/wmux-palette.ts";

// The format wmux's own .theme files use (resources/themes/*.theme).
const SAMPLE = `# Ayu Dark — https://github.com/ayu-theme/ayu-colors
background = #0f1419
foreground = #b3b1ad
cursor-color = #e6b450
selection-background = #253340
palette = 0=#01060e
palette = 1=#ea6c73
palette = 9=#f07178
`;

test("parseWmuxTheme keeps only the fields wmux's parser keeps", () => {
  const theme = parseWmuxTheme(SAMPLE);
  assert.equal(theme.background, "#0f1419");
  assert.equal(theme.foreground, "#b3b1ad");
  assert.equal(theme.selectionBackground, "#253340");
  assert.equal(theme.palette.length, 16);
  assert.deepEqual([theme.palette[0], theme.palette[1], theme.palette[9]], ["#01060e", "#ea6c73", "#f07178"]);
  assert.equal(theme.palette.filter(Boolean).length, 3); // palette 2-8, 10-15 stay empty
});

test("parseWmuxTheme adds # to a bare hex slot", () => {
  assert.equal(parseWmuxTheme("background = ffffff").background, "#ffffff");
  assert.equal(parseWmuxTheme("foreground = lightgray").foreground, "lightgray"); // a named colour passes through, as wmux keeps it
  assert.equal(parseWmuxTheme("palette = 3=abcdef").palette[3], "#abcdef");
});

test("appearanceFor chooses the built-in base pi theme from the background", () => {
  assert.equal(appearanceFor("#0f1419"), "dark");
  assert.equal(appearanceFor("#fafafa"), "light");
});

test("wmuxTokens maps palette slots to roles and never emits a non-hex colour", () => {
  const palette = Array.from({ length: 16 }, (_, i) => `#${(i * 8 + 8).toString(16).padStart(2, "0").repeat(3)}`);
  const tokens = wmuxTokens({ background: "#0f1419", foreground: "#b3b1ad", selectionBackground: "", palette });
  assert.equal(tokens.vars.green, palette[2]);
  assert.equal(tokens.vars.red, palette[1]);
  assert.equal(tokens.colors.toolErrorBg, mix("#0f1419", palette[9], 0.3));
  for (const value of Object.values(tokens.colors)) assert.match(String(value), /^#[\da-f]{6}$/);
});

test("wmuxTokens falls back to the foreground when the palette is empty", () => {
  const tokens = wmuxTokens({ background: "#000000", foreground: "#b3b1ad", selectionBackground: "", palette: new Array(16).fill("") });
  assert.equal(tokens.vars.blue, "#b3b1ad");
});
