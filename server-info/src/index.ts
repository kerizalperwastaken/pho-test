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
 *  - Anchor labels are fixed constants; the info block is only mounted in the guild menu.
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
  theme: {
    type: "select",
    title: "Card theme",
    description: "Auto reads the client's appearance; pick one if the colors look wrong",
    options: [
      { value: "auto", label: "Auto" },
      { value: "dark", label: "Dark" },
      { value: "light", label: "Light" },
    ],
    default: "auto",
  },
  server: { type: "switch", title: "Show server name", default: true },
  owner: { type: "switch", title: "Show owner", default: true },
  id: { type: "switch", title: "Show server ID", default: true },
  members: { type: "switch", title: "Show members / online", default: true },
  roles: { type: "switch", title: "Show role count", default: true },
  channels: { type: "switch", title: "Show channel count", default: true },
  boost: { type: "switch", title: "Show boost level", default: true },
  created: { type: "switch", title: "Show creation date", default: true },
  joined: { type: "switch", title: "Show join date", default: true },
  vanity: { type: "switch", title: "Show vanity URL", default: true },
});

type Json = Record<string, any>;
type Cell = { label: string; value: string; icon?: string };
type Grid = Cell[][]; // each inner array is one visual row of two side-by-side cells

const DISCORD_EPOCH = 1420070400000;
const CHANNEL_PREFIX = "navigation.channel:";
const SERVER_PREFIX = "navigation.server:";
const OVERRIDE_MS = 15000;
const CACHE_MS = 10 * 60 * 1000;
const ANCHOR = "Edit Per-server Profile";
const FALLBACK_ANCHORS = ["Copy Server ID", "Copy Server Banner Image Link"];
type Palette = { bg: number; border: number; label: number; value: number };
// Sampled from the live guild sheet: the native cards are #414148 on #393A41.
const DARK_PALETTE: Palette = {
  bg: 0xff414148,
  border: 0xff414148, // native cards are borderless
  label: 0xffabacb2, // muted text
  value: 0xffffffff, // primary text
};
const LIGHT_PALETTE: Palette = {
  bg: 0xffffffff,
  border: 0xffffffff,
  label: 0xff4e5058,
  value: 0xff313338,
};
const CARD_RADIUS = 12;
let palette: Palette = DARK_PALETTE;
let themeReady = false;

/** Phoenix keeps appearance settings in its local meta table; no API request. */
async function detectLightTheme(): Promise<boolean> {
  try {
    const rows = await phoenix.stores.sql<{ k: string; v: string }>(
      "SELECT k AS k, CAST(v AS TEXT) AS v FROM meta",
    );
    for (const row of rows) {
      const key = String(row.k ?? "").toLowerCase();
      const value = String(row.v ?? "");
      if (/theme|appearance/.test(key) && /light/i.test(value)) return true;
      // User settings blobs carry an explicit "theme": "dark" | "light".
      const explicit = value.match(/"theme"\s*:\s*"?(dark|light)"?/i);
      if (explicit) return explicit[1].toLowerCase() === "light";
    }
  } catch {
    // No cache or no such table: keep the dark default.
  }
  return false;
}

async function ensureTheme(): Promise<void> {
  if (themeReady) return;
  themeReady = true;
  if (cfg.theme === "dark") palette = DARK_PALETTE;
  else if (cfg.theme === "light") palette = LIGHT_PALETTE;
  else palette = (await detectLightTheme()) ? LIGHT_PALETTE : DARK_PALETTE;
}

/** Mana icons shipped with Phoenix (res://ic_mana_*). */
const ICON = {
  server: "res://ic_mana_experimental_pineapple_house",
  owner: "res://ic_mana_user_status",
  id: "res://ic_mana_angle_brackets",
  members: "res://ic_mana_emoji_people",
  online: "res://ic_mana_user_circle_status",
  roles: "res://ic_mana_shield_at",
  channels: "res://ic_mana_grid_horizontal",
  boost: [
    "res://ic_mana_boost_tier1_simple",
    "res://ic_mana_boost_tier2_simple",
    "res://ic_mana_boost_tier3_simple",
  ],
  created: "res://ic_mana_paper_clock",
  joined: "res://ic_mana_door_enter",
  vanity: "res://ic_mana_browser_link",
};

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

/**
 * Join date without an extra API request: first the guild response itself if it
 * carries joined_at, then GUILD_CREATE events seen while the plugin is alive,
 * and finally Phoenix's own cache.sqlite (local, read-only).
 */
