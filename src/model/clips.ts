// Clips: the arrangement as DAWs draw it. A TRACK has a timeline row; CLIPS sit on it; a clip holds that track's notes.
//
// Underneath this is the Composer, unchanged: a clip is a ComposerSequence on a lane whose `trackId` names the track, and its
// notes are the sequence's pattern (`Pattern.clipOf` = the track). So song playback, automation replay, the host Sequence export,
// undo, and the project file all keep working with no new format. This module is the track-centric view and the only new rules:
//
//   * a lane with `trackId` is that track's row; clips on one lane never overlap (the Composer's rule); a track may own extra lanes
//   * a clip's pattern holds notes for its own track only
//   * V1 songs (lanes without trackId, one sequence = many tracks) are split per track by normaliseSong, baking lane modifiers in
//
// Pure functions over Project, like the rest of src/model.
import { COMPOSER_COLORS, canPlace, composerLanes, firstFreeStart, sequenceEnd, effectiveModifiers } from "./composer";
import { MAX_PATTERN_BARS, extendBarsByRepeat } from "./notes";
import { copyTrackConfig, pasteTrackConfig, type CopiedTrackConfig } from "./trackConfig";
import { BANK_SIZE } from "./project";
import type { AutomationLane, LaneModifiers, ComposerLane, PatternTrackSettings, ComposerSequence, LaneId, Note, Pattern, PatternId, Project, SequenceId, TrackId } from "./types";

export interface Clip {
  /** The sequence id: the clip's identity everywhere (selection, move, resize). */
  id: SequenceId;
  trackId: TrackId;
  laneId: LaneId;
  patternId: PatternId;
  /** Start, in whole bars. */
  start: number;
  bars: number;
  color: string;
  name: string;
  /** The clip's own transpose / velocity / gate (on top of its row's). */
  modifiers?: LaneModifiers;
  /** The clip's notes are switched off (Pattern.offTracks for its track): it stays on the timeline but plays nothing. */
  off?: boolean;
}

let idCounter = 0;
function uid(prefix: string): string {
  idCounter += 1;
  return `${prefix}-${idCounter}-${Math.random().toString(36).slice(2, 8)}`;
}

// --- reading ---

export function trackLanes(project: Project, trackId: TrackId): ComposerLane[] {
  return composerLanes(project).filter((l) => l.trackId === trackId);
}

function toClip(project: Project, lane: ComposerLane, seq: ComposerSequence): Clip | null {
  const pattern = project.patterns.find((p) => p.id === seq.patternId);
  if (!pattern || !lane.trackId) return null;
  return { id: seq.id, trackId: lane.trackId, laneId: lane.id, patternId: pattern.id, start: seq.start, bars: pattern.bars, color: seq.color, name: pattern.name, ...(seq.modifiers ? { modifiers: seq.modifiers } : {}), ...(pattern.offTracks?.[lane.trackId] ? { off: true } : {}) };
}

/** Every clip of the track, by start. */
export function clipsOnTrack(project: Project, trackId: TrackId): Clip[] {
  const out: Clip[] = [];
  for (const lane of trackLanes(project, trackId)) for (const seq of lane.sequences) {
    const clip = toClip(project, lane, seq);
    if (clip) out.push(clip);
  }
  return out.sort((a, b) => a.start - b.start);
}

export function allClips(project: Project): Clip[] {
  const out: Clip[] = [];
  for (const lane of composerLanes(project)) for (const seq of lane.sequences) {
    const clip = toClip(project, lane, seq);
    if (clip) out.push(clip);
  }
  return out;
}

export function clipById(project: Project, id: SequenceId | null): Clip | undefined {
  if (!id) return undefined;
  for (const lane of composerLanes(project)) {
    const seq = lane.sequences.find((s) => s.id === id);
    if (seq) return toClip(project, lane, seq) ?? undefined;
  }
  return undefined;
}

/** The clip on `trackId` that covers `bar` (0-based), if any. */
export function clipAtBar(project: Project, trackId: TrackId, bar: number): Clip | undefined {
  return clipsOnTrack(project, trackId).find((c) => bar >= c.start && bar < c.start + c.bars);
}

/** The bar after the last clip in the song (at least 4, so an empty song still has a timeline to draw on). */
export function songLengthBars(project: Project): number {
  let end = 0;
  for (const lane of composerLanes(project)) end = Math.max(end, ...lane.sequences.map((s) => sequenceEnd(project, s)));
  return Math.max(4, end);
}

