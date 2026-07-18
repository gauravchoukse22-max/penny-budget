// Shared Plaid helpers for the Edge Functions. The client_id/secret live ONLY
// here (Supabase secrets); nothing Plaid-authenticated ever runs on the device.

import { createClient, type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';

const PLAID_HOSTS: Record<string, string> = {
  sandbox: 'https://sandbox.plaid.com',
  production: 'https://production.plaid.com',
};

export function plaidHost(): string {
  const env = Deno.env.get('PLAID_ENV') ?? 'sandbox';
  return PLAID_HOSTS[env] ?? PLAID_HOSTS.sandbox;
}

/** POST to a Plaid endpoint with credentials injected. Throws on Plaid errors. */
export async function plaidPost<T>(path: string, body: Record<string, unknown>): Promise<T> {
  const res = await fetch(`${plaidHost()}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id: Deno.env.get('PLAID_CLIENT_ID'),
      secret: Deno.env.get('PLAID_SECRET'),
      ...body,
    }),
  });
  const json = await res.json();
  if (!res.ok) {
    // Surface Plaid's error_code, not the whole body (which can echo request
    // fields). Never include tokens in errors.
    const code = json?.error_code ?? res.status;
    throw new Error(`plaid:${code}`);
  }
  return json as T;
}

export type AuthedUser = { id: string };

/** Resolves the calling user from the request's JWT, or null. */
export async function getCallingUser(req: Request): Promise<AuthedUser | null> {
  const authHeader = req.headers.get('Authorization');
  if (!authHeader) return null;
  const userClient = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_ANON_KEY')!,
    { global: { headers: { Authorization: authHeader } } }
  );
  const { data, error } = await userClient.auth.getUser();
  if (error || !data.user) return null;
  return { id: data.user.id };
}

export function adminClient(): SupabaseClient {
  return createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
}

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
