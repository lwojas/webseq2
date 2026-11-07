# V2 status

Run: `npm run dev` -> V2. `?ui=v1` opens the V1 shell over the same controller (kept as the functional reference).
Verify: `npx tsc --noEmit && npx vitest run && npx vite build` (733 tests).

## Done
* Controller extracted from V1's `App.tsx` (`src/controller/useWebseq.tsx`); V1 shell is JSX only. No audio/DSP/persistence code changed.
* MIDI simplified: one toggle, every input plays the selected track (`docs/midi.md`). Launchpad/Push control surfaces and `midi-core` removed.
* Clip model on top of the Composer (`model/clips.ts`, lane `trackId`, `Pattern.clipOf`), V1 song normalisation on load, 14 new reducer actions, undo coverage, tests.
* Polyphonic note ops for the piano roll (`model/roll.ts`), tests.
* Shell (`src/v2/`): header + transport, resizable/collapsible browser and device area, Arrange, Editor (canvas piano roll, velocity lane,
  inspector reusing V1's NoteCard / Arp / Track LFO panels), Mixer (levels, pan, M/S, output, send, meters, limiter), Device area (V1's
  Instrument and FX panels), Browser (projects, samples, instruments, effects, V1 patterns).

## Copy / paste (done)
* Clips: Copy/Paste buttons and ⌘C/X/V in Arrange (paste on the selected track at the marker or after the selected clip; any track).
* Notes: ⌘C/X/V/D in the piano roll (paste at the last clicked beat, then end to end).
* Track (sound + FX + modulation + clips), Instrument, FX, Modulation, Bank: Device area "Copy / Paste" menu; Bank also in Arrange when a bank is shown.
  Track and Bank are clip-aware (`model/clips.ts`), unlike V1's, which wrote notes into the selected pattern.
* Bar tools: Editor "Clip tools" (clear, double, duplicate bar, repeat last bar) guarded so a clip cannot grow into the next one; chop fills on chop tracks.
  Browser-tested for clip/note paste and the menus; Track/Bank paste is unit-tested only.

## Parity gaps closed (second pass)
* **Per-clip automation**: the Editor has an automation strip under the velocity lane, aligned with the roll. The picker lists this clip's
  lanes and every automatable parameter of the source and each FX; an edit lands on the clip's own pattern, "Use track's" drops it. Lanes
  are added from there or from the Device area's parameter badges. Clips copy/paste/duplicate with their automation.
* **Clip modifiers** (transpose / velocity / gate): per clip, adjustable in the Editor inspector; `ComposerSequence.modifiers` stacks on
  the lane's in `songInstances`, so playback and the host export see them. V1 lane modifiers become each clip's own on import (no longer baked).
* **Pattern queue**: Browser > Patterns (Queue, Edit, Insert, delete, + Pattern) and Browser > Queue (play/back to song, reorder, remove);
  a Queue badge in the header while the queue plays. A launcher pattern can be edited directly in the Editor, one track at a time.
* **MIDI recording**: Editor "● Rec" records the keyboard into the clip while the song plays through it (`v2/recorder.ts`, tested).
* **Routing** only in the Mixer (V1's FX-panel Output/Send row is hidden in V2).
* **Chords** draw their tones on their own rows in the roll.
* **Compact mode** (< 960 px): browser drawer, secondary controls hidden, inspector overlay.

## Still not done
* Not verified in a real browser: MIDI recording from hardware (headless has no MIDI; the logic is unit-tested), plugin-host mode,
  V1 file import through the UI, Musical Guide from V2, Track/Bank paste.
* Master automation of V1 sequences rides on the first clip created from a sequence; its timing follows the top-most lane.
* Track-level automation replays at the start of any clip (V1 did so at the start of any sequence).
* Phones: compact mode is for narrow desktop windows; touch editing of the roll/timeline is not designed. Use `?ui=v1` on a phone.
* Automation is not drawn on the arrangement (only a clip's contents preview).
* The `ui-audit` pass CLAUDE.md asks for after component edits was not run (V1 files touched: MidiStatus, TrackEditor exports, FxPanel `hideRouting`).
