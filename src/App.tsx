import { useWebseq } from "./controller/useWebseq";
import type { FxId } from "./model/types";
import { totalBeats, trackById } from "./model/types";
import { BANK_SIZE, tracksInBank } from "./model/project";
import { timeAgo } from "./persistence/recovery";
import { Chrome } from "./app/Chrome";
import { MusicalGuide } from "./components/MusicalGuide";
import { Workspace } from "./app/Workspace";
import { PatternsView } from "./app/PatternsView";
import { MobileTabBar } from "./app/MobileTabBar";
import { maxPatternBars, sequenceName } from "./model/composer";
import { effectiveSideView } from "./app/layout";

export function App() {
  const {
    activeBank,
    addPattern,
    appRef,
    automationFor,
    automationRow,
    bankSummaries,
    canZoomIn,
    canZoomOut,
    composer,
    composerAutomationEdit,
    composerAutomationSpans,
    derived,
    dispatch,
    duplicatePattern,
    editProps,
    error,
    fxLfoUi,
    fxOwner,
    getBusId,
    getGuideRuntime,
    getPlayheadBeat,
    getPlayingBarText,
    getSongBeat,
    getSongText,
    gridResolution,
    guideOpen,
    handleAddFx,
    handleAddFxLfo,
    handleAddNote,
    handleAddToComposer,
    handleApplyRecipe,
    handleAssignAsset,
    handleAuditionAsset,
    handleCloseGuide,
    handleDismissRecovery,
    handleEditPattern,
    handleMoveChainEntry,
    handleMoveFx,
    handleMoveNote,
    handlePickPattern,
    handlePlay,
    handleQueueNext,
    handleRemoveAsset,
    handleRemoveChainEntry,
    handleRemoveFx,
    handleRemoveFxLfo,
    handleRemoveNote,
    handleRenameAsset,
    handleResetPatternSettings,
    handleResizeNote,
    handleRestoreRecovery,
    handleSelectDockView,
    handleSelectLibraryView,
    handleSelectMainView,
    handleSelectMobileTab,
    handleSelectTarget,
    handleSetFxEnabled,
    handleSetFxLfo,
    handleSetFxParam,
    handleSetNoteChord,
    handleSetNoteDuration,
    handleSetNoteLfo,
    handleSetNoteMode,
    handleSetNotePitch,
    handleSetNoteRatchet,
    handleSetNoteTie,
    handleSetNoteVelocity,
    handleSetTrackArp,
    handleSetTrackEventLfo,
    handleSetTrackMuted,
    handleSetTrackNotesLfo,
    handleSetTrackNotesOff,
    handleSetTrackNotesTie,
    handleSetTrackOutput,
    handleSetTrackPan,
    handleSetTrackSend,
    handleSetTrackSoloed,
    handleSetTrackVolume,
    handleStepPattern,
    handleStop,
    handleTogglePicker,
    handleToggleSettings,
    handleTriggerTrack,
    importAssets,
    importBatchResult,
    instrumentProps,
    launcher,
    layout,
    libraryView,
    mainView,
    manual,
    midi,
    mobileTab,
    onZoomIn,
    onZoomOut,
    playingChainEntryId,
    playingPatternId,
    playingSequenceIds,
    project,
    projectBarProps,
    projectScale,
    pxPerBeat,
    recoveryPrompt,
    removePattern,
    renamePattern,
    resamplePhase,
    runtime,
    selectedFxId,
    selectedNoteId,
    selectedPattern,
    selectedPatternId,
    selectedTarget,
    selectedTrack,
    selectedTrackAsset,
    setActiveBank,
    setGridResolution,
    setPatternBars,
    setSelectedFxId,
    setSelectedNoteId,
    setSelectedPatternId,
    setSidePanelView,
    sidePanelView,
    spectrumTapFor,
    status,
    trackHeaderProps,
    transportProps,
    unavailableKinds,
    zoomPercent,
  } = useWebseq();

  return (
    <>
    <div className="app" ref={appRef} data-mobile-tab={mobileTab} data-main-view={mainView} data-takeover={derived.takeover} data-library-view={libraryView}>
      {recoveryPrompt && (
        <div className="recovery-banner" role="alert">
          <span>
            Previous session detected{recoveryPrompt.projectName ? ` — "${recoveryPrompt.projectName}"` : ""}, unsaved,{" "}
            {timeAgo(recoveryPrompt.savedAt)}. Restore it?
          </span>
          <div className="recovery-banner-actions">
            <button className="btn small" onClick={() => void handleRestoreRecovery()}>
              Restore
            </button>
            <button className="btn small" onClick={handleDismissRecovery}>
              Discard
            </button>
          </div>
        </div>
      )}
      <Chrome
        layout={layout}
        mainView={mainView}
        onSelectMainView={handleSelectMainView}
        mobileTab={mobileTab}
        libraryView={libraryView}
        onSelectLibraryView={handleSelectLibraryView}
        projectName={project.name}
        onRenameProject={(name) => dispatch({ type: "SET_PROJECT_NAME", name })}
        subtitle={`${totalBeats(selectedPattern, project.beatsPerBar)} beats / ${selectedPattern.bars} bar${selectedPattern.bars > 1 ? "s" : ""}`}
        projectBar={projectBarProps}
        midi={midi}
        transport={transportProps}
        patternStrip={{
          patterns: launcher,
          composer: composer.editingSequence ? { onReturn: composer.returnToComposer } : undefined,
          maxBars: maxPatternBars(project, selectedPatternId),
          onAddToComposer: () => handleAddToComposer(selectedPatternId),
          selectedPatternId,
          playingPatternId,
          onStep: handleStepPattern,
          onRename: renamePattern,
          onSetBars: setPatternBars,
          onDuplicate: duplicatePattern,
          onAddPattern: addPattern,
          onEditPlaying: () => playingPatternId && setSelectedPatternId(playingPatternId),
          getPlayingBarText,
          gridResolution,
          onGridResolutionChange: setGridResolution,
          zoomPercent,
          canZoomIn,
          canZoomOut,
          onZoomIn,
          onZoomOut,
        }}
        mobileTopBar={{
          status,
          onPlay: () => void handlePlay(),
          onStop: handleStop,
          patterns: launcher,
          selectedPatternId,
          bpm: project.bpm,
          pickerOpen: derived.takeover === "picker",
          settingsOpen: derived.takeover === "settings",
          onStep: handleStepPattern,
          onTogglePicker: handleTogglePicker,
          onToggleSettings: handleToggleSettings,
          composerOpen: mainView === "composer",
          onToggleComposer: () => handleSelectMainView(mainView === "composer" ? "sequencer" : "composer"),
        }}
      />

      <Workspace
        layout={layout}
        derived={derived}
        mobileTab={mobileTab}
        composer={{
          project,
          scrollMemory: composer.scrollMemory,
          marker: composer.marker,
          onSetMarker: composer.setMarker,
          getSongBeat,
          playingSequenceIds,
          getSongText,
          selectedSequenceId: composer.sequence?.id ?? null,
          selectedLaneId: composer.lane?.id ?? null,
          onSelectSequence: composer.selectSequence,
          onSelectLane: composer.selectLane,
          onMove: composer.onMove,
          onResize: composer.onResize,
          ...composer.laneHandlers,
          automation: { row: automationRow, spans: composerAutomationSpans, ...composerAutomationEdit },
          toolbar: composer.toolbar,
          trackList: {
            tracks: project.tracks,
            masterFxCount: project.master.fx.length,
            pattern: composer.sequence ? selectedPattern : undefined,
            patternLabel: composer.sequence ? sequenceName(project, composer.sequence) : "",
            selectedTarget,
            onSelectTarget: handleSelectTarget,
            onSetMuted: handleSetTrackMuted,
            onSetSoloed: handleSetTrackSoloed,
            onSetNotesOff: handleSetTrackNotesOff,
          },
        }}
        sidePanel={{
          view: effectiveSideView(layout, sidePanelView),
          onSelectView: setSidePanelView,
          assets: {
            assets: project.assets,
            selectedTarget,
            onImport: importAssets,
            importStatus: importBatchResult,
            onAssign: handleAssignAsset,
            onRename: handleRenameAsset,
            onRemove: handleRemoveAsset,
            auditioningAssetId: manual.auditionAssetId,
            onAudition: handleAuditionAsset,
            auditionDisabled: resamplePhase === "pending",
          },
          edit: editProps,
        }}
        grid={{
          project,
          pattern: selectedPattern,
          selectedTarget,
          onSelectTarget: handleSelectTarget,
          selectedNoteId,
          onSelectNote: setSelectedNoteId,
          onAddNote: handleAddNote,
          onResizeNote: handleResizeNote,
          onMoveNote: handleMoveNote,
          onRemoveNote: handleRemoveNote,
          onSetMuted: handleSetTrackMuted,
          onSetNotesOff: handleSetTrackNotesOff,
          onSetSoloed: handleSetTrackSoloed,
          bank: activeBank,
          bankSummaries,
          onSelectBank: setActiveBank,
          loopingTrackIds: manual.loopingTrackIds,
          triggerDisabled: resamplePhase === "pending",
          onTriggerTrack: handleTriggerTrack,
          getPlayheadBeat,
          pxPerBeat,
          automationRow,
          active: derived.timelineVisible,
          bankPlacement: layout.isPhone ? "row" : "corner",
        }}
        picker={{
          patterns: launcher,
          selectedPatternId,
          playingPatternId,
          onPick: handlePickPattern,
          onAddPattern: addPattern,
          onDuplicate: duplicatePattern,
          onRemove: removePattern,
          onRename: renamePattern,
          onSetBars: setPatternBars,
        }}
        settings={{
          projectName: project.name,
          onRenameProject: (name) => dispatch({ type: "SET_PROJECT_NAME", name }),
          projectBar: projectBarProps,
          transport: transportProps,
        }}
        trackHeader={trackHeaderProps}
        dock={{
          onSelect: handleSelectDockView,
          fx: {
            target: selectedTarget,
            track: selectedTarget === "master" ? null : (trackById(project, selectedTarget) ?? null),
            tracks: project.tracks,
            onSetOutput: handleSetTrackOutput,
            onSetSend: handleSetTrackSend,
            fx: fxOwner?.fx ?? [],
            selectedFxId,
            onSelectFx: setSelectedFxId,
            onAddFx: handleAddFx,
            onRemoveFx: handleRemoveFx,
            onMoveFx: handleMoveFx,
            onSetFxParam: handleSetFxParam,
            onSetFxEnabled: handleSetFxEnabled,
            automationFor: (fxId: FxId) => automationFor(fxId),
            lfoUiFor: fxLfoUi,
            onAddFxLfo: handleAddFxLfo,
            onSetFxLfo: handleSetFxLfo,
            onRemoveFxLfo: handleRemoveFxLfo,
            spectrumTapFor,
          },
          instrument: instrumentProps,
          editor: {
            track: selectedTrack ?? null,
            pattern: selectedPattern,
            beatsPerBar: project.beatsPerBar,
            selectedNoteId,
            onSelectNote: setSelectedNoteId,
            onAddNote: handleAddNote,
            onResizeNote: handleResizeNote,
            onMoveNote: handleMoveNote,
            onRemoveNote: handleRemoveNote,
            onSetNotePitch: handleSetNotePitch,
            onSetNoteVelocity: handleSetNoteVelocity,
            onSetNoteRatchet: handleSetNoteRatchet,
            onSetNoteTie: handleSetNoteTie,
            onSetTrackNotesTie: handleSetTrackNotesTie,
            onSetNoteDuration: handleSetNoteDuration,
            onSetNoteMode: handleSetNoteMode,
            onSetNoteChord: handleSetNoteChord,
            chopAsset: selectedTrackAsset,
            scale: projectScale,
            onSetTrackArp: handleSetTrackArp,
            onResetPatternSettings: handleResetPatternSettings,
            onSetTrackEventLfo: handleSetTrackEventLfo,
            onSetNoteLfo: handleSetNoteLfo,
            onSetTrackNotesLfo: handleSetTrackNotesLfo,
          },
          edit: editProps,
          mixer: {
            tracks: tracksInBank(project, activeBank),
            trackNumberOffset: activeBank * BANK_SIZE,
            onSetVolume: handleSetTrackVolume,
            onSetMuted: handleSetTrackMuted,
            onSetSoloed: handleSetTrackSoloed,
            onSetPan: handleSetTrackPan,
            runtime,
            getBusId,
          },
        }}
      />

      <PatternsView
        active={derived.patternsVisible}
        header={{
          editing: selectedPattern,
          playing: playingPatternId ? project.patterns.find((p) => p.id === playingPatternId) : undefined,
          onEditSelected: () => handleEditPattern(selectedPatternId),
          onAdd: addPattern,
          getPlayingBarText,
          backLabel: layout.isPhone ? "back to timeline" : "back to sequencer",
        }}
        list={{
          patterns: launcher,
          selectedPatternId,
          playingPatternId,
          onSelect: setSelectedPatternId,
          onAddToComposer: handleAddToComposer,
          onEdit: handleEditPattern,
          onDuplicate: duplicatePattern,
          onRemove: removePattern,
          onRename: renamePattern,
          onSetBars: setPatternBars,
          onQueueNext: handleQueueNext,
        }}
        queue={{
          patternChain: project.patternChain,
          patterns: launcher,
          playingChainEntryId,
          onRemoveEntry: handleRemoveChainEntry,
          onMoveEntry: handleMoveChainEntry,
          getPlayingBarText,
        }}
      />

      <MobileTabBar active={mobileTab} onSelect={handleSelectMobileTab} />

      {error && <div className="gesture-veil">Audio engine failed to start: {error}</div>}
      {!runtime && !error && (
        <div className="gesture-veil">
          <div className="card">
            <p>Click Play to start the audio engine (browser autoplay policy requires a gesture).</p>
            <button className="btn" onClick={handlePlay}>
              ▶ Start
            </button>
          </div>
        </div>
      )}
    </div>
    {guideOpen && (
      <MusicalGuide
        project={project}
        selectedPatternId={selectedPatternId}
        selectedTrackId={selectedTarget === "master" ? null : selectedTarget}
        getRuntime={getGuideRuntime}
        unavailableKinds={unavailableKinds}
        onApplyRecipe={handleApplyRecipe}
        onClose={handleCloseGuide}
      />
    )}
    </>
  );
}
