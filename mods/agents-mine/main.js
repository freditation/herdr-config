// Agents in grouped or priority views; parents take their most urgent sub-agent's place.
// Sections: Running, Needs you, Idle, Archived. Bold = unread (Needs you and Idle) until looked at and left.
// The calendar icon opens a week of Claude cloud routines (routines.json).
// Keeps itself current: update.py, run at start and hourly, pulls the latest mods and hooks
// from github.com/freditation/herdr-config (see herdr-config.json below to turn it off).

import { View, div, image, svg } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
// Spaces: folders agents run in, listed above the agents, each with its own Claude color.
// Always there: this computer's DEFAULT_DIR (under home) and CLOUD_MACHINE's
// CLOUD_AGENT_FOLDER, a folder or a list of them (one cloud space each, say one per
// Claude account folder). A cloud space takes the color of the local space with the
// same folder name, so an account keeps its color on both machines; one with no twin
// gets Claude's orange if it's the first and nothing else claims the default, else a
// color of its own. Spaces and agents on CLOUD_MACHINE also get a cloud after their name;
// local ones get nothing there.
// The folder button adds local ones; right-click an added one to remove it.
// The selected space shows its agents and is where + starts one.
// Your settings live in ~/.config/herdr-app/herdr-config.json, which updates never touch:
// {"defaultDir": "", "cloudMachine": "", "cloudAgentFolder": "", "autoUpdate": true}.
// These are the defaults; the file is read at start and every 30 seconds.
let DEFAULT_DIR = "";
let CLOUD_MACHINE = "";
let CLOUD_AGENT_FOLDER = "";
let AUTO_UPDATE = true;
async function loadSettings() {
  try {
    const s = JSON.parse((await readTextFile(`${appHome()}/herdr-config.json`)) ?? "{}");
    if (typeof s.defaultDir === "string") DEFAULT_DIR = s.defaultDir;
    if (typeof s.cloudMachine === "string") CLOUD_MACHINE = s.cloudMachine;
    if (typeof s.cloudAgentFolder === "string" || Array.isArray(s.cloudAgentFolder)) CLOUD_AGENT_FOLDER = s.cloudAgentFolder;
    AUTO_UPDATE = s.autoUpdate !== false;
  } catch {}
}
const settingsLoaded = loadSettings();
const DIR_COLORS = ["#5B8DEF", "#3FAE6A", "#A472E8", "#2AA7B8", "#E05D9A", "#D4A72C"];

import { agents, terminals, panes, focused, spaces, run, theme, shared, setShared, setAgentOrder, openOverlay, closeOverlay, props, window, layout, home, appHome, exec, readTextFile, notify } from "herdr";

// Added spaces live in shared state (so the popup's copy of this mod sees them too), backed by localStorage.
function addedDirs() {
  let d = shared("agents-mine.dirs");
  if (!Array.isArray(d)) {
    try { d = JSON.parse(localStorage.getItem("dirs") ?? "[]"); } catch { d = []; }
    if (!Array.isArray(d)) d = [];
    setShared("agents-mine.dirs", d);
  }
  return d.filter((x) => x.color && !x.machine);
}
function dirsOf() {
  const fixed = [{ path: DEFAULT_DIR ? `${home()}/${DEFAULT_DIR}` : home(), color: null, machine: "", fixed: true }];
  if (CLOUD_MACHINE) fixed.push(...cloudDirs());
  return [...fixed, ...addedDirs().filter((x) => x.path !== fixed[0].path)];
}
// The cloud spaces, also shared ("agents-mine.cloud") so tabs-mine marks their tabs alike.
const baseName = (p) => p.replace(/\/+$/, "").split("/").pop();
function cloudDirs() {
  const folders = [CLOUD_AGENT_FOLDER].flat().filter(Boolean);
  const added = addedDirs();
  const locals = [{ path: DEFAULT_DIR ? `${home()}/${DEFAULT_DIR}` : home(), color: null }, ...added];
  const twin = (path) => locals.find((l) => baseName(l.path) === baseName(path));
  let defaultFree = !folders.some((path) => twin(path)?.color === null);
  const used = new Set(added.map((l) => l.color));
  const d = folders.map((path) => {
    let color = twin(path)?.color;
    if (color === undefined && defaultFree) { color = null; defaultFree = false; }
    if (color === undefined) color = DIR_COLORS.find((c) => !used.has(c)) ?? DIR_COLORS[used.size % DIR_COLORS.length];
    if (color) used.add(color);
    return { path, color, machine: CLOUD_MACHINE, fixed: true };
  });
  const share = d.map(({ path, color, machine }) => ({ path, color, machine }));
  if (JSON.stringify(shared("agents-mine.cloud") ?? []) !== JSON.stringify(share)) setShared("agents-mine.cloud", share);
  return d;
}
function saveDirs(d) {
  const added = d.filter((x) => !x.fixed).map(({ path, color }) => ({ path, color }));
  setShared("agents-mine.dirs", added);
  try { localStorage.setItem("dirs", JSON.stringify(added)); } catch {}
}
const dirKey = (d) => `${d.machine || ""}:${d.path}`;
function selectedDir(dirs = dirsOf()) {
  let k = shared("agents-mine.dir");
  if (k === undefined || k === null) { try { k = localStorage.getItem("dir"); } catch {} }
  return dirs.find((d) => dirKey(d) === k || (!d.machine && d.path === k)) ?? dirs[0];
}
function selectDir(d) {
  setShared("agents-mine.dir", dirKey(d));
  try { localStorage.setItem("dir", dirKey(d)); } catch {}
}
const tilde = (p) => (p === home() ? "~" : p.startsWith(`${home()}/`) ? `~${p.slice(home().length)}` : p);
const dirName = (p) => (p === home() ? "~" : p.split("/").pop());
// The space a folder on a machine ("" = this computer) belongs to: that machine's deepest
// space it's in, else that machine's first space, else the default.
function dirOf(path, machine, dirs = dirsOf()) {
  const mine = dirs.filter((d) => (d.machine || "") === (machine || ""));
  const hits = mine.filter((d) => path && (path === d.path || path.startsWith(`${d.path}/`)));
  return hits.sort((a, b) => b.path.length - a.path.length)[0] ?? mine[0] ?? dirs[0];
}
// A space's mark: Claude in its color (the default keeps Claude's orange), wherever it runs.
const claudeMark = (color, size) => (color
  ? svg("mods/agents-mine/claude-mono.svg").size(size).flex_none().text_color(color)
  : image("icons/claude.svg").w(size).h(size).flex_none());
const spaceMark = (d, size) => claudeMark(d?.color, size);
// Marks a space or agent on another machine, after its name.
const cloudIcon = (t) => svg("mods/agents-mine/cloud.svg").size(14).flex_none().text_color(t.dim);
const newAgent = (d) => run("space.new", { machine: d.machine || "", folder: d.path, argv: ["claude"] });

function find(node, id) {
  if (node?.id === id) return node;
  for (const child of node?.children ?? []) {
    const found = find(child, id);
    if (found) return found;
  }
  return null;
}

// The sidebar's rail goes by its width, not a flag: dragging its edge narrows it too.
const narrow = () => (find(layout(), "sidebar")?.size?.px ?? Infinity) < 160;

// To the rail (on macOS wide enough for the traffic lights), or back to the width it had.
function toggleSidebar() {
  const width = find(layout(), "sidebar")?.size?.px;
  if (!narrow()) setShared("sidebar.width", width);
  // Mods edited before the rail went by width still read the flag.
  setShared("sidebar.collapsed", !narrow());
  run("layout.resize", { id: "sidebar", px: narrow() ? (shared("sidebar.width") ?? 268) : window()?.platform === "macos" ? 76 : 44 });
}

const clean = (s) => (s ?? "").replace(/^[^\p{L}\p{N}]+/u, "").trim();

function lead(tab, all = panes()) {
  const mine = all.filter(p => p.tab === tab.id && p.terminal);
  return mine.find(p => p.program?.agent) ?? mine.find(p => p.focused) ?? mine[0];
}

