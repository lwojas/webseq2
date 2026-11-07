import { describe, expect, it, vi } from "vitest";
import type { AudioRuntime, BusId, InstrumentNoteParams, TriggerParams, VoiceHandle } from "webdsp";
import { MIDI_UNITY_NOTE, Playback } from "../src/audio/playback";
import { addAsset, assignAsset, createInitialProject, setTrackPlaybackMode } from "../src/model/project";
import { syncBuses } from "../src/audio/busSync";
import { setTrackInstrument } from "../src/model/instruments";
import { mockRuntime } from "./mockRuntime";
import type { Asset } from "../src/model/types";
import { trackById } from "../src/model/types";

describe("Playback key methods", () => {
  function setup() {
    let nextHandle = 1;
    const triggered: TriggerParams[] = [];
    const released: VoiceHandle[] = [];
    const notes: { id: number; params: InstrumentNoteParams }[] = [];
    const noteOffs: number[] = [];
    const runtime = {
      trigger: vi.fn((p: TriggerParams) => (triggered.push(p), nextHandle++)),
      release: vi.fn((h: VoiceHandle) => released.push(h)),
      onVoiceEnded: vi.fn(() => () => {}),
      instrumentNoteOn: vi.fn((id: number, params: InstrumentNoteParams) => notes.push({ id, params })),
      instrumentNoteOff: vi.fn((id: number) => noteOffs.push(id)),
      getCapabilities: vi.fn(() => ({ instruments: [] })),
    } as unknown as AudioRuntime;
    const busFor = (): BusId => 10;
    const playback = new Playback(runtime, busFor, () => false);
    let project = createInitialProject();
    project = addAsset(project, { id: 1, name: "k.wav", type: "audio", duration: 1, sampleRate: 48000, channels: 2, origin: "import" } as Asset);
    project = assignAsset(project, "track-1", 1);
    return { playback, project, triggered, released, notes, noteOffs, runtime };
  }

  it("plays a sample track chromatically, middle C at its own pitch, velocity as gain", () => {
    const { playback, project, triggered } = setup();
    const track = trackById(project, "track-1")!;
    expect(playback.noteOn(track, MIDI_UNITY_NOTE, 1)).toBe(true);
    expect(playback.noteOn(track, MIDI_UNITY_NOTE + 7, 0.5)).toBe(true);
    expect(triggered[0]).toMatchObject({ sampleId: 1, bus: 10, gain: 1 });
    expect(triggered[0].pitch).toBeUndefined();
    expect(triggered[1]).toMatchObject({ gain: 0.5, pitch: 7 });
  });

  it("releases a looping track's voice on key-up but lets a one-shot ring out", () => {
    const { playback, project, released } = setup();
    const oneShot = trackById(project, "track-1")!;
    playback.noteOn(oneShot, 60, 1);
    playback.noteOff(oneShot, 60);
    expect(released).toEqual([]);

    const looping = trackById(setTrackPlaybackMode(project, "track-1", "loop"), "track-1")!;
    playback.noteOn(looping, 62, 1);
    playback.noteOff(looping, 62);
    expect(released).toHaveLength(1);
  });

  it("is refused while a resample is capturing", () => {
    const fake = setup();
    const busy = new Playback(fake.runtime, () => 10, () => true);
    expect(busy.noteOn(trackById(fake.project, "track-1")!, 60, 1)).toBe(false);
  });
});

describe("Playback key methods on synth tracks", () => {
  const buses = Object.fromEntries(Array.from({ length: 64 }, (_, i) => [`track-${i + 1}`, i + 1]));

  it("plays a drum from middle C and a pitched synth on the key itself, and sends note-off for the held key only", () => {
    const { runtime, calls } = mockRuntime();
    let project = setTrackInstrument(createInitialProject(), "track-1", "kick");
    project = setTrackInstrument(project, "track-2", "bass");
    syncBuses(runtime, project, buses);
    (runtime as unknown as { onVoiceEnded: () => () => void }).onVoiceEnded = () => () => {};
    const playback = new Playback(runtime, (id) => buses[id as keyof typeof buses], () => false);

    const kick = trackById(project, "track-1")!;
    expect(playback.noteOn(kick, 60, 1)).toBe(true);
    expect(calls.instrumentNoteOn[0][1].pitch).toBeUndefined(); // middle C = the kick as tuned
    playback.noteOn(kick, 62, 1);
    expect(calls.instrumentNoteOn[1][1].pitch).toBe(2);

    const bass = trackById(project, "track-2")!;
    const rootKey = Math.round(69 + 12 * Math.log2((bass.instrument!.params.tune ?? 55) / 440));
    playback.noteOn(bass, rootKey + 5, 0.8);
    expect(calls.instrumentNoteOn[2][1]).toMatchObject({ velocity: 0.8, pitch: 5 });

    playback.noteOn(bass, rootKey + 7, 0.8); // a newer key replaces it on this monophonic track
    playback.noteOff(bass, rootKey + 5); // the older key's release must not cut the newer note
    expect(calls.instrumentNoteOff).toEqual([]);
    playback.noteOff(bass, rootKey + 7);
    expect(calls.instrumentNoteOff).toHaveLength(1);
  });
});
