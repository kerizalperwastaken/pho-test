// @description Shows server details in the guild menu in two columns: name, ID, members, roles, channels, boosts, vanity URL and description
// @version 1.0.0
// @author kerizalperwastaken
// @enabled true
(() => {
  // server-info/src/index.ts
  var ui = phoenix.ui;
  var discord = phoenix.discord;
  var log = phoenix.log;
  var MAX_DESCRIPTION = 90;
  var DISCORD_EPOCH = 14200704e5;
  var CHANNEL_PREFIX = "navigation.channel:";
  async function api(path) {
    try {
      const res = await discord.get(path);
      return res && typeof res.json === "function" ? res.json() ?? null : null;
    } catch (e) {
      log.warn(`GET ${path}: ${String(e)}`);
      return null;
    }
  }
  function fmt(n) {
    return typeof n === "number" ? n.toLocaleString() : "\u2014";
  }
  function created(id) {
    if (typeof id !== "string" || !/^\d{17,19}$/.test(id)) return "\u2014";
    try {
      const ms = Number((BigInt(id) >> 22n).toString()) + DISCORD_EPOCH;
      const date = new Date(ms);
      return Number.isNaN(date.getTime()) ? "\u2014" : date.toISOString().slice(0, 10);
    } catch {
      return "\u2014";
    }
  }
  function description(text) {
    if (typeof text !== "string" || text.length === 0) return "";
    const single = text.replace(/\s+/g, " ").trim();
    return single.length > MAX_DESCRIPTION ? `${single.slice(0, MAX_DESCRIPTION - 1)}\u2026` : single;
  }
  async function infoColumns(gid) {
    const guild = await api(`/guilds/${gid}?with_counts=true`);
    if (!guild) return { left: "Server", right: "info unavailable" };
    const [roles, channels] = await Promise.all([
      api(`/guilds/${gid}/roles`),
      api(`/guilds/${gid}/channels`)
    ]);
    const tier = guild.premium_tier;
    const boosts = guild.premium_subscription_count;
    const boost = typeof boosts === "number" && boosts > 0 ? `Lv ${tier ?? 0} (${fmt(boosts)})` : `Lv ${tier ?? 0}`;
    const rows = [
      ["Server", String(guild.name ?? "Server")],
      ["ID", String(guild.id ?? gid)],
      ["Members", fmt(guild.approximate_member_count ?? guild.member_count)],
      ["Online", fmt(guild.approximate_presence_count)],
      ["Roles", fmt(Array.isArray(roles) ? roles.length : void 0)],
      ["Channels", fmt(Array.isArray(channels) ? channels.length : void 0)],
      ["Boost", boost],
      ["Created", created(guild.id ?? gid)]
    ];
    if (typeof guild.vanity_url_code === "string" && guild.vanity_url_code.length > 0) {
      rows.push(["Vanity", `discord.gg/${guild.vanity_url_code}`]);
    }
    const desc = description(guild.description);
    if (desc) rows.push(["About", desc]);
    return {
      left: rows.map(([label]) => label).join("\n"),
      right: rows.map(([, value]) => value).join("\n")
    };
  }
  function currentChannelId() {
    for (const id of ui.find({ prefix: CHANNEL_PREFIX })) {
      const aid = ui.node(id)?.accessibilityId;
      if (aid) return aid.slice(CHANNEL_PREFIX.length);
    }
    return null;
  }
  var columns = { left: "Server", right: "info unavailable" };
  var busy = false;
  async function refresh() {
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
  var done = /* @__PURE__ */ new Set();
  var removers = [];
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
          { kind: "text", props: { text: columns.left, color: 4287533719, fontSize: 13 } },
          { kind: "text", props: { text: columns.right, color: 4290362302, fontSize: 13 } }
        ]
      },
      { before: row }
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
      }
    }
    removers.length = 0;
    done.clear();
  });
})();
