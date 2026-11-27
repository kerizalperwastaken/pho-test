// @description ServerInfo — server details in the guild menu: name, ID, owner, members, roles, channels, boosts, created, vanity
// @version 1.1.0
// @author kerizalperwastaken
// @enabled true
// @ui-tree
// @discord GET /users/@me
// @discord GET /users/*
// @discord GET /guilds/*
// @discord GET /guilds/*/roles
// @discord GET /guilds/*/channels
// @discord GET /guilds/*/members/*
// @discord GET /channels/*
// @stores
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
    var themeIsLight = false;
    async function ensureTheme() {
      themeIsLight = await detectLightTheme();
      if (cfg.theme === "midnight") palette = MIDNIGHT_PALETTE;
      else if (cfg.theme === "light") palette = CLASSIC_LIGHT;
      else if (cfg.theme === "dark") palette = CLASSIC_DARK;
      else palette = themeIsLight ? ADAPTIVE_LIGHT : ADAPTIVE_DARK;
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
    var CHEVRON_ICON = "res://ic_mana_group_arrow_right";
    var ACCENT = 0xff5865f2;
    var overlayRemover = null;
    var rolesList = null;
    function removeOverlay() {
      if (!overlayRemover) return;
      var off = overlayRemover;
      overlayRemover = null;
      try {
        off();
      } catch {
      }
    }
    function iconNode(name, size, tint) {
      return { kind: "image", props: { uri: name, width: size, height: size, tint } };
    }
    function roleColorArgb(role) {
      var c = Number(role?.color ?? 0);
      return Number.isFinite(c) && c > 0 ? 4278190080 + c : 4284244878;
    }
    function sheetProps() {
      var opaque = Math.floor(palette.bg / 16777216) === 255;
      return {
        dismissible: true,
        background: opaque ? palette.bg : themeIsLight ? 4294967295 : 4280954161,
        radiusTopLeft: 16,
        radiusTopRight: 16,
        scrimOpacity: 0.65,
        handleColor: palette.label
      };
    }
    function sheetHeader(title, sub, back) {
      var kids = [];
      if (back) {
        kids.push({
          kind: "text",
          props: { text: "‹", color: palette.value, fontSize: 26, width: 22, lineHeight: 28, lineHeightExact: true },
          onPress: back
        });
      }
      var titleKids = [{ kind: "text", props: { text: title, color: palette.value, fontSize: 17, fontWeight: 600, maxLines: 1, width: "fill" } }];
      if (sub) titleKids.push({ kind: "text", props: { text: sub, color: palette.label, fontSize: 12, maxLines: 1, width: "fill" } });
      kids.push({ kind: "view", props: { direction: "column", gap: 2, flex: 1, width: "fill" }, children: titleKids });
      return { kind: "view", props: { direction: "row", width: "fill", align: "center", gap: 8, padding: [16, 14, 16, 10] }, children: kids };
    }
    function scrollList(rows) {
      return {
        kind: "scroll",
        props: { width: "fill", flex: 1 },
        children: [{ kind: "view", props: { direction: "column", width: "fill", padding: [0, 0, 16, 0] }, children: rows }]
      };
    }
    function roleIconUri(role) {
      if (typeof role?.icon !== "string" || role.icon.length < 4) return null;
      return `https://cdn.discordapp.com/role-icons/${role.id}/${role.icon}.png?size=64`;
    }
    function roleBadge(role) {
      var uri = roleIconUri(role);
      if (uri) return { kind: "image", props: { uri, width: 18, height: 18, radius: 9 } };
      return { kind: "view", props: { width: 14, height: 14, radius: 7, background: roleColorArgb(role) } };
    }
    async function roleActions(role) {
      var name = typeof role?.name === "string" ? role.name : "";
      var color = Number(role?.color ?? 0);
      var hex = Number.isFinite(color) && color > 0 ? "#" + color.toString(16).padStart(6, "0").toUpperCase() : "";
      var pick = await ui.choose({
        title: name || "Role",
        options: [
          { label: "Copy Role Name" },
          { label: "Copy Role Color" }
        ]
      });
      if (pick === 0) {
        ui.copy(name);
        ui.toast("Role name copied");
      } else if (pick === 1) {
        if (!hex) {
          ui.toast("Role has no color");
          return;
        }
        ui.copy(hex);
        ui.toast("Role color copied: " + hex);
      }
    }
    var PERMS = [
      [0, "Create Instant Invite"], [1, "Kick Members"], [2, "Ban Members"], [3, "Administrator"],
      [4, "Manage Channels"], [5, "Manage Server"], [6, "Add Reactions"], [7, "View Audit Log"],
      [8, "Priority Speaker"], [9, "Stream"], [10, "View Channels"], [11, "Send Messages"],
      [12, "Send TTS Messages"], [13, "Manage Messages"], [14, "Embed Links"], [15, "Attach Files"],
      [16, "Read Message History"], [17, "Mention @everyone"], [18, "Use External Emojis"], [19, "View Server Insights"],
      [20, "Connect"], [21, "Speak"], [22, "Mute Members"], [23, "Deafen Members"],
      [24, "Move Members"], [25, "Use Voice Activity"], [26, "Change Nickname"], [27, "Manage Nicknames"],
      [28, "Manage Roles"], [29, "Manage Webhooks"], [30, "Manage Server Expressions"], [31, "Use Application Commands"],
      [32, "Request to Speak"], [33, "Manage Events"], [34, "Manage Threads"], [35, "Create Public Threads"],
      [36, "Create Private Threads"], [37, "Use External Stickers"], [38, "Send Messages in Threads"], [39, "Use Embedded Activities"],
      [40, "Moderate Members"], [41, "View Creator Monetization Analytics"], [42, "Use Soundboard"], [43, "Create Server Expressions"],
      [44, "Create Events"], [45, "Use External Sounds"], [46, "Send Voice Messages"], [47, "Create Polls"], [48, "Use External Apps"]
    ];
    function showRolePermissions(role) {
      var bits = 0n;
      try {
        bits = BigInt(role?.permissions ?? "0");
      } catch {
      }
      var isAdmin = ((bits >> 3n) & 1n) === 1n;
      var rows = PERMS.map(function(permission) {
        var enabled = isAdmin || ((bits >> BigInt(permission[0])) & 1n) === 1n;
        return {
          kind: "view",
          props: { direction: "row", width: "fill", align: "center", height: 40, padding: [16, 0, 16, 0] },
          children: [
            { kind: "text", props: { text: permission[1], color: palette.value, fontSize: 14, flex: 1, width: "fill", maxLines: 1 } },
            { kind: "text", props: { text: enabled ? "On" : "Off", color: enabled ? 0xff23a55a : 0xff80848e, fontSize: 13, fontWeight: 600 } }
          ]
        };
      });
      rows.unshift({
        kind: "view",
        props: { direction: "row", width: "fill", height: 42, align: "center", padding: [16, 0, 16, 0] },
        onPress: function() { void roleActions(role); },
        children: [
          { kind: "text", props: { text: "More", color: ACCENT, fontSize: 14, fontWeight: 600, flex: 1, width: "fill" } },
          iconNode(CHEVRON_ICON, 13, ACCENT)
        ]
      });
      removeOverlay();
      try {
        overlayRemover = ui.mount("root", {
          kind: "sheet",
          props: sheetProps(),
          onDismiss: removeOverlay,
          children: [sheetHeader(role.name ?? "Role", isAdmin ? "Administrator, all permissions on" : "Permissions", showRolesList), scrollList(rows)]
        });
      } catch (e) {
        log.warn("role permissions sheet failed: " + String(e));
        overlayRemover = null;
      }
    }
    function showRolesList() {
      if (!rolesList) return;
      var rows = rolesList.map(function(role) {
        return {
          kind: "view",
          props: { direction: "row", width: "fill", align: "center", gap: 12, height: 44, padding: [16, 0, 16, 0], accessibilityId: "serverinfo.role:" + role.id, on: ["longPress", "rowLongPress"] },
          onPress: function() {
            showRolePermissions(role);
          },
          children: [
            roleBadge(role),
            { kind: "text", props: { text: role.name ?? "role", color: palette.value, fontSize: 15, flex: 1, width: "fill", maxLines: 1 } },
            iconNode(CHEVRON_ICON, 13, palette.label)
          ]
        };
      });
      removeOverlay();
      try {
        overlayRemover = ui.mount("root", {
          kind: "sheet",
          props: sheetProps(),
          onDismiss: removeOverlay,
          children: [sheetHeader("Roles", rolesList.length + " roles"), scrollList(rows)]
        });
      } catch (e) {
        log.warn("roles overlay mount failed: " + String(e));
        overlayRemover = null;
      }
    }
    function openRoles(gid) {
      if (!gid) {
        ui.toast("Could not find the server");
        return;
      }
      void (async function() {
        var roles = await api(`/guilds/${gid}/roles`);
        if (!Array.isArray(roles) || roles.length === 0) {
          ui.toast("Could not load roles");
          return;
        }
        roles.sort(function(a, b) {
          return (b.position ?? 0) - (a.position ?? 0);
        });
        rolesList = roles;
        showRolesList();
      })();
    }
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
      var best = null;
      for (var id of ui.find({ prefix: CHANNEL_PREFIX })) {
        if (best === null || id > best) best = id;
      }
      if (best === null) return null;
      var aid = ui.node(best)?.accessibilityId;
      return aid ? aid.slice(CHANNEL_PREFIX.length) : null;
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
      var first = typeof list.first === "number" ? list.first : 0;
      var start = list.children[index - first] ?? list.children[index];
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
    var lockedGid = null;
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
        }, {
          kind: "view",
          props: { direction: "row", gap: 6, width: "fill", height: 30, align: "center", margin: [0, 6, 0, 0] },
          onPress: function() {
            openRoles(mountedGid ?? columnsGid ?? currentGid);
          },
          children: [
            iconNode(ICON.roles, 14, ACCENT),
            { kind: "text", props: { text: "View Roles", color: ACCENT, fontSize: 13, fontWeight: 600, flex: 1, width: "fill", maxLines: 1 } },
            iconNode(CHEVRON_ICON, 12, ACCENT)
          ]
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
        var target = lockedGid ?? gid ?? null;
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
          if (pinnedGid && Date.now() - pinnedAt < OVERRIDE_MS && pinnedGid === gid) return;
          if (pinnedGid !== gid) {
            pinnedGid = null;
            pinnedAt = 0;
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
          pinnedGid = gid;
          pinnedAt = Date.now();
          invalidateForNewMenu();
          overrideGid = gid;
          overrideAt = Date.now();
          lockedGid = gid;
        }
        void refresh(gid ?? void 0, ev.channelId);
      }));
    }
    cleanups.push(ui.onEvent("press", function(ev) {
      var aid = typeof ev.accessibilityId === "string" ? ev.accessibilityId : "";
      if (aid.startsWith(SERVER_PREFIX)) {
        var pressed = aid.slice(SERVER_PREFIX.length);
        if (/^\d{17,19}$/.test(pressed)) {
          currentGid = pressed;
          return;
        }
      }
      if (aid === "guild.menu") {
        lockedGid = null;
        if (!(overrideGid && Date.now() - overrideAt < 1e4)) overrideGid = null;
        invalidateForNewMenu();
        void refresh(overrideGid ?? void 0, ev.channelId);
      }
    }));
    cleanups.push(ui.onNode({ prefix: CHANNEL_PREFIX }, function() {
      var gid = channelGid();
      if (!gid) return;
      if (lockedGid && gid !== lockedGid) return;
      if (mountedGid && !needMount) {
        if (gid !== mountedGid && gid !== columnsGid) {
          invalidateForNewMenu();
          void refresh();
        }
        return;
      }
      if (needMount) void refresh();
    }));
    for (var label of [ANCHOR, ...FALLBACK_ANCHORS]) {
      cleanups.push(ui.onNode({ exact: label }, function(node) {
        var live = ui.node(node.id);
        if (!live) return;
        if (lockedGid) {
          if (columnsGid !== lockedGid || needMount) void refresh(lockedGid);
          return;
        }
        var activeOverride = overrideGid && Date.now() - overrideAt < 3000 ? overrideGid : pinnedGid && Date.now() - pinnedAt < 3000 ? pinnedGid : null;
        pinnedGid = null;
        pinnedAt = 0;
        overrideGid = null;
        overrideAt = 0;
        invalidateForNewMenu();
        void refresh(activeOverride ?? void 0);
      }));
    }
    void refresh();
    phoenix.onUnload(function() {
      removeMount();
      removeOverlay();
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
