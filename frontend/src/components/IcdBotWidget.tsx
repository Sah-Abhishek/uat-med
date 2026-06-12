import { useEffect } from 'react';

// Floating ICD-10-CM assistant chatbot (the ✦ button, bottom-right). The
// widget is a self-contained script served by the bot API: it appends a
// #icd-bot-root div to document.body and renders inside a shadow root, so
// none of our styles leak into it (or vice versa).
//
// The script is injected once and never removed — instead the root div is
// hidden whenever no page renders <IcdBotWidget />. That keeps the coder's
// chat history alive while navigating between charts pages.
//
// Defaults to the same-origin /icd-bot path: nginx-proxy-manager forwards it
// to the bot machine in production, and the vite dev/preview proxy does the
// same locally. Same-origin keeps https pages free of mixed-content blocks.
const BOT_API = (import.meta.env.VITE_ICD_BOT_API || '/icd-bot').replace(/\/$/, '');
const SCRIPT_ID = 'icd-bot-script';
const ROOT_ID = 'icd-bot-root';

// Pages mounting the widget can overlap for a frame during route
// transitions, and the script loads async — a counter (not a boolean)
// keeps visibility correct in both cases.
let mountedCount = 0;

function syncVisibility() {
  const root = document.getElementById(ROOT_ID);
  if (root) root.style.display = mountedCount > 0 ? '' : 'none';
}

export function IcdBotWidget() {
  useEffect(() => {
    mountedCount += 1;

    if (!document.getElementById(SCRIPT_ID)) {
      const script = document.createElement('script');
      script.id = SCRIPT_ID;
      script.src = `${BOT_API}/widget/icd-bot.js`;
      script.setAttribute('data-api', BOT_API);
      script.async = true;
      // If the user navigated away before the script finished loading,
      // hide the root as soon as the widget creates it.
      script.addEventListener('load', syncVisibility);
      document.body.appendChild(script);
    }

    syncVisibility();
    return () => {
      mountedCount -= 1;
      syncVisibility();
    };
  }, []);

  return null;
}
