# Herot — backend setup

The backend lives **inside this Next.js app** (`app/api/*`), backed by **PostgreSQL**.
No third-party backend. Auth uses hashed passwords (bcrypt) + JWT (access + refresh).

## What's included

- `app/api/auth/register` — create account + generate email OTP
- `app/api/auth/verify-otp` — check the code, mark verified, issue tokens
- `app/api/auth/resend-otp` — send a fresh code
- `app/api/auth/login` — email + password → tokens
- `app/api/auth/me` — current user from the access token
- `prisma/schema.prisma` — User, OtpCode, RefreshToken tables
- `lib/auth.ts`, `lib/prisma.ts`, `lib/api.ts`

## Run it locally (Windows PowerShell)

1. **Install dependencies** (also generates the Prisma client):
   ```
   npm.cmd install
   ```
2. **Start PostgreSQL** (needs Docker Desktop installed and running):
   ```
   docker compose up -d
   ```
3. **Create the database tables**:
   ```
   npm.cmd run db:push
   ```
4. **Run the app**:
   ```
   npm.cmd run dev
   ```
   Open http://localhost:3000

## Test the real sign-up

Go through: welcome → account type → country → register (use any email + an 8-char
password) → on the verify screen the 6-digit code appears as a **"Test code"** hint
(also printed in your terminal). Enter it → you're verified and land on home.

To see the saved data: `npm.cmd run db:studio` opens Prisma Studio in the browser —
you'll see your new row in the `User` table.

## Notes

- The UI runs even without the database; only register/verify/login need it.
- No Docker? Tell me and I'll switch you to a zero-setup local database (SQLite) for dev.
- Secrets live in `.env` (git-ignored). Generate strong `JWT_*` secrets before production.
- The OTP is logged / shown for development. For production, send it via your own SMTP
  / email server (still no third party required).
