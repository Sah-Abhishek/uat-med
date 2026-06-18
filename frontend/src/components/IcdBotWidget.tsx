import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { GripHorizontal } from 'lucide-react';

// Floating ICD-10-CM assistant chatbot (the ✦ button, bottom-right). The
// widget is a self-contained script served by the bot API: it appends a
// #icd-bot-root div to document.body and renders inside an OPEN shadow root,
// so none of our styles leak into it (or vice versa).
//
// The script is injected once and never removed — instead the root div is
// hidden whenever no page renders <IcdBotWidget />. That keeps the coder's
// chat history alive while navigating between charts pages.
//
// Draggability: the widget's launcher and chat panel are `position: fixed`
// inside the shadow root, which we don't control. We make them movable WITHOUT
// touching the widget by turning the #icd-bot-root host into a 0×0 fixed box
// pinned to the bottom-right corner and applying a `transform` to it — a
// transform establishes a containing block for the inner fixed elements, so
// they re-anchor to (and move with) the host. A small grip handle we render
// drives the drag; the launcher keeps its normal click-to-open behaviour.
//
// Defaults to the same-origin /icd-bot path: nginx-proxy-manager forwards it
// to the bot machine in production, and the vite dev/preview proxy does the
// same locally. Same-origin keeps https pages free of mixed-content blocks.
const BOT_API = (import.meta.env.VITE_ICD_BOT_API || '/icd-bot').replace(/\/$/, '');
const SCRIPT_ID = 'icd-bot-script';
const ROOT_ID = 'icd-bot-root';
const POS_KEY = 'icd-bot.offset';

// Pages mounting the widget can overlap for a frame during route
// transitions, and the script loads async — a counter (not a boolean)
// keeps visibility correct in both cases.
let mountedCount = 0;

function syncVisibility() {
  const root = document.getElementById(ROOT_ID);
  if (root) root.style.display = mountedCount > 0 ? '' : 'none';
}

interface Offset {
  x: number;
  y: number;
}

function loadOffset(): Offset {
  try {
    const raw = localStorage.getItem(POS_KEY);
    if (raw) {
      const o = JSON.parse(raw);
      if (typeof o?.x === 'number' && typeof o?.y === 'number') return o;
    }
  } catch {
    /* ignore */
  }
  return { x: 0, y: 0 };
}

/** Keep the bot fully on-screen. The launcher is ~60px; only let it move up and
 * to the left of its default bottom-right anchor (negative offsets). */
function clampOffset(x: number, y: number): Offset {
  const MARGIN = 72;
  const minX = -(window.innerWidth - MARGIN);
  const minY = -(window.innerHeight - MARGIN);
  return {
    x: Math.min(0, Math.max(minX, x)),
    y: Math.min(0, Math.max(minY, y)),
  };
}

export function IcdBotWidget() {
  const [offset, setOffset] = useState<Offset>(loadOffset);
  const offsetRef = useRef(offset);
  offsetRef.current = offset;
  const drag = useRef<{ px: number; py: number; bx: number; by: number } | null>(null);
  const [grabbing, setGrabbing] = useState(false);

  // Inject the widget script once + manage visibility (unchanged behaviour).
  useEffect(() => {
    mountedCount += 1;
    if (!document.getElementById(SCRIPT_ID)) {
      const script = document.createElement('script');
      script.id = SCRIPT_ID;
      script.src = `${BOT_API}/widget/icd-bot.js`;
      script.setAttribute('data-api', BOT_API);
      script.async = true;
      script.addEventListener('load', syncVisibility);
      document.body.appendChild(script);
    }
    syncVisibility();
    return () => {
      mountedCount -= 1;
      syncVisibility();
    };
  }, []);

  // Pin the host to the bottom-right as a 0×0 fixed box and apply the offset
  // transform. Retries until the async script has created the root, and
  // re-applies whenever the offset changes.
  useEffect(() => {
    let raf = 0;
    const apply = () => {
      const root = document.getElementById(ROOT_ID);
      if (!root) {
        raf = requestAnimationFrame(apply);
        return;
      }
      root.style.position = 'fixed';
      root.style.right = '0px';
      root.style.bottom = '0px';
      root.style.width = '0px';
      root.style.height = '0px';
      root.style.overflow = 'visible'; // never clip the fixed children to 0×0
      root.style.transform = `translate(${offset.x}px, ${offset.y}px)`;
      // Lift the whole widget (launcher + chat panel) above app modals/overlays
      // so it stays clickable and un-blurred while a modal is open. The host's
      // transform already makes it a stacking context; without a z-index it sits
      // at z-auto and the modal backdrops (z-50 / z-[60], backdrop-blur) paint
      // over it. A max-ish value keeps it on top — just below our drag grip
      // (2147483001) so the grip stays grabbable.
      root.style.zIndex = '2147483000';
    };
    apply();
    return () => cancelAnimationFrame(raf);
  }, [offset]);

  // Re-clamp if the viewport shrinks so the bot can't end up off-screen.
  useEffect(() => {
    const onResize = () => setOffset((o) => clampOffset(o.x, o.y));
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    e.preventDefault();
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    drag.current = { px: e.clientX, py: e.clientY, bx: offsetRef.current.x, by: offsetRef.current.y };
    setGrabbing(true);
  }, []);

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    setOffset(clampOffset(d.bx + (e.clientX - d.px), d.by + (e.clientY - d.py)));
  }, []);

  const onPointerUp = useCallback((e: React.PointerEvent) => {
    if (!drag.current) return;
    drag.current = null;
    setGrabbing(false);
    try {
      (e.target as HTMLElement).releasePointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
    try {
      localStorage.setItem(POS_KEY, JSON.stringify(offsetRef.current));
    } catch {
      /* ignore */
    }
  }, []);

  // The grip sits just above the launcher and carries the same offset, so it
  // stays attached. z-index one above the widget's so it's always grabbable.
  return createPortal(
    <div
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      title="Drag to move the AI assistant"
      aria-label="Drag to move the AI assistant"
      style={{
        position: 'fixed',
        right: 26,
        bottom: 84,
        transform: `translate(${offset.x}px, ${offset.y}px)`,
        zIndex: 2147483001,
        touchAction: 'none',
        cursor: grabbing ? 'grabbing' : 'grab',
        userSelect: 'none',
      }}
      className="flex items-center justify-center w-[52px] h-[16px] rounded-full bg-black/55 hover:bg-black/75 text-white/90 shadow-md transition-colors"
    >
      <GripHorizontal className="w-3.5 h-3.5" />
    </div>,
    document.body,
  );
}
