'use client';

import { useEffect, useLayoutEffect, useRef, useState } from 'react';

/**
 * A segmented control whose indicator slides between options
 * ([DESIGN](../../docs/DESIGN.md), motion #6).
 *
 * The indicator is positioned from the pressed button's own box rather than
 * from a width guess, and it is re-placed once `document.fonts` resolves:
 * next/font swaps metrics after first paint, which moves every label, and an
 * indicator measured before that lands in the wrong place.
 */
export type Segment = { value: string; label: string; count?: number };

export function Segmented({
  segments,
  value,
  onChange,
  ariaLabel,
}: {
  segments: readonly Segment[];
  value: string;
  onChange: (value: string) => void;
  ariaLabel: string;
}) {
  const root = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState<{ left: number; width: number } | null>(null);

  const place = () => {
    const el = root.current?.querySelector<HTMLButtonElement>('[aria-pressed="true"]');
    if (el) setBox({ left: el.offsetLeft, width: el.offsetWidth });
  };

  useLayoutEffect(place, [value, segments]);

  useEffect(() => {
    // Metrics change when the webfont lands, and again if the box resizes.
    void document.fonts?.ready.then(place);
    const observer = new ResizeObserver(place);
    if (root.current) observer.observe(root.current);
    return () => observer.disconnect();
  }, []);

  return (
    <div className="seg" ref={root} role="group" aria-label={ariaLabel}>
      <span className="seg-slide" style={box ? { left: box.left, width: box.width } : undefined} />
      {segments.map((s) => (
        <button
          key={s.value}
          type="button"
          aria-pressed={s.value === value}
          onClick={() => onChange(s.value)}
        >
          {s.label}
          {s.count !== undefined && <b className="num">{s.count}</b>}
        </button>
      ))}
    </div>
  );
}
