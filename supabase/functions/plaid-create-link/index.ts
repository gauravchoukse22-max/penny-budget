// Creates a Plaid Link token configured for HOSTED Link — a Plaid-served web
// page the app opens in the system browser. Hosted Link is what makes bank
// linking work in Expo Go: no native Plaid SDK, no prebuild.
//
// Deploy:  supabase functions deploy plaid-create-link
// Secrets: PLAID_CLIENT_ID, PLAID_SECRET, PLAID_ENV (sandbox|production)

import { plaidPost, getCallingUser, json } from '../_shared/plaid.ts';

type LinkTokenResponse = {
  link_token: string;
  hosted_link_url?: string;
};

Deno.serve(async (req) => {
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });

  const user = await getCallingUser(req);
  if (!user) return new Response('Unauthorized', { status: 401 });

  try {
    const data = await plaidPost<LinkTokenResponse>('/link/token/create', {
      user: { client_user_id: user.id },
      client_name: 'Penny Budget',
      language: 'en',
      country_codes: ['US'],
      products: ['transactions'],
      hosted_link: {
        // Sends the user back to the app when they finish in the browser.
        completion_redirect_uri: 'pennybudget://bank-linked',
        is_mobile_app: true,
        url_lifetime_seconds: 900,
      },
    });
    return json({ link_token: data.link_token, hosted_link_url: data.hosted_link_url });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : 'link_token_failed' }, 502);
  }
});
