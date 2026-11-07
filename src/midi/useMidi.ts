// React side of midi/midiInput.ts. One switch (MIDI on/off) and a status; no ports to pick.
//
// A browser asks for MIDI permission when access is first requested, so MIDI starts only when the user
// turns it on, and then stays on across reloads (the browser remembers the grant, so there is no prompt
// the second time). A plugin host provides its MIDI without asking, so there it is simply on.
import { useCallback, useEffect, useRef, useState } from "react";
import { connectMidi, type MidiSnapshot, type NoteSink } from "./midiInput";

const STORAGE_KEY = "webseq.midi";

function readEnabled(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === "on";
  } catch {
    return false;
  }
}
function writeEnabled(on: boolean): void {
  try {
    localStorage.setItem(STORAGE_KEY, on ? "on" : "off");
  } catch {
    /* storage unavailable: MIDI just won't be remembered */
  }
}

export interface UseMidiOptions {
  /** Where notes go. Read through a ref, so a new sink every render does not reconnect MIDI. */
  sink: NoteSink;
  /** On with no user action (a plugin host that provides its MIDI without asking). */
  alwaysOn?: boolean;
  /** Listening is paused (e.g. the host plays MIDI natively and the page must not play the notes twice). */
  suspended?: boolean;
}

export interface MidiState extends MidiSnapshot {
  enabled: boolean;
  setEnabled: (on: boolean) => void;
  /** Registers a callback for every incoming message; returns its unsubscribe. Not React state: the
   * indicator blinks without re-rendering anything. */
  subscribeActivity: (fn: () => void) => () => void;
}

export function useMidi({ sink, alwaysOn = false, suspended = false }: UseMidiOptions): MidiState {
  const [enabled, setEnabledState] = useState(readEnabled);
  const [snapshot, setSnapshot] = useState<MidiSnapshot>({ status: "on", inputs: [] });
  const sinkRef = useRef(sink);
  sinkRef.current = sink;
  const listeners = useRef(new Set<() => void>());

  const setEnabled = useCallback((on: boolean) => {
    writeEnabled(on);
    setEnabledState(on);
  }, []);
  const subscribeActivity = useCallback((fn: () => void) => {
    listeners.current.add(fn);
    return () => void listeners.current.delete(fn);
  }, []);

  const active = (enabled || alwaysOn) && !suspended;
  useEffect(() => {
    if (!active) return;
    const forward: NoteSink = {
      noteOn: (n, v) => sinkRef.current.noteOn(n, v),
      noteOff: (n) => sinkRef.current.noteOff(n),
      allNotesOff: () => sinkRef.current.allNotesOff(),
    };
    const connection = connectMidi(forward, {
      onChange: setSnapshot,
      onActivity: () => listeners.current.forEach((fn) => fn()),
    });
    return () => {
      connection.dispose();
      setSnapshot({ status: "on", inputs: [] });
    };
  }, [active]);

  return { ...snapshot, enabled: enabled || alwaysOn, setEnabled, subscribeActivity };
}
