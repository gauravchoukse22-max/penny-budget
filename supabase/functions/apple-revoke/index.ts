// Called during account deletion for Apple accounts. Looks up the stored Apple
// refresh token and revokes it, so the app's access to the user's Apple ID is
// actually withdrawn (Guideline 5.1.1(v)). The client calls this BEFORE
// delete_user; deletion still proceeds even if this is a no-op.
//
// Deploy:  supabase functions deploy apple-revoke

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { makeClientSecret, revokeToken } from '../_shared/apple.ts';

Deno.serve(async (req) => {
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) return new Response('Unauthorized', { status: 401 });

    const userClient = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: authHeader } } }
    );
    const { data: userData, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userData.user) return new Response('Unauthorized', { status: 401 });

    const admin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    const { data: row } = await admin
      .from('apple_tokens')
      .select('refresh_token')
      .eq('user_id', userData.user.id)
      .maybeSingle();

    let revoked = false;
    if (row?.refresh_token) {
      const nowSeconds = Math.floor(Date.now() / 1000);
      const clientSecret = await makeClientSecret(nowSeconds);
      revoked = await revokeToken(row.refresh_token, clientSecret);
      // Clean up regardless — the user is being deleted.
      await admin.from('apple_tokens').delete().eq('user_id', userData.user.id);
    }

    return new Response(JSON.stringify({ revoked }), {
      headers: { 'Content-Type': 'application/json' },
      status: 200,
    });
  } catch (e) {
    console.error('apple-revoke error:', e);
    return new Response('Internal error', { status: 500 });
  }
});
