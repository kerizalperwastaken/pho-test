// @description Server info as text inside the guild menu sheet only. No buttons, nothing elsewhere.
// @version 1.0.0
// @author kerizalperwastaken
// @enabled true
(() => {
  // guild-menu-info/src/index.ts
  var P = phoenix;
  var ui = P.ui;
  var discord = P.discord;
  var log = P.log;
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
  async function infoText(gid) {
    const guild = await api(`/guilds/${gid}?with_counts=true`);
    if (!guild) return "Server info unavailable";
    const [roles, channels] = await Promise.all([
      api(`/guilds/${gid}/roles`),
      api(`/guilds/${gid}/channels`)
    ]);
    const boosts = guild.premium_subscription_count;
    return [
      `${guild.name ?? "Server"} \u2014 ${gid}`,
      `Members ${fmt(guild.approximate_member_count ?? guild.member_count)} \xB7 Online ${fmt(guild.approximate_presence_count)}`,
      `Roles ${fmt(Array.isArray(roles) ? roles.length : void 0)} \xB7 Channels ${fmt(Array.isArray(channels) ? channels.length : void 0)}`,
      `Boost Lv ${guild.premium_tier ?? 0}${typeof boosts === "number" && boosts > 0 ? ` (${boosts})` : ""}`
    ].join("\n");
  }
  function sheetIds() {
    const root = ui.root();
    if (root == null) return [];
    const found = /* @__PURE__ */ new Set();
    const stack = [root];
    const seen = /* @__PURE__ */ new Set();
    while (stack.length && seen.size < 8e3) {
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
  var armedAt = 0;
  var armedChannel = null;
  var done = /* @__PURE__ */ new Set();
  var removers = [];
  async function fillSheet(sheet) {
    if (done.has(sheet)) return;
    done.add(sheet);
    if (!armedChannel) return;
    const channel = await api(`/channels/${armedChannel}`);
    const gid = channel?.guild_id;
    if (!gid) return;
    const text = await infoText(gid);
    const remover = ui.mount(sheet, {
      kind: "text",
      props: { text, color: 4290362302, fontSize: 13, padding: [12, 16, 12, 16] }
    }, { before: "start" });
    removers.push(remover);
  }
  ui.onEvent("press", (ev) => {
    if (ev.accessibilityId !== "guild.menu") return;
    armedAt = Date.now();
    armedChannel = ev.channelId ?? null;
    for (const sheet of sheetIds()) void fillSheet(sheet);
  });
  ui.onNode({ prefix: "" }, (node) => {
    if (node.sheet == null) return;
    if (Date.now() - armedAt > 5e3) return;
    void fillSheet(node.sheet);
  });
  phoenix.onUnload(() => {
    for (const remove of removers) remove();
    removers.length = 0;
    done.clear();
  });
})();
