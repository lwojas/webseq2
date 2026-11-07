// The piano roll: a canvas that draws only what is on screen. Scrolling and zooming redraw it; transport playback does not (the
// playhead is a separate transform-only element). Notes are V1 Notes: `pitch` is semitones above the track's own pitch.
import { memo, type ReactNode, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent } from "react";
import type { Webseq } from "../controller/useWebseq";
import { usePlayheadAnimation } from "../hooks/usePlayheadAnimation";
import { effectiveSampleMode, sliceCount } from "../model/chop";
import type { Clip } from "../model/clips";
import { rootMidiNote } from "../model/instruments";
import { MAX_NOTE_PITCH } from "../model/notes";
import { rollCopyNotes, type CopiedRollNote } from "../model/roll";
import { isChromatic, isOffsetInScale } from "../model/scale";
import { chordLabel } from "../components/TrackEditor";
import { chordMidis } from "../model/chord";
import type { Note, NoteId, Pattern, Track } from "../model/types";
import { AutomationLane, AUTOMATION_LANE_HEIGHT } from "../components/AutomationLane";
import type { AutomationRowProps } from "../components/AutomationRow";
import { clamp } from "./workspace";

const KEYS_W = 58;
const RULER_H = 20;
const ROW_H = 16;
const VEL_H = 76;
const MIN_PX = 6;
const MAX_PX = 96;
const NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
const BLACK = new Set([1, 3, 6, 8, 10]);

export const SNAPS: { label: string; beats: number }[] = [
  { label: "1/4 bar", beats: 4 },
  { label: "1/8 bar", beats: 2 },
  { label: "1/16", beats: 1 },
  { label: "1/32", beats: 0.5 },
  { label: "1/64", beats: 0.25 },
  { label: "Off", beats: 1 / 64 },
];

interface Colors { bg: string; row: string; rowBlack: string; line: string; lineBar: string; beat: string; text: string; dim: string; accent: string }
function readColors(el: HTMLElement): Colors {
  const s = getComputedStyle(el);
  const v = (n: string, d: string) => s.getPropertyValue(n).trim() || d;
  return { bg: v("--bg", "#0a0d12"), row: "#0e131b", rowBlack: "#0b0f15", line: v("--border", "#232a35"), lineBar: v("--border-strong", "#34404f"), beat: "#171d27", text: v("--text", "#c9d1de"), dim: v("--text-dim", "#6b7686"), accent: v("--accent", "#29e0e0") };
}

/** A chord note sits on the row of its root tone (the key it is built from); its other tones are drawn on their own rows. */
function chordRows(n: Note, scale: Parameters<typeof chordMidis>[0], root: number | null, base: number): number[] {
  return n.chord ? chordMidis(scale, root, n.chord).map((m) => m - base) : [n.pitch ?? 0];
}

type Drag =
  | { kind: "move"; ids: NoteId[]; x: number; y: number; dBeats: number; dPitch: number }
  | { kind: "resize"; id: NoteId; x: number; dur: number }
  | { kind: "draw"; start: number; pitch: number; x: number; y: number; dur: number; moved: boolean }
  | { kind: "marquee"; x0: number; y0: number; x1: number; y1: number }
  | { kind: "vel"; ids: NoteId[]; v: number };

interface Props {
  c: Webseq;
  clip: Clip;
  track: Track;
  pattern: Pattern;
  selection: ReadonlySet<NoteId>;
  onSelection: (ids: NoteId[]) => void;
  snap: number;
  setSnap: (beats: number) => void;
  clipboard: CopiedRollNote[] | undefined;
  onCopy: (notes: CopiedRollNote[]) => void;
  /** The clip's automation strip under the velocity lane: the picker above it, and the focused lane (null = nothing open). */
  automationPicker: ReactNode;
  automationRow: AutomationRowProps | null;
  /** Extra controls in the roll's top bar (record). */
  extraBar?: ReactNode;
}

