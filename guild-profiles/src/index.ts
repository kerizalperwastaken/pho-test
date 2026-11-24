// @description Guild profile sheet actions: roles, mutual friends, blocked users and server features.
// @version 2.0.0
// @author kerizalperwastaken
// @enabled true

/**
 * GuildProfiles — port of wingio/plugins/GuildProfiles (Aliucord) to Phoenix.
 *
 * The original patched `WidgetGuildProfileSheet.configureUI` and placed four
 * actions in the guild profile sheet: Roles, Mutual Friends, Blocked Users and
 * Features. Each opened a page listing guild members in that relationship, or
 * the guild's roles/features.
 *
 * Phoenix exposes no named guild-sheet patch target, so this port finds the
 * sheet through the generic view API: a press on a guild/server view arms a
 * short window, and the first sheet created in that window gets a mounted
 * GuildProfiles section. A catch-all node watcher does the same when a matched
 * node appears inside a sheet. The guild id is taken from the press event's
 * channel, then everything is read through phoenix.discord.
 */

const P = phoenix;
const ui = P.ui;
const discord = P.discord;
const log = P.log;

const settings = P.settings.define({
  roles: { type: "switch", title: "Roles", description: "Show Roles in the guild profile sheet", default: true },
  friends: { type: "switch", title: "Mutual friends", description: "Show Mutual friends", default: true },
  blocked: { type: "switch", title: "Blocked users", description: "Show Blocked users", default: true },
  features: { type: "switch", title: "Features", description: "Show server features", default: true },
  probe: { type: "switch", title: "Log sheet node ids", description: "Debug: log accessibility ids while a sheet opens", default: false },
});

type Json = Record<string, any>;

async function get(path: string): Promise<Json | null> {
  try {
    const res = await discord.get(path);
    return res && typeof res.json === "function" ? (res.json<Json>() ?? null) : null;
  } catch (e) {
    log.warn(`GET ${path}: ${String(e)}`);
    return null;
  }
}

async function guildId(channelId: string | null | undefined): Promise<string | undefined> {
  if (!channelId) return undefined;
  const channel = await get(`/channels/${channelId}`);
  return channel?.guild_id ?? undefined;
}

async function guildRoles(gid: string): Promise<{ id: string; name: string; color?: number }[]> {
  const data = await get(`/guilds/${gid}/roles`);
  const roles = (data as any)?.roles ?? data ?? [];
  return Array.isArray(roles)
    ? roles.map((r: Json) => ({ id: String(r.id), name: String(r.name ?? r.id), color: r.color }))
    : [];
}

async function memberIds(gid: string): Promise<Set<string>> {
  const data = await get(`/guilds/${gid}/members?limit=1000`);
  const list = Array.isArray(data) ? data : (data as any)?.members ?? [];
  return new Set((list as Json[]).map((m) => m.user?.id).filter((id): id is string => !!id));
}

/** type 1 = friend, 2 = blocked. Intersect with the guild's member list, like the original. */
async function relatedInGuild(gid: string, type: number): Promise<string[]> {
  const [rels, members] = await Promise.all([get("/users/@me/relationships"), memberIds(gid)]);
  const list = Array.isArray(rels) ? rels : (rels as any)?.relationships ?? [];
  return [...new Set(
    (list as Json[])
      .filter((r) => r.type === type)
      .map((r) => r.id ?? r.user_id ?? r.user?.id)
      .filter((id): id is string => !!id && members.has(id))
  )];
}

async function guildFeatures(gid: string): Promise<string[]> {
  const data = await get(`/guilds/${gid}`);
  return Array.isArray(data?.features) ? data.features.map(String) : [];
}

function show(title: string, lines: string[], monospace = false): void {
  const text = lines.length ? lines.map((l) => `• ${l}`).join("\n") : "Yok";
  ui.showSheet({ title, text, monospace });
}

function openRoles(gid: string): void {
  if (!settings.roles) return;
  void guildRoles(gid).then((roles) =>
    show("Roller", roles.map((r) => r.name + (r.color ? ` (#${(r.color & 0xffffff).toString(16).padStart(6, "0")})` : "")), true)
  );
}

function openFriends(gid: string): void {
  if (!settings.friends) return;
  void relatedInGuild(gid, 1).then((ids) => show("Ortak arkadaşlar", ids));
}

