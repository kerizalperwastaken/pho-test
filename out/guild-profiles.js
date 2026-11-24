// @description Guild profile sheet actions: roles, mutual friends, blocked users and server features.
// @version 2.0.0
// @author kerizalperwastaken
// @enabled true
(() => {
  // guild-profiles/src/index.ts
  var P = phoenix;
  var ui = P.ui;
  var discord = P.discord;
  var log = P.log;
  var settings = P.settings.define({
    roles: { type: "switch", title: "Roles", description: "Show Roles in the guild profile sheet", default: true },
    friends: { type: "switch", title: "Mutual friends", description: "Show Mutual friends", default: true },
    blocked: { type: "switch", title: "Blocked users", description: "Show Blocked users", default: true },
    features: { type: "switch", title: "Features", description: "Show server features", default: true },
    probe: { type: "switch", title: "Log sheet node ids", description: "Debug: log accessibility ids while a sheet opens", default: false }
  });
  async function get(path) {
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
    const channel = await get(`/channels/${channelId}`);
    return channel?.guild_id ?? void 0;
  }
  async function guildRoles(gid) {
    const data = await get(`/guilds/${gid}/roles`);
    const roles = data?.roles ?? data ?? [];
    return Array.isArray(roles) ? roles.map((r) => ({ id: String(r.id), name: String(r.name ?? r.id), color: r.color })) : [];
  }
  async function memberIds(gid) {
    const data = await get(`/guilds/${gid}/members?limit=1000`);
    const list = Array.isArray(data) ? data : data?.members ?? [];
    return new Set(list.map((m) => m.user?.id).filter((id) => !!id));
  }
  async function relatedInGuild(gid, type) {
    const [rels, members] = await Promise.all([get("/users/@me/relationships"), memberIds(gid)]);
    const list = Array.isArray(rels) ? rels : rels?.relationships ?? [];
    return [...new Set(
      list.filter((r) => r.type === type).map((r) => r.id ?? r.user_id ?? r.user?.id).filter((id) => !!id && members.has(id))
    )];
  }
  async function guildFeatures(gid) {
    const data = await get(`/guilds/${gid}`);
    return Array.isArray(data?.features) ? data.features.map(String) : [];
  }
  function show(title, lines, monospace = false) {
    const text = lines.length ? lines.map((l) => `\u2022 ${l}`).join("\n") : "Yok";
    ui.showSheet({ title, text, monospace });
  }
  function openRoles(gid) {
    if (!settings.roles) return;
    void guildRoles(gid).then(
      (roles) => show("Roller", roles.map((r) => r.name + (r.color ? ` (#${(r.color & 16777215).toString(16).padStart(6, "0")})` : "")), true)
    );
  }
  function openFriends(gid) {
    if (!settings.friends) return;
    void relatedInGuild(gid, 1).then((ids) => show("Ortak arkada\u015Flar", ids));
  }
  function openBlocked(gid) {
    if (!settings.blocked) return;
    void relatedInGuild(gid, 2).then((ids) => show("Engelli kullan\u0131c\u0131lar", ids));
  }
  function openFeatures(gid) {
    if (!settings.features) return;
    void guildFeatures(gid).then((features) => show("Sunucu \xF6zellikleri", features, true));
  }
  function menuNode(gid) {
    const row = (label, action) => ({
      kind: "text",
      props: {
        text: label,
        color: 4283983346,
        fontSize: 16,
        padding: [10, 14, 10, 14]
      },
      onPress: action
    });
    const children = [
      { kind: "text", props: { text: "GuildProfiles", color: 4290362302, fontSize: 13, padding: [14, 14, 4, 14] } },
      row("Roller", () => openRoles(gid)),
      row("Ortak arkada\u015Flar", () => openFriends(gid)),
      row("Engelli kullan\u0131c\u0131lar", () => openBlocked(gid)),
      row("Sunucu \xF6zellikleri", () => openFeatures(gid))
    ];
    return { kind: "view", props: { padding: [4, 0, 8, 0] }, children };
  }
  var GUILD_HINT = /guild|server|sunucu/i;
  var sheetsDone = /* @__PURE__ */ new Set();
  var armedAt = 0;
  var armedChannel = null;
  function sheetIds() {
    const root = ui.root?.();
    if (root == null) return [];
    const found = /* @__PURE__ */ new Set();
    const stack = [root];
    const seen = /* @__PURE__ */ new Set();
    while (stack.length && seen.size < 400) {
      const id = stack.pop();
      if (seen.has(id)) continue;
      seen.add(id);
      const node = ui.node(id);
      if (!node) continue;
      if (node.sheet != null) found.add(node.sheet);
      for (const child of node.children ?? []) stack.push(child);
    }
    return [...found];
  }
  async function attachNewSheet() {
    const ids = sheetIds();
    const fresh = ids.filter((id) => id > 0 && !sheetsDone.has(id));
    if (!fresh.length) return;
    const gid = await guildId(armedChannel);
    if (!gid) {
      log.info("GuildProfiles: sheet open, but no guild id for the channel");
      return;
    }
    for (const sheet of fresh) {
      if (sheetsDone.has(sheet)) continue;
      sheetsDone.add(sheet);
      ui.mount(sheet, menuNode(gid), { before: "start" });
      log.info(`GuildProfiles: mounted in sheet ${sheet} (guild ${gid})`);
    }
  }
  ui.onEvent(
    "press",
    (ev) => {
      const aid = ev.accessibilityId ?? "";
      if (!GUILD_HINT.test(aid)) return;
      armedAt = Date.now();
      armedChannel = ev.channelId ?? null;
      void attachNewSheet();
    },
    { intercept: false }
  );
  ui.onNode({ prefix: "" }, (node) => {
    if (settings.probe) log.info(`node ${node.id} aid=${node.accessibilityId} sheet=${node.sheet} kind=${node.kind}`);
    if (node.sheet == null) return;
    const nodeAid = node.accessibilityId ?? "";
    if (!GUILD_HINT.test(nodeAid)) return;
    if (Date.now() - armedAt > 3e3 && !GUILD_HINT.test(nodeAid)) return;
    armedAt = Date.now();
    armedChannel = null;
    void attachNewSheet();
  });
  ui.addHeaderButton({
    label: "GuildProfiles",
    icon: "res://ic_mana_puzzle_piece_plus",
    onPress: async (ctx) => {
      const gid = await guildId(ctx.channelId);
      if (!gid) {
        ui.toast("GuildProfiles: bir sunucu kanal\u0131 a\xE7");
        return;
      }
      const choice = await ui.choose({
        title: "GuildProfiles",
        message: "Sunucu profili aksiyonlar\u0131",
        options: [
          { label: "Roller" },
          { label: "Ortak arkada\u015Flar" },
          { label: "Engelli kullan\u0131c\u0131lar" },
          { label: "Sunucu \xF6zellikleri" }
        ]
      });
      if (choice === 0) openRoles(gid);
      else if (choice === 1) openFriends(gid);
      else if (choice === 2) openBlocked(gid);
      else if (choice === 3) openFeatures(gid);
    }
  });
  phoenix.onUnload(() => {
    armedAt = 0;
    sheetsDone.clear();
  });
})();
