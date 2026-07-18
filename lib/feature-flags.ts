// Build-time feature flags.
//
// BANK_LINKING: Plaid runs on the free Trial plan, which is capped at 10
// connected Items ACROSS THE WHOLE PLAID ACCOUNT — enough for one family,
// fatal for a public release. It also moves linked-account data off the
// device, which the public privacy story doesn't cover yet. So the feature is
// compiled in but only ENABLED when the build sets the env var, keeping store
// builds clean by default:
//
//   EXPO_PUBLIC_BANK_LINKING=1 npx expo start
//
// (or put EXPO_PUBLIC_BANK_LINKING=1 in .env.local for dev/family builds).
export const BANK_LINKING_ENABLED = process.env.EXPO_PUBLIC_BANK_LINKING === '1';
