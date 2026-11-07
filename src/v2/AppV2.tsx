import { useEffect, useState } from "react";
import { useMediaQuery } from "../hooks/useMediaQuery";
import { useWebseq } from "../controller/useWebseq";
import { MusicalGuide } from "../components/MusicalGuide";
import { timeAgo } from "../persistence/recovery";
import { Header } from "./Header";
import { Browser } from "./Browser";
import { Arrange } from "./Arrange";
import { Editor } from "./Editor";
import { MixerView } from "./MixerView";
import { DeviceArea } from "./DeviceArea";
import { Splitter } from "./Splitter";
import { LIMITS, VIEWS, useWorkspace } from "./workspace";
import "./v2.css";

/** The V2 shell: header, browser, one workspace (Arrange / Editor / Mixer), and the device area for the selected track. It owns layout
 * and navigation only; all state and behaviour come from the same controller V1 uses. */
export function AppV2() {
  const c = useWebseq({ editAlwaysBuilt: true });
  const ws = useWorkspace();
  const { view, setView, sizes: stored, patchSizes, shellRef } = ws;
  // Compact windows: the browser is a drawer, closed until asked for (separate from the desktop setting, which is remembered).
  const narrow = useMediaQuery("(max-width: 960px)");
  const [drawer, setDrawer] = useState(false);
  const sizes = narrow ? { ...stored, browserOpen: drawer } : stored;
  const toggleBrowser = () => (narrow ? setDrawer(!drawer) : patchSizes({ browserOpen: !stored.browserOpen }));
  const { setMainView, handleSetSource } = c;

  // V2 plays the song and edits through clips: keep the controller in its Composer/Song mode, which also keeps V1's step-grid keyboard
  // shortcuts (delete a step, copy a track's steps) off.
  // A new session starts on the first track (the browser's "load on the selected track" needs one).
  const { handleSelectTarget, project } = c;
  const firstTrack = project.tracks[0]?.id;
  useEffect(() => {
    if (firstTrack) handleSelectTarget(firstTrack);
  }, [firstTrack, handleSelectTarget]);

  useEffect(() => {
    setMainView("composer");
    handleSetSource("song");
  }, [setMainView, handleSetSource]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (el && (el.tagName === "INPUT" || el.tagName === "SELECT" || el.tagName === "TEXTAREA" || el.isContentEditable)) return;
      if (e.metaKey || e.ctrlKey || e.altKey || c.guideOpen) return;
      const v = VIEWS.find((x) => x.key === e.key);
      if (v) setView(v.id);
      else if (e.key.toLowerCase() === "b") toggleBrowser();
      else if (e.key.toLowerCase() === "d") patchSizes({ deviceOpen: !sizes.deviceOpen });
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [setView, patchSizes, sizes.browserOpen, sizes.deviceOpen, c.guideOpen, narrow, drawer]);

  const showDevice = true;
  const style = {
    "--v2-browser-w": `${sizes.browserOpen ? sizes.browserWidth : 0}px`,
    "--v2-device-h": `${showDevice && sizes.deviceOpen ? sizes.deviceHeight : 0}px`,
  } as React.CSSProperties;

  return (
    <>
      <div className="v2" ref={shellRef} style={style} data-view={view} data-browser={sizes.browserOpen ? "open" : "closed"}>
        {c.recoveryPrompt && (
          <div className="v2-banner" role="alert">
            <span>
              Previous session{c.recoveryPrompt.projectName ? ` “${c.recoveryPrompt.projectName}”` : ""} was not saved ({timeAgo(c.recoveryPrompt.savedAt)}).
            </span>
            <button className="v2-btn" onClick={() => void c.handleRestoreRecovery()}>Restore</button>
            <button className="v2-btn" onClick={c.handleDismissRecovery}>Discard</button>
          </div>
        )}
        <Header c={c} view={view} onView={setView} browserOpen={sizes.browserOpen} onToggleBrowser={toggleBrowser} status={ws.status} />
        <div className="v2-body">
          {sizes.browserOpen && <Browser c={c} ws={ws} />}
          {sizes.browserOpen && (
            <Splitter axis="col" shellRef={shellRef} cssVar="--v2-browser-w" value={sizes.browserWidth} min={LIMITS.browserWidth[0]} max={LIMITS.browserWidth[1]} direction={1} onCommit={(browserWidth) => patchSizes({ browserWidth })} label="Resize browser" />
          )}
          <main className="v2-main">
            <div className="v2-workspace">
              {view === "arrange" && <Arrange c={c} ws={ws} />}
              {view === "editor" && <Editor c={c} ws={ws} />}
              {view === "mixer" && <MixerView c={c} />}
            </div>
            {showDevice && (
              <>
                {sizes.deviceOpen && (
                  <Splitter axis="row" shellRef={shellRef} cssVar="--v2-device-h" value={sizes.deviceHeight} min={LIMITS.deviceHeight[0]} max={LIMITS.deviceHeight[1]} direction={-1} onCommit={(deviceHeight) => patchSizes({ deviceHeight })} label="Resize device area" />
                )}
                <DeviceArea c={c} ws={ws} open={sizes.deviceOpen} onToggle={() => patchSizes({ deviceOpen: !sizes.deviceOpen })} />
              </>
            )}
          </main>
        </div>
        {c.error && <div className="v2-veil">Audio engine failed to start: {c.error}</div>}
        {!c.runtime && !c.error && (
          <div className="v2-veil">
            <div className="v2-veil-card">
              <p>Click Start to turn the audio engine on (browsers need a click first).</p>
              <button className="v2-btn primary" onClick={c.handlePlay}>▶ Start</button>
            </div>
          </div>
        )}
      </div>
      {c.guideOpen && (
        <MusicalGuide
          project={c.project}
          selectedPatternId={c.selectedPatternId}
          selectedTrackId={c.selectedTarget === "master" ? null : c.selectedTarget}
          getRuntime={c.getGuideRuntime}
          unavailableKinds={c.unavailableKinds}
          onApplyRecipe={c.handleApplyRecipe}
          onClose={c.handleCloseGuide}
        />
      )}
    </>
  );
}