function title(tab, l) {
  const prog = l?.program?.name;
  const live = clean(l?.title);
  const telling = live && live !== prog && !/^[~/]|^[A-Za-z]:\\/.test(live) && !live.includes("@") && live.toLowerCase() !== l?.program?.key;
  return (tab.name === prog || !tab.named) && telling ? live : tab.name;
}
// asking: ended its turn on a question (the herdr-asking Claude hook sets the
// `herdr.asking` label). It stays there, looked at or not, until you reply.
const RANK = { blocked: 4, asking: 3.5, done: 3, working: 2, idle: 1 };
// A sub-agent without a pane isn't in agents(): its raw word, error counting as
// blocked. It's never done: it reports to its parent, and the parent's done is the news.
const kidStatus = (k, listed) => {
  const s = listed.get(k.address) ?? k.status;
  return s === "error" ? "blocked" : s === "done" ? "idle" : s;
};
const SORTS = [
  { id: "priority", label: "Priority", icon: "clock" },
  { id: "grouped", label: "Grouped by space", icon: "layers" },
];
const sortOf = () => SORTS.find((s) => s.id === shared("agents.sort")) ?? SORTS[0];
// Blocked on a prompt and ended on a question share one section: either way it waits on you.
// Done and idle share Idle: a done agent there just keeps its filled dot until you look.
const SECTION = { 4: "Needs you", 2: "Running", 1: "Idle" };
const SECTION_STATUS = { 4: "blocked", 2: "working" };
const sectionOf = (rank) => (rank > 3 ? 4 : rank > 1 && rank < 3 ? 2 : 1);
// Display order, top to bottom: Running, Needs you, Idle (Archived follows separately).
const SECTION_ORDER = [2, 4, 1];
const sectionPos = (rank) => SECTION_ORDER.indexOf(sectionOf(rank));

// Cron, five fields, read in UTC as Claude's cloud routines use it.
function cronField(spec, v, lo, hi) {
  return spec.split(",").some((part) => {
    const [range, stepS] = part.split("/");
    const step = stepS ? +stepS : 1;
    let [a, b] = range === "*" ? [lo, hi] : range.split("-").map(Number);
    if (b === undefined) b = stepS ? hi : a;
    return v >= a && v <= b && (v - a) % step === 0;
  });
}
function cronDay(f, d) {
  const dom = cronField(f[2], d.getUTCDate(), 1, 31);
  const dow = cronField(f[4], d.getUTCDay(), 0, 7) || (d.getUTCDay() === 0 && cronField(f[4], 7, 0, 7));
  return cronField(f[3], d.getUTCMonth() + 1, 1, 12) && (f[2] !== "*" && f[4] !== "*" ? dom || dow : dom && dow);
}
// When a cron fires between two times (ms).
function cronTimes(expr, from, to) {
  const f = (expr ?? "").trim().split(/\s+/);
  if (f.length !== 5) return [];
  const out = [];
  for (let t = Math.ceil(from / 60000) * 60000; t < to && out.length < 1500; t += 60000) {
    const d = new Date(t);
    if (!cronDay(f, d) || !cronField(f[1], d.getUTCHours(), 0, 23)) { t += (59 - d.getUTCMinutes()) * 60000; continue; }
    if (cronField(f[0], d.getUTCMinutes(), 0, 59)) out.push(t);
  }
  return out;
}
const hhmm = (ms) => new Date(ms).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function duration(ms) {
  const m = Math.floor(ms / 60000);
  if (m < 1) return "<1m";
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  return h < 24 ? `${h}h` : `${Math.floor(h / 24)}d`;
}

// The agent's icon from the app's program table: a one-color glyph or a picture.
function icon(p, size, color) {
  if (!p?.icon) return null;
  return p.tint ? svg(p.icon).size(size).flex_none().text_color(color) : image(p.icon).w(size).h(size).flex_none();
}

// An agent on another machine (its address is `machine/t7`) gets a cloud instead.
const remoteOf = (address) => (address.includes("/") ? address.split("/")[0] : null);
const agentIcon = (a, size, color) => icon(a.program, size, color);

export default class Agents extends View {
  init(_props, cx) {
    // Every copy redraws once the settings are in (the spaces depend on them).
    cx.spawn(async (cx) => { await settingsLoaded; cx.notify(); });
    if (props()?.sortMenu || props()?.dirMenu) return;
    if (props()?.hover) {
      // The card closes itself once the pointer is off the row it's for (or the app loses focus):
      // the sidebar's hover-out can be missed, and a mod reload forgets the card it opened.
      cx.timer.every(200, () => {
        const w = globalThis.window;
        const r = props()?.hover?.rect;
        let p;
        try { p = w?.mouse_position?.(); } catch { return; }
        const off = r && p && (p.x < r.x || p.x > r.x + r.width || p.y < r.y || p.y > r.y + r.height);
        let away = false;
        try { away = w?.is_window_active?.() === false; } catch {}
        if (off || away) closeOverlay(props().overlay);
      });
      return;
    }
    if (props()?.agentMenu) {
      this.at = -1;
      this.handle = cx.focus_handle();
      this.handle.focus();
      return;
    }
    if (props()?.calendar) {
      this.week = 0;
      this.loadRoutines(cx);
      cx.timer.every(60000, (cx) => this.loadRoutines(cx));
      return;
    }
    this.folded = new Set();
    // Needs-you agents you've looked at and then left: no longer bold, still in Needs you.
    this.needs = new Map();
    // Each agent's last state and when it changed (ms), kept across restarts.
    this.changed = JSON.parse(localStorage.getItem("changed") ?? "{}");
    this.pendingPins = JSON.parse(localStorage.getItem("pins") ?? "[]");
    if (!this.pendingPins.length) localStorage.removeItem("pins");
    this.migratingPins = new Set();
    cx.timer.every(30000, (cx) => cx.spawn(async (cx) => { await loadSettings(); cx.notify(); }));
    // Closed: recent Claude sessions no longer running (closed.py). Looked for again
    // when the agents change (one just closed), else once a minute.
    this.closed = [];
    cx.spawn(async (cx) => { await settingsLoaded; this.refreshClosed(cx); });
    // Updates from GitHub: shortly after start, then hourly. One run per hour across copies.
    cx.timer.after(15000, (cx) => this.selfUpdate(cx));
    cx.timer.every(3600000, (cx) => this.selfUpdate(cx));
    cx.timer.every(3000, (cx) => {
      const now = agents().map((a) => a.address).join();
      if (now !== this.agentsSeen || Date.now() - (this.closedAt ?? 0) > 60000) this.refreshClosed(cx);
    });
    this.adoptOldSpaceNames(cx);
    // Tabs this mod named after their space (tab id -> name).
    this.tabNames = JSON.parse(localStorage.getItem("tabNames") ?? "{}");
    cx.timer.every(3000, () => this.nameSpaces());
  }

  // Runs update.py (it pulls the latest mods and hooks; Herdr reloads a changed mod) and says
  // so when something changed.
  selfUpdate(cx) {
    const last = shared("agents-mine.updatedAt");
    if (typeof last === "number" && Date.now() - last < 50 * 60000) return;
    setShared("agents-mine.updatedAt", Date.now());
    cx.spawn(async () => {
      await settingsLoaded;
      if (!AUTO_UPDATE) return;
      try {
        const r = await exec("python3", ["-I", `${appHome()}/mods/agents-mine/update.py`], { timeout: 120000 });
        const line = (r.stdout ?? "").trim();
        if (r.code !== 0) console.log(`herdr-config update failed: ${(r.stderr ?? "").trim().slice(-300)}`);
        else if (line.startsWith("updated") || line.startsWith("left")) notify({ title: "Herdr config", body: line, level: "info", timeout: 8000 });
      } catch (e) {
        console.log(`herdr-config update failed: ${e}`);
      }
    });
  }

