// @description Guild profile extras: roles, mutual friends, blocked users and server features in one place.
// @version 1.1.0
// @author kerizalperwastaken
// @enabled true

/**
 * GuildProfiles for Sunbird / Phoenix.
 *
 * Port of wingio/plugins GuildProfiles (Aliucord/Java) to the Phoenix TypeScript
 * runtime. The original patched `WidgetGuildProfileSheet.configureUI` and added
 * four actions to the guild's own profile sheet. Phoenix has no equivalent hook
 * point: `ui.addProfileSection` / `addProfileTab` anchor to *user* profiles, not
 * to the guild sheet. This port therefore exposes the same information through:
 *
 *  - a "Guild" tab on user profiles (roles of that member in the open server)
 *  - a header button menu in any server channel (Roles, Mutual friends,
 *    Blocked users, Server features)
 *
 * Everything is read through `phoenix.discord` with the app's own session; no
 * guessed cache table names are involved.
 */

const P = phoenix;
const ui = P.ui;
const discord = P.discord;
const log = P.log;

const settings = P.settings.define({
  showRoles: { type: "switch", title: "Roles", description: "Show the server's roles", default: true },
  showFriends: { type: "switch", title: "Mutual friends", description: "Show friends in the server", default: true },
  showBlocked: { type: "switch", title: "Blocked users", description: "Show blocked users in the server", default: true },
  showFeatures: { type: "switch", title: "Features", description: "Show the server's features", default: true },
});

interface Role { id: string; name: string; color?: number }
interface Response { ok: boolean; status?: number; json<T = any>(): T | null; text?(): string }

function notify(message: string, title = "Guild profiles"): void {
  if (typeof ui.notify === "function") ui.notify({ title, body: message, durationMs: 3500 });
  else if (typeof ui.toast === "function") ui.toast(`${title}: ${message}`);
  else log.info(`${title}: ${message}`);
}

async function get(path: string): Promise<Response | null> {
  try {
    const res = await discord.get(path);
    return res && typeof (res as any).json === "function" ? (res as Response) : null;
  } catch (e) {
    log.warn(`GET ${path}: ${String(e)}`);
    return null;
  }
}

/** Discord gives us guild_id for a channel; no gateway hook needed. */
async function guildIdForChannel(channelId: string | null): Promise<string | undefined> {
  if (!channelId) return undefined;
  const res = await get(`/channels/${channelId}`);
  return (res?.json<{ guild_id?: string }>()?.guild_id) || undefined;
}

async function roles(guildId: string): Promise<Role[]> {
  const res = await get(`/guilds/${guildId}/roles`);
  const list = res?.json<Array<{ id: string; name: string; color?: number }>>();
  return (list ?? []).map((r) => ({ id: r.id, name: r.name, color: r.color }));
}

async function memberIds(guildId: string): Promise<Set<string>> {
  const res = await get(`/guilds/${guildId}/members?limit=1000`);
  const list = res?.json<Array<{ user?: { id?: string } }>>() ?? [];
  return new Set(list.map((m) => m.user?.id).filter((id): id is string => !!id));
}

/** relationship type 1 = friend, 2 = blocked. Intersect with the guild's members. */
async function relatedInGuild(guildId: string, type: number): Promise<string[]> {
  const [rels, members] = await Promise.all([get("/users/@me/relationships"), memberIds(guildId)]);
  const list = rels?.json<Array<{ id?: string; user_id?: string; type?: number }>>() ?? [];
  const ids = list
    .filter((r) => r.type === type)
    .map((r) => r.id ?? r.user_id)
    .filter((id): id is string => !!id && members.has(id));
  return [...new Set(ids)];
}

async function features(guildId: string): Promise<string[]> {
  const res = await get(`/guilds/${guildId}`);
  return res?.json<{ features?: string[] }>()?.features ?? [];
}

function lines(title: string, items: string[]): string {
  return items.length ? `${title} (${items.length}):\n${items.map((x) => `• ${x}`).join("\n")}` : `${title}: yok`;
}

// A real Guild tab on user profiles: this member's roles in the open server.
ui.addProfileTab({
  title: "Guild",
  priority: 50,
  render: async (ctx) => {
    const userId = ctx.userId;
    if (!userId) return [];
    const guildId = await guildIdForChannel(ctx.channelId);
    if (!guildId) {
      return [{ type: "text", title: "Guild", text: "Sunucu kanalında açıldığında bu üyenin rollerini gösterir." }];
    }
    try {
      const [member, allRoles] = await Promise.all([
        get(`/guilds/${guildId}/members/${userId}`),
        roles(guildId),
      ]);
      const roleIds: string[] = member?.json<{ roles?: string[] }>()?.roles ?? [];
      const mine = allRoles.filter((r) => roleIds.includes(r.id));
      const names = mine.length
        ? mine.map((r) => r.name + (r.color ? ` (#${r.color.toString(16).padStart(6, "0")})` : ""))
        : ["Rol yok"];
      return [{ type: "text", title: "Sunucu rolleri", text: names.join("\n") }];
    } catch (e) {
      return [{ type: "text", title: "Guild", text: `Roller okunamadı: ${String(e)}` }];
    }
  },
});

ui.addHeaderButton({
  label: "Guild profiles",
  icon: "res://ic_mana_puzzle_piece_plus",
  onPress: async (ctx) => {
    const guildId = await guildIdForChannel(ctx.channelId);
    if (!guildId) {
      notify("Önce bir sunucu kanalı aç");
      return;
    }
    const choice = await ui.choose({
      title: "Guild profiles",
      message: "Sunucu bilgilerini göster",
      options: [
        { label: "Roller" },
        { label: "Ortak arkadaşlar" },
        { label: "Engelli kullanıcılar" },
        { label: "Sunucu özellikleri" },
      ],
    });
    if (choice === 0 && settings.showRoles) {
      const list = await roles(guildId);
      ui.showSheet({
        title: "Roller",
        text: lines("Roller", list.map((r) => r.name + (r.color ? ` (#${r.color.toString(16).padStart(6, "0")})` : ""))),
        monospace: true,
      });
    } else if (choice === 1 && settings.showFriends) {
      ui.showSheet({ title: "Ortak arkadaşlar", text: lines("Ortak arkadaşlar", await relatedInGuild(guildId, 1)) });
    } else if (choice === 2 && settings.showBlocked) {
      ui.showSheet({ title: "Engelli kullanıcılar", text: lines("Engelli kullanıcılar", await relatedInGuild(guildId, 2)) });
    } else if (choice === 3 && settings.showFeatures) {
      ui.showSheet({ title: "Sunucu özellikleri", text: lines("Özellikler", await features(guildId)), monospace: true });
    }
  },
});
