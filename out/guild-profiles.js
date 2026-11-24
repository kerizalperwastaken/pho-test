// @description Guild profile extras: roles, mutual friends, blocked users and server features in one place.
// @version 1.1.0
// @author kerizalperwastaken
// @enabled true
(() => {
  // guild-profiles/src/index.ts
  var P = phoenix;
  var ui = P.ui;
  var discord = P.discord;
  var log = P.log;
  var settings = P.settings.define({
    showRoles: { type: "switch", title: "Roles", description: "Show the server's roles", default: true },
    showFriends: { type: "switch", title: "Mutual friends", description: "Show friends in the server", default: true },
    showBlocked: { type: "switch", title: "Blocked users", description: "Show blocked users in the server", default: true },
    showFeatures: { type: "switch", title: "Features", description: "Show the server's features", default: true }
  });
  function notify(message, title = "Guild profiles") {
    if (typeof ui.notify === "function") ui.notify({ title, body: message, durationMs: 3500 });
    else if (typeof ui.toast === "function") ui.toast(`${title}: ${message}`);
    else log.info(`${title}: ${message}`);
  }
  async function get(path) {
    try {
      const res = await discord.get(path);
      return res && typeof res.json === "function" ? res : null;
    } catch (e) {
      log.warn(`GET ${path}: ${String(e)}`);
      return null;
    }
  }
  async function guildIdForChannel(channelId) {
    if (!channelId) return void 0;
    const res = await get(`/channels/${channelId}`);
    return res?.json()?.guild_id || void 0;
  }
  async function roles(guildId) {
    const res = await get(`/guilds/${guildId}/roles`);
    const list = res?.json();
    return (list ?? []).map((r) => ({ id: r.id, name: r.name, color: r.color }));
  }
  async function memberIds(guildId) {
    const res = await get(`/guilds/${guildId}/members?limit=1000`);
    const list = res?.json() ?? [];
    return new Set(list.map((m) => m.user?.id).filter((id) => !!id));
  }
  async function relatedInGuild(guildId, type) {
    const [rels, members] = await Promise.all([get("/users/@me/relationships"), memberIds(guildId)]);
    const list = rels?.json() ?? [];
    const ids = list.filter((r) => r.type === type).map((r) => r.id ?? r.user_id).filter((id) => !!id && members.has(id));
    return [...new Set(ids)];
  }
  async function features(guildId) {
    const res = await get(`/guilds/${guildId}`);
    return res?.json()?.features ?? [];
  }
  function lines(title, items) {
    return items.length ? `${title} (${items.length}):
${items.map((x) => `\u2022 ${x}`).join("\n")}` : `${title}: yok`;
  }
  ui.addProfileTab({
    title: "Guild",
    priority: 50,
    render: async (ctx) => {
      const userId = ctx.userId;
      if (!userId) return [];
      const guildId = await guildIdForChannel(ctx.channelId);
      if (!guildId) {
        return [{ type: "text", title: "Guild", text: "Sunucu kanal\u0131nda a\xE7\u0131ld\u0131\u011F\u0131nda bu \xFCyenin rollerini g\xF6sterir." }];
      }
      try {
        const [member, allRoles] = await Promise.all([
          get(`/guilds/${guildId}/members/${userId}`),
          roles(guildId)
        ]);
        const roleIds = member?.json()?.roles ?? [];
        const mine = allRoles.filter((r) => roleIds.includes(r.id));
        const names = mine.length ? mine.map((r) => r.name + (r.color ? ` (#${r.color.toString(16).padStart(6, "0")})` : "")) : ["Rol yok"];
        return [{ type: "text", title: "Sunucu rolleri", text: names.join("\n") }];
      } catch (e) {
        return [{ type: "text", title: "Guild", text: `Roller okunamad\u0131: ${String(e)}` }];
      }
    }
  });
  ui.addHeaderButton({
    label: "Guild profiles",
    icon: "res://ic_mana_puzzle_piece_plus",
    onPress: async (ctx) => {
      const guildId = await guildIdForChannel(ctx.channelId);
      if (!guildId) {
        notify("\xD6nce bir sunucu kanal\u0131 a\xE7");
        return;
      }
      const choice = await ui.choose({
        title: "Guild profiles",
        message: "Sunucu bilgilerini g\xF6ster",
        options: [
          { label: "Roller" },
          { label: "Ortak arkada\u015Flar" },
          { label: "Engelli kullan\u0131c\u0131lar" },
          { label: "Sunucu \xF6zellikleri" }
        ]
      });
      if (choice === 0 && settings.showRoles) {
        const list = await roles(guildId);
        ui.showSheet({
          title: "Roller",
          text: lines("Roller", list.map((r) => r.name + (r.color ? ` (#${r.color.toString(16).padStart(6, "0")})` : ""))),
          monospace: true
        });
      } else if (choice === 1 && settings.showFriends) {
        ui.showSheet({ title: "Ortak arkada\u015Flar", text: lines("Ortak arkada\u015Flar", await relatedInGuild(guildId, 1)) });
      } else if (choice === 2 && settings.showBlocked) {
        ui.showSheet({ title: "Engelli kullan\u0131c\u0131lar", text: lines("Engelli kullan\u0131c\u0131lar", await relatedInGuild(guildId, 2)) });
      } else if (choice === 3 && settings.showFeatures) {
        ui.showSheet({ title: "Sunucu \xF6zellikleri", text: lines("\xD6zellikler", await features(guildId)), monospace: true });
      }
    }
  });
})();