/** Patterns that are not clip content: the V1 launcher patterns the Browser offers. */
export function launcherPatterns(project: Project): Pattern[] {
  return project.patterns.filter((p) => !p.clipOf);
}

// --- writing ---

function setLanes(project: Project, lanes: ComposerLane[]): Project {
  return { ...project, composer: { lanes } };
}

/** The lane of `trackId` where `bars` fit at `start`, creating one when none does. */
function laneFor(project: Project, trackId: TrackId, start: number, bars: number, ignoreId?: SequenceId): { project: Project; laneId: LaneId } {
  const fits = trackLanes(project, trackId).find((l) => canPlace(project, l.id, start, bars, ignoreId));
  if (fits) return { project, laneId: fits.id };
  const track = project.tracks.find((t) => t.id === trackId);
  const lane: ComposerLane = { id: uid("lane"), name: track?.name ?? trackId, sequences: [], trackId };
  return { project: setLanes(project, [...composerLanes(project), lane]), laneId: lane.id };
}

function trackColor(project: Project, trackId: TrackId): string {
  const index = Math.max(0, project.tracks.findIndex((t) => t.id === trackId));
  return COMPOSER_COLORS[index % COMPOSER_COLORS.length];
}

function place(project: Project, trackId: TrackId, start: number, pattern: Pattern, color?: string, modifiers?: LaneModifiers): { project: Project; clipId: SequenceId } | null {
  if (!Number.isInteger(start) || start < 0 || pattern.bars < 1 || pattern.bars > MAX_PATTERN_BARS) return null;
  const target = laneFor(project, trackId, start, pattern.bars);
  const seq: ComposerSequence = { id: uid("seq"), patternId: pattern.id, start, color: color ?? trackColor(project, trackId), ...(modifiers ? { modifiers } : {}) };
  const withPattern: Project = { ...target.project, patterns: [...target.project.patterns, pattern] };
  const lanes = composerLanes(withPattern).map((l) => (l.id === target.laneId ? { ...l, sequences: [...l.sequences, seq].sort((a, b) => a.start - b.start) } : l));
  return { project: setLanes(withPattern, lanes), clipId: seq.id };
}

/** A new empty clip on `trackId` at bar `start`. Rejected (null) off the timeline. */
export function createClip(project: Project, trackId: TrackId, start: number, bars = 1, name?: string): { project: Project; clipId: SequenceId } | null {
  if (!project.tracks.some((t) => t.id === trackId)) return null;
  const count = clipsOnTrack(project, trackId).length;
  return place(project, trackId, start, { id: uid("pattern"), name: name ?? `Clip ${count + 1}`, bars, notes: {}, clipOf: trackId });
}

/** A copy of the clip right after it (first free slot at or after its end on the same row). Notes are independent of the original. */
export function duplicateClip(project: Project, id: SequenceId): { project: Project; clipId: SequenceId } | null {
  const clip = clipById(project, id);
  const source = clip && project.patterns.find((p) => p.id === clip.patternId);
  if (!clip || !source) return null;
  const notes: Record<string, Note> = {};
  for (const note of Object.values(source.notes)) {
    const copy = { ...note, id: uid("note") };
    notes[copy.id] = copy;
  }
  const lane = composerLanes(project).find((l) => l.id === clip.laneId);
  const start = lane ? firstFreeStart(project, lane.id, clip.bars, clip.start + clip.bars) : clip.start + clip.bars;
  return place(project, clip.trackId, start, { ...source, id: uid("pattern"), name: `${source.name} copy`, notes, clipOf: clip.trackId }, clip.color, clip.modifiers);
}

/** Moves a clip to bar `start` on its own row. Unchanged if it would overlap another clip or leave the timeline. */
export function moveClip(project: Project, id: SequenceId, start: number): Project {
  const clip = clipById(project, id);
  if (!clip || clip.start === start || !Number.isInteger(start) || start < 0) return project;
  // The track's first row where it fits (so a clip settles back onto the main row when the way is clear), else a new extra row.
  const target = laneFor(project, clip.trackId, start, clip.bars, id);
  const seq = composerLanes(project).flatMap((l) => l.sequences).find((s) => s.id === id);
  if (!seq) return project;
  const moved = { ...seq, start };
  const lanes = composerLanes(target.project).map((l) => {
    if (l.id === clip.laneId && l.id === target.laneId) return { ...l, sequences: l.sequences.map((s) => (s.id === id ? moved : s)).sort((a, b) => a.start - b.start) };
    if (l.id === clip.laneId) return { ...l, sequences: l.sequences.filter((s) => s.id !== id) };
    if (l.id === target.laneId) return { ...l, sequences: [...l.sequences, moved].sort((a, b) => a.start - b.start) };
    return l;
  });
  return dropEmptyExtraLanes(setLanes(target.project, lanes), clip.trackId);
}

