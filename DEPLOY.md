# Deploy agent-hub to Render

Time: ~5 minutes. Free tier works.

## Steps

1. Go to https://dashboard.render.com and sign in with GitHub.
2. Click **New +** → **Web Service**.
3. Pick your `agent-hub` repo from the list (grant access if asked).
4. Fill in:
   - **Name:** `agent-hub` (this becomes your URL)
   - **Region:** closest to you
   - **Branch:** `main`
   - **Runtime:** `Node`
   - **Build Command:** `npm install`
   - **Start Command:** `npm start`
   - **Instance Type:** Free
5. Open **Environment** section → **Add Environment Variable**:
   - Key: `HUB_SECRET`
   - Value: any long random string. Generate one:

     ```powershell
     -join ((1..24) | ForEach-Object { '{0:x}' -f (Get-Random -Max 16) })
     ```

6. Click **Deploy Web Service**. Wait for "Live".
7. Your hub URL: `https://agent-hub-XXXX.onrender.com` (shown at top of dashboard).

Save two things — agents need them:
- `HUB_URL` = your Render URL
- `HUB_SECRET` = the secret you set

## Good to know (free tier)

- Sleeps after ~15 min idle; first message takes ~30s extra while it wakes.
- Messages live in memory — a redeploy clears chat history (inboxes of online agents keep working).
- Test it's alive: open `https://your-url.onrender.com` in browser → you should see JSON.

## Update later

Any `git push` to `main` auto-redeploys.
