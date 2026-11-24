// @description Server info as text inside the guild menu sheet only. No buttons, nothing elsewhere.
// @version 1.0.0
// @author kerizalperwastaken
// @enabled true

/**
 * Guild Menu Info.
 *
 * The guild header (`guild.menu`) opens a native bottom sheet containing the
 * server's actions (Invite People, Server Settings, Copy Server ID, ...).
 * This plugin adds ONE text block with server info to that sheet — nothing is
 * added to the header, channel, composer, user profiles or any other place.
 *
 * Flow: a press on `guild.menu` arms a short window; the first node created
 * inside a sheet in that window identifies the sheet; a text node is mounted
 * at the top of that sheet. The guild id comes from the press event's channel.
 */

const P = phoenix;
const ui = P.ui;
const discord = P.discord;
const log = P.log;

type Json = Record<string, any>;

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

async function infoText(gid: string): Promise<string> {
  const guild = await api(`/guilds/${gid}?with_counts=true`);
  if (!guild) return "Server info unavailable";
  const [roles, channels] = await Promise.all([
    api(`/guilds/${gid}/roles`),
    api(`/guilds/${gid}/channels`),
  ]);
  const boosts = guild.premium_subscription_count;
  return [
    `${guild.name ?? "Server"} — ${gid}`,
    `Members ${fmt(guild.approximate_member_count ?? guild.member_count)} · Online ${fmt(guild.approximate_presence_count)}`,
    `Roles ${fmt(Array.isArray(roles) ? roles.length : undefined)} · Channels ${fmt(Array.isArray(channels) ? channels.length : undefined)}`,
    `Boost Lv ${guild.premium_tier ?? 0}${typeof boosts === "number" && boosts > 0 ? ` (${boosts})` : ""}`,
  ].join("\n");
}

/** Collects sheet ids from the mirrored view tree, without touching any node. */
function sheetIds(): number[] {
  const root = ui.root();
  if (root == null) return [];
  const found = new Set<number>();
  const stack: number[] = [root];
  const seen = new Set<number>();
  while (stack.length && seen.size < 8000) {
    const id = stack.pop()!;
    if (seen.has(id)) continue;
    seen.add(id);
    const node = ui.node(id);
    if (!node) continue;
    if (node.sheet != null) found.add(node.sheet);
    for (const child of node.children ?? []) stack.push(child);
  }
  return [...found];
}

let armedAt = 0;
let armedChannel: string | null = null;
const done = new Set<number>();
const removers: (() => void)[] = [];

async function fillSheet(sheet: number): Promise<void> {
  if (done.has(sheet)) return;
  done.add(sheet);
  if (!armedChannel) return;
  const channel = await api(`/channels/${armedChannel}`);
  const gid = channel?.guild_id;
  if (!gid) return;
  const text = await infoText(gid);
  const remover = ui.mount(sheet, {
    kind: "text",
    props: { text, color: 0xffb9bbbe, fontSize: 13, padding: [12, 16, 12, 16] },
  }, { before: "start" });
  removers.push(remover);
}

ui.onEvent("press", (ev) => {
  if (ev.accessibilityId !== "guild.menu") return;
  armedAt = Date.now();
  armedChannel = ev.channelId ?? null;
  // If the sheet is already open, fill it right away.
  for (const sheet of sheetIds()) void fillSheet(sheet);
});

ui.onNode({ prefix: "" }, (node) => {
  if (node.sheet == null) return;
  if (Date.now() - armedAt > 5000) return;
  void fillSheet(node.sheet);
});

phoenix.onUnload(() => {
  for (const remove of removers) remove();
  removers.length = 0;
  done.clear();
});
