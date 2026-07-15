import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import type { Session, User } from '@supabase/supabase-js';
import { supabase, isSupabaseConfigured } from '../lib/supabase';

type AuthResult = { success: boolean; message: string; needsEmailConfirmation?: boolean };

type AuthContextValue = {
  isConfigured: boolean;
  loading: boolean;
  session: Session | null;
  user: User | null;
  signIn: (email: string, password: string) => Promise<AuthResult>;
  signUp: (email: string, password: string) => Promise<AuthResult>;
  signOut: () => Promise<void>;
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

  const value: AuthContextValue = {
    isConfigured: isSupabaseConfigured,
    loading,
    session,
    user: session?.user ?? null,
    signIn,
    signUp,
    signOut,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
