// @description Shows server details in the guild menu: name, ID, owner, members, roles, channels, boosts, created, vanity
// @version 1.1.0
// @author kerizalperwastaken
// @enabled true

/**
 * Sunbird (Phoenix Unlocker) port of server-info.
 *
 * Sunbird's `phoenix` API already provides everything the original plugin used:
 *   ui.find/node/mount, ui.onEvent/onNode, discord.get, gateway.*, onUnload.
 *
 * Differences handled here:
 *  - Anchor labels are fixed constants; the header button covers menus with different labels.
 *  - A header button + phoenix.ui.openPage fallback shows the same data even when no
 *    guild-menu anchor matches.
 *  - Current guild is also resolved from `ViewEvent.channelId` via /channels/{id},
 *    which is more reliable than reading the view tree. `gateway.channelInfo` is
 *    used when that event exists in the running binary.
 *  - All event listeners are removed on unload, mount is guarded, queue/caching fixed.
 */

const ui = phoenix.ui;
const discord = phoenix.discord;
const log = phoenix.log;
const gateway = phoenix.gateway;

const cfg = phoenix.settings.define({
  headerFallback: {
    type: "switch",
    title: "Header fallback button",
    description: "Adds a 'Server Info' chat-header button that opens the same data in a page",
    default: true,
  },
  server: { type: "switch", title: "Show server name", default: true },
  owner: { type: "switch", title: "Show owner", default: true },
  id: { type: "switch", title: "Show server ID", default: true },
  members: { type: "switch", title: "Show members / online", default: true },
  roles: { type: "switch", title: "Show role count", default: true },
  channels: { type: "switch", title: "Show channel count", default: true },
  boost: { type: "switch", title: "Show boost level", default: true },
  created: { type: "switch", title: "Show creation date", default: true },
  vanity: { type: "switch", title: "Show vanity URL", default: true },
});

type Json = Record<string, any>;
type Cell = { label: string; value: string };
type Grid = Cell[][]; // each inner array is one visual row of two side-by-side cells

const DISCORD_EPOCH = 1420070400000;
const CHANNEL_PREFIX = "navigation.channel:";
const SERVER_PREFIX = "navigation.server:";
const OVERRIDE_MS = 15000;
const CACHE_MS = 10 * 60 * 1000;
const ANCHOR = "Edit Per-server Profile";
const FALLBACK_ANCHORS = ["Copy Server ID", "Copy Server Banner Image Link"];

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

/** Discord does not return created_at; the timestamp lives in the snowflake id. */
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

type Extras = { roles: number; channels: number; ownerName: string };
const extrasCache = new Map<string, { at: number; data: Extras }>();

async function fetchExtras(gid: string, ownerId: string | null): Promise<Extras> {
  const cached = extrasCache.get(gid);
  if (cached && Date.now() - cached.at < CACHE_MS) return cached.data;
  const [roles, channels, user] = await Promise.all([
    api(`/guilds/${gid}/roles`),
    api(`/guilds/${gid}/channels`),
    ownerId ? api(`/users/${ownerId}`) : Promise.resolve(null),
  ]);
  const data: Extras = {
    roles: Array.isArray(roles) ? roles.length : 0,
    channels: Array.isArray(channels) ? channels.length : 0,
    ownerName:
      (typeof user?.username === "string" && user.username) ||
      (typeof user?.global_name === "string" && user.global_name) ||
      ownerId ||
      "—",
  };
  extrasCache.set(gid, { at: Date.now(), data });
  return data;
}

