import { useCallback, useEffect, useMemo, useState } from "react";
import type { Webseq } from "../controller/useWebseq";
import { ArpPanel } from "../components/ArpPanel";
import { NoteCard } from "../components/TrackEditor";
import { TrackLfoPanel } from "../components/TrackLfoPanel";
import { arpOf } from "../model/arp";
import { effectiveSampleMode, sliceCount } from "../model/chop";
import { clipById, clipsOnTrack, type Clip } from "../model/clips";
import { DEFAULT_LANE_MODIFIERS, MAX_GATE_SCALE, MAX_TRANSPOSE, MAX_VELOCITY_SCALE, MIN_GATE_SCALE, MIN_VELOCITY_SCALE, maxPatternBars } from "../model/composer";
import { eventLfoOf } from "../model/eventLfo";
import { rootMidiNote, supportsTie } from "../model/instruments";
import { hasPatternSettings, trackInPattern } from "../model/patternSettings";
import { MAX_PATTERN_BARS } from "../model/notes";
import { FX_DEFS } from "../model/fx";
import { hasPatternAutomation } from "../model/patternAutomation";
import type { AutomationUi } from "../components/ModulationSlot";
import type { NoteId } from "../model/types";
import { trackById, trackHasSource } from "../model/types";
import { PianoRoll } from "./PianoRoll";
import { useRecorder } from "./useRecorder";
import { useClipActions } from "./clipActions";
import type { Workspace } from "./workspace";

/** The clip editor. It is always about one (track, clip): the bar says which, and the way back to the arrangement is one click (or Esc).
 * Everything musical about the clip is here; the sound is in the device area below, the level and routing are in the Mixer. */