function openBlocked(gid: string): void {
  if (!settings.blocked) return;
  void relatedInGuild(gid, 2).then((ids) => show("Engelli kullanıcılar", ids));
}

function openFeatures(gid: string): void {
  if (!settings.features) return;
  void guildFeatures(gid).then((features) => show("Sunucu özellikleri", features, true));
}

/** The mounted section, shaped like the original sheet's four action rows. */
function menuNode(gid: string) {
  const row = (label: string, action: () => void) => ({
    kind: "text",
    props: {
      text: label,
      color: 0xff5865f2,
      fontSize: 16,
      padding: [10, 14, 10, 14],
    },
    onPress: action,
  });
  const children = [
    { kind: "text", props: { text: "GuildProfiles", color: 0xffb9bbbe, fontSize: 13, padding: [14, 14, 4, 14] } },
    row("Roller", () => openRoles(gid)),
    row("Ortak arkadaşlar", () => openFriends(gid)),
    row("Engelli kullanıcılar", () => openBlocked(gid)),
    row("Sunucu özellikleri", () => openFeatures(gid)),
  ];
  return { kind: "view", props: { padding: [4, 0, 8, 0] }, children };
}

// --- find the guild profile sheet -------------------------------------------------

const GUILD_HINT = /guild|server|sunucu/i;
const sheetsDone = new Set<number>();
let armedAt = 0;
let armedChannel: string | null = null;

function sheetIds(): number[] {
  const root = ui.root?.();
  if (root == null) return [];
  const found = new Set<number>();
  const stack: number[] = [root];
  const seen = new Set<number>();
  while (stack.length && seen.size < 400) {
    const id = stack.pop()!;
    if (seen.has(id)) continue;
    seen.add(id);
    const node = ui.node(id);
    if (!node) continue;
    if (node.sheet != null) found.add(node.sheet);
    for (const child of node.children ?? []) stack.push(child);
  }
  return [...found];
}

async function attachNewSheet(sheet?: number): Promise<void> {
  const target = sheet ?? sheetIds().filter((id) => id > 0 && !sheetsDone.has(id)).pop();
  if (target == null || sheetsDone.has(target)) return;
  const gid = await guildId(armedChannel);
  if (!gid) {
    log.info("GuildProfiles: sheet open, but no guild id for the channel");
    return;
  }
  sheetsDone.add(target);
  ui.mount(target, menuNode(gid), { before: "start" });
  log.info(`GuildProfiles: mounted in sheet ${target} (guild ${gid})`);
}

// Every press on a guild/server view opens a one-shot window for the sheet.
ui.onEvent(
  "press",
  (ev) => {
    const aid = ev.accessibilityId ?? "";
    if (!GUILD_HINT.test(aid)) return;
    armedAt = Date.now();
    armedChannel = ev.channelId ?? null;
    void attachNewSheet();
  },
  { intercept: false }
);

// Only nodes created inside a freshly opened sheet are considered. We mount
// once into the sheet itself, never into arbitrary guild-named nodes.
ui.onNode({ prefix: "" }, (node) => {
  if (settings.probe) log.info(`node ${node.id} aid=${node.accessibilityId} sheet=${node.sheet} kind=${node.kind}`);
  if (node.sheet == null) return;
  if (Date.now() - armedAt > 3000) return;
  void attachNewSheet(node.sheet);
});

// A header button remains as a guaranteed entry point when the sheet has no
// press event with a guild/server id (Phoenix does not expose one on all builds).
ui.addHeaderButton({
  label: "GuildProfiles",
  icon: "res://ic_mana_puzzle_piece_plus",
  onPress: async (ctx) => {
    const gid = await guildId(ctx.channelId);
    if (!gid) {
      ui.toast("GuildProfiles: bir sunucu kanalı aç");
      return;
    }
    const choice = await ui.choose({
      title: "GuildProfiles",
      message: "Sunucu profili aksiyonları",
      options: [
        { label: "Roller" },
        { label: "Ortak arkadaşlar" },
        { label: "Engelli kullanıcılar" },
        { label: "Sunucu özellikleri" },
      ],
    });
    if (choice === 0) openRoles(gid);
    else if (choice === 1) openFriends(gid);
    else if (choice === 2) openBlocked(gid);
    else if (choice === 3) openFeatures(gid);
  },
});

phoenix.onUnload(() => { armedAt = 0; sheetsDone.clear(); });
