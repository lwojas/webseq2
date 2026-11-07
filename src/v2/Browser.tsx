import { memo, useMemo, type ReactNode } from "react";
import type { Webseq } from "../controller/useWebseq";
import { AssetsPanel } from "../components/AssetsPanel";
import { FX_DEFS } from "../model/fx";
import { INSTRUMENT_DEFS, INSTRUMENT_KINDS } from "../model/instruments";
import { allClips, launcherPatterns } from "../model/clips";
import { trackHasSource } from "../model/types";
import type { InstrumentKindId, FxType } from "../model/types";
import type { Workspace } from "./workspace";

function Section({ title, hint, defaultOpen = false, children }: { title: string; hint?: string; defaultOpen?: boolean; children: ReactNode }) {
  return (
    <details className="v2-section" open={defaultOpen}>
      <summary>
        <span>{title}</span>
        {hint && <span className="v2-section-hint">{hint}</span>}
      </summary>
      <div className="v2-section-body">{children}</div>
    </details>
  );
}

const CATEGORY_LABEL: Record<string, string> = { drum: "Drums", bass: "Bass", synth: "Synths" };

/** Everything you can bring into the project, in one tree: projects, samples, instruments, effects, V1 patterns. Items that act on "the
 * selected track" say which. One scroll region; no tabs. */
