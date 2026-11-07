// Note editing for the piano roll. V1's grid keeps one note per track at a time (a track is a monophonic lane; chords are a note
// mode). A piano roll is polyphonic, so these operations use a pitch-aware rule instead: notes may overlap in time unless they
// are the same pitch. They only add and move notes within the Note shape V1 already stores (start, duration, velocity, pitch), so
// V1 files stay valid and the playback compiler (which schedules each note on its own) needs no change.
//
// A note's `pitch` is semitones above the track's own pitch, the same value V1's Pitch dropdown set. A chord note sounds a shape of
// pitches at once; here it occupies the single slot "chord" so it never collides with a plain note of another pitch.
import { MAX_NOTE_PITCH, MIN_NOTE_DURATION, MIN_NOTE_PITCH, quantizeToResolution } from "./notes";
import type { Note, NoteId, Pattern, TrackId } from "./types";
import { totalBeats } from "./types";

let idCounter = 0;
function uid(): string {
  idCounter += 1;
  return `note-${idCounter}-${Math.random().toString(36).slice(2, 8)}`;
}

/** The slot a note occupies for overlap purposes: its pitch, or "chord". */
export function rollSlot(note: Pick<Note, "pitch" | "chord">): string {
  return note.chord ? "chord" : String(note.pitch ?? 0);
}

function collides(pattern: Pattern, trackId: TrackId, slot: string, start: number, duration: number, ignore: ReadonlySet<NoteId>): boolean {
  const end = start + duration;
  for (const other of Object.values(pattern.notes)) {
    if (other.trackId !== trackId || ignore.has(other.id) || rollSlot(other) !== slot) continue;
    if (start < other.start + other.duration && other.start < end) return true;
  }
  return false;
}

const clampPitch = (pitch: number) => Math.min(MAX_NOTE_PITCH, Math.max(MIN_NOTE_PITCH, Math.round(pitch)));

/** Adds a note. Unchanged if it would overlap a note of the same pitch or leave the pattern. */
export function rollAddNote(pattern: Pattern, beatsPerBar: number, trackId: TrackId, start: number, pitch: number, duration: number, velocity = 0.8, resolution = 1): Pattern {
  const total = totalBeats(pattern, beatsPerBar);
  const s = Math.max(0, quantizeToResolution(start, resolution));
  const d = Math.max(MIN_NOTE_DURATION, Math.min(duration, total - s));
  const p = clampPitch(pitch);
  if (s >= total || collides(pattern, trackId, String(p), s, d, new Set())) return pattern;
  const id = uid();
  const note: Note = { id, trackId, start: s, duration: d, velocity: Math.min(1, Math.max(0, velocity)), ...(p !== 0 ? { pitch: p } : {}) };
  return { ...pattern, notes: { ...pattern.notes, [id]: note } };
}

/** Moves the notes by `dStart` beats and `dPitch` semitones together. All or nothing: unchanged if any would leave the pattern or
 * land on a same-pitch note that is not part of the move. Chord notes move in time only. */
export function rollMoveNotes(pattern: Pattern, beatsPerBar: number, noteIds: readonly NoteId[], dStart: number, dPitch: number, resolution = 1): Pattern {
  const total = totalBeats(pattern, beatsPerBar);
  const moving = new Set(noteIds);
  const step = quantizeToResolution(dStart, resolution);
  const next: Record<NoteId, Note> = {};
  for (const id of noteIds) {
    const note = pattern.notes[id];
    if (!note) continue;
    const start = note.start + step;
    if (start < 0 || start + note.duration > total) return pattern;
    const pitch = note.chord ? undefined : clampPitch((note.pitch ?? 0) + dPitch);
    const moved: Note = { ...note, start };
    if (!note.chord) {
      delete moved.pitch;
      if (pitch !== 0) moved.pitch = pitch;
    }
    if (collides(pattern, note.trackId, rollSlot(moved), moved.start, moved.duration, moving)) return pattern;
    next[id] = moved;
  }
  // Moved notes must not collide with each other either (they keep their relative positions, so only a pitch clamp could cause it).
  const list = Object.values(next);
  for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) {
    const a = list[i], b = list[j];
    if (a.trackId === b.trackId && rollSlot(a) === rollSlot(b) && a.start < b.start + b.duration && b.start < a.start + a.duration) return pattern;
  }
  if (list.length === 0 || (step === 0 && dPitch === 0)) return pattern;
  return { ...pattern, notes: { ...pattern.notes, ...next } };
}

