# MIDI

One switch. **MIDI** in the top bar turns it on; every connected MIDI input then plays the **selected track**. There is
nothing to connect, no port to pick, and no device list to maintain.

- `midi/midiInput.ts` — `connectMidi(sink)` listens on every input, now and as they are plugged in or removed, and routes
  note on/off (velocity-0 note-on is a note-off) and CC 123/120 (all notes off) to a `NoteSink`. It knows nothing about
  tracks or React and takes Web MIDI as an injected dependency, so it tests without a browser.
- `midi/useMidi.ts` — the React side: an on/off state (remembered in `localStorage`, so the browser's permission prompt
  appears once) and the connected input names. Activity is a subscription, not state: the light blinks without re-rendering.
- `components/MidiStatus.tsx` — the only MIDI UI: a toggle with a light and the input names in its tooltip.
- App wires the sink to `Playback.noteOn/noteOff` for the selected track. Select a track row (the Master strip plays nothing).

`Playback.noteOn(track, midiNote, velocity)`: samples and drums play at their own pitch from middle C (MIDI 60),
chromatically; a chop track plays slice `note - 60`; a pitched synth sounds the key itself (its root key plays its tune).
Velocity is the gain. A looping sample's voice and a held synth note end on key-up; one-shots ring out like a pad hit.

In a plugin host (`hasEmbeddedHost()`) MIDI is always on, because the host provides its MIDI without a permission prompt
("WebVST DAW MIDI" is an ordinary input). When the host can play MIDI itself (`capabilities.midiRouting`, webdsp
`docs/midi-routing.md`) the page does not play the notes: it declares a route for the selected track (`audio/midiRoute.ts`,
the same mapping as `Playback.noteOn`) and the host plays incoming notes on its audio thread, sample-accurately. The page's
own listener is suspended there so a note is never played twice.

Not forwarded: SysEx, pitch bend, sustain pedal, aftertouch, CC.

## Removed from V1

V1 also drove Launchpad and Push as control surfaces through `midi-core` (step pads, faders, encoders, LED feedback, a
manual connect panel). V2 drops that: it was ~2,200 lines for two devices, with its own connect flow, and none of the
musical data depends on it. The `midi-core` dependency is gone. V1 still has it.
