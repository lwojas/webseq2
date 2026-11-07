# V1 architecture and feature inventory (Phase 1)

V1 is the functional reference. This is what it does, where it lives, and where its UI is coupled to it.

## Architecture

```
src/model/        pure model, no React, no webdsp     (reducer.ts, types.ts, notes.ts, composer.ts, fx.ts, instruments.ts ...)
src/audio/        the only place the model meets webdsp (transport.ts, compile.ts, playback.ts, fxChain.ts, busSync.ts, mixer.ts ...)
src/persistence/  IndexedDB project + sample store, project files, crash recovery
src/midi/         MIDI in (V2: midiInput.ts, useMidi.ts)
src/controller/   NEW in V2: useWebseq(), all state/handlers, no markup (was the body of V1's App.tsx)
src/App.tsx       V1 shell: JSX only, over useWebseq()
src/app/, src/components/   V1 UI (panels, grid, composer)
```

* **State**: one `useReducer(historyReducer)`; `project = history.present` (undo/redo wraps the project reducer, `model/history.ts`).
  Selection, view, zoom, clipboard and transport status are React state in the controller. About 120 reducer actions.
* **Audio**: `webdsp` (WASM/AudioWorklet) behind `useAudioRuntime`. `audio/compile.ts` turns notes into `ScheduledEvent`s; `Transport`
  schedules with a ~25 ms lookahead. Buses, FX chains, sends, mixer params and LFOs are pushed from `project` to the engine by sync
  effects (`busSync`, `fxChain`, `mixer`, `lfoSync`). Hosted in a plugin, `hostSync`/`nativeSequence` hand the song to the host.
* **Playhead**: never React state. `usePlayheadAnimation` / `RafText` read `Transport` from a `requestAnimationFrame` loop and write
  `transform`/text directly. Meters work the same way (`useMixerMeters`). V2 keeps this rule.

## Project format (loaded unchanged by V2)

`Project { id, name, bpm, swing, beatsPerBar(16), tracks[64], patterns[], patternChain[], master, assets[], scale?, composer? }`

* 64 tracks = 4 banks x 16 (`BANK_SIZE`). Track: sample (`assetId`) **or** synth (`instrument`), FX chain, automation lanes, volume, pan,
  mute/solo, `outputTrack`, `send`, playback/voice/sample mode, choke group, envelope, event LFO, arp.
* Pattern: `bars`, `notes: Record<id, Note>` (flat, all tracks), per-pattern `trackSettings`, `automation`, `offTracks`.
* Note: `trackId, start, duration` (in 16ths), `velocity, pitch?, chord?, lfo?, ratchet?, tie?`.
* Composer: `lanes[] -> sequences[] { patternId, start (bars), color }`; lane `modifiers` (transpose/velocity/gate).
* Files: `webseq-project` envelope v1 (JSON + base64 assets). Saved projects: IndexedDB. New fields are additive; there is no migration layer.

## Feature map

| Area | V1 | Where | V2 home |
|---|---|---|---|
| Transport | play/pause/stop, BPM, swing, position readout, Pattern/Song source, resample (bounce to asset), host follow | `TransportBar` | Header transport |
| Tracks | 64 tracks / 4 banks, select, mute, solo, notes-off per pattern, manual trigger/audition | `SequencerGrid`, `TrackRow`, `BankBar` | Arrange track headers, bank filter |
| Patterns | library, queue (patternChain), duplicate, rename, bars | `PatternsView`, `PatternStrip` | Browser > Patterns; a pattern becomes a clip |
| Sequencing | step grid; add/move/resize/remove note; grid resolution; zoom | `SequencerGrid`, `NoteBlock` | **Piano roll** |
| Note data | velocity, pitch, chord, ratchet, tie, per-note LFO amount, duration | `TrackEditor` (note inspector) | Piano roll note inspector |
| Scale | project key/scale, scale-aware entry, Musical Guide + recipes | `ScaleControl`, `MusicalGuide` | Header (scale), Editor |
| Arp / Track LFO | per-track and per-pattern override | `ArpPanel`, `TrackLfoPanel` | Editor > Clip tab |
| Automation | per FX/synth param lanes, per pattern, templates | `AutomationRow`, `AutomationLane` | Editor automation lane, Device parameter |
| Instruments | 20 synth kinds, params, LFO slots, patch matrix | `InstrumentPanel`, `PatchMatrixEditor`, `ModulationSlot` | Device area |
| Samples | import/assign, envelope, gain, chop (cues), choke | `AssetsPanel`, `ChopEditor`, `InstrumentPanel` | Browser > Assets, Device area, Editor (chop) |
| FX | 13 types, ordered chain, sidechain, FX LFOs, EQ curve | `FxPanel`, `ModulePanel`, `EqCurveEditor` | Device area |
| Routing | output track, FX send + amount, master | FX panel top | Mixer (output/send per strip) |
| Mixer | volume, pan, mute, solo, meters, master limiter | `MixerPanel` | **Mixer view** |
| Arrangement | lanes of sequences, move/resize/duplicate/paste, markers, "from here", lane modifiers | `ComposerTimeline`, `ComposerDetails` | **Arrange view** |
| Clipboard | copy/paste track, sequence, instrument, FX, modulation, bank; clear, duplicate sequence/bar, extend; chop tools | `EditPanel`, `editModel.ts` | Edit menu + clip/track context actions |
| Undo/redo | whole-project history | `model/history.ts` | Header, Cmd+Z |
| Persistence | save/load/delete (IndexedDB), file export/import, crash recovery banner | `ProjectBar`, `persistence/` | Browser > Project, header |
| MIDI | keyboard plays selected track; host MIDI routing. **V1 also had Launchpad/Push control surfaces (dropped)** | `midi/` | Header MIDI toggle |
| Mobile | single-section layout, bottom tab bar | `MobileTabBar`, `layout.ts` | Not in V2 first pass (see architecture doc) |

## Where V1's UI is coupled to function

1. `App.tsx` was a 1,800-line component: state, effects, audio wiring and markup together. Now split (`useWebseq` + shells).
2. The Composer sequence plays **every track** of its pattern, so arrangement and editing are coupled to the "all tracks in one grid" pattern.
   V2 makes the clip per-track (see architecture doc).
3. Mixer, Instrument, FX, Track Editor and Edit panel all share one dock tab strip; routing lives in the FX panel.
4. The left column mixes a library (Assets), a device (MIDI) and an action list (Edit).
5. Pattern mode and Song mode are two transport sources with separate selection models (`mainView`, `selectedPatternId`, `editingSequence`).
