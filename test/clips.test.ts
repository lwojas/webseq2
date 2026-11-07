import { describe, expect, it } from "vitest";
import { createInitialProject } from "../src/model/project";
import { addNote } from "../src/model/notes";
import { projectReducer } from "../src/model/reducer";
import { addPatternToComposer, setLaneModifiers, songInstances, addLane, composerLanes } from "../src/model/composer";
import { allClips, clipAtBar, clipById, clipsOnTrack, createClip, deleteClip, duplicateClip, hasLegacySong, insertPatternAsClips, launcherPatterns, moveClip, normaliseSong, renameClip, resizeClip, songLengthBars, trackLanes } from "../src/model/clips";
import type { Pattern, Project } from "../src/model/types";

function withNotes(project: Project, patternId: string, notes: [string, number, number?][]): Project {
  let p: Pattern = project.patterns.find((x) => x.id === patternId)!;
  for (const [trackId, start, pitch] of notes) {
    p = addNote(p, project.beatsPerBar, trackId, start);
    if (pitch !== undefined) {
      const id = Object.keys(p.notes).find((k) => p.notes[k].trackId === trackId && p.notes[k].start === start)!;
      p = { ...p, notes: { ...p.notes, [id]: { ...p.notes[id], pitch } } };
    }
  }
  return { ...project, patterns: project.patterns.map((x) => (x.id === patternId ? p : x)) };
}

describe("clips", () => {
  it("creates a clip on the track's own row, with its own empty pattern", () => {
    const made = createClip(createInitialProject(), "track-2", 4, 2)!;
    const clip = clipById(made.project, made.clipId)!;
    expect(clip).toMatchObject({ trackId: "track-2", start: 4, bars: 2 });
    expect(trackLanes(made.project, "track-2")).toHaveLength(1);
    expect(made.project.patterns.find((p) => p.id === clip.patternId)?.clipOf).toBe("track-2");
    expect(launcherPatterns(made.project).some((p) => p.id === clip.patternId)).toBe(false);
    expect(songLengthBars(made.project)).toBe(6);
  });

  it("refuses to create off the timeline and puts a clip that would overlap on an extra row of the same track", () => {
    const a = createClip(createInitialProject(), "track-1", 0, 4)!;
    expect(createClip(a.project, "track-1", -1)).toBeNull();
    const b = createClip(a.project, "track-1", 2, 2)!;
    expect(trackLanes(b.project, "track-1")).toHaveLength(2);
    expect(clipsOnTrack(b.project, "track-1").map((c) => c.start)).toEqual([0, 2]);
    expect(clipAtBar(b.project, "track-1", 0)?.start).toBe(0);
    expect(clipAtBar(b.project, "track-1", 9)).toBeUndefined();
  });

  it("moves, resizes (looping notes), renames and deletes", () => {
    let { project, clipId } = createClip(createInitialProject(), "track-1", 0, 1)!;
    const patternId = clipById(project, clipId)!.patternId;
    project = projectReducer(project, { type: "ROLL_ADD_NOTE", patternId, trackId: "track-1", start: 0, pitch: 0, duration: 4 });
    project = resizeClip(project, clipId, 2);
    expect(Object.keys(project.patterns.find((p) => p.id === patternId)!.notes)).toHaveLength(2); // repeated into bar 2
    project = moveClip(project, clipId, 3);
    expect(clipById(project, clipId)!.start).toBe(3);
    project = renameClip(project, clipId, "Hook");
    expect(clipById(project, clipId)!.name).toBe("Hook");
    expect(moveClip(project, clipId, 3)).toBe(project); // already there
  });

  it("a move that overlaps lands on an extra row, and that row goes when emptied", () => {
    const a = createClip(createInitialProject(), "track-1", 0, 2)!;
    const b = createClip(a.project, "track-1", 2, 2)!;
    const moved = moveClip(b.project, b.clipId, 1);
    expect(trackLanes(moved, "track-1")).toHaveLength(2);
    const back = moveClip(moved, b.clipId, 2);
    expect(trackLanes(back, "track-1")).toHaveLength(1);
  });

  it("duplicates with independent notes and deletes the pattern with its last clip", () => {
    let { project, clipId } = createClip(createInitialProject(), "track-1", 0, 1)!;
    const patternId = clipById(project, clipId)!.patternId;
    project = projectReducer(project, { type: "ROLL_ADD_NOTE", patternId, trackId: "track-1", start: 0, pitch: 3, duration: 2 });
    const dup = duplicateClip(project, clipId)!;
    const copy = clipById(dup.project, dup.clipId)!;
    expect(copy.start).toBe(1);
    expect(copy.patternId).not.toBe(patternId);
    expect(Object.values(dup.project.patterns.find((p) => p.id === copy.patternId)!.notes)[0].pitch).toBe(3);
    const gone = deleteClip(dup.project, dup.clipId);
    expect(gone.patterns.some((p) => p.id === copy.patternId)).toBe(false);
    expect(gone.patterns.some((p) => p.id === patternId)).toBe(true);
    expect(allClips(gone)).toHaveLength(1);
  });

  it("inserts a V1 launcher pattern as one clip per track it plays", () => {
    let project = createInitialProject();
    const id = project.patterns[0].id;
    project = withNotes(project, id, [["track-1", 0], ["track-3", 4, 5]]);
    const placed = insertPatternAsClips(project, id, 2);
    expect(allClips(placed).map((c) => [c.trackId, c.start]).sort()).toEqual([["track-1", 2], ["track-3", 2]]);
    const c3 = clipsOnTrack(placed, "track-3")[0];
    const notes = Object.values(placed.patterns.find((p) => p.id === c3.patternId)!.notes);
    expect(notes).toHaveLength(1);
    expect(notes[0]).toMatchObject({ trackId: "track-3", start: 4, pitch: 5 });
    expect(launcherPatterns(placed).map((p) => p.id)).toContain(id);
  });
});

