import { useEffect, useRef } from "react";
import type { MidiState } from "../midi/useMidi";

/** The whole MIDI UI: one toggle. Off: click to turn MIDI on (the browser asks for permission once). On: every
 * connected input plays the selected track, and the light blinks as messages arrive. The blink is a class
 * toggled on the element, not React state, so playing a keyboard re-renders nothing. */
export function MidiStatus({ midi }: { midi: MidiState }) {
  const led = useRef<HTMLSpanElement>(null);
  const { subscribeActivity } = midi;
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const off = subscribeActivity(() => {
      led.current?.classList.add("hit");
      clearTimeout(timer);
      timer = setTimeout(() => led.current?.classList.remove("hit"), 80);
    });
    return () => {
      off();
      clearTimeout(timer);
    };
  }, [subscribeActivity]);

  const listening = midi.enabled && midi.status === "on";
  const label = !midi.enabled
    ? "MIDI is off. Click to turn on: connected MIDI keyboards then play the selected track."
    : midi.status === "unsupported"
      ? "This browser has no Web MIDI."
      : midi.status === "blocked"
        ? "MIDI access was refused. Allow it in the browser's site settings, then click to try again."
        : midi.inputs.length === 0
          ? "MIDI is on. No MIDI input connected."
          : `MIDI is on. Playing the selected track from: ${midi.inputs.join(", ")}`;
  const state = !midi.enabled ? "off" : midi.status === "on" ? (midi.inputs.length > 0 ? "ready" : "idle") : "error";

  return (
    <button
      className={`midi-status-button ${state}`}
      title={label}
      aria-label={label}
      aria-pressed={midi.enabled}
      onClick={() => midi.setEnabled(!midi.enabled || midi.status === "blocked")}
      disabled={midi.status === "unsupported"}
    >
      <span ref={led} className="midi-led" aria-hidden="true" />
      MIDI{listening && midi.inputs.length > 1 ? ` ×${midi.inputs.length}` : ""}
    </button>
  );
}
