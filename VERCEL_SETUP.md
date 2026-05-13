# Vercel Deployment Setup

## Normal production setup

Use Railway as the API origin so Vercel only serves the frontend assets:

```env
REACT_APP_API_BASE_URL=https://monnprofit-production.up.railway.app/api
```

Redeploy Vercel after changing this variable because Create React App reads `REACT_APP_*` values at build time.

## Disabled proxy fallback

The generic Vercel API proxy is disabled to avoid high Network Egress bills.
Do not use `/api` as the production API base; production builds ignore relative
API bases and fall back to Railway.

Railway remains the API origin, so Railway egress still depends on API payload
size. The backend compresses normal JSON responses to reduce that cost; the
realtime stream is excluded so live updates keep working.

The backend also caps large list responses and slows Shopify background sync.
If Railway egress is still climbing too fast, set
`SHOPIFY_BACKGROUND_SYNC_ENABLED=false` in Railway temporarily and redeploy.

## Optional Bosta fallback

The app now uses the Railway backend for Bosta lookups by default. Only enable the Vercel Bosta fallback when Railway Bosta is unavailable and you accept the extra Vercel Function/Egress cost.

```env
REACT_APP_ENABLE_VERCEL_BOSTA_FALLBACK=true
BOSTA_API_KEY=<your-bosta-api-key>
```

## Testing

1. Open the app after redeploy.
2. In browser DevTools, check that normal API requests go to `https://monnprofit-production.up.railway.app/api`.
3. Confirm requests are not going through `/api`.
4. Check a normal API response includes `Content-Encoding: gzip` or `br`.
5. Watch the Estimated cost slope, not only total GB; total egress is cumulative for the billing period.

For the Railway backend, keep `ALLOW_VERCEL_APP_ORIGINS=true` unless you have a fixed custom domain list in `FRONTEND_URLS`.

## Secret hygiene

Never commit real API keys or service role keys in Markdown. Put them only in Railway/Vercel environment variables and rotate any key that was previously committed or shared.