  // Each space takes its first terminal's title at the end of a turn: the
  // herdr-space-name Claude hook (on this Mac and on other machines) puts it in
  // the `herdr.title` label. Only a space nobody named, or one named here before
  // and not renamed by hand since; a name someone chose stays.
  nameSpaces() {
    // Not before adoptOldSpaceNames has run.
    if (localStorage.getItem("spaceNames") === null) return;
    const ours = JSON.parse(localStorage.getItem("spaceNames") ?? "{}");
    const byAddress = new Map(terminals().map((x) => [x.address, x]));
    const all = panes();
    const live = spaces();
    let changed = false;
    for (const s of live) {
      const first = s.tabs[0] && all.find((p) => p.tab === s.tabs[0].id && p.terminal);
      const want = byAddress.get(first?.terminal)?.labels?.["herdr.title"];
      if (!want || s.name === want) continue;
      if (s.named && s.name !== ours[s.id]) continue;
      run("space.rename", { id: s.id, name: want });
      ours[s.id] = want;
      changed = true;
    }
    // Forget closed spaces, but only once spaces have loaded.
    if (live.length) {
      const ids = new Set(live.map((s) => s.id));
      for (const id of Object.keys(ours)) if (!ids.has(id)) { delete ours[id]; changed = true; }
    }
    if (changed) localStorage.setItem("spaceNames", JSON.stringify(ours));
    this.nameTabs(live, all);
  }

  // Each agent's tab takes the name its sidebar row shows (its own title, else its
  // space), so the tab bar matches the row instead of reading "1". A tab someone
  // named by hand keeps its name.
  nameTabs(live, all) {
    const ours = this.tabNames;
    let changed = false;
    for (const s of live) {
      for (const tab of s.tabs) {
        const l = lead(tab, all);
        if (!l?.program?.agent) continue;
        if (tab.named && tab.name !== ours[tab.id]) continue;
        // What the row shows: the agent's own title, else its space.
        const live = title({ ...tab, name: String(tab.index), named: false }, l);
        const want = /^\d+$/.test(live) ? s.name : live;
        if (!want || tab.name === want) continue;
        run("tab.rename", { id: tab.id, name: want });
        ours[tab.id] = want;
        changed = true;
      }
    }
    if (live.length) {
      const ids = new Set(live.flatMap((s) => s.tabs.map((t) => t.id)));
      for (const id of Object.keys(ours)) if (!ids.has(id)) { delete ours[id]; changed = true; }
    }
    if (changed) localStorage.setItem("tabNames", JSON.stringify(ours));
  }

  // Once: spaces the old hook named (~/.local/state/herdr-space-name/<space>)
  // stay ours, so they keep following their agent.
  adoptOldSpaceNames(cx) {
    if (localStorage.getItem("spaceNames") !== null) return;
    cx.spawn(async () => {
      try {
        const r = await exec("python3", ["-I", "-c",
          "import json,os,pathlib;d=pathlib.Path(os.path.expanduser('~/.local/state/herdr-space-name'));" +
          "print(json.dumps({f.name:f.read_text() for f in d.iterdir()} if d.is_dir() else {}))"]);
        if (r.code === 0) localStorage.setItem("spaceNames", r.stdout.trim() || "{}");
      } catch {}
      if (localStorage.getItem("spaceNames") === null) localStorage.setItem("spaceNames", "{}");
    });
  }

  // Claude cloud routines, from routines.json beside this mod (kept fresh outside Herdr).
  loadRoutines(cx) {
    cx.spawn(async (cx) => {
      try {
        const r = await exec("cat", [`${appHome()}/mods/agents-mine/routines.json`]);
        if (r.code === 0) {
          const data = JSON.parse(r.stdout);
          this.routines = data.routines ?? [];
          this.routinesAt = Date.parse(data.updated_at ?? "") || null;
        }
      } catch {}
      cx.notify();
    });
  }

  // A week of routines: when each fires, a day at a time. Frequent ones go in an Often row.
  calendar(t) {
    const DAY = 86400000;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const start = new Date(today);
    start.setDate(today.getDate() - ((today.getDay() + 6) % 7) + 7 * this.week);
    const days = [...Array(7)].map((_, i) => { const d = new Date(start); d.setDate(start.getDate() + i); return d; });
    const all = this.routines ?? [];
    const on = all.filter((r) => r.enabled);
    const now = Date.now();
    const cols = days.map((d) => {
      const from = +d, to = from + DAY, often = [], at = [];
      for (const r of on) {
        const ts = cronTimes(r.cron, from, to);
        if (ts.length > 6) often.push({ r, n: ts.length });
        else for (const x of ts) at.push({ r, x });
      }
      return { d, often, at: at.sort((p, q) => p.x - q.x) };
    });
    const fmt = (d) => d.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
    const button = (id, label, fn) => div().id(id).px(8).h(24).rounded(6).flex().items_center().text_size(12).text_color(t.muted)
      .cursor_pointer().hover((s) => s.bg(t.hover).text_color(t.foreground)).on_click((_e, cx) => { fn(); cx.notify(); }).child(label);
    const ran = (r, x) => r.last_run && Math.abs(Date.parse(r.last_run.fired_at) - x) < 10 * 60000 ? r.last_run.status : null;
    const chip = (key, r, label, x) => {
      const past = x != null && x < now;
      const st = x != null ? ran(r, x) : null;
      return h_flex().id(key).px(6).h(22).flex_none().rounded(5).gap(5).items_center().text_size(11.5)
        .bg(past ? t.dim + "18" : t.raised).border(1).border_color(past ? t.dim + "00" : t.border)
        .tooltip(`${r.name}\n${r.description ?? ""}\n${r.cron} (UTC)`)
        .when(Boolean(st), (el) => el.child(div().size(6).flex_none().rounded(3).bg(st === "failed" ? t.blocked : t.done)))
        .child(div().flex_none().text_color(t.dim).child(label))
        .child(div().flex_1().min_w(0).truncate().text_color(past ? t.muted : t.foreground).child(r.name));
    };
    const paused = all.filter((r) => !r.enabled);
    return v_flex()
      .size_full()
      .bg(t.popover)
      .p(16)
      .gap(12)
      .text_size(13)
      .child(h_flex().items_center().gap(6)
        .child(div().text_size(14).font_semibold().text_color(t.foreground).child("Routines"))
        .child(div().text_color(t.dim).child(`Claude cloud · ${fmt(days[0])} – ${fmt(days[6])}`))
        .child(div().flex_1())
        .child(button("cal-prev", "‹", () => this.week--))
        .child(button("cal-today", "Today", () => (this.week = 0)))
        .child(button("cal-next", "›", () => this.week++))
        .child(div().id("cal-close").p(4).rounded(5).text_color(t.dim).cursor_pointer().hover((s) => s.bg(t.hover).text_color(t.foreground))
          .on_click(() => closeOverlay(props().overlay)).child(svg("mods/workspace-chrome/x.svg").size(13))))
      .child(h_flex().flex_1().min_h(0).gap(6).children(cols.map((c, i) => {
        const isToday = +c.d === +today;
        return v_flex().id(`cal-day-${i}`).flex_1().min_w(0).gap(4).overflow_y_scrollbar()
          .child(h_flex().h(26).flex_none().items_center().justify_center().gap(4).text_size(12)
            .border_b(1).border_color(t.border)
            .child(div().text_color(t.dim).child(DOW[c.d.getDay()]))
            .child(div().px(isToday ? 6 : 0).rounded(8).when(isToday, (el) => el.bg(t.working).text_color(t.popover)).text_color(t.foreground).child(String(c.d.getDate()))))
          .children(c.often.map((o, k) => chip(`cal-${i}-o${k}`, o.r, `×${o.n}`, null)))
          .children(c.at.map((e, k) => chip(`cal-${i}-${k}`, e.r, hhmm(e.x), e.x)));
      })))
      .when(on.length === 0, (el) => el.child(div().text_size(12).text_color(t.dim).child("No routines are switched on.")))
      .child(h_flex().gap(12).text_size(11.5).text_color(t.dim)
        .when(paused.length > 0, (el) => el.child(div().flex_1().min_w(0).truncate().tooltip(paused.map((r) => r.name).join("\n")).child(`Paused: ${paused.map((r) => r.name).join(", ")}`)))
        .when(paused.length === 0, (el) => el.child(div().flex_1()))
        .child(div().flex_none().child(this.routinesAt ? `Updated ${duration(now - this.routinesAt)} ago` : "Not loaded yet")));
  }

