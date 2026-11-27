// @description ServerInfo — server details in the guild menu: name, ID, owner, members, roles, channels, boosts, created, vanity
// @version 1.1.0
// @author kerizalperwastaken
// @enabled true
(() => {
  // ServerInfo/src/index.ts
  (() => {
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
          { value: "auto", label: "Auto (Adaptive / 3rd-Party Compatible)" },
          { value: "dark", label: "Classic Dark" },
          { value: "midnight", label: "AMOLED / Midnight" },
          { value: "light", label: "Classic Light" }
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
    var OVERRIDE_MS = 6e4;
    var CACHE_MS = 10 * 60 * 1e3;
    var ANCHOR = "Edit Per-server Profile";
    var FALLBACK_ANCHORS = ["Copy Server ID", "Copy Server Banner Image Link"];
    var ADAPTIVE_DARK = { bg: 352321535, border: 452984831, label: 4289440946, value: 4294967295 };
    var ADAPTIVE_LIGHT = { bg: 167772160, border: 335544320, label: 4283322456, value: 4281414456 };
    var MIDNIGHT_PALETTE = { bg: 4279374354, border: 4280427042, label: 4288059030, value: 4294967295 };
    var CLASSIC_DARK = { bg: 4282466632, border: 4282466632, label: 4289440946, value: 4294967295 };
    var CLASSIC_LIGHT = { bg: 4294967295, border: 4294967295, label: 4283322456, value: 4281414456 };
    var CARD_RADIUS = 12;
    var palette = ADAPTIVE_DARK;
    async function detectLightTheme() {
      try {
        var rows = await phoenix.stores.sql("SELECT k AS k, CAST(v AS TEXT) AS v FROM meta");
        for (var row of rows) {
          var key = String(row.k ?? "").toLowerCase();
          var value = String(row.v ?? "");
          if (/theme|appearance/.test(key) && /light/i.test(value)) return true;
          var explicit = value.match(/"theme"\s*:\s*"?(dark|light)"?/i);
          if (explicit) return explicit[1].toLowerCase() === "light";
        }
      } catch {
      }
      return false;
    }
    async function ensureTheme() {
      var isLight = await detectLightTheme();
      if (cfg.theme === "midnight") palette = MIDNIGHT_PALETTE;
      else if (cfg.theme === "light") palette = CLASSIC_LIGHT;
      else if (cfg.theme === "dark") palette = CLASSIC_DARK;
      else palette = isLight ? ADAPTIVE_LIGHT : ADAPTIVE_DARK;
    }
    var ICON = {
      server: "res://ic_mana_experimental_pineapple_house",
      owner: "res://ic_mana_user_status",
      id: "res://ic_mana_angle_brackets",
      members: "res://ic_mana_emoji_people",
      online: "res://ic_mana_user_circle_status",
      roles: "res://ic_mana_shield_at",
      channels: "res://ic_mana_grid_horizontal",
      boost: ["res://ic_mana_boost_tier1_simple", "res://ic_mana_boost_tier2_simple", "res://ic_mana_boost_tier3_simple"],
      created: "res://ic_mana_paper_clock",
      joined: "res://ic_mana_door_enter",
      vanity: "res://ic_mana_browser_link"
    };
    async function api(path) {
      try {
        var res = await discord.get(path);
        return res && typeof res.json === "function" ? res.json() ?? null : null;
      } catch (e) {
        log.warn("GET " + path + ": " + String(e));
        return null;
      }
    }
    function fmt(n) {
      return typeof n === "number" ? n.toLocaleString() : "\u2014";
    }
    function created(id) {
      if (typeof id !== "string" || !/^\d{17,19}$/.test(id)) return "\u2014";
      try {
        var ms = Number((BigInt(id) >> 22n).toString()) + DISCORD_EPOCH;
        var date = new Date(ms);
        return Number.isNaN(date.getTime()) ? "\u2014" : date.toISOString().slice(0, 10);
      } catch {
        return "\u2014";
      }
    }
    var joinedFromGateway = /* @__PURE__ */ new Map();
    var joinedCache = null;
    var selfId = null;
    function dateValue(raw) {
      if (typeof raw === "string" && raw.length >= 10) {
        var s = raw.slice(0, 10);
        return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
      }
      if (typeof raw === "number" && Number.isFinite(raw)) {
        var date = new Date(raw > 1e12 ? raw : raw * 1e3);
        return Number.isNaN(date.getTime()) ? null : date.toISOString().slice(0, 10);
      }
      return null;
    }
    function extractJoined(obj) {
      var ms = dateValue(obj.joined_at_ms ?? obj.joinedAtMs);
      if (ms) return ms;
      var direct = dateValue(obj.joined_at ?? obj.joinedAt);
      if (direct) return direct;
      for (var key of Object.keys(obj)) {
        if (!/join/i.test(key)) continue;
        var value = obj[key];
        var found = dateValue(value);
        if (found) return found;
        var hit = JSON.stringify(value ?? null).match(/\d{4}-\d{2}-\d{2}/);
        if (hit) return hit[0];
      }
      return null;
    }
    async function loadJoinedFromCache() {
      var result = /* @__PURE__ */ new Map();
      try {
        var rows = await phoenix.stores.sql("SELECT k AS g, CAST(v AS TEXT) AS v FROM guilds");
        for (var row of rows) {
          if (!row?.v) continue;
          try {
            var date = extractJoined(JSON.parse(row.v));
            if (date) result.set(row.g.replace(/^0+/, ""), date);
          } catch {
          }
        }
      } catch (e) {
        log.warn("reading guild cache: " + String(e));
      }
      return result;
    }
    async function joinedAt(gid, guild) {
      var direct = dateValue(guild.joined_at ?? guild.joinedAt);
      if (direct) return direct;
      var seen = joinedFromGateway.get(gid);
      if (seen) return seen;
      if (!joinedCache) joinedCache = await loadJoinedFromCache();
      var cached = joinedCache.get(gid);
      if (cached) return cached;
      if (!selfId) {
        var me = await api("/users/@me");
        if (typeof me?.id === "string") selfId = me.id;
      }
      if (selfId) {
        var member = await api(`/guilds/${gid}/members/${selfId}`);
        var fresh = dateValue(member?.joined_at ?? member?.joinedAt);
        if (fresh) {
          joinedFromGateway.set(gid, fresh);
          return fresh;
        }
      }
      return "\u2014";
    }
    var extrasCache = /* @__PURE__ */ new Map();
    async function fetchExtras(gid, ownerId) {
      var cached = extrasCache.get(gid);
      if (cached && Date.now() - cached.at < CACHE_MS) return cached.data;
      var [roles, channels, user] = await Promise.all([
        api(`/guilds/${gid}/roles`),
        api(`/guilds/${gid}/channels`),
        ownerId ? api(`/users/${ownerId}`) : Promise.resolve(null)
      ]);
      var data = {
        roles: Array.isArray(roles) ? roles.length : 0,
        channels: Array.isArray(channels) ? channels.length : 0,
        ownerName: typeof user?.username === "string" && user.username || typeof user?.global_name === "string" && user.global_name || ownerId || "\u2014"
      };
      extrasCache.set(gid, { at: Date.now(), data });
      return data;
    }
    async function infoColumns(gid) {
      var guild = await api(`/guilds/${gid}?with_counts=true`);
      if (!guild) return [[{ label: "Server", value: "info unavailable", icon: ICON.server }]];
      var ownerId = guild.owner_id != null ? String(guild.owner_id) : null;
      var needExtras = cfg.owner || cfg.roles || cfg.channels;
      var extras = needExtras ? await fetchExtras(gid, ownerId) : { roles: 0, channels: 0, ownerName: "\u2014" };
      var tier = guild.premium_tier;
      var boosts = guild.premium_subscription_count;
      var boost = tier === 3 ? "Level 3" : tier === 2 ? "Level 2" : tier === 1 ? "Level 1" : "Level 0";
      var joined = cfg.joined ? await joinedAt(String(guild.id ?? gid), guild) : null;
      var vanity = cfg.vanity ? typeof guild.vanity_url_code === "string" && guild.vanity_url_code.length > 0 ? guild.vanity_url_code : null : null;
      var grid2 = [];
      function row(a, b) {
        if (a || b) grid2.push([a, b]);
      }
      function cell(label2, value, icon) {
        return { label: label2, value: String(value ?? "\u2014"), icon };
      }
      row(
        cfg.server ? cell("Server", guild.name ?? "Server", ICON.server) : null,
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
        cfg.boost ? cell("Boost", boost, ICON.boost[Math.min(Math.max(Number(tier) || 0, 0), 2)]) : null,
        vanity ? cell("Vanity", vanity, ICON.vanity) : null
      );
      row(cfg.id ? cell("ID", String(guild.id ?? gid), ICON.id) : null);
      if (grid2.length === 0) grid2.push([cell("Server", "no fields enabled", ICON.server)]);
      return grid2;
    }
    function channelGid() {
      for (var id of ui.find({ prefix: CHANNEL_PREFIX })) {
        var aid = ui.node(id)?.accessibilityId;
        if (aid) return aid.slice(CHANNEL_PREFIX.length);
      }
      return null;
    }
    function findGidInTree(startId) {
      var stack = [startId];
      var seen = /* @__PURE__ */ new Set();
      while (stack.length && seen.size < 80) {
        var id = stack.pop();
        if (seen.has(id)) continue;
        seen.add(id);
        var node = ui.node(id);
        if (!node) continue;
        if (node.accessibilityId?.startsWith(SERVER_PREFIX)) {
          return node.accessibilityId.slice(SERVER_PREFIX.length);
        }
        for (var child of node.children ?? []) stack.push(child);
      }
      return null;
    }
    function pressedGid(ev) {
      var index = ev.payload?.index;
      var list = ui.node(ev.node);
      if (typeof index !== "number" || !list) return null;
      var start = list.children[index];
      return start == null ? null : findGidInTree(start);
    }
    function pressedGidFromPayload(ev) {
      var index = ev.payload?.index;
      if (typeof index !== "number") return null;
      var roots = [];
      for (var id of ui.find({ prefix: SERVER_PREFIX })) {
        var node = ui.node(id);
        if (!node) continue;
        var parent = node.parent;
        for (var depth = 0; depth < 6 && parent != null; depth++) {
          var p = ui.node(parent);
          if (!p) break;
          if (p.children.length > index && !roots.includes(parent)) roots.push(parent);
          parent = p.parent;
        }
      }
      for (var root of roots) {
        var list = ui.node(root);
        var start = list?.children[index];
        if (start != null) {
          var gid = findGidInTree(start);
          if (gid) return gid;
        }
      }
      return null;
    }
    async function guildFromChannel(channelId) {
      if (!channelId) return null;
      var channel = await api(`/channels/${channelId}`);
      return channel?.guild_id != null ? String(channel.guild_id) : null;
    }
    function anchorRows() {
      var labels = [ANCHOR, ...FALLBACK_ANCHORS];
      var result = [];
      for (var aid of labels) {
        for (var row of ui.find({ exact: aid })) {
          var info = ui.node(row);
          if (!info || info.parent == null || result.some(function(r) {
            return r.row === row;
          })) continue;
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
    var pinnedGid = null;
    var pinnedAt = 0;
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
      var rows = anchorRows();
      if (rows.length === 0) return false;
      var target = rows[0];
      var LABEL_W = 58, ICON_W = 12, ROW_H = 16;
      function cellNode(cell) {
        if (!cell) return { kind: "view", props: { width: "fill", height: ROW_H } };
        return {
          kind: "view",
          props: { direction: "row", gap: 4, width: "fill", height: ROW_H, align: "center" },
          children: [
            {
              kind: "view",
              props: { width: ICON_W, height: ICON_W, align: "center", justify: "center" },
              children: cell.icon ? [{ kind: "image", props: { uri: cell.icon, width: ICON_W, height: ICON_W, tint: palette.label } }] : []
            },
            { kind: "text", props: {
              text: cell.label,
              color: palette.label,
              fontSize: 11,
              fontWeight: 500,
              width: LABEL_W,
              maxLines: 1,
              lineHeight: ROW_H,
              lineHeightExact: true
            } },
            { kind: "text", props: cell.label === "ID" ? { text: cell.value, color: palette.value, fontSize: 10, flex: 1, width: "fill", lineHeight: ROW_H } : {
              text: cell.value,
              color: palette.value,
              fontSize: 11,
              flex: 1,
              width: "fill",
              maxLines: 1,
              lineHeight: ROW_H,
              lineHeightExact: true
            } }
          ]
        };
      }
      function column(cells) {
        return { kind: "view", props: { direction: "column", gap: 4, flex: 1, width: "fill" }, children: cells.map(cellNode) };
      }
      var block = {
        kind: "view",
        props: {
          direction: "column",
          gap: 4,
          padding: [16, 16, 16, 16],
          align: "stretch",
          width: "fill",
          background: palette.bg,
          radius: CARD_RADIUS,
          clip: true,
          borderColor: palette.border,
          borderWidth: 1,
          margin: [0, -4, 0, 16]
        },
        children: [{
          kind: "view",
          props: { direction: "row", gap: 12, width: "fill", align: "start" },
          children: [column(grid.map(function(r) {
            return r[0];
          })), column(grid.map(function(r) {
            return r[1];
          }))]
        }]
      };
      try {
        removeMount();
        remover = ui.mount(target.parent, block, { before: target.row });
      } catch (e) {
        log.warn("mount failed: " + String(e));
        remover = null;
        return false;
      }
      mountedGid = columnsGid;
      needMount = false;
      return true;
    }
    async function refresh(gid, channelId) {
      var seq = ++requestSeq;
      if (busy) {
        queued = { gid, channelId };
        return;
      }
      busy = true;
      try {
        await ensureTheme();
        var target = gid ?? null;
        if (!target && overrideGid && Date.now() - overrideAt < OVERRIDE_MS) target = overrideGid;
        if (!target && pinnedGid && Date.now() - pinnedAt < OVERRIDE_MS) target = pinnedGid;
        if (!target) target = currentGid;
        if (!target) target = await guildFromChannel(channelId ?? channelGid());
        if (!target) return;
        if (mountedGid && mountedGid !== target) {
          removeMount();
          needMount = true;
        }
        var fresh = await infoColumns(target);
        if (seq !== requestSeq) return;
        grid = fresh;
        columnsGid = target;
        if (needMount || columnsGid !== mountedGid) mountInto();
      } finally {
        busy = false;
        var next = queued;
        queued = null;
        if (next) void refresh(next.gid, next.channelId);
      }
    }
    var channelInfo = gateway.channelInfo;
    if (channelInfo) {
      phoenix.on(channelInfo, function(payload) {
        var gid = payload?.guild_id;
        if (typeof gid === "string" && /^\d{17,19}$/.test(gid)) {
          currentGid = gid;
          if (pinnedGid && Date.now() - pinnedAt < OVERRIDE_MS) {
            log.info(`channelInfo ${gid} ignored (pinned ${pinnedGid})`);
            return;
          }
          invalidateForNewMenu();
          overrideGid = null;
          void refresh();
        }
      });
    }
    if (gateway.guildCreate) {
      phoenix.on(gateway.guildCreate, function(guild) {
        var raw = guild.joined_at ?? guild.joinedAt;
        var date = dateValue(raw);
        if (date && typeof guild.id === "string") joinedFromGateway.set(guild.id, date);
      });
    }
    for (var evName of ["rowLongPress", "longPress"]) {
      cleanups.push(ui.onEvent(evName, function(ev) {
        var gid = (ev.accessibilityId?.startsWith(SERVER_PREFIX) ? ev.accessibilityId.slice(SERVER_PREFIX.length) : null) ?? pressedGid(ev) ?? pressedGidFromPayload(ev);
        if (gid) {
          log.info(`long press guild ${gid}`);
          pinnedGid = gid;
          pinnedAt = Date.now();
          invalidateForNewMenu();
          overrideGid = gid;
          overrideAt = Date.now();
        } else {
          log.warn(`long press: no guild found (node=${ev.node}, payload=${JSON.stringify(ev.payload ?? null).slice(0, 160)})`);
        }
        void refresh(gid ?? void 0, ev.channelId);
      }));
    }
    cleanups.push(ui.onEvent("press", function(ev) {
      if (ev.accessibilityId === "guild.menu") {
        if (!(overrideGid && Date.now() - overrideAt < 1e4)) overrideGid = null;
        invalidateForNewMenu();
        currentGid = null;
        void refresh(overrideGid ?? void 0, ev.channelId);
      }
    }));
    for (var label of [ANCHOR, ...FALLBACK_ANCHORS]) {
      cleanups.push(ui.onNode({ exact: label }, function(node) {
        var live = ui.node(node.id);
        if ((live?.sheet ?? node.sheet) == null) return;
        invalidateForNewMenu();
        var activeOverride = overrideGid && Date.now() - overrideAt < OVERRIDE_MS ? overrideGid : pinnedGid && Date.now() - pinnedAt < OVERRIDE_MS ? pinnedGid : null;
        void refresh(activeOverride ?? void 0);
      }));
    }
    void refresh();
    phoenix.onUnload(function() {
      removeMount();
      needMount = false;
      for (var off of cleanups) {
        try {
          off();
        } catch {
        }
      }
      cleanups.length = 0;
    });
  })();
})();
