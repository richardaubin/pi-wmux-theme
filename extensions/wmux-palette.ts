/**
 * wmux-palette — pi takes wmux's terminal colours, and keeps taking them when the
 * user changes wmux's theme in Settings → Terminal.
 *
 * Why (measured 2026-11-02, wmux 2.54.0, pi 1.4.0):
 * pi tints its user-message, tool, diff and search panels with colours it DERIVES
 * from the palette the terminal reports about itself over OSC 10/11/4. Nothing can
 * answer that from inside a ConPTY shell — only the app attached to the pty can,
 * and xterm.js answers an OSC 11 query only when a real pty is attached to it,
 * which in wmux it never is (main's PtyManager owns the pty). So pi's request
 * stays pending and it paints its built-in greys: the coloured blocks that are
 * plain in Windows Terminal are nearly invisible in wmux. wmux itself has a full
 * palette (resources/themes/*.theme plus a userColorSchemes override in its prefs)
 * and only ever writes it to xterm — it never tells pi.
 *
 * This closes the gap without patching wmux: generate pi's own theme from wmux's
 * palette and drop it at <agent-dir>/themes/wmux.json, the one path pi hot-reloads
 * (docs/themes.md, "Create a custom theme"). Refresh while wmux's prefs or theme
 * file change, so a theme change lands in pi within a couple of seconds.
 *
 * Only inside wmux. wmux's palette says nothing about Windows Terminal or any other
 * terminal, and a theme selection lives in pi's settings, which are global — so
 * outside wmux this file does not write, does not poll, and does the one thing that
 * is still its business: undo a wmux pick left over from an earlier wmux session.
 * That is the same gate wmux's own pi extension uses (wmux resources/pi-extension/wmux.js).
 *
 * Roll back: set "theme" back in <agent-dir>/settings.json and delete
 * <agent-dir>/themes/wmux.json.
 */
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

/**
 * pi's own agent directory — that is where its settings.json is and the only
 * place it hot-reloads the active theme from. It cannot be derived from this
 * file's location: an installed package lives in pi's package checkout, not under
 * <agent-dir>/extensions.
 * shortcut: a custom agent dir passed some other way than PI_CODING_AGENT_DIR
 * (the SDK's agentDir option) is not seen here; upgrade by reading it from pi.
 */
const AGENT_DIR = process.env.PI_CODING_AGENT_DIR || path.join(os.homedir(), ".pi", "agent");
const THEME_NAME = "wmux";
const THEME_OUT = path.join(AGENT_DIR, "themes", `${THEME_NAME}.json`);
// The theme setting pi had before this extension picked "wmux", kept so a session
// started outside wmux can be put back to it. shortcut: a hand-written value is
// assumed to be a plain theme name; an auto "a/b" setting falls back to "system".
const ORIGINAL_THEME_FILE = path.join(AGENT_DIR, "wmux-palette-original-theme.txt");
// wmux's own persisted prefs block (src/renderer/store/settings-slice.ts,
// STORAGE_KEYS.terminalPrefs = "wmux-terminal-prefs").
const WMUX_SETTINGS = path.join(process.env.APPDATA ?? "", "wmux", "settings.json");
const POLL_MS = 2000;

// wmux sets these in every shell it spawns; pi loads packages everywhere.
const IN_WMUX = process.env.WMUX === "1" && !!process.env.WMUX_SURFACE_ID;

/**
 * Where wmux keeps its .theme files: resources/themes next to the CLI it injected
 * into the shell (WMUX_CLI), else the installed app, else a dev checkout.
 */
function wmuxThemesDirs(): string[] {
  const dirs: string[] = [];
  if (process.env.WMUX_CLI) dirs.push(path.join(path.dirname(process.env.WMUX_CLI), "..", "themes"));
  if (process.env.PROGRAMFILES) dirs.push(path.join(process.env.PROGRAMFILES, "wmux", "resources", "themes"));
  dirs.push("C:\\Program Files\\wmux\\resources\\themes", "L:\\repos\\wmux\\resources\\themes");
  return dirs.filter((d) => {
    try {
      return fs.statSync(d).isDirectory();
    } catch {
      return false;
    }
  });
}

/** pi's built-in dark.json / light.json, used as the token base. */
function piThemeDir(): string | null {
  const roots: string[] = [];
  try {
    roots.push(path.join(path.dirname(fileURLToPath(import.meta.resolve("@earendil-works/pi-coding-agent"))), "modes", "interactive", "theme"));
  } catch {
    /* not resolvable from here; fall through to the global npm layout */
  }
  if (process.env.APPDATA) {
    roots.push(path.join(process.env.APPDATA, "npm", "node_modules", "@earendil-works", "pi-coding-agent", "dist", "modes", "interactive", "theme"));
  }
  return roots.find((d) => fs.existsSync(path.join(d, "dark.json"))) ?? null;
}