/** A track's extra lanes exist only to hold overlapping clips; once one is empty it goes (the first stays as the row). */
function dropEmptyExtraLanes(project: Project, trackId: TrackId): Project {
  const mine = trackLanes(project, trackId);
  if (mine.length < 2) return project;
  const keep = new Set(mine.filter((l, i) => i === 0 || l.sequences.length > 0).map((l) => l.id));
  if (keep.size === mine.length) return project;
  return setLanes(project, composerLanes(project).filter((l) => l.trackId !== trackId || keep.has(l.id)));
}

/** Sets the clip's length. Growing loops its content (the Composer's rule), shrinking drops notes past the end. Unchanged if it would
 * run into the next clip. */
export function resizeClip(project: Project, id: SequenceId, bars: number): Project {
  const clip = clipById(project, id);
  if (!clip || !Number.isInteger(bars) || bars < 1 || bars > MAX_PATTERN_BARS || bars === clip.bars) return project;
  const lane = composerLanes(project).find((l) => l.id === clip.laneId);
  if (!lane || !canPlace(project, lane.id, clip.start, bars, id)) return project;
  return {
    ...project,
    patterns: project.patterns.map((p) => {
      if (p.id !== clip.patternId) return p;
      if (bars > p.bars) return extendBarsByRepeat(p, project.beatsPerBar, bars);
      const total = bars * project.beatsPerBar;
      const notes: Pattern["notes"] = {};
      for (const [noteId, note] of Object.entries(p.notes)) if (note.start < total) notes[noteId] = note;
      return { ...p, bars, notes };
    }),
  };
}

export function renameClip(project: Project, id: SequenceId, name: string): Project {
  const clip = clipById(project, id);
  if (!clip || !name.trim()) return project;
  return { ...project, patterns: project.patterns.map((p) => (p.id === clip.patternId ? { ...p, name } : p)) };
}

export function setClipColor(project: Project, id: SequenceId, color: string): Project {
  const clip = clipById(project, id);
  if (!clip || clip.color === color) return project;
  return setLanes(project, composerLanes(project).map((l) => (l.id === clip.laneId ? { ...l, sequences: l.sequences.map((s) => (s.id === id ? { ...s, color } : s)) } : l)));
}

/** Removes the clip. Its pattern goes with it unless something else (another clip, the pattern queue) still plays it. */
export function deleteClip(project: Project, id: SequenceId): Project {
  const clip = clipById(project, id);
  if (!clip) return project;
  let next = setLanes(project, composerLanes(project).map((l) => (l.id === clip.laneId ? { ...l, sequences: l.sequences.filter((s) => s.id !== id) } : l)));
  const stillUsed = composerLanes(next).some((l) => l.sequences.some((s) => s.patternId === clip.patternId)) || next.patternChain.some((e) => e.patternId === clip.patternId);
  if (!stillUsed) next = { ...next, patterns: next.patterns.filter((p) => p.id !== clip.patternId || !p.clipOf) };
  return dropEmptyExtraLanes(next, clip.trackId);
}

// --- patterns -> clips ---

/** The tracks a pattern plays something on: notes, or automation of its own. */
function tracksOfPattern(project: Project, pattern: Pattern): TrackId[] {
  const used = new Set(Object.values(pattern.notes).map((n) => n.trackId));
  for (const t of project.tracks) if (pattern.automation?.[t.id]?.some((l) => l.events.length > 0)) used.add(t.id);
  return project.tracks.filter((t) => used.has(t.id)).map((t) => t.id);
}

/** One track's share of a pattern, as clip content: its notes (fresh ids), its own arp/LFO/automation/off settings. */
function clipPatternOf(source: Pattern, trackId: TrackId, extra?: Partial<Pattern>): Pattern {
  const notes: Record<string, Note> = {};
  for (const note of Object.values(source.notes)) {
    if (note.trackId !== trackId) continue;
    const copy = { ...note, id: uid("note") };
    notes[copy.id] = copy;
  }
  const out: Pattern = { id: uid("pattern"), name: source.name, bars: source.bars, notes, clipOf: trackId, ...extra };
  if (source.trackSettings?.[trackId]) out.trackSettings = { [trackId]: source.trackSettings[trackId] };
  if (source.automation?.[trackId]) out.automation = { ...out.automation, [trackId]: source.automation[trackId] };
  if (source.offTracks?.[trackId]) out.offTracks = { [trackId]: true };
  return out;
}

