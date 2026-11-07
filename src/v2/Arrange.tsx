import { memo, useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent, type KeyboardEvent as ReactKeyboardEvent } from "react";
import type { Webseq } from "../controller/useWebseq";
import { usePlayheadAnimation } from "../hooks/usePlayheadAnimation";
import { INSTRUMENT_DEFS } from "../model/instruments";
import { BANK_SIZE } from "../model/project";
import { describeModifiers } from "../model/composer";
import { clipsOnTrack, copyClip, copyBankData, songLengthBars, trackLanes, type Clip } from "../model/clips";
import type { Pattern, Track } from "../model/types";
import { trackHasSource } from "../model/types";
import { clamp, type Workspace } from "./workspace";
import { useClipActions } from "./clipActions";

const ROW_H = 46;
const HEADER_W = 224;
const RULER_H = 26;
const MIN_PX_PER_BAR = 16;
const MAX_PX_PER_BAR = 240;
const EXTRA_BARS = 16;

type Filter = "used" | 0 | 1 | 2 | 3;

function sourceLabel(track: Track): string {
  if (track.instrument) return INSTRUMENT_DEFS[track.instrument.kind]?.label ?? track.instrument.kind;
  return track.assetId != null ? "sample" : "";
}

interface HeaderProps {
  track: Track;
  index: number;
  height: number;
  selected: boolean;
  onSelect: (trackId: string) => void;
  onMute: (trackId: string, muted: boolean) => void;
  onSolo: (trackId: string, soloed: boolean) => void;
}

const TrackHeader = memo(function TrackHeader({ track, index, height, selected, onSelect, onMute, onSolo }: HeaderProps) {
  const has = trackHasSource(track);
  const fx = track.fx.length;
  const fxOn = track.fx.filter((f) => f.enabled).length;
  return (
    <div className={`v2-track-header ${selected ? "selected" : ""} ${track.muted ? "muted" : ""}`} style={{ height }} onPointerDown={() => onSelect(track.id)} role="row" aria-selected={selected}>
      <span className="v2-track-num">{String(index + 1).padStart(2, "0")}</span>
      <span className="v2-track-label">
        <span className={`v2-track-name ${has ? "" : "empty"}`} title={has ? track.name : "No sound yet. Load an instrument or sample from the Browser."}>
          {has ? track.name : "empty"}
        </span>
        <span className="v2-track-kind">
          {sourceLabel(track)}
          {fx > 0 && <span className={`v2-fx-badge ${fxOn === 0 ? "bypassed" : ""}`} title={`${fx} effect${fx === 1 ? "" : "s"} on this track${fxOn < fx ? ` (${fx - fxOn} bypassed)` : ""}`}>FX {fx}</span>}
        </span>
      </span>
      <span className="v2-track-buttons">
        <button className={`v2-mini ${track.muted ? "mute" : ""}`} aria-pressed={track.muted} onPointerDown={(e) => e.stopPropagation()} onClick={() => onMute(track.id, !track.muted)} title="Mute the track">M</button>
        <button className={`v2-mini ${track.soloed ? "solo" : ""}`} aria-pressed={track.soloed} onPointerDown={(e) => e.stopPropagation()} onClick={() => onSolo(track.id, !track.soloed)} title="Solo">S</button>
      </span>
    </div>
  );
});

/** A clip's contents drawn as a tiny piano-roll: one canvas per clip, redrawn only when its notes or its size change. */
function ClipPreview({ pattern, trackId, widthPx, heightPx, beatsPerBar }: { pattern: Pattern | undefined; trackId: string; widthPx: number; heightPx: number; beatsPerBar: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas || !pattern) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.max(1, Math.round(widthPx * dpr));
    canvas.height = Math.max(1, Math.round(heightPx * dpr));
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.scale(dpr, dpr);
    const notes = Object.values(pattern.notes).filter((n) => n.trackId === trackId);
    if (notes.length === 0) return;
    let lo = Infinity;
    let hi = -Infinity;
    for (const n of notes) {
      const pitch = n.chord ? 0 : (n.pitch ?? 0);
      lo = Math.min(lo, pitch);
      hi = Math.max(hi, pitch);
    }
    const span = Math.max(7, hi - lo + 1);
    const rowH = Math.min(4, heightPx / span);
    const total = pattern.bars * beatsPerBar;
    ctx.fillStyle = "rgba(255,255,255,0.78)";
    for (const n of notes) {
      const pitch = n.chord ? 0 : (n.pitch ?? 0);
      const x = (n.start / total) * widthPx;
      const w = Math.max(1.5, (n.duration / total) * widthPx - 0.5);
      const y = heightPx - 2 - ((pitch - lo + (span - (hi - lo + 1)) / 2) / span) * (heightPx - 4) - rowH;
      ctx.globalAlpha = 0.45 + 0.55 * n.velocity;
      ctx.fillRect(x, y, w, Math.max(1.5, rowH - 0.5));
    }
  }, [pattern, trackId, widthPx, heightPx, beatsPerBar]);
  return <canvas ref={ref} className="v2-clip-preview" style={{ width: widthPx, height: heightPx }} />;
}