  // The hover card: a row's title, what it's working on (herdr-doing's `herdr.task`, kept
  // current by Haiku) and, while it runs, the step it's on (`herdr.now`).
  hoverCard(t, h) {
    return v_flex().id("hover-card").w_full().px(12).py(9).gap(2).rounded(8).bg(t.popover).border(1).border_color(t.border).shadow_sm()
      .on_mouse_down("left", (_e, cx) => { cx.stop_propagation(); closeOverlay(props().overlay); })
      .child(div().text_size(12.5).font_family(".SystemUIFont").font_weight(600).text_color(t.foreground).child(h.name))
      .when(Boolean(h.task), (el) => el.child(div().text_size(12.5).text_color(t.muted).child(h.task)))
      .when(Boolean(h.now), (el) => el.child(div().pt(2).text_size(11.5).text_color(t.dim).truncate().child(`Now: ${h.now}`)));
  }

  // Opens (or refreshes in place) the card of the row under the pointer, from the last render's info,
  // just below and right of the pointer, like a tooltip.
  showCard(address) {
    const b = this.hoverAt;
    const p = this.pointer;
    const info = this.cardInfo?.get(address);
    if (!b || !p || this.hovered !== address || !info || !(info.task || info.now)) return this.hideCard();
    const key = JSON.stringify(info);
    if (this.card && this.cardFor === address && this.cardKey === key) return;
    // Refreshing in place keeps the spot it opened at; only a new card goes to the pointer.
    const at = this.card && this.cardFor === address ? this.cardPos : { x: Math.round(p.x + 12), y: Math.round(p.y + 18) };
    this.hideCard();
    // No `key`: a keyed window reopens where it last was, not at `at`.
    this.card = openOverlay({ mod: "agents-mine", kind: "window", frame: "none", width: 300, at, props: { hover: { ...info, rect: b } } });
    this.cardPos = at;
    this.cardFor = address;
    this.cardKey = key;
    this.cardAt = b;
  }

  hideCard() {
    if (this.card) closeOverlay(this.card);
    this.card = this.cardFor = this.cardKey = this.cardAt = null;
  }

  // The pointer left the rows some way that a row's hover-out can miss (out of the window,
  // a scroll moving rows under it, onto the card): nothing is hovered any more.
  unhover(cx) {
    if (!this.hovered && !this.card) return;
    this.hovered = null;
    this.hideCard();
    cx?.notify();
  }

  // Bold = unread, in Needs you and in Idle: until you've looked at it and moved on. A Needs-you
  // agent stays there until it moves on itself; a done one stays bold while you read it.
  unread(a) {
    if (this.needs.get(a.address)?.seen === false) return true;
    if (a.status === "done") return true;
    return a.focused && a.status === "idle" && this.held?.address === a.address && this.held.rank === RANK.done;
  }

  noteNeeds(list, rankOf) {
    const live = new Set();
    for (const a of list) {
      if (sectionOf(rankOf(a)) !== 4) continue;
      live.add(a.address);
      const n = this.needs.get(a.address) ?? { looked: false, seen: false };
      if (a.focused) n.looked = true;
      else if (n.looked) n.seen = true;
      this.needs.set(a.address, n);
    }
    for (const k of [...this.needs.keys()]) if (!live.has(k)) this.needs.delete(k);
  }

  // Archived: closed.py on this computer and, run there over hc, on CLOUD_MACHINE
  // (each session tagged with its machine, so it lands under that machine's space).
  refreshClosed(cx) {
    this.agentsSeen = agents().map((a) => a.address).join();
    this.closedAt = Date.now();
    this.closedBy = this.closedBy ?? { "": [] };
    const script = `${appHome()}/mods/agents-mine/closed.py`;
    const merge = () => {
      const got = Object.values(this.closedBy).flat();
      const ids = new Set(got.map((s) => s.id));
      // One just archived here stays on top until closed.py sees it gone too
      // (its process can outlive the click by a moment).
      const keep = [...(this.archiving ?? new Map()).values()].filter((s) => !ids.has(s.id) && Date.now() - s.at < 20000);
      this.archiving = new Map(keep.map((s) => [s.id, s]));
      this.closed = [...keep, ...got].sort((a, b) => b.at - a.at);
    };
    cx.spawn(async (cx) => {
      try {
        const r = await exec("python3", ["-I", script, "12"]);
        if (r.code === 0) { this.closedBy[""] = JSON.parse(r.stdout); merge(); }
      } catch {}
      cx.notify();
    });
    if (!CLOUD_MACHINE) return;
    cx.spawn(async (cx) => {
      try {
        // The script travels as an argument, so the machine needs only python3.
        if (!this.closedSrc) {
          const src = await exec("cat", [script]);
          if (src.code === 0) this.closedSrc = src.stdout;
        }
        if (!this.closedSrc) return;
        const r = await exec("python3", ["-I", "-c", this.closedSrc, "6"], { on: CLOUD_MACHINE, timeout: 30000 });
        if (r.code === 0) { this.closedBy[CLOUD_MACHINE] = JSON.parse(r.stdout).map((s) => ({ ...s, machine: CLOUD_MACHINE })); merge(); }
      } catch {}
      cx.notify();
    });
  }

  // A closed session: click to resume it in a new space named after it.
  closedRow(t, s, now) {
    return h_flex()
      .id(`closed-${s.id}`)
      .px(8)
      .h(30)
      .flex_none()
      .rounded(8)
      .items_center()
      .gap(9)
      .cursor_pointer()
      .hover((el) => el.bg(t.hover))
      .tooltip(s.machine ? `Resume on ${s.machine} in ${s.cwd}` : `Resume in ${s.cwd.replace(home(), "~")}`)
      .on_click((_e, cx) => {
        run("space.new", { machine: s.machine || "", folder: s.cwd, name: s.title, argv: ["claude", "--resume", s.id] });
        this.closed = this.closed.filter((c) => c.id !== s.id);
        cx.notify();
      })
      // Faded, in the color of the space it ran in.
      .child(div().flex_none().opacity(0.45).child(spaceMark(dirOf(s.cwd, s.machine || ""), 16)))
      .child(div().flex_1().min_w(0).truncate().text_color(t.muted).child(s.title))
      .when(Boolean(s.machine), (el) => el.child(div().flex_none().opacity(0.6).child(cloudIcon(t))))
      .child(div().flex_none().text_size(11).text_color(t.dim).child(duration(now - s.at)))
      .child(svg("mods/workspace-chrome/chevron-right.svg").size(11).flex_none().text_color(t.dim));
  }

  // Stamps agents whose state changed. Done and idle count as one: looking at a
  // finished agent turns done into idle, and looking isn't the agent doing anything.
  track(list, now) {
    let dirty = false;
    for (const a of list) {
      const s = a.status === "done" ? "idle" : a.status;
      if (this.changed[a.address]?.s === s) continue;
      this.changed[a.address] = { s, at: now };
      dirty = true;
    }
    if (!dirty) return;
    // Gone and old: the list alone is empty right after a start.
    const listed = new Set(list.map((a) => a.address));
    for (const [k, c] of Object.entries(this.changed)) if (!listed.has(k) && now - c.at > 30 * 86400000) delete this.changed[k];
    localStorage.setItem("changed", JSON.stringify(this.changed));
  }

  // Keep offline pins until their terminal returns, and keep each pending until
  // core echoes the label so a failed write doesn't erase the old pin.
  migratePins(all) {
    const listed = new Map(all.filter((t) => t.state === "live").map((t) => [t.address, t]));
    const pending = this.pendingPins.filter((address) => {
      const terminal = listed.get(address);
      if (!terminal) return true;
      if (terminal.labels?.["herdr.pinned"]) return false;
      if (!this.migratingPins.has(address)) {
        this.migratingPins.add(address);
        run("terminal.pin", { terminal: address, pinned: true });
      }
      return true;
    });
    if (pending.length === this.pendingPins.length) return;
    this.pendingPins = pending;
    if (pending.length) localStorage.setItem("pins", JSON.stringify(pending));
    else localStorage.removeItem("pins");
  }

  since(a) {
    return this.changed[a.address]?.at ?? 0;
  }

