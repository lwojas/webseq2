// V2 workspace state: which destination is showing, which clip is selected, and the sizes of the resizable panels.
//
// View and selection are plain React state (they change on a click). Panel sizes are CSS variables on the shell element: a
// splitter drag writes the variable directly and only commits to state (and localStorage) on release, so dragging a panel edge
// never re-renders the application.
import { useCallback, useEffect, useRef, useState } from "react";
import type { BankData, ClipData, TrackData } from "../model/clips";
import type { CopiedRollNote } from "../model/roll";
import type { PatternId, SequenceId } from "../model/types";

export type View = "arrange" | "editor" | "mixer";
export const VIEWS: { id: View; label: string; key: string }[] = [
  { id: "arrange", label: "Arrange", key: "1" },
  { id: "editor", label: "Editor", key: "2" },
  { id: "mixer", label: "Mixer", key: "3" },
];

/** What Copy has put aside, one slot per kind (so copying notes never discards a copied clip). Instrument / FX / Modulation copies are
 * the controller's (V1's clipboard rows); these are the kinds that are new with clips. */
export interface Clipboard {
  clip?: ClipData;
  notes?: CopiedRollNote[];
  track?: { data: TrackData; from: string };
  bank?: { data: BankData; from: string };
}

const STORAGE_KEY = "webseq.v2.layout";

export interface Sizes {
  browserWidth: number;
  browserOpen: boolean;
  deviceHeight: number;
  deviceOpen: boolean;
}
const DEFAULT_SIZES: Sizes = { browserWidth: 232, browserOpen: true, deviceHeight: 260, deviceOpen: true };
export const LIMITS = { browserWidth: [160, 480], deviceHeight: [120, 640] } as const;

function loadSizes(): Sizes {
  try {
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}") as Partial<Sizes>;
    return {
      browserWidth: clamp(raw.browserWidth ?? DEFAULT_SIZES.browserWidth, ...LIMITS.browserWidth),
      browserOpen: raw.browserOpen ?? DEFAULT_SIZES.browserOpen,
      deviceHeight: clamp(raw.deviceHeight ?? DEFAULT_SIZES.deviceHeight, ...LIMITS.deviceHeight),
      deviceOpen: raw.deviceOpen ?? DEFAULT_SIZES.deviceOpen,
    };
  } catch {
    return DEFAULT_SIZES;
  }
}

export const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

export function useWorkspace() {
  const [view, setView] = useState<View>("arrange");
  const [clipId, setClipIdRaw] = useState<SequenceId | null>(null);
  // A V1 launcher pattern being edited directly (per track) instead of a clip.
  const [patternEdit, setPatternEdit] = useState<PatternId | null>(null);
  const setClipId = useCallback((id: SequenceId | null) => {
    setClipIdRaw(id);
    if (id) setPatternEdit(null);
  }, []);
  const [sizes, setSizes] = useState<Sizes>(loadSizes);
  const shellRef = useRef<HTMLDivElement>(null);
  const [clipboard, setClipboard] = useState<Clipboard>({});
  const [status, setStatusText] = useState<string | null>(null);
  const statusTimer = useRef<ReturnType<typeof setTimeout>>();
  const say = useCallback((text: string) => {
    setStatusText(text);
    clearTimeout(statusTimer.current);
    statusTimer.current = setTimeout(() => setStatusText(null), 2600);
  }, []);
  const copyToClipboard = useCallback((patch: Partial<Clipboard>) => setClipboard((c) => ({ ...c, ...patch })), []);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(sizes));
    } catch {
      /* layout just won't be remembered */
    }
  }, [sizes]);

  const patchSizes = useCallback((patch: Partial<Sizes>) => setSizes((s) => ({ ...s, ...patch })), []);
  return { view, setView, clipId, setClipId, patternEdit, setPatternEdit, sizes, patchSizes, shellRef, clipboard, copyToClipboard, status, say };
}

export type Workspace = ReturnType<typeof useWorkspace>;
