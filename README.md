# MATE Delivery

B2C shipping platform (React + Express) with Nova Post and Stripe.

## Stack

- Frontend: Vite + React + TypeScript
- Backend: Node.js (Express)
- Database: PostgreSQL (Prisma)
- Payments: Stripe
- Shipping: Nova Post API

## Local development

1. Install dependencies:
   ```bash
   npm install
   ```
2. Configure env:
   - copy `server/.env.example` → `server/.env`
   - set `DATABASE_URL`, Stripe, Nova Post, SMTP keys
3. Start PostgreSQL and apply schema:
   ```bash
   # docker compose up -d
   npx prisma migrate deploy
   npm run db:import   # optional: import from server/data JSON backup
   ```
4. Run:
   ```bash
   npm run dev
   # or: run-mate-final-dev.bat
   ```
   - App: http://localhost:5011
   - API: http://localhost:5012

## Production (Railway)

1. Connect this GitHub repo to Railway
2. Add PostgreSQL plugin (`DATABASE_URL`)
3. Set env vars (`JWT_SECRET`, `APP_URL`, `CLIENT_ORIGIN`, Stripe, Nova Post, SMTP)
4. Deploy — Docker build runs `prisma migrate deploy` then starts the server

Admin seed (created on boot if missing): `admin` / see server logs.
