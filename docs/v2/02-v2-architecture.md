# V2 UX and frontend architecture (Phase 2)

**V1 is the functional reference, not the UX reference.** V2 keeps the model, the audio engine, the file format and every musical
capability, and rebuilds the interface around one workflow:

> create/select a track -> create/select a clip -> edit notes -> shape the instrument -> mix the track -> arrange clips -> mix the song

## Mental model

```
Project
 +- Track (x64, 4 banks of 16)   a sound source + FX chain + fader + routing      "what plays it"
 |   +- Clip (many, in time)     a stretch of the track's timeline holding notes   "what it plays, when"
 |        +- Notes               pitch, velocity, length, chord, ratchet, tie
 +- Master                       FX + limiter
```

A **clip** is a V1 *composer sequence on a track-bound lane*; its notes are its pattern's notes. So there is no new project format:

* `ComposerLane` gets one optional field, `trackId`. A lane with a `trackId` **is** that track's timeline row. Clips on a track never
  overlap (V1's rule for a lane). A track may own extra lanes when V1 content overlapped on it; they draw as stacked sub-rows.
* A clip's pattern is composer-owned and holds notes for that one track only. Moving, resizing, duplicating and deleting a clip are the
  existing `COMPOSER_*` actions. Song playback, automation replay and the host `Sequence` export are unchanged: the engine still plays
  "sequences of patterns".
* V1 songs (lanes without `trackId`, patterns holding many tracks) are **normalised on load** (`model/clips.ts: normaliseSong`): each
  sequence is split into one clip per track that has notes in it. Lane modifiers (transpose/velocity/gate) are baked into the split
  notes (`applyLaneModifiers`), so it sounds the same. The original launcher patterns and the pattern queue are untouched. The file
  stays loadable by V1 (V1 ignores `trackId`).
* Launcher patterns (V1's step-sequencer-first objects) become **Browser > Patterns**: drag/insert one onto the timeline and it is split
  into per-track clips the same way.

Arrangement and detail editing are two views of the same object: selecting a clip selects `(track, clip)` once; the Editor, Device area
and Mixer all read that one selection.

## Destinations and contexts

| Question | Answer |
|---|---|
| Global application view? | **Arrange**, **Editor**, **Mixer** (one at a time, switched in the header) |
| Contextual editor? | **Device area** (instrument + FX of the selected track), **Clip inspector** (selected note) |
| Belongs to a track? | source, FX chain, fader/pan/mute/solo, output, send, arp/LFO defaults, choke |
| Belongs to a project? | name, BPM, swing, scale, save/load/export, undo, MIDI on/off |
| Belongs to a clip? | notes, length, colour, per-clip arp/LFO/automation override |
| Belongs to the mixer? | fader, pan, mute/solo, routing (output + send), meters, master limiter |
| Browser? | projects, assets (samples), instruments, effects, patterns |
| Always accessible? | transport, undo/redo, MIDI toggle, view switch |
| Only when relevant? | clip inspector (a note is selected), chop tools (a chop track), device area contents |

## Application shell

```
+--------------------------------------------------------------------------------------------------+
| WEBSEQ  my song v | [Arrange] [Editor] [Mixer] |  |< > [] REC  001.1.1  120 BPM  swing  C min  | MIDI * undo redo |
+---------+----------------------------------------------------------------------------------------+
| BROWSER |  WORKSPACE (one of three)                                                              |
|         |                                                                                        |
| Project |  ARRANGE                                                                               |
| Assets  |   track headers (fixed)   | ruler  1    2    3    4    5    6    7    8   (scrolls x)  |
| Instr.  |   01 Kick   M S  [vol]    |  [clip ][clip ]       [clip      ]                          |
| Effects |   02 Bass   M S  [vol]    |        [clip       ]  [clip ]                               |
| Patterns|   03 Lead   M S           |  ...                                                       |
|         |   (bank filter 1 2 3 4)   |                                                            |
|         +--------------------------------------------------------------------------------------- +
|         |  EDITOR  Track 02 Bass > Clip "Pattern B" (bars 5-8)    [< prev] [next >]  [<- Arrange] |
|         |   keys | note grid (canvas, scrolls x/y) .................................            |
|         |        | velocity lane ....................................                            |
|         |   grid [1/16 v] zoom [- +]   inspector: pitch vel len ratchet tie chord               |
|         +----------------------------------------------------------------------------------------+
|         |  MIXER   strips x tracks: meter, fader, pan, M S, out v, send v + amt, FX count | MASTER |
+---------+----------------------------------------------------------------------------------------+
| DEVICE (selected track: Bass)  [Instrument] [FX 3]                         (collapsible, resizable) |
|   ...parameters / FX chain...                                                                    |
+--------------------------------------------------------------------------------------------------+
```

* Header: one row. Project name + menu (new/save/load/export/import), the three view tabs, transport, MIDI, undo/redo. No other buttons.
* **Browser** (left): collapsible, resizable. One scroll region; sections are a tree, not tabs.
* **Workspace**: exactly one of Arrange / Editor / Mixer is mounted at a time, in the same slot. The two timeline-ish views share
  one transport position and one selection. Switching never loses the selection.
* **Device area** (bottom): follows the selected track in Arrange and Editor; hidden in Mixer (the strip is the device there).
  Collapsible and resizable. Instrument and FX only. No mixer, no routing, no note editing.

## Navigation: Arrange <-> Editor

* Click a clip: selects it (and its track). Double-click, Enter, or the Edit button in the inspector opens the **Editor** on that clip.
* The Editor's top bar is a breadcrumb that is always true: `Track 02 Bass > Pattern B (bars 5-8)`, previous/next clip on the track,
  and **<- Arrange**, which returns to the same scroll position and selection. Esc does the same.
* The Editor can also be opened with no clip: "Create clip" on the empty track row makes a 1-bar clip and opens it.
* Selecting another track in the Editor switches the clip being edited to that track's clip at the playhead (or offers "Create clip").

## Arrange

* Rows are tracks (a bank filter shows 16 at a time; "used only" hides empty tracks). Headers are fixed on the left (name, source,
  mute, solo, fader) and never scroll sideways. The timeline scrolls on both axes inside one container.
* Ruler in bars with snap to whole bars (V1's sequence granularity). Playhead is a `transform`-only element driven from `requestAnimationFrame`
  reading `Transport` (the V1 pattern), so playback re-renders nothing.
* Drag a clip to move (across tracks is not allowed: a clip belongs to its track), drag its right edge to resize (extends by repeat, as V1),
  Alt-drag or Cmd+D to duplicate, Delete to remove, double-click empty track space to create a clip, click the ruler to place the loop/start marker.
* Clips draw a mini note preview (canvas), so a song is readable at a glance.

## Editor (piano roll)

* Canvas-rendered (grid, notes, velocity) and virtualised to the visible rectangle; scrolls along time and pitch. Notes are in V1's
  `Note` shape: `pitch` is semitones above the track's own pitch (a synth's tune, a sample's root; middle C for drums), so the roll
  shows the same musical values V1's Pitch dropdown did. Chop tracks show slices as rows.
* Tools by direct manipulation: click empty = add, drag = move, drag right edge = resize, Delete / double-click = remove, drag in
  the velocity lane = velocity, rubber-band select, Cmd+C/V/D, grid resolution (1/4 ... 1/32, free) and zoom.
* Notes keep V1 behaviours: chord notes, ratchet, tie (303 slide on synths that support it), LFO amount, scale highlight rows.
* The same MIDI keyboard that plays the track (header MIDI toggle) can record into the clip: arm, play, notes land at the transport position.

## Mixer

* A full workspace: strips for the tracks of the selected bank (or all used), each with meter, fader, pan, mute, solo, **output** and
  **send** (+ amount) selectors (these lived in V1's FX panel), FX count; Master strip pinned right with the limiter. Click a strip to
  select the track. Routing is the unchanged `Track.outputTrack` / `Track.send` with the same cycle guards.

## Browser

Tree with sections: **Project** (saved projects, import/export), **Assets** (import, audition, assign to the selected track, rename,
remove), **Instruments** (the 20 synth kinds; click assigns to the selected track), **Effects** (click adds to the selected track),
**Patterns** (V1 launcher patterns; insert as clips). Selection-aware: items that act on "the selected track" say which.

## Resizing and scrolling

* Resizable: browser width, device-area height. Both collapse. Sizes persist in `localStorage` (a per-viewer convenience).
* Scroll regions (the only ones): the timeline (x/y), the piano roll (x/y), the browser tree, the mixer strip row (x), a long
  parameter list. Header, transport, headers column and rulers are sticky. The app shell never scrolls.

## Performance rules (carried over from V1)

* Playhead, meters, MIDI light: imperative DOM / canvas from `requestAnimationFrame`, never React state.
* The controller (`useWebseq`) owns state; views receive stable callbacks and memoised slices. Only the active workspace is mounted.
* Piano roll and clip previews are canvas, redrawn on data/viewport change only, not per frame.

## Responsive

Desktop is the design target (>= 960 px). Below that, V2 shows a deliberate compact mode: header collapses to transport + view menu,
browser becomes a drawer, device area becomes a sheet. V1's phone layout (`?ui=v1`) remains available while this is built.

## Implementation order

1. Controller extraction (`useWebseq`) so V1 and V2 shells share one engine wiring. **Done.**
2. `model/clips.ts` (lane `trackId`, clip ops, `normaliseSong`) + tests.
3. Shell: header, browser, workspace slot, device area, resizing, view state.
4. Arrange. 5. Editor (piano roll). 6. Mixer. 7. Device area (reusing the existing Instrument/FX panels). 8. Browser.
9. Parity pass against `01-v1-inventory.md`; mobile mode.

## Known gaps while this is built

Tracked in `docs/v2/STATUS.md`.
