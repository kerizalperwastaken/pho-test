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
    theme: {
      type: "select",
      title: "Card theme",
      description: "Auto reads the client's appearance; pick one if the colors look wrong",
      options: [
        { value: "auto", label: "Auto" },
        { value: "dark", label: "Dark" },
        { value: "light", label: "Light" }
      ],
      default: "auto"
    },
    server: { type: "switch", title: "Show server name", default: true },
    owner: { type: "switch", title: "Show owner", default: true },
    id: { type: "switch", title: "Show server ID", default: true },
    members: { type: "switch", title: "Show members / online", default: true },
    roles: { type: "switch", title: "Show role count", default: true },
    channels: { type: "switch", title: "Show channel count", default: true },
    boost: { type: "switch", title: "Show boost level", default: true },
    created: { type: "switch", title: "Show creation date", default: true },
    joined: { type: "switch", title: "Show join date", default: true },
    vanity: { type: "switch", title: "Show vanity URL", default: true }
  });
  var DISCORD_EPOCH = 14200704e5;
  var CHANNEL_PREFIX = "navigation.channel:";
  var SERVER_PREFIX = "navigation.server:";
  var OVERRIDE_MS = 15e3;
  var CACHE_MS = 10 * 60 * 1e3;
  var ANCHOR = "Edit Per-server Profile";
  var FALLBACK_ANCHORS = ["Copy Server ID", "Copy Server Banner Image Link"];
  var DARK_PALETTE = {
    bg: 4282466632,
    border: 4282466632,
    // native cards are borderless
    label: 4289440946,
    // muted text
    value: 4294967295
    // primary text
  };
  var LIGHT_PALETTE = {
    bg: 4294967295,
    border: 4294967295,
    label: 4283322456,
    value: 4281414456
  };
  var CARD_RADIUS = 12;
  var palette = DARK_PALETTE;
  var themeReady = false;
  async function detectLightTheme() {
    try {
      const rows = await phoenix.stores.sql(
        "SELECT k AS k, CAST(v AS TEXT) AS v FROM meta"
      );
      for (const row of rows) {
        const key = String(row.k ?? "").toLowerCase();
        const value = String(row.v ?? "");
        if (/theme|appearance/.test(key) && /light/i.test(value)) return true;
        const explicit = value.match(/"theme"\s*:\s*"?(dark|light)"?/i);
        if (explicit) return explicit[1].toLowerCase() === "light";
      }
    } catch {
    }
    return false;
  }
  async function ensureTheme() {
    if (themeReady) return;
    themeReady = true;
    if (cfg.theme === "dark") palette = DARK_PALETTE;
    else if (cfg.theme === "light") palette = LIGHT_PALETTE;
    else palette = await detectLightTheme() ? LIGHT_PALETTE : DARK_PALETTE;
  }
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
    joined: "res://ic_mana_door_enter",
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
  var joinedFromGateway = /* @__PURE__ */ new Map();
  var joinedCache = null;
  function dateValue(raw) {
    if (typeof raw === "string" && raw.length >= 10) {
      const s = raw.slice(0, 10);
      return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
    }
    if (typeof raw === "number" && Number.isFinite(raw)) {
      const date = new Date(raw > 1e12 ? raw : raw * 1e3);
      return Number.isNaN(date.getTime()) ? null : date.toISOString().slice(0, 10);
    }
    return null;
  }
  function extractJoined(obj) {
    for (const key of Object.keys(obj)) {
      if (!/join/i.test(key)) continue;
      const value = obj[key];
      const direct = dateValue(value);
      if (direct) return direct;
      const found = JSON.stringify(value ?? null).match(/\d{4}-\d{2}-\d{2}/);
      if (found) return found[0];
    }
    return null;
  }
  async function loadJoinedFromCache() {
    const result = /* @__PURE__ */ new Map();
    try {
      const rows = await phoenix.stores.sql(
        "SELECT k AS g, CAST(v AS TEXT) AS v FROM guilds"
      );
      for (const row of rows) {
        if (!row?.v) continue;
        try {
          const date = extractJoined(JSON.parse(row.v));
          if (date) result.set(row.g.replace(/^0+/, ""), date);
        } catch {
        }
      }
    } catch (e) {
      log.warn(`reading guild cache: ${String(e)}`);
    }
    return result;
  }
  async function joinedAt(gid, guild) {
    const direct = dateValue(guild.joined_at ?? guild.joinedAt);
    if (direct) return direct;
    const seen = joinedFromGateway.get(gid);
    if (seen) return seen;
    if (!joinedCache) joinedCache = await loadJoinedFromCache();
    return joinedCache.get(gid) ?? "\u2014";
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
    const joined = cfg.joined ? await joinedAt(String(guild.id ?? gid), guild) : null;
    const vanity = cfg.vanity ? typeof guild.vanity_url_code === "string" && guild.vanity_url_code.length > 0 ? String(guild.vanity_url_code) : "Not Found" : null;
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
    row(
      cfg.created ? cell("Created", created(guild.id ?? gid), ICON.created) : null,
      joined ? cell("Joined", joined, ICON.joined) : null
    );
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
    row(cfg.id ? cell("ID", String(guild.id ?? gid), ICON.id) : null);
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
  var requestSeq = 0;
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
  function invalidateForNewMenu() {
    removeMount();
    grid = [[{ label: "Server", value: "Loading\u2026", icon: ICON.server }]];
    columnsGid = null;
    needMount = true;
  }
  function mountInto() {
    const rows = anchorRows();
    if (rows.length === 0) return false;
    const target = rows[0];
    const anchor = ui.node(target.row);
    const nested = (anchor?.children.length ?? 0) >= 3;
    const parent = nested ? target.row : target.parent;
    const before = nested ? "start" : target.row;
    const block = {
      kind: "view",
      props: nested ? {
        direction: "column",
        gap: 4,
        padding: [0, 8, 0, 8],
        align: "stretch",
        width: "fill",
        background: 234881023,
        radius: 10,
        clip: true,
        // Pull into the card's own top padding.
        margin: [0, -20, 0, 10]
      } : {
        direction: "column",
        gap: 4,
        padding: [12, 10, 12, 10],
        align: "stretch",
        width: "fill",
        background: palette.bg,
        radius: CARD_RADIUS,
        clip: true,
        borderColor: palette.border,
        borderWidth: 1,
        margin: [0, 0, 0, 0]
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
                  tint: palette.label,
                  margin: [0, 1, 3, 0]
                }
              }
            ] : [],
            {
              kind: "text",
              props: {
                text: cell.label,
                color: palette.label,
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
                color: palette.value,
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
    };
    try {
      removeMount();
      remover = ui.mount(parent, block, { before });
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
    const seq = ++requestSeq;
    if (busy) {
      queued = { gid, channelId };
      return;
    }
    busy = true;
    try {
      await ensureTheme();
      let target = gid ?? null;
      if (!target && overrideGid && Date.now() - overrideAt < OVERRIDE_MS) target = overrideGid;
      if (!target) target = currentGid;
      if (!target) target = await guildFromChannel(channelId ?? channelGid());
      if (!target) return;
      const fresh = await infoColumns(target);
      if (seq !== requestSeq) return;
      grid = fresh;
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
        needMount = true;
        void refresh();
      }
    });
  }
  if (gateway.guildCreate) {
    phoenix.on(gateway.guildCreate, (guild) => {
      const raw = guild.joined_at ?? guild.joinedAt;
      const date = dateValue(raw);
      if (date && typeof guild.id === "string") joinedFromGateway.set(guild.id, date);
    });
  }
  cleanups.push(
    ui.onEvent("rowLongPress", (ev) => {
      const gid = pressedGid(ev);
      if (gid) {
        invalidateForNewMenu();
        overrideGid = gid;
        overrideAt = Date.now();
      }
      void refresh(gid ?? void 0, ev.channelId);
    })
  );
  cleanups.push(
    ui.onEvent("press", (ev) => {
      if (ev.accessibilityId === "guild.menu") {
        invalidateForNewMenu();
        overrideGid = null;
        currentGid = null;
        void refresh(void 0, ev.channelId);
      }
    })
  );
  for (const label of [ANCHOR, ...FALLBACK_ANCHORS]) {
    cleanups.push(
      ui.onNode({ exact: label }, (node) => {
        const live = ui.node(node.id);
        if ((live?.sheet ?? node.sheet) == null) return;
        invalidateForNewMenu();
        const gid = overrideGid;
        overrideGid = null;
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
