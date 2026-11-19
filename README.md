# Noma Design Tasks dashboard

A static page (`noma/index.html`) that shows the Noma project's open tasks for the next 5 working days. It reads `noma/data.json`. A GitHub Action refreshes `noma/data.json` from Asana every 30 minutes on weekdays, so the page stays up to date without anyone exposing an Asana login.

## Set it up (about 10 minutes)

1. **Create a repo** on GitHub (e.g. `noma-dashboard`) and upload every file in this folder, including the hidden `.github` folder.
2. **Create an Asana token.** In Asana go to *My settings → Apps → Developer apps → Personal access tokens → Create new token*. Copy it.
3. **Add the token to the repo.** On GitHub, open *Settings → Secrets and variables → Actions → New repository secret*. Name it `ASANA_TOKEN` and paste the token.
4. **Turn on GitHub Pages.** Open *Settings → Pages*, set *Source* to *Deploy from a branch*, choose `main` and `/ (root)`, then save.
5. **Run the first update.** Open the *Actions* tab, choose *Update dashboard data*, then *Run workflow*.

After a minute or two the dashboard will be at `https://camilachisini.github.io/clientdashboard/noma/`.

## Notes

- The page is public to anyone who has the link. Only these fields are published: task name, designer, client task owner, due date, status and size.
- Sizes come from the **Task size** field in Asana. A task with no size is counted as Small and marked with `*`.
- The page reloads `data.json` every 5 minutes, so a screen left open stays current.
- To change how often it updates, edit the `cron` line in `.github/workflows/update-data.yml`.

## Sharing with the client

Open the page and click **Download image** (bottom right). You get a 1920 × 1080 PNG, at double resolution, of the current schedule, ready to send.

## Live data (Cloudflare Worker)

`worker/worker.js` returns the tasks live from Asana, so the page is up to date every time someone opens it and the **Update now** button works for everyone without a token.

1. Create a free account at https://dash.cloudflare.com.
2. Go to **Workers & Pages → Create → Create Worker**, name it `noma-dashboard`, then **Deploy**.
3. Click **Edit code**, replace everything with the contents of `worker/worker.js`, then **Deploy**.
4. Open the worker's **Settings → Variables and Secrets → Add**. Type: *Secret*, name: `ASANA_TOKEN`, value: your Asana token. Save.
5. Copy the worker's address (like `https://noma-dashboard.yourname.workers.dev`) and set it as `LIVE_URL` at the top of `noma/app.js`.

If the worker is down, the page falls back to `data.json`, which the GitHub Action still refreshes every 30 minutes.
