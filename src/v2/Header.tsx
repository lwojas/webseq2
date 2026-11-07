import { memo, useEffect, useState } from "react";
import type { Webseq } from "../controller/useWebseq";
import { MAX_BPM, MAX_SWING, MIN_BPM, MIN_SWING } from "../model/project";
import { formatScale } from "../model/scale";
import { useRafText } from "../hooks/useRafText";
import { ScaleControl } from "../components/ScaleControl";
import { MidiStatus } from "../components/MidiStatus";
import { VIEWS, type View } from "./workspace";

interface Props {
  c: Webseq;
  view: View;
  onView: (view: View) => void;
  browserOpen: boolean;
  onToggleBrowser: () => void;
  status: string | null;
}

/** The one row that is always there: project, destination tabs, transport, key, MIDI, undo/redo. Nothing else lives up here. */
export const Header = memo(function Header({ c, view, onView, browserOpen, onToggleBrowser, status }: Props) {
  const t = c.transportProps;
  const position = useRafText(c.playbackSource === "pattern" ? c.getPositionText : c.getSongText);
  const resampleLive = useRafText(c.getResampleLabel);
  const [scaleOpen, setScaleOpen] = useState(false);
  useEffect(() => {
    if (!scaleOpen) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setScaleOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [scaleOpen]);
  const playing = t.status === "playing";
  const bpmLocked = t.followedBpm !== null || t.resamplePhase === "pending" || t.resamplePhase === "processing";
  const bpm = t.followedBpm ?? t.bpm;

  return (
    <header className="v2-header">
      <div className="v2-header-group">
        <button className={`v2-icon-btn ${browserOpen ? "on" : ""}`} onClick={onToggleBrowser} aria-pressed={browserOpen} title="Browser  [B]" aria-label="Toggle browser">
          <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
            <path d="M1 2.5h12M1 7h12M1 11.5h12" stroke="currentColor" strokeWidth="1.3" fill="none" />
          </svg>
        </button>
        <span className="v2-brand">WEBSEQ</span>
        <input className="v2-project-name" value={c.project.name} onChange={(e) => c.dispatch({ type: "SET_PROJECT_NAME", name: e.target.value })} aria-label="Project name" spellCheck={false} />
        <button className="v2-btn" onClick={c.handleSaveProject} disabled={c.saveStatus === "saving"} title="Save to this browser  [⌘S]">
          {c.saveStatus === "saving" ? "Saving…" : "Save"}
        </button>
        {status && <span className="v2-note ok v2-status" role="status" title={status}>{status}</span>}
        {c.saveStatus === "saved" && <span className="v2-note ok">Saved</span>}
        {c.saveStatus === "error" && <span className="v2-note bad" title={c.saveError ?? undefined}>Save failed</span>}
      </div>

      <nav className="v2-tabs" aria-label="Workspace">
        {VIEWS.map((v) => (
          <button key={v.id} className={`v2-tab ${view === v.id ? "active" : ""}`} aria-current={view === v.id ? "page" : undefined} onClick={() => onView(v.id)} title={`${v.label}  [${v.key}]`}>
            {v.label}
          </button>
        ))}
      </nav>

      <div className="v2-header-group v2-transport" role="group" aria-label="Transport">
        <button className={`v2-btn transport ${playing ? "on" : ""}`} onClick={playing ? t.onPause : t.onPlay} title={playing ? "Pause  [Space]" : "Play  [Space]"} aria-label={playing ? "Pause" : "Play"}>
          <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true" fill="currentColor">
            {playing ? <path d="M2.5 1h2.5v10H2.5zM7 1h2.5v10H7z" /> : <path d="M3 1.2v9.6L10.6 6z" />}
          </svg>
        </button>
        <button className="v2-btn transport" onClick={t.onStop} disabled={t.status === "stopped"} title="Stop and return to the start" aria-label="Stop">
          <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true" fill="currentColor"><path d="M2 2h8v8H2z" /></svg>
        </button>
        {c.playbackSource === "pattern" && <button className="v2-btn on" onClick={() => c.handleSetSource("song")} title="Playing the pattern queue. Click to play the arrangement instead.">Queue</button>}
        <span className="v2-position" ref={position} aria-label="Song position" />
        <label className="v2-field" title={t.followedBpm !== null ? "Following the host's tempo" : "Tempo"}>
          <input type="number" min={MIN_BPM} max={MAX_BPM} value={bpm} disabled={bpmLocked} onChange={(e) => t.onBpmChange(Number(e.target.value))} aria-label="BPM" />
          <span>BPM</span>
        </label>
        <label className="v2-field" title="Swing">
          <input type="range" min={MIN_SWING * 100} max={MAX_SWING * 100} value={Math.round(t.swing * 100)} disabled={bpmLocked} onChange={(e) => t.onSwingChange(Number(e.target.value) / 100)} aria-label="Swing" />
          <span>{Math.round(t.swing * 100)}%</span>
        </label>
        <div className="v2-popover-anchor">
          <button className={`v2-btn ${scaleOpen ? "on" : ""}`} onClick={() => setScaleOpen(!scaleOpen)} aria-expanded={scaleOpen} title="Key and scale">
            {formatScale(t.scale)}
          </button>
          {scaleOpen && (
            <div className="v2-popover" role="dialog" aria-label="Key and scale">
              <ScaleControl scale={t.scale} onChange={t.onScaleChange} onOpenGuide={() => { setScaleOpen(false); t.onOpenGuide(); }} />
            </div>
          )}
        </div>
        <button className={`v2-btn v2-secondary ${t.resamplePhase !== "idle" ? "on" : ""}`} onClick={t.onResample} disabled={!t.canResample} title={t.canResample ? "Bounce one pass of what is playing into a new sample in Assets" : "Play something first"}>
          Bounce
        </button>
        {t.resamplePhase === "pending" && <span className="v2-note" ref={resampleLive} />}
        {t.resamplePhase === "processing" && <span className="v2-note">processing</span>}
        {t.resamplePhase === "complete" && <span className="v2-note ok">bounced</span>}
        {t.resamplePhase === "error" && <span className="v2-note bad" title={t.resampleError ?? undefined}>bounce failed</span>}
      </div>

      <div className="v2-header-group v2-header-end">
        <MidiStatus midi={c.midi} />
        <button className="v2-btn" onClick={c.handleUndo} disabled={!c.canUndo} title="Undo  [⌘Z]">↶</button>
        <button className="v2-btn" onClick={c.handleRedo} disabled={!c.canRedo} title="Redo  [⇧⌘Z]">↷</button>
      </div>
    </header>
  );
});
