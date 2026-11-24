// @description View full server information: members, online, roles, channels, boosts, owner and friends.
// @version 1.0.0
// @author kerizalperwastaken
// @enabled true
(() => {
  // server-info/src/index.ts
  var P = phoenix;
  var ui = P.ui;
  var discord = P.discord;
  var log = P.log;
  var settings = P.settings.define({
    menuEntry: { type: "switch", title: "Guild menu entry", description: "Add Server Info to the guild context menu when possible", default: true },
    showFriends: { type: "switch", title: "Friends in server", description: "Include friends you share the server with", default: true }
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
  var formatCount = (n) => typeof n === "number" ? n.toLocaleString() : "\u2014";
  function createdLabel(id) {
    try {
      const ms = Number((BigInt(id) >> 22n) + 1420070400000n);
      return new Date(ms).toLocaleDateString(void 0, { year: "numeric", month: "short", day: "numeric" });
    } catch {
      return "\u2014";
    }
  }
  async function guildId(channelId) {
    if (!channelId) return void 0;
    const channel = await api(`/channels/${channelId}`);
    return channel?.guild_id ?? void 0;
  }
  async function load(gid) {
    const guild = await api(`/guilds/${gid}?with_counts=true`);
    if (!guild?.id) return null;
    const [roles, channels, relationships, owner] = await Promise.all([
      api(`/guilds/${gid}/roles`),
      api(`/guilds/${gid}/channels`),
      settings.showFriends ? api("/users/@me/relationships") : Promise.resolve(null),
      guild.owner_id ? api(`/users/${guild.owner_id}`) : Promise.resolve(null)
    ]);
    const icon = guild.icon;
    const banner = guild.banner;
    const roleList = Array.isArray(roles) ? roles : [];
    const channelList = Array.isArray(channels) ? channels : [];
    const relList = Array.isArray(relationships) ? relationships : [];
    const memberIds = /* @__PURE__ */ new Set();
    if (settings.showFriends) {
      const members = await api(`/guilds/${gid}/members?limit=1000`);
      for (const m of Array.isArray(members) ? members : []) {
        if (m?.user?.id) memberIds.add(String(m.user.id));
      }
    }
    const friends = relList.filter((r) => r?.type === 1).map((r) => r.user ?? r).filter((u) => u?.id && memberIds.has(String(u.id))).map((u) => ({
      id: String(u.id),
      name: String(u.global_name ?? u.username ?? u.id),
      nick: void 0
    }));
    const boosts = typeof guild.premium_subscription_count === "number" ? guild.premium_subscription_count : void 0;
    return {
      name: String(guild.name ?? "Sunucu"),
      description: guild.description ? String(guild.description) : null,
      iconUri: icon ? `https://cdn.discordapp.com/icons/${gid}/${icon}?size=128` : void 0,
      bannerUri: banner ? `https://cdn.discordapp.com/banners/${gid}/${banner}?size=1024` : void 0,
      ownerId: guild.owner_id ? String(guild.owner_id) : null,
      ownerName: owner ? String(owner.global_name ?? owner.username ?? owner.id) : null,
      memberCount: guild.approximate_member_count ?? guild.member_count,
      onlineCount: guild.approximate_presence_count ?? guild.online_count,
      roleCount: roleList.length,
      channelCount: channelList.length,
      boostLabel: boosts != null && boosts > 0 ? `${boosts.toLocaleString()} boost${boosts === 1 ? "" : "s"}` : void 0,
      premiumTier: Number(guild.premium_tier ?? 0),
      createdLabel: createdLabel(gid),
      friends
    };
  }
  function open(gid, info, expanded) {
    const sections = [
      {
        type: "text",
        title: info.name,
        text: [
          info.description ?? "",
          info.iconUri ? `Icon: ${info.iconUri}` : "",
          info.bannerUri ? `Banner: ${info.bannerUri}` : ""
        ].filter(Boolean).join("\n") || "Sunucu bilgileri"
      },
      {
        type: "text",
        title: "Overview",
        text: [
          `Members: ${formatCount(info.memberCount)}`,
          `Online: ${formatCount(info.onlineCount)}`,
          `Roles: ${formatCount(info.roleCount)}`,
          `Channels: ${formatCount(info.channelCount)}`,
          `Boost Level: Level ${info.premiumTier}${info.boostLabel ? ` \u2014 ${info.boostLabel}` : ""}`
        ].join("\n")
      },
      {
        type: "text",
        title: "Server",
        text: [
          `Owner: ${info.ownerName ?? "\u2014"}${info.ownerId ? ` (${info.ownerId})` : ""}`,
          `Created: ${info.createdLabel}`,
          `ID: ${gid}`
        ].join("\n")
      }
    ];
    if (settings.showFriends) {
      const visible = expanded ? info.friends : info.friends.slice(0, 5);
      sections.push({
        type: "text",
        title: `Friends in Server (${info.friends.length})`,
        text: visible.length ? visible.map((f) => `\u2022 ${f.nick ? `${f.nick} (${f.name})` : f.name}`).join("\n") : "Bu sunucuda arkada\u015F\u0131n yok."
      });
      if (info.friends.length > 5) {
        sections.push({
          type: "buttons",
          title: "Friends",
          buttons: [{
            label: expanded ? `Show less (${info.friends.length})` : `Show all ${info.friends.length} friends`,
            onPress: () => open(gid, info, !expanded)
          }]
        });
      }
    }
    ui.openPage({ title: `Server Info \u2014 ${info.name}`, sections });
  }
  async function show(gid, expanded = false) {
    const info = await load(gid);
    if (!info) {
      ui.toast("Server Info: sunucu bilgileri al\u0131namad\u0131");
      return;
    }
    open(gid, info, expanded);
  }
  function onGuild(gid) {
    if (gid) void show(gid);
    else ui.toast("Server Info: bir sunucu kanal\u0131 a\xE7");
  }
  var lastChannelId = null;
  var menuSeen = /* @__PURE__ */ new Set();
  ui.onEvent("press", (ev) => {
    if (ev.channelId) lastChannelId = ev.channelId;
  });
  ui.onEvent("rowLongPress", (ev) => {
    if (ev.channelId) lastChannelId = ev.channelId;
    if (!settings.menuEntry) return;
    const aid = ev.accessibilityId ?? "";
    if (/guild|server/i.test(aid)) onGuild(lastChannelId);
  }, { intercept: false });
  ui.onNode({ prefix: "" }, (node) => {
    if (!settings.menuEntry || node.parent == null) return;
    const aid = node.accessibilityId ?? "";
    if (!/guild|server/i.test(aid)) return;
    const key = `${node.parent}:${aid}`;
    if (menuSeen.has(key)) return;
    menuSeen.add(key);
    ui.mount(node.parent, {
      kind: "text",
      props: { text: "Server Info", color: 4283983346, fontSize: 16, padding: [10, 14, 10, 14] },
      onPress: () => onGuild(lastChannelId)
    }, { before: node.id });
  });
  ui.addHeaderButton({
    label: "Server Info",
    icon: "res://ic_mana_settings_circle",
    onPress: async (ctx) => {
      lastChannelId = ctx.channelId;
      onGuild(await guildId(ctx.channelId));
    }
  });
  phoenix.onUnload(() => {
    menuSeen.clear();
  });
})();
