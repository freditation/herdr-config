import { View, div } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { exec, theme, run, props, panes, spaces, shared, setShared, layout } from "herdr";

// The sidebar block shows, per repo merged into today, open and merged-today counts;
// the same mod as a tab's pane ({page: true}) shows the PRs themselves.
const DATA = "my-prs.data", VIEW = "my-prs.view", REPO = "my-prs.repo";
const MAX_PAGES = 3; // GitHub search returns 100 per page

// Local midnight as an ISO time with offset, for GitHub's merged:>= filter.
function midnight() {
  const d = new Date(); d.setHours(0, 0, 0, 0);
  const off = -d.getTimezoneOffset(), a = Math.abs(off), pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T00:00:00` +
    `${off < 0 ? "-" : "+"}${pad(Math.floor(a / 60))}:${pad(a % 60)}`;
}

function ago(iso) {
  const s = (Date.now() - Date.parse(iso)) / 1000;
  if (s < 3600) return `${Math.max(1, Math.round(s / 60))}m`;
  if (s < 86400) return `${Math.round(s / 3600)}h`;
  return `${Math.round(s / 86400)}d`;
}

async function search(q) {
  let total = 0, items = [];
  for (let page = 1; page <= MAX_PAGES; page++) {
    const r = await exec("gh", ["api", "-X", "GET", "search/issues", "-f", `q=${q}`,
      "-f", "per_page=100", "-f", `page=${page}`, "-f", "sort=updated", "-f", "order=desc"]);
    if (r.code !== 0) throw new Error(r.stderr.trim() || "gh failed");
    const d = JSON.parse(r.stdout);
    total = d.total_count;
    items.push(...d.items.map((i) => ({
      title: i.title, number: i.number, url: i.html_url, draft: !!i.draft,
      repo: i.repository_url.split("/").slice(-2).join("/"),
      updated: i.updated_at, merged: i.pull_request?.merged_at ?? null,
    })));
    if (items.length >= total || d.items.length < 100) break;
  }
  return { total, items };
}

let inflight = null;
function refresh(cx) {
  if (inflight) return;
  const since = midnight();
  inflight = true;
  cx.spawn(async (cx) => {
    const prev = shared(DATA) ?? {};
    try {
      const [open, merged] = await Promise.all([
        search("author:@me is:pr is:open archived:false"),
        search(`author:@me is:pr is:merged merged:>=${since}`),
      ]);
      merged.items.sort((a, b) => (b.merged ?? "").localeCompare(a.merged ?? ""));
      setShared(DATA, { open, merged, since, at: new Date().toISOString(), error: null });
    } catch (e) {
      setShared(DATA, { ...prev, error: String(e.message ?? e) });
    }
    inflight = null;
    cx.notify();
  });
}

// Every repo with open PRs or a merge today: most merges first, then most open.
function repoRows(d) {
  const rows = new Map();
  const add = (pr, k) => {
    const r = rows.get(pr.repo) ?? { repo: pr.repo, open: 0, merged: 0 };
    r[k]++; rows.set(pr.repo, r);
  };
  for (const pr of d.merged?.items ?? []) add(pr, "merged");
  for (const pr of d.open?.items ?? []) add(pr, "open");
  return [...rows.values()].sort((a, b) => b.merged - a.merged || b.open - a.open || a.repo.localeCompare(b.repo));
}

function openPage(view, repo) {
  setShared(VIEW, view);
  setShared(REPO, repo ?? null);
  const space = spaces().find((s) => s.active);
  const tabIds = new Set((space?.tabs ?? []).map((t) => t.id));
  const page = panes().find((p) => p.mod === "my-prs" && tabIds.has(p.tab));
  if (page) run("tab.select", { id: page.tab });
  else run("tab.new", { name: "PRs", mod: "my-prs", props: { page: true } });
}

// Collapsed = the sidebar block is sized to just the header row (px); expanded = a weight.
// The layout holds the state, so it survives restarts and needs no bookkeeping here.
const HEADER_PX = 32;
function findBlock(n) {
  if (!n || typeof n !== "object") return null;
  if (n.type === "block" && n.content?.mod === "my-prs" && !n.content?.props?.page) return n;
  for (const c of n.children ?? []) { const f = findBlock(c); if (f) return f; }
  return null;
}
function collapsed() {
  const b = findBlock(layout());
  return !!b && b.size?.px != null && b.size.px <= HEADER_PX;
}
function toggle() {
  const b = findBlock(layout());
  if (!b?.id) return;
  run("layout.resize", collapsed() ? { id: b.id, weight: 1 } : { id: b.id, px: HEADER_PX });
}

const short = (repo) => repo.split("/")[1];
const COL = 84;

export default class MyPrs extends View {
  init(_props, cx) {
    this.page = !!props()?.page;
    const d = shared(DATA);
    if (!d?.at || d.since !== midnight() || Date.now() - Date.parse(d.at) > 60000) refresh(cx);
    // Only the sidebar polls; the page refreshes on open and on ↻.
    if (!this.page) cx.timer.every(120000, (cx) => refresh(cx));
  }

  render(cx) {
    return this.page ? this.renderPage(cx) : this.renderSidebar(cx);
  }

  refreshButton(t) {
    return div().id("refresh").px(6).rounded(4).text_size(11).text_color(t.dim)
      .hover((s) => s.bg(t.hover).text_color(t.foreground))
      .on_click((_e, cx) => { cx.stop_propagation(); refresh(cx); })
      .child(inflight ? "…" : "↻");
  }

  renderSidebar() {
    const t = theme(), d = shared(DATA) ?? {};
    const rows = repoRows(d), folded = collapsed();
    const num = (id, n, color, view, repo) =>
      div().id(id).w(COL).flex_none().flex().justify_end().px(6).rounded(4)
        .text_color(n ? color : t.dim)
        .hover((s) => s.bg(t.raised))
        .on_click((_e, cx) => { cx.stop_propagation(); openPage(view, repo); })
        .child(n ? String(n) : "–");
    // Column heads carry the totals: "36 open", "89 merged" (today), coloured like the column.
    const head = (id, n, color, word, view) =>
      h_flex().id(id).w(COL).flex_none().justify_end().gap(4).px(6).rounded(4)
        .hover((s) => s.bg(t.hover))
        .on_click((_e, cx) => { cx.stop_propagation(); openPage(view, null); })
        .child(div().font_medium().text_color(n ? color : t.dim).child(n == null ? "–" : String(n)))
        .child(div().child(word));
    return v_flex().id("root").size_full().min_h(0).bg(t.chrome).border_t(1).border_color(t.border).text_size(13)
      .child(h_flex().id("prs-header").h(31).pl(16).pr(10).flex_none().items_center().text_size(11.5).text_color(t.dim)
        .cursor_pointer().on_click(() => toggle())
        .child(h_flex().flex_1().gap(4).items_center()
          .child(div().w(10).child(folded ? "▸" : "▾"))
          .child(div().font_medium().child("Pull Requests")).child(this.refreshButton(t)))
        .child(head("h-open", d.open?.total, t.ansi2, "open", "open"))
        .child(head("h-merged", d.merged?.total, t.ansi5, "merged", "merged")))
      .when(!folded, (el) => el.child(v_flex().id("prs-repos").flex_1().min_h(0).overflow_y_scrollbar().px(8).pb(14)
        .when(d.error, (el) => el.child(div().px(8).text_size(11).text_color(t.blocked).truncate().child(d.error)))
        .children(rows.length ? rows.map((r) =>
          h_flex().id(`repo-${r.repo}`).h(28).pl(8).pr(2).rounded(6).items_center()
            .hover((s) => s.bg(t.hover))
            .on_click(() => openPage("merged", r.repo))
            .child(div().flex_1().min_w(0).truncate().text_color(t.foreground).child(short(r.repo)))
            .child(num(`o-${r.repo}`, r.open, t.ansi2, "open", r.repo))
            .child(num(`m-${r.repo}`, r.merged, t.ansi5, "merged", r.repo)))
          : [div().px(8).text_color(t.dim).child(d.at ? "No open or merged PRs" : "Loading…")])));
  }

  renderPage() {
    const t = theme(), d = shared(DATA) ?? {};
    const view = shared(VIEW) === "merged" ? "merged" : "open";
    const repo = shared(REPO) ?? null;
    const pick = (k) => (d[k]?.items ?? []).filter((pr) => !repo || pr.repo === repo);
    const lists = { open: pick("open"), merged: pick("merged") };
    const total = (k) => repo ? lists[k].length : d[k]?.total;
    const tab = (id, label) =>
      h_flex().id(`tab-${id}`).px(12).py(6).gap(8).rounded(6).items_center()
        .bg(view === id ? t.selected : t.background)
        .hover((s) => s.bg(view === id ? t.selected : t.hover))
        .on_click(() => setShared(VIEW, id))
        .child(div().text_color(view === id ? t.foreground : t.muted).child(label))
        .child(div().text_color(t.dim).child(total(id) == null ? "–" : String(total(id))));
    const rows = lists[view].map((pr) => {
      const when = view === "merged" ? pr.merged : pr.updated;
      return h_flex().id(`pr-${pr.url}`).px(12).py(8).gap(12).rounded(6).items_center()
        .hover((s) => s.bg(t.hover))
        .on_click(() => exec("open", [pr.url]))
        .child(div().w(7).h(7).rounded(4).flex_none()
          .bg(view === "merged" ? t.ansi5 : pr.draft ? t.dim : t.ansi2))
        .child(div().w(220).flex_none().truncate().text_color(t.muted).child(`${pr.repo}#${pr.number}`))
        .child(div().flex_1().min_w(0).truncate().text_color(t.foreground).child(pr.title))
        .when(pr.draft && view === "open", (el) => el.child(div().text_size(11).text_color(t.dim).child("draft")))
        .child(div().w(40).flex_none().text_color(t.dim).child(when ? ago(when) : ""));
    });
    const fetched = d[view]?.items?.length ?? 0, all = d[view]?.total ?? 0;
    return v_flex().id("root").size_full().min_h(0).bg(t.background).text_size(13)
      .child(h_flex().flex_none().px(16).py(12).gap(6).items_center().border_b(1).border_color(t.border)
        .child(tab("open", "Open"))
        .child(tab("merged", "Merged today"))
        .when(repo, (el) => el.child(h_flex().id("repo-filter").ml(8).px(10).py(4).gap(6).rounded(12).items_center()
          .bg(t.raised).hover((s) => s.bg(t.hover))
          .on_click(() => setShared(REPO, null))
          .child(div().text_color(t.foreground).child(short(repo)))
          .child(div().text_color(t.dim).child("×"))))
        .child(div().flex_1())
        .when(all > fetched, (el) => el.child(div().text_size(11).text_color(t.dim).child(`latest ${fetched} of ${all}`)))
        .when(d.at, (el) => el.child(div().text_size(11).text_color(t.dim).child(`updated ${ago(d.at)} ago`)))
        .child(this.refreshButton(t)))
      .when(d.error, (el) => el.child(div().px(16).py(8).text_color(t.blocked).child(d.error)))
      .child(v_flex().id("pr-list").flex_1().min_h(0).overflow_y_scrollbar().p(8)
        .children(rows.length ? rows : [div().p(12).text_color(t.dim).child(d.at ? "None" : "Loading…")]));
  }
}