export function Editor({ c, ws }: { c: Webseq; ws: Workspace }) {
  const { project } = c;
  const { clipId, setView } = ws;
  const { select, create } = useClipActions(c, ws);
  const [selection, setSelection] = useState<NoteId[]>([]);
  const [snap, setSnap] = useState(1);
  const [inspectorOpen, setInspectorOpen] = useState(true);

  const track = c.selectedTarget === "master" ? undefined : trackById(project, c.selectedTarget);
  const trackClips = useMemo(() => (track ? clipsOnTrack(project, track.id) : []), [project, track]);
  // The clip being edited: the selected one if it is on this track, else the track's first (so switching track keeps you editing).
  const current = clipById(project, clipId);
  const launcher = ws.patternEdit ? project.patterns.find((p) => p.id === ws.patternEdit) : undefined;
  // Editing a launcher pattern: the same roll, on this track's notes in that pattern, wearing the clip's shape.
  const asClip: Clip | undefined = launcher && track ? { id: `pattern:${launcher.id}`, trackId: track.id, laneId: "", patternId: launcher.id, start: 0, bars: launcher.bars, color: "#8a95a6", name: launcher.name } : undefined;
  const clip = asClip ?? (current && track && current.trackId === track.id ? current : trackClips[0]);
  const isPattern = !!asClip;
  const pattern = clip ? project.patterns.find((p) => p.id === clip.patternId) : undefined;

  useEffect(() => {
    if (clip && !isPattern && clip.id !== clipId) select(clip);
  }, [clip, clipId, select, isPattern]);
  const { setSelectedPatternId } = c;
  useEffect(() => {
    if (isPattern && clip) setSelectedPatternId(clip.patternId);
  }, [isPattern, clip, setSelectedPatternId]);
  useEffect(() => setSelection([]), [clip?.id]);
  // V1's bar tools ("Duplicate Bar") work from the selected note's bar.
  const { setSelectedNoteId } = c;
  useEffect(() => setSelectedNoteId(selection[0] ?? null), [selection, setSelectedNoteId]);
  const [toolsOpen, setToolsOpen] = useState(false);
  const recorder = useRecorder(c, clip, track, pattern?.id, snap);
  useEffect(() => {
    if (!toolsOpen) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setToolsOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [toolsOpen]);
  // Drop selected ids that no longer exist (deleted, undone).
  useEffect(() => {
    if (!pattern) return;
    setSelection((s) => (s.every((id) => id in pattern.notes) ? s : s.filter((id) => id in pattern.notes)));
  }, [pattern]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (e.key !== "Escape" || (el && (el.tagName === "INPUT" || el.tagName === "SELECT"))) return;
      if (selection.length) return;
      setView("arrange");
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selection.length, setView]);

  const step = useCallback((dir: -1 | 1) => {
    if (!clip) return;
    const i = trackClips.findIndex((x) => x.id === clip.id);
    const next = trackClips[i + dir];
    if (next) select(next);
  }, [clip, trackClips, select]);

  if (!track) {
    return (
      <section className="v2-editor v2-editor-empty" aria-label="Clip editor">
        <p>Select a track in the arrangement, then open one of its clips here.</p>
        <button className="v2-btn" onClick={() => setView("arrange")}>← Arrange</button>
      </section>
    );
  }
  const index = project.tracks.findIndex((t) => t.id === track.id);
  const trackLabel = `${String(index + 1).padStart(2, "0")} ${trackHasSource(track) ? track.name : "empty"}`;

  if (!clip || !pattern) {
    return (
      <section className="v2-editor v2-editor-empty" aria-label="Clip editor">
        <p>Track <strong>{trackLabel}</strong> has no clips.</p>
        <div className="v2-row-actions">
          <button className="v2-btn primary" onClick={() => create(track.id, 0, 1)}>Create a clip</button>
          <button className="v2-btn" onClick={() => setView("arrange")}>← Arrange</button>
        </div>
      </section>
    );
  }

  const played = trackInPattern(track, pattern);
  const own = hasPatternSettings(pattern, track.id);
  const notes = Object.values(pattern.notes).filter((n) => n.trackId === track.id);
  const lfo = eventLfoOf(played);
  const root = rootMidiNote(track);
  const slices = effectiveSampleMode(track) === "chop" ? Math.max(1, sliceCount(c.selectedTrackAsset)) : null;
  const single = selection.length === 1 ? pattern.notes[selection[0]] : undefined;
  const tied = notes.filter((n) => n.tie).length;
  const selSet = new Set(selection);
  const mods = clip.modifiers ?? DEFAULT_LANE_MODIFIERS;
  const setMod = (patch: Partial<typeof mods>) => c.dispatch({ type: "CLIP_SET_MODIFIERS", sequenceId: clip.id, patch });
  // Automation of this clip: the source's own parameters and each FX's, in the clip's pattern (an edit here belongs to this clip only).
  const lanesUi: { ui: AutomationUi; fxId: string | null; owner: string }[] = [];
  const srcUi = c.automationFor(null);
  if (srcUi) lanesUi.push({ ui: srcUi, fxId: null, owner: trackHasSource(track) ? track.name : "Source" });
  for (const fx of track.fx) {
    const ui = c.automationFor(fx.id);
    if (ui) lanesUi.push({ ui, fxId: fx.id, owner: FX_DEFS[fx.type].label });
  }
  const focusedKey = c.automationFocus ? `${c.automationFocus.fxId ?? ""}|${c.automationFocus.parameter}` : "";
  const ownAutomation = hasPatternAutomation(pattern, track.id);
  const onPickLane = (value: string) => {
    if (value === "") { c.automationRow?.onClose(); return; }
    const [mode, fxId, param] = value.split("|");
    const entry = lanesUi.find((l) => (l.fxId ?? "") === fxId);
    if (!entry) return;
    if (mode === "add") entry.ui.onAdd(param);
    else entry.ui.onFocus(param);
  };
  const picker = (
    <>
      <span className="v2-note">Automation</span>
      <select value={focusedKey ? `focus|${focusedKey}` : ""} onChange={(e) => onPickLane(e.target.value)} aria-label="Automation lane" disabled={lanesUi.length === 0}>
        <option value="">{lanesUi.length === 0 ? "Load a sound to automate it" : "None shown"}</option>
        {lanesUi.some((l) => l.ui.lanes.length > 0) && (
          <optgroup label="In this clip">
            {lanesUi.flatMap((l) => l.ui.lanes.map((lane) => <option key={`f${l.fxId}${lane.parameter}`} value={`focus|${l.fxId ?? ""}|${lane.parameter}`}>{l.owner} · {l.ui.params.find((p) => p.id === lane.parameter)?.label ?? lane.parameter}</option>))}
          </optgroup>
        )}
        {lanesUi.map((l) => (
          <optgroup key={`a${l.fxId}`} label={`Add: ${l.owner}`}>
            {l.ui.params.filter((p) => !l.ui.lanes.some((x) => x.parameter === p.id)).map((p) => <option key={p.id} value={`add|${l.fxId ?? ""}|${p.id}`}>{p.label}</option>)}
          </optgroup>
        ))}
      </select>
      {c.automationRow && <button className="v2-btn" onClick={c.automationRow.onClose} title="Hide the lane (it keeps playing)">Hide</button>}
      {ownAutomation && <button className="v2-btn" onClick={() => c.dispatch({ type: "RESET_PATTERN_AUTOMATION", patternId: pattern.id, target: track.id })} title="Drop this clip's own automation: it plays the track's again">Use track's</button>}
      <span className="v2-note">{ownAutomation ? "this clip's own" : "the track's, shared by every clip"}</span>
    </>
  );
  // V1's bar tools, but safe on a timeline: growing a clip must not run into the next one on its row.
  const room = maxPatternBars(project, pattern.id);
  const tools = [...c.editProps.barTools, ...(slices !== null ? c.editProps.chopTools : [])].map((t) => ({
    ...t,
    blocked: t.blocked ?? (t.id === "duplicate-sequence" && pattern.bars * 2 > room ? "The next clip is in the way" : t.id === "duplicate-bar" && pattern.bars + 1 > room ? "The next clip is in the way" : null),
    label: t.id === "clear-sequence" ? "Clear clip" : t.id === "duplicate-sequence" ? "Double clip" : t.id === "extend-track-1" ? "Repeat last bar once" : t.id === "extend-track-end" ? "Repeat last bar to clip end" : t.label.replace("Sequence", "clip"),
  }));

  return (
    <section className="v2-editor" aria-label="Clip editor">
      <div className="v2-context" role="navigation" aria-label="Editing">
        <button className="v2-btn" onClick={() => { ws.setPatternEdit(null); setView("arrange"); }} title="Back to the arrangement  [Esc]">← Arrange</button>
        <div className="v2-crumb">
          <span className="v2-crumb-track" style={{ ["--clip" as string]: clip.color }}>{trackLabel}</span>
          <span className="v2-crumb-sep">›</span>
          <input className="v2-clip-title" value={clip.name} onChange={(e) => c.dispatch(isPattern ? { type: "RENAME_PATTERN", patternId: clip.patternId, name: e.target.value || clip.name } : { type: "CLIP_RENAME", sequenceId: clip.id, name: e.target.value || clip.name })} aria-label="Clip name" spellCheck={false} />
          <span className="v2-crumb-meta">{isPattern ? "pattern, not on the timeline" : `bars ${clip.start + 1}–${clip.start + clip.bars}`}</span>
        </div>
        <div className="v2-context-actions">
          {isPattern && (
            <select className="v2-track-select" value={track.id} onChange={(e) => c.handleSelectTarget(e.target.value)} aria-label="Track to edit in this pattern">
              {project.tracks.map((t, i) => <option key={t.id} value={t.id}>{String(i + 1).padStart(2, "0")} {trackHasSource(t) ? t.name : "empty"}</option>)}
            </select>
          )}
          {!isPattern && <><button className="v2-btn" onClick={() => step(-1)} disabled={trackClips[0]?.id === clip.id} title="Previous clip on this track">‹</button>
          <button className="v2-btn" onClick={() => step(1)} disabled={trackClips[trackClips.length - 1]?.id === clip.id} title="Next clip on this track">›</button></>}
          <span className="v2-field"><span>Length</span></span>
          <div className="v2-segment" role="group" aria-label="Clip length in bars">
            <button onClick={() => c.dispatch(isPattern ? { type: "SET_PATTERN_BARS", patternId: clip.patternId, bars: clip.bars - 1 } : { type: "CLIP_RESIZE", sequenceId: clip.id, bars: clip.bars - 1 })} disabled={clip.bars <= 1} aria-label="One bar shorter">−</button>
            <button className="static" disabled>{clip.bars} bar{clip.bars === 1 ? "" : "s"}</button>
            <button onClick={() => c.dispatch(isPattern ? { type: "SET_PATTERN_BARS", patternId: clip.patternId, bars: clip.bars + 1 } : { type: "CLIP_RESIZE", sequenceId: clip.id, bars: clip.bars + 1 })} disabled={clip.bars >= MAX_PATTERN_BARS} aria-label="One bar longer" title="Longer: the clip's content repeats into the new bar">+</button>
          </div>
          <div className="v2-popover-anchor">
            <button className={`v2-btn ${toolsOpen ? "on" : ""}`} onClick={() => setToolsOpen(!toolsOpen)} aria-expanded={toolsOpen} title="Clear, double, repeat bars, chop fills">Clip tools ▾</button>
            {toolsOpen && (
              <div className="v2-popover v2-tools-menu" role="menu" aria-label="Clip tools">
                {tools.map((t) => (
                  <div key={t.id} className="v2-tool-row">
                    <button className="v2-btn" disabled={t.blocked !== null} title={t.blocked ?? t.label} onClick={() => { t.onRun(); setToolsOpen(false); }}>{t.label}</button>
                    <span className="v2-note">{t.blocked ?? t.hint ?? ""}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
          {!isPattern && <button className={`v2-btn ${clip.off ? "on" : ""}`} aria-pressed={!!clip.off} onClick={() => c.dispatch({ type: "SET_PATTERN_TRACK_OFF", patternId: clip.patternId, trackId: track.id, off: !clip.off })} title="Switch this clip's notes off or on; it plays nothing while off">Notes {clip.off ? "off" : "on"}</button>}
          {!isPattern && <button className="v2-btn" onClick={() => { c.dispatch({ type: "CLIP_DELETE", sequenceId: clip.id }); ws.setClipId(null); setView("arrange"); }} title="Delete this clip">Delete clip</button>}
          <button className={`v2-btn ${inspectorOpen ? "on" : ""}`} onClick={() => setInspectorOpen(!inspectorOpen)} aria-pressed={inspectorOpen} title="Note and clip settings">Inspector</button>
        </div>
      </div>

      <div className="v2-editor-body">
        <PianoRoll c={c} clip={clip} track={track} pattern={pattern} selection={selSet} onSelection={setSelection} snap={snap} setSnap={setSnap} clipboard={ws.clipboard.notes} extraBar={<button className={`v2-btn rec ${recorder.armed ? "on" : ""}`} aria-pressed={recorder.armed} onClick={() => recorder.setArmed(!recorder.armed)} title={c.midi.enabled ? "Record the MIDI keyboard into this clip while the song plays" : "Turn MIDI on (header) to record from a keyboard"} disabled={!c.midi.enabled}>● Rec{recorder.armed ? (c.midi.inputs.length ? " (armed)" : " (no input)") : ""}</button>} automationPicker={picker} automationRow={c.automationRow} onCopy={(notes) => { ws.copyToClipboard({ notes }); ws.say(`Copied ${notes.length} note${notes.length === 1 ? "" : "s"}`); }} />
        {inspectorOpen && (
          <aside className="v2-inspector v2-scroll" aria-label="Inspector">
            <div className="v2-inspector-title">{single ? "Note" : selection.length > 1 ? `${selection.length} notes` : "Notes"}</div>
            {single ? (
              <NoteCard
                note={single}
                root={root}
                slices={slices}
                scale={c.projectScale}
                selected
                onSelectNote={() => {}}
                onRemoveNote={(id) => c.dispatch({ type: "ROLL_REMOVE_NOTES", patternId: pattern.id, noteIds: [id] })}
                onSetNotePitch={c.handleSetNotePitch}
                onSetNoteVelocity={c.handleSetNoteVelocity}
                onSetNoteRatchet={c.handleSetNoteRatchet}
                canTie={supportsTie(track)}
                onSetNoteTie={c.handleSetNoteTie}
                onSetNoteDuration={c.handleSetNoteDuration}
                onSetNoteMode={c.handleSetNoteMode}
                onSetNoteChord={c.handleSetNoteChord}
                lfoOn={lfo.enabled}
                onSetNoteLfo={c.handleSetNoteLfo}
              />
            ) : (
              <p className="v2-empty">{selection.length > 1 ? "Several notes selected: ←/→ nudge, ↑/↓ transpose, ⌫ delete." : "Select a note to edit its pitch, length, ratchet, tie and chord."}</p>
            )}

            {!isPattern && <><div className="v2-inspector-title">Clip playback <span className="v2-note">changes how it sounds, not the notes</span></div>
            <div className="v2-mods">
              <label><span>Transpose</span><input type="number" min={-MAX_TRANSPOSE} max={MAX_TRANSPOSE} value={mods.transpose} onChange={(e) => setMod({ transpose: Number(e.target.value) })} aria-label="Transpose in semitones" /><em>st</em></label>
              <label><span>Velocity</span><input type="range" min={MIN_VELOCITY_SCALE * 100} max={MAX_VELOCITY_SCALE * 100} step={5} value={Math.round(mods.velocity * 100)} onChange={(e) => setMod({ velocity: Number(e.target.value) / 100 })} aria-label="Velocity scale" /><em>{Math.round(mods.velocity * 100)}%</em></label>
              <label><span>Gate</span><input type="range" min={MIN_GATE_SCALE * 100} max={MAX_GATE_SCALE * 100} step={5} value={Math.round(mods.gate * 100)} onChange={(e) => setMod({ gate: Number(e.target.value) / 100 })} aria-label="Gate scale" /><em>{Math.round(mods.gate * 100)}%</em></label>
              {clip.modifiers && <button className="v2-btn" onClick={() => setMod(DEFAULT_LANE_MODIFIERS)}>Reset</button>}
            </div></>}

            <div className="v2-inspector-title">Arp &amp; LFO <span className="v2-note">{own ? "this clip's own" : "the track's"}</span></div>
            {own && <button className="v2-btn" onClick={() => c.handleResetPatternSettings(track.id)} title="Drop this clip's own arp and LFO: it plays the track's">Use track's</button>}
            <ArpPanel arp={arpOf(played)} noteCount={notes.length} onChange={(patch) => c.handleSetTrackArp(track.id, patch)} />
            {supportsTie(track) && (
              <div className="v2-row-actions">
                <span className="v2-note">Ties {tied}/{notes.length}</span>
                <button className="v2-btn" disabled={notes.length === 0} onClick={() => c.handleSetTrackNotesTie(track.id, true)}>All</button>
                <button className="v2-btn" disabled={tied === 0} onClick={() => c.handleSetTrackNotesTie(track.id, false)}>None</button>
              </div>
            )}
            <TrackLfoPanel lfo={lfo} participating={notes.filter((n) => (n.lfo ?? 0) > 0).length} stepCount={notes.length} chop={slices !== null} onChange={(patch) => c.handleSetTrackEventLfo(track.id, patch)} onSetAllSteps={(amount) => c.handleSetTrackNotesLfo(track.id, amount)} />
          </aside>
        )}
      </div>
    </section>
  );
}