const normColor = (c?: string): string => {
  const v = (c ?? "").trim();
  if (!v) return "";
  return v.startsWith("#") ? v : /^[0-9a-fA-F]{6}$/.test(v) ? `#${v}` : v;
};

export interface WmuxThemeFile {
  background: string;
  foreground: string;
  selectionBackground: string;
  palette: string[];
}

/** Ghostty-format .theme file → the fields wmux's parseThemeFileContent keeps. */
export function parseWmuxTheme(text: string): WmuxThemeFile {
  const theme: WmuxThemeFile = { background: "", foreground: "", selectionBackground: "", palette: new Array(16).fill("") };
  for (const line of text.split(/\r?\n/)) {
    if (line.trimStart().startsWith("#")) continue;
    const m = /^\s*([a-zA-Z-]+)\s*=\s*(.+?)\s*$/.exec(line);
    if (!m) continue;
    const [, key, raw] = m;
    if (key === "palette") {
      const pm = /^(\d{1,2})\s*=\s*(.+)$/.exec(raw);
      if (pm) theme.palette[Number(pm[1])] = normColor(pm[2]);
    } else if (key === "background") theme.background = normColor(raw);
    else if (key === "foreground") theme.foreground = normColor(raw);
    else if (key === "selection-background") theme.selectionBackground = normColor(raw);
  }
  return theme;
}

export interface WmuxPalette extends WmuxThemeFile {
  name: string;
  themeFile?: string;
}

/**
 * wmux's own resolution order, mirrored: terminalPrefs.theme names a bundled
 * theme (case-insensitive) and a same-named userColorSchemes entry is merged over
 * it field by field, non-empty palette slots replacing their index. See wmux
 * src/main/theme-loader.ts getThemeByName and
 * src/renderer/hooks/useTerminal.ts buildXtermTheme.
 * shortcut: an unreadable wmux prefs file or an unresolvable theme name yields
 * null and pi keeps its current theme; wmux's own Monokai fallback is not
 * reproduced. If wmux ever moves its prefs, this returns null rather than wrong
 * colours.
 */
function readWmuxPalette(): WmuxPalette | null {
  let prefs: { theme?: string; userColorSchemes?: Record<string, Partial<WmuxThemeFile>> } | undefined;
  try {
    prefs = JSON.parse(fs.readFileSync(WMUX_SETTINGS, "utf-8"))["wmux-terminal-prefs"];
  } catch {
    return null;
  }
  if (!prefs || typeof prefs.theme !== "string") return null;

  const wanted = prefs.theme.toLowerCase();
  let themeFile: string | undefined;
  for (const dir of wmuxThemesDirs()) {
    for (const entry of fs.readdirSync(dir)) {
      if (path.parse(entry).name.toLowerCase() === wanted) {
        themeFile = path.join(dir, entry);
        break;
      }
    }
    if (themeFile) break;
  }
  const base = themeFile ? parseWmuxTheme(fs.readFileSync(themeFile, "utf-8")) : { background: "", foreground: "", selectionBackground: "", palette: new Array(16).fill("") };

  const override = prefs.userColorSchemes?.[prefs.theme] ?? {};
  const palette = [...base.palette];
  if (Array.isArray(override.palette)) {
    for (let i = 0; i < override.palette.length && i < 16; i++) {
      if (override.palette[i]) palette[i] = normColor(override.palette[i]);
    }
  }
  const background = normColor(override.background) || base.background;
  const foreground = normColor(override.foreground) || base.foreground;
  if (!background || !foreground) return null;
  return { ...base, name: prefs.theme, background, foreground, palette, themeFile };
}

const toRgb = (c: string): number[] | null => {
  const v = normColor(c);
  const hex = /^#([\da-f]{3}|[\da-f]{6})$/i.exec(v)?.[1];
  if (!hex) return null;
  if (hex.length === 3) return [0, 1, 2].map((i) => parseInt(hex[i] + hex[i], 16));
  return [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16));
};
const toColor = (rgb: number[]): string => `#${rgb.map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0")).join("")}`;

/** base tinted toward target by t (0 = base, 1 = target). Both stay hex. */
export function mix(base: string, target: string, t: number): string {
  const a = toRgb(base) ?? [128, 128, 128];
  const b = toRgb(target) ?? [128, 128, 128];
  return toColor(a.map((v, i) => v + (b[i] - v) * t));
}