export const Browser = memo(function Browser({ c, ws }: { c: Webseq; ws: Workspace }) {
  const selected = c.selectedTarget === "master" ? null : c.selectedTrack ?? null;
  const target = selected ? `${String(c.selectedIndex + 1).padStart(2, "0")} ${trackHasSource(selected) ? selected.name : "empty"}` : "Master";
  const unavailable = new Set<InstrumentKindId>(c.unavailableKinds);
  const groups = useMemo(() => {
    const by = new Map<string, InstrumentKindId[]>();
    for (const kind of INSTRUMENT_KINDS) {
      const cat = INSTRUMENT_DEFS[kind].category;
      by.set(cat, [...(by.get(cat) ?? []), kind]);
    }
    return [...by.entries()];
  }, []);
  const patterns = launcherPatterns(c.project);
  const insertAt = allClips(c.project).reduce((end, clip) => Math.max(end, clip.start + clip.bars), 0);

  return (
    <aside className="v2-browser" aria-label="Browser">
      <div className="v2-browser-target" title="Items below that act on a track use this one">
        <span>Acts on</span>
        <strong>{target}</strong>
      </div>
      <div className="v2-browser-scroll">
        <Section title="Project" defaultOpen>
          <div className="v2-row-actions">
            <button className="v2-btn" onClick={c.handleNewProject}>New</button>
            <button className="v2-btn" onClick={c.handleImportProject} title="Open a .webseq.json file">Import…</button>
            <button className="v2-btn" onClick={c.handleExportProject} title="Download this project as a file, with its samples">Export…</button>
          </div>
          {c.fileError && <div className="v2-note bad">{c.fileError}</div>}
          <ul className="v2-list" aria-label="Saved projects">
            {c.savedProjects.length === 0 && <li className="v2-empty">Nothing saved in this browser yet.</li>}
            {c.savedProjects.map((p) => (
              <li key={p.id}>
                <button className={`v2-list-item ${c.loadTargetId === p.id ? "selected" : ""}`} onClick={() => c.setLoadTargetId(p.id)} onDoubleClick={c.handleLoadProject}>
                  {p.name || "Untitled"}
                </button>
              </li>
            ))}
          </ul>
          {c.savedProjects.length > 0 && (
            <div className="v2-row-actions">
              <button className="v2-btn" onClick={c.handleLoadProject} disabled={!c.loadTargetId}>Open</button>
              <button className="v2-btn" onClick={c.handleDeleteProject} disabled={!c.loadTargetId}>Delete</button>
            </div>
          )}
        </Section>

        <Section title="Samples" hint={`${c.project.assets.length}`} defaultOpen>
          <AssetsPanel
            assets={c.project.assets}
            selectedTarget={c.selectedTarget}
            onImport={c.importAssets}
            importStatus={c.importBatchResult}
            onAssign={c.handleAssignAsset}
            onRename={c.handleRenameAsset}
            onRemove={c.handleRemoveAsset}
            auditioningAssetId={c.manual.auditionAssetId}
            onAudition={c.handleAuditionAsset}
            auditionDisabled={c.resamplePhase === "pending"}
          />
        </Section>

        <Section title="Instruments" hint={selected ? "click to load" : "select a track"}>
          {groups.map(([category, kinds]) => (
            <div key={category} className="v2-group">
              <div className="v2-group-title">{CATEGORY_LABEL[category] ?? category}</div>
              <ul className="v2-list">
                {kinds.map((kind) => (
                  <li key={kind}>
                    <button
                      className={`v2-list-item ${selected?.instrument?.kind === kind ? "selected" : ""}`}
                      disabled={!selected || unavailable.has(kind)}
                      onClick={() => selected && c.handleSetInstrument(selected.id, kind)}
                      title={unavailable.has(kind) ? "Not available in this audio engine" : `Load ${INSTRUMENT_DEFS[kind].label} on ${target}`}
                    >
                      {INSTRUMENT_DEFS[kind].label}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </Section>

        <Section title="Effects" hint={`add to ${selected ? "track" : "master"}`}>
          <ul className="v2-list">
            {(Object.keys(FX_DEFS) as FxType[]).map((type) => (
              <li key={type}>
                <button className="v2-list-item" onClick={() => c.handleAddFx(type)} title={`Add ${FX_DEFS[type].label} to ${target}`}>
                  {FX_DEFS[type].label}
                </button>
              </li>
            ))}
          </ul>
        </Section>

        <Section title="Patterns" hint={`${patterns.length}${c.project.patternChain.length ? ` · queue ${c.project.patternChain.length}` : ""}`}>
          <div className="v2-row-actions">
            <button className="v2-btn" onClick={() => c.dispatch({ type: "ADD_PATTERN" })} title="A new empty pattern: edit it per track, queue it, or place it on the timeline">+ Pattern</button>
          </div>
          {patterns.length === 0 && <div className="v2-empty">No patterns. Clips you make live on the timeline.</div>}
          <ul className="v2-list">
            {patterns.map((p) => (
              <li key={p.id} className="v2-pattern">
                <span className="v2-pattern-name">{p.name}</span>
                <span className="v2-pattern-meta">{p.bars} bar{p.bars === 1 ? "" : "s"} · {Object.keys(p.notes).length} notes</span>
                <span className="v2-pattern-actions">
                  <button className="v2-btn" onClick={() => { if (c.selectedTarget === "master") c.handleSelectTarget(c.project.tracks[0].id); ws.setPatternEdit(p.id); ws.setView("editor"); }} title="Edit this pattern's notes, one track at a time">Edit</button>
                  <button className="v2-btn" onClick={() => c.handleQueueNext(p.id)} title="Add to the pattern queue (plays after what is playing)">Queue</button>
                  <button className="v2-btn" onClick={() => c.dispatch({ type: "CLIP_INSERT_PATTERN", patternId: p.id, start: insertAt })} disabled={Object.keys(p.notes).length === 0} title="Place on the timeline after the last clip, as one clip per track it plays">Insert</button>
                  <button className="v2-btn" onClick={() => { if (window.confirm(`Delete pattern “${p.name}”?`)) c.dispatch({ type: "REMOVE_PATTERN", patternId: p.id }); }} title="Delete this pattern">×</button>
                </span>
              </li>
            ))}
          </ul>
        </Section>

        <Section title="Queue" hint={c.playbackSource === "pattern" ? "playing" : `${c.project.patternChain.length}`}>
          <div className="v2-row-actions">
            {c.playbackSource === "pattern" ? (
              <button className="v2-btn on" onClick={() => c.handleSetSource("song")} title="Go back to playing the arrangement">← Play song</button>
            ) : (
              <button className="v2-btn" onClick={() => { c.handleSetSource("pattern"); void c.handlePlay(); }} title="Play the queue, looping, instead of the arrangement">▶ Play queue</button>
            )}
          </div>
          <ol className="v2-list v2-queue">
            {c.project.patternChain.map((entry, i) => {
              const pattern = c.project.patterns.find((p) => p.id === entry.patternId);
              return (
                <li key={entry.id} className={`v2-queue-item ${c.playingChainEntryId === entry.id ? "playing" : ""}`}>
                  <span className="v2-pattern-name">{i + 1}. {pattern?.name ?? "missing"}</span>
                  <button className="v2-mini" onClick={() => c.handleMoveChainEntry(entry.id, i - 1)} disabled={i === 0} aria-label="Move up" title="Move up">↑</button>
                  <button className="v2-mini" onClick={() => c.handleMoveChainEntry(entry.id, i + 1)} disabled={i === c.project.patternChain.length - 1} aria-label="Move down" title="Move down">↓</button>
                  <button className="v2-mini" onClick={() => c.handleRemoveChainEntry(entry.id)} disabled={c.project.patternChain.length <= 1} aria-label="Remove from queue" title="Remove">×</button>
                </li>
              );
            })}
          </ol>
        </Section>
      </div>
    </aside>
  );
});
