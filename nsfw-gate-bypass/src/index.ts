// @description Bypass NSFW gates by forcing adult status and serving age-gated messages with a legacy client version
// @version 1.0.0
// @author kerizalperwastaken
// @enabled true

/**
 * NSFW gate bypass.
 *
 * Discord enforces the age gate in two places:
 *  - Client-side flags (`nsfw_allowed`, `ageVerificationStatus`) decide whether
 *    the NSFW/age-verification gate is shown.
 *  - The REST API returns 403 (code 50269) for age-gated message endpoints,
 *    based on `X-Super-Properties`: newer Android clients are blocked, older
 *    client versions are still served the messages.
 *
 * Phoenix exposes gateway hooks and an HTTP response hook, but not Discord's
 * Flux stores. So this plugin:
 *  - forces the adult-status fields on READY / USER_UPDATE,
 *  - on a 403 message response, repeats the request with a legacy
 *    `X-Super-Properties` header,
 *  - feeds the fetched messages back through `phoenix.enqueue` with fresh ids
 *    (the client treats them as new messages), tracking original ids in
 *    persistent storage so re-opens never duplicate them,
 *  - replaces the 403 body with an empty list so the client stops showing
 *    "Could not load message" for the original request.
 */

const { gateway, discord, log, storage } = phoenix;

const ADULT_STATUS = 4;
const LEGACY_SUPER_PROPERTIES =
  "eyJvcyI6IkFuZHJvaWQiLCJvc192ZXJzaW9uIjoiMTMiLCJicm93c2VyIjoiRGlzY29yZCBBbmRyb2lkIiwiZGV2aWNlIjoiUGl4ZWwiLCJjbGllbnRfdmVyc2lvbiI6IjIxOS4xMiIsImNsaWVudF9idWlsZF9udW1iZXIiOjI3MDAwMCwiY2xpZW50X2V2ZW50X3NvdXJjZSI6bnVsbH0=";

type Json = Record<string, any>;

function forceAdult(payload: Json | null | undefined): void {
  if (!payload || typeof payload !== "object") return;
  const users: Json[] = [payload];
  if (payload.user && typeof payload.user === "object") users.push(payload.user);
  for (const user of users) {
    user.nsfw_allowed = true;
    user.nsfwAllowed = true;
    user.age_verification_status = ADULT_STATUS;
    user.ageVerificationStatus = ADULT_STATUS;
  }
}

if (gateway.ready) {
  phoenix.hook(gateway.ready, { before: (payload) => { forceAdult(payload); } });
}
if (gateway.userUpdate) {
  phoenix.hook(gateway.userUpdate, { before: (payload) => { forceAdult(payload); } });
}

/** Original message ids already fed, kept across reloads. */
const FED_KEY = "nsfw-fed-ids";
const fed = new Set<string>(storage.get<string[]>(FED_KEY) ?? []);

function rememberFed(id: string): void {
  fed.add(id);
  if (fed.size > 5000) {
    const trimmed = [...fed].slice(-5000);
    fed.clear();
    for (const kept of trimmed) fed.add(kept);
  }
  storage.set(FED_KEY, [...fed]);
}

async function retry(path: string): Promise<string | null> {
  try {
    const res = await discord.get(path, {
      headers: { "X-Super-Properties": LEGACY_SUPER_PROPERTIES },
    });
    if (res && res.status >= 200 && res.status < 300) return res.text();
  } catch (e) {
    log.warn(`age gate retry ${path}: ${String(e)}`);
  }
  return null;
}

discord.onResponse({ method: "GET" }, async (res) => {
  if (res.status !== 403 || !res.body.includes("50269")) return;
  const body = await retry(res.path);
  if (!body) return;
  try {
    const messages = JSON.parse(body);
    if (Array.isArray(messages) && gateway.messageCreate) {
      let fake = BigInt(Date.now()) << 22n;
      let sent = 0;
      for (const msg of messages) {
        const original = String(msg.id ?? "");
        if (original && fed.has(original)) continue;
        if (original) rememberFed(original);
        // A fresh id makes the client treat fetched history as new messages.
        msg.id = String(fake++);
        msg.nonce = msg.id;
        phoenix.enqueue(gateway.messageCreate, msg);
        sent++;
      }
      log.info(`NSFW: fed ${sent} messages (${messages.length} fetched)`);
    }
  } catch (e) {
    log.warn(`NSFW: enqueue failed: ${String(e)}`);
  }
  // Keep the original request quiet: an empty list avoids "Could not load
  // message" while the real messages arrive via the gateway above.
  return { body: "[]" };
});

phoenix.onUnload(() => {
  // Hooks are removed by the runtime.
});
