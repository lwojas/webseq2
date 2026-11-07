import { useCallback, useEffect, useRef, useState } from "react";
import type { Webseq } from "../controller/useWebseq";
import type { Clip } from "../model/clips";
import { effectiveSampleMode } from "../model/chop";
import { createNoteRecorder } from "./recorder";
import { rootMidiNote } from "../model/instruments";
import type { Track } from "../model/types";

/** Records the MIDI keys into the clip being edited, while the song plays through it. A note starts where the key went down (snapped to
 * the grid) and ends where it was released; it is written on release, so one key press is one undoable note. The pitch is the same mapping
 * the keys use to play the track (a pitched synth sounds the key itself; samples and drums play from middle C). */
export function useRecorder(c: Webseq, clip: Clip | undefined, track: Track | undefined, patternId: string | undefined, snap: number) {
  const [armed, setArmed] = useState(false);
  const live = useRef({ clip, track, patternId, snap });
  live.current = { clip, track, patternId, snap };
  const { noteTapRef, dispatch, getPlayheadBeat, project } = c;
  const beatsRef = useRef(project.beatsPerBar);
  beatsRef.current = project.beatsPerBar;

  const pitchOf = useCallback((midi: number) => {
    const t = live.current.track;
    if (!t) return 0;
    if (effectiveSampleMode(t) === "chop") return midi - 60;
    const root = rootMidiNote(t);
    return midi - (root === null ? 60 : Math.round(root));
  }, []);

  useEffect(() => {
    if (!armed) return;
    noteTapRef.current = createNoteRecorder({
      getBeat: getPlayheadBeat,
      total: () => (live.current.clip?.bars ?? 1) * beatsRef.current,
      snap: () => live.current.snap,
      pitchOf,
      onNote: (n) => {
        const { track: t, patternId: pid, snap: s } = live.current;
        if (t && pid) dispatch({ type: "ROLL_ADD_NOTE", patternId: pid, trackId: t.id, start: n.start, pitch: n.pitch, duration: n.duration, velocity: n.velocity, resolution: s });
      },
    });
    return () => {
      noteTapRef.current = null;
    };
  }, [armed, noteTapRef, dispatch, getPlayheadBeat, pitchOf]);

  return { armed, setArmed };
}
