import * as WebBrowser from 'expo-web-browser';

// Public legal docs, served from gary-labs.com.
//
// These MUST be the same URLs entered in App Store Connect and Play Console.
// They previously pointed at docs/*.html on GitHub Pages, which meant the policy
// a user opened from inside the app was a different document from the one the
// store listing linked to — two policies for one app, free to drift apart.
// The GitHub Pages copies are superseded; take them down or redirect them here.
export const PRIVACY_URL = 'https://gary-labs.com/penny-budget/privacy/';
export const TERMS_URL = 'https://gary-labs.com/penny-budget/terms/';
export const SECURITY_URL = 'https://gary-labs.com/penny-budget/privacy/';

/** Where a user (or an app reviewer) can reach a human about the app. */
export const SUPPORT_EMAIL = 'support@gary-labs.com';

export function openPrivacy(): Promise<WebBrowser.WebBrowserResult> {
  return WebBrowser.openBrowserAsync(PRIVACY_URL);
}

export function openTerms(): Promise<WebBrowser.WebBrowserResult> {
  return WebBrowser.openBrowserAsync(TERMS_URL);
}

export function openSecurity(): Promise<WebBrowser.WebBrowserResult> {
  return WebBrowser.openBrowserAsync(SECURITY_URL);
}