interface ClipViewProps {
  clip: Clip;
  lane: number;
  pxPerBar: number;
  pattern: Pattern | undefined;
  beatsPerBar: number;
  selected: boolean;
  onSelect: (clip: Clip) => void;
  onOpen: (clip: Clip) => void;
  onMove: (clip: Clip, start: number) => void;
  onResize: (clip: Clip, bars: number) => void;
}

const ClipView = memo(function ClipView({ clip, lane, pxPerBar, pattern, beatsPerBar, selected, onSelect, onOpen, onMove, onResize }: ClipViewProps) {
  const drag = useRef<{ mode: "move" | "resize"; x: number; el: HTMLElement; bars: number; start: number; width: string } | null>(null);
  const width = clip.bars * pxPerBar;

  const down = (e: ReactPointerEvent<HTMLDivElement>, mode: "move" | "resize") => {
    if (e.button !== 0) return;
    e.stopPropagation();
    onSelect(clip);
    const el = e.currentTarget.closest<HTMLElement>(".v2-clip")!;
    el.setPointerCapture(e.pointerId);
    drag.current = { mode, x: e.clientX, el, bars: clip.bars, start: clip.start, width: el.style.width };
  };
  const move = (e: ReactPointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d) return;
    const delta = Math.round((e.clientX - d.x) / pxPerBar);
    if (d.mode === "move") {
      const start = Math.max(0, clip.start + delta);
      d.start = start;
      d.el.style.transform = `translateX(${(start - clip.start) * pxPerBar}px)`;
      d.el.classList.toggle("dragging", delta !== 0);
    } else {
      const bars = Math.max(1, clip.bars + delta);
      d.bars = bars;
      d.el.style.width = `${bars * pxPerBar - 1}px`;
      d.el.classList.toggle("dragging", delta !== 0);
    }
  };
  const up = () => {
    const d = drag.current;
    drag.current = null;
    if (!d) return;
    d.el.classList.remove("dragging");
    d.el.style.transform = "";
    d.el.style.width = d.width; // the width React set; the drag only borrowed it
    if (d.mode === "move" && d.start !== clip.start) onMove(clip, d.start);
    if (d.mode === "resize" && d.bars !== clip.bars) onResize(clip, d.bars);
  };

  return (
    <div
      className={`v2-clip ${selected ? "selected" : ""} ${clip.off ? "off" : ""}`}
      style={{ left: clip.start * pxPerBar, width: width - 1, top: lane * ROW_H + 3, height: ROW_H - 6, ["--clip" as string]: clip.color }}
      onPointerDown={(e) => down(e, "move")}
      onPointerMove={move}
      onPointerUp={up}
      onPointerCancel={up}
      onDoubleClick={(e) => { e.stopPropagation(); onOpen(clip); }}
      role="button"
      aria-label={`Clip ${clip.name}, bars ${clip.start + 1} to ${clip.start + clip.bars}`}
      aria-pressed={selected}
    >
      <span className="v2-clip-name">{clip.off ? "✕ " : ""}{clip.name}{clip.modifiers ? ` · ${describeModifiers(clip.modifiers)}` : ""}</span>
      <ClipPreview pattern={pattern} trackId={clip.trackId} widthPx={Math.max(1, width - 3)} heightPx={ROW_H - 22} beatsPerBar={beatsPerBar} />
      <div className="v2-clip-handle" onPointerDown={(e) => down(e, "resize")} title="Drag to change length" />
    </div>
  );
});

