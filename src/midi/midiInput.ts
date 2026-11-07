// MIDI in, as simply as it can be: every connected MIDI input plays the selected track. No device
// registry, no connect step, no port pickers. Web MIDI is the only dependency, and it is injected so
// the module tests without a browser.
//
// This module knows nothing about tracks or React. Where notes go is the caller's `NoteSink`
// (Playback.noteOn/noteOff for the selected track, a recorder, ...). The React side is useMidi.ts.

export interface NoteSink {
  noteOn(note: number, velocity01: number): void;
  noteOff(note: number): void;
  allNotesOff(): void;
}

/** Routes one raw MIDI message to the sink. Note-on with velocity 0 is a note-off; CC 123 (all notes off) and
 * CC 120 (all sound off) release everything. Anything else (CC, pitch bend, aftertouch, SysEx) is ignored. */
export function routeMidiMessage(data: ArrayLike<number>, sink: NoteSink): void {
  const status = data[0] ?? 0;
  const kind = status >> 4;
  if (kind === 0x9 && (data[2] ?? 0) > 0) sink.noteOn(data[1] ?? 0, (data[2] ?? 0) / 127);
  else if (kind === 0x8 || kind === 0x9) sink.noteOff(data[1] ?? 0);
  else if (kind === 0xb && ((data[1] ?? 0) === 123 || (data[1] ?? 0) === 120)) sink.allNotesOff();
}

/** What the UI shows: whether MIDI is working, and which inputs are being listened to. */
export interface MidiSnapshot {
  /** "unsupported": no Web MIDI here. "blocked": the user (or browser) refused access. "on": listening. */
  status: "unsupported" | "blocked" | "on";
  /** Names of the connected inputs, in the order the browser lists them. */
  inputs: readonly string[];
}

export interface MidiConnection {
  /** Stops listening and releases any held notes. */
  dispose(): void;
}

export interface MidiOptions {
  /** Called whenever the status or the set of connected inputs changes. */
  onChange?: (snapshot: MidiSnapshot) => void;
  /** Called for every message from any input, e.g. to blink an indicator. Must be cheap. */
  onActivity?: () => void;
  requestAccess?: () => Promise<MIDIAccess>;
}

const defaultRequestAccess = (): Promise<MIDIAccess> => {
  if (typeof navigator === "undefined" || typeof navigator.requestMIDIAccess !== "function") return Promise.reject(new MidiUnsupported());
  return navigator.requestMIDIAccess();
};

class MidiUnsupported extends Error {}

/** Listens on every MIDI input, now and as they are plugged in or removed, and routes their notes to `sink`. */
export function connectMidi(sink: NoteSink, { onChange, onActivity, requestAccess = defaultRequestAccess }: MidiOptions = {}): MidiConnection {
  let disposed = false;
  let access: MIDIAccess | null = null;
  const wired = new Set<MIDIInput>();

  const report = (status: MidiSnapshot["status"]) => {
    if (!disposed) onChange?.({ status, inputs: [...wired].map((input) => input.name ?? "MIDI input") });
  };

  const onMessage = (event: Event) => {
    onActivity?.();
    routeMidiMessage((event as MIDIMessageEvent).data ?? [], sink);
  };
  const wire = (input: MIDIInput) => {
    if (wired.has(input)) return;
    input.addEventListener("midimessage", onMessage);
    wired.add(input);
  };
  const unwire = (input: MIDIInput) => {
    input.removeEventListener("midimessage", onMessage);
    wired.delete(input);
  };
  const onStateChange = (event: Event) => {
    const port = (event as MIDIConnectionEvent).port;
    if (!port || port.type !== "input") return;
    if (port.state === "connected") wire(port as MIDIInput);
    else unwire(port as MIDIInput);
    report("on");
  };

  Promise.resolve()
    .then(requestAccess)
    .then((granted) => {
      if (disposed) return;
      access = granted;
      granted.inputs.forEach((input) => wire(input));
      granted.addEventListener("statechange", onStateChange);
      report("on");
    })
    .catch((err) => report(err instanceof MidiUnsupported ? "unsupported" : "blocked"));

  return {
    dispose() {
      if (disposed) return;
      access?.removeEventListener("statechange", onStateChange);
      wired.forEach(unwire);
      disposed = true;
      sink.allNotesOff();
    },
  };
}
