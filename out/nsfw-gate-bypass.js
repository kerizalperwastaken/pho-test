// @description Bypass NSFW gates by forcing adult status and serving age-gated messages with a legacy client version
// @version 1.0.0
// @author kerizalperwastaken
// @enabled true
(() => {
  // nsfw-gate-bypass/src/index.ts
  var { gateway, discord, log, storage } = phoenix;
  var ADULT_STATUS = 4;
  var LEGACY_SUPER_PROPERTIES = "eyJvcyI6IkFuZHJvaWQiLCJvc192ZXJzaW9uIjoiMTMiLCJicm93c2VyIjoiRGlzY29yZCBBbmRyb2lkIiwiZGV2aWNlIjoiUGl4ZWwiLCJjbGllbnRfdmVyc2lvbiI6IjIxOS4xMiIsImNsaWVudF9idWlsZF9udW1iZXIiOjI3MDAwMCwiY2xpZW50X2V2ZW50X3NvdXJjZSI6bnVsbH0=";
  function forceAdult(payload) {
    if (!payload || typeof payload !== "object") return;
    const users = [payload];
    if (payload.user && typeof payload.user === "object") users.push(payload.user);
    for (const user of users) {
      user.nsfw_allowed = true;
      user.nsfwAllowed = true;
      user.age_verification_status = ADULT_STATUS;
      user.ageVerificationStatus = ADULT_STATUS;
    }
  }
  if (gateway.ready) {
    phoenix.hook(gateway.ready, { before: (payload) => {
      forceAdult(payload);
    } });
  }
  if (gateway.userUpdate) {
    phoenix.hook(gateway.userUpdate, { before: (payload) => {
      forceAdult(payload);
    } });
  }
  var FED_KEY = "nsfw-fed-ids";
  var fed = new Set(storage.get(FED_KEY) ?? []);
  function rememberFed(id) {
    fed.add(id);
    if (fed.size > 5e3) {
      const trimmed = [...fed].slice(-5e3);
      fed.clear();
      for (const kept of trimmed) fed.add(kept);
    }
    storage.set(FED_KEY, [...fed]);
  }
  async function retry(path) {
    try {
      const res = await discord.get(path, {
        headers: { "X-Super-Properties": LEGACY_SUPER_PROPERTIES }
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
    return { body: "[]" };
  });
  phoenix.onUnload(() => {
  });
})();
