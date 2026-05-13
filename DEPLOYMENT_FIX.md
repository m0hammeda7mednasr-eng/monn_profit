# Deployment And Cost Fix

## What changed

The production frontend should call the Railway backend directly:

```env
REACT_APP_API_BASE_URL=https://monnprofit-production.up.railway.app/api
```

This avoids sending every API response through Vercel's `/api/proxy` function, which is what can drive very high Vercel Network Egress.

The Railway backend also compresses normal API responses. This reduces Railway
Network Egress for large JSON payloads without changing the API shape. The
realtime event stream is excluded from compression so browser EventSource
connections keep working normally.

Large API list responses are capped by default:

- Normal list API default: `100` rows
- Normal list API max: `100` rows
- Orders API page max: `300` rows
- Orders API visible cap: `600` rows

Shopify background sync was also slowed down from an aggressive near-continuous
cycle. It is disabled by default in every environment unless explicitly enabled.
Manual app features still load from the already-synced database, but Shopify
data will not keep syncing in the background until this is turned back on.

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
API_DEFAULT_LIST_LIMIT=100
API_MAX_LIST_LIMIT=100
ORDER_API_PAGE_LIMIT=300
ORDER_API_MAX_VISIBLE=600
SHOPIFY_BACKGROUND_SYNC_ENABLED=false
SHOPIFY_BACKGROUND_SYNC_BATCH_SIZE=50
SHOPIFY_BACKGROUND_SYNC_MAX_BATCHES_PER_CYCLE=1
SHOPIFY_BACKGROUND_SYNC_INTERVAL_MS=600000
SHOPIFY_BACKGROUND_SYNC_FOLLOW_UP_DELAY_MS=60000
```

## Vercel variables

For normal production traffic:

```env
REACT_APP_API_BASE_URL=https://monnprofit-production.up.railway.app/api
```

The generic Vercel API proxy is disabled. Do not use `/api` as a production
API base; production builds ignore relative API bases and fall back to Railway.

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
3. Open the app, sign in, and confirm browser Network requests go to `monnprofit-production.up.railway.app/api`, not `/api`.
4. In one API request, confirm the response has `Content-Encoding: gzip` or
   `Content-Encoding: br` when the browser sends `Accept-Encoding`.
5. Watch both Vercel and Railway Usage:
   - Vercel Network Egress should drop because large API payloads no longer pass through Vercel.
   - Railway Network Egress should also improve from compression, but it will not go to zero because Railway is still the API origin.
   - The total GB number is cumulative for the billing period; judge the fix by the usage slope and the Estimated cost after redeploy.
