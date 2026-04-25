/**
 * MSAL (Microsoft Entra) integration — full redirect flow.
 *
 * Set these in .env.development / .env.production:
 *   VITE_AZURE_CLIENT_ID=<app registration client id>
 *   VITE_AZURE_TENANT_ID=<tenant id>
 *   VITE_AZURE_REDIRECT_URI=<https://your-origin/login>
 *   VITE_AZURE_API_SCOPE=<optional — defaults to User.Read>
 */

import { PublicClientApplication, type Configuration, type AuthenticationResult } from '@azure/msal-browser';

const clientId = import.meta.env.VITE_AZURE_CLIENT_ID as string | undefined;
const tenantId = (import.meta.env.VITE_AZURE_TENANT_ID as string | undefined) ?? 'common';
const redirectUri =
  (import.meta.env.VITE_AZURE_REDIRECT_URI as string | undefined) ??
  (typeof window !== 'undefined' ? `${window.location.origin}/login` : '');

export const MSAL_CONFIGURED = Boolean(clientId);

export const msalConfig: Configuration | null = MSAL_CONFIGURED
  ? {
      auth: {
        clientId: clientId!,
        authority: `https://login.microsoftonline.com/${tenantId}`,
        redirectUri,
        postLogoutRedirectUri: redirectUri,
      },
      cache: {
        cacheLocation: 'sessionStorage',
        storeAuthStateInCookie: false,
      },
    }
  : null;

export const msalInstance: PublicClientApplication | null = msalConfig
  ? new PublicClientApplication(msalConfig)
  : null;

export const LOGIN_SCOPES = [
  'openid',
  'profile',
  'email',
  (import.meta.env.VITE_AZURE_API_SCOPE as string | undefined) ?? 'User.Read',
];

let initialized = false;
async function ensureInit() {
  if (!msalInstance) throw new Error('MSAL not configured');
  if (!initialized) {
    await msalInstance.initialize();
    initialized = true;
  }
}

/** Kick off interactive Microsoft sign-in via redirect. */
export async function signInWithMicrosoft(): Promise<void> {
  await ensureInit();
  await msalInstance!.loginRedirect({ scopes: LOGIN_SCOPES });
}

/**
 * Call on app mount (or on the /login page) to finish the redirect flow.
 * Returns the Microsoft auth result if we just returned from Microsoft,
 * or null if there's no redirect to handle.
 */
export async function handleMsalRedirect(): Promise<AuthenticationResult | null> {
  if (!MSAL_CONFIGURED || !msalInstance) return null;

  await ensureInit();
  const response = await msalInstance.handleRedirectPromise();
  if (!response) return null;

  // We got an auth result back. Set active account so subsequent silent token acquisitions work.
  msalInstance.setActiveAccount(response.account);
  return response;
}

/** Sign out on the Microsoft side. Local Valerion tokens are cleared separately. */
export async function signOutMicrosoft(): Promise<void> {
  if (!msalInstance) return;
  await ensureInit();
  await msalInstance.logoutRedirect({ postLogoutRedirectUri: redirectUri });
}