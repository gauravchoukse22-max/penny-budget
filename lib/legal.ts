import * as WebBrowser from 'expo-web-browser';

// Public legal docs, served from the same GitHub Pages site as the web app.
// (docs/privacy.html and docs/terms.html in this repo.)
export const PRIVACY_URL = 'https://gauravchoukse22-max.github.io/penny-budget/privacy.html';
export const TERMS_URL = 'https://gauravchoukse22-max.github.io/penny-budget/terms.html';
export const SECURITY_URL = 'https://gauravchoukse22-max.github.io/penny-budget/security.html';

/** Where a user (or an app reviewer) can reach a human about the app. */
export const SUPPORT_EMAIL = 'gauravchoukse22@gmail.com';

export function openPrivacy(): Promise<WebBrowser.WebBrowserResult> {
  return WebBrowser.openBrowserAsync(PRIVACY_URL);
}

export function openTerms(): Promise<WebBrowser.WebBrowserResult> {
  return WebBrowser.openBrowserAsync(TERMS_URL);
}

export function openSecurity(): Promise<WebBrowser.WebBrowserResult> {
  return WebBrowser.openBrowserAsync(SECURITY_URL);
}
