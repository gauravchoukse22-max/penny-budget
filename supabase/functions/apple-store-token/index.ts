// Called right after a successful Sign in with Apple. Exchanges the single-use
// authorization code for an Apple *refresh* token and stores it, keyed to the
// signed-in user. That stored token is what makes real revocation possible at
// account-deletion time (the sign-in code itself is long expired by then).
//
// Deploy:  supabase functions deploy apple-store-token
// (JWT-verified: only a signed-in user can call it — the default.)

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { makeClientSecret, exchangeAuthorizationCode } from '../_shared/apple.ts';

Deno.serve(async (req) => {
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) return new Response('Unauthorized', { status: 401 });

    const { authorizationCode } = await req.json();
    if (!authorizationCode) return new Response('Missing authorizationCode', { status: 400 });

    // Identify the caller from their JWT.
    const userClient = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: authHeader } } }
    );
    const { data: userData, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userData.user) return new Response('Unauthorized', { status: 401 });

    const nowSeconds = Math.floor(Date.now() / 1000);
    const clientSecret = await makeClientSecret(nowSeconds);
    const tokenRes = await exchangeAuthorizationCode(authorizationCode, clientSecret);

    if (!tokenRes.refresh_token) {
      // Apple didn't return a refresh token (e.g. code already used). Not fatal
      // to the user's sign-in; deletion will fall back to a fresh re-auth.
      return new Response(JSON.stringify({ stored: false }), {
        headers: { 'Content-Type': 'application/json' },
        status: 200,
      });
    }

    // Store with the service role (bypasses RLS); the table is not client-readable.
    const admin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );
    await admin
      .from('apple_tokens')
      .upsert({ user_id: userData.user.id, refresh_token: tokenRes.refresh_token }, { onConflict: 'user_id' });

    return new Response(JSON.stringify({ stored: true }), {
      headers: { 'Content-Type': 'application/json' },
      status: 200,
    });
  } catch (e) {
    console.error('apple-store-token error:', e);
    return new Response('Internal error', { status: 500 });
  }
});
