import { describe, expect, it } from "vitest";
import { createNoteRecorder, type RecordedNote } from "../src/v2/recorder";

function setup(total = 16) {
  let beat: number | null = 0;
  const notes: RecordedNote[] = [];
  const rec = createNoteRecorder({ getBeat: () => beat, total: () => total, snap: () => 1, pitchOf: (m) => m - 60, onNote: (n) => notes.push(n) });
  return { rec, notes, at: (b: number | null) => (beat = b) };
}

describe("note recorder", () => {
  it("records a key as a note from press to release, snapped, with velocity and pitch", () => {
    const { rec, notes, at } = setup();
    at(2.2);
    rec.noteOn(64, 0.5);
    at(5.4);
    rec.noteOff(64);
    expect(notes).toEqual([{ start: 2, duration: 3, pitch: 4, velocity: 0.5 }]);
  });
  it("ignores keys while the clip is not sounding, and a release it never saw", () => {
    const { rec, notes, at } = setup();
    at(null);
    rec.noteOn(60, 1);
    at(3);
    rec.noteOff(60);
    rec.noteOff(61);
    expect(notes).toEqual([]);
  });
  it("runs a note to the clip's end when the key is released after the loop wrapped", () => {
    const { rec, notes, at } = setup(16);
    at(14);
    rec.noteOn(60, 1);
    at(1);
    rec.noteOff(60);
    expect(notes[0]).toMatchObject({ start: 14, duration: 2 });
  });
  it("keeps a minimum length of one grid step and a start inside the clip", () => {
    const { rec, notes, at } = setup(16);
    at(15.9);
    rec.noteOn(60, 1);
    rec.noteOff(60);
    expect(notes[0].start).toBe(15);
    expect(notes[0].duration).toBeGreaterThanOrEqual(1);
  });
  it("allNotesOff drops held keys without writing them", () => {
    const { rec, notes } = setup();
    rec.noteOn(60, 1);
    rec.allNotesOff();
    rec.noteOff(60);
    expect(notes).toEqual([]);
  });
});