describe("V1 pattern-mode projects", () => {
  it("lays the pattern queue out as clips so the notes show up", () => {
    let project = createInitialProject();
    const a = project.patterns[0].id;
    project = withNotes(project, a, [["track-1", 0], ["track-2", 4, 3]]);
    project = projectReducer(project, { type: "ADD_PATTERN" });
    const b = project.patterns[1].id;
    project = withNotes(project, b, [["track-1", 8]]);
    project = { ...project, patternChain: [{ id: "e1", patternId: a }, { id: "e2", patternId: b }] };
    const loaded = projectReducer(createInitialProject(), { type: "LOAD_PROJECT", project });
    expect(allClips(loaded).map((c) => [c.trackId, c.start]).sort()).toEqual([["track-1", 0], ["track-1", 1], ["track-2", 0]]);
    expect(launcherPatterns(loaded)).toHaveLength(2); // still in the Browser
    // once arranged, it is not laid out again (deleting clips in V2 stays deleted)
    const cleared = allClips(loaded).reduce((p, c) => deleteClip(p, c.id), loaded);
    expect(projectReducer(createInitialProject(), { type: "LOAD_PROJECT", project: cleared }).composer?.lanes.every((l) => l.sequences.length === 0)).toBe(true);
  });
  it("leaves an empty project empty", () => {
    expect(allClips(projectReducer(createInitialProject(), { type: "LOAD_PROJECT", project: createInitialProject() }))).toHaveLength(0);
  });
});

