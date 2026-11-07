import { describe, expect, it } from "vitest";
import { rollAddNote, rollDuplicateNotes, rollMoveNotes, rollRemoveNotes, rollResizeNote, rollSetVelocity } from "../src/model/roll";
import type { Pattern } from "../src/model/types";

const BPB = 16;
const empty = (): Pattern => ({ id: "p", name: "p", bars: 1, notes: {} });
const ids = (p: Pattern) => Object.keys(p.notes);

describe("piano roll note ops", () => {
  it("allows overlapping notes of different pitch (polyphony) but not the same pitch", () => {
    let p = rollAddNote(empty(), BPB, "t", 0, 0, 4);
    p = rollAddNote(p, BPB, "t", 2, 4, 4); // different pitch, overlaps in time: ok
    expect(ids(p)).toHaveLength(2);
    expect(rollAddNote(p, BPB, "t", 2, 0, 1)).toBe(p); // same pitch as the first, overlapping
    expect(rollAddNote(p, BPB, "t", 4, 0, 1)).not.toBe(p); // same pitch, after it ends
  });

  it("stores pitch 0 as absent and clamps pitch and length to the pattern", () => {
    const p = rollAddNote(empty(), BPB, "t", 14, 0, 8, 2);
    const note = Object.values(p.notes)[0];
    expect(note.pitch).toBeUndefined();
    expect(note.duration).toBe(2);
    expect(note.velocity).toBe(1);
    expect(Object.values(rollAddNote(empty(), BPB, "t", 0, 99, 1).notes)[0].pitch).toBe(48);
    expect(rollAddNote(empty(), BPB, "t", 16, 0, 1)).toEqual(empty());
  });

  it("moves a group in time and pitch together, all or nothing", () => {
    let p = rollAddNote(empty(), BPB, "t", 0, 0, 2);
    p = rollAddNote(p, BPB, "t", 4, 2, 2);
    const [a, b] = ids(p);
    const moved = rollMoveNotes(p, BPB, [a, b], 2, 3);
    expect(moved.notes[a]).toMatchObject({ start: 2, pitch: 3 });
    expect(moved.notes[b]).toMatchObject({ start: 6, pitch: 5 });
    expect(rollMoveNotes(p, BPB, [a, b], 11, 0)).toBe(p); // b would leave the pattern
    expect(rollMoveNotes(p, BPB, [a, b], -1, 0)).toBe(p); // a would start before 0
    let q = rollAddNote(p, BPB, "t", 8, 0, 2);
    const c = ids(q)[2];
    expect(rollMoveNotes(q, BPB, [c], -4, 0, 1).notes[c].start).toBe(4);
    q = rollAddNote(q, BPB, "t", 6, 1, 1);
    expect(rollMoveNotes(q, BPB, [a], 8, 0)).toBe(q); // lands on the same-pitch note at 8
  });

  it("resizes up to the next same-pitch note, ignoring other pitches", () => {
    let p = rollAddNote(empty(), BPB, "t", 0, 0, 1);
    p = rollAddNote(p, BPB, "t", 4, 0, 1);
    p = rollAddNote(p, BPB, "t", 2, 5, 1);
    const [first] = ids(p);
    expect(rollResizeNote(p, BPB, first, 10).notes[first].duration).toBe(4);
    const q = rollResizeNote(rollAddNote(empty(), BPB, "t", 0, 0, 1), BPB, ids(rollAddNote(empty(), BPB, "t", 0, 0, 1))[0], 99);
    expect(Object.values(q.notes)).toHaveLength(1);
  });

  it("removes, sets velocity, duplicates", () => {
    let p = rollAddNote(empty(), BPB, "t", 0, 0, 2);
    p = rollAddNote(p, BPB, "t", 4, 0, 2);
    const [a, b] = ids(p);
    expect(rollSetVelocity(p, [a], 0.25).notes[a].velocity).toBe(0.25);
    const dup = rollDuplicateNotes(p, BPB, [a, b], 8);
    expect(dup.ids).toHaveLength(2);
    expect(ids(dup.pattern)).toHaveLength(4);
    expect(rollDuplicateNotes(p, BPB, [a, b], 11).ids).toHaveLength(1); // the copy of b would run past the end
    expect(ids(rollRemoveNotes(p, [a]))).toEqual([b]);
  });
});
