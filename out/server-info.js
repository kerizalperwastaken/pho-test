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
  var SERVER_PREFIX = "navigation.server:";
  var OVERRIDE_MS = 15e3;
  var ANCHORS = ["Edit Per-server Profile", "Copy Server ID", "Copy Server Banner Image Link"];
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
  function pressedGid(ev) {
    const index = ev.payload?.index;
    const list = ui.node(ev.node);
    if (typeof index !== "number" || !list) return null;
    const start = list.children[index];
    if (start == null) return null;
    const stack = [start];
    const seen = /* @__PURE__ */ new Set();
    while (stack.length && seen.size < 40) {
      const id = stack.pop();
      if (seen.has(id)) continue;
      seen.add(id);
      const node = ui.node(id);
      if (!node) continue;
      if (node.accessibilityId?.startsWith(SERVER_PREFIX)) {
        return node.accessibilityId.slice(SERVER_PREFIX.length);
      }
      for (const child of node.children ?? []) stack.push(child);
    }
    return null;
  }
  var columns = { left: "Server", right: "info unavailable" };
  var columnsGid = null;
  var overrideGid = null;
  var overrideAt = 0;
  var pending = false;
  var busy = false;
  var done = /* @__PURE__ */ new Set();
  var remover = null;
  function removeMount() {
    if (!remover) return;
    try {
      remover();
    } catch {
    }
    remover = null;
  }
  function mountInto() {
    for (const aid of ANCHORS) {
      const row = ui.find({ exact: aid })[0];
      if (row == null) continue;
      const info = ui.node(row);
      if (!info || info.parent == null) continue;
      removeMount();
      remover = ui.mount(
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
      return true;
    }
    return false;
  }
  async function refresh(gid) {
    if (busy) return;
    busy = true;
    try {
      let target = gid ?? null;
      if (!target && overrideGid && Date.now() - overrideAt < OVERRIDE_MS) target = overrideGid;
      if (!target) {
        const channelId = currentChannelId();
        if (channelId) {
          const channel = await api(`/channels/${channelId}`);
          target = channel?.guild_id != null ? String(channel.guild_id) : null;
        }
      }
      if (!target) return;
      columns = await infoColumns(target);
      columnsGid = target;
      if (target === overrideGid) overrideGid = null;
      if (pending && mountInto()) pending = false;
    } finally {
      busy = false;
    }
  }
  ui.onEvent("rowLongPress", (ev) => {
    const gid = pressedGid(ev);
    if (!gid) return;
    overrideGid = gid;
    overrideAt = Date.now();
    void refresh(gid);
  });
  ui.onEvent("press", (ev) => {
    if (ev.accessibilityId === "guild.menu") void refresh();
  });
  ui.onNode({ exact: "Edit Per-server Profile" }, (node) => {
    if (node.sheet == null || done.has(node.sheet)) return;
    done.add(node.sheet);
    const target = overrideGid ?? columnsGid;
    if (target && columnsGid === target && mountInto()) return;
    pending = true;
    void refresh(target ?? void 0);
  });
  void refresh();
  phoenix.onUnload(() => {
    removeMount();
    done.clear();
    pending = false;
  });
})();
