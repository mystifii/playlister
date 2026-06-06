import { logger } from "../logger.js";

const DISCORD_API = "https://discord.com/api/v10";

// Discord permission bits (BigInt — some exceed 32 bits).
const PERM = {
  ADMINISTRATOR: 1n << 3n,
  VIEW_CHANNEL: 1n << 10n,
  SEND_MESSAGES: 1n << 11n,
  EMBED_LINKS: 1n << 14n,
  SEND_MESSAGES_IN_THREADS: 1n << 38n,
};

// Channel types that are threads (permissions inherit from the parent channel).
const THREAD_TYPES = new Set([10, 11, 12]);
const PRIVATE_THREAD = 12;

export interface PermissionDiagnosis {
  ok: boolean;
  summary: string;
}

interface Overwrite {
  id: string;
  type: number; // 0 = role, 1 = member
  allow: string;
  deny: string;
}
interface Channel {
  id: string;
  type: number;
  guild_id?: string;
  parent_id?: string;
  permission_overwrites?: Overwrite[];
}
interface Role {
  id: string;
  permissions: string;
}

/**
 * Work out whether the bot can actually post into a channel/thread, and if not,
 * which specific permission(s) it's missing — Discord's "Missing Permissions"
 * error never tells you, so we compute it ourselves.
 */
export async function diagnoseChannelPermissions(
  botToken: string | undefined,
  channelId: string,
): Promise<PermissionDiagnosis> {
  if (!botToken) return { ok: false, summary: "No bot token is set." };

  const get = async (path: string) => {
    const res = await fetch(`${DISCORD_API}${path}`, {
      headers: { Authorization: `Bot ${botToken}` },
    });
    const json = await res.json().catch(() => ({}));
    return { status: res.status, ok: res.ok, json } as {
      status: number;
      ok: boolean;
      json: any;
    };
  };

  try {
    const me = await get("/users/@me");
    if (!me.ok) {
      return { ok: false, summary: "The bot token appears to be invalid." };
    }
    const botId: string = me.json.id;

    const chan = await get(`/channels/${channelId}`);
    if (!chan.ok) {
      if (chan.json?.code === 50001 || chan.status === 403) {
        return {
          ok: false,
          summary:
            "The bot can't access that channel — it's missing View Channel, " +
            "or it hasn't been added to the server/thread.",
        };
      }
      if (chan.status === 404) {
        return {
          ok: false,
          summary:
            "Channel/thread not found — check the ID, and that the bot is in that server.",
        };
      }
      return { ok: false, summary: `Couldn't read the channel (HTTP ${chan.status}).` };
    }

    const channel = chan.json as Channel;
    const isThread = THREAD_TYPES.has(channel.type);
    const guildId = channel.guild_id;
    if (!guildId) {
      return { ok: false, summary: "That destination isn't a server channel/thread." };
    }

    // Threads inherit permissions from their parent channel's overwrites.
    let overwriteSource = channel;
    if (isThread && channel.parent_id) {
      const parent = await get(`/channels/${channel.parent_id}`);
      if (parent.ok) overwriteSource = parent.json as Channel;
    }

    const rolesRes = await get(`/guilds/${guildId}/roles`);
    const memberRes = await get(`/guilds/${guildId}/members/${botId}`);
    if (memberRes.status === 404) {
      return { ok: false, summary: "The bot hasn't been added to this server." };
    }
    if (!rolesRes.ok || !memberRes.ok) {
      return {
        ok: false,
        summary: "Couldn't read the bot's roles to compute permissions.",
      };
    }

    const roles: Role[] = rolesRes.json;
    const memberRoleIds: string[] = memberRes.json.roles ?? [];
    const effective = computeEffective(
      roles,
      memberRoleIds,
      botId,
      guildId,
      overwriteSource.permission_overwrites ?? [],
    );

    if (effective & PERM.ADMINISTRATOR) {
      return { ok: true, summary: "Bot has Administrator — all good." };
    }

    const required: Array<[bigint, string]> = [
      [PERM.VIEW_CHANNEL, "View Channel"],
      [PERM.EMBED_LINKS, "Embed Links"],
      isThread
        ? [PERM.SEND_MESSAGES_IN_THREADS, "Send Messages in Threads"]
        : [PERM.SEND_MESSAGES, "Send Messages"],
    ];
    const missing = required.filter(([bit]) => (effective & bit) === 0n).map(([, n]) => n);

    if (missing.length === 0) {
      let summary = "Bot has the required permissions here.";
      if (channel.type === PRIVATE_THREAD) {
        summary += " (Private thread — make sure the bot has been added to it.)";
      }
      return { ok: true, summary };
    }
    return { ok: false, summary: `Missing permission(s): ${missing.join(", ")}.` };
  } catch (err) {
    logger.debug(`Permission diagnosis failed: ${(err as Error).message}`);
    return { ok: false, summary: "Couldn't determine the bot's permissions." };
  }
}

/** Apply Discord's permission overwrite resolution order. */
function computeEffective(
  roles: Role[],
  memberRoleIds: string[],
  botId: string,
  guildId: string,
  overwrites: Overwrite[],
): bigint {
  const rolePerms = new Map(roles.map((r) => [r.id, BigInt(r.permissions)]));

  // Base: @everyone plus every role the bot has.
  let perms = rolePerms.get(guildId) ?? 0n;
  for (const id of memberRoleIds) perms |= rolePerms.get(id) ?? 0n;
  if (perms & PERM.ADMINISTRATOR) return PERM.ADMINISTRATOR;

  const find = (id: string, type: number) =>
    overwrites.find((o) => o.id === id && o.type === type);

  // @everyone channel overwrite.
  const everyone = find(guildId, 0);
  if (everyone) perms = (perms & ~BigInt(everyone.deny)) | BigInt(everyone.allow);

  // Aggregated role overwrites for the bot's roles.
  let allow = 0n;
  let deny = 0n;
  for (const id of memberRoleIds) {
    const ow = find(id, 0);
    if (ow) {
      allow |= BigInt(ow.allow);
      deny |= BigInt(ow.deny);
    }
  }
  perms = (perms & ~deny) | allow;

  // Member-specific overwrite (highest precedence).
  const member = find(botId, 1);
  if (member) perms = (perms & ~BigInt(member.deny)) | BigInt(member.allow);

  return perms;
}