  // Looking at a done agent makes it idle; it stays with Done until you leave
  // it rather than drop away under you. Any other change moves it at once.
  hold(list) {
    const before = this.lastStatus ?? new Map();
    this.lastStatus = new Map(list.map((a) => [a.address, a.status]));
    const cur = list.find((a) => a.focused);
    const same = cur && cur.address === this.held?.address;
    // Arriving, or any change but done turning idle, sets what it was. Clicking a
    // done agent can mark it seen in the same frame it gains focus, so on arrival
    // an agent that was done a frame ago still counts as done.
    if (!same || cur.status !== "idle") {
      const was = cur?.status === "idle" && !same && before.get(cur.address) === "done" ? "done" : cur?.status;
      this.held = cur ? { address: cur.address, rank: RANK[was] ?? 0 } : null;
    }
  }

  rank(a) {
    // Ended its turn on a question: Needs you, even while its background subagents keep
    // Claude reporting "working". The question is what waits on you; they don't change that.
    if (this.asking?.has(a.address) && a.status !== "blocked") return RANK.asking;
    const sawDone = a.address === this.held?.address && this.held.rank === RANK.done && a.status === "idle";
    return sawDone ? RANK.done : RANK[a.status] ?? 0;
  }

  // Closes an agent (stopping it if it runs) and puts it at the top of Archived.
  archive(a, name) {
    // Where to land afterwards: archiving the one you're on opens the row below it
    // (above, if it was last); archiving another keeps you where you are. Herdr
    // would otherwise focus whatever it likes once the tab or space goes.
    const order = this.shownOrder ?? [];
    const i = order.findIndex((x) => x.address === a.address);
    const next = a.focused ? (i < 0 ? null : order[i + 1] ?? order[i - 1]) : order.find((x) => x.focused);
    // The agent alone in its tab: close the tab, confirmed, so the last one
    // takes its space with it without asking. Agents are easy to start again.
    const tab = spaces().flatMap((s) => s.tabs).find((tb) => tb.id === a.tab);
    if (tab && tab.panes <= 1) run("tab.close", { id: a.tab, confirmed: true });
    else run("pane.close", { pane: a.pane });
    if (next && next.address !== a.address) run("pane.focus", { pane: next.pane });
    // Straight to the top of Archived, without waiting for closed.py to notice.
    const lab = terminals().find((x) => x.address === a.address)?.labels ?? {};
    if (lab["herdr.session"] && lab["herdr.cwd"]) {
      const s = { id: lab["herdr.session"], title: name, cwd: lab["herdr.cwd"], at: Date.now(), machine: remoteOf(a.address) || "" };
      this.archiving = this.archiving ?? new Map();
      this.archiving.set(s.id, s);
      this.closed = [s, ...this.closed.filter((c) => c.id !== s.id)];
    }
    // The row goes away from under the pointer, and no hover-out comes.
    this.hovered = null;
  }

  // Puts a tab away (the tab bar's X, cmd-w or its Close): settled on this screen, so it
  // leaves the tab bar but keeps running and keeps its row here; clicking the row shows it
  // again. Settling leaves the shown tab on screen, so land elsewhere, as archive() does:
  // the space's next open tab, else the next row below (above, if last) that isn't put away.
  hideTab(id) {
    const all = spaces();
    const space = all.find((s) => s.tabs.some((tb) => tb.id === id));
    const tab = space?.tabs.find((tb) => tb.id === id);
    if (!tab) return;
    run("tab.settle", { id });
    if (!space.active || !tab.active) return;
    const other = space.tabs.find((tb) => tb.id !== id && !tb.settled);
    if (other) return run("tab.select", { id: other.id });
    const away = new Set(all.flatMap((s) => s.tabs).filter((tb) => tb.settled || tb.id === id).map((tb) => tb.id));
    const order = this.shownOrder ?? [];
    const i = order.findIndex((x) => x.tab === id);
    const open = (x) => !away.has(x.tab);
    const next = (i < 0 ? [] : [...order.slice(i + 1), ...order.slice(0, i).reverse()]).find(open) ?? order.find(open);
    if (next) run("pane.focus", { pane: next.pane });
  }

  // The right-click menu's items (runs in the popup's own copy of this mod).
  // Archive goes back to the sidebar's copy through shared state, which keeps Archived.
  agentMenuItems(m) {
    return [
      { id: "rename", label: "Rename agent", icon: "square-pen", on: true, go: () =>
        // Saving it empty gives the tab its number back, so the row follows the agent's title again.
        openOverlay({ mod: "prompt", kind: "dialog", width: 420, height: 210, props: {
          title: "Rename agent", value: m.name, hint: "Leave it empty to follow the agent's own title again.",
          command: { name: "tab.rename", args: { id: m.tab } },
        } }) },
      // A fork of its Claude session in a new space beside it: same history, its own future.
      { id: "copy", label: "Copy agent", icon: "files", on: Boolean(m.session && m.cwd), go: () =>
        run("space.new", { machine: m.machine, folder: m.cwd, name: `${m.name} (copy)`, argv: ["claude", "--resume", m.session, "--fork-session"] }) },
      { id: "archive", label: m.working ? "Stop and archive" : "Archive agent", icon: "archive", on: true, go: () =>
        setShared("agents-mine.archive", { address: m.address, name: m.name, at: Date.now() }) },
    ];
  }

  agentMenu(t) {
    const m = props().agentMenu;
    const items = this.agentMenuItems(m);
    const choose = (it) => {
      if (!it?.on) return;
      closeOverlay(props().overlay);
      it.go();
    };
    return v_flex()
      .id("agent-menu")
      .track_focus(this.handle)
      .w_full()
      .min_h(0)
      .p(5)
      .bg(t.popover)
      .text_size(12.8)
      .on_key_down((e, cx) => {
        // Nothing picked yet: down starts at the top, up at the bottom.
        const n = items.length;
        const from = (d) => (this.at >= 0 ? this.at : d > 0 ? -1 : n);
        const step = (d) => { for (let i = 1; i <= n; i++) { const j = (from(d) + d * i + n * 2) % n; if (items[j].on) return j; } return this.at; };
        if (e.key === "down") this.at = step(1);
        else if (e.key === "up") this.at = step(-1);
        else if (e.key === "enter") return choose(items[this.at]);
        else if (e.key === "escape") return closeOverlay(props().overlay);
        else return;
        cx.notify();
      })
      .children(items.map((it, i) => v_flex()
        .when(it.id === "archive", (el) => el.child(div().mx(7).my(4).h(1).bg(t.border)))
        .child(h_flex()
          .id(`am-${it.id}`)
          .h(31)
          .px(8)
          .gap(9)
          .rounded(7)
          .items_center()
          .text_color(it.on ? t.foreground : t.dim)
          .when(it.on && i === this.at, (el) => el.bg(t.selected))
          .when(it.on, (el) => el.cursor_pointer().hover((s) => s.bg(t.hover)).on_click(() => choose(it)))
          .when(!it.on, (el) => el.tooltip("Only Claude agents whose session is known can be copied"))
          .child(svg(`mods/workspace-chrome/${it.icon}.svg`).size(14).flex_none().text_color(it.on ? t.muted : t.dim))
          .child(div().flex_1().child(it.label)))));
  }

  // Right-click a space tab: remove it. Its agents keep running and show under the default.
  dirMenu(t) {
    const path = props().dirMenu;
    return v_flex()
      .w_full()
      .p(5)
      .bg(t.popover)
      .text_size(12.8)
      .child(div().px(8).pt(4).pb(6).text_size(11).text_color(t.dim).truncate().child(tilde(path)))
      .child(h_flex()
        .id("dir-remove")
        .h(31)
        .px(8)
        .gap(9)
        .rounded(7)
        .items_center()
        .text_color(t.foreground)
        .cursor_pointer()
        .hover((el) => el.bg(t.hover))
        .on_click(() => {
          closeOverlay(props().overlay);
          const dirs = dirsOf();
          if (!selectedDir(dirs).machine && selectedDir(dirs).path === path) selectDir(dirs[0]);
          saveDirs(dirs.filter((d) => d.fixed || d.path !== path));
        })
        .child(svg("mods/workspace-chrome/x.svg").size(14).flex_none().text_color(t.muted))
        .child(div().flex_1().child("Remove space")));
  }

