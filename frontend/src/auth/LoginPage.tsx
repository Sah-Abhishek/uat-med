import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { useNavigate, useSearchParams, Link } from 'react-router-dom';
import { login, ssoExchange } from '@/api/auth';
import { useAuth } from './store';
import { signInWithMicrosoft, handleMsalRedirect, MSAL_CONFIGURED } from './msal';
import type { ApiErrorShape } from '@/api/types';
import { Button } from '@/components/ui/Button';
import { Label } from '@/components/ui/Field';
import { ChevronDown, ChevronUp, TriangleAlert, Loader2 } from 'lucide-react';

interface Form {
  username: string;
  password: string;
}

export function LoginPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const setFromLogin = useAuth((s) => s.setFromLogin);
  const currentUser = useAuth((s) => s.user);
  const accessToken = useAuth((s) => s.accessToken);

  const [submitError, setSubmitError] = useState<string | null>(null);
  const [devOpen, setDevOpen] = useState(!MSAL_CONFIGURED);
  const [ssoBusy, setSsoBusy] = useState(false);

  const expired = searchParams.get('expired') === 'true';

  // ── Redirect if already signed in ─────────────────────────
  useEffect(() => {
    if (currentUser && accessToken) {
      navigate('/', { replace: true });
    }
  }, [currentUser, accessToken, navigate]);

  // ── Handle MSAL redirect return ────────────────────────────
  // When Microsoft sends the user back to /login with the auth code,
  // MSAL resolves it, we grab the access token, then call our backend
  // to exchange it for a Valerion JWT.
  useEffect(() => {
    if (!MSAL_CONFIGURED) return;

    let cancelled = false;

    (async () => {
      setSsoBusy(true);
      try {
        const msalResult = await handleMsalRedirect();
        if (!msalResult || cancelled) {
          setSsoBusy(false);
          return;
        }

        // Exchange Microsoft tokens for a Valerion JWT.
        // - idToken: issued for our app and signed with the tenant's keys, so the
        //   backend verifies it via JWKS to authenticate the user.
        // - accessToken: the Graph token (User.Read scope) — the backend uses it to
        //   fetch the profile photo. Graph rejects ID tokens, so this must be sent
        //   separately rather than reusing the idToken.
        const valerionSession = await ssoExchange(msalResult.idToken, msalResult.accessToken);
        setFromLogin(valerionSession);
        navigate('/', { replace: true });
      } catch (err) {
        if (!cancelled) {
          setSubmitError((err as ApiErrorShape).message ?? (err as Error).message ?? 'SSO sign-in failed.');
          setSsoBusy(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [navigate, setFromLogin]);

  // ── Email/password form ────────────────────────────────────
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<Form>({ defaultValues: { username: '', password: '' } });

  const onSubmit = async (values: Form) => {
    setSubmitError(null);
    try {
      const res = await login(values.username.trim(), values.password);
      setFromLogin(res);
      navigate('/', { replace: true });
    } catch (err) {
      setSubmitError((err as ApiErrorShape).message || 'Login failed. Please try again.');
    }
  };

  async function onMicrosoftClick() {
    setSubmitError(null);
    setSsoBusy(true);
    try {
      await signInWithMicrosoft();
      // If redirect mode, page will navigate away. If popup mode, flow continues in effect above.
    } catch (err) {
      setSubmitError((err as Error).message);
      setSsoBusy(false);
    }
  }

  return (
    <div className="min-h-screen grid lg:grid-cols-2 bg-[#0E1116] text-white">
      {/* ── LEFT ─────────────────────────── */}
      <aside className="relative flex flex-col justify-between p-10 lg:p-14 overflow-hidden">
        <div>
          <img src="/valerion-logo-D.png" alt="Valerion Health" className="h-9 w-auto" />
          <h1 className="mt-16 text-3xl font-bold">Welcome to Valerion</h1>
          <p className="mt-2 text-sm text-white/70 font-medium">
            Efficient coding for better healthcare outcomes
          </p>
        </div>
        <div className="relative mt-10 lg:mt-0">
          <img src="/signin.svg" alt="" className="w-full max-w-[420px] mx-auto opacity-95" draggable={false} />
        </div>
        <div className="relative text-[10px] tracking-[0.2em] uppercase text-white/40 mt-6">
          v 2.1 · UAT
        </div>
      </aside>

      {/* ── RIGHT ────────────────────────── */}
      <main className="flex items-center justify-center p-6 lg:p-16 bg-[#0E1116] border-l border-white/5">
        <div className="w-full max-w-sm">
          <h2 className="text-2xl font-bold text-center mb-8">Sign In to Valerion</h2>

          {expired && (
            <div className="mb-5 flex items-start gap-2 text-xs px-3 py-2.5 rounded-lg bg-amber-500/10 text-amber-300 border border-amber-500/30">
              <TriangleAlert className="w-3.5 h-3.5 mt-0.5 shrink-0" />
              Your session expired. Please sign in again.
            </div>
          )}

          {submitError && (
            <div className="mb-5 text-xs px-3 py-2.5 rounded-lg bg-rose-500/10 text-rose-300 border border-rose-500/30">
              {submitError}
            </div>
          )}

          {ssoBusy ? (
            <div className="flex flex-col items-center gap-3 py-8">
              <Loader2 className="w-6 h-6 animate-spin text-primary" />
              <p className="text-sm text-white/60">Completing Microsoft sign-in…</p>
            </div>
          ) : (
            <>
              <button
                onClick={onMicrosoftClick}
                disabled={!MSAL_CONFIGURED}
                className="w-full h-12 rounded-pill bg-white/5 hover:bg-white/10 border border-white/10 text-white/90 font-medium text-sm transition flex items-center justify-center gap-3 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <MicrosoftLogo />
                Sign in with Microsoft
              </button>

              {!MSAL_CONFIGURED && (
                <p className="mt-3 text-[11px] text-white/50 text-center">
                  Microsoft SSO not configured. Set VITE_AZURE_CLIENT_ID in env.
                </p>
              )}

              <div className="mt-8">
                <button
                  onClick={() => setDevOpen((v) => !v)}
                  className="w-full flex items-center justify-center gap-2 text-xs text-white/60 hover:text-white/80 transition"
                >
                  <span>Continue with email</span>
                  {devOpen ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                </button>

                {devOpen && (
                  <form onSubmit={handleSubmit(onSubmit)} noValidate className="mt-5 space-y-4">
                    <div>
                      <Label htmlFor="username" className="!text-white/60">Email</Label>
                      <input
                        id="username"
                        type="email"
                        autoComplete="username"
                        placeholder="you@valerionhealth.com"
                        className="w-full h-11 px-3.5 bg-white/5 border border-white/10 rounded-pill text-sm text-white placeholder:text-white/30 focus:border-primary focus:outline-none transition"
                        {...register('username', { required: 'Email is required' })}
                      />
                      {errors.username && <p className="mt-1 text-xs text-rose-300">{errors.username.message}</p>}
                    </div>
                    <div>
                      <Label htmlFor="password" className="!text-white/60">Password</Label>
                      <input
                        id="password"
                        type="password"
                        autoComplete="current-password"
                        placeholder="••••••••••••"
                        className="w-full h-11 px-3.5 bg-white/5 border border-white/10 rounded-pill text-sm text-white placeholder:text-white/30 focus:border-primary focus:outline-none transition"
                        {...register('password', { required: 'Password is required' })}
                      />
                      {errors.password && <p className="mt-1 text-xs text-rose-300">{errors.password.message}</p>}
                    </div>
                    <Button type="submit" loading={isSubmitting} className="w-full h-11 !bg-primary !text-primary-ink">
                      Sign in
                    </Button>
                  </form>
                )}

                <p className="mt-6 text-[11px] text-white/40 text-center">
                  Need access?{' '}
                  <Link to="/signup" className="text-primary hover:underline underline-offset-4">
                    Request an account
                  </Link>
                </p>
              </div>
            </>
          )}
        </div>
      </main>
    </div>
  );
}

function MicrosoftLogo() {
  return (
    <svg viewBox="0 0 21 21" className="w-4 h-4" aria-hidden>
      <rect x="1" y="1" width="9" height="9" fill="#F25022" />
      <rect x="11" y="1" width="9" height="9" fill="#7FBA00" />
      <rect x="1" y="11" width="9" height="9" fill="#00A4EF" />
      <rect x="11" y="11" width="9" height="9" fill="#FFB900" />
    </svg>
  );
}