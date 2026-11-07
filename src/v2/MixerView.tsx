import { memo, useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import type { Webseq } from "../controller/useWebseq";
import { useMixerMeters } from "../audio/useMixerMeters";
import { BANK_SIZE, MAX_TRACK_VOLUME, MIN_TRACK_VOLUME } from "../model/project";
import { INSTRUMENT_DEFS } from "../model/instruments";
import type { Track } from "../model/types";
import { effectivePan, leadsTo, resolvedOutput, resolvedSend, trackHasSource } from "../model/types";

type Filter = "used" | 0 | 1 | 2 | 3;
const panLabel = (pan: number) => (Math.abs(pan) < 0.005 ? "C" : `${pan < 0 ? "L" : "R"}${Math.round(Math.abs(pan) * 100)}`);
let masterLimiterOn = true;

/** The mixer as a workspace of its own: a strip per track with level, pan, mute/solo, and where its audio goes (output and send). Clicking
 * a strip selects the track (its sound shows in the device area). The mixing and routing model is V1's, unchanged. */
export const MixerView = memo(function MixerView({ c }: { c: Webseq }) {
  const { project, runtime } = c;
  const [filter, setFilter] = useState<Filter>("used");
  const rootRef = useRef<HTMLDivElement>(null);
  const [limiterOn, setLimiterOn] = useState(masterLimiterOn);
  useEffect(() => {
    masterLimiterOn = limiterOn;
    runtime?.setMasterLimiter({ enabled: limiterOn });
  }, [runtime, limiterOn]);

  const strips = useMemo(() => {
    const all = project.tracks.map((t, index) => ({ t, index }));
    if (filter === "used") {
      return all.filter(({ t, index }) => index < 8 || trackHasSource(t) || t.id === c.selectedTarget);
    }
    return all.slice(filter * BANK_SIZE, (filter + 1) * BANK_SIZE);
  }, [project.tracks, filter, c.selectedTarget]);
  useMixerMeters(runtime, rootRef, c.getBusId, strips);

  const destinations = useCallback((t: Track) => project.tracks.filter((d) => d.id !== t.id && !leadsTo(project, d.id, t.id)), [project]);

  return (
    <section className="v2-mixer" aria-label="Mixer">
      <div className="v2-toolbar">
        <span className="v2-toolbar-title">Mixer</span>
        <span className="v2-toolbar-spacer" />
        <div className="v2-segment" role="group" aria-label="Tracks shown">
          {(["used", 0, 1, 2, 3] as Filter[]).map((f) => (
            <button key={String(f)} className={filter === f ? "on" : ""} aria-pressed={filter === f} onClick={() => setFilter(f)}>{f === "used" ? "Used" : `Bank ${Number(f) + 1}`}</button>
          ))}
        </div>
      </div>
      <div className="v2-mixer-strips v2-scroll" ref={rootRef}>
        {strips.map(({ t, index }) => {
          const out = resolvedOutput(project, t);
          const send = resolvedSend(project, t);
          const dest = destinations(t);
          const selected = c.selectedTarget === t.id;
          const has = trackHasSource(t);
          return (
            <div key={t.id} className={`v2-strip ${selected ? "selected" : ""} ${t.muted ? "muted" : ""}`} onPointerDown={() => c.handleSelectTarget(t.id)} role="group" aria-label={`Track ${index + 1}`}>
              <div className="v2-strip-head">
                <span className="v2-track-num">{String(index + 1).padStart(2, "0")}</span>
                <span className={`v2-track-name ${has ? "" : "empty"}`} title={has ? t.name : undefined}>{has ? t.name : "empty"}</span>
                <span className="mixer-clip" data-clip-track={t.id} title="Lights red when this track clips" />
              </div>
              <div className="v2-track-kind">{t.instrument ? (INSTRUMENT_DEFS[t.instrument.kind]?.label ?? t.instrument.kind) : t.assetId != null ? "sample" : "—"}{t.fx.length ? ` · ${t.fx.length} fx` : ""}</div>
              <div className="v2-strip-fader">
                <input type="range" className="v2-vfader" min={MIN_TRACK_VOLUME} max={MAX_TRACK_VOLUME} step={0.01} value={t.volume} onChange={(e) => c.handleSetTrackVolume(t.id, Number(e.target.value))} style={{ "--fill": `${((t.volume - MIN_TRACK_VOLUME) / (MAX_TRACK_VOLUME - MIN_TRACK_VOLUME)) * 100}%` } as CSSProperties} aria-label={`${t.name} volume`} aria-orientation="vertical" />
              </div>
              <div className="v2-strip-value">{Math.round(t.volume * 100)}%</div>
              <div className="v2-strip-pan">
                <input type="range" min={-1} max={1} step={0.01} value={effectivePan(t)} onChange={(e) => c.handleSetTrackPan(t.id, Number(e.target.value))} onDoubleClick={() => c.handleSetTrackPan(t.id, 0)} aria-label={`${t.name} pan`} title="Pan (double-click to centre)" />
                <span>{panLabel(effectivePan(t))}</span>
              </div>
              <div className="v2-track-buttons">
                <button className={`v2-mini ${t.muted ? "mute" : ""}`} aria-pressed={t.muted} onClick={() => c.handleSetTrackMuted(t.id, !t.muted)} title="Mute">M</button>
                <button className={`v2-mini ${t.soloed ? "solo" : ""}`} aria-pressed={t.soloed} onClick={() => c.handleSetTrackSoloed(t.id, !t.soloed)} title="Solo">S</button>
              </div>
              <label className="v2-strip-route">
                <span>Out</span>
                <select value={out === "master" ? "" : out} onChange={(e) => c.handleSetTrackOutput(t.id, e.target.value || null)} onPointerDown={(e) => e.stopPropagation()} aria-label={`${t.name} output`}>
                  <option value="">Master</option>
                  {dest.map((d) => <option key={d.id} value={d.id}>{String(project.tracks.indexOf(d) + 1).padStart(2, "0")} {trackHasSource(d) ? d.name : "empty"}</option>)}
                </select>
              </label>
              <label className="v2-strip-route">
                <span>Send</span>
                <select value={send?.to ?? ""} onChange={(e) => c.handleSetTrackSend(t.id, e.target.value || null)} onPointerDown={(e) => e.stopPropagation()} aria-label={`${t.name} send`}>
                  <option value="">None</option>
                  {dest.map((d) => <option key={d.id} value={d.id}>{String(project.tracks.indexOf(d) + 1).padStart(2, "0")} {trackHasSource(d) ? d.name : "empty"}</option>)}
                </select>
              </label>
              <input type="range" className="v2-send-amount" min={0} max={1} step={0.01} value={send?.amount ?? 0} disabled={!send} onChange={(e) => c.handleSetTrackSend(t.id, send!.to, Number(e.target.value))} onPointerDown={(e) => e.stopPropagation()} aria-label={`${t.name} send amount`} title="Send amount" />
            </div>
          );
        })}
        <div className={`v2-strip v2-strip-master ${c.selectedTarget === "master" ? "selected" : ""}`} data-master-strip onPointerDown={() => c.handleSelectTarget("master")} role="group" aria-label="Master">
          <div className="v2-strip-head"><span className="v2-track-name">Master</span></div>
          <div className="v2-track-kind">{c.project.master.fx.length ? `${c.project.master.fx.length} fx` : "—"}</div>
          <div className="v2-strip-fader master"><canvas className="mixer-meter-canvas" data-meter-canvas /></div>
          <button className={`v2-btn ${limiterOn ? "on" : ""}`} onClick={() => setLimiterOn(!limiterOn)} aria-pressed={limiterOn} title="Master limiter">Limiter</button>
        </div>
      </div>
    </section>
  );
});