export const PianoRoll = memo(function PianoRoll({ c, clip, track, pattern, selection, onSelection, snap, setSnap, clipboard, onCopy, automationPicker, automationRow, extraBar }: Props) {
  const { dispatch, project } = c;
  const bpb = project.beatsPerBar;
  const totalBeats = pattern.bars * bpb;
  const root = rootMidiNote(track);
  const base = root === null ? 60 : Math.round(root);
  const chop = effectiveSampleMode(track) === "chop";
  const slices = chop ? Math.max(1, sliceCount(c.selectedTrackAsset)) : 0;
  const scale = c.projectScale;

  const notes = useMemo(() => Object.values(pattern.notes).filter((n) => n.trackId === track.id), [pattern.notes, track.id]);
  // Pitch rows: +-3 octaves around the track's pitch, widened to hold every note; a chop track shows its slices.
  const { pMax, pMin } = useMemo(() => {
    if (chop) return { pMax: Math.max(slices, 8) - 1, pMin: 0 };
    let hi = 36;
    let lo = -36;
    for (const n of notes) {
      for (const p of chordRows(n, scale, root, base)) {
        hi = Math.max(hi, p + 2);
        lo = Math.min(lo, p - 2);
      }
    }
    return { pMax: Math.min(MAX_NOTE_PITCH + 12, hi), pMin: Math.max(-MAX_NOTE_PITCH - 12, lo) };
  }, [notes, chop, slices, scale, root, base]);
  const rows = pMax - pMin + 1;

  const [ppb, setPpb] = useState(24);
  const scrollRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const velRef = useRef<HTMLCanvasElement>(null);
  const velScrollSync = useRef(0);
  const autoInner = useRef<HTMLDivElement>(null);
  const drag = useRef<Drag | null>(null);
  const lastDur = useRef(1);
  const colors = useRef<Colors | null>(null);
  const frame = useRef(0);
  const live = useRef({ notes, selection, ppb, pMax, pMin, totalBeats, base, chop, slices, scale, root, clip, bpb, snap });
  live.current = { notes, selection, ppb, pMax, pMin, totalBeats, base, chop, slices, scale, root, clip, bpb, snap };
  const pendingAdd = useRef<Set<NoteId> | null>(null);
  // Where Paste puts notes: the last place clicked in the grid (then after what was pasted, so repeated pastes lay end to end).
  const cursor = useRef(0);

  const contentW = KEYS_W + totalBeats * ppb;
  const contentH = RULER_H + rows * ROW_H;

  // --- drawing ---
  const draw = useCallback(() => {
    const el = scrollRef.current;
    const canvas = canvasRef.current;
    if (!el || !canvas) return;
    const { notes, selection, ppb, pMax, pMin, totalBeats, base, chop, scale, root, clip, bpb } = live.current;
    const w = el.clientWidth;
    const h = el.clientHeight;
    const dpr = window.devicePixelRatio || 1;
    if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
    }
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    colors.current ??= readColors(el);
    const col = colors.current;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    const sl = el.scrollLeft;
    const st = el.scrollTop;
    const d = drag.current;
    const yOf = (pitch: number) => RULER_H + (pMax - pitch) * ROW_H - st;
    const xOf = (beat: number) => KEYS_W + beat * ppb - sl;
    const firstRow = Math.max(0, Math.floor((st - 0) / ROW_H));
    const lastRow = Math.min(pMax - pMin, Math.ceil((st + h) / ROW_H));

    // rows
    for (let r = firstRow; r <= lastRow; r++) {
      const pitch = pMax - r;
      const y = yOf(pitch);
      const midi = base + pitch;
      const black = !chop && BLACK.has(((midi % 12) + 12) % 12);
      const out = !chop && !isChromatic(scale) && !isOffsetInScale(scale, root, pitch);
      ctx.fillStyle = black ? col.rowBlack : col.row;
      ctx.fillRect(KEYS_W, y, w - KEYS_W, ROW_H);
      if (out) {
        ctx.fillStyle = "rgba(0,0,0,0.22)";
        ctx.fillRect(KEYS_W, y, w - KEYS_W, ROW_H);
      }
      ctx.fillStyle = col.line;
      ctx.fillRect(KEYS_W, y + ROW_H - 1, w - KEYS_W, 1);
    }
    // vertical grid
    const b0 = Math.max(0, Math.floor((sl) / ppb));
    const b1 = Math.min(totalBeats, Math.ceil((sl + w) / ppb));
    for (let b = b0; b <= b1; b++) {
      const x = Math.round(xOf(b)) + 0.5;
      if (x < KEYS_W) continue;
      const bar = b % bpb === 0;
      const quarter = b % 4 === 0;
      if (!bar && !quarter && ppb < 12) continue;
      ctx.fillStyle = bar ? col.lineBar : quarter ? col.line : col.beat;
      ctx.fillRect(x, RULER_H, 1, h - RULER_H);
    }
    // loop end
    ctx.fillStyle = "rgba(0,0,0,0.45)";
    const endX = xOf(totalBeats);
    if (endX < w) ctx.fillRect(Math.max(KEYS_W, endX), RULER_H, w - Math.max(KEYS_W, endX), h - RULER_H);

    // notes
    const preview = (n: Note): { start: number; dur: number; pitch: number } => {
      if (d?.kind === "move" && d.ids.includes(n.id)) return { start: n.start + d.dBeats, dur: n.duration, pitch: n.chord ? chordRows(n, scale, root, base)[0] : (n.pitch ?? 0) + d.dPitch };
      if (d?.kind === "resize" && d.id === n.id) return { start: n.start, dur: d.dur, pitch: n.pitch ?? 0 };
      return { start: n.start, dur: n.duration, pitch: n.chord ? chordRows(n, scale, root, base)[0] : (n.pitch ?? 0) };
    };
    for (const n of notes) {
      const p = preview(n);
      const x = xOf(p.start);
      const wN = Math.max(2, p.dur * ppb - 1);
      if (x + wN < KEYS_W || x > w) continue;
      const y = yOf(p.pitch);
      if (y + ROW_H < RULER_H || y > h) continue;
      const sel = selection.has(n.id);
      ctx.globalAlpha = 0.45 + 0.55 * n.velocity;
      ctx.fillStyle = clip.color;
      ctx.fillRect(x, y + 1, wN, ROW_H - 2);
      if (n.chord) {
        // the chord's other tones, thinner and fainter, on their own rows
        ctx.globalAlpha = 0.35 + 0.3 * n.velocity;
        for (const tone of chordRows(n, scale, root, base).slice(1)) {
          const ty = yOf(tone);
          if (ty + ROW_H < RULER_H || ty > h) continue;
          ctx.fillRect(x, ty + 4, wN, ROW_H - 8);
        }
      }
      ctx.globalAlpha = 1;
      if (sel) {
        ctx.strokeStyle = "#fff";
        ctx.lineWidth = 1.5;
        ctx.strokeRect(x + 0.5, y + 1.5, wN - 1, ROW_H - 3);
      }
      if (n.tie) {
        ctx.fillStyle = "#fff";
        ctx.fillRect(x + wN - 3, y + 4, 3, ROW_H - 8);
      }
      if (wN > 26 && (n.chord || (n.ratchet ?? 1) > 1)) {
        ctx.fillStyle = "#06121a";
        ctx.font = "10px ui-monospace, monospace";
        ctx.textBaseline = "middle";
        const label = n.chord ? chordLabel(n.chord, root, scale) : `×${n.ratchet}`;
        ctx.save();
        ctx.beginPath();
        ctx.rect(x, y, wN, ROW_H);
        ctx.clip();
        ctx.fillText(label, x + 4, y + ROW_H / 2 + 0.5);
        ctx.restore();
      }
    }
    if (d?.kind === "draw") {
      const x = xOf(d.start);
      ctx.fillStyle = clip.color;
      ctx.globalAlpha = 0.6;
      ctx.fillRect(x, yOf(d.pitch) + 1, Math.max(2, d.dur * ppb - 1), ROW_H - 2);
      ctx.globalAlpha = 1;
    }
    if (d?.kind === "marquee") {
      ctx.strokeStyle = col.accent;
      ctx.fillStyle = "rgba(41,224,224,0.1)";
      const x = Math.min(d.x0, d.x1) - 0 - 0;
      const y = Math.min(d.y0, d.y1);
      ctx.fillRect(x, y, Math.abs(d.x1 - d.x0), Math.abs(d.y1 - d.y0));
      ctx.strokeRect(x + 0.5, y + 0.5, Math.abs(d.x1 - d.x0), Math.abs(d.y1 - d.y0));
    }

    // keys (fixed at the left)
    ctx.fillStyle = col.bg;
    ctx.fillRect(0, 0, KEYS_W, h);
    for (let r = firstRow; r <= lastRow; r++) {
      const pitch = pMax - r;
      const y = yOf(pitch);
      const midi = base + pitch;
      const pc = ((midi % 12) + 12) % 12;
      const isBlack = !chop && BLACK.has(pc);
      ctx.fillStyle = chop ? (pitch % 2 ? "#161c26" : "#1b222e") : isBlack ? "#12171f" : "#cfd6e2";
      ctx.fillRect(0, y, KEYS_W - 1, ROW_H - 1);
      ctx.textBaseline = "middle";
      ctx.font = "10px ui-monospace, monospace";
      if (chop) {
        ctx.fillStyle = col.text;
        ctx.fillText(`Slice ${pitch + 1}`, 6, y + ROW_H / 2);
      } else if (pc === 0 || pitch === 0) {
        ctx.fillStyle = isBlack ? col.text : "#10151d";
        ctx.fillText(`${NAMES[pc]}${Math.floor(midi / 12) - 1}${pitch === 0 ? " ●" : ""}`, 6, y + ROW_H / 2);
      }
    }
    // ruler
    ctx.fillStyle = col.bg;
    ctx.fillRect(0, 0, w, RULER_H);
    ctx.fillStyle = col.lineBar;
    ctx.fillRect(0, RULER_H - 1, w, 1);
    ctx.fillStyle = col.dim;
    ctx.font = "10px ui-monospace, monospace";
    ctx.textBaseline = "middle";
    for (let b = b0; b <= b1; b++) {
      if (b % bpb !== 0 && !(ppb >= 40 && b % 4 === 0)) continue;
      const x = xOf(b);
      if (x < KEYS_W) continue;
      ctx.fillRect(Math.round(x), b % bpb === 0 ? 4 : 12, 1, b % bpb === 0 ? RULER_H - 5 : RULER_H - 13);
      if (b % bpb === 0) ctx.fillText(`${clip.start + b / bpb + 1}`, x + 4, RULER_H / 2);
    }
    ctx.fillStyle = col.bg;
    ctx.fillRect(0, 0, KEYS_W, RULER_H);
    drawVelocity();
  }, []);

  const drawVelocity = useCallback(() => {
    const el = scrollRef.current;
    const canvas = velRef.current;
    if (!el || !canvas) return;
    const { notes, selection, ppb, totalBeats, clip } = live.current;
    const w = el.clientWidth;
    const dpr = window.devicePixelRatio || 1;
    if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(VEL_H * dpr)) {
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(VEL_H * dpr);
      canvas.style.width = `${w}px`;
      canvas.style.height = `${VEL_H}px`;
    }
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    colors.current ??= readColors(el);
    const col = colors.current;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = col.bg;
    ctx.fillRect(0, 0, w, VEL_H);
    const sl = el.scrollLeft;
    ctx.fillStyle = col.line;
    ctx.fillRect(0, 0, w, 1);
    for (let b = Math.max(0, Math.floor(sl / ppb)); b <= Math.min(totalBeats, Math.ceil((sl + w) / ppb)); b += live.current.bpb) {
      ctx.fillRect(Math.round(KEYS_W + b * ppb - sl), 0, 1, VEL_H);
    }
    const d = drag.current;
    for (const n of notes) {
      const x = KEYS_W + n.start * ppb - sl;
      if (x < KEYS_W - 8 || x > w) continue;
      const v = d?.kind === "vel" && d.ids.includes(n.id) ? d.v : n.velocity;
      const hgt = Math.max(2, v * (VEL_H - 8));
      ctx.fillStyle = clip.color;
      ctx.globalAlpha = selection.has(n.id) ? 1 : 0.75;
      ctx.fillRect(x, VEL_H - 2 - hgt, Math.max(3, Math.min(8, n.duration * ppb - 1)), hgt);
      ctx.globalAlpha = 1;
      ctx.fillStyle = "#fff";
      ctx.fillRect(x, VEL_H - 2 - hgt, Math.max(3, Math.min(8, n.duration * ppb - 1)), 2);
    }
    ctx.fillStyle = col.bg;
    ctx.fillRect(0, 0, KEYS_W, VEL_H);
    ctx.fillStyle = col.dim;
    ctx.font = "10px ui-monospace, monospace";
    ctx.textBaseline = "middle";
    ctx.fillText("Velocity", 6, 14);
  }, []);

  const invalidate = useCallback(() => {
    cancelAnimationFrame(frame.current);
    frame.current = requestAnimationFrame(draw);
  }, [draw]);

  useLayoutEffect(() => { colors.current = null; invalidate(); });
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const ro = new ResizeObserver(invalidate);
    ro.observe(el);
    return () => { ro.disconnect(); cancelAnimationFrame(frame.current); };
  }, [invalidate]);

  // Start centred on the notes (or on the track's own pitch).
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const ps = notes.length ? notes.map((n) => n.pitch ?? 0) : [0];
    const mid = (Math.max(...ps) + Math.min(...ps)) / 2;
    el.scrollTop = Math.max(0, RULER_H + (pMax - mid) * ROW_H - el.clientHeight / 2);
    el.scrollLeft = 0;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clip.id, track.id]);

  // New notes drawn by the user become the selection.
  useEffect(() => {
    const before = pendingAdd.current;
    if (!before) return;
    pendingAdd.current = null;
    const added = notes.filter((n) => !before.has(n.id)).map((n) => n.id);
    if (added.length) onSelection(added);
  }, [notes, onSelection]);

  // --- audition ---
  const audition = useCallback((pitch: number) => {
    const midi = live.current.chop ? 60 + pitch : live.current.base + pitch;
    c.midiSink.noteOn(midi, 0.8);
    setTimeout(() => c.midiSink.noteOff(midi), 220);
  }, [c.midiSink]);

  // --- pointer ---
  const toBeat = (clientX: number) => {
    const el = scrollRef.current!;
    return (clientX - el.getBoundingClientRect().left - KEYS_W + el.scrollLeft) / live.current.ppb;
  };
  const toPitch = (clientY: number) => {
    const el = scrollRef.current!;
    const row = Math.floor((clientY - el.getBoundingClientRect().top - RULER_H + el.scrollTop) / ROW_H);
    return clamp(live.current.pMax - row, live.current.pMin, live.current.pMax);
  };
  const snapTo = (beats: number, mode: "round" | "floor" = "round") => {
    const s = live.current.snap;
    return (mode === "floor" ? Math.floor(beats / s) : Math.round(beats / s)) * s;
  };
  const hit = (beat: number, pitch: number): { note: Note; edge: boolean } | null => {
    const { notes, ppb } = live.current;
    for (let i = notes.length - 1; i >= 0; i--) {
      const n = notes[i];
      const np = n.chord ? chordRows(n, live.current.scale, live.current.root, live.current.base)[0] : (n.pitch ?? 0);
      if (np !== pitch || beat < n.start || beat > n.start + n.duration) continue;
      return { note: n, edge: (n.start + n.duration - beat) * ppb <= 6 };
    }
    return null;
  };

  const down = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    if (e.button !== 0) return;
    const el = scrollRef.current!;
    const rect = el.getBoundingClientRect();
    const px = e.clientX - rect.left;
    const py = e.clientY - rect.top;
    scrollRef.current?.focus({ preventScroll: true });
    if (py < RULER_H) return;
    const pitch = toPitch(e.clientY);
    if (px < KEYS_W) { audition(pitch); return; }
    e.currentTarget.setPointerCapture(e.pointerId);
    const beat = toBeat(e.clientX);
    cursor.current = clamp(snapTo(beat, "floor"), 0, live.current.totalBeats);
    const h = hit(beat, pitch);
    const sel = live.current.selection;
    if (h) {
      let ids: NoteId[];
      if (e.shiftKey) {
        ids = sel.has(h.note.id) ? [...sel].filter((id) => id !== h.note.id) : [...sel, h.note.id];
        onSelection(ids);
        if (!ids.includes(h.note.id)) return;
      } else {
        ids = sel.has(h.note.id) ? [...sel] : [h.note.id];
        if (!sel.has(h.note.id)) onSelection(ids);
      }
      if (!h.note.chord) audition(h.note.pitch ?? 0);
      drag.current = h.edge ? { kind: "resize", id: h.note.id, x: e.clientX, dur: h.note.duration } : { kind: "move", ids, x: e.clientX, y: e.clientY, dBeats: 0, dPitch: 0 };
    } else if (e.shiftKey) {
      drag.current = { kind: "marquee", x0: px, y0: py, x1: px, y1: py };
    } else {
      onSelection([]);
      const start = clamp(snapTo(beat, "floor"), 0, live.current.totalBeats - live.current.snap);
      drag.current = { kind: "draw", start, pitch, x: e.clientX, y: e.clientY, dur: Math.max(live.current.snap, lastDur.current), moved: false };
    }
    invalidate();
  };
  const move = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    const d = drag.current;
    if (!d) return;
    const { ppb, notes } = live.current;
    if (d.kind === "move") {
      d.dBeats = snapTo((e.clientX - d.x) / ppb);
      d.dPitch = -Math.round((e.clientY - d.y) / ROW_H);
    } else if (d.kind === "resize") {
      const n = notes.find((x) => x.id === d.id);
      if (n) d.dur = Math.max(live.current.snap, snapTo(toBeat(e.clientX) - n.start));
    } else if (d.kind === "draw") {
      if (Math.abs(e.clientX - d.x) > 3) d.moved = true;
      if (d.moved) d.dur = Math.max(live.current.snap, snapTo(toBeat(e.clientX) - d.start));
    } else if (d.kind === "marquee") {
      const rect = scrollRef.current!.getBoundingClientRect();
      d.x1 = e.clientX - rect.left;
      d.y1 = e.clientY - rect.top;
    }
    invalidate();
  };
  const up = () => {
    const d = drag.current;
    drag.current = null;
    if (!d) return;
    const pid = pattern.id;
    if (d.kind === "move" && (d.dBeats !== 0 || d.dPitch !== 0)) dispatch({ type: "ROLL_MOVE_NOTES", patternId: pid, noteIds: d.ids, dStart: d.dBeats, dPitch: d.dPitch, resolution: live.current.snap });
    else if (d.kind === "resize") {
      const n = live.current.notes.find((x) => x.id === d.id);
      if (n && d.dur !== n.duration) { lastDur.current = d.dur; dispatch({ type: "ROLL_RESIZE_NOTE", patternId: pid, noteId: d.id, duration: d.dur, resolution: live.current.snap }); }
    } else if (d.kind === "draw") {
      lastDur.current = d.dur;
      pendingAdd.current = new Set(live.current.notes.map((n) => n.id));
      dispatch({ type: "ROLL_ADD_NOTE", patternId: pid, trackId: track.id, start: d.start, pitch: d.pitch, duration: d.dur, velocity: 0.8, resolution: live.current.snap });
      audition(d.pitch);
    } else if (d.kind === "marquee") {
      const { ppb, pMax } = live.current;
      const el = scrollRef.current!;
      const x0 = Math.min(d.x0, d.x1), x1 = Math.max(d.x0, d.x1), y0 = Math.min(d.y0, d.y1), y1 = Math.max(d.y0, d.y1);
      const picked = live.current.notes.filter((n) => {
        const nx0 = KEYS_W + n.start * ppb - el.scrollLeft;
        const nx1 = nx0 + n.duration * ppb;
        const ny0 = RULER_H + (pMax - (n.chord ? chordRows(n, live.current.scale, live.current.root, live.current.base)[0] : (n.pitch ?? 0))) * ROW_H - el.scrollTop;
        return nx1 >= x0 && nx0 <= x1 && ny0 + ROW_H >= y0 && ny0 <= y1;
      }).map((n) => n.id);
      onSelection([...new Set([...live.current.selection, ...picked])]);
    }
    invalidate();
  };

  // velocity lane
  const velDown = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    const el = scrollRef.current!;
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    if (x < KEYS_W) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    const beat = (x - KEYS_W + el.scrollLeft) / live.current.ppb;
    const ppb = live.current.ppb;
    // nearest note start within a few pixels
    let best: Note | null = null;
    let bestD = 8 / ppb;
    for (const n of live.current.notes) {
      const dist = Math.abs(n.start - beat + Math.min(0.5, n.duration / 2) * 0);
      const inside = beat >= n.start && beat <= n.start + Math.max(8 / ppb, 0);
      if (dist <= bestD || inside) { best = n; bestD = dist; }
    }
    if (!best) return;
    const ids = live.current.selection.has(best.id) ? [...live.current.selection] : [best.id];
    if (!live.current.selection.has(best.id)) onSelection(ids);
    drag.current = { kind: "vel", ids, v: clamp(1 - (e.clientY - rect.top - 4) / (VEL_H - 8), 0.02, 1) };
    invalidate();
  };
  const velMove = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    const d = drag.current;
    if (!d || d.kind !== "vel") return;
    const rect = e.currentTarget.getBoundingClientRect();
    d.v = clamp(1 - (e.clientY - rect.top - 4) / (VEL_H - 8), 0.02, 1);
    invalidate();
  };
  const velUp = () => {
    const d = drag.current;
    drag.current = null;
    if (d?.kind === "vel") dispatch({ type: "ROLL_SET_VELOCITY", patternId: pattern.id, noteIds: d.ids, velocity: d.v });
    invalidate();
  };

  const onKey = (e: ReactKeyboardEvent) => {
    const sel = [...live.current.selection];
    const mod = e.metaKey || e.ctrlKey;
    const pid = pattern.id;
    if ((e.key === "Delete" || e.key === "Backspace") && sel.length) {
      e.preventDefault();
      dispatch({ type: "ROLL_REMOVE_NOTES", patternId: pid, noteIds: sel });
      onSelection([]);
    } else if (mod && e.key.toLowerCase() === "a") {
      e.preventDefault();
      onSelection(live.current.notes.map((n) => n.id));
    } else if (mod && (e.key.toLowerCase() === "c" || e.key.toLowerCase() === "x") && sel.length) {
      e.preventDefault();
      const copied = rollCopyNotes(pattern, sel);
      onCopy(copied);
      if (e.key.toLowerCase() === "x") {
        dispatch({ type: "ROLL_REMOVE_NOTES", patternId: pid, noteIds: sel });
        onSelection([]);
      }
    } else if (mod && e.key.toLowerCase() === "v" && clipboard?.length) {
      e.preventDefault();
      const at = cursor.current;
      pendingAdd.current = new Set(live.current.notes.map((n) => n.id));
      dispatch({ type: "ROLL_PASTE_NOTES", patternId: pid, trackId: track.id, notes: clipboard, at, resolution: live.current.snap });
      cursor.current = at + Math.max(...clipboard.map((n) => n.start + n.duration));
    } else if (mod && e.key.toLowerCase() === "d" && sel.length) {
      e.preventDefault();
      const picked = live.current.notes.filter((n) => sel.includes(n.id));
      const span = Math.max(...picked.map((n) => n.start + n.duration)) - Math.min(...picked.map((n) => n.start));
      pendingAdd.current = new Set(live.current.notes.map((n) => n.id));
      dispatch({ type: "ROLL_DUPLICATE_NOTES", patternId: pid, noteIds: sel, dStart: Math.ceil(span / live.current.snap) * live.current.snap });
    } else if (e.key === "Escape") {
      onSelection([]);
    } else if (sel.length && (e.key === "ArrowLeft" || e.key === "ArrowRight")) {
      e.preventDefault();
      dispatch({ type: "ROLL_MOVE_NOTES", patternId: pid, noteIds: sel, dStart: (e.key === "ArrowRight" ? 1 : -1) * live.current.snap, dPitch: 0, resolution: live.current.snap });
    } else if (sel.length && (e.key === "ArrowUp" || e.key === "ArrowDown")) {
      e.preventDefault();
      dispatch({ type: "ROLL_MOVE_NOTES", patternId: pid, noteIds: sel, dStart: 0, dPitch: (e.key === "ArrowUp" ? 1 : -1) * (e.shiftKey ? 12 : 1) });
    }
  };

  const playhead = usePlayheadAnimation(c.getPlayheadBeat, ppb, true);

  return (
    <div className="v2-roll">
      <div className="v2-roll-bar">
        <label className="v2-field">
          <span>Snap</span>
          <select value={snap} onChange={(e) => setSnap(Number(e.target.value))} aria-label="Grid snap">
            {SNAPS.map((s) => <option key={s.label} value={s.beats}>{s.label}</option>)}
          </select>
        </label>
        <div className="v2-segment" role="group" aria-label="Zoom">
          <button onClick={() => setPpb((p) => clamp(Math.round(p / 1.4), MIN_PX, MAX_PX))} aria-label="Zoom out" title="Zoom out">−</button>
          <button onClick={() => setPpb((p) => clamp(Math.round(p * 1.4), MIN_PX, MAX_PX))} aria-label="Zoom in" title="Zoom in">+</button>
        </div>
        {extraBar}
        <span className="v2-note">{notes.length} note{notes.length === 1 ? "" : "s"}{selection.size ? ` · ${selection.size} selected` : ""}</span>
        <span className="v2-note hint">click draws · drag moves · edge resizes · ⇧ drag selects · ⌫ deletes · ⌘D duplicates</span>
      </div>
      <div className="v2-roll-scroll v2-scroll" ref={scrollRef} tabIndex={0} onKeyDown={onKey} onScroll={() => { velScrollSync.current = scrollRef.current?.scrollLeft ?? 0; if (autoInner.current) autoInner.current.style.transform = `translateX(${KEYS_W - velScrollSync.current}px)`; invalidate(); }} aria-label="Piano roll">
        <div className="v2-roll-spacer" style={{ width: contentW, height: contentH }}>
          <canvas ref={canvasRef} className="v2-roll-canvas" onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up} onDoubleClick={(e) => {
            const h = hit(toBeat(e.clientX), toPitch(e.clientY));
            if (h) dispatch({ type: "ROLL_REMOVE_NOTES", patternId: pattern.id, noteIds: [h.note.id] });
          }} />
          <div className="v2-roll-playhead-layer" style={{ left: KEYS_W }}>
            <div className="v2-playhead" ref={playhead} style={{ display: "none" }} />
          </div>
        </div>
      </div>
      <canvas ref={velRef} className="v2-roll-vel" height={VEL_H} onPointerDown={velDown} onPointerMove={velMove} onPointerUp={velUp} onPointerCancel={velUp} />
      <div className="v2-auto-bar">{automationPicker}</div>
      {automationRow && (
        <div className="v2-auto" style={{ height: AUTOMATION_LANE_HEIGHT + 4 }}>
          <div className="v2-auto-keys" style={{ width: KEYS_W }}>{automationRow.paramDef.label}</div>
          <div className="v2-auto-inner" ref={autoInner} style={{ width: totalBeats * ppb, transform: `translateX(${KEYS_W - (scrollRef.current?.scrollLeft ?? 0)}px)` }}>
            <AutomationLane lane={automationRow.lane} paramDef={automationRow.paramDef} totalBeats={totalBeats} beatsPerBar={bpb} pxPerBeat={ppb} height={AUTOMATION_LANE_HEIGHT} visibleStart={0} visibleEnd={totalBeats} onSetPoint={automationRow.onSetPoint} onRemovePoint={automationRow.onRemovePoint} />
          </div>
        </div>
      )}
    </div>
  );
});
