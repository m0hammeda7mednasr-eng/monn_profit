# Moon Profit

Shopify store management system with a React frontend and Express backend.

## Local Setup

Install dependencies:

```bash
npm run install-all
```

Run frontend and backend together:

```bash
npm run dev
```

Frontend runs on `http://localhost:3000`.
Backend runs on `http://localhost:5000`.

## Environment

Create `backend/.env` from `backend/.env.example` and add the new Moon Profit database, JWT, and Shopify values.

The frontend local API URL is configured in `frontend/.env`:

```env
REACT_APP_API_URL=http://localhost:5000/api
```

Do not commit `.env` files or service secrets.