interface Props {
  c: Webseq;
  ws: Workspace;
}

export const Arrange = memo(function Arrange({ c, ws }: Props) {
  const { project } = c;
  const [pxPerBar, setPxPerBar] = useState(72);
  const [filter, setFilter] = useState<Filter>("used");
  const [marker, setMarker] = useState<number | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const bpb = project.beatsPerBar;

  const patternById = useMemo(() => new Map(project.patterns.map((p) => [p.id, p])), [project.patterns]);
  const clipsByTrack = useMemo(() => {
    const map = new Map<string, Clip[]>();
    for (const t of project.tracks) map.set(t.id, clipsOnTrack(project, t.id));
    return map;
  }, [project]);

  const tracks = useMemo(() => {
    const keep = project.tracks.map((t, index) => ({ t, index }));
    if (filter === "used") {
      // Tracks in use, the selected one, and always the first eight so an empty project has somewhere to start.
      return keep.filter(({ t, index }) => index < 8 || trackHasSource(t) || (clipsByTrack.get(t.id)?.length ?? 0) > 0 || t.id === c.selectedTarget);
    }
    return keep.slice(filter * BANK_SIZE, (filter + 1) * BANK_SIZE);
  }, [project.tracks, filter, clipsByTrack, c.selectedTarget]);

  const bars = Math.max(songLengthBars(project) + EXTRA_BARS, 32);
  const laneRows = (trackId: string) => Math.max(1, trackLanes(project, trackId).length);
  const bodyHeight = tracks.reduce((h, { t }) => h + laneRows(t.id) * ROW_H, 0);
  const selectedClip = ws.clipId;

  const { setClipId, setView } = ws;
  const { handleSelectTarget, dispatch, setSelectedFxId } = c;
  const { select: onSelectClip, create: createAt, duplicate, createFrom } = useClipActions(c, ws);
  const onSelectTrack = useCallback((trackId: string) => {
    handleSelectTarget(trackId);
    setSelectedFxId(null);
  }, [handleSelectTarget, setSelectedFxId]);
  const onOpen = useCallback((clip: Clip) => {
    onSelectClip(clip);
    setView("editor");
  }, [onSelectClip, setView]);
  const onMove = useCallback((clip: Clip, start: number) => dispatch({ type: "CLIP_MOVE", sequenceId: clip.id, start }), [dispatch]);
  const onResize = useCallback((clip: Clip, n: number) => dispatch({ type: "CLIP_RESIZE", sequenceId: clip.id, bars: n }), [dispatch]);

  const laneDoubleClick = (e: React.MouseEvent, trackId: string) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const bar = Math.floor((e.clientX - rect.left) / pxPerBar);
    onSelectTrack(trackId);
    createAt(trackId, bar);
  };

  const getSongBeat = c.getSongBeat;
  const playheadRef = usePlayheadAnimation(getSongBeat, pxPerBar / bpb, true);

  const selected = selectedClip ? [...clipsByTrack.values()].flat().find((x) => x.id === selectedClip) : undefined;
  const targetTrackId = c.selectedTarget === "master" ? undefined : c.selectedTarget;
  const copySelected = () => {
    const data = selected && copyClip(project, selected.id);
    if (!data) return false;
    ws.copyToClipboard({ clip: data });
    ws.say(`Copied clip “${data.name}”`);
    return true;
  };
  const pasteClipHere = () => {
    const data = ws.clipboard.clip;
    if (!data || !targetTrackId) return;
    const own = selected && selected.trackId === targetTrackId ? selected.start + selected.bars : 0;
    createFrom(data, targetTrackId, marker ?? own);
    ws.say(`Pasted clip → track ${project.tracks.findIndex((t) => t.id === targetTrackId) + 1}`);
  };
  const bankOfFilter = typeof filter === "number" ? filter : null;
  const toggleOff = () => {
    if (selected) dispatch({ type: "SET_PATTERN_TRACK_OFF", patternId: selected.patternId, trackId: selected.trackId, off: !selected.off });
  };
  const onKey = (e: ReactKeyboardEvent) => {
    if ((e.target as HTMLElement).tagName === "INPUT") return;
    const mod = e.metaKey || e.ctrlKey;
    if (selected && (e.key === "Delete" || e.key === "Backspace")) {
      e.preventDefault();
      dispatch({ type: "CLIP_DELETE", sequenceId: selected.id });
      setClipId(null);
    } else if (selected && !mod && e.key === "0") {
      e.preventDefault();
      toggleOff();
    } else if (mod && e.key.toLowerCase() === "c") {
      if (copySelected()) e.preventDefault();
    } else if (selected && mod && e.key.toLowerCase() === "x") {
      e.preventDefault();
      if (copySelected()) {
        dispatch({ type: "CLIP_DELETE", sequenceId: selected.id });
        setClipId(null);
      }
    } else if (mod && e.key.toLowerCase() === "v") {
      e.preventDefault();
      pasteClipHere();
    } else if (selected && mod && e.key.toLowerCase() === "d") {
      e.preventDefault();
      duplicate(selected);
    } else if (selected && e.key === "Enter") {
      e.preventDefault();
      setView("editor");
    } else if (selected && (e.key === "ArrowLeft" || e.key === "ArrowRight")) {
      e.preventDefault();
      onMove(selected, Math.max(0, selected.start + (e.key === "ArrowRight" ? 1 : -1)));
    }
  };

  // Keep the playhead's column visible when a project loads shorter than the current scroll.
  useEffect(() => {
    const el = scrollRef.current;
    if (el && el.scrollLeft > bars * pxPerBar) el.scrollLeft = 0;
  }, [bars, pxPerBar]);

  const rulerStep = pxPerBar >= 56 ? 1 : pxPerBar >= 28 ? 2 : 4;
  const newClip = () => {
    const trackId = c.selectedTarget === "master" ? tracks[0]?.t.id : c.selectedTarget;
    if (!trackId) return;
    const existing = clipsByTrack.get(trackId) ?? [];
    const at = marker ?? existing.reduce((end, x) => Math.max(end, x.start + x.bars), 0);
    onSelectTrack(trackId);
    createAt(trackId, at);
  };

  return (
    <section className="v2-arrange" aria-label="Arrangement">
      <div className="v2-toolbar">
        <button className="v2-btn" onClick={newClip} title="Add a one-bar clip to the selected track, at the marker or after its last clip">+ Clip</button>
        <button className={`v2-btn ${selected?.off ? "on" : ""}`} onClick={toggleOff} disabled={!selected} aria-pressed={!!selected?.off} title="Switch this clip's notes off or on; it stays in place but plays nothing  [0]">Notes {selected?.off ? "off" : "on"}</button>
        <button className="v2-btn" onClick={copySelected} disabled={!selected} title="Copy the selected clip  [⌘C]">Copy</button>
        <button className="v2-btn" onClick={pasteClipHere} disabled={!ws.clipboard.clip || !targetTrackId} title="Paste at the marker, or after the selected clip, on the selected track  [⌘V]">Paste</button>
        {bankOfFilter !== null && (
          <>
            <button className="v2-btn" onClick={() => { ws.copyToClipboard({ bank: { data: copyBankData(project, bankOfFilter), from: `Bank ${bankOfFilter + 1}` } }); ws.say(`Copied Bank ${bankOfFilter + 1}`); }} title="Copy these 16 tracks: sounds, FX and clips">Copy bank</button>
            <button className="v2-btn" disabled={!ws.clipboard.bank} onClick={() => { if (ws.clipboard.bank) { dispatch({ type: "BANK_PASTE", bank: bankOfFilter, data: ws.clipboard.bank.data }); ws.say(`Pasted ${ws.clipboard.bank.from} → Bank ${bankOfFilter + 1}`); } }} title={ws.clipboard.bank ? `Replace these 16 tracks with ${ws.clipboard.bank.from}` : "No bank copied"}>Paste bank</button>
          </>
        )}
        {marker !== null && (
          <>
            <button className="v2-btn" onClick={() => void c.handlePlaySongFrom(marker * bpb)} title="Play the song from the marker">▶ From bar {marker + 1}</button>
            <button className="v2-btn" onClick={() => setMarker(null)} title="Clear the marker">Clear marker</button>
          </>
        )}
        <span className="v2-toolbar-spacer" />
        <div className="v2-segment" role="group" aria-label="Tracks shown">
          {(["used", 0, 1, 2, 3] as Filter[]).map((f) => (
            <button key={String(f)} className={filter === f ? "on" : ""} aria-pressed={filter === f} onClick={() => setFilter(f)} title={f === "used" ? "Tracks with a sound or clips" : `Tracks ${Number(f) * BANK_SIZE + 1}–${(Number(f) + 1) * BANK_SIZE}`}>
              {f === "used" ? "Used" : `Bank ${Number(f) + 1}`}
            </button>
          ))}
        </div>
        <div className="v2-segment" role="group" aria-label="Zoom">
          <button onClick={() => setPxPerBar((p) => clamp(Math.round(p / 1.4), MIN_PX_PER_BAR, MAX_PX_PER_BAR))} aria-label="Zoom out" title="Zoom out">−</button>
          <button onClick={() => setPxPerBar((p) => clamp(Math.round(p * 1.4), MIN_PX_PER_BAR, MAX_PX_PER_BAR))} aria-label="Zoom in" title="Zoom in">+</button>
        </div>
      </div>

      <div className="v2-scroll v2-arrange-scroll" ref={scrollRef} tabIndex={0} onKeyDown={onKey}>
        <div className="v2-arr-content" style={{ width: HEADER_W + bars * pxPerBar, height: RULER_H + Math.max(bodyHeight, 1) }}>
          <div className="v2-arr-ruler-row" style={{ height: RULER_H }}>
            <div className="v2-arr-corner" style={{ width: HEADER_W }}>
              <span>{tracks.length} tracks</span>
            </div>
            <div className="v2-ruler" style={{ width: bars * pxPerBar }} onPointerDown={(e) => {
              const rect = e.currentTarget.getBoundingClientRect();
              const bar = Math.floor((e.clientX - rect.left) / pxPerBar);
              setMarker((m) => (m === bar ? null : bar));
            }} title="Click to set a marker">
              {Array.from({ length: Math.ceil(bars / rulerStep) }, (_, i) => (
                <span key={i} className="v2-ruler-tick" style={{ left: i * rulerStep * pxPerBar }}>{i * rulerStep + 1}</span>
              ))}
              {marker !== null && <span className="v2-marker" style={{ left: marker * pxPerBar }} />}
            </div>
          </div>

          {tracks.map(({ t, index }) => {
            const lanes = laneRows(t.id);
            const height = lanes * ROW_H;
            const laneIds = trackLanes(project, t.id).map((l) => l.id);
            return (
              <div key={t.id} className="v2-arr-row" style={{ height }}>
                <TrackHeader track={t} index={index} height={height} selected={c.selectedTarget === t.id} onSelect={onSelectTrack} onMute={c.handleSetTrackMuted} onSolo={c.handleSetTrackSoloed} />
                <div
                  className={`v2-lane ${c.selectedTarget === t.id ? "selected" : ""}`}
                  style={{ width: bars * pxPerBar, height, ["--bar" as string]: `${pxPerBar}px`, ["--beat" as string]: `${pxPerBar / 4}px` }}
                  onPointerDown={() => { onSelectTrack(t.id); if (selectedClip) setClipId(null); }}
                  onDoubleClick={(e) => laneDoubleClick(e, t.id)}
                  role="row"
                >
                  {(clipsByTrack.get(t.id) ?? []).map((clip) => (
                    <ClipView
                      key={clip.id}
                      clip={clip}
                      lane={Math.max(0, laneIds.indexOf(clip.laneId))}
                      pxPerBar={pxPerBar}
                      pattern={patternById.get(clip.patternId)}
                      beatsPerBar={bpb}
                      selected={clip.id === selectedClip}
                      onSelect={onSelectClip}
                      onOpen={onOpen}
                      onMove={onMove}
                      onResize={onResize}
                    />
                  ))}
                </div>
              </div>
            );
          })}
          {tracks.length === 0 && <div className="v2-empty big">No tracks in this view.</div>}

          <div className="v2-playhead-layer" style={{ left: HEADER_W }}>
            <div className="v2-playhead" ref={playheadRef} style={{ display: "none" }} />
          </div>
        </div>
      </div>
    </section>
  );
});
