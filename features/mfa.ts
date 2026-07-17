// Thin wrapper over Supabase's TOTP MFA. Opt-in second factor for the optional
// cloud account. Works in Expo Go (no native module needed).
import { supabase, isSupabaseConfigured } from '../lib/supabase';
import { mapAuthError } from '../lib/authErrors';

export type TotpEnrollment = { factorId: string; secret: string; uri: string; qrCode: string };

/** True when the account already has a verified TOTP factor. */
export async function hasVerifiedTotp(): Promise<boolean> {
  if (!isSupabaseConfigured) return false;
  const { data } = await supabase.auth.mfa.listFactors();
  return !!data?.totp?.some((f) => f.status === 'verified');
}

export async function listTotpFactorIds(): Promise<string[]> {
  if (!isSupabaseConfigured) return [];
  const { data } = await supabase.auth.mfa.listFactors();
  return (data?.totp ?? []).map((f) => f.id);
}

/** Begins enrollment — returns the secret + otpauth URI to show the user. Not
 * active until confirmEnrollment succeeds with a valid code. */
export async function beginTotpEnrollment(): Promise<{ success: boolean; message: string; enrollment?: TotpEnrollment }> {
  if (!isSupabaseConfigured) return { success: false, message: "Cloud accounts aren't configured." };
  const { data, error } = await supabase.auth.mfa.enroll({ factorType: 'totp' });
  if (error || !data) return { success: false, message: mapAuthError(error).message };
  return {
    success: true,
    message: 'Scan the code in your authenticator app.',
    enrollment: { factorId: data.id, secret: data.totp.secret, uri: data.totp.uri, qrCode: data.totp.qr_code },
  };
}

/** Confirms enrollment by verifying the first code from the authenticator app. */
export async function confirmTotpEnrollment(factorId: string, code: string): Promise<{ success: boolean; message: string }> {
  if (!isSupabaseConfigured) return { success: false, message: "Cloud accounts aren't configured." };
  const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId, code });
  if (error) return { success: false, message: mapAuthError(error).message };
  return { success: true, message: 'Two-factor authentication is on.' };
}

export async function disableTotp(factorId: string): Promise<{ success: boolean; message: string }> {
  if (!isSupabaseConfigured) return { success: false, message: "Cloud accounts aren't configured." };
  const { error } = await supabase.auth.mfa.unenroll({ factorId });
  if (error) return { success: false, message: mapAuthError(error).message };
  return { success: true, message: 'Two-factor authentication is off.' };
}
