import { memo, useEffect, useState } from "react";
import type { Webseq } from "../controller/useWebseq";
import { FxPanel } from "../components/FxPanel";
import { InstrumentPanel } from "../components/InstrumentPanel";
import { BANK_SIZE } from "../model/project";
import { copyBankData, copyTrackData } from "../model/clips";
import { trackById, trackHasSource } from "../model/types";
import type { Workspace } from "./workspace";

type Tab = "instrument" | "fx";

/** The selected track's sound: its instrument or sample, and its FX chain. Clips, levels and routing are elsewhere (Editor, Mixer).
 * Collapsible and resizable; it never scrolls the application, only its own parameter list. */
export const DeviceArea = memo(function DeviceArea({ c, ws, open, onToggle }: { c: Webseq; ws: Workspace; open: boolean; onToggle: () => void }) {
  const [tab, setTab] = useState<Tab>("instrument");
  const [menu, setMenu] = useState(false);
  useEffect(() => {
    if (!menu) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setMenu(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [menu]);
  // Instrument / FX / Modulation use V1's clipboard rows (they are the controller's); Track and Bank are clip-aware and live here.
  const rows = c.editProps.clipboard.filter((r) => r.id === "instrument" || r.id === "fx" || r.id === "modulation");
  const where = (i: number) => `Bank ${i + 1}`;
  const trackIndex = c.selectedTarget === "master" ? -1 : c.project.tracks.findIndex((t) => t.id === c.selectedTarget);
  const bank = trackIndex < 0 ? c.activeBank : Math.floor(trackIndex / BANK_SIZE);
  const master = c.selectedTarget === "master";
  const track = master ? undefined : trackById(c.project, c.selectedTarget);
  const active: Tab = master ? "fx" : tab;
  const fxCount = (master ? c.project.master.fx : track?.fx ?? []).length;
  const index = track ? c.project.tracks.findIndex((t) => t.id === track.id) : -1;
  const label = master ? "Master" : track ? `${String(index + 1).padStart(2, "0")} ${trackHasSource(track) ? track.name : "empty"}` : "no track";

  return (
    <section className={`v2-device ${open ? "open" : "closed"}`} aria-label="Device">
      <div className="v2-device-bar">
        <button className="v2-icon-btn" onClick={onToggle} aria-expanded={open} title={open ? "Collapse  [D]" : "Expand  [D]"} aria-label="Toggle device area">
          <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true"><path d={open ? "M2 4l4 4 4-4" : "M2 8l4-4 4 4"} stroke="currentColor" strokeWidth="1.5" fill="none" /></svg>
        </button>
        <span className="v2-device-title">Device</span>
        <span className="v2-device-track">{label}</span>
        {ws.status && <span className="v2-note ok" role="status">{ws.status}</span>}
        <div className="v2-popover-anchor">
          <button className={`v2-btn ${menu ? "on" : ""}`} onClick={() => setMenu(!menu)} aria-expanded={menu} disabled={!track} title="Copy and paste this track's sound, FX, modulation, or the whole track and bank">Copy / Paste ▾</button>
          {menu && track && (
            <div className="v2-popover v2-copy-menu up" role="menu" aria-label="Copy and paste">
              {rows.map((r) => (
                <div key={r.id} className="v2-copy-row" role="group" aria-label={r.label}>
                  <span className="v2-copy-label">{r.label}</span>
                  <button className="v2-btn" disabled={r.copyBlocked !== null} title={r.copyBlocked ?? `Copy ${r.label}`} onClick={() => { r.onCopy(); ws.say(`${r.label} copied`); }}>Copy</button>
                  <button className="v2-btn" disabled={r.pasteBlocked !== null} title={r.pasteBlocked ?? `Paste ${r.label}${r.copied ? ` from ${r.copied}` : ""}`} onClick={() => { r.onPaste(); ws.say(`${r.label} pasted`); }}>Paste</button>
                </div>
              ))}
              <div className="v2-copy-row" role="group" aria-label="Track">
                <span className="v2-copy-label">Track</span>
                <button className="v2-btn" title="Copy this track: sound, FX, modulation and all its clips" onClick={() => { const data = copyTrackData(c.project, track.id); if (data) { ws.copyToClipboard({ track: { data, from: track.name } }); ws.say("Track copied"); } }}>Copy</button>
                <button className="v2-btn" disabled={!ws.clipboard.track} title={ws.clipboard.track ? `Replace this track with ${ws.clipboard.track.from}` : "No track copied"} onClick={() => { if (ws.clipboard.track) { c.dispatch({ type: "TRACK_PASTE", trackId: track.id, data: ws.clipboard.track.data }); ws.say("Track pasted"); } }}>Paste</button>
              </div>
              <div className="v2-copy-row" role="group" aria-label="Bank">
                <span className="v2-copy-label">{where(bank)}</span>
                <button className="v2-btn" title="Copy all 16 tracks of this bank" onClick={() => { ws.copyToClipboard({ bank: { data: copyBankData(c.project, bank), from: where(bank) } }); ws.say(`${where(bank)} copied`); }}>Copy</button>
                <button className="v2-btn" disabled={!ws.clipboard.bank} title={ws.clipboard.bank ? `Replace this bank with ${ws.clipboard.bank.from}` : "No bank copied"} onClick={() => { if (ws.clipboard.bank) { c.dispatch({ type: "BANK_PASTE", bank, data: ws.clipboard.bank.data }); ws.say(`${ws.clipboard.bank.from} pasted → ${where(bank)}`); } }}>Paste</button>
              </div>
            </div>
          )}
        </div>
        {track || master ? (
          <div className="v2-segment" role="tablist" aria-label="Device">
            {!master && <button role="tab" aria-selected={active === "instrument"} className={active === "instrument" ? "on" : ""} onClick={() => { setTab("instrument"); if (!open) onToggle(); }}>{track?.instrument ? "Instrument" : "Source"}</button>}
            <button role="tab" aria-selected={active === "fx"} className={active === "fx" ? "on" : ""} onClick={() => { setTab("fx"); if (!open) onToggle(); }}>FX{fxCount ? ` ${fxCount}` : ""}</button>
          </div>
        ) : null}
      </div>
      {open && (
        <div className="v2-device-body v2-scroll">
          {!track && !master && <div className="v2-empty big-static">Select a track to edit its sound.</div>}
          {active === "instrument" && track && <InstrumentPanel {...c.instrumentProps} />}
          {active === "fx" && (track || master) && (
            <FxPanel
              target={c.selectedTarget}
              track={track ?? null}
              tracks={c.project.tracks}
              onSetOutput={c.handleSetTrackOutput}
              onSetSend={c.handleSetTrackSend}
              hideRouting
              fx={c.fxOwner?.fx ?? []}
              selectedFxId={c.selectedFxId}
              onSelectFx={c.setSelectedFxId}
              onAddFx={c.handleAddFx}
              onRemoveFx={c.handleRemoveFx}
              onMoveFx={c.handleMoveFx}
              onSetFxParam={c.handleSetFxParam}
              onSetFxEnabled={c.handleSetFxEnabled}
              automationFor={(fxId) => c.automationFor(fxId)}
              lfoUiFor={c.fxLfoUi}
              onAddFxLfo={c.handleAddFxLfo}
              onSetFxLfo={c.handleSetFxLfo}
              onRemoveFxLfo={c.handleRemoveFxLfo}
              spectrumTapFor={c.spectrumTapFor}
            />
          )}
        </div>
      )}
    </section>
  );
});
