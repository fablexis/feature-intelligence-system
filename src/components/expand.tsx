'use client';

import { ChevronDown } from 'lucide-react';
import { useId, useState, type ReactNode } from 'react';

/**
 * A disclosure whose height animates without JavaScript measuring anything:
 * `grid-template-rows: 0fr → 1fr` does the work, and this component only flips
 * a class ([DESIGN](../../docs/DESIGN.md), motion #5).
 *
 * `<details>` would need no JavaScript at all, but it cannot animate its own
 * height, and the design asks for the expand to explain rather than to jump.
 * This is the smaller of the two costs.
 *
 * It renders a real `<button>` with `aria-expanded` and `aria-controls`, so it
 * is operable from the keyboard and announced correctly.
 */
export function Expand({
  label,
  openLabel,
  children,
  className = '',
}: {
  label: string;
  openLabel?: string;
  children: ReactNode;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const id = useId();

  return (
    <>
      <button
        type="button"
        className={className || 'prov-more'}
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen((v) => !v)}
      >
        {open && openLabel ? openLabel : label}
        <ChevronDown className={`size-4 chev ${open ? 'chev-open' : ''}`} aria-hidden />
      </button>
      <div id={id} className={`xp ${open ? 'xp-open' : ''}`}>
        <div>{children}</div>
      </div>
    </>
  );
}
