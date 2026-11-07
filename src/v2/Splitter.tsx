import { useRef, type PointerEvent as ReactPointerEvent, type RefObject } from "react";
import { clamp } from "./workspace";

interface Props {
  /** "col": a vertical bar dragged left/right (resizes a width). "row": a horizontal bar dragged up/down (resizes a height). */
  axis: "col" | "row";
  /** The shell element that carries the CSS variable. */
  shellRef: RefObject<HTMLElement | null>;
  cssVar: string;
  value: number;
  min: number;
  max: number;
  /** +1: dragging toward the end of the axis grows the panel (a left browser grows rightward); -1: it shrinks it (a bottom device area grows upward). */
  direction: 1 | -1;
  onCommit: (value: number) => void;
  label: string;
}

/** A panel edge. Dragging writes the CSS variable straight onto the shell and commits once on release, so a drag never re-renders the app. */
export function Splitter({ axis, shellRef, cssVar, value, min, max, direction, onCommit, label }: Props) {
  const start = useRef<{ pointer: number; value: number } | null>(null);
  const live = useRef(value);

  const down = (e: ReactPointerEvent) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    start.current = { pointer: axis === "col" ? e.clientX : e.clientY, value };
    live.current = value;
  };
  const move = (e: ReactPointerEvent) => {
    if (!start.current) return;
    const delta = ((axis === "col" ? e.clientX : e.clientY) - start.current.pointer) * direction;
    live.current = clamp(start.current.value + delta, min, max);
    shellRef.current?.style.setProperty(cssVar, `${live.current}px`);
  };
  const up = () => {
    if (!start.current) return;
    start.current = null;
    onCommit(live.current);
  };
  const key = (e: React.KeyboardEvent) => {
    const step = e.shiftKey ? 40 : 10;
    const grow = axis === "col" ? "ArrowRight" : "ArrowUp";
    const shrink = axis === "col" ? "ArrowLeft" : "ArrowDown";
    if (e.key !== grow && e.key !== shrink) return;
    e.preventDefault();
    onCommit(clamp(value + (e.key === grow ? step : -step) * direction * (axis === "col" ? 1 : 1), min, max));
  };

  return (
    <div
      className={`v2-splitter ${axis}`}
      role="separator"
      aria-orientation={axis === "col" ? "vertical" : "horizontal"}
      aria-label={label}
      aria-valuenow={Math.round(value)}
      aria-valuemin={min}
      aria-valuemax={max}
      tabIndex={0}
      onPointerDown={down}
      onPointerMove={move}
      onPointerUp={up}
      onPointerCancel={up}
      onKeyDown={key}
    />
  );
}