describe("normaliseSong (V1 songs)", () => {
  function v1Song(): Project {
    let project = createInitialProject();
    const id = project.patterns[0].id;
    project = withNotes(project, id, [["track-1", 0], ["track-1", 8], ["track-2", 4, 7]]);
    project = addPatternToComposer(project, id, null, 0);
    project = addPatternToComposer(project, id, addLaneOf(project), 0);
    return project;
  }
  function addLaneOf(project: Project): string {
    return composerLanes(project)[0]?.id ?? "";
  }

  it("leaves a project with no V1 lanes alone", () => {
    const project = createInitialProject();
    expect(normaliseSong(project)).toBe(project);
    expect(hasLegacySong(project)).toBe(false);
  });

  it("splits each sequence into per-track clips at the same bar and length", () => {
    let project = createInitialProject();
    const id = project.patterns[0].id;
    project = withNotes(project, id, [["track-1", 0], ["track-1", 8], ["track-2", 4, 7]]);
    project = addPatternToComposer(project, id, null, 2);
    expect(hasLegacySong(project)).toBe(true);
    const normal = normaliseSong(project);
    expect(hasLegacySong(normal)).toBe(false);
    expect(allClips(normal).map((c) => [c.trackId, c.start, c.bars]).sort()).toEqual([["track-1", 2, 1], ["track-2", 2, 1]]);
    // every note survives, and the V1 pattern is still in the pattern list
    const total = allClips(normal).reduce((n, c) => n + Object.keys(normal.patterns.find((p) => p.id === c.patternId)!.notes).length, 0);
    expect(total).toBe(3);
    expect(normal.patterns.some((p) => p.id === id)).toBe(true);
    // the engine still sees sequences of patterns: one instance per clip, each playing only its track
    const instances = songInstances(normal);
    expect(instances).toHaveLength(2);
    expect(instances.map((i) => [...i.noteTracks])).toEqual(expect.arrayContaining([["track-1"], ["track-2"]]));
  });

  it("turns lane modifiers into each clip's own modifiers, and the engine still plays them", () => {
    let project = createInitialProject();
    const id = project.patterns[0].id;
    project = withNotes(project, id, [["track-1", 0, 2]]);
    project = addPatternToComposer(project, id, null, 0);
    const laneId = composerLanes(project)[0].id;
    project = setLaneModifiers(project, laneId, { transpose: 5, velocity: 0.5, gate: 2 });
    const normal = normaliseSong(project);
    const clip = allClips(normal)[0];
    expect(clip.modifiers).toEqual({ transpose: 5, velocity: 0.5, gate: 2 });
    expect(composerLanes(normal).every((l) => l.trackId && !l.modifiers)).toBe(true);
    expect(songInstances(normal)[0].modifiers).toEqual({ transpose: 5, velocity: 0.5, gate: 2 });
    // adjusting and clearing it
    const tweaked = projectReducer(normal, { type: "CLIP_SET_MODIFIERS", sequenceId: clip.id, patch: { transpose: -3 } });
    expect(songInstances(tweaked)[0].modifiers.transpose).toBe(-3);
    const cleared = projectReducer(tweaked, { type: "CLIP_SET_MODIFIERS", sequenceId: clip.id, patch: { transpose: 0, velocity: 1, gate: 1 } });
    expect(clipById(cleared, clip.id)!.modifiers).toBeUndefined();
    // copies keep them
    const dup = duplicateClip(normal, clip.id)!;
    expect(clipById(dup.project, dup.clipId)!.modifiers).toEqual(clip.modifiers);
  });

  it("two V1 sequences overlapping on one track keep both clips (an extra row)", () => {
    let project = createInitialProject();
    const id = project.patterns[0].id;
    project = withNotes(project, id, [["track-1", 0]]);
    project = addPatternToComposer(project, id, null, 0);
    project = projectReducer(project, { type: "COMPOSER_ADD_LANE" });
    const second = composerLanes(project)[1].id;
    project = addPatternToComposer(project, id, second, 0);
    const normal = normaliseSong(project);
    expect(clipsOnTrack(normal, "track-1")).toHaveLength(2);
    expect(trackLanes(normal, "track-1")).toHaveLength(2);
  });

  it("is what LOAD_PROJECT does, and is idempotent", () => {
    void v1Song;
    void addLane;
    let project = createInitialProject();
    const id = project.patterns[0].id;
    project = withNotes(project, id, [["track-1", 0]]);
    project = addPatternToComposer(project, id, null, 0);
    const loaded = projectReducer(createInitialProject(), { type: "LOAD_PROJECT", project });
    expect(allClips(loaded)).toHaveLength(1);
    expect(normaliseSong(loaded)).toBe(loaded);
  });
});

