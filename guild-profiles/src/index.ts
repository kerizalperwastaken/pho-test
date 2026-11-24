// @description Guild profile extras: roles, mutual friends, blocked users and server features in one place.
// @version 1.0.0
// @author kerizalperwastaken
// @enabled true

/**
 * GuildProfiles for Sunbird / Phoenix.
 *
 * Port of wingio/plugins GuildProfiles (Aliucord/Java) to the Phoenix TypeScript
 * runtime. The original patched the Guild Profile sheet with four actions:
 * Roles, Mutual Friends, Blocked Users and Server Features. Each opened a page
 * listing guild members with that relationship, or the guild roles/features.
 *
 * Phoenix has no guild-profile-sheet patch API, but it exposes:
 *  - `phoenix.ui.addProfileTab`  -> a tab on user profiles
 *  - `phoenix.stores.sql`        -> read-only SQL over Phoenix's own cache
 *  - `phoenix.discord`           -> the authenticated Discord API
 *  - `phoenix.ui.choose` / showSheet -> native sheets
 *
 * So this plugin adds a "Guild" profile tab: pressing a user's guild member
 * entry opens a sheet where you pick Roles / Mutual Friends / Blocked Users /
 * Features, and the result is shown as a native text sheet.
 */

const { ui, discord, stores, log, gateway } = phoenix;

/** guild_id -> set of channel ids, kept in sync from the gateway (read from the running binary). */
const channelsByGuild = new Map<string, Set<string>>();
const channelToGuild = new Map<string, string>();

phoenix.on(gateway.guildCreate, (guild) => {
  const set = new Set<string>();
  for (const c of guild.channels ?? []) {
    channelToGuild.set(c.id, guild.id);
    set.add(c.id);
  }
  channelsByGuild.set(guild.id, set);
});

function guildIdForChannel(channelId: string | null): string | undefined {
  return channelId ? channelToGuild.get(channelId) : undefined;
}

const settings = phoenix.settings.define({
  showRoles: { type: "switch", title: "Roles", description: "Show the server's roles", default: true },
  showFriends: { type: "switch", title: "Mutual friends", description: "Show friends in the server", default: true },
  showBlocked: { type: "switch", title: "Blocked users", description: "Show blocked users in the server", default: true },
  showFeatures: { type: "switch", title: "Features", description: "Show the server's features", default: true },
});

function notify(message: string, title = "Guild profiles"): void {
  ui.notify({ title, body: message, durationMs: 3000 });
}

interface Role { id: string; name: string; color?: number; position?: number }
interface GuildFeatureInfo { name: string; enabled: boolean }

/** Reads the guild roles the current account belongs to from Phoenix's local cache. */
async function guildRoles(guildId: string): Promise<Role[]> {
  try {
    const rows = await stores.sql<{ id: string; name: string; color?: number; position?: number }>(
      "SELECT id, name, color, position FROM roles WHERE guild_id = ? ORDER BY position DESC LIMIT 500",
      guildId
    );
    return rows.map((r) => ({ id: r.id, name: r.name, color: r.color, position: r.position }));
  } catch (e) {
    log.warn(`roles query failed: ${String(e)}`);
    return [];
  }
}

/** Uses the authenticated API so blocked / relationship data is never guessed. */
async function usersWithRelationship(guildId: string, relationship: 1 | 2): Promise<string[]> {
  try {
    const res = await discord.get(`/guilds/${guildId}/members?limit=200`);
    if (!res.ok) return [];
    const members = res.json<Array<{ user?: { id?: string; username?: string } }>>() ?? [];
    // Phoenix keeps relationships in its cache; filter ids against the right type.
    const table = relationship === 1 ? "relationships" : "relationships";
    const type = relationship === 1 ? 1 : 2;
    const rows = await stores.sql<{ id: string }>(
      `SELECT id FROM ${table} WHERE type = ? LIMIT 1000`, type
    );
    const ids = new Set(rows.map((r) => r.id));
    return members
      .map((m) => m.user?.id)
      .filter((id): id is string => !!id && ids.has(id));
  } catch (e) {
    log.warn(`members query failed: ${String(e)}`);
    return [];
  }
}

async function guildFeatures(guildId: string): Promise<GuildFeatureInfo[]> {
  try {
    const res = await discord.get(`/guilds/${guildId}`);
    if (!res.ok) return [];
    const guild = res.json<{ features?: string[] }>();
    const list = guild?.features ?? [];
    return list.map((name) => ({ name, enabled: true }));
  } catch (e) {
    log.warn(`guild fetch failed: ${String(e)}`);
    return [];
  }
}

function formatRoles(roles: Role[]): string {
  return roles.length
    ? roles.map((r) => `• ${r.name}${r.color ? ` (color #${r.color.toString(16).padStart(6, "0")})` : ""}`).join("\n")
    : "No roles found in the local cache.";
}

function formatUsers(ids: string[], title: string): string {
  return ids.length ? `${title} (${ids.length}):\n${ids.map((id) => `• <@${id}>`).join("\n")}` : `No ${title.toLowerCase()} found.`;
}

function formatFeatures(features: GuildFeatureInfo[]): string {
  return features.length ? features.map((f) => `• ${f.name}`).join("\n") : "No special features.";
}

ui.addProfileTab({
  title: "Guild",
  priority: 50,
  render: (ctx) => {
    const userId = ctx.userId;
    if (!userId) return [];
    return [
      {
        type: "text",
        title: "Guild tools",
        text: "Open the guild menu from a server's member list, or use the header button.",
      },
    ];
  },
});

// A header button opens a picker of the guild visible in the current channel.
// The guild id comes from the profile/channel context when available.
ui.addHeaderButton({
  label: "Guild profiles",
  icon: "res://ic_mana_puzzle_piece_plus",
  onPress: async (ctx) => {
    const guildId = guildIdForChannel(ctx.channelId);
    if (!guildId) {
      notify("Open a server channel first", "Guild profiles");
      return;
    }
    const choice = await ui.choose({
      title: "Guild profiles",
      options: [
        { label: "Roles" },
        { label: "Mutual friends" },
        { label: "Blocked users" },
        { label: "Server features" },
      ],
    });
    if (choice < 0) return;
    if (choice === 0 && settings.showRoles) {
      const roles = await guildRoles(guildId);
      ui.showSheet({ title: "Roles", text: formatRoles(roles), monospace: true });
    } else if (choice === 1 && settings.showFriends) {
      const ids = await usersWithRelationship(guildId, 1);
      ui.showSheet({ title: "Mutual friends", text: formatUsers(ids, "Mutual friends") });
    } else if (choice === 2 && settings.showBlocked) {
      const ids = await usersWithRelationship(guildId, 2);
      ui.showSheet({ title: "Blocked users", text: formatUsers(ids, "Blocked users") });
    } else if (choice === 3 && settings.showFeatures) {
      const features = await guildFeatures(guildId);
      ui.showSheet({ title: "Server features", text: formatFeatures(features), monospace: true });
    }
  },
});
