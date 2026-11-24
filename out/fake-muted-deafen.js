// @description Look muted or deafened to others while you can still talk and hear.
// @version 1.0.0
// @author kerizalperwastaken
// @enabled true
(() => {
  // fake-muted-deafen/src/index.ts
  var { ui, storage, log } = phoenix;
  var DEFAULTS = { fakeMute: false, fakeDeafen: false };
  var KEY = "state";
  var VOICE_MODULE = 61;
  var VOICE_OP = 254;
  var VOICE_STATE_UPDATE = 4;
  var settings = phoenix.settings.define({
    fakeMute: {
      type: "switch",
      title: "Fake mute",
      description: "Others see you muted, but you can still talk",
      default: false
    },
    fakeDeafen: {
      type: "switch",
      title: "Fake deafen",
      description: "Others see you deafened, but you can still hear",
      default: false
    }
  });
  function read() {
    const stored = storage.get(KEY);
    return {
      fakeMute: stored?.fakeMute ?? settings.fakeMute ?? DEFAULTS.fakeMute,
      fakeDeafen: stored?.fakeDeafen ?? settings.fakeDeafen ?? DEFAULTS.fakeDeafen
    };
  }
  function write(next) {
    storage.set(KEY, next);
    publish(next);
  }
  function publish(state) {
    const selfMute = state.fakeMute || state.fakeDeafen;
    const selfDeaf = state.fakeDeafen;
    try {
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
  function notify(message, title = "Fake Mute & Deafen") {
    ui.notify({ title, body: message, durationMs: 3e3 });
  }
  function describe(state) {
    if (state.fakeDeafen) return "Fake deafen ON \u2014 others see you deafened";
    if (state.fakeMute) return "Fake mute ON \u2014 others see you muted";
    return "Fake mute/deafen OFF";
  }
  function toggle(key) {
    const current = read();
    const next = key === "fakeDeafen" ? { ...current, fakeDeafen: !current.fakeDeafen } : { fakeMute: !current.fakeMute, fakeDeafen: false };
    write(next);
    notify(describe(next));
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
        { label: "Turn both off" }
      ]
    }).then((choice) => {
      if (choice === 0) toggle("fakeMute");
      else if (choice === 1) toggle("fakeDeafen");
      else if (choice === 2) write(DEFAULTS);
    })
  });
  ui.addComposerButton({
    label: "Fake mute",
    icon: "res://ic_mana_experimental_microphone_sparkle_muted",
    onPress: () => toggle("fakeMute")
  });
  phoenix.onUnload(() => {
    publish(DEFAULTS);
  });
})();
