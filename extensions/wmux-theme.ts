/**
 * wmux-theme — pi takes wmux's terminal colours, and keeps taking them when the
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
 * (pi's "create a custom theme" docs). wmux's own prefs WRITE is watched, so a
 * theme change lands in pi in about 150 ms and nothing at all happens while nothing
 * changes.
 *
 * Only inside wmux, and only for the session it started in. Outside wmux (WMUX=1 plus a
 * surface id unset — the same gate wmux's own pi extension uses) it registers nothing: no
 * handler, no command, nothing written, nothing watched, so pi paints whatever its own
 * settings say. Inside wmux the theme is handed to pi as a VALUE, not as a name, because
 * pi writes a theme it is given by name into its global settings — and a theme picked for
 * wmux must not follow pi into Windows Terminal, where wmux's palette says nothing about
 * the colours that terminal really has.
 *
 * Roll back: delete <agent-dir>/themes/wmux.json. Nothing else has to be undone — pi's
 * settings never mention "wmux".
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
// wmux's own persisted prefs block: the "wmux-terminal-prefs" key of that file.
const WMUX_SETTINGS = path.join(process.env.APPDATA ?? "", "wmux", "settings.json");
// Watched as a DIRECTORY, not as a file: wmux saves by writing settings.json.tmp in the
// same directory and renaming it over the target, and a watcher bound to a path is lost when
// the file behind it is replaced (pi runs into the same thing with git's HEAD, and watches a
// directory for the same reason). A directory watch also
// covers a wmux that has not written its prefs yet, since it reports creation too.
const WMUX_SETTINGS_DIR = path.dirname(WMUX_SETTINGS);
const WMUX_SETTINGS_NAME = path.basename(WMUX_SETTINGS);
// Measured against a live wmux 2.54.0 on 2026-11-02 (fs.watch, non-recursive, on
// %APPDATA%\wmux; four real prefs saves, the two of .agent-notes/live-burst.log and the two
// of live-check.out): idle gives 0 events in 1 s, and ONE save gives 4–6 events inside 1 ms
// — always exactly 2 rename events naming settings.json, the other 2–4 naming
// settings.json.tmp. The only other churn seen in those windows is the sessions\ entry
// changing twice roughly every 30 s while terminals run; the session.json(.bak*),
// pty-ledger.json, logs\, app-version.txt and Chromium profile sitting in that directory
// generated no event at all. So the name filter is what stops pi rebuilding every half
// minute, and one short timer is what makes one save one rebuild: the write landed 162 ms
// and 166 ms after the first matching event, against up to 2 s for the poll this replaces
// (the same shape driven by the automated test: 161–189 ms).
const REBUILD_DEBOUNCE_MS = 150; // pi debounces its own reload of the file this writes at 100 ms
const WATCH_REARM_MS = 5000; // the delay pi uses for its own failed fs.watch handles

// wmux sets these in every shell it spawns; pi loads packages everywhere.
const IN_WMUX = process.env.WMUX === "1" && !!process.env.WMUX_SURFACE_ID;

/**
 * Where wmux keeps its .theme files: `resources/themes` inside the app that owns this
 * shell, reached from WMUX_CLI. Packaged, wmux points it at `<install>/resources/cli/wmux.js`,
 * so its themes are one directory up; run from a source checkout it sits in the built
 * `dist/cli/`, so its themes are two up and into `resources/`. PROGRAMFILES covers an
 * installed wmux whose CLI variable is missing from the shell.
 */
