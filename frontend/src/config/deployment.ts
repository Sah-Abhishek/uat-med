// Mirror of the backend DEPLOYMENT env var. Used to drive UAT-only safety UI
// (e.g. warning users that submitted code corrections will NOT reach the AI
// golden dataset because the backend skips the forward outside production).
const raw = (import.meta.env.VITE_DEPLOYMENT as string | undefined)?.toLowerCase() ?? 'uat';

export const DEPLOYMENT = raw;
export const IS_PRODUCTION_DEPLOYMENT = raw === 'production';
