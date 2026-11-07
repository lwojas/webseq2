import { describe, expect, it, vi } from "vitest";
import { connectMidi, routeMidiMessage, type MidiSnapshot, type NoteSink } from "../src/midi/midiInput";

function sink() {
  const calls: string[] = [];
  const s: NoteSink = {
    noteOn: (n, v) => calls.push(`on ${n} ${v.toFixed(2)}`),
    noteOff: (n) => calls.push(`off ${n}`),
    allNotesOff: () => calls.push("all off"),
  };
  return { s, calls };
}

function fakeInput(name: string) {
  const listeners = new Set<(e: Event) => void>();
  return {
    name,
    type: "input",
    state: "connected",
    addEventListener: (_: string, fn: (e: Event) => void) => listeners.add(fn),
    removeEventListener: (_: string, fn: (e: Event) => void) => listeners.delete(fn),
    send: (data: number[]) => listeners.forEach((fn) => fn({ data: Uint8Array.from(data) } as unknown as Event)),
  };
}

function fakeAccess(inputs: ReturnType<typeof fakeInput>[]) {
  const handlers = new Set<(e: Event) => void>();
  return {
    inputs: new Map(inputs.map((input, i) => [String(i), input])),
    addEventListener: (_: string, fn: (e: Event) => void) => handlers.add(fn),
    removeEventListener: (_: string, fn: (e: Event) => void) => handlers.delete(fn),
    emit: (port: unknown) => handlers.forEach((fn) => fn({ port } as unknown as Event)),
  };
}

const tick = () => new Promise((r) => setTimeout(r, 0));

describe("routeMidiMessage", () => {
  it("routes note on/off, treats velocity-0 note-on as off, and CC 123/120 as all-off", () => {
    const { s, calls } = sink();
    routeMidiMessage([0x90, 60, 127], s);
    routeMidiMessage([0x91, 64, 0], s);
    routeMidiMessage([0x80, 60, 0], s);
    routeMidiMessage([0xb0, 123, 0], s);
    routeMidiMessage([0xb0, 120, 0], s);
    routeMidiMessage([0xb0, 7, 90], s); // an ordinary CC is not a note
    routeMidiMessage([0xe0, 0, 64], s); // pitch bend is ignored
    expect(calls).toEqual(["on 60 1.00", "off 64", "off 60", "all off", "all off"]);
  });
});

describe("connectMidi", () => {
  it("listens to every input, whatever it is called, and reports them", async () => {
    const keys = fakeInput("Arturia KeyStep");
    const pads = fakeInput("Launchpad Mini MK3 LPMiniMK3 MIDI Out");
    const { s, calls } = sink();
    const snapshots: MidiSnapshot[] = [];
    const onActivity = vi.fn();
    const conn = connectMidi(s, { requestAccess: async () => fakeAccess([keys, pads]) as unknown as MIDIAccess, onChange: (x) => snapshots.push(x), onActivity });
    await tick();
    keys.send([0x90, 60, 100]);
    pads.send([0x90, 36, 100]);
    expect(calls).toEqual(["on 60 0.79", "on 36 0.79"]);
    expect(onActivity).toHaveBeenCalledTimes(2);
    expect(snapshots[snapshots.length - 1]).toEqual({ status: "on", inputs: ["Arturia KeyStep", "Launchpad Mini MK3 LPMiniMK3 MIDI Out"] });
    conn.dispose();
    keys.send([0x90, 61, 100]);
    expect(calls).toEqual(["on 60 0.79", "on 36 0.79", "all off"]); // detached: no more notes, held notes released
  });

  it("picks up an input plugged in later and drops one that is removed", async () => {
    const access = fakeAccess([]);
    const { s, calls } = sink();
    const snapshots: MidiSnapshot[] = [];
    connectMidi(s, { requestAccess: async () => access as unknown as MIDIAccess, onChange: (x) => snapshots.push(x) });
    await tick();
    const keys = fakeInput("Keys");
    access.emit(keys);
    keys.send([0x90, 62, 127]);
    expect(snapshots[snapshots.length - 1]?.inputs).toEqual(["Keys"]);
    access.emit({ ...keys, state: "disconnected" , type: "input"} as never);
    expect(calls).toEqual(["on 62 1.00"]);
  });

  it("reports blocked when access is refused and unsupported when there is no Web MIDI", async () => {
    const blocked: MidiSnapshot[] = [];
    connectMidi(sink().s, { requestAccess: () => Promise.reject(new Error("denied")), onChange: (x) => blocked.push(x) });
    await tick();
    expect(blocked).toEqual([{ status: "blocked", inputs: [] }]);

    const none: MidiSnapshot[] = [];
    connectMidi(sink().s, { onChange: (x) => none.push(x) }); // node: no navigator.requestMIDIAccess
    await tick();
    expect(none).toEqual([{ status: "unsupported", inputs: [] }]);
  });
});
