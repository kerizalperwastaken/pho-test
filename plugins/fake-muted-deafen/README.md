# Fake Mute & Deafen for Sunbird / Phoenix

Look muted or deafened to other people in voice while you can still talk and hear.
This is the Sunbird/Phoenix port of [ValencedPlugins `fakemutedeafen`](https://github.com/il1ll/ValencedPlugins/tree/main/plugins/fakemutedeafen).

## How it works in the reference

The Valenced plugin hooked the gateway socket's `send` and rewrote every
`VOICE_STATE_UPDATE` (op 4) payload:

```ts
if (fakeDeafen) { self_deaf = true; self_mute = true }
else if (fakeMute) { self_mute = true }
```

That makes the server broadcast the fake flags while local capture/playback stay on.

## What Phoenix exposes

Phoenix plugins are thin TypeScript over the `phoenix` API. There is **no**
outbound gateway hook and no socket `send` patch: `phoenix.hook` only observes
*inbound* events, and `phoenix.discord.onRequest` only intercepts HTTP. The
native voice surface is the `Voice` host module reached through
`phoenix.bridge.invoke` (`docs/phoenix-356207.md`: module 61, `op` 254,
`muteState` 253, `setSystemMute` 276, `setSystemInputMuted` 1472).

This plugin owns the flags in storage + settings, shows toggles (header button
menu, composer button, `/fakemute`, `/fakedeafen`), and on each change calls the
native `Voice.op` bridge entry with `op 4` and `self_mute` / `self_deaf`.

## Device verification needed

Confirm on an installed build:

1. `/fakemute on` → another account sees you muted, but you can still talk.
2. `/fakedeafen` → another account sees you deafened, but you can still hear.
3. The exact bridge call may need adjusting: if `Voice.op` (254) does not accept
   an op-4 payload, inspect the module with the Phoenix schema/console and try
   the `muteState` / `setSystemMute` methods (253 / 276) instead. Update
   `VOICE_MODULE` / `VOICE_OP` in `index.ts` accordingly.

If the native route cannot express a *fake* state (i.e. it also mutes local
audio), the correct Phoenix implementation requires a runtime-side patch of the
outbound voice-state frame and cannot be done from TypeScript alone. In that
case open an issue on sunbird-tools/sunbird requesting an outbound voice-state
hook.

## Install

Add the bundle banner first (bundle metadata is read from leading `// @` lines):

```
// @description Look muted or deafened to others while you can still talk and hear.
// @version 1.0.0
// @author kerizalperwastaken
```

Then bundle with `web/tools/bundle-plugins.ts` from the sunbird repo and install
the `.js` through Settings → Phoenix Unlocker → install from file/URL.