async function infoColumns(gid: string): Promise<Grid> {
  const guild = await api(`/guilds/${gid}?with_counts=true`);
  if (!guild) return [[{ label: "Server", value: "info unavailable" }]];

  const ownerId = guild.owner_id != null ? String(guild.owner_id) : null;
  const needExtras = cfg.owner || cfg.roles || cfg.channels;
  const extras: Extras = needExtras
    ? await fetchExtras(gid, ownerId)
    : { roles: 0, channels: 0, ownerName: "—" };

  const tier = guild.premium_tier;
  const boosts = guild.premium_subscription_count;
  const boost = typeof boosts === "number" && boosts > 0 ? `Lv ${tier ?? 0} (${fmt(boosts)})` : `Lv ${tier ?? 0}`;

  const cells: Cell[] = [];
  if (cfg.server) cells.push({ label: "Server", value: String(guild.name ?? "Server") });
  if (cfg.owner) cells.push({ label: "Owner", value: extras.ownerName });
  if (cfg.id) cells.push({ label: "ID", value: String(guild.id ?? gid) });
  if (cfg.members) {
    cells.push({ label: "Members", value: fmt(guild.approximate_member_count ?? guild.member_count) });
    cells.push({ label: "Online", value: fmt(guild.approximate_presence_count) });
  }
  if (cfg.roles) cells.push({ label: "Roles", value: fmt(extras.roles) });
  if (cfg.channels) cells.push({ label: "Channels", value: fmt(extras.channels) });
  if (cfg.boost) cells.push({ label: "Boost", value: boost });
  if (cfg.created) cells.push({ label: "Created", value: created(guild.id ?? gid) });
  if (cfg.vanity && typeof guild.vanity_url_code === "string" && guild.vanity_url_code.length > 0) {
    cells.push({ label: "Vanity", value: String(guild.vanity_url_code) });
  }
  if (cells.length === 0) cells.push({ label: "Server", value: "no fields enabled" });

  const grid: Grid = [];
  for (let i = 0; i < cells.length; i += 2) grid.push(cells.slice(i, i + 2));
  return grid;
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

/** Sunbird gives ViewEvent.channelId on many events; resolve it through the API. */
async function guildFromChannel(channelId?: string | null): Promise<string | null> {
  if (!channelId) return null;
  const channel = await api(`/channels/${channelId}`);
  return channel?.guild_id != null ? String(channel.guild_id) : null;
}

/** Live anchor rows, dropping one whose sheet was already dismissed. */
function anchorRows(): { row: number; parent: number }[] {
  const labels = [ANCHOR, ...FALLBACK_ANCHORS];
  const result: { row: number; parent: number }[] = [];
  for (const aid of labels) {
    for (const row of ui.find({ exact: aid })) {
      const info = ui.node(row);
      if (!info || info.parent == null || result.some((r) => r.row === row)) continue;
      result.push({ row, parent: info.parent });
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
let queued: { gid?: string; channelId?: string | null } | null = null;
const cleanups: (() => void)[] = [];

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
  // ANCHOR is first: the block sits directly above that row when present.
  const target = rows[0];
  try {
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
  } catch (e) {
    log.warn(`mount failed: ${String(e)}`);
    remover = null;
    return false;
  }
  mountedGid = columnsGid;
  needMount = false;
  return true;
}

async function refresh(gid?: string, channelId?: string | null): Promise<void> {
  if (busy) {
    // Last request wins: no stale queuedGid leaking into the next open.
    queued = { gid, channelId };
    return;
  }
  busy = true;
  try {
    let target: string | null = gid ?? null;
    if (!target && overrideGid && Date.now() - overrideAt < OVERRIDE_MS) target = overrideGid;
    if (!target) target = currentGid;
    if (!target) target = await guildFromChannel(channelId ?? channelGid());
    if (!target) return;

    grid = await infoColumns(target);
    columnsGid = target;

    // Re-mount when the data now belongs to a different guild than the block on screen.
    if (needMount || columnsGid !== mountedGid) mountInto();
  } finally {
    busy = false;
    const next = queued;
    queued = null;
    if (next) void refresh(next.gid, next.channelId);
  }
}

const channelInfo = gateway.channelInfo;
if (channelInfo) {
  phoenix.on(channelInfo, (payload) => {
    const body = payload as { guild_id?: unknown } | null;
    const gid = body?.guild_id;
    if (typeof gid === "string" && /^\d{17,19}$/.test(gid)) {
      currentGid = gid;
      // Navigating to a channel means the open server changed; a previous long-press id is stale.
      overrideGid = null;
      needMount = false;
    }
  });
}

cleanups.push(
  ui.onEvent("rowLongPress", (ev) => {
    const gid = pressedGid(ev);
    if (gid) {
      overrideGid = gid;
      overrideAt = Date.now();
      needMount = true;
    }
    void refresh(gid ?? undefined, ev.channelId);
  }),
);

cleanups.push(
  ui.onEvent("press", (ev) => {
    if (ev.accessibilityId === "guild.menu") {
      // The header menu is always for the server the user is in.
      overrideGid = null;
      needMount = true;
      void refresh(undefined, ev.channelId);
    }
  }),
);

for (const label of [ANCHOR, ...FALLBACK_ANCHORS]) {
  cleanups.push(
    ui.onNode({ exact: label }, (node) => {
      const live = ui.node(node.id);
      if ((live?.sheet ?? node.sheet) == null) return;
      const gid = overrideGid;
      overrideGid = null;
      needMount = true;
      void refresh(gid ?? undefined);
    }),
  );
}

if (cfg.headerFallback) {
  cleanups.push(
    ui.addHeaderButton({
      icon: "res://ic_mana_puzzle_piece_plus",
      label: "Server Info",
      onPress: (ctx) => {
        void (async () => {
          const gid =
            currentGid ??
            (await guildFromChannel(ctx.channelId)) ??
            (overrideGid && Date.now() - overrideAt < OVERRIDE_MS ? overrideGid : null);
          if (!gid) return ui.toast("Open a server channel first");
          const data = await infoColumns(gid);
          ui.openPage({
            title: "Server Info",
            sections: [{ type: "text", text: data.flat().map((c) => `${c.label}: ${c.value}`).join("\n") }],
          });
        })();
      },
    }),
  );
}

void refresh();

phoenix.onUnload(() => {
  removeMount();
  needMount = false;
  for (const off of cleanups) {
    try {
      off();
    } catch {
      // Already gone.
    }
  }
  cleanups.length = 0;
});
