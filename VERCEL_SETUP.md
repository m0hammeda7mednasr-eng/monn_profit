# Vercel Deployment Setup

## Normal production setup

Use Railway as the API origin so Vercel only serves the frontend assets:

```env
REACT_APP_API_BASE_URL=https://monnprofit-production.up.railway.app/api
```

Redeploy Vercel after changing this variable because Create React App reads `REACT_APP_*` values at build time.

## Optional proxy fallback

Do not enable this for normal production traffic. It routes all API responses through a Vercel Function and can create high Network Egress bills.

```env
REACT_APP_USE_VERCEL_API_PROXY=true
BACKEND_API_BASE_URL=https://monnprofit-production.up.railway.app/api
```

## Optional Bosta fallback

The app now uses the Railway backend for Bosta lookups by default. Only enable the Vercel Bosta fallback when Railway Bosta is unavailable and you accept the extra Vercel Function/Egress cost.

```env
REACT_APP_ENABLE_VERCEL_BOSTA_FALLBACK=true
BOSTA_API_KEY=<your-bosta-api-key>
```

## Testing

1. Open the app after redeploy.
2. In browser DevTools, check that normal API requests go to `https://monnprofit-production.up.railway.app/api`.
3. Confirm requests are not going through `/api/proxy` unless you intentionally enabled `REACT_APP_USE_VERCEL_API_PROXY=true`.

For the Railway backend, keep `ALLOW_VERCEL_APP_ORIGINS=true` unless you have a fixed custom domain list in `FRONTEND_URLS`.

## Secret hygiene

Never commit real API keys or service role keys in Markdown. Put them only in Railway/Vercel environment variables and rotate any key that was previously committed or shared.