/** Sets a note's length, snapped to `resolution`, up to the next same-pitch note or the pattern end. */
export function rollResizeNote(pattern: Pattern, beatsPerBar: number, noteId: NoteId, duration: number, resolution = 1): Pattern {
  const note = pattern.notes[noteId];
  if (!note) return pattern;
  const total = totalBeats(pattern, beatsPerBar);
  let max = total - note.start;
  const slot = rollSlot(note);
  for (const other of Object.values(pattern.notes)) {
    if (other.id === noteId || other.trackId !== note.trackId || rollSlot(other) !== slot || other.start < note.start + MIN_NOTE_DURATION) continue;
    max = Math.min(max, other.start - note.start);
  }
  const d = Math.max(MIN_NOTE_DURATION, Math.min(max, quantizeToResolution(duration, resolution)));
  if (d === note.duration) return pattern;
  return { ...pattern, notes: { ...pattern.notes, [noteId]: { ...note, duration: d } } };
}

export function rollRemoveNotes(pattern: Pattern, noteIds: readonly NoteId[]): Pattern {
  if (!noteIds.some((id) => id in pattern.notes)) return pattern;
  const notes = { ...pattern.notes };
  for (const id of noteIds) delete notes[id];
  return { ...pattern, notes };
}

/** Sets the velocity of every listed note (0..1). */
export function rollSetVelocity(pattern: Pattern, noteIds: readonly NoteId[], velocity: number): Pattern {
  const v = Math.min(1, Math.max(0, velocity));
  let notes = pattern.notes;
  for (const id of noteIds) {
    const note = notes[id];
    if (note && note.velocity !== v) notes = { ...notes, [id]: { ...note, velocity: v } };
  }
  return notes === pattern.notes ? pattern : { ...pattern, notes };
}

/** Copies of `noteIds` shifted by `dStart` beats (Cmd+D / paste). Copies that would collide or leave the pattern are skipped. */
export function rollDuplicateNotes(pattern: Pattern, beatsPerBar: number, noteIds: readonly NoteId[], dStart: number): { pattern: Pattern; ids: NoteId[] } {
  const total = totalBeats(pattern, beatsPerBar);
  let next = pattern;
  const ids: NoteId[] = [];
  for (const id of noteIds) {
    const note = pattern.notes[id];
    if (!note) continue;
    const start = note.start + dStart;
    if (start < 0 || start + note.duration > total || collides(next, note.trackId, rollSlot(note), start, note.duration, new Set())) continue;
    const copy: Note = { ...note, id: uid(), start };
    next = { ...next, notes: { ...next.notes, [copy.id]: copy } };
    ids.push(copy.id);
  }
  return { pattern: next, ids };
}

/** Notes as they sit on the clipboard: start relative to the earliest copied note. */
export interface CopiedRollNote {
  start: number;
  duration: number;
  velocity: number;
  pitch?: number;
  chord?: Note["chord"];
  lfo?: number;
  ratchet?: number;
  tie?: boolean;
}

export function rollCopyNotes(pattern: Pattern, noteIds: readonly NoteId[]): CopiedRollNote[] {
  const picked = noteIds.map((id) => pattern.notes[id]).filter((n): n is Note => !!n);
  if (picked.length === 0) return [];
  const origin = Math.min(...picked.map((n) => n.start));
  return picked.map(({ id: _id, trackId: _t, start, ...rest }) => ({ ...rest, start: start - origin }));
}

/** Pastes copied notes with the earliest at beat `at` (snapped). Notes that would leave the pattern or land on a same-pitch note are
 * skipped. */
export function rollPasteNotes(pattern: Pattern, beatsPerBar: number, trackId: TrackId, notes: readonly CopiedRollNote[], at: number, resolution = 1): { pattern: Pattern; ids: NoteId[] } {
  const total = totalBeats(pattern, beatsPerBar);
  const origin = Math.max(0, quantizeToResolution(at, resolution));
  let next = pattern;
  const ids: NoteId[] = [];
  for (const n of notes) {
    const start = origin + n.start;
    if (start + n.duration > total || collides(next, trackId, rollSlot(n), start, n.duration, new Set())) continue;
    const note: Note = { ...n, id: uid(), trackId, start };
    next = { ...next, notes: { ...next.notes, [note.id]: note } };
    ids.push(note.id);
  }
  return { pattern: next, ids };
}
