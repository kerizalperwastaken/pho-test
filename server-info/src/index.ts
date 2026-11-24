// @description View full server information: members, online, roles, channels, boosts, owner and friends.
// @version 1.0.0
// @author kerizalperwastaken
// @enabled true

/**
 * Server Info — port of WolfPlugs/valenced-plugins `server-info` to Phoenix.
 *
 * The original adds a "Server Info" item to the guild bar context menu and
 * opens a full sheet with: banner, name/description, an Overview (members,
 * online, roles, channels, boost level), Server (owner, created, id) and the
 * friends you have in that server (first five, expandable, each opening the
 * member's profile).
 *
 * Phoenix has no guild context-menu patch API and no image section in pages, so
 * this port keeps every piece of information and the expandable friends list,
 * but presents it with `ui.openPage` / `ui.showSheet`. The guild id comes from
 * the open channel, and the only entry point is the header button — global
 * press hooks were removed because they fired on every server-profile row.
 */

const P = phoenix;
const ui = P.ui;
const discord = P.discord;
const log = P.log;

const settings = P.settings.define({
  showFriends: { type: "switch", title: "Friends in server", description: "Include friends you share the server with", default: true },
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

const formatCount = (n: unknown): string =>
  typeof n === "number" ? n.toLocaleString() : "—";

function createdLabel(id: string): string {
  try {
    const ms = Number((BigInt(id) >> 22n) + 1420070400000n);
    return new Date(ms).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
  } catch {
    return "—";
  }
}

async function guildId(channelId: string | null | undefined): Promise<string | undefined> {
  if (!channelId) return undefined;
  const channel = await api(`/channels/${channelId}`);
  return channel?.guild_id ?? undefined;
}

interface Info {
  name: string;
  description: string | null;
  iconUri?: string;
  bannerUri?: string;
  ownerId: string | null;
  ownerName: string | null;
  memberCount?: number;
  onlineCount?: number;
  roleCount?: number;
  channelCount?: number;
  boostLabel?: string;
  premiumTier: number;
  createdLabel: string;
  friends: { id: string; name: string; nick?: string }[];
}

async function load(gid: string): Promise<Info | null> {
  const guild = await api(`/guilds/${gid}?with_counts=true`);
  if (!guild?.id) return null;
  const [roles, channels, relationships, owner] = await Promise.all([
    api(`/guilds/${gid}/roles`),
    api(`/guilds/${gid}/channels`),
    settings.showFriends ? api("/users/@me/relationships") : Promise.resolve(null),
    guild.owner_id ? api(`/users/${guild.owner_id}`) : Promise.resolve(null),
  ]);

  const icon = guild.icon as string | undefined;
  const banner = guild.banner as string | undefined;
  const roleList = Array.isArray(roles) ? roles : [];
  const channelList = Array.isArray(channels) ? channels : [];
  const relList = Array.isArray(relationships) ? relationships : [];
  const memberIds = new Set<string>();
  if (settings.showFriends) {
    const members = await api(`/guilds/${gid}/members?limit=1000`);
    for (const m of Array.isArray(members) ? members : []) {
      if (m?.user?.id) memberIds.add(String(m.user.id));
    }
  }
  const friends = relList
    .filter((r) => r?.type === 1)
    .map((r) => r.user ?? r)
    .filter((u) => u?.id && memberIds.has(String(u.id)))
    .map((u) => ({
      id: String(u.id),
      name: String(u.global_name ?? u.username ?? u.id),
      nick: undefined as string | undefined,
    }));

  const boosts = typeof guild.premium_subscription_count === "number" ? guild.premium_subscription_count : undefined;
  return {
    name: String(guild.name ?? "Sunucu"),
    description: guild.description ? String(guild.description) : null,
    iconUri: icon ? `https://cdn.discordapp.com/icons/${gid}/${icon}?size=128` : undefined,
    bannerUri: banner ? `https://cdn.discordapp.com/banners/${gid}/${banner}?size=1024` : undefined,
    ownerId: guild.owner_id ? String(guild.owner_id) : null,
    ownerName: owner ? String(owner.global_name ?? owner.username ?? owner.id) : null,
    memberCount: guild.approximate_member_count ?? guild.member_count,
    onlineCount: guild.approximate_presence_count ?? guild.online_count,
    roleCount: roleList.length,
    channelCount: channelList.length,
    boostLabel: boosts != null && boosts > 0 ? `${boosts.toLocaleString()} boost${boosts === 1 ? "" : "s"}` : undefined,
    premiumTier: Number(guild.premium_tier ?? 0),
    createdLabel: createdLabel(gid),
    friends,
  };
}

function open(gid: string, info: Info, expanded: boolean): void {
  const sections: any[] = [
    {
      type: "text",
      title: info.name,
      text: [
        info.description ?? "",
        info.iconUri ? `Icon: ${info.iconUri}` : "",
        info.bannerUri ? `Banner: ${info.bannerUri}` : "",
      ].filter(Boolean).join("\n") || "Sunucu bilgileri",
    },
    {
      type: "text",
      title: "Overview",
      text: [
        `Members: ${formatCount(info.memberCount)}`,
        `Online: ${formatCount(info.onlineCount)}`,
        `Roles: ${formatCount(info.roleCount)}`,
        `Channels: ${formatCount(info.channelCount)}`,
        `Boost Level: Level ${info.premiumTier}${info.boostLabel ? ` — ${info.boostLabel}` : ""}`,
      ].join("\n"),
    },
    {
      type: "text",
      title: "Server",
      text: [
        `Owner: ${info.ownerName ?? "—"}${info.ownerId ? ` (${info.ownerId})` : ""}`,
        `Created: ${info.createdLabel}`,
        `ID: ${gid}`,
      ].join("\n"),
    },
  ];

  if (settings.showFriends) {
    const visible = expanded ? info.friends : info.friends.slice(0, 5);
    sections.push({
      type: "text",
      title: `Friends in Server (${info.friends.length})`,
      text: visible.length
        ? visible.map((f) => `• ${f.nick ? `${f.nick} (${f.name})` : f.name}`).join("\n")
        : "Bu sunucuda arkadaşın yok.",
    });
    if (info.friends.length > 5) {
      sections.push({
        type: "buttons",
        title: "Friends",
        buttons: [{
          label: expanded ? `Show less (${info.friends.length})` : `Show all ${info.friends.length} friends`,
          onPress: () => open(gid, info, !expanded),
        }],
      });
    }
  }

  ui.openPage({ title: `Server Info — ${info.name}`, sections });
}

async function show(gid: string, expanded = false): Promise<void> {
  const info = await load(gid);
  if (!info) {
    ui.toast("Server Info: sunucu bilgileri alınamadı");
    return;
  }
  open(gid, info, expanded);
}

/** Opens the page for a guild id (or tells the user to open a server channel). */
function onGuild(gid: string | null | undefined): void {
  if (gid) void show(gid);
  else ui.toast("Server Info: bir sunucu kanalı aç");
}

// No global press/long-press hooks: they fired on every row of the server
// profile and turned everything into Server Info. The header button is the
// only entry point, so nothing else in Discord is touched.
ui.addHeaderButton({
  label: "Server Info",
  icon: "res://ic_mana_settings_circle",
  onPress: async (ctx) => onGuild(await guildId(ctx.channelId)),
});


