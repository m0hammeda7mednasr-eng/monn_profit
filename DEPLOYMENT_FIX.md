# Deployment And Cost Fix

## What changed

The production frontend should call the Railway backend directly:

```env
REACT_APP_API_BASE_URL=https://monnprofit-production.up.railway.app/api
```

This avoids sending every API response through Vercel's `/api/proxy` function, which is what can drive very high Vercel Network Egress.

## Railway variables

Set these in Railway. Use real values from the service dashboards, do not paste secrets into this repo.

```env
PORT=5000
NODE_ENV=production
JWT_SECRET=<generate-a-long-random-secret>
FRONTEND_URL=https://monn-profit.vercel.app
FRONTEND_URLS=https://monn-profit.vercel.app
ALLOW_VERCEL_APP_ORIGINS=true
BACKEND_URL=https://monnprofit-production.up.railway.app
SUPABASE_URL=<your-supabase-url>
SUPABASE_SERVICE_ROLE_KEY=<your-supabase-service-role-key>
SUPABASE_KEY=<your-supabase-anon-key>
SHOPIFY_API_KEY=<your-shopify-api-key>
SHOPIFY_API_SECRET=<your-shopify-api-secret>
SHOPIFY_API_VERSION=2024-01
BOSTA_API_KEY=<your-bosta-api-key>
BOSTA_API_BASE_URL=https://app.bosta.co/api/v2
```

## Vercel variables

For normal production traffic:

```env
REACT_APP_API_BASE_URL=https://monnprofit-production.up.railway.app/api
```

Only enable these if you intentionally want Vercel to proxy backend traffic again:

```env
REACT_APP_USE_VERCEL_API_PROXY=true
BACKEND_API_BASE_URL=https://monnprofit-production.up.railway.app/api
```

Only enable this if Railway Bosta lookup is unavailable and you accept the extra Vercel Function/Egress cost:

```env
REACT_APP_ENABLE_VERCEL_BOSTA_FALLBACK=true
BOSTA_API_KEY=<your-bosta-api-key>
```

## Important security note

Secrets were removed from this file. If this file was ever pushed, shared, or screenshotted with real values, rotate:

- `JWT_SECRET`
- `SUPABASE_SERVICE_ROLE_KEY`
- `SUPABASE_KEY`
- `BOSTA_API_KEY`
- Shopify API credentials

## Verify after redeploy

1. Redeploy Railway after updating variables.
2. Redeploy Vercel so the React build receives `REACT_APP_API_BASE_URL`.
3. Open the app, sign in, and confirm browser Network requests go to `monnprofit-production.up.railway.app/api`, not `/api/proxy`.
4. Watch Vercel Usage. Network Egress should drop because the large API payloads no longer pass through Vercel.
