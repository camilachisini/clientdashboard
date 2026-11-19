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

## Editing the schedule

Click **Edit schedule** on the dashboard and paste an Asana personal access token. The token is saved only in that browser, never in this repo. While connected:

- Tasks load live from Asana.
- Drag a card to another day, or to another position in the same day. This updates the task's due date and its **Order** field in Asana.
- Click the red **+** on an over-capacity day to move those tasks to another day, or pick any other weekday with the date field.

People who view the page without connecting can only look.
