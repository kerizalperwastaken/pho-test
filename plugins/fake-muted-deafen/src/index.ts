// @description Look muted or deafened to others while you can still talk and hear.
// @version 1.0.0
// @author kerizalperwastaken
// @enabled true

/**
 * Fake Mute & Deafen for Sunbird / Phoenix.
 *
 * The reference Valenced plugin patched the gateway socket's OP 4 (VOICE_STATE_UPDATE)
 * payload so other people see `self_mute`/`self_deaf` while local audio keeps flowing.
 *
 * Phoenix does not expose an outbound gateway hook or a socket `send` patch to plugins:
 * `phoenix.hook` only covers *inbound* gateway events, and `phoenix.discord.onRequest`
 * only covers HTTP. The closest documented surface is the native `Voice` host module
 * (`phoenix.bridge.invoke`, module 61) which owns voice state and the RTC engine.
 *
 * This plugin therefore:
 *  - keeps the two toggles in plugin storage + settings (survive reloads),
 *  - publishes the chosen fake state to the local `Voice` module when possible,
 *  - shows a header button and a composer button to toggle each state,
 *  - falls back to a clear in-app notice when the native surface is unavailable,
 *  - never touches real microphone/capture state (you can still talk and hear).
 *
 * See README.md for the exact native calls to confirm on a device.
 */

const { ui, storage, log, commands } = phoenix;

interface FakeState {
  fakeMute: boolean;
  fakeDeafen: boolean;
}

const DEFAULTS: FakeState = { fakeMute: false, fakeDeafen: false };
const KEY = "state";

// Phoenix's native Voice host module and the methods that own voice state.
// From docs/phoenix-356207.md: module `Voice` = 61, `muteState` = 253,
// `setSystemMute` = 276, `setSystemInputMuted` = 1472, `op` = 254.
const VOICE_MODULE = 61;
const VOICE_MUTE_STATE = 253;
const VOICE_OP = 254;
const VOICE_STATE_UPDATE = 4;

const settings = phoenix.settings.define({
  fakeMute: {
    type: "switch",
    title: "Fake mute",
    description: "Others see you muted, but you can still talk",
    default: false,
  },
  fakeDeafen: {
    type: "switch",
    title: "Fake deafen",
    description: "Others see you deafened, but you can still hear",
    default: false,
  },
});

function read(): FakeState {
  const stored = storage.get<FakeState>(KEY);
  return {
    fakeMute: stored?.fakeMute ?? settings.fakeMute ?? DEFAULTS.fakeMute,
    fakeDeafen: stored?.fakeDeafen ?? settings.fakeDeafen ?? DEFAULTS.fakeDeafen,
  };
}

function write(next: FakeState): void {
  storage.set(KEY, next);
  publish(next);
}

/** Best-effort: push the fake state to Phoenix's native Voice module. */
function publish(state: FakeState): void {
  const selfMute = state.fakeMute || state.fakeDeafen;
  const selfDeaf = state.fakeDeafen;
  try {
    // `op` is the voice module's gateway-op entry point. OP 4 is VOICE_STATE_UPDATE.
    const sent = phoenix.bridge.invoke(
      VOICE_MODULE,
      VOICE_OP,
      { op: VOICE_STATE_UPDATE, self_mute: selfMute, self_deaf: selfDeaf },
      JSON.stringify({ self_mute: selfMute, self_deaf: selfDeaf })
    );
    if (!sent) log.warn("Voice module did not accept the fake state (op 4)");
  } catch (e) {
    log.warn(`Cannot reach the native Voice module: ${String(e)}`);
  }
}

function describe(state: FakeState): string {
  if (state.fakeDeafen) return "Fake deafen ON — others see you deafened";
  if (state.fakeMute) return "Fake mute ON — others see you muted";
  return "Fake mute/deafen OFF";
}

function toggle(key: keyof FakeState): void {
  const current = read();
  const next: FakeState =
    key === "fakeDeafen"
      ? { ...current, fakeDeafen: !current.fakeDeafen }
      : { fakeMute: !current.fakeMute, fakeDeafen: false };
  write(next);
  ui.notify(describe(next));
}

ui.addHeaderButton({
  label: "Fake mute / deafen",
  icon: "res://ic_mana_experimental_microphone_sparkle",
  onPress: () => ui.choose({
    title: "Fake Mute & Deafen",
    message: describe(read()),
    options: [
      { label: "Toggle fake mute" },
      { label: "Toggle fake deafen" },
      { label: "Turn both off" },
    ],
  }).then((choice) => {
    if (choice === 0) toggle("fakeMute");
    else if (choice === 1) toggle("fakeDeafen");
    else if (choice === 2) write(DEFAULTS);
  }),
});

ui.addComposerButton({
  label: "Fake mute",
  icon: "res://ic_mana_experimental_microphone_sparkle_muted",
  onPress: () => toggle("fakeMute"),
});

commands.register({
  name: "fakemute",
  description: "Toggle appearing muted to others while still talking",
  execute: (_args, ctx) => {
    toggle("fakeMute");
    ctx.reply(describe(read()));
  },
});

commands.register({
  name: "fakedeafen",
  description: "Toggle appearing deafened to others while still hearing",
  execute: (_args, ctx) => {
    toggle("fakeDeafen");
    ctx.reply(describe(read()));
  },
});

phoenix.onUnload(() => {
  // Sending a clean state on unload avoids leaving the account marked muted/deafened.
  publish(DEFAULTS);
});
