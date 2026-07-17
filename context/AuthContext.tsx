import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { Platform } from 'react-native';
import * as AppleAuthentication from 'expo-apple-authentication';
import * as Linking from 'expo-linking';
import type { Session, User } from '@supabase/supabase-js';
import { supabase, isSupabaseConfigured } from '../lib/supabase';
import { deleteCloudBackup } from '../features/cloud-backup';
import { mapAuthError, type AuthErrorCode } from '../lib/authErrors';

type AuthResult = {
  success: boolean;
  message: string;
  code?: AuthErrorCode;
  needsEmailConfirmation?: boolean;
  /** Sign-in succeeded at aal1 but a TOTP challenge is required to finish. */
  needsMfa?: boolean;
};

type MfaChallenge = { factorId: string } | null;

type AuthContextValue = {
  isConfigured: boolean;
  loading: boolean;
  session: Session | null;
  user: User | null;
  /** True while a password-recovery deep link is active — the update-password screen gates on this. */
  passwordRecovery: boolean;
  clearPasswordRecovery: () => void;
  /** Set when the session ended without the user asking (revoked elsewhere, account deleted on another device). */
  sessionEndedMessage: string | null;
  clearSessionEndedMessage: () => void;
  /** Non-null when a signed-in-but-not-yet-2FA'd session needs a TOTP code. */
  mfaChallenge: MfaChallenge;

  signIn: (email: string, password: string) => Promise<AuthResult>;
  signUp: (email: string, password: string) => Promise<AuthResult>;
  signInWithApple: () => Promise<AuthResult>;
  signOut: () => Promise<void>;
  signOutAllDevices: () => Promise<AuthResult>;
  deleteAccount: () => Promise<AuthResult>;

  resetPassword: (email: string) => Promise<AuthResult>;
  /** Verify the 6-digit code from a signup confirmation email (in-app path). */
  verifyEmailOtp: (email: string, token: string) => Promise<AuthResult>;
  /** Verify the 6-digit code from a password-reset email, establishing a recovery session. */
  verifyRecoveryOtp: (email: string, token: string) => Promise<AuthResult>;
  /** Set a new password during an active recovery session (from the code or the link). */
  updatePassword: (newPassword: string) => Promise<AuthResult>;
  /** Change password while signed in — re-verifies the current password first. */
  changePassword: (currentPassword: string, newPassword: string) => Promise<AuthResult>;
  /** Set a password on a provider (Apple-only) account so it can sign in on Android/web. */
  addPassword: (newPassword: string) => Promise<AuthResult>;
  /** Change email — Supabase confirms via links sent to BOTH the old and new address. */
  changeEmail: (newEmail: string) => Promise<AuthResult>;
  resendConfirmation: (email: string) => Promise<AuthResult>;
  /** Satisfy a pending sign-in MFA challenge with a TOTP code. */
  verifyMfaChallenge: (code: string) => Promise<AuthResult>;
  /** Abandon a pending MFA challenge — signs the user back out (no half-auth state). */
  cancelMfaChallenge: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

const NOT_CONFIGURED: AuthResult = {
  success: false,
  message: "Cloud accounts aren't configured for this build.",
};

/** Reset/confirm links carry their tokens either as `?query` or `#fragment`
 * params depending on the flow. Pull them from wherever they landed. */
function extractAuthParams(url: string): Record<string, string> {
  const out: Record<string, string> = {};
  const grab = (segment: string | undefined) => {
    if (!segment) return;
    for (const pair of segment.split('&')) {
      const [k, v] = pair.split('=');
      if (k && v) out[decodeURIComponent(k)] = decodeURIComponent(v);
    }
  };
  const hashIndex = url.indexOf('#');
  const queryIndex = url.indexOf('?');
  if (queryIndex >= 0) grab(url.substring(queryIndex + 1, hashIndex >= 0 ? hashIndex : undefined));
  if (hashIndex >= 0) grab(url.substring(hashIndex + 1));
  return out;
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [loading, setLoading] = useState(isSupabaseConfigured);
  const [session, setSession] = useState<Session | null>(null);
  const [passwordRecovery, setPasswordRecovery] = useState(false);
  const [sessionEndedMessage, setSessionEndedMessage] = useState<string | null>(null);
  const [mfaChallenge, setMfaChallenge] = useState<MfaChallenge>(null);

  // Tracks whether *we* initiated the sign-out, so an unexpected SIGNED_OUT
  // (revoked token, deleted on another device) can be told apart from a normal
  // one and surfaced to the user.
  const explicitSignOutRef = useRef(false);
  const hadUserRef = useRef(false);

  useEffect(() => {
    if (!isSupabaseConfigured) return;

    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      hadUserRef.current = !!data.session?.user;
      setLoading(false);
    });

    const { data: subscription } = supabase.auth.onAuthStateChange((event, newSession) => {
      setSession(newSession);

      if (event === 'PASSWORD_RECOVERY') setPasswordRecovery(true);

      if (event === 'SIGNED_OUT') {
        if (!explicitSignOutRef.current && hadUserRef.current) {
          setSessionEndedMessage('Your session ended — please sign in again.');
        }
        explicitSignOutRef.current = false;
        setMfaChallenge(null);
      }

      hadUserRef.current = !!newSession?.user;
    });

    return () => subscription.subscription.unsubscribe();
  }, []);

  // Native deep-link handling for recovery/confirm links. On web, supabase-js
  // (detectSessionInUrl) handles this and fires PASSWORD_RECOVERY itself. This
  // is the *fallback* path — the primary flows use in-app 6-digit codes.
  useEffect(() => {
    if (!isSupabaseConfigured || Platform.OS === 'web') return;

    const handle = async (url: string | null) => {
      if (!url) return;
      const params = extractAuthParams(url);
      try {
        if (params.code) {
          await supabase.auth.exchangeCodeForSession(params.code);
        } else if (params.access_token && params.refresh_token) {
          await supabase.auth.setSession({
            access_token: params.access_token,
            refresh_token: params.refresh_token,
          });
        }
      } catch {
        // A stale/consumed link fails here; the update-password screen shows the
        // "request a new link" state because no recovery session gets set.
      }
      if (params.type === 'recovery') setPasswordRecovery(true);
    };

    Linking.getInitialURL().then(handle);
    const sub = Linking.addEventListener('url', (e) => handle(e.url));
    return () => sub.remove();
  }, []);

  const redirectTo = useCallback((path: string) => Linking.createURL(path), []);

  // After a password/Apple sign-in, check whether the account has a verified
  // TOTP factor that must still be satisfied. If so, stash the challenge — the
  // account screen shows a code prompt and blocks the signed-in view until it's
  // cleared (never a half-authenticated state).
  const detectMfa = useCallback(async (): Promise<boolean> => {
    try {
      const { data: aal } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
      if (aal?.currentLevel === 'aal1' && aal?.nextLevel === 'aal2') {
        const { data: factors } = await supabase.auth.mfa.listFactors();
        const totp = factors?.totp?.find((f) => f.status === 'verified');
        if (totp) {
          setMfaChallenge({ factorId: totp.id });
          return true;
        }
      }
    } catch {
      /* MFA not configured / offline — treat as not required. */
    }
    return false;
  }, []);

  const signIn = useCallback(
    async (email: string, password: string): Promise<AuthResult> => {
      if (!isSupabaseConfigured) return NOT_CONFIGURED;
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) {
        const mapped = mapAuthError(error);
        return { success: false, message: mapped.message, code: mapped.code };
      }
      const needsMfa = await detectMfa();
      return { success: true, message: 'Signed in.', needsMfa };
    },
    [detectMfa]
  );

  const signUp = useCallback(
    async (email: string, password: string): Promise<AuthResult> => {
      if (!isSupabaseConfigured) return NOT_CONFIGURED;
      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: { emailRedirectTo: redirectTo('account/index') },
      });
      if (error) {
        const mapped = mapAuthError(error);
        return { success: false, message: mapped.message, code: mapped.code };
      }
      if (!data.session) {
        return {
          success: true,
          message: 'Check your email for a 6-digit code to confirm your account.',
          needsEmailConfirmation: true,
        };
      }
      return { success: true, message: 'Account created.' };
    },
    [redirectTo]
  );

  // Native Sign in with Apple (iOS only). Also captures the single-use
  // authorizationCode and hands it to an Edge Function that exchanges it for an
  // Apple refresh token stored server-side — that token is what lets account
  // deletion actually revoke Apple access later (Guideline 5.1.1(v)).
  const signInWithApple = useCallback(async (): Promise<AuthResult> => {
    if (!isSupabaseConfigured) return NOT_CONFIGURED;
    if (Platform.OS !== 'ios') {
      return { success: false, message: 'Sign in with Apple is only available on iOS.' };
    }
    try {
      const credential = await AppleAuthentication.signInAsync({
        requestedScopes: [
          AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
          AppleAuthentication.AppleAuthenticationScope.EMAIL,
        ],
      });
      if (!credential.identityToken) {
        return { success: false, message: "Apple didn't return an identity token. Please try again." };
      }
      const { error } = await supabase.auth.signInWithIdToken({
        provider: 'apple',
        token: credential.identityToken,
      });
      if (error) {
        const mapped = mapAuthError(error);
        return { success: false, message: mapped.message, code: mapped.code };
      }

      if (credential.authorizationCode) {
        try {
          await supabase.functions.invoke('apple-store-token', {
            body: { authorizationCode: credential.authorizationCode },
          });
        } catch {
          /* Non-fatal — deletion falls back to a re-auth revoke if this wasn't stored. */
        }
      }
      const needsMfa = await detectMfa();
      return { success: true, message: 'Signed in with Apple.', needsMfa };
    } catch (e: any) {
      if (e?.code === 'ERR_REQUEST_CANCELED') return { success: false, message: '' };
      return { success: false, message: e?.message ?? 'Sign in with Apple failed.' };
    }
  }, [detectMfa]);

  const verifyMfaChallenge = useCallback(
    async (code: string): Promise<AuthResult> => {
      if (!mfaChallenge) return { success: false, message: 'No pending verification.' };
      const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId: mfaChallenge.factorId, code });
      if (error) {
        const mapped = mapAuthError(error);
        return { success: false, message: mapped.message, code: mapped.code };
      }
      setMfaChallenge(null);
      return { success: true, message: 'Verified.' };
    },
    [mfaChallenge]
  );

  const signOut = useCallback(async () => {
    if (!isSupabaseConfigured) return;
    explicitSignOutRef.current = true;
    setMfaChallenge(null);
    // Local scope: signing out this device must not kill the user's other
    // devices (supabase-js defaults to global, which does exactly that).
    await supabase.auth.signOut({ scope: 'local' });
  }, []);

  const cancelMfaChallenge = useCallback(async () => {
    await signOut();
  }, [signOut]);

  const signOutAllDevices = useCallback(async (): Promise<AuthResult> => {
    if (!isSupabaseConfigured) return NOT_CONFIGURED;
    explicitSignOutRef.current = true;
    const { error } = await supabase.auth.signOut({ scope: 'global' });
    if (error) {
      const mapped = mapAuthError(error);
      return { success: false, message: mapped.message, code: mapped.code };
    }
    return { success: true, message: 'Signed out of all devices.' };
  }, []);

  const resetPassword = useCallback(
    async (email: string): Promise<AuthResult> => {
      if (!isSupabaseConfigured) return NOT_CONFIGURED;
      const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: redirectTo('account/update-password'),
      });
      if (error) {
        const mapped = mapAuthError(error);
        return { success: false, message: mapped.message, code: mapped.code };
      }
      // Enumeration-safe: same message whether or not the email exists.
      return { success: true, message: 'If an account exists for that email, a 6-digit code is on its way.' };
    },
    [redirectTo]
  );

  const verifyEmailOtp = useCallback(async (email: string, token: string): Promise<AuthResult> => {
    if (!isSupabaseConfigured) return NOT_CONFIGURED;
    const { error } = await supabase.auth.verifyOtp({ email, token, type: 'signup' });
    if (error) {
      const mapped = mapAuthError(error);
      return { success: false, message: mapped.message, code: mapped.code };
    }
    return { success: true, message: 'Email confirmed — you are signed in.' };
  }, []);

  const verifyRecoveryOtp = useCallback(async (email: string, token: string): Promise<AuthResult> => {
    if (!isSupabaseConfigured) return NOT_CONFIGURED;
    const { error } = await supabase.auth.verifyOtp({ email, token, type: 'recovery' });
    if (error) {
      const mapped = mapAuthError(error);
      return { success: false, message: mapped.message, code: mapped.code };
    }
    // A valid recovery OTP establishes a session; the caller now sets the new password.
    setPasswordRecovery(true);
    return { success: true, message: 'Code verified — choose a new password.' };
  }, []);

  const updatePassword = useCallback(async (newPassword: string): Promise<AuthResult> => {
    if (!isSupabaseConfigured) return NOT_CONFIGURED;
    const { error } = await supabase.auth.updateUser({ password: newPassword });
    if (error) {
      const mapped = mapAuthError(error);
      return { success: false, message: mapped.message, code: mapped.code };
    }
    setPasswordRecovery(false);
    return { success: true, message: 'Your password has been updated.' };
  }, []);

  const changePassword = useCallback(
    async (currentPassword: string, newPassword: string): Promise<AuthResult> => {
      if (!isSupabaseConfigured) return NOT_CONFIGURED;
      const email = session?.user?.email;
      if (!email) return { success: false, message: 'You are not signed in.' };

      // updateUser({password}) does NOT verify the current password — any live
      // session can change it. Re-authenticate explicitly first so a borrowed
      // unlocked phone can't silently change the password.
      const { error: reauthError } = await supabase.auth.signInWithPassword({ email, password: currentPassword });
      if (reauthError) {
        return { success: false, message: 'Your current password is incorrect.', code: 'invalid_credentials' };
      }
      const { error } = await supabase.auth.updateUser({ password: newPassword });
      if (error) {
        const mapped = mapAuthError(error);
        return { success: false, message: mapped.message, code: mapped.code };
      }
      return { success: true, message: 'Your password has been changed.' };
    },
    [session]
  );

  const addPassword = useCallback(async (newPassword: string): Promise<AuthResult> => {
    if (!isSupabaseConfigured) return NOT_CONFIGURED;
    // For an Apple-only account (no password yet) — the live session is the authorization.
    const { error } = await supabase.auth.updateUser({ password: newPassword });
    if (error) {
      const mapped = mapAuthError(error);
      return { success: false, message: mapped.message, code: mapped.code };
    }
    return { success: true, message: 'Password added. You can now sign in with your email and password anywhere.' };
  }, []);

  const changeEmail = useCallback(
    async (newEmail: string): Promise<AuthResult> => {
      if (!isSupabaseConfigured) return NOT_CONFIGURED;
      const { error } = await supabase.auth.updateUser(
        { email: newEmail },
        { emailRedirectTo: redirectTo('account/index') }
      );
      if (error) {
        const mapped = mapAuthError(error);
        return { success: false, message: mapped.message, code: mapped.code };
      }
      return {
        success: true,
        message: 'Confirm the change from the links we sent to both your old and new email. The change completes once both are confirmed.',
      };
    },
    [redirectTo]
  );

  const resendConfirmation = useCallback(
    async (email: string): Promise<AuthResult> => {
      if (!isSupabaseConfigured) return NOT_CONFIGURED;
      const { error } = await supabase.auth.resend({
        type: 'signup',
        email,
        options: { emailRedirectTo: redirectTo('account/index') },
      });
      if (error) {
        const mapped = mapAuthError(error);
        return { success: false, message: mapped.message, code: mapped.code };
      }
      return { success: true, message: 'A new code is on its way. Check your inbox.' };
    },
    [redirectTo]
  );

  // Permanently deletes the account and all server-side data (Guideline
  // 5.1.1(v)). Order: revoke Apple token → delete cloud backup → delete the auth
  // user via the SECURITY DEFINER `delete_user` RPC.
  const deleteAccount = useCallback(async (): Promise<AuthResult> => {
    if (!isSupabaseConfigured) return NOT_CONFIGURED;
    const { data: userData } = await supabase.auth.getUser();
    const uid = userData.user?.id;
    if (!uid) return { success: false, message: 'You are not signed in.' };

    if (userData.user?.app_metadata?.provider === 'apple') {
      try {
        await supabase.functions.invoke('apple-revoke');
      } catch (e) {
        console.warn('Apple token revocation could not be completed:', e);
      }
    }

    const backupResult = await deleteCloudBackup(uid);
    if (!backupResult.success) {
      return { success: false, message: `Couldn't delete your cloud data: ${backupResult.message}` };
    }

    const { error } = await supabase.rpc('delete_user');
    if (error) {
      const mapped = mapAuthError(error);
      return { success: false, message: mapped.message, code: mapped.code };
    }

    explicitSignOutRef.current = true;
    await supabase.auth.signOut({ scope: 'local' });
    return { success: true, message: 'Your account and cloud data were permanently deleted.' };
  }, []);

  const value: AuthContextValue = {
    isConfigured: isSupabaseConfigured,
    loading,
    session,
    user: session?.user ?? null,
    passwordRecovery,
    clearPasswordRecovery: useCallback(() => setPasswordRecovery(false), []),
    sessionEndedMessage,
    clearSessionEndedMessage: useCallback(() => setSessionEndedMessage(null), []),
    mfaChallenge,
    signIn,
    signUp,
    signInWithApple,
    signOut,
    signOutAllDevices,
    deleteAccount,
    resetPassword,
    verifyEmailOtp,
    verifyRecoveryOtp,
    updatePassword,
    changePassword,
    addPassword,
    changeEmail,
    resendConfirmation,
    verifyMfaChallenge,
    cancelMfaChallenge,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