  // The folder button: macOS's folder chooser, then a new space with the next free color.
  addDir(cx) {
    cx.spawn(async (cx) => {
      try {
        const r = await exec("osascript", ["-e",
          'tell application (path to frontmost application as text) to POSIX path of (choose folder with prompt "Add a space: agents started in it get their own Claude color")'],
          { timeout: 600000 });
        const path = r.code === 0 ? r.stdout.trim().replace(/\/+$/, "") || "/" : "";
        if (!path) return;
        const dirs = dirsOf();
        if (!dirs.some((d) => !d.machine && d.path === path)) {
          const used = new Set(dirs.map((d) => d.color));
          const color = DIR_COLORS.find((c) => !used.has(c)) ?? DIR_COLORS[dirs.length % DIR_COLORS.length];
          saveDirs([...dirs, { path, color }]);
        }
        selectDir({ machine: "", path });
      } catch {}
      cx.notify();
    });
  }

  sortMenu(t) {
    const on = sortOf().id;
    return v_flex()
      .w_full()
      .p(5)
      .bg(t.popover)
      .text_size(12.8)
      .child(div().px(8).pt(4).pb(6).text_size(11).text_color(t.dim).child("Sort agents"))
      .children(SORTS.map((s) => h_flex()
        .id(`sort-${s.id}`)
        .h(31)
        .px(8)
        .gap(9)
        .rounded(7)
        .items_center()
        .text_color(t.foreground)
        .hover((el) => el.bg(t.hover))
        .on_click(() => {
          setShared("agents.sort", s.id);
          closeOverlay(props().overlay);
        })
        .child(svg(`mods/workspace-chrome/${s.icon}.svg`).size(14).flex_none().text_color(t.muted))
        .child(div().flex_1().child(s.label))
        .when(s.id === on, (el) => el.child(svg("mods/workspace-chrome/check.svg").size(14).flex_none().text_color(t.foreground)))));
  }

  peek(addr) {
    run("terminal.peek", { terminal: addr });
  }

  // Live sub-agents of `addr`, depth first, each with the tree lines in front of it.
  tree(all, addr, lead = []) {
    const kids = all.filter((k) => k.parent === addr && k.state === "live");
    return kids.flatMap((k, i) => {
      const last = i === kids.length - 1;
      return [
        { t: k, lines: [...lead, last ? "└" : "├"] },
        ...this.tree(all, k.address, [...lead, last ? "" : "│"]),
      ];
    });
  }

  subRow(t, s, shown, compact) {
    const k = s.t;
    const st = kidStatus(k, this.listed);
    const pic = agentIcon(k, 14, t.foreground);
    const on = k.address === shown;
    return h_flex()
      .id(`sub-${k.address}`)
      .pl(39)
      .pr(8)
      .rounded(8)
      .h(26)
      .flex_none()
      .gap(0)
      .items_center()
      .text_size(12.5)
      .when(on, (el) => el.bg(t.raised))
      .hover((s) => s.bg(t.hover))
      .on_click(() => this.peek(k.address))
      .children(s.lines.map(l => div().self_start().mt(-4).w(9).h(17).mr(4).flex_none()
        .when(Boolean(l), el => el.border_l(1.5).border_color(t.input))
        .when(l === "└" || l === "├", el => el.border_b(1.5).rounded_bl(6))))
      .when(Boolean(pic), el => el.child(div().mr(8).child(pic)))
      .child(div().flex_1().truncate().text_color(on ? t.foreground : t.muted).child(k.name || k.template || k.program?.name || k.address))
      .child(this.status(t, { status: st }, compact));
  }

  // compact: a ! for blocked where a header already says "Needs you".
  status(t, a, compact = false) {
    const color = t[a.status] ?? t.dim;
    if (a.status === "working") return svg("mods/workspace-chrome/spinner.svg").size(12).mx(1).flex_none().text_color(t.working).spin(900);
    if (a.status === "blocked" && compact) return div().size(14).flex_none().rounded(4).bg(t.blocked + "26").text_size(10.5).font_bold().text_color(t.blocked).flex().items_center().justify_center().child("!");
    if (a.status === "blocked") return div().flex_none().px(6).h(18).rounded(5).bg(t.blocked + "26").text_size(10.5).font_semibold().text_color(t.blocked).flex().items_center().child("Needs you");
    // Idle: a ring; done: a dot.
    if (a.status === "idle") return div().size(7).mx(3).flex_none().rounded(4).border(1.5).border_color(t.idle ?? t.dim);
    return div().size(7).mx(3).flex_none().rounded(4).bg(a.status === "done" ? color : t.dim + "00");
  }