const joinedFromGateway = new Map<string, string>();
let joinedCache: Map<string, string> | null = null;

function dateValue(raw: unknown): string | null {
  if (typeof raw === "string" && raw.length >= 10) {
    const s = raw.slice(0, 10);
    return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
  }
  if (typeof raw === "number" && Number.isFinite(raw)) {
    const date = new Date(raw > 1e12 ? raw : raw * 1000);
    return Number.isNaN(date.getTime()) ? null : date.toISOString().slice(0, 10);
  }
  return null;
}

function extractJoined(obj: Json): string | null {
  for (const key of Object.keys(obj)) {
    if (!/join/i.test(key)) continue;
    const value = obj[key];
    const direct = dateValue(value);
    if (direct) return direct;
    const found = JSON.stringify(value ?? null).match(/\d{4}-\d{2}-\d{2}/);
    if (found) return found[0];
  }
  return null;
}

async function loadJoinedFromCache(): Promise<Map<string, string>> {
  const result = new Map<string, string>();
  try {
    // Phoenix zero-pads guild ids to 20 digits in cache keys.
    const rows = await phoenix.stores.sql<{ g: string; v: string }>(
      "SELECT k AS g, CAST(v AS TEXT) AS v FROM guilds",
    );
    for (const row of rows) {
      if (!row?.v) continue;
      try {
        const date = extractJoined(JSON.parse(row.v) as Json);
        if (date) result.set(row.g.replace(/^0+/, ""), date);
      } catch {
        // Skip a malformed cache row.
      }
    }
  } catch (e) {
    log.warn(`reading guild cache: ${String(e)}`);
  }
  return result;
}

