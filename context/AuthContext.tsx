import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import type { Session, User } from '@supabase/supabase-js';
import { supabase, isSupabaseConfigured } from '../lib/supabase';
import { deleteCloudBackup } from '../features/cloud-backup';

type AuthResult = { success: boolean; message: string; needsEmailConfirmation?: boolean };

type AuthContextValue = {
  isConfigured: boolean;
  loading: boolean;
  session: Session | null;
  user: User | null;
  signIn: (email: string, password: string) => Promise<AuthResult>;
  signUp: (email: string, password: string) => Promise<AuthResult>;
  signOut: () => Promise<void>;
  deleteAccount: () => Promise<AuthResult>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [loading, setLoading] = useState(isSupabaseConfigured);
  const [session, setSession] = useState<Session | null>(null);

  useEffect(() => {
    if (!isSupabaseConfigured) return;

    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setLoading(false);
    });

    const { data: subscription } = supabase.auth.onAuthStateChange((_event, newSession) => {
      setSession(newSession);
    });

    return () => subscription.subscription.unsubscribe();
  }, []);

  const signIn = useCallback(async (email: string, password: string): Promise<AuthResult> => {
    if (!isSupabaseConfigured) {
      return { success: false, message: "Cloud accounts aren't configured for this build." };
    }
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) return { success: false, message: error.message };
    return { success: true, message: 'Signed in.' };
  }, []);

  const signUp = useCallback(async (email: string, password: string): Promise<AuthResult> => {
    if (!isSupabaseConfigured) {
      return { success: false, message: "Cloud accounts aren't configured for this build." };
    }
    const { data, error } = await supabase.auth.signUp({ email, password });
    if (error) return { success: false, message: error.message };
    // If email confirmation is required, Supabase returns a user but no session.
    if (!data.session) {
      return { success: true, message: 'Check your email to confirm your account, then sign in.', needsEmailConfirmation: true };
    }
    return { success: true, message: 'Account created.' };
  }, []);

  const signOut = useCallback(async () => {
    if (!isSupabaseConfigured) return;
    await supabase.auth.signOut();
  }, []);

  // Permanently deletes the signed-in user's account and all server-side data
  // (Apple Guideline 5.1.1(v) requires in-app account deletion). Deleting the
  // auth user itself needs elevated privileges, so it goes through a
  // SECURITY DEFINER RPC (`public.delete_user`); see docs/supabase-setup.md.
  const deleteAccount = useCallback(async (): Promise<AuthResult> => {
    if (!isSupabaseConfigured) {
      return { success: false, message: "Cloud accounts aren't configured for this build." };
    }
    const { data: userData } = await supabase.auth.getUser();
    const uid = userData.user?.id;
    if (!uid) return { success: false, message: 'You are not signed in.' };

    // Remove their cloud backup first (RLS lets the user delete their own object).
    const backupResult = await deleteCloudBackup(uid);
    if (!backupResult.success) {
      return { success: false, message: `Couldn't delete your cloud data: ${backupResult.message}` };
    }

    // Delete the auth user via the privileged RPC.
    const { error } = await supabase.rpc('delete_user');
    if (error) return { success: false, message: error.message };

    // Clear the now-orphaned local session.
    await supabase.auth.signOut();
    return { success: true, message: 'Your account and cloud data were permanently deleted.' };
  }, []);

  const value: AuthContextValue = {
    isConfigured: isSupabaseConfigured,
    loading,
    session,
    user: session?.user ?? null,
    signIn,
    signUp,
    signOut,
    deleteAccount,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
