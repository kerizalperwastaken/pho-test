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
  function channelGid() {
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
  function anchorRows() {
    const result = [];
    for (const aid of ANCHORS) {
      for (const row of ui.find({ exact: aid })) {
        const info = ui.node(row);
        if (!info || info.parent == null || result.some((r) => r.row === row)) continue;
        result.push({ row, parent: info.parent, sheet: info.sheet });
      }
    }
    return result;
  }
  var columns = { left: "Server", right: "info unavailable" };
  var columnsGid = null;
  var currentGid = null;
  var overrideGid = null;
  var overrideAt = 0;
  var mountedGid = null;
  var remover = null;
  var needMount = false;
  var busy = false;
  var queued = false;
  var queuedGid;
  function removeMount() {
    if (!remover) return;
    try {
      remover();
    } catch {
    }
    remover = null;
    mountedGid = null;
  }
  function mountInto() {
    const rows = anchorRows();
    if (rows.length === 0) return false;
    const target = rows[0];
    removeMount();
    remover = ui.mount(
      target.parent,
      {
        kind: "view",
        props: { direction: "row", gap: 16, padding: [12, 16, 12, 16], align: "start" },
        children: [
          { kind: "text", props: { text: columns.left, color: 4287533719, fontSize: 13 } },
          { kind: "text", props: { text: columns.right, color: 4290362302, fontSize: 13 } }
        ]
      },
      { before: target.row }
    );
    mountedGid = columnsGid;
    needMount = false;
    return true;
  }
  async function refresh(gid) {
    if (busy) {
      queued = true;
      if (gid) queuedGid = gid;
      return;
    }
    busy = true;
    try {
      let target = gid ?? null;
      if (!target && overrideGid && Date.now() - overrideAt < OVERRIDE_MS) target = overrideGid;
      if (!target) target = currentGid;
      if (!target) {
        const channelId = channelGid();
        if (channelId) {
          const channel = await api(`/channels/${channelId}`);
          target = channel?.guild_id != null ? String(channel.guild_id) : null;
          if (target) currentGid = target;
        }
      }
      if (!target) return;
      columns = await infoColumns(target);
      columnsGid = target;
      if (anchorRows().length && (needMount || columnsGid !== mountedGid)) mountInto();
    } finally {
      busy = false;
      if (queued) {
        queued = false;
        const next = queuedGid;
        queuedGid = void 0;
        void refresh(next);
      }
    }
  }
  var channelInfo = phoenix.gateway.channelInfo;
  if (channelInfo) {
    phoenix.on(channelInfo, (payload) => {
      const body = payload;
      const gid = body?.guild_id;
      if (typeof gid === "string" && /^\d{17,19}$/.test(gid)) {
        currentGid = gid;
        overrideGid = null;
        if (anchorRows().length === 0) needMount = false;
      }
    });
  }
  ui.onEvent("rowLongPress", (ev) => {
    const gid = pressedGid(ev);
    if (!gid) return;
    overrideGid = gid;
    overrideAt = Date.now();
    needMount = true;
    void refresh(gid);
  });
  ui.onEvent("press", (ev) => {
    if (ev.accessibilityId === "guild.menu") {
      overrideGid = null;
      needMount = true;
      void refresh();
    }
  });
  ui.onNode({ exact: "Edit Per-server Profile" }, (node) => {
    const live = ui.node(node.id);
    if ((live?.sheet ?? node.sheet) == null) return;
    const gid = overrideGid;
    overrideGid = null;
    needMount = true;
    void refresh(gid ?? void 0);
  });
  void refresh();
  phoenix.onUnload(() => {
    removeMount();
    needMount = false;
  });
})();
