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
  var ANCHOR = "Edit Per-server Profile";
  var FALLBACK_ANCHORS = ["Copy Server ID", "Copy Server Banner Image Link"];
  var CARD_BG = 4280164130;
  var CARD_BORDER = 4282335559;
  var CARD_RADIUS = 8;
  var ICON = {
    server: "res://ic_mana_experimental_pineapple_house",
    owner: "res://ic_mana_user_status",
    id: "res://ic_mana_angle_brackets",
    members: "res://ic_mana_emoji_people",
    online: "res://ic_mana_user_circle_status",
    roles: "res://ic_mana_shield_at",
    channels: "res://ic_mana_grid_horizontal",
    boost: [
      "res://ic_mana_boost_tier1_simple",
      "res://ic_mana_boost_tier2_simple",
      "res://ic_mana_boost_tier3_simple"
    ],
    created: "res://ic_mana_paper_clock",
    vanity: "res://ic_mana_browser_link"
  };
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
    if (!guild) return [[{ label: "Server", value: "info unavailable", icon: ICON.server }]];
    const ownerId = guild.owner_id != null ? String(guild.owner_id) : null;
    const needExtras = cfg.owner || cfg.roles || cfg.channels;
    const extras = needExtras ? await fetchExtras(gid, ownerId) : { roles: 0, channels: 0, ownerName: "\u2014" };
    const tier = guild.premium_tier;
    const boosts = guild.premium_subscription_count;
    const boost = typeof boosts === "number" && boosts > 0 ? `${fmt(boosts)} boosts \xB7 Lv ${tier ?? 0}` : `Lv ${tier ?? 0}`;
    const boostLevel = Math.min(2, Math.max(0, Number(tier ?? 0) - 1));
    const vanity = cfg.vanity && typeof guild.vanity_url_code === "string" && guild.vanity_url_code.length > 0 ? String(guild.vanity_url_code) : null;
    const cell = (label, value, icon) => ({ label, value, icon });
    const grid2 = [];
    const row = (...parts) => {
      const present = parts.filter((c) => c != null);
      if (present.length) grid2.push(present);
    };
    row(
      cfg.server ? cell("Server", String(guild.name ?? "Server"), ICON.server) : null,
      cfg.owner ? cell("Owner", extras.ownerName, ICON.owner) : null
    );
    row(cfg.id ? cell("ID", String(guild.id ?? gid), ICON.id) : null);
    row(cfg.created ? cell("Created", created(guild.id ?? gid), ICON.created) : null);
    row(
      cfg.members ? cell("Members", fmt(guild.approximate_member_count ?? guild.member_count), ICON.members) : null,
      cfg.members ? cell("Online", fmt(guild.approximate_presence_count), ICON.online) : null
    );
    row(
      cfg.channels ? cell("Channels", fmt(extras.channels), ICON.channels) : null,
      cfg.roles ? cell("Roles", fmt(extras.roles), ICON.roles) : null
    );
    row(
      cfg.boost ? cell("Boost", boost, ICON.boost[boostLevel]) : null,
      vanity ? cell("Vanity", vanity, ICON.vanity) : null
    );
    if (grid2.length === 0) grid2.push([cell("Server", "no fields enabled", ICON.server)]);
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
    const labels = [ANCHOR, ...FALLBACK_ANCHORS];
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
  var grid = [[{ label: "Server", value: "info unavailable", icon: ICON.server }]];
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
          props: {
            direction: "column",
            gap: 4,
            padding: [8, 12, 8, 12],
            align: "stretch",
            width: "fill",
            background: CARD_BG,
            radius: CARD_RADIUS,
            clip: true,
            borderColor: CARD_BORDER,
            borderWidth: 1,
            margin: [6, 2, 6, 2]
          },
          children: grid.map((row) => ({
            kind: "view",
            props: { direction: "row", gap: 10, align: "start", width: "fill" },
            children: row.map((cell) => ({
              kind: "view",
              props: { direction: "row", gap: 4, flex: 1, align: "start", clip: true },
              children: [
                ...cell.icon ? [
                  {
                    kind: "image",
                    props: {
                      uri: cell.icon,
                      width: 12,
                      height: 12,
                      tint: 4287533719,
                      margin: [0, 1, 3, 0]
                    }
                  }
                ] : [],
                {
                  kind: "text",
                  props: {
                    text: cell.label,
                    color: 4287533719,
                    fontSize: 11,
                    fontWeight: 500,
                    width: 50,
                    maxLines: 1,
                    lineHeight: 14,
                    lineHeightExact: true
                  }
                },
                {
                  kind: "text",
                  props: {
                    text: cell.value,
                    color: 4292007128,
                    fontSize: 11,
                    flex: 1,
                    width: "fill",
                    maxLines: 1,
                    lineHeight: 14,
                    lineHeightExact: true
                  }
                }
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
  for (const label of [ANCHOR, ...FALLBACK_ANCHORS]) {
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
