/**
 * Stand-in wmux and stand-in pi, for the end-to-end tests that drive the whole
 * extension (issue #2).
 *
 * Why a test cannot just import the extension: it reads PI_CODING_AGENT_DIR,
 * APPDATA, WMUX/WMUX_SURFACE_ID and WMUX_CLI once, at module load, and a static
 * import is hoisted above any `process.env` assignment in the same file. So each
 * end-to-end test file builds its fixture, sets the environment, and only then
 * `await import`s the module — which also means the inside-wmux and outside-wmux
 * cases must live in separate files, because one process gets one module instance
 * with one gate. `node --test` runs each file in its own process.
 *
 * This file must NOT import the extension: importing it here would freeze the
 * environment of whichever test file happened to import fakes first.
 */
import { mkdirSync, mkdtempSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { ExtensionAPI, ExtensionCommandContext, SessionShutdownEvent, SessionStartEvent } from "@earendil-works/pi-coding-agent";

/**
 * pi's built-in base tokens come from whichever pi is installed (piThemeDir()
 * resolves the peer dependency and no env var redirects it), so the end-to-end
 * assertions only check values that are derived from THESE fixture colours.
 */
export const DARK_THEME = `# seam fixture, not a wmux theme — ghostty format, like wmux's resources/themes/*.theme
background = #101010
foreground = #f0f0f0
selection-background = #303030
palette = 0=#080808
palette = 1=#ff0000
palette = 2=#00ff00
palette = 3=#ffff00
palette = 4=#0000ff
palette = 5=#ff00ff
palette = 6=#00ffff
palette = 7=#e0e0e0
palette = 8=#808080
palette = 9=#ff8080
palette = 10=#80ff80
palette = 11=#ffff80
palette = 12=#8080ff
palette = 13=#ff80ff
palette = 14=#80ffff
palette = 15=#ffffff
`;

/** A light background, to check the generated theme asks pi for the light base. */
export const LIGHT_THEME = `# seam fixture, not a wmux theme
background = #f5f5f5
foreground = #1a1a1a
selection-background = #d0d0d0
palette = 0=#080808
palette = 1=#ff0000
palette = 2=#00ff00
palette = 3=#ffff00
palette = 4=#0000ff
palette = 5=#ff00ff
palette = 6=#00ffff
palette = 7=#e0e0e0
palette = 8=#808080
palette = 9=#ff8080
`;

/**
 * A file saved the way wmux saves them: write a fixed `.tmp` sibling in the SAME
 * directory, then rename it over the target, which is how wmux replaces its own prefs.
 * Watching a *file* would miss
 * that replace, so the fixture has to reproduce it.
 */
export function wmuxSave(file: string, content: string) {
  const tmp = `${file}.tmp`;
  writeFileSync(tmp, content, "utf-8");
  renameSync(tmp, file);
}

/** wmux's own prefs path and key: %APPDATA%\wmux\settings.json, "wmux-terminal-prefs". */
export function writeWmuxPrefs(prefsFile: string, theme: string) {
  const userColorSchemes = { "seam-dark": { palette: ["", "#ee0000"] } }; // wmux's per-theme override: slot 1 replaces the file's, the empty slot 0 does not
  wmuxSave(prefsFile, JSON.stringify({ "wmux-terminal-prefs": { theme, userColorSchemes } }));
}

/**
 * A temp agent dir, a temp wmux app-data dir with its prefs, and a temp stand-in
 * for wmux's bundled themes dir, then the environment that points at them.
 * Everything is under one temp root, which cleanup() removes.
 */
export function fakeWmux({ inWmux, theme = "seam-dark", cliLayout = "bin" }: { inWmux: boolean; theme?: string; cliLayout?: "bin" | "checkout" }) {
  const root = mkdtempSync(path.join(tmpdir(), "wmux-palette-seam-"));
  const agentDir = path.join(root, "agent");
  const appData = path.join(root, "appdata");
  const wmuxDir = path.join(root, "wmux");
  const prefsFile = path.join(appData, "wmux", "settings.json");
  // An installed wmux keeps its themes one level above the CLI WMUX_CLI names; a source
  // checkout keeps them in resources/ while WMUX_CLI sits in the built dist/.
  const themeFilesDir = cliLayout === "checkout" ? path.join(wmuxDir, "resources", "themes") : path.join(wmuxDir, "themes");
  const cliDir = cliLayout === "checkout" ? path.join(wmuxDir, "dist", "cli") : path.join(wmuxDir, "bin");
  mkdirSync(themeFilesDir, { recursive: true });
  mkdirSync(path.join(appData, "wmux"), { recursive: true });
  mkdirSync(agentDir, { recursive: true });
  writeFileSync(path.join(themeFilesDir, "seam-dark.theme"), DARK_THEME, "utf-8");
  writeFileSync(path.join(themeFilesDir, "seam-light.theme"), LIGHT_THEME, "utf-8");
  writeWmuxPrefs(prefsFile, theme);

  process.env.PI_CODING_AGENT_DIR = agentDir;
  process.env.APPDATA = appData;
  // wmux injects WMUX_CLI into the shell; the themes sit next to what it points at.
  process.env.WMUX_CLI = path.join(cliDir, "wmux.exe");
  if (inWmux) {
    process.env.WMUX = "1";
    process.env.WMUX_SURFACE_ID = "7";
  } else {
    delete process.env.WMUX;
    delete process.env.WMUX_SURFACE_ID;
  }

  return {
    root,
    agentDir,
    prefsFile,
    prefsDir: path.join(appData, "wmux"), // what gets watched: settings.json and the files that churn around it
    themeFilesDir, // what must NOT be watched (wmux caches them per renderer)
    themeOut: path.join(agentDir, "themes", "wmux.json"),
    originalThemeFile: path.join(agentDir, "wmux-palette-original-theme.txt"),
    cleanup: () => rmSync(root, { recursive: true, force: true }),
  };
}

export const SESSION_START: SessionStartEvent = { type: "session_start", reason: "startup" };
export const SESSION_SHUTDOWN: SessionShutdownEvent = { type: "session_shutdown", reason: "quit" };

/**
 * The smallest pi the extension will accept: it only ever calls `on`,
 * `registerCommand` and `getSettings`, and a fake ctx only `hasUI` and
 * `ui.setTheme`/`ui.notify`. What the extension asks for is recorded in
 * `themes`/`notices` instead of painting anything.
 */
export function fakePi(theme?: string) {
  const handlers = new Map<string, (event: any, ctx: any) => unknown>();
  const commands = new Map<string, (args: string, ctx: any) => unknown>();
  const themes: string[] = [];
  const notices: string[] = [];

  const ctx = {
    hasUI: true,
    ui: {
      setTheme: (name: string) => {
        themes.push(name);
        return { success: true };
      },
      notify: (message: string) => {
        notices.push(message);
      },
    },
  } as unknown as ExtensionCommandContext;

  const api = {
    on: (event: string, handler: (event: any, ctx: any) => unknown) => {
      handlers.set(event, handler);
    },
    registerCommand: (name: string, options: { handler: (args: string, ctx: any) => unknown }) => {
      commands.set(name, options.handler);
    },
    getSettings: () => ({ theme }),
  } as unknown as ExtensionAPI;

  return {
    api,
    ctx,
    handlers,
    commands,
    themes,
    notices,
    /** the handlers the extension registers are async; await them like pi does */
    async startSession() {
      await handlers.get("session_start")?.(SESSION_START, ctx);
    },
    async endSession() {
      await handlers.get("session_shutdown")?.(SESSION_SHUTDOWN, ctx);
    },
    async runCommand(args = "") {
      await commands.get("wmux-palette")?.(args, ctx);
    },
  };
}
