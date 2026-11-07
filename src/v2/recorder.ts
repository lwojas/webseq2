import type { NoteSink } from "../midi/midiInput";

export interface RecordedNote {
  start: number;
  duration: number;
  pitch: number;
  velocity: number;
}

export interface RecorderOptions {
  /** The playhead's beat within the clip, or null when the clip is not sounding. Read at every key event. */
  getBeat: () => number | null;
  /** The clip's length in beats. */
  total: () => number;
  /** Grid step in beats: starts and lengths are snapped to it. */
  snap: () => number;
  /** MIDI key -> the note's pitch in the clip. */
  pitchOf: (midi: number) => number;
  onNote: (note: RecordedNote) => void;
}

/** Turns key presses into notes: a note starts where the key went down and ends where it came up, and is delivered on release. Keys pressed
 * while the clip is not sounding are ignored. A key released after the clip looped round runs to the clip's end. */
export function createNoteRecorder({ getBeat, total, snap, pitchOf, onNote }: RecorderOptions): NoteSink {
  const held = new Map<number, { start: number; velocity: number }>();
  return {
    noteOn(midi, velocity) {
      const beat = getBeat();
      if (beat === null) return;
      const s = snap();
      held.set(midi, { start: Math.min(total() - s, Math.max(0, Math.round(beat / s) * s)), velocity });
    },
    noteOff(midi) {
      const h = held.get(midi);
      held.delete(midi);
      if (!h) return;
      const s = snap();
      const beat = getBeat();
      const end = beat === null || beat < h.start ? total() : beat;
      onNote({ start: h.start, duration: Math.max(s, Math.round((end - h.start) / s) * s), pitch: pitchOf(midi), velocity: h.velocity });
    },
    allNotesOff() {
      held.clear();
    },
  };
}
