import { useCallback, useEffect, useRef } from "react";
import type { Webseq } from "../controller/useWebseq";
import { clipsOnTrack, type Clip, type ClipData } from "../model/clips";
import type { Workspace } from "./workspace";

/** Clip selection and creation shared by Arrange and Editor. Selecting a clip selects its track and points the controller's
 * "selected pattern" at the clip's pattern, so the existing instrument/FX/arp panels see the same context. */
export function useClipActions(c: Webseq, ws: Workspace) {
  const { handleSelectTarget, setSelectedPatternId, dispatch, project } = c;
  const { setClipId } = ws;
  const pending = useRef<{ trackId: string; before: Set<string> } | null>(null);

  const select = useCallback((clip: Clip) => {
    handleSelectTarget(clip.trackId);
    setClipId(clip.id);
    setSelectedPatternId(clip.patternId);
  }, [handleSelectTarget, setClipId, setSelectedPatternId]);

  // A create/duplicate dispatch does not return the new id, so the clip that appears on the track afterwards is selected.
  useEffect(() => {
    const p = pending.current;
    if (!p) return;
    pending.current = null;
    const made = clipsOnTrack(project, p.trackId).find((x) => !p.before.has(x.id));
    if (made) select(made);
  }, [project, select]);

  const create = useCallback((trackId: string, bar: number, bars = 1) => {
    pending.current = { trackId, before: new Set(clipsOnTrack(c.projectRef.current, trackId).map((x) => x.id)) };
    dispatch({ type: "CLIP_CREATE", trackId, start: bar, bars });
  }, [c.projectRef, dispatch]);

  const duplicate = useCallback((clip: Clip) => {
    pending.current = { trackId: clip.trackId, before: new Set(clipsOnTrack(c.projectRef.current, clip.trackId).map((x) => x.id)) };
    dispatch({ type: "CLIP_DUPLICATE", sequenceId: clip.id });
  }, [c.projectRef, dispatch]);

  const createFrom = useCallback((data: ClipData, trackId: string, bar: number) => {
    pending.current = { trackId, before: new Set(clipsOnTrack(c.projectRef.current, trackId).map((x) => x.id)) };
    dispatch({ type: "CLIP_PASTE", data, trackId, start: bar });
  }, [c.projectRef, dispatch]);

  return { select, create, duplicate, createFrom };
}
