import { useCallback, useState } from 'react';
import { useMsal } from '@azure/msal-react';
import { InteractionRequiredAuthError } from '@azure/msal-browser';

/** Foundry data-plane scope for Voice Live */
const SCOPES = ['https://ai.azure.com/.default'];

export interface EntraToken {
  /** Whether a user is signed in (a token can be acquired) */
  signedIn: boolean;
  /** Display name of the signed-in account */
  username: string | undefined;
  /** Sign-in / sign-out problems, for an `<ErrorPanel>` */
  authError: string | null;
  signIn: () => Promise<void>;
  signOut: () => void;
  /**
   * Pass this straight to `connection.getToken`. The SDK calls it on **every** connect and
   * reconnect, so the session always uses a fresh token — which is why the token must not be
   * baked into `proxyUrl` instead: a URL built once at sign-in freezes the token, and the first
   * reconnect after it expires fails.
   */
  getToken: () => Promise<string>;
}

/**
 * Per-user Entra ID authentication for the proxy-backed examples.
 *
 * Each user connects with their own token, so the proxy can authorize and audit them
 * individually instead of everyone sharing the proxy's identity.
 */
export function useEntraToken(): EntraToken {
  const { instance, accounts } = useMsal();
  const [authError, setAuthError] = useState<string | null>(null);
  const account = accounts[0];

  const signIn = useCallback(async (): Promise<void> => {
    try {
      setAuthError(null);
      await instance.loginPopup({ scopes: SCOPES });
    } catch (err) {
      setAuthError(`Sign-in failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }, [instance]);

  const signOut = useCallback((): void => {
    setAuthError(null);
    void instance.logoutPopup();
  }, [instance]);

  const getToken = useCallback(async (): Promise<string> => {
    if (!account) throw new Error('Not signed in');
    try {
      const silent = await instance.acquireTokenSilent({ scopes: SCOPES, account });
      return silent.accessToken;
    } catch (err) {
      // The cached token expired and cannot be renewed without the user: ask them once, here,
      // rather than letting the connection fail
      if (err instanceof InteractionRequiredAuthError) {
        const interactive = await instance.acquireTokenPopup({ scopes: SCOPES, account });
        return interactive.accessToken;
      }
      throw err;
    }
  }, [instance, account]);

  return {
    signedIn: !!account,
    username: account?.username,
    authError,
    signIn,
    signOut,
    getToken,
  };
}