  render(cx) {
    const t = theme();
    if (props()?.sortMenu) return this.sortMenu(t);
    if (props()?.dirMenu) return this.dirMenu(t);
    if (props()?.calendar) return this.calendar(t);
    if (props()?.hover) return this.hoverCard(t, props().hover);
    if (props()?.agentMenu) return this.agentMenu(t);
    // Archive chosen in the right-click menu: done here, where Archived is kept. Once per choice.
    const asked = shared("agents-mine.archive");
    if (asked && asked.at !== this.archivedAsk) {
      this.archivedAsk = asked.at;
      const a = Date.now() - asked.at < 10000 && agents().find((x) => x.address === asked.address);
      if (a) this.archive(a, asked.name);
    }
    // A tab closed from the tab bar (its X, cmd-w, its menu): put away here, not archived.
    const hide = shared("agents-mine.hide");
    if (hide && hide.at !== this.hiddenAsk) {
      this.hiddenAsk = hide.at;
      if (Date.now() - hide.at < 10000) this.hideTab(hide.tab);
    }
    const collapsed = narrow();
    const sort = sortOf();
    let list = agents();
    this.listed = new Map(list.map((a) => [a.address, a.status]));
    const all = terminals();
    this.asking = new Set(all.filter((x) => x.labels?.["herdr.asking"]).map((x) => x.address));
    // What each session is working on and the step it's on (the herdr-doing hook's labels), for hovering its row.
    const labelsOf = new Map(all.map((x) => [x.address, x.labels ?? {}]));
    this.cardInfo = new Map();
    this.migratePins(all);
    const shown = focused()?.agent;
    const now = Date.now();
    // A row can go (closed, moved) without a hover-out: don't leave its card behind.
    if (this.card && (!this.hovered || this.cardFor !== this.hovered)) this.hideCard();
    this.track(list, now);
    this.hold(list);
    const byPriority = sort.id === "priority";
    const urgency = new Map(list.map((a) => [a.address, Math.max(this.rank(a), ...this.tree(all, a.address).map((s) => RANK[kidStatus(s.t, this.listed)] ?? 0))]));
    const rankOf = (a) => urgency.get(a.address);
    if (byPriority) list = [...list].sort((x, y) => sectionPos(rankOf(x)) - sectionPos(rankOf(y)) || this.since(y) - this.since(x) || y.seq - x.seq);
    this.noteNeeds(list, rankOf);
    // Only the selected space's agents (an agent on another machine counts as the default's).
    const dirs = dirsOf();
    const sel = selectedDir(dirs);
    const spaceOf = new Map(spaces().map((x) => [x.id, x]));
    const dirFor = (a) => {
      const sp = spaceOf.get(a.space);
      return dirOf(sp?.folder, remoteOf(a.address) ?? sp?.machine ?? "", dirs);
    };
    const needsIn = new Map();
    if (this.spacesFolded === undefined) { try { this.spacesFolded = localStorage.getItem("spacesFolded") !== "0"; } catch { this.spacesFolded = true; } }
    const spacesFolded = this.spacesFolded;
    for (const a of list) if (rankOf(a) >= RANK.asking) needsIn.set(dirKey(dirFor(a)), (needsIn.get(dirKey(dirFor(a))) ?? 0) + 1);
    list = list.filter((a) => dirFor(a) === sel);
    const pinned = list.filter((a) => a.pinned);
    const rest = list.filter((a) => !a.pinned);
    list = [...pinned, ...rest];
    setAgentOrder(list.map((a) => a.address));

    const withKids = (a, i) => {
      const subs = collapsed ? [] : this.tree(all, a.address);
      const r = row(a, i, subs);
      if (this.folded.has(a.address)) return [r];
      return [r, ...subs.map((s) => this.subRow(t, s, shown, byPriority))];
    };

    // The fold chevron; folded, the count too, colored by the most urgent one.
    const fold = (a, subs) => {
      const sts = subs.map((s) => kidStatus(s.t, this.listed));
      const top = sts.reduce((m, s) => ((RANK[s] ?? 0) > (RANK[m] ?? 0) ? s : m), null);
      const open = !this.folded.has(a.address);
      return div()
        .id(`fold-${a.address}`)
        .h(18)
        .px(3)
        .gap(3)
        .flex()
        .items_center()
        .rounded(4)
        .text_size(11)
        .text_color(open ? t.dim : (t[top] ?? t.dim))
        .cursor_pointer()
        .hover((s) => s.bg(t.hover).text_color(t.foreground))
        .on_click((_e, cx) => {
          cx.stop_propagation();
          open ? this.folded.add(a.address) : this.folded.delete(a.address);
          cx.notify();
        })
        .child(svg(`mods/workspace-chrome/chevron-${open ? "down" : "right"}.svg`).size(11).flex_none())
        .when(!open, (el) => el.child(String(subs.length)));
    };

    // A row reads "space \u00b7 detail": the detail is a tab someone named or the
    // agent's own title, never an automatic tab number unless two rows would
    // otherwise read the same.
    const tabs = spaces().flatMap(s => s.tabs);
    const label = (a) => {
      const tab = tabs.find(tab => tab.id === a.tab);
      if (!tab) return a.title || a.program?.name || "";
      // A tab named here after its space reads as unnamed, so rows don't repeat the space.
      const own = this.tabNames[tab.id] === tab.name ? { ...tab, name: String(tab.index), named: false } : tab;
      return title(own, lead(tab));
    };
    const detail = new Map(list.map(a => [a.address, /^\d+$/.test(label(a)) ? null : label(a)]));
    const seen = {};
    for (const a of list) { const k = `${a.space_name}\u0000${detail.get(a.address) ?? ""}`; seen[k] = (seen[k] ?? 0) + 1; }
    for (const a of list) {
      if (detail.get(a.address) == null && seen[`${a.space_name}\u0000`] > 1) detail.set(a.address, label(a));
    }

    const row = (a, i, subs = []) => {
      const own = dirFor(a);
      // A Claude agent wears its space's mark: its account's color.
      const pic = a.program?.icon?.includes("claude") ? spaceMark(own, 16) : agentIcon(a, 16, t.foreground);
      const more = detail.get(a.address);
      // An agent on another machine (`vps/t7`) gets a cloud.
      const machine = remoteOf(a.address);
      if (collapsed) {
        return h_flex()
          .id(`ag-${a.address}`)
          .h(26)
          .px(8)
          .flex_none()
          .items_center()
          .gap(4)
          .hover((s) => s.bg(t.hover))
          .on_click(() => run("pane.focus", { pane: a.pane }))
          .child(div().flex_1().min_w(0).whitespace_nowrap().text_right().text_color(t.muted).child(String(i + 1)))
          .child(h_flex().w(14).flex_none().items_center().justify_center().child(this.status(t, a, true)));
      }
      const when = this.since(a);
      const isPinned = a.pinned;
      const pin = div()
        .id(`close-${a.address}`)
        .flex_none()
        .p(2)
        .rounded(4)
        .text_color(t.dim)
        .cursor_pointer()
        .hover((s) => s.bg(t.hover).text_color(t.foreground))
        .tooltip(a.status === "working" ? "Stop and archive" : "Archive")
        .on_click((_e, cx) => {
          cx.stop_propagation();
          this.archive(a, name);
          cx.notify();
        })
        .child(svg("mods/workspace-chrome/x.svg").size(13));
      // Under a space header the space goes without saying; an automatic tab number says nothing.
      // Without a space header above (priority, pinned) the row names its space.
      const full = byPriority || isPinned;
      // Mine: the row leads with what the agent is doing now (its live title, or a tab
      // someone named), so it follows a /clear at once instead of waiting for the
      // space rename at the end of the turn. The space only when there's no title.
      const name = full ? more || a.space_name || label(a) : more ?? (/^\d+$/.test(label(a)) ? a.program?.name || label(a) : label(a));
      const extra = null;
      const lab = labelsOf.get(a.address) ?? {};
      this.cardInfo.set(a.address, { name, task: lab["herdr.task"] || "", now: a.status === "working" ? lab["herdr.now"] || "" : "" });
      return h_flex()
        .id(`ag-${a.address}`)
        .px(8)
        .h(30)
        .flex_none()
        .rounded(8)
        .items_center()
        .gap(9)
        .when(a.focused, (el) => el.bg(t.selected))
        .cursor_pointer()
        .hover((s) => s.bg(t.hover))
        .on_mouse_move((e) => { this.hoverAt = e.bounds; this.pointer = e.position; })
        .on_hover((on, cx) => {
          // Moving between rows, the new row's hover-in can come before the old one's
          // hover-out: either way, a card that isn't this row's goes now.
          if (on) {
            this.hovered = a.address;
            if (this.cardFor !== a.address) this.hideCard();
            cx.timer.after(450, () => this.showCard(a.address));
          } else {
            if (this.hovered === a.address) this.hovered = null;
            if (this.cardFor === a.address) this.hideCard();
          }
          cx.notify();
        })
        .on_click(() => run("pane.focus", { pane: a.pane }))
        // Right-click: a menu at the pointer to rename, copy or archive the agent.
        .on_mouse_down("right", (_e, cx) => {
          cx.stop_propagation();
          this.hideCard();
          openOverlay({ mod: "agents-mine", kind: "popup", width: 200, height: 112, props: { agentMenu: {
            address: a.address, tab: a.tab, name, working: a.status === "working",
            session: lab["herdr.session"] || "", cwd: lab["herdr.cwd"] || "", machine: machine || "",
          } } });
          cx.notify();
        })
        .when(Boolean(pic), el => el.child(div().id(`agent-fold-${a.address}`)
          .when(subs.length > 0, el => el.on_click((_e, cx) => {
            cx.stop_propagation();
            this.folded.has(a.address) ? this.folded.delete(a.address) : this.folded.add(a.address);
            cx.notify();
          })).child(pic)))
        .child(h_flex().flex_1().min_w(0).gap(5).items_center()
          .child(div().when(this.unread(a), (el) => el.font_family(".SystemUIFont").font_weight(600)).min_w(0).max_w(extra ? 120 : 200).truncate().text_color(t.foreground).child(name))
          .when(Boolean(machine), el => el.child(cloudIcon(t)))
          .when(Boolean(extra), el => el.child(div().flex_1().min_w(0).truncate().text_color(t.dim).child(`\u00b7 ${extra}`))))
        .when(Boolean(machine), el => el.child(div().text_size(10).text_color(t.dim).child(machine)))
        .when(subs.length > 0, el => el.child(fold(a, subs)))
        // Hovered, the status mark turns into the X: closing stops it if it's running, and it moves to Archived.
        .when(Boolean(when), el => el.child(div().flex_none().text_size(11).text_color(t.dim).child(duration(now - when))))
        .child(this.hovered === a.address ? pin : this.status(t, a, byPriority && !isPinned));
    };

    // Groups in list order: spaces (grouped) or priority sections. Agents of a
    // space are next to each other in agents(), so neighbours make a group.
    const groups = pinned.length ? [{ id: "pinned", label: "Pinned", status: null, members: pinned }] : [];
    if (byPriority) {
      // Every section, always, in a fixed order: one filling up doesn't push the others around.
      const secs = SECTION_ORDER.map((r) => ({ id: `sec-${r}`, label: SECTION[r], status: SECTION_STATUS[r], members: [] }));
      for (const a of rest) secs.find((g) => g.id === `sec-${sectionOf(rankOf(a))}`).members.push(a);
      for (const g of secs) if (!g.members.length) g.status = null; // empty: dim header
      groups.push(...secs);
    } else for (const a of rest) {
      const id = `sp-${a.space}`;
      if (groups.at(-1)?.id === id) groups.at(-1).members.push(a);
      else groups.push({ id, label: a.space_name || "", status: null, members: [a] });
    }

    // A group's header; it folds the group. Folded, it says how many and the most urgent state.
    const header = (g) => {
      const open = !this.folded.has(g.id);
      const top = g.members.reduce((m, a) => ((RANK[a.status] ?? 0) > (RANK[m] ?? 0) ? a.status : m), null);
      return h_flex()
        .id(g.id)
        .px(8)
        .pt(8)
        .h(30)
        .flex_none()
        .gap(6)
        .items_center()
        .text_size(11)
        .font_medium()
        .cursor_pointer()
        .hover((s) => s.text_color(t.foreground))
        .on_click((_e, cx) => {
          open ? this.folded.add(g.id) : this.folded.delete(g.id);
          cx.notify();
        })
        .child(div().truncate().text_color(t[g.status] ?? t.dim).child(g.label))
        .when(byPriority || !open, (el) => el.child(div().text_color(t.dim).child(String(g.members.length))))
        .child(div().flex_1())
        .when(!open, (el) => el
          .when(!byPriority && top && top !== "idle", (el) => el.child(this.status(t, { status: top }, true)))
          .child(svg("mods/workspace-chrome/chevron-right.svg").size(11).flex_none().text_color(t.dim)));
    };
    const rows = collapsed
      ? list.flatMap(withKids)
      : groups.flatMap((g) => [header(g), ...(this.folded.has(g.id) ? [] : g.members.flatMap(withKids))]);
    // The agents as they read top to bottom, for archive() to find the one below.
    this.shownOrder = collapsed ? list : groups.flatMap((g) => (this.folded.has(g.id) ? [] : g.members));
    // Each space's own six most recent.
    const closed = this.closed.filter((c) => dirOf(c.cwd, c.machine || "", dirs) === sel).slice(0, 6);
    if (!collapsed && closed.length) {
      rows.push(header({ id: "closed", label: "Archived", status: null, members: closed }));
      if (!this.folded.has("closed")) rows.push(...closed.map((s) => this.closedRow(t, s, now)));
    }
    // An open card follows its agent: a new summary or step lands in it while you look.
    if (this.card) this.showCard(this.cardFor);

    return v_flex()
      .size_full()
      .min_h(0)
      .bg(t.chrome)
      .border_t(1)
      .border_color(t.border)
      .text_size(13)
      // Spaces: click one to show its agents (+ below starts there); right-click an added one to remove it.
      .when(!collapsed, (el) => el
        // Click the header to fold the list away: then it reads "Spaces" with the selected one beside it.
        .child(h_flex().id("spaces-head").px(16).h(41).pt(14).pb(5).flex_none().items_center().gap(8).cursor_pointer()
          .on_click((_e, cx) => {
            this.spacesFolded = !this.spacesFolded;
            try { localStorage.setItem("spacesFolded", this.spacesFolded ? "1" : "0"); } catch {}
            cx.notify();
          })
          .child(div().text_size(11.5).font_medium().text_color(t.dim).hover((s) => s.text_color(t.foreground)).child("Spaces"))
          .child(h_flex().flex_1().min_w(0).gap(6).items_center().justify_end()
            .when(spacesFolded, (el) => el
              .when(dirs.some((d) => d !== sel && (needsIn.get(dirKey(d)) ?? 0) > 0), (el) => el.child(div().w(7).h(7).rounded(4).flex_none().bg(t.blocked ?? t.foreground)))
              .child(spaceMark(sel, 14))
              .child(div().min_w(0).truncate().text_size(12.5).text_color(t.foreground).child(dirName(sel.path)))
              .when(Boolean(sel.machine), (el) => el.child(cloudIcon(t)))
              .child(div().flex_none().text_size(10.5).text_color(t.dim).child(sel.machine || "local"))))
          .when(!spacesFolded, (el) => el.child(div()
            .id("dir-add")
            .text_color(t.dim)
            .hover((s) => s.text_color(t.foreground))
            .tooltip("Add a space (a folder on this computer)")
            .on_click((_e, cx) => { cx.stop_propagation(); this.addDir(cx); })
            .child(svg("mods/workspace-chrome/folder-plus.svg").size(14)))))
        .when(!spacesFolded, (el) => el.child(v_flex().px(8).flex_none()
          .children(dirs.map((d, i) => h_flex()
            .id(`dir-${i}`)
            .h(30)
            .px(8)
            .gap(9)
            .rounded(8)
            .flex_none()
            .items_center()
            .cursor_pointer()
            .when(d === sel, (el) => el.bg(t.selected))
            .when(d !== sel, (el) => el.hover((s) => s.bg(t.hover)))
            .tooltip(d.machine ? `${d.machine}:${d.path}` : tilde(d.path))
            .on_click((_e, cx) => { selectDir(d); cx.notify(); })
            .when(!d.fixed, (el) => el.on_mouse_down("right", (_e, cx) => {
              cx.stop_propagation();
              openOverlay({ mod: "agents-mine", kind: "popup", width: 220, height: 78, props: { dirMenu: d.path } });
            }))
            .child(spaceMark(d, 16))
            .child(h_flex().flex_1().min_w(0).gap(6).items_center()
              .child(div().min_w(0).truncate().text_color(t.foreground).child(dirName(d.path)))
              .when(Boolean(d.machine), (el) => el.child(cloudIcon(t))))
            .when(d !== sel && (needsIn.get(dirKey(d)) ?? 0) > 0, (el) => el.child(div().w(7).h(7).rounded(4).flex_none().bg(t.blocked ?? t.foreground)))
            .child(div().flex_none().text_size(10.5).text_color(t.dim).child(d.machine || "local")))))))
      .when(!collapsed, (el) =>
        el.child(
          h_flex()
            .px(16)
            .h(41)
            .pt(14)
            .pb(5)
            .flex_none()
            .items_center()
            .justify_between()
            .child(div().text_size(11.5).font_medium().text_color(t.dim).child("Agents"))
            .child(h_flex().gap(10).items_center()
            // A new Herdr space with Claude already running in the selected space's folder.
            .child(
              div()
                .id("ag-new")
                .text_color(t.dim)
                .hover((s) => s.text_color(t.foreground))
                .tooltip(`New Claude agent in ${tilde(sel.path)}`)
                .on_click(() => newAgent(sel))
                .child(svg("mods/workspace-chrome/plus.svg").size(14)),
            )
            .child(
              div()
                .id("ag-calendar")
                .text_color(t.dim)
                .hover((s) => s.text_color(t.foreground))
                .tooltip("Claude cloud routines this week")
                .on_click(() => openOverlay({ mod: "agents-mine", kind: "dialog", width: 0.8, height: 0.7, props: { calendar: true } }))
                .child(svg("mods/agents-mine/calendar.svg").size(14)),
            )
            .child(
              div()
                .id("ag-sort")
                .text_size(11)
                .text_color(t.dim)
                .hover((s) => s.text_color(t.foreground))
                .on_click(() => openOverlay({ mod: "agents-mine", kind: "popup", width: 200, height: 140, props: { sortMenu: true } }))
                .tooltip(`Sort agents: ${sort.label}`)
                .child(svg(`mods/workspace-chrome/${sort.icon}.svg`).size(14)),
            ),)
        ),
      )
      .when(list.length === 0 && !collapsed, (el) =>
        el.child(div().px(12).text_size(12).text_color(t.dim).child("No agent status yet. Agents show up here when they report their status. Older versions and agents inside tmux may not.")),
      )
      .child(v_flex().id("ag-list").flex_1().min_h(0).px(collapsed ? 0 : 8).overflow_y_scrollbar().mode("always")
        .on_hover((on, cx) => { if (!on) this.unhover(cx); })
        .on_scroll_wheel((_e, cx) => this.unhover(cx))
        // Off the row the card is for (by where that row was when it opened): the card goes.
        // Rows keep their own hover; the one now under the pointer opens its card as usual.
        .on_mouse_move((e, cx) => {
          const b = this.cardAt;
          const p = e.position;
          if (b && (p.x < b.x || p.x > b.x + b.width || p.y < b.y || p.y > b.y + b.height)) { this.hideCard(); cx.notify(); }
        })
        .children(rows))
      .when(collapsed, (el) =>
        el.child(
          h_flex()
            .h(28)
            .items_center()
            .justify_center()
            .child(
              div()
                .id("collapse")
                .text_size(13)
                .text_color(t.dim)
                .hover((s) => s.text_color(t.foreground))
                .on_click(toggleSidebar)
                .child("»"),
            ),
        ),
      );
  }
}
