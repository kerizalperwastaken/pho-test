# sunbird-fakemutedeafen

Sunbird / Phoenix plugin: **appear muted or deafened to others while you can still talk and hear.**

Port of [ValencedPlugins/fakemutedeafen](https://github.com/il1ll/ValencedPlugins/tree/main/plugins/fakemutedeafen) to the [sunbird](https://github.com/sunbird-tools/sunbird) Phoenix plugin runtime.

## Layout

```
plugins/fake-muted-deafen/src/index.ts   # the plugin (thin TypeScript over `phoenix`)
plugins/fake-muted-deafen/README.md      # native-bridge notes + device test plan
```

## Status

The flags, settings and UI are complete. The one thing that needs a real device
to confirm is the outbound voice-state write: Phoenix has no documented outbound
gateway hook, so the plugin calls the native `Voice` host module through
`phoenix.bridge.invoke`. See `plugins/fake-muted-deafen/README.md` for the exact
methods and the fallback plan.

## Build / install

Bundle `index.ts` with `web/tools/bundle-plugins.ts` from the sunbird repo, then
install the resulting `.js` via Settings → Phoenix Unlocker in the patched Discord.
