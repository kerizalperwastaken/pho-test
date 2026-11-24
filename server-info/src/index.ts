// @description Shows server details in the guild menu in two columns: name, ID, members, roles, channels, boosts, vanity URL and description
// @version 1.0.0
// @author kerizalperwastaken
// @enabled true

/**
 * Server Info.
 *
 * Discord's guild header opens a native bottom sheet with the server's actions.
 * A two-column text block is mounted just above the "Edit Per-server Profile"
 * row: labels on the left, values on the right. It shows the server name and
 * ID, member and online counts, role and channel counts, boost level and count,
 * creation date, vanity URL and description. Nothing is added to the header, channel list,
 * composer or profiles.
 *
 * The text is fetched ahead of time so the mount can happen synchronously in
 * the node event: an async mount lands after Phoenix's last children op and
 * disappears. The guild comes from an open `navigation.channel:<id>` node,
 * which belongs to the selected guild.
 */

const ui = phoenix.ui;
const discord = phoenix.discord;
const log = phoenix.log;

type Json = Record<string, any>;
type Columns = { left: string; right: string };

const MAX_DESCRIPTION = 90;
const DISCORD_EPOCH = 1420070400000;
const CHANNEL_PREFIX = "navigation.channel:";

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

function description(text: unknown): string {
  if (typeof text !== "string" || text.length === 0) return "";
  const single = text.replace(/\s+/g, " ").trim();
  return single.length > MAX_DESCRIPTION ? `${single.slice(0, MAX_DESCRIPTION - 1)}…` : single;
}

async function infoColumns(gid: string): Promise<Columns> {
  const guild = await api(`/guilds/${gid}?with_counts=true`);
  if (!guild) return { left: "Server", right: "info unavailable" };

  const [roles, channels] = await Promise.all([
    api(`/guilds/${gid}/roles`),
    api(`/guilds/${gid}/channels`),
  ]);

  const tier = guild.premium_tier;
  const boosts = guild.premium_subscription_count;
  const boost = typeof boosts === "number" && boosts > 0 ? `Lv ${tier ?? 0} (${fmt(boosts)})` : `Lv ${tier ?? 0}`;

  const rows: [string, string][] = [
    ["Server", String(guild.name ?? "Server")],
    ["ID", String(guild.id ?? gid)],
    ["Members", fmt(guild.approximate_member_count ?? guild.member_count)],
    ["Online", fmt(guild.approximate_presence_count)],
    ["Roles", fmt(Array.isArray(roles) ? roles.length : undefined)],
    ["Channels", fmt(Array.isArray(channels) ? channels.length : undefined)],
    ["Boost", boost],
    ["Created", created(guild.id ?? gid)],
  ];

  if (typeof guild.vanity_url_code === "string" && guild.vanity_url_code.length > 0) {
    rows.push(["Vanity", `discord.gg/${guild.vanity_url_code}`]);
  }

  const desc = description(guild.description);
  if (desc) rows.push(["About", desc]);

  return {
    left: rows.map(([label]) => label).join("\n"),
    right: rows.map(([, value]) => value).join("\n"),
  };
}

function currentChannelId(): string | null {
  for (const id of ui.find({ prefix: CHANNEL_PREFIX })) {
    const aid = ui.node(id)?.accessibilityId;
    if (aid) return aid.slice(CHANNEL_PREFIX.length);
  }
  return null;
}

let columns: Columns = { left: "Server", right: "info unavailable" };
let busy = false;

async function refresh(): Promise<void> {
  if (busy) return;
  busy = true;
  try {
    const channelId = currentChannelId();
    if (!channelId) return;
    const channel = await api(`/channels/${channelId}`);
    const gid = channel?.guild_id;
    if (gid) columns = await infoColumns(String(gid));
  } finally {
    busy = false;
  }
}

const done = new Set<number>();
const removers: (() => void)[] = [];

ui.onNode({ exact: "Copy Server Icon Image Link" }, (node) => {
  if (node.sheet == null || done.has(node.sheet)) return;
  done.add(node.sheet);

  const row = ui.find({ exact: "Edit Per-server Profile" })[0];
  if (row == null) return;
  const info = ui.node(row);
  if (!info || info.parent == null) return;

  const remover = ui.mount(
    info.parent,
    {
      kind: "view",
      props: { direction: "row", gap: 16, padding: [12, 16, 12, 16], align: "start" },
      children: [
        { kind: "text", props: { text: columns.left, color: 0xff8e9297, fontSize: 13 } },
        { kind: "text", props: { text: columns.right, color: 0xffb9bbbe, fontSize: 13 } },
      ],
    },
    { before: row },
  );
  removers.push(remover);
  void refresh();
});

void refresh();

phoenix.onUnload(() => {
  for (const remove of removers) {
    try {
      remove();
    } catch {
      // The view may already be gone; unload must still finish.
    }
  }
  removers.length = 0;
  done.clear();
});