import { clearClip, copyBankData, copyClip, copyTrackData, pasteBankData, pasteClip, pasteTrackData } from "../src/model/clips";
import { setTrackInstrument } from "../src/model/instruments";
import { rollCopyNotes, rollPasteNotes, rollAddNote } from "../src/model/roll";

describe("copy / paste", () => {
  function song() {
    let { project, clipId } = createClip(createInitialProject(), "track-1", 0, 2, "Hook")!;
    const patternId = clipById(project, clipId)!.patternId;
    project = projectReducer(project, { type: "ROLL_ADD_NOTE", patternId, trackId: "track-1", start: 4, pitch: 5, duration: 2 });
    return { project, clipId };
  }

  it("copies a clip and pastes it on another track at the first free bar", () => {
    const { project, clipId } = song();
    const data = copyClip(project, clipId)!;
    expect(data).toMatchObject({ name: "Hook", bars: 2 });
    const pasted = pasteClip(project, data, "track-2", 3)!;
    const c = clipById(pasted.project, pasted.clipId)!;
    expect(c).toMatchObject({ trackId: "track-2", start: 3, bars: 2 });
    const note = Object.values(pasted.project.patterns.find((p) => p.id === c.patternId)!.notes)[0];
    expect(note).toMatchObject({ trackId: "track-2", start: 4, pitch: 5 });
    // pasting over an occupied spot goes after it
    const again = pasteClip(pasted.project, data, "track-2", 3)!;
    expect(clipById(again.project, again.clipId)!.start).toBe(5);
  });

  it("pastes a track: config and clips replace the target's", () => {
    let { project } = song();
    project = setTrackInstrument(project, "track-1", "bass");
    const data = copyTrackData(project, "track-1")!;
    let target = createClip(project, "track-3", 0, 1)!.project;
    target = pasteTrackData(target, "track-3", data);
    expect(target.tracks.find((t) => t.id === "track-3")!.instrument?.kind).toBe("bass");
    expect(clipsOnTrack(target, "track-3").map((c) => [c.start, c.bars])).toEqual([[0, 2]]);
    expect(clipsOnTrack(target, "track-1")).toHaveLength(1); // the source is untouched
  });

  it("pastes a bank track for track", () => {
    let { project } = song();
    project = setTrackInstrument(project, "track-1", "kick");
    const data = copyBankData(project, 0);
    expect(data.tracks).toHaveLength(16);
    const out = pasteBankData(project, 1, data);
    expect(out.tracks[16].instrument?.kind).toBe("kick");
    expect(clipsOnTrack(out, "track-17")).toHaveLength(1);
    expect(clipsOnTrack(out, "track-1")).toHaveLength(1);
  });

  it("clears a clip's notes but keeps the clip", () => {
    const { project, clipId } = song();
    const cleared = clearClip(project, clipId);
    expect(clipById(cleared, clipId)).toBeDefined();
    expect(copyClip(cleared, clipId)!.notes).toHaveLength(0);
  });

  it("copies notes relative to the earliest and pastes them, skipping what does not fit", () => {
    let p: Pattern = { id: "p", name: "p", bars: 1, notes: {} };
    p = rollAddNote(p, 16, "t", 2, 0, 2);
    p = rollAddNote(p, 16, "t", 6, 3, 2);
    const copied = rollCopyNotes(p, Object.keys(p.notes));
    expect(copied.map((n) => n.start).sort()).toEqual([0, 4]);
    const out = rollPasteNotes(p, 16, "u", copied, 11);
    expect(out.ids).toHaveLength(1); // the second would run past beat 16
    expect(Object.values(out.pattern.notes).find((n) => n.id === out.ids[0])).toMatchObject({ trackId: "u", start: 11 });
    expect(rollPasteNotes(p, 16, "t", copied, 2).ids).toHaveLength(0); // lands on its own originals
  });
});
