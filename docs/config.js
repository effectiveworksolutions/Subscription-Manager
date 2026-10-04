// SubTracker configuration. The publishable key is safe to ship in the app:
// Row Level Security in Supabase keeps each person's data private.
window.SUBTRACKER_CONFIG = {
  SUPABASE_URL: 'https://ehlkboyekvuhcortgyyr.supabase.co',
  SUPABASE_ANON_KEY: 'sb_publishable_oiBfdjJMacjFmGHOqfNkuw_bKYtV_Pg',
  APP_URL: 'https://effectiveworksolutions.github.io/Subscription-Manager/',
  APP_VERSION: '1.2.2',
  CURRENCY: '$',
  // "Find subscriptions from email" — leave blank to hide a provider.
  // Google Cloud → APIs & Services → Credentials → OAuth client (Web application):
  GOOGLE_CLIENT_ID: '735656622119-ij0f6lnil82u8rlr1k5p9dsfojvg1s0p.apps.googleusercontent.com',
  // Azure Portal → App registrations → Application (client) ID (SPA redirect = this app's URL):
  MS_CLIENT_ID: '',
};
