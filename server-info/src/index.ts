// @description Shows server details in the guild menu in two columns: name, ID, owner, members, roles, channels, boosts, vanity URL
// @version 1.0.0
// @author kerizalperwastaken
// @enabled true

/**
 * Server Info.
 *
 * A two-column text block is mounted just above the "Edit Per-server Profile"
 * row of the native guild sheet: labels left, values right. It shows the
 * server name and ID, member and online counts, role and channel counts, boost
 * level and count, creation date and vanity URL.
 *
 * The guild is resolved from two independent signals:
 *  - `channelInfo` (gateway) is the authoritative source for the server the
 *    user is currently in. Reading the open channel from the view tree is not
 *    reliable right after switching servers: several channel nodes are live
 *    and the first one can still belong to the previous server.
 *  - `rowLongPress` on the server list carries the row index of a server the
 *    user held down. Its `navigation.server:<id>` child identifies the server
 *    whose menu is about to open, even though the app has not navigated to it.
 *
 * Whichever signal identifies the sheet, the text is fetched before mounting:
 * a mount issued after an async fetch lands too late when the sheet opens.
 */

const ui = phoenix.ui;
const discord = phoenix.discord;
const log = phoenix.log;

type Json = Record<string, any>;
type Cell = { label: string; value: string };
type Grid = Cell[][]; // each inner array is one visual row of two side-by-side cells

const DISCORD_EPOCH = 1420070400000;
const CHANNEL_PREFIX = "navigation.channel:";
const SERVER_PREFIX = "navigation.server:";
const OVERRIDE_MS = 15000;
const ANCHORS = ["Edit Per-server Profile", "Copy Server ID", "Copy Server Banner Image Link"];

async function api(path: string): Promise<Json | null> {
  try {
    const res = await discord.get(path);
    return res && typeof res.json === "function" ? (res.json<Json>() ?? null) : null;
  } catch (e) {
    log.warn(`GET ${path}: ${String(e)}`);
    return null;
  }
}

function fmt(n: unknown): string {
  return typeof n === "number" ? n.toLocaleString() : "—";
}

/** Discord does not return `created_at`; the timestamp lives in the snowflake id. */
function created(id: unknown): string {
  if (typeof id !== "string" || !/^\d{17,19}$/.test(id)) return "—";
  try {
    const ms = Number((BigInt(id) >> 22n).toString()) + DISCORD_EPOCH;
    const date = new Date(ms);
    return Number.isNaN(date.getTime()) ? "—" : date.toISOString().slice(0, 10);
  } catch {
    return "—";
  }
}

async function infoColumns(gid: string): Promise<Grid> {
  const guild = await api(`/guilds/${gid}?with_counts=true`);
  if (!guild) return [[{ label: "Server", value: "info unavailable" }]];

  const ownerId = guild.owner_id != null ? String(guild.owner_id) : null;
  const extras = await fetchExtras(gid, ownerId);

  const tier = guild.premium_tier;
  const boosts = guild.premium_subscription_count;
  const boost = typeof boosts === "number" && boosts > 0 ? `Lv ${tier ?? 0} (${fmt(boosts)})` : `Lv ${tier ?? 0}`;

  const cells: Cell[] = [
    { label: "Server", value: String(guild.name ?? "Server") },
    { label: "Owner", value: extras.ownerName },
    { label: "ID", value: String(guild.id ?? gid) },
    { label: "Members", value: fmt(guild.approximate_member_count ?? guild.member_count) },
    { label: "Online", value: fmt(guild.approximate_presence_count) },
    { label: "Roles", value: fmt(extras.roles) },
    { label: "Channels", value: fmt(extras.channels) },
    { label: "Boost", value: boost },
    { label: "Created", value: created(guild.id ?? gid) },
  ];

  if (typeof guild.vanity_url_code === "string" && guild.vanity_url_code.length > 0) {
    cells.push({ label: "Vanity", value: String(guild.vanity_url_code) });
  }

  // Pair cells into visual rows: Server / Owner, ID / Members, Online / Roles, ...
  const grid: Grid = [];
  for (let i = 0; i < cells.length; i += 2) grid.push(cells.slice(i, i + 2));
  return grid;
}

/** Roles, channels and the owner's username are stable per guild: fetch once. */
type Extras = { roles: number; channels: number; ownerName: string };
const extrasCache = new Map<string, Extras>();

async function fetchExtras(gid: string, ownerId: string | null): Promise<Extras> {
  const cached = extrasCache.get(gid);
  if (cached) return cached;
  const [roles, channels, user] = await Promise.all([
    api(`/guilds/${gid}/roles`),
    api(`/guilds/${gid}/channels`),
    ownerId ? api(`/users/${ownerId}`) : Promise.resolve(null),
  ]);
  const extras: Extras = {
    roles: Array.isArray(roles) ? roles.length : 0,
    channels: Array.isArray(channels) ? channels.length : 0,
    ownerName:
      (typeof user?.username === "string" && user.username) ||
      (typeof user?.global_name === "string" && user.global_name) ||
      ownerId ||
      "—",
  };
  extrasCache.set(gid, extras);
  return extras;
}

/** Fallback only: the view tree can hold several channels at once. */
function channelGid(): string | null {
  for (const id of ui.find({ prefix: CHANNEL_PREFIX })) {
    const aid = ui.node(id)?.accessibilityId;
    if (aid) return aid.slice(CHANNEL_PREFIX.length);
  }
  return null;
}