async function joinedAt(gid: string, guild: Json): Promise<string> {
  const direct = dateValue(guild.joined_at ?? guild.joinedAt);
  if (direct) return direct;
  const seen = joinedFromGateway.get(gid);
  if (seen) return seen;
  if (!joinedCache) joinedCache = await loadJoinedFromCache();
  return joinedCache.get(gid) ?? "—";
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
  if (!guild) return [[{ label: "Server", value: "info unavailable", icon: ICON.server }]];

  const ownerId = guild.owner_id != null ? String(guild.owner_id) : null;
  const needExtras = cfg.owner || cfg.roles || cfg.channels;
  const extras: Extras = needExtras
    ? await fetchExtras(gid, ownerId)
    : { roles: 0, channels: 0, ownerName: "—" };

  const tier = guild.premium_tier;
  const boosts = guild.premium_subscription_count;
  const boost =
    typeof boosts === "number" && boosts > 0
      ? `${fmt(boosts)} boosts · Lv ${tier ?? 0}`
      : `Lv ${tier ?? 0}`;
  const boostLevel = Math.min(2, Math.max(0, Number(tier ?? 0) - 1));
  const joined = cfg.joined ? await joinedAt(String(guild.id ?? gid), guild) : null;
  const vanity = cfg.vanity
    ? typeof guild.vanity_url_code === "string" && guild.vanity_url_code.length > 0
      ? String(guild.vanity_url_code)
      : "Not Found"
    : null;

  const cell = (label: string, value: string, icon: string): Cell => ({ label, value, icon });
  const grid: Grid = [];
  const row = (...parts: (Cell | null)[]) => {
    const present = parts.filter((c): c is Cell => c != null);
    if (present.length) grid.push(present);
  };

  row(
    cfg.server ? cell("Server", String(guild.name ?? "Server"), ICON.server) : null,
    cfg.owner ? cell("Owner", extras.ownerName, ICON.owner) : null,
  );
  row(
    cfg.created ? cell("Created", created(guild.id ?? gid), ICON.created) : null,
    joined ? cell("Joined", joined, ICON.joined) : null,
  );
  row(
    cfg.members
      ? cell("Members", fmt(guild.approximate_member_count ?? guild.member_count), ICON.members)
      : null,
    cfg.members ? cell("Online", fmt(guild.approximate_presence_count), ICON.online) : null,
  );
  row(
    cfg.channels ? cell("Channels", fmt(extras.channels), ICON.channels) : null,
    cfg.roles ? cell("Roles", fmt(extras.roles), ICON.roles) : null,
  );
  row(
    cfg.boost ? cell("Boost", boost, ICON.boost[boostLevel]) : null,
    vanity ? cell("Vanity", vanity, ICON.vanity) : null,
  );
  row(cfg.id ? cell("ID", String(guild.id ?? gid), ICON.id) : null);
  if (grid.length === 0) grid.push([cell("Server", "no fields enabled", ICON.server)]);
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

let grid: Grid = [[{ label: "Server", value: "info unavailable", icon: ICON.server }]];
let columnsGid: string | null = null;
let currentGid: string | null = null;
let overrideGid: string | null = null;
let overrideAt = 0;
let mountedGid: string | null = null;
let remover: (() => void) | null = null;
let needMount = false;
let busy = false;
let requestSeq = 0;
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

/** A new menu is opening: drop the old block so stale guild data is never shown. */
function invalidateForNewMenu(): void {
  removeMount();
  grid = [[{ label: "Server", value: "Loading…", icon: ICON.server }]];
  columnsGid = null;
  needMount = true;
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
        props: {
          direction: "column",
          gap: 4,
          padding: [12, 10, 12, 10],
          align: "stretch",
          width: "fill",
          background: palette.bg,
          radius: CARD_RADIUS,
          clip: true,
          borderColor: palette.border,
          borderWidth: 1,
          // Pull the card up into the section gap above it instead of leaving a
          // large gap there, so it sits with the same small gap on both sides.
          margin: [0, -24, 0, 0],
        },
        children: grid.map((row) => ({
          kind: "view",
          props: { direction: "row", gap: 10, align: "start", width: "fill" },
          children: row.map((cell) => ({
            kind: "view",
            props: { direction: "row", gap: 4, flex: 1, align: "start", clip: true },
            children: [
              ...(cell.icon
                ? [
                    {
                      kind: "image" as const,
                      props: {
                        uri: cell.icon,
                        width: 12,
                        height: 12,
                        tint: palette.label,
                        margin: [0, 1, 3, 0],
                      },
                    },
                  ]
                : []),
              {
                kind: "text",
                props: {
                  text: cell.label,
                  color: palette.label,
                  fontSize: 11,
                  fontWeight: 500,
                  width: 50,
                  maxLines: 1,
                  lineHeight: 14,
                  lineHeightExact: true,
                },
              },
              {
                kind: "text",
                props: {
                  text: cell.value,
                  color: palette.value,
                  fontSize: 11,
                  flex: 1,
                  width: "fill",
                  maxLines: 1,
                  lineHeight: 14,
                  lineHeightExact: true,
                },
              },
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
  const seq = ++requestSeq;
  if (busy) {
    // Last request wins: no stale queuedGid leaking into the next open.
    queued = { gid, channelId };
    return;
  }
  busy = true;
  try {
    await ensureTheme();
    let target: string | null = gid ?? null;
    if (!target && overrideGid && Date.now() - overrideAt < OVERRIDE_MS) target = overrideGid;
    if (!target) target = currentGid;
    if (!target) target = await guildFromChannel(channelId ?? channelGid());
    if (!target) return;

    const fresh = await infoColumns(target);
    // A newer menu request won while this one was fetching: discard the old data.
    if (seq !== requestSeq) return;
    grid = fresh;
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
      needMount = true;
      void refresh();
    }
  });
}

if (gateway.guildCreate) {
  phoenix.on(gateway.guildCreate, (guild) => {
    const raw = (guild as Json).joined_at ?? (guild as Json).joinedAt;
    const date = dateValue(raw);
    if (date && typeof guild.id === "string") joinedFromGateway.set(guild.id, date);
  });
}

cleanups.push(
  ui.onEvent("rowLongPress", (ev) => {
    const gid = pressedGid(ev);
    if (gid) {
      invalidateForNewMenu();
      overrideGid = gid;
      overrideAt = Date.now();
    }
    void refresh(gid ?? undefined, ev.channelId);
  }),
);

cleanups.push(
  ui.onEvent("press", (ev) => {
    if (ev.accessibilityId === "guild.menu") {
      // The header menu is always for the server the user is in; never reuse a
      // guild resolved for a different menu.
      invalidateForNewMenu();
      overrideGid = null;
      currentGid = null;
      void refresh(undefined, ev.channelId);
    }
  }),
);

for (const label of [ANCHOR, ...FALLBACK_ANCHORS]) {
  cleanups.push(
    ui.onNode({ exact: label }, (node) => {
      const live = ui.node(node.id);
      if ((live?.sheet ?? node.sheet) == null) return;
      invalidateForNewMenu();
      const gid = overrideGid;
      overrideGid = null;
      void refresh(gid ?? undefined);
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
