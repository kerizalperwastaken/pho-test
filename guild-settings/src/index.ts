// @description View guild/server settings as text: overview, roles, channels, invites and boost.
// @version 1.0.0
// @author kerizalperwastaken
// @enabled true

/**
 * Guild Settings — Phoenix port.
 *
 * Adds a "Guild Settings" entry to the guild bar context menu (exact node
 * `guild.menu`) and to the header bar. It opens a native page listing the
 * server's settings as text: overview, roles, channels, invites (when the
 * account has access) and boost/premium info. No buttons inside the content.
 */

const P = phoenix;
const ui = P.ui;
const discord = P.discord;
const log = P.log;

const settings = P.settings.define({
  showRoles: { type: "switch", title: "Roles", description: "List the server's roles", default: true },
  showChannels: { type: "switch", title: "Channels", description: "List the server's channels", default: true },
  showInvites: { type: "switch", title: "Invites", description: "List active invites (needs Manage Guild)", default: true },
  menuEntry: { type: "switch", title: "Guild menu entry", description: "Add Guild Settings to the guild context menu", default: true },
});

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

async function guildId(channelId: string | null | undefined): Promise<string | undefined> {
  if (!channelId) return undefined;
  const channel = await api(`/channels/${channelId}`);
  return channel?.guild_id ?? undefined;
}

function createdLabel(id: string): string {
  try {
    const ms = Number((BigInt(id) >> 22n) + 1420070400000n);
    return new Date(ms).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
  } catch {
    return "—";
  }
}

const CHANNEL_TYPES: Record<number, string> = {
  0: "text", 2: "voice", 4: "category", 5: "announcement", 10: "thread",
  11: "thread", 12: "thread", 13: "stage", 14: "directory", 15: "forum", 16: "media",
};

interface Info {
  name: string;
  description: string | null;
  ownerId: string | null;
  verificationLevel?: number;
  nsfwLevel?: number;
  mfaLevel?: number;
  explicitContentFilter?: number;
  defaultNotifications?: number;
  premiumTier: number;
  boostCount?: number;
  memberCount?: number;
  onlineCount?: number;
  maxMembers?: number;
  afkTimeout?: number;
  vanityCode?: string | null;
  createdLabel: string;
  roles: { name: string; color?: number; position?: number; hoist?: boolean; mentionable?: boolean }[];
  channels: { name: string; type: number; position?: number }[];
  invites: { code: string; uses?: number; maxUses?: number; temporary?: boolean }[];
}

async function load(gid: string): Promise<Info | null> {
  const guild = await api(`/guilds/${gid}?with_counts=true`);
  if (!guild?.id) return null;
  const [roles, channels, invites] = await Promise.all([
    settings.showRoles ? api(`/guilds/${gid}/roles`) : Promise.resolve(null),
    settings.showChannels ? api(`/guilds/${gid}/channels`) : Promise.resolve(null),
    settings.showInvites ? api(`/guilds/${gid}/invites`) : Promise.resolve(null),
  ]);
  return {
    name: String(guild.name ?? "Sunucu"),
    description: guild.description ? String(guild.description) : null,
    ownerId: guild.owner_id ? String(guild.owner_id) : null,
    verificationLevel: guild.verification_level,
    nsfwLevel: guild.nsfw_level,
    mfaLevel: guild.mfa_level,
    explicitContentFilter: guild.explicit_content_filter,
    defaultNotifications: guild.default_message_notifications,
    premiumTier: Number(guild.premium_tier ?? 0),
    boostCount: typeof guild.premium_subscription_count === "number" ? guild.premium_subscription_count : undefined,
    memberCount: guild.approximate_member_count ?? guild.member_count,
    onlineCount: guild.approximate_presence_count ?? guild.online_count,
    maxMembers: guild.max_members,
    afkTimeout: guild.afk_timeout,
    vanityCode: guild.vanity_url_code,
    createdLabel: createdLabel(gid),
    roles: Array.isArray(roles)
      ? roles.map((r: Json) => ({ name: String(r.name ?? r.id), color: r.color, position: r.position, hoist: r.hoist, mentionable: r.mentionable }))
      : [],
    channels: Array.isArray(channels)
      ? channels.map((c: Json) => ({ name: String(c.name ?? c.id), type: Number(c.type ?? 0), position: c.position }))
      : [],
    invites: Array.isArray(invites)
      ? invites.map((i: Json) => ({ code: String(i.code), uses: i.uses, maxUses: i.max_uses, temporary: i.temporary }))
      : [],
  };
}

function fmtNum(n: unknown): string {
  return typeof n === "number" ? n.toLocaleString() : "—";
}

