# Vercel Deployment Setup

## Environment Variables

You need to add the following environment variable in Vercel dashboard:

### BOSTA_API_KEY

1. Go to your Vercel project dashboard
2. Click on "Settings" tab
3. Click on "Environment Variables" in the sidebar
4. Add new variable:
   - **Name:** `BOSTA_API_KEY`
   - **Value:** `f59a406a32d3741b2ad14bb32305897363e6025380b79c5a127b798de72a024a`
   - **Environment:** Production, Preview, Development (select all)
5. Click "Save"

### BACKEND_API_BASE_URL

This should point to your deployed backend API base (must end with `/api`).

Example:

- **Name:** `BACKEND_API_BASE_URL`
- **Value:** `https://your-backend-domain.com/api`
- **Environment:** Production, Preview, Development (select all)

## Redeploy

After adding the environment variable:

1. Go to "Deployments" tab
2. Click on the latest deployment
3. Click "Redeploy" button

## Testing

Once deployed, test the Bosta Scanner with these tracking numbers:

- `DEMO123456789` - Demo shipment
- `2695867962` - Test shipment from Bosta
- `2685887962` - Alternative test number

## How It Works

The Vercel serverless function (`/api/bosta-shipment`) acts as a proxy:

1. Frontend calls `/api/bosta-shipment?trackingNumber=XXX`
2. Vercel function calls Bosta API with the API key (secure)
3. Returns shipment data to frontend

This works even if Railway backend is down!

All other frontend API requests (`/api/users/*`, `/api/notifications/*`, etc.)
are now proxied by `api/proxy.js` through Vercel rewrites to
`BACKEND_API_BASE_URL`.

## Troubleshooting

If you get "API key not configured" error:

1. Make sure you added `BOSTA_API_KEY` in Vercel environment variables
2. Make sure you selected all environments (Production, Preview, Development)
3. Redeploy the project after adding the variable

If you get 404 errors:

- The tracking number doesn't exist in Bosta system
- Try the demo numbers listed above
