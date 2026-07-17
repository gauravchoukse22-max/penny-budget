// Shared Apple helpers for the token-revocation flow (Guideline 5.1.1(v)).
//
// Apple's REST endpoints require a short-lived "client secret" — an ES256 JWT
// signed with your Sign in with Apple private key (.p8). These helpers build
// that secret with Web Crypto (no external deps), then exchange an
// authorization code for tokens and revoke a token.
//
// Required environment variables (set with `supabase secrets set`):
//   APPLE_TEAM_ID      — your 10-char Apple Developer Team ID
//   APPLE_KEY_ID       — the Key ID of the Sign in with Apple key
//   APPLE_CLIENT_ID    — the app's bundle id, e.g. com.gary.pennybudget
//   APPLE_PRIVATE_KEY  — contents of the .p8 file (PEM, newlines ok)

const APPLE_AUD = 'https://appleid.apple.com';

function b64url(input: Uint8Array | string): string {
  const bytes = typeof input === 'string' ? new TextEncoder().encode(input) : input;
  let str = '';
  for (const b of bytes) str += String.fromCharCode(b);
  return btoa(str).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function pemToPkcs8(pem: string): ArrayBuffer {
  const body = pem
    .replace(/-----BEGIN PRIVATE KEY-----/, '')
    .replace(/-----END PRIVATE KEY-----/, '')
    .replace(/\s+/g, '');
  const raw = atob(body);
  const buf = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) buf[i] = raw.charCodeAt(i);
  return buf.buffer;
}

/** Builds the ES256 client secret JWT Apple requires (valid ~5 minutes). */
export async function makeClientSecret(nowSeconds: number): Promise<string> {
  const teamId = Deno.env.get('APPLE_TEAM_ID')!;
  const keyId = Deno.env.get('APPLE_KEY_ID')!;
  const clientId = Deno.env.get('APPLE_CLIENT_ID')!;
  const privateKeyPem = Deno.env.get('APPLE_PRIVATE_KEY')!.replace(/\\n/g, '\n');

  const header = { alg: 'ES256', kid: keyId };
  const payload = {
    iss: teamId,
    iat: nowSeconds,
    exp: nowSeconds + 300,
    aud: APPLE_AUD,
    sub: clientId,
  };

  const signingInput = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(payload))}`;

  const key = await crypto.subtle.importKey(
    'pkcs8',
    pemToPkcs8(privateKeyPem),
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['sign']
  );
  const signature = await crypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' },
    key,
    new TextEncoder().encode(signingInput)
  );

  return `${signingInput}.${b64url(new Uint8Array(signature))}`;
}

type AppleTokenResponse = { refresh_token?: string; access_token?: string; error?: string };

/** Exchanges the single-use authorization code (from sign-in) for a long-lived refresh token. */
export async function exchangeAuthorizationCode(
  code: string,
  clientSecret: string
): Promise<AppleTokenResponse> {
  const clientId = Deno.env.get('APPLE_CLIENT_ID')!;
  const res = await fetch('https://appleid.apple.com/auth/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      code,
      grant_type: 'authorization_code',
    }),
  });
  return res.json();
}

/** Revokes a previously issued Apple refresh token — the deletion step Apple requires. */
export async function revokeToken(token: string, clientSecret: string): Promise<boolean> {
  const clientId = Deno.env.get('APPLE_CLIENT_ID')!;
  const res = await fetch('https://appleid.apple.com/auth/revoke', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      token,
      token_type_hint: 'refresh_token',
    }),
  });
  return res.ok;
}