function wmuxThemesDirs(): string[] {
  const dirs: string[] = [];
  if (process.env.WMUX_CLI) {
    const cli = path.dirname(process.env.WMUX_CLI);
    dirs.push(path.join(cli, "..", "themes"), path.join(cli, "..", "..", "resources", "themes"));
  }
  if (process.env.PROGRAMFILES) dirs.push(path.join(process.env.PROGRAMFILES, "wmux", "resources", "themes"));
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
 * it field by field, non-empty palette slots replacing their index.
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
 * Replace `target` with `content`: a temp file in the SAME directory, renamed over it, and
 * no temp left behind if either step fails. Never an in-place rewrite, because several panes
 * write both of the files this does it for, and one that dies mid-write leaves a truncated
 * theme pi silently fails to parse, or a truncated rollback marker a later session restores
 * as a garbage theme name. renameSync maps onto MoveFileExW/MOVEFILE_REPLACE_EXISTING, so the
 * path is never absent and never half-full. The same shape wmux uses for its own prefs
 * and for its other temp files named with a pid.
 */
function replaceFileAtomically(target: string, content: string): void {
  // pid in the name: the panes each write the same target, and two of them sharing one
  // temp path would mean one rename stealing the other's file.
  const tmp = `${target}.${process.pid}.tmp`;
  fs.mkdirSync(path.dirname(target), { recursive: true });
  try {
    fs.writeFileSync(tmp, content, "utf-8");
    fs.renameSync(tmp, target);
  } catch (error) {
    try {
      fs.rmSync(tmp, { force: true }); // a leftover temp would sit in the dir pi watches
    } catch {
      /* the temp is already gone, or locked by whatever failed the write */
    }
    throw error;
  }
}

/**
 * Write it if it changed. Returns a one-line description, or null if nothing was derivable.
 *
 * Temp file + rename (see replaceFileAtomically) because several panes rewrite this one
 * file, and an interrupted in-place rewrite leaves a truncated file pi fails to parse — pi
 * swallows that error and does not retry, so every pane keeps stale colours and nobody is
 * told. The write-if-changed guard stays: the duplicate writes from the other panes are
 * no-ops.
 * shortcut: a failed replace is not retried on a timer — pi keeps the previous file and the
 * next change writes again. A rename fails to land only when the SAME process holds the
 * target open (EPERM, measured on this machine); this extension never opens what it writes,
 * and a reader in ANOTHER process does not block it, libuv having opened that handle with
 * FILE_SHARE_DELETE (also measured).
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
  if (previous !== json) replaceFileAtomically(THEME_OUT, json);
  return `${built.theme.appearance} from ${built.source}`;
}

export default function wmuxTheme(pi: ExtensionAPI) {
  // Outside wmux this does not run at all: no handler, no command, no write, no watch.
  // What pi's own settings say about its theme is nobody else's business.
  if (!IN_WMUX) return;

  // Pi cannot detect that wmux draws OSC 8 links; wmux's own extension does the same
  // for the image protocol. Settings are global, so it belongs here.
  process.env.PI_HYPERLINKS ??= "1";

  let last: string | null = null;
  // The session showing the theme, so a rebuild can put the new colours back.
  let shown: ExtensionContext | undefined;

  /**
   * Show the theme this file describes. What pi is handed is the theme VALUE it loads from
   * that file, not the name: pi persists a theme named to it in its global settings, and an
   * in-memory theme dies with the session — that is what keeps a wmux palette out of pi
   * started anywhere else. It also means pi's own reload of its themes directory no longer
   * covers this file, so every rebuild has to come back through here.
   * shortcut: the file still sits in <agent-dir>/themes, so pi's theme picker lists "wmux"
   * outside wmux too; nothing selects it there.
   */
  const show = (ctx: ExtensionContext): boolean => {
    const theme = ctx.ui.getTheme(THEME_NAME);
    if (!theme) {
      ctx.ui.notify?.(`wmux theme: pi could not load its "${THEME_NAME}" theme — does ${THEME_OUT} exist?`, "warning");
      return false;
    }
    ctx.ui.setTheme(theme);
    return true;
  };

  const refresh = (): string | null => {
    let result: string | null = null;
    try {
      result = writeWmuxTheme();
    } catch (error) {
      console.warn("[wmux-theme] could not read wmux's palette:", (error as Error)?.message ?? error);
      return null;
    }
    const changed = result !== last;
    last = result;
    return changed ? result : null;
  };

  // The trigger is wmux's own save, not a schedule: nothing is read and no timer fires
  // while nothing has changed, and a save made in another wmux window or pane reaches
  // this session too. Only the theme file is rewritten here — pi watches
  // <agent-dir>/themes and reloads the active theme from it, so the colours land on their
  // own. Deliberately NO backstop interval: a watch that dies without an error event goes
  // unnoticed until the next session_start, which re-reads anyway (the residual risk the
  // spec accepted). wmux's bundled .theme files are deliberately NOT watched either: wmux
  // caches them for the lifetime of its renderer, so pi would change colour ahead of what
  // wmux has actually applied.
  // Started from session_start, not the factory: pi loads extensions for invocations
  // that never start a session (pi's extension docs, "Understand the runtime lifecycle").
  let watcher: fs.FSWatcher | undefined;
  let debounce: ReturnType<typeof setTimeout> | undefined;
  let rearm: ReturnType<typeof setTimeout> | undefined;

  /** One save, one rebuild — and only a rebuild that changed the colours repaints. */
  const rebuild = () => {
    if (refresh() !== null && shown) show(shown);
  };

  const onPrefsSave: fs.WatchListener<string> = (_event, name) => {
    // A name means the platform knows which entry moved: only the prefs file is one.
    // No name means it could not say, so treat it as real rather than lose the change.
    if (name && name !== WMUX_SETTINGS_NAME) return;
    clearTimeout(debounce); // the burst lands in one millisecond: one trailing timer, one rebuild
    debounce = setTimeout(rebuild, REBUILD_DEBOUNCE_MS);
    debounce.unref();
  };

  const stopWatching = () => {
    clearTimeout(debounce);
    clearTimeout(rearm);
    debounce = rearm = undefined;
    try {
      watcher?.close();
    } catch {
      /* already closed */
    }
    watcher = undefined;
  };

  const startWatching = () => {
    stopWatching();
    let next: fs.FSWatcher;
    try {
      next = fs.watch(WMUX_SETTINGS_DIR, onPrefsSave);
    } catch {
      rearm = setTimeout(startWatching, WATCH_REARM_MS); // the directory is missing until wmux first saves
      rearm.unref();
      return;
    }
    // how a dropped watch shows up (sleep/resume, transient I/O): close this handle, watch
    // again after the delay pi uses for the same failure. Deliberately NOT stopWatching():
    // that would also discard the rebuild a save has already queued.
    next.on("error", () => {
      try {
        next.close();
      } catch {
        /* already closed */
      }
      rearm = setTimeout(startWatching, WATCH_REARM_MS);
      rearm.unref();
    });
    // like the interval it replaces, this must not hold pi's process open
    next.unref();
    watcher = next;
  };

  /** Write pi's theme file, then show what it describes in this session. */
  const select = (ctx: ExtensionContext): boolean => {
    shown = ctx;
    refresh();
    // print and JSON mode have no UI, so there is no theme to switch there; the
    // file is still written, so the colours are ready for the next interactive run.
    if (!ctx.hasUI) return false;
    return show(ctx);
  };

  pi.on("session_start", async (_event, ctx) => {
    if (select(ctx)) ctx.ui.notify?.(`wmux theme: ${last} (pi theme "${THEME_NAME}", this session only)`, "info");
    startWatching();
  });
  pi.on("session_shutdown", () => stopWatching());

  pi.registerCommand("wmux-theme", {
    description: "Rewrite pi's `wmux` theme from wmux's current terminal palette",
    handler: async (_args, ctx) => {
      const selected = select(ctx);
      ctx.ui.notify?.(last ? `wmux theme: ${last}${selected ? ` (pi theme "${THEME_NAME}", this session only)` : " — theme not shown"}` : "wmux theme: no wmux palette found — is wmux's settings.json readable?", last ? "info" : "warning");
    },
  });
}