/** Puts a V1 pattern on the timeline at bar `start`: one clip per track the pattern plays (the pattern itself stays in the Browser).
 * The pattern's master automation rides on the first clip. Rejected (unchanged) when any of its tracks' rows is full there. */
export function insertPatternAsClips(project: Project, patternId: PatternId, start: number): Project {
  const source = project.patterns.find((p) => p.id === patternId);
  if (!source) return project;
  const baked = source;
  const tracks = tracksOfPattern(project, baked);
  if (tracks.length === 0) return project;
  let next = project;
  tracks.forEach((trackId, i) => {
    const extra: Partial<Pattern> | undefined = i === 0 && baked.automation?.master ? { automation: { master: baked.automation.master } } : undefined;
    const placed = place(next, trackId, start, clipPatternOf(baked, trackId, extra));
    if (placed) next = placed.project;
  });
  return next;
}

// --- V1 songs ---

/** Brings a song made of V1 sequences (lanes with no trackId) to clips: each sequence becomes one clip per track it plays, at the same
 * bar and length, in the track's own row. A lane's modifiers become each clip's own (still adjustable), so it sounds the same. The V1 patterns stay in the
 * pattern list (the Browser's Patterns), so nothing is lost; the pattern queue is untouched. A project with no V1 lanes is returned as is. */
export function normaliseSong(project: Project): Project {
  return layOutQueue(splitLegacySequences(project));
}

/** A V1 project made in Pattern mode has all its notes in patterns and nothing on the timeline, so V2 would show it empty. When the song
 * has never been arranged (no sequences, no clips), the pattern queue is laid out end to end from bar 1, in queue order, so the notes
 * appear as clips and play the way the queue did. The patterns stay in the Browser. Once the timeline has any lane of clips this never
 * runs again, so deleting clips in V2 does not bring them back. */
function layOutQueue(project: Project): Project {
  const lanes = composerLanes(project);
  if (lanes.some((l) => l.trackId || l.sequences.length > 0)) return project;
  let next = project;
  let at = 0;
  for (const entry of project.patternChain) {
    const pattern = project.patterns.find((p) => p.id === entry.patternId);
    if (!pattern) continue;
    const placed = insertPatternAsClips(next, pattern.id, at);
    if (placed !== next) {
      next = placed;
      at += pattern.bars;
    }
  }
  return next;
}

function splitLegacySequences(project: Project): Project {
  const lanes = composerLanes(project);
  const legacy = lanes.filter((l) => !l.trackId);
  if (legacy.length === 0) return project;
  let next = setLanes(project, lanes.filter((l) => l.trackId));
  for (const lane of legacy) {
    for (const seq of lane.sequences) {
      const source = project.patterns.find((p) => p.id === seq.patternId);
      if (!source) continue;
      const own = effectiveModifiers(lane, seq);
      const modifiers = own.transpose === 0 && own.velocity === 1 && own.gate === 1 ? undefined : own;
      const tracks = tracksOfPattern(project, source);
      tracks.forEach((trackId, i) => {
        const extra: Partial<Pattern> | undefined = i === 0 && source.automation?.master ? { automation: { master: source.automation.master } } : undefined;
        const placed = place(next, trackId, seq.start, clipPatternOf(source, trackId, extra), seq.color, modifiers);
        if (placed) next = placed.project;
      });
    }
  }
  return next;
}

/** True when the project's song still has V1 sequences to split (so the UI can say it normalised a V1 song). */
export function hasLegacySong(project: Project): boolean {
  return composerLanes(project).some((l) => !l.trackId && l.sequences.length > 0);
}

// --- copy / paste ---
//
// A clip is copied as plain data (its notes, length, colour and its track's per-clip arp/LFO/automation), so it can be pasted on any
// track, later, in another project session. Tracks and banks copy their configuration together with their clips.

export interface ClipData {
  name: string;
  bars: number;
  color: string;
  notes: Note[];
  trackSettings?: PatternTrackSettings;
  automation?: AutomationLane[];
  off?: boolean;
  modifiers?: LaneModifiers;
}

