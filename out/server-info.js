// @description Shows server details in the guild menu in two columns: name, ID, owner, members, roles, channels, boosts, vanity URL
// @version 1.0.0
// @author kerizalperwastaken
// @enabled true
(() => {
  // server-info/src/index.ts
  var ui = phoenix.ui;
  var discord = phoenix.discord;
  var log = phoenix.log;
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
  async function infoColumns(gid) {
    const guild = await api(`/guilds/${gid}?with_counts=true`);
    if (!guild) return [[{ label: "Server", value: "info unavailable" }]];
    const ownerId = guild.owner_id != null ? String(guild.owner_id) : null;
    const extras = await fetchExtras(gid, ownerId);
    const tier = guild.premium_tier;
    const boosts = guild.premium_subscription_count;
    const boost = typeof boosts === "number" && boosts > 0 ? `Lv ${tier ?? 0} (${fmt(boosts)})` : `Lv ${tier ?? 0}`;
    const cells = [
      { label: "Server", value: String(guild.name ?? "Server") },
      { label: "Owner", value: extras.ownerName },
      { label: "ID", value: String(guild.id ?? gid) },
      { label: "Members", value: fmt(guild.approximate_member_count ?? guild.member_count) },
      { label: "Online", value: fmt(guild.approximate_presence_count) },
      { label: "Roles", value: fmt(extras.roles) },
      { label: "Channels", value: fmt(extras.channels) },
      { label: "Boost", value: boost },
      { label: "Created", value: created(guild.id ?? gid) }
    ];
    if (typeof guild.vanity_url_code === "string" && guild.vanity_url_code.length > 0) {
      cells.push({ label: "Vanity", value: String(guild.vanity_url_code) });
    }
    const grid2 = [];
    for (let i = 0; i < cells.length; i += 2) grid2.push(cells.slice(i, i + 2));
    return grid2;
  }
  var extrasCache = /* @__PURE__ */ new Map();
  async function fetchExtras(gid, ownerId) {
    const cached = extrasCache.get(gid);
    if (cached) return cached;
    const [roles, channels, user] = await Promise.all([
      api(`/guilds/${gid}/roles`),
      api(`/guilds/${gid}/channels`),
      ownerId ? api(`/users/${ownerId}`) : Promise.resolve(null)
    ]);
    const extras = {
      roles: Array.isArray(roles) ? roles.length : 0,
      channels: Array.isArray(channels) ? channels.length : 0,
      ownerName: typeof user?.username === "string" && user.username || typeof user?.global_name === "string" && user.global_name || ownerId || "\u2014"
    };
    extrasCache.set(gid, extras);
    return extras;
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
  var grid = [[{ label: "Server", value: "info unavailable" }]];
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
        props: { direction: "column", gap: 6, padding: [12, 16, 12, 16], align: "stretch", width: "fill" },
        children: grid.map((row) => ({
          kind: "view",
          props: { direction: "row", gap: 16, align: "start", width: "fill" },
          children: row.map((cell) => ({
            kind: "view",
            props: { direction: "row", gap: 8, flex: 1, align: "start" },
            children: [
              { kind: "text", props: { text: cell.label, color: 4287533719, fontSize: 13, fontWeight: 500, width: 64 } },
              { kind: "text", props: { text: cell.value, color: 4292007128, fontSize: 13, flex: 1, width: "fill" } }
            ]
          }))
        }))
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
      grid = await infoColumns(target);
      columnsGid = target;
      if (needMount || columnsGid !== mountedGid) mountInto();
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
        needMount = false;
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