function luminance(c: string): number {
  const [r, g, b] = toRgb(c) ?? [128, 128, 128];
  const f = (raw: number) => {
    const v = raw / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}

/**
 * The tokens pi's built-in themes spell out literally. Everything else in those
 * files is already a variable reference (text, muted, blue, green, …) and follows
 * `vars` on its own, which is why this table is short. Bg tints are the palette
 * colour diluted toward the terminal background, which is what makes a block read
 * as that colour without washing out the text on it.
 */
export function wmuxTokens({ background: bg, foreground: fg, palette }: WmuxThemeFile) {
  const p = (i: number) => palette[i] || palette[i - 8] || palette[(i % 8) + (i > 7 ? 8 : 0)] || fg;
  return {
    vars: {
      text: fg,
      muted: mix(fg, bg, 0.42),
      violet: p(5),
      blue: p(4),
      green: p(2),
      red: p(1),
      yellow: p(3),
      blueBg: mix(bg, p(4), 0.28),
    },
    colors: {
      border: mix(bg, p(4), 0.75),
      borderAccent: p(5),
      borderMuted: mix(fg, bg, 0.6),
      dim: mix(fg, bg, 0.58),
      thinkingText: mix(fg, bg, 0.38),
      scrollbarTrack: mix(bg, fg, 0.08),
      scrollbarThumb: mix(fg, bg, 0.45),
      searchMatchBg: mix(bg, p(3), 0.4),
      searchMatchText: fg,
      customMessageBg: mix(bg, p(5), 0.26),
      toolPendingBg: mix(bg, p(8), 0.5),
      toolSuccessBg: mix(bg, p(2), 0.26),
      toolErrorBg: mix(bg, p(9), 0.3),
      syntaxVariable: p(6),
      syntaxString: p(3),
      thinkingOff: mix(fg, bg, 0.65),
      thinkingMinimal: mix(p(8), p(5), 0.25),
      thinkingLow: mix(p(8), p(5), 0.5),
      thinkingMedium: p(5),
      thinkingHigh: mix(p(5), p(9), 0.45),
      thinkingXhigh: mix(p(5), p(9), 0.85),
      thinkingMax: p(9),
      bashMode: p(2),
    },
    export: { pageBg: bg, cardBg: mix(bg, fg, 0.05), infoBg: mix(bg, p(3), 0.4) },
  };
}

/** Which built-in base a wmux background needs; pi's themes are per-appearance. */
export function appearanceFor(background: string): "dark" | "light" {
  return luminance(background) < 0.4 ? "dark" : "light";
}

/** Build the whole theme document: pi's built-in base + wmux's palette over it. */
export function buildWmuxTheme(): { theme: Record<string, unknown>; source: string } | null {
  const wmux = readWmuxPalette();
  const dir = piThemeDir();
  if (!wmux || !dir) return null;
  const appearance = appearanceFor(wmux.background);
  const base = JSON.parse(fs.readFileSync(path.join(dir, `${appearance}.json`), "utf-8"));
  const tokens = wmuxTokens(wmux);
  return {
    theme: {
      ...base,
      name: THEME_NAME,
      appearance,
      vars: { ...base.vars, ...tokens.vars },
      colors: { ...base.colors, ...tokens.colors },
      export: { ...base.export, ...tokens.export },
    },
    source: `${wmux.name} (${wmux.themeFile ?? "prefs only"})`,
  };
}

/**
 * Write it if it changed. Returns a one-line description, or null if nothing was derivable.
 *
 * Temp file + rename, the way wmux saves its own prefs (wmux src/main/claude-context.ts
 * writeJsonAtomic): several panes rewrite this one file, and an interrupted in-place
 * rewrite leaves a truncated file pi fails to parse — pi swallows that error and does
 * not retry, so every pane keeps stale colours and nobody is told. renameSync maps onto
 * MoveFileExW/MOVEFILE_REPLACE_EXISTING, so the path is never absent and never half-full.
 * The write-if-changed guard stays: the duplicate writes from the other panes are no-ops.
 * shortcut: on Windows the rename fails with EPERM if another process is holding the
 * target open at that moment (measured) — pi reads this file open-read-close and never
 * holds it, and the next change retries, so no fallback is worth its cost yet.
 */
export function writeWmuxTheme(): string | null {
  const built = buildWmuxTheme();
  if (!built) return null;
  const json = `${JSON.stringify(built.theme, null, 2)}\n`;
  let previous: string | null = null;
  try {
    previous = fs.readFileSync(THEME_OUT, "utf-8");
  } catch {
    /* first run */
  }
  if (previous !== json) {
    // pid in the name: the panes each write the same target, and two of them sharing one
    // temp path would mean one rename stealing the other's file.
    const tmp = `${THEME_OUT}.${process.pid}.tmp`;
    fs.mkdirSync(path.dirname(THEME_OUT), { recursive: true });
    try {
      fs.writeFileSync(tmp, json, "utf-8");
      fs.renameSync(tmp, THEME_OUT);
    } catch (error) {
      try {
        fs.rmSync(tmp, { force: true }); // a leftover temp would sit in the dir pi watches
      } catch {
        /* the temp is already gone, or locked by whatever failed the write */
      }
      throw error;
    }
  }
  return `${built.theme.appearance} from ${built.source}`;
}

const readSettingFile = (file: string): string | undefined => {
  try {
    return fs.readFileSync(file, "utf-8").trim() || undefined;
  } catch {
    return undefined;
  }
};

export default function wmuxPalette(pi: ExtensionAPI) {
  // Outside wmux: no palette is derivable and none should be used. Restore the theme
  // setting a wmux session left behind, so Windows Terminal keeps its own colours.
  if (!IN_WMUX) {
    pi.on("session_start", async (_event, ctx) => {
      if (ctx.hasUI && pi.getSettings().theme === THEME_NAME) {
        const back = readSettingFile(ORIGINAL_THEME_FILE) ?? "system";
        const result = ctx.ui.setTheme(back);
        ctx.ui.notify?.(result.success ? `wmux palette: not inside wmux, theme back to "${back}"` : "wmux palette: not inside wmux, but the theme could not be put back", result.success ? "info" : "warning");
      }
    });
    pi.registerCommand("wmux-palette", {
      description: "Rewrite pi's `wmux` theme from wmux's current terminal palette",
      handler: async (_args, ctx) => ctx.ui.notify?.("wmux palette: this session is not running inside wmux (WMUX=1 is not set)", "warning"),
    });
    return;
  }

  // Pi cannot detect that wmux draws OSC 8 links; wmux's own extension does the same
  // for the image protocol. Settings are global, so it belongs here.
  process.env.PI_HYPERLINKS ??= "1";

  let last: string | null = null;
  const refresh = (): string | null => {
    let result: string | null = null;
    try {
      result = writeWmuxTheme();
    } catch (error) {
      console.warn("[wmux-palette] could not read wmux's palette:", (error as Error)?.message ?? error);
      return null;
    }
    const changed = result !== last;
    last = result;
    return changed ? result : null;
  };

  // A poll, not a watcher: wmux writes its prefs debounced and atomically, and
  // re-deriving the palette costs two small file reads. Watching the prefs file
  // would mean re-attaching a watcher every time the theme NAME changes. Only the
  // file is rewritten here — pi watches <agent-dir>/themes and reloads the active
  // theme from it, so the new colours land by themselves.
  // Started from session_start, not the factory: pi loads extensions for invocations
  // that never start a session (docs/extensions.md, "Understand the runtime lifecycle").
  let timer: ReturnType<typeof setInterval> | undefined;
  const stopPolling = () => {
    if (timer) clearInterval(timer);
    timer = undefined;
  };
  const startPolling = () => {
    stopPolling();
    timer = setInterval(refresh, POLL_MS);
    timer.unref?.();
  };

  /** Select the generated theme by name, which is what arms pi's reload watcher. */
  const select = (ctx: ExtensionContext): boolean => {
    const current = pi.getSettings().theme;
    if (current && current !== THEME_NAME) {
      try {
        fs.writeFileSync(ORIGINAL_THEME_FILE, current, "utf-8");
      } catch {
        /* losing it only costs the undo outside wmux */
      }
    }
    refresh();
    // print and JSON mode have no UI, so there is no theme to switch there; the
    // file is still written, so the colours are ready for the next interactive run.
    if (!ctx.hasUI) return false;
    const applied = ctx.ui.setTheme(THEME_NAME);
    if (!applied.success) {
      ctx.ui.notify?.(`wmux palette: pi could not load its "${THEME_NAME}" theme: ${applied.error ?? "unknown reason"}`, "warning");
    }
    return applied.success;
  };

  pi.on("session_start", async (_event, ctx) => {
    startPolling();
    if (select(ctx)) ctx.ui.notify?.(`wmux palette: ${last} (pi theme "${THEME_NAME}")`, "info");
  });
  pi.on("session_shutdown", () => stopPolling());

  pi.registerCommand("wmux-palette", {
    description: "Rewrite pi's `wmux` theme from wmux's current terminal palette",
    handler: async (_args, ctx) => {
      const selected = select(ctx);
      ctx.ui.notify?.(last ? `wmux palette: ${last}${selected ? " (pi theme \"wmux\")" : " — theme not selected"}` : "wmux palette not found — is wmux's settings.json readable?", last ? "info" : "warning");
    },
  });
}
