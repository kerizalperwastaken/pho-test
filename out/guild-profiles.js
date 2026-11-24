// @description Guild profile extras: roles, mutual friends, blocked users and server features in one place.
// @version 1.0.0
// @author kerizalperwastaken
// @enabled true
(() => {
  // guild-profiles/src/index.ts
  var { ui, discord, stores, log, gateway } = phoenix;
  var channelsByGuild = /* @__PURE__ */ new Map();
  var channelToGuild = /* @__PURE__ */ new Map();
  phoenix.on(gateway.guildCreate, (guild) => {
    const set = /* @__PURE__ */ new Set();
    for (const c of guild.channels ?? []) {
      channelToGuild.set(c.id, guild.id);
      set.add(c.id);
    }
    channelsByGuild.set(guild.id, set);
  });
  function guildIdForChannel(channelId) {
    return channelId ? channelToGuild.get(channelId) : void 0;
  }
  var settings = phoenix.settings.define({
    showRoles: { type: "switch", title: "Roles", description: "Show the server's roles", default: true },
    showFriends: { type: "switch", title: "Mutual friends", description: "Show friends in the server", default: true },
    showBlocked: { type: "switch", title: "Blocked users", description: "Show blocked users in the server", default: true },
    showFeatures: { type: "switch", title: "Features", description: "Show the server's features", default: true }
  });
  function notify(message, title = "Guild profiles") {
    ui.notify({ title, body: message, durationMs: 3e3 });
  }
  async function guildRoles(guildId) {
    try {
      const rows = await stores.sql(
        "SELECT id, name, color, position FROM roles WHERE guild_id = ? ORDER BY position DESC LIMIT 500",
        guildId
      );
      return rows.map((r) => ({ id: r.id, name: r.name, color: r.color, position: r.position }));
    } catch (e) {
      log.warn(`roles query failed: ${String(e)}`);
      return [];
    }
  }
  async function usersWithRelationship(guildId, relationship) {
    try {
      const res = await discord.get(`/guilds/${guildId}/members?limit=200`);
      if (!res.ok) return [];
      const members = res.json() ?? [];
      const table = relationship === 1 ? "relationships" : "relationships";
      const type = relationship === 1 ? 1 : 2;
      const rows = await stores.sql(
        `SELECT id FROM ${table} WHERE type = ? LIMIT 1000`,
        type
      );
      const ids = new Set(rows.map((r) => r.id));
      return members.map((m) => m.user?.id).filter((id) => !!id && ids.has(id));
    } catch (e) {
      log.warn(`members query failed: ${String(e)}`);
      return [];
    }
  }
  async function guildFeatures(guildId) {
    try {
      const res = await discord.get(`/guilds/${guildId}`);
      if (!res.ok) return [];
      const guild = res.json();
      const list = guild?.features ?? [];
      return list.map((name) => ({ name, enabled: true }));
    } catch (e) {
      log.warn(`guild fetch failed: ${String(e)}`);
      return [];
    }
  }
  function formatRoles(roles) {
    return roles.length ? roles.map((r) => `\u2022 ${r.name}${r.color ? ` (color #${r.color.toString(16).padStart(6, "0")})` : ""}`).join("\n") : "No roles found in the local cache.";
  }
  function formatUsers(ids, title) {
    return ids.length ? `${title} (${ids.length}):
${ids.map((id) => `\u2022 <@${id}>`).join("\n")}` : `No ${title.toLowerCase()} found.`;
  }
  function formatFeatures(features) {
    return features.length ? features.map((f) => `\u2022 ${f.name}`).join("\n") : "No special features.";
  }
  ui.addProfileTab({
    title: "Guild",
    priority: 50,
    render: (ctx) => {
      const userId = ctx.userId;
      if (!userId) return [];
      return [
        {
          type: "text",
          title: "Guild tools",
          text: "Open the guild menu from a server's member list, or use the header button."
        }
      ];
    }
  });
  ui.addHeaderButton({
    label: "Guild profiles",
    icon: "res://ic_mana_puzzle_piece_plus",
    onPress: async (ctx) => {
      const guildId = guildIdForChannel(ctx.channelId);
      if (!guildId) {
        notify("Open a server channel first", "Guild profiles");
        return;
      }
      const choice = await ui.choose({
        title: "Guild profiles",
        options: [
          { label: "Roles" },
          { label: "Mutual friends" },
          { label: "Blocked users" },
          { label: "Server features" }
        ]
      });
      if (choice < 0) return;
      if (choice === 0 && settings.showRoles) {
        const roles = await guildRoles(guildId);
        ui.showSheet({ title: "Roles", text: formatRoles(roles), monospace: true });
      } else if (choice === 1 && settings.showFriends) {
        const ids = await usersWithRelationship(guildId, 1);
        ui.showSheet({ title: "Mutual friends", text: formatUsers(ids, "Mutual friends") });
      } else if (choice === 2 && settings.showBlocked) {
        const ids = await usersWithRelationship(guildId, 2);
        ui.showSheet({ title: "Blocked users", text: formatUsers(ids, "Blocked users") });
      } else if (choice === 3 && settings.showFeatures) {
        const features = await guildFeatures(guildId);
        ui.showSheet({ title: "Server features", text: formatFeatures(features), monospace: true });
      }
    }
  });
})();