/** Guild id of the row the user held down in the server list. */
function pressedGid(ev: Phoenix.ViewEvent): string | null {
  const index = (ev.payload as { index?: number } | null)?.index;
  const list = ui.node(ev.node);
  if (typeof index !== "number" || !list) return null;
  const start = list.children[index];
  if (start == null) return null;
  const stack: number[] = [start];
  const seen = new Set<number>();
  while (stack.length && seen.size < 40) {
    const id = stack.pop()!;
    if (seen.has(id)) continue;
    seen.add(id);
    const node = ui.node(id);
    if (!node) continue;
    if (node.accessibilityId?.startsWith(SERVER_PREFIX)) {
      return node.accessibilityId.slice(SERVER_PREFIX.length);
    }
    for (const child of node.children ?? []) stack.push(child);
  }
  return null;
}

/** Live anchor rows, dropping one whose sheet was already dismissed. */
function anchorRows(): { row: number; parent: number; sheet: number | null }[] {
  const result: { row: number; parent: number; sheet: number | null }[] = [];
  for (const aid of ANCHORS) {
    for (const row of ui.find({ exact: aid })) {
      const info = ui.node(row);
      if (!info || info.parent == null || result.some((r) => r.row === row)) continue;
      result.push({ row, parent: info.parent, sheet: info.sheet });
    }
  }
  return result;
}

let grid: Grid = [[{ label: "Server", value: "info unavailable" }]];
let columnsGid: string | null = null;
let currentGid: string | null = null;
let overrideGid: string | null = null;
let overrideAt = 0;
let mountedGid: string | null = null;
let remover: (() => void) | null = null;
let needMount = false;
let busy = false;
let queued = false;
let queuedGid: string | undefined;

function removeMount(): void {
  if (!remover) return;
  try {
    remover();
  } catch {
    // The view may already be gone.
  }
  remover = null;
  mountedGid = null;
}

function mountInto(): boolean {
  const rows = anchorRows();
  if (rows.length === 0) return false;
  // ANCHORS is ordered by preference: Edit Per-server Profile first, so the
  // block always sits directly above that row rather than a later one.
  const target = rows[0];
  removeMount();
  remover = ui.mount(
    target.parent,
    {
      kind: "view",
      props: { direction: "column", gap: 6, padding: [12, 16, 12, 16], align: "stretch", width: "fill" },
      children: grid.map((row) => ({
        kind: "view",
        props: { direction: "row", gap: 16, align: "start", width: "fill" },
        children: row.map((cell) => ({
          kind: "view",
          props: { direction: "row", gap: 8, flex: 1, align: "start" },
          children: [
            { kind: "text", props: { text: cell.label, color: 0xff8e9297, fontSize: 13, fontWeight: 500, width: 64 } },
            { kind: "text", props: { text: cell.value, color: 0xffd2d4d8, fontSize: 13, flex: 1, width: "fill" } },
          ],
        })),
      })),
    },
    { before: target.row },
  );
  mountedGid = columnsGid;
  needMount = false;
  return true;
}

async function refresh(gid?: string): Promise<void> {
  if (busy) {
    queued = true;
    if (gid) queuedGid = gid;
    return;
  }
  busy = true;
  try {
    let target: string | null = gid ?? null;
    if (!target && overrideGid && Date.now() - overrideAt < OVERRIDE_MS) target = overrideGid;
    if (!target) target = currentGid;
    if (!target) {
      const channelId = channelGid();
      if (channelId) {
        const channel = await api(`/channels/${channelId}`);
        target = channel?.guild_id != null ? String(channel.guild_id) : null;
        if (target) currentGid = target;
      }
    }
    if (!target) return;

    grid = await infoColumns(target);
    columnsGid = target;

    // A long press can arrive while the sheet is still being built, or just
    // after the current server was fetched. Re-mount whenever the data now
    // belongs to a different guild than the block on screen.
    if (needMount || columnsGid !== mountedGid) mountInto();
  } finally {
    busy = false;
    if (queued) {
      queued = false;
      const next = queuedGid;
      queuedGid = undefined;
      void refresh(next);
    }
  }
}

const channelInfo = phoenix.gateway.channelInfo;
if (channelInfo) {
  phoenix.on(channelInfo, (payload) => {
    const body = payload as { guild_id?: unknown } | null;
    const gid = body?.guild_id;
    if (typeof gid === "string" && /^\d{17,19}$/.test(gid)) {
      currentGid = gid;
      // Navigating to a channel means the open server changed; a previous
      // long-press id no longer describes the menu that is opening.
      overrideGid = null;
      needMount = false;
    }
  });
}

ui.onEvent("rowLongPress", (ev) => {
  const gid = pressedGid(ev);
  if (!gid) return;
  overrideGid = gid;
  overrideAt = Date.now();
  needMount = true;
  void refresh(gid);
});

ui.onEvent("press", (ev) => {
  if (ev.accessibilityId === "guild.menu") {
    // The header menu is always for the server the user is in. A stale
    // long-press id must not leak into it.
    overrideGid = null;
    needMount = true;
    void refresh();
  }
});

ui.onNode({ exact: "Edit Per-server Profile" }, (node) => {
  const live = ui.node(node.id);
  if ((live?.sheet ?? node.sheet) == null) return;
  const gid = overrideGid;
  overrideGid = null;
  needMount = true;
  void refresh(gid ?? undefined);
});

void refresh();

phoenix.onUnload(() => {
  removeMount();
  needMount = false;
});
