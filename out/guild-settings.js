// @description View guild/server settings as text: overview, roles, channels, invites and boost.
// @version 1.0.0
// @author kerizalperwastaken
// @enabled true
(() => {
  // guild-settings/src/index.ts
  var P = phoenix;
  var ui = P.ui;
  var discord = P.discord;
  var log = P.log;
  var settings = P.settings.define({
    showRoles: { type: "switch", title: "Roles", description: "List the server's roles", default: true },
    showChannels: { type: "switch", title: "Channels", description: "List the server's channels", default: true },
    showInvites: { type: "switch", title: "Invites", description: "List active invites (needs Manage Guild)", default: true },
    menuEntry: { type: "switch", title: "Guild menu entry", description: "Add Guild Settings to the guild context menu", default: true }
  });
  async function api(path) {
    try {
      const res = await discord.get(path);
      return res && typeof res.json === "function" ? res.json() ?? null : null;
    } catch (e) {
      log.warn(`GET ${path}: ${String(e)}`);
      return null;
    }
  }
  async function guildId(channelId) {
    if (!channelId) return void 0;
    const channel = await api(`/channels/${channelId}`);
    return channel?.guild_id ?? void 0;
  }
  function createdLabel(id) {
    try {
      const ms = Number((BigInt(id) >> 22n) + 1420070400000n);
      return new Date(ms).toLocaleDateString(void 0, { year: "numeric", month: "short", day: "numeric" });
    } catch {
      return "\u2014";
    }
  }
  var CHANNEL_TYPES = {
    0: "text",
    2: "voice",
    4: "category",
    5: "announcement",
    10: "thread",
    11: "thread",
    12: "thread",
    13: "stage",
    14: "directory",
    15: "forum",
    16: "media"
  };
  async function load(gid) {
    const guild = await api(`/guilds/${gid}?with_counts=true`);
    if (!guild?.id) return null;
    const [roles, channels, invites] = await Promise.all([
      settings.showRoles ? api(`/guilds/${gid}/roles`) : Promise.resolve(null),
      settings.showChannels ? api(`/guilds/${gid}/channels`) : Promise.resolve(null),
      settings.showInvites ? api(`/guilds/${gid}/invites`) : Promise.resolve(null)
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
      boostCount: typeof guild.premium_subscription_count === "number" ? guild.premium_subscription_count : void 0,
      memberCount: guild.approximate_member_count ?? guild.member_count,
      onlineCount: guild.approximate_presence_count ?? guild.online_count,
      maxMembers: guild.max_members,
      afkTimeout: guild.afk_timeout,
      vanityCode: guild.vanity_url_code,
      createdLabel: createdLabel(gid),
      roles: Array.isArray(roles) ? roles.map((r) => ({ name: String(r.name ?? r.id), color: r.color, position: r.position, hoist: r.hoist, mentionable: r.mentionable })) : [],
      channels: Array.isArray(channels) ? channels.map((c) => ({ name: String(c.name ?? c.id), type: Number(c.type ?? 0), position: c.position })) : [],
      invites: Array.isArray(invites) ? invites.map((i) => ({ code: String(i.code), uses: i.uses, maxUses: i.max_uses, temporary: i.temporary })) : []
    };
  }
  function fmtNum(n) {
    return typeof n === "number" ? n.toLocaleString() : "\u2014";
  }
  function openPage(gid, info) {
    const sections = [
      {
        type: "text",
        title: info.name,
        text: [
          info.description ?? "",
          info.ownerId ? `Owner ID: ${info.ownerId}` : "",
          info.vanityCode ? `Vanity URL: discord.gg/${info.vanityCode}` : "",
          `Created: ${info.createdLabel}`,
          `ID: ${gid}`
        ].filter(Boolean).join("\n") || "Sunucu ayarlar\u0131"
      },
      {
        type: "text",
        title: "Overview",
        text: [
          `Members: ${fmtNum(info.memberCount)}`,
          `Online: ${fmtNum(info.onlineCount)}`,
          `Max members: ${fmtNum(info.maxMembers)}`,
          `Boost Level: ${info.premiumTier}${info.boostCount ? ` \u2014 ${info.boostCount} boost${info.boostCount === 1 ? "" : "s"}` : ""}`,
          `Verification level: ${info.verificationLevel ?? "\u2014"}`,
          `NSFW level: ${info.nsfwLevel ?? "\u2014"}`,
          `MFA required: ${info.mfaLevel === 1 ? "yes" : "no"}`,
          `Explicit content filter: ${info.explicitContentFilter ?? "\u2014"}`,
          `Default notifications: ${info.defaultNotifications === 0 ? "all messages" : info.defaultNotifications === 1 ? "only mentions" : "\u2014"}`,
          `AFK timeout: ${info.afkTimeout ? `${info.afkTimeout}s` : "\u2014"}`
        ].join("\n")
      }
    ];
    if (settings.showRoles) {
      const roleLines = info.roles.sort((a, b) => (b.position ?? 0) - (a.position ?? 0)).map((r) => `\u2022 ${r.name}${r.color ? ` (#${(r.color & 16777215).toString(16).padStart(6, "0")})` : ""}${r.hoist ? " [hoisted]" : ""}${r.mentionable ? " [mentionable]" : ""}`);
      sections.push({ type: "text", title: `Roles (${info.roles.length})`, text: roleLines.length ? roleLines.join("\n") : "Yok" });
    }
    if (settings.showChannels) {
      const channelLines = info.channels.sort((a, b) => (a.position ?? 0) - (b.position ?? 0)).map((c) => `\u2022 [${CHANNEL_TYPES[c.type] ?? c.type}] ${c.name}`);
      sections.push({ type: "text", title: `Channels (${info.channels.length})`, text: channelLines.length ? channelLines.join("\n") : "Yok" });
    }
    if (settings.showInvites) {
      const inviteLines = info.invites.map((i) => `\u2022 ${i.code} \u2014 ${i.uses ?? 0}/${i.maxUses === 0 ? "\u221E" : i.maxUses ?? "\u2014"} uses${i.temporary ? " (temporary)" : ""}`);
      sections.push({ type: "text", title: `Invites (${info.invites.length})`, text: inviteLines.length ? inviteLines.join("\n") : "Yok veya eri\u015Fim yok" });
    }
    ui.openPage({ title: `Guild Settings \u2014 ${info.name}`, sections });
  }
  async function show(gid) {
    const info = await load(gid);
    if (!info) {
      ui.toast("Guild Settings: sunucu bilgileri al\u0131namad\u0131");
      return;
    }
    openPage(gid, info);
  }
  function onGuild(gid) {
    if (gid) void show(gid);
    else ui.toast("Guild Settings: bir sunucu kanal\u0131 a\xE7");
  }
  var lastChannelId = null;
  ui.onEvent("press", (ev) => {
    if (ev.channelId) lastChannelId = ev.channelId;
  });
  ui.onEvent("rowLongPress", (ev) => {
    if (ev.channelId) lastChannelId = ev.channelId;
  });
  var mounted = /* @__PURE__ */ new Map();
  function mountMenuRow(id) {
    if (!settings.menuEntry || mounted.has(id)) return;
    const remover = ui.mount(id, {
      kind: "text",
      props: { text: "Guild Settings", color: 4283983346, fontSize: 16, padding: [10, 14, 10, 14] },
      onPress: () => {
        void guildId(lastChannelId).then(onGuild);
      }
    }, { before: "start" });
    mounted.set(id, remover);
  }
  ui.onNode("guild.menu", (node) => mountMenuRow(node.id));
  for (const id of ui.find("guild.menu")) mountMenuRow(id);
  ui.addHeaderButton({
    label: "Guild Settings",
    icon: "res://ic_mana_settings_circle",
    onPress: async (ctx) => onGuild(await guildId(ctx.channelId))
  });
  phoenix.onUnload(() => {
    for (const remove of mounted.values()) remove();
    mounted.clear();
  });
})();
