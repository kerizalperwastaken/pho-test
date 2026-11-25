// @description Shows server details in the guild menu: name, ID, owner, members, roles, channels, boosts, created, vanity
// @version 1.1.0
// @author kerizalperwastaken
// @enabled true
(() => {
  // server-info/src/index.ts
  var ui = phoenix.ui;
  var discord = phoenix.discord;
  var log = phoenix.log;
  var gateway = phoenix.gateway;
  var cfg = phoenix.settings.define({
    anchor: {
      type: "text",
      title: "Guild menu anchor",
      description: "Accessibility label of a row in the guild menu. The block is mounted above it. Change if nothing appears.",
      default: "Edit Per-server Profile"
    },
    headerFallback: {
      type: "switch",
      title: "Header fallback button",
      description: "Adds a 'Server Info' chat-header button that opens the same data in a page",
      default: true
    },
    server: { type: "switch", title: "Show server name", default: true },
    owner: { type: "switch", title: "Show owner", default: true },
    id: { type: "switch", title: "Show server ID", default: true },
    members: { type: "switch", title: "Show members / online", default: true },
    roles: { type: "switch", title: "Show role count", default: true },
    channels: { type: "switch", title: "Show channel count", default: true },
    boost: { type: "switch", title: "Show boost level", default: true },
    created: { type: "switch", title: "Show creation date", default: true },
    vanity: { type: "switch", title: "Show vanity URL", default: true }
  });
  var DISCORD_EPOCH = 14200704e5;
  var CHANNEL_PREFIX = "navigation.channel:";
  var SERVER_PREFIX = "navigation.server:";
  var OVERRIDE_MS = 15e3;
  var CACHE_MS = 10 * 60 * 1e3;
  var FALLBACK_ANCHORS = ["Copy Server ID", "Copy Server Banner Image Link"];
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
  var extrasCache = /* @__PURE__ */ new Map();
  async function fetchExtras(gid, ownerId) {
    const cached = extrasCache.get(gid);
    if (cached && Date.now() - cached.at < CACHE_MS) return cached.data;
    const [roles, channels, user] = await Promise.all([
      api(`/guilds/${gid}/roles`),
      api(`/guilds/${gid}/channels`),
      ownerId ? api(`/users/${ownerId}`) : Promise.resolve(null)
    ]);
    const data = {
      roles: Array.isArray(roles) ? roles.length : 0,
      channels: Array.isArray(channels) ? channels.length : 0,
      ownerName: typeof user?.username === "string" && user.username || typeof user?.global_name === "string" && user.global_name || ownerId || "\u2014"
    };
    extrasCache.set(gid, { at: Date.now(), data });
    return data;
  }
  async function infoColumns(gid) {
    const guild = await api(`/guilds/${gid}?with_counts=true`);
    if (!guild) return [[{ label: "Server", value: "info unavailable" }]];
    const ownerId = guild.owner_id != null ? String(guild.owner_id) : null;
    const needExtras = cfg.owner || cfg.roles || cfg.channels;
    const extras = needExtras ? await fetchExtras(gid, ownerId) : { roles: 0, channels: 0, ownerName: "\u2014" };
    const tier = guild.premium_tier;
    const boosts = guild.premium_subscription_count;
    const boost = typeof boosts === "number" && boosts > 0 ? `Lv ${tier ?? 0} (${fmt(boosts)})` : `Lv ${tier ?? 0}`;
    const cells = [];
    if (cfg.server) cells.push({ label: "Server", value: String(guild.name ?? "Server") });
    if (cfg.owner) cells.push({ label: "Owner", value: extras.ownerName });
    if (cfg.id) cells.push({ label: "ID", value: String(guild.id ?? gid) });
    if (cfg.members) {
      cells.push({ label: "Members", value: fmt(guild.approximate_member_count ?? guild.member_count) });
      cells.push({ label: "Online", value: fmt(guild.approximate_presence_count) });
    }
    if (cfg.roles) cells.push({ label: "Roles", value: fmt(extras.roles) });
    if (cfg.channels) cells.push({ label: "Channels", value: fmt(extras.channels) });
    if (cfg.boost) cells.push({ label: "Boost", value: boost });
    if (cfg.created) cells.push({ label: "Created", value: created(guild.id ?? gid) });
    if (cfg.vanity && typeof guild.vanity_url_code === "string" && guild.vanity_url_code.length > 0) {
      cells.push({ label: "Vanity", value: String(guild.vanity_url_code) });
    }
    if (cells.length === 0) cells.push({ label: "Server", value: "no fields enabled" });
    const grid2 = [];
    for (let i = 0; i < cells.length; i += 2) grid2.push(cells.slice(i, i + 2));
    return grid2;
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
  async function guildFromChannel(channelId) {
    if (!channelId) return null;
    const channel = await api(`/channels/${channelId}`);
    return channel?.guild_id != null ? String(channel.guild_id) : null;
  }
  function anchorRows() {
    const labels = [cfg.anchor, ...FALLBACK_ANCHORS].filter(
      (s) => typeof s === "string" && s.length > 0
    );
    const result = [];
    for (const aid of labels) {
      for (const row of ui.find({ exact: aid })) {
        const info = ui.node(row);
        if (!info || info.parent == null || result.some((r) => r.row === row)) continue;
        result.push({ row, parent: info.parent });
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
  var queued = null;
  var cleanups = [];
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
    try {
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
    } catch (e) {
      log.warn(`mount failed: ${String(e)}`);
      remover = null;
      return false;
    }
    mountedGid = columnsGid;
    needMount = false;
    return true;
  }
  async function refresh(gid, channelId) {
    if (busy) {
      queued = { gid, channelId };
      return;
    }
    busy = true;
    try {
      let target = gid ?? null;
      if (!target && overrideGid && Date.now() - overrideAt < OVERRIDE_MS) target = overrideGid;
      if (!target) target = currentGid;
      if (!target) target = await guildFromChannel(channelId ?? channelGid());
      if (!target) return;
      grid = await infoColumns(target);
      columnsGid = target;
      if (needMount || columnsGid !== mountedGid) mountInto();
    } finally {
      busy = false;
      const next = queued;
      queued = null;
      if (next) void refresh(next.gid, next.channelId);
    }
  }
  var channelInfo = gateway.channelInfo;
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
  cleanups.push(
    ui.onEvent("rowLongPress", (ev) => {
      const gid = pressedGid(ev);
      if (gid) {
        overrideGid = gid;
        overrideAt = Date.now();
        needMount = true;
      }
      void refresh(gid ?? void 0, ev.channelId);
    })
  );
  cleanups.push(
    ui.onEvent("press", (ev) => {
      if (ev.accessibilityId === "guild.menu") {
        overrideGid = null;
        needMount = true;
        void refresh(void 0, ev.channelId);
      }
    })
  );
  for (const label of [cfg.anchor, ...FALLBACK_ANCHORS].filter(
    (s) => typeof s === "string" && s.length > 0
  )) {
    cleanups.push(
      ui.onNode({ exact: label }, (node) => {
        const live = ui.node(node.id);
        if ((live?.sheet ?? node.sheet) == null) return;
        const gid = overrideGid;
        overrideGid = null;
        needMount = true;
        void refresh(gid ?? void 0);
      })
    );
  }
  if (cfg.headerFallback) {
    cleanups.push(
      ui.addHeaderButton({
        icon: "res://ic_mana_puzzle_piece_plus",
        label: "Server Info",
        onPress: (ctx) => {
          void (async () => {
            const gid = currentGid ?? await guildFromChannel(ctx.channelId) ?? (overrideGid && Date.now() - overrideAt < OVERRIDE_MS ? overrideGid : null);
            if (!gid) return ui.toast("Open a server channel first");
            const data = await infoColumns(gid);
            ui.openPage({
              title: "Server Info",
              sections: [{ type: "text", text: data.flat().map((c) => `${c.label}: ${c.value}`).join("\n") }]
            });
          })();
        }
      })
    );
  }
  void refresh();
  phoenix.onUnload(() => {
    removeMount();
    needMount = false;
    for (const off of cleanups) {
      try {
        off();
      } catch {
      }
    }
    cleanups.length = 0;
  });
})();
