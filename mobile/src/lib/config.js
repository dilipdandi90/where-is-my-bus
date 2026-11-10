// Set in mobile/.env (see .env.example). Expo builds EXPO_PUBLIC_ values into the app.

/** The backend the app talks to. */
export const API_BASE = (process.env.EXPO_PUBLIC_API_BASE || 'https://where-is-my-bus-pos8.onrender.com').replace(/\/$/, '')

/** The website, where family share links open. Empty hides family sharing. */
export const SITE_URL = (process.env.EXPO_PUBLIC_SITE_URL || '').replace(/[#/]*$/, '')