export function copyClip(project: Project, id: SequenceId): ClipData | null {
  const clip = clipById(project, id);
  const pattern = clip && project.patterns.find((p) => p.id === clip.patternId);
  if (!clip || !pattern) return null;
  return {
    name: pattern.name,
    bars: pattern.bars,
    color: clip.color,
    notes: Object.values(pattern.notes).filter((n) => n.trackId === clip.trackId).map((n) => ({ ...n })),
    ...(pattern.trackSettings?.[clip.trackId] ? { trackSettings: pattern.trackSettings[clip.trackId] } : {}),
    ...(pattern.automation?.[clip.trackId] ? { automation: pattern.automation[clip.trackId] } : {}),
    ...(pattern.offTracks?.[clip.trackId] ? { off: true } : {}),
    ...(clip.modifiers ? { modifiers: clip.modifiers } : {}),
  };
}

function patternFromData(data: ClipData, trackId: TrackId, name = data.name): Pattern {
  const notes: Record<string, Note> = {};
  for (const n of data.notes) {
    const copy: Note = { ...n, id: uid("note"), trackId };
    notes[copy.id] = copy;
  }
  const out: Pattern = { id: uid("pattern"), name, bars: data.bars, notes, clipOf: trackId };
  if (data.trackSettings) out.trackSettings = { [trackId]: data.trackSettings };
  if (data.automation) out.automation = { [trackId]: data.automation };
  if (data.off) out.offTracks = { [trackId]: true };
  return out;
}

/** Pastes a copied clip on `trackId` at bar `start`, or at the first free slot after it. */
export function pasteClip(project: Project, data: ClipData, trackId: TrackId, start: number): { project: Project; clipId: SequenceId } | null {
  if (!project.tracks.some((t) => t.id === trackId)) return null;
  const lanes = trackLanes(project, trackId);
  let at = Math.max(0, Math.round(start));
  if (lanes.length > 0) at = firstFreeStart(project, lanes[0].id, data.bars, at);
  return place(project, trackId, at, patternFromData(data, trackId), data.color, data.modifiers);
}

export interface TrackData {
  config: CopiedTrackConfig;
  clips: (ClipData & { start: number })[];
}

export function copyTrackData(project: Project, trackId: TrackId): TrackData | null {
  const track = project.tracks.find((t) => t.id === trackId);
  if (!track) return null;
  const clips = clipsOnTrack(project, trackId).flatMap((c) => {
    const data = copyClip(project, c.id);
    return data ? [{ ...data, start: c.start }] : [];
  });
  return { config: copyTrackConfig(track), clips };
}

function removeTrackClips(project: Project, trackId: TrackId): Project {
  let next = project;
  for (const c of clipsOnTrack(project, trackId)) next = deleteClip(next, c.id);
  return next;
}

/** Replaces the track's configuration and all its clips with the copy (routing is left alone, as in V1's track paste). */
export function pasteTrackData(project: Project, trackId: TrackId, data: TrackData): Project {
  if (!project.tracks.some((t) => t.id === trackId)) return project;
  let next = pasteTrackConfig(removeTrackClips(project, trackId), trackId, data.config);
  for (const c of data.clips) next = place(next, trackId, c.start, patternFromData(c, trackId), c.color, c.modifiers)?.project ?? next;
  return next;
}

export interface BankData {
  tracks: TrackData[];
}

export function copyBankData(project: Project, bank: number): BankData {
  return { tracks: project.tracks.slice(bank * BANK_SIZE, (bank + 1) * BANK_SIZE).flatMap((t) => copyTrackData(project, t.id) ?? []) };
}

/** Pastes a copied bank onto bank `bank`, track for track. */
export function pasteBankData(project: Project, bank: number, data: BankData): Project {
  const targets = project.tracks.slice(bank * BANK_SIZE, (bank + 1) * BANK_SIZE);
  let next = project;
  targets.forEach((t, i) => {
    if (data.tracks[i]) next = pasteTrackData(next, t.id, data.tracks[i]);
  });
  return next;
}

/** Empties a clip (keeps its length): V1's "Clear Sequence". */
export function clearClip(project: Project, id: SequenceId): Project {
  const clip = clipById(project, id);
  if (!clip) return project;
  return { ...project, patterns: project.patterns.map((p) => (p.id === clip.patternId ? { ...p, notes: {} } : p)) };
}