function openPage(gid: string, info: Info): void {
  const sections: any[] = [
    {
      type: "text",
      title: info.name,
      text: [
        info.description ?? "",
        info.ownerId ? `Owner ID: ${info.ownerId}` : "",
        info.vanityCode ? `Vanity URL: discord.gg/${info.vanityCode}` : "",
        `Created: ${info.createdLabel}`,
        `ID: ${gid}`,
      ].filter(Boolean).join("\n") || "Sunucu ayarları",
    },
    {
      type: "text",
      title: "Overview",
      text: [
        `Members: ${fmtNum(info.memberCount)}`,
        `Online: ${fmtNum(info.onlineCount)}`,
        `Max members: ${fmtNum(info.maxMembers)}`,
        `Boost Level: ${info.premiumTier}${info.boostCount ? ` — ${info.boostCount} boost${info.boostCount === 1 ? "" : "s"}` : ""}`,
        `Verification level: ${info.verificationLevel ?? "—"}`,
        `NSFW level: ${info.nsfwLevel ?? "—"}`,
        `MFA required: ${info.mfaLevel === 1 ? "yes" : "no"}`,
        `Explicit content filter: ${info.explicitContentFilter ?? "—"}`,
        `Default notifications: ${info.defaultNotifications === 0 ? "all messages" : info.defaultNotifications === 1 ? "only mentions" : "—"}`,
        `AFK timeout: ${info.afkTimeout ? `${info.afkTimeout}s` : "—"}`,
      ].join("\n"),
    },
  ];

  if (settings.showRoles) {
    const roleLines = info.roles
      .sort((a, b) => (b.position ?? 0) - (a.position ?? 0))
      .map((r) => `• ${r.name}${r.color ? ` (#${(r.color & 0xffffff).toString(16).padStart(6, "0")})` : ""}${r.hoist ? " [hoisted]" : ""}${r.mentionable ? " [mentionable]" : ""}`);
    sections.push({ type: "text", title: `Roles (${info.roles.length})`, text: roleLines.length ? roleLines.join("\n") : "Yok" });
  }

  if (settings.showChannels) {
    const channelLines = info.channels
      .sort((a, b) => (a.position ?? 0) - (b.position ?? 0))
      .map((c) => `• [${CHANNEL_TYPES[c.type] ?? c.type}] ${c.name}`);
    sections.push({ type: "text", title: `Channels (${info.channels.length})`, text: channelLines.length ? channelLines.join("\n") : "Yok" });
  }

  if (settings.showInvites) {
    const inviteLines = info.invites.map((i) => `• ${i.code} — ${i.uses ?? 0}/${i.maxUses === 0 ? "∞" : (i.maxUses ?? "—")} uses${i.temporary ? " (temporary)" : ""}`);
    sections.push({ type: "text", title: `Invites (${info.invites.length})`, text: inviteLines.length ? inviteLines.join("\n") : "Yok veya erişim yok" });
  }

  ui.openPage({ title: `Guild Settings — ${info.name}`, sections });
}

async function show(gid: string): Promise<void> {
  const info = await load(gid);
  if (!info) {
    ui.toast("Guild Settings: sunucu bilgileri alınamadı");
    return;
  }
  openPage(gid, info);
}

function onGuild(gid: string | null | undefined): void {
  if (gid) void show(gid);
  else ui.toast("Guild Settings: bir sunucu kanalı aç");
}

let lastChannelId: string | null = null;
ui.onEvent("press", (ev) => { if (ev.channelId) lastChannelId = ev.channelId; });
ui.onEvent("rowLongPress", (ev) => { if (ev.channelId) lastChannelId = ev.channelId; });

const mounted = new Map<number, () => void>();
function mountMenuRow(id: number): void {
  if (!settings.menuEntry || mounted.has(id)) return;
  const remover = ui.mount(id, {
    kind: "text",
    props: { text: "Guild Settings", color: 0xff5865f2, fontSize: 16, padding: [10, 14, 10, 14] },
    onPress: () => { void guildId(lastChannelId).then(onGuild); },
  }, { before: "start" });
  mounted.set(id, remover);
}
ui.onNode("guild.menu", (node) => mountMenuRow(node.id));
for (const id of ui.find("guild.menu")) mountMenuRow(id);

ui.addHeaderButton({
  label: "Guild Settings",
  icon: "res://ic_mana_settings_circle",
  onPress: async (ctx) => onGuild(await guildId(ctx.channelId)),
});

phoenix.onUnload(() => {
  for (const remove of mounted.values()) remove();
  mounted.clear();
});
