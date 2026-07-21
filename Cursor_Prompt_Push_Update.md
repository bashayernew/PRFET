# Cursor prompt — push the latest code to the herotchat.com server

Paste everything below into Cursor (Agent mode). Fill in the server address first if Cursor doesn't already know it.

---

You are working in my Herot project. Push the current local code to my production VPS
(the docker-compose stack from `deploy/` — domain **herotchat.com**) and rebuild it.
My server: `root@<SERVER_IP>` (ask me if you don't have the IP or the SSH key isn't set up).
Do this step by step; if a command fails, read the error, fix it, and continue.

## 1. Verify the build locally BEFORE touching the server
```
npx prisma generate
npx tsc --noEmit
```
Both must pass with no errors. If tsc fails, stop and show me the errors.

## 2. Sync the code to the server
Copy the project to the server folder where it was originally deployed (likely `/root/herot` —
check with `ssh root@<SERVER_IP> "ls ~"` if unsure).

**NEVER copy or overwrite these** (server-only data and secrets):
- `node_modules/`, `.next/`, `android/`, `.idea/`
- `.env` and `deploy/.env` (the server's real secrets stay as they are)
- `public/uploads/` (users' photos/videos live there — overwriting deletes them)
- `*.docx`, `Cursor_Prompt_*.md` (not needed on the server)

From the project root in PowerShell, this works on Windows:
```
tar --exclude=node_modules --exclude=.next --exclude=android --exclude=.idea --exclude=.env --exclude=deploy/.env --exclude=public/uploads -czf herot-update.tgz .
scp herot-update.tgz root@<SERVER_IP>:/root/
ssh root@<SERVER_IP> "cd /root/herot && tar xzf /root/herot-update.tgz && rm /root/herot-update.tgz"
del herot-update.tgz
```
(`tar` extracts over the existing folder — server `.env`, `deploy/.env`, and `public/uploads`
are untouched because they're not in the archive.)

## 3. Rebuild and restart the stack on the server
```
ssh root@<SERVER_IP> "cd /root/herot/deploy && docker compose up -d --build app"
```
The app container auto-runs `prisma db push` on boot, so the schema (incl. `isAdmin`) updates itself.
Watch the logs until it's healthy:
```
ssh root@<SERVER_IP> "cd /root/herot/deploy && docker compose logs -f --tail=50 app"
```
Stop following once you see the server listening / ready line.

## 4. Make my account the owner (red name colour)
Run on the server (replace the email with mine — ask me which account is the owner):
```
ssh root@<SERVER_IP> "cd /root/herot/deploy && docker compose exec db psql -U herot -d herot -c \"UPDATE \\\"User\\\" SET \\\"isAdmin\\\"=true WHERE email='<OWNER_EMAIL>';\""
```

## 5. Verify
- Open https://herotchat.com — site loads, login works (OTP 1234).
- Profile → premium section: the rainbow/custom colour circle is GONE, only preset circles remain.
- On the owner account: a RED circle appears at the end of the palette; picking it works.
- On a normal premium account: no red circle, and the API refuses red.

When done, print: what was synced, that the container rebuilt cleanly, and the verification results.
