# The Winning Shot

The website, plus small background functions for live scores and Who Better? votes.

## What's in here

| Path | What it does |
|---|---|
| `public/index.html` | The website. |
| `netlify/functions/refresh-scores.mjs` | Runs every 10 minutes. Pulls NFL, NBA, MLB and Premier League games from ESPN's public scoreboard and saves them. |
| `netlify/functions/scores.mjs` | Hands the scores to the page at `/api/scores`, refreshing them first if they're more than 30 seconds old during live games (5 minutes otherwise). |
| `netlify/lib/sports.mjs` | The shared code: which leagues, how to read ESPN's scoreboard, how long to keep games (8 days). |
| `netlify.toml`, `package.json` | Settings Netlify reads when it builds the site. |

What updates on its own: the score ticker, the Biggest Wins panel (NFL, last 7 days) and the Results list.
The stories stay as written until you replace them in `public/index.html`.
If the scores ever can't load, the page keeps showing the scores written into it.

## Setup (about 30 minutes, no coding)

### 1. Get an API-Sports key
1. Create an account at https://dashboard.api-football.com (API-Sports' dashboard).
2. Copy your API key from the dashboard.
3. Make sure your account has access to all five sports used here: American Football, Basketball, Baseball and Football (soccer). The free plan allows about 100 calls a day per sport; this site uses 72.

### 2. Put the files on GitHub
1. Create a free account at https://github.com and click **New repository**. Name it `the-winning-shot`.
2. On the new repository's page, click **uploading an existing file**, then drag in everything from this folder (the `public` and `netlify` folders, `netlify.toml`, `package.json`, this README). Click **Commit changes**.

### 3. Connect it to Netlify
1. Create a free account at https://app.netlify.com and choose **Add new site → Import an existing project → GitHub**.
2. Pick `the-winning-shot`. Leave the build settings as they are and click **Deploy**.
3. Go to **Site configuration → Environment variables → Add a variable**. Name: `API_SPORTS_KEY`. Value: your key from step 1. Save.
4. Go to **Deploys → Trigger deploy → Deploy site** so the key takes effect.
5. Open your site. The first visit loads scores right away, then they refresh every hour.

### 4. Use your own domain
In Netlify: **Domain management → Add a domain**, enter the domain you bought, and follow the steps it shows at your domain registrar. HTTPS is set up for you.

## Forms (newsletter and Work with us)

Both forms are saved by **Netlify Forms**. Turn it on once: in Netlify, open the project → **Forms** → **Enable form detection**, then **Deploys → Trigger deploy**. Signups and messages then appear under **Forms** in Netlify (free plan: 100 submissions a month). Turn on email notifications there to get each one in your inbox.

Until form detection is on, the forms tell visitors "That didn't go through" instead of pretending to work.

## Posting picks

The **Picks** tab reads `public/picks.txt`. To post picks:

1. On GitHub, open `public/picks.txt` and click the pencil to edit.
2. On each game's line, type each person's pick after their name, using the team code from the matchup:
   `SEA at DEN | Thu 8:15 PM | HUNDO: SEA | JON: DEN | COLLIN: SEA | WINNER:`
3. When a game is final, type the winner after `WINNER:` (or `TIE`). Once live scores work, finished games grade themselves.
4. Click **Commit changes**. The site updates in about a minute.

New week: copy a whole `WEEK` block, paste it right under `STARTING RECORDS`, and change the label and games.
Set `STARTING RECORDS` once to each person's record from before the first week in the file.
A blank pick shows a green question mark and doesn't count against anyone.

## Who Better?

The **Who Better?** tab is an endless feed of head-to-head cards. Visitors pick who's better right now and all time, and see what percentage of everyone picked each player. Votes are stored by `netlify/functions/vote.mjs` in Netlify Blobs.

Edit `public/whobetter.txt` on GitHub:
- `MATCHUP:` lines are yours. They show first, in order. Add your takes: `MATCHUP: Patrick Mahomes vs Josh Allen | NFL QB | HUNDO: Patrick Mahomes | JON: Josh Allen | COLLIN: Patrick Mahomes`
- `PLAYER:` lines feed the endless part. Players are paired with others in the same league and position.
- Mark retired players `all-time` so they only get the all-time question.

Each browser can vote once per question per matchup. That stops casual double-voting, but someone who clears their browser can vote again. It's a fan poll, not an election.

## Changing things later

- **Update a story:** edit `public/index.html` on GitHub (open the file, click the pencil). Netlify redeploys on its own in about a minute.
- **Refresh more often:** in `netlify/functions/refresh-scores.mjs`, change `"@hourly"` to a cron schedule such as `"*/15 * * * *"` (every 15 minutes). Only do this on a paid API-Sports plan, or you'll run out of daily calls.
- **Check it's working:** visit `yoursite.com/api/scores`. You'll see the saved games and an `errors` list. In Netlify, **Logs → Functions → refresh-scores** shows each hourly run.

## If something looks wrong

- `errors` says the key isn't set: re-check step 3.3, then redeploy.
- `errors` mentions a plan, subscription or access: that sport isn't enabled on your API-Sports account.
- A league shows nothing: it may be out of season, or API-Sports may use a different season label for it. The season rules are at the top of `netlify/lib/sports.mjs`.

## Watch (YouTube)

The Watch page and the homepage's "Latest episode" read the channel's public feed through `/api/videos`
(`netlify/functions/videos.mjs`, channel ID `UCAl6bIUsXnVVBUrrWC841mg`). Nothing to update by hand:
upload to YouTube and the newest episode shows on the site within about 10 minutes.
YouTube's feed lists the 15 most recent uploads; Shorts appear in the grid but never as the featured episode.

## Beat the Room

Visitors pick every game on the Sheet against Hundo, Jon and Collin (the YOU column), with just a name, no account.
`netlify/functions/room.mjs` (`/api/room`) saves picks in Netlify Blobs (store `room`) and refuses any pick after kickoff,
using the live ESPN feed. THE ROOM column is the team most visitors picked; an even split leaves it blank.
Everything is graded by the same rules as the Sheet (`netlify/lib/sheet.mjs`). The season board starts with the first week anyone played.
Private leagues: anyone on the board can start one and share its link (`/?league=CODE#sheet`).

## Grading Night

Every week is graded on screen at a fixed time, shown as a countdown on the homepage with an "Add to calendar" invite.
Default: the Tuesday after the week's last game at 8:00 PM Eastern. To change it, add a line to picks.txt such as
`GRADING: Tue 9:00 PM`. Anyone can replay the grading afterwards from the Sheet. The marker sound is off unless a visitor turns it on.

## From the chat

`public/chat.txt` holds real group-chat lines (`HUNDO: message`), newest first. The homepage shows the four newest;
an empty file hides the strip.

## Integrations

| Feature | Source | Key (Netlify → Project configuration → Environment variables) |
|---|---|---|
| Live win probability on each pick, tap a game for box score, leaders, injuries | ESPN (unofficial) | none |
| NFL headlines on Stories ("The wire") | ESPN (unofficial) | none |
| VEGAS column (graded favorite, underdog tags, "beat Vegas") | The Odds API, else ESPN's line | `ODDS_API_KEY` (optional; free plan, about 240 of 500 credits a month) |
| Kickoff weather on outdoor games | Open-Meteo | none |
| Trending Who Better? matchups | Sleeper (most-added players, last 48 hours) + Wikipedia photos | none |
| Push alerts: picks lock, Grading Night, weekly result | Browser web push (keys made automatically) | none |
| Newsletter sign-ups | Substack (thewinningshot.substack.com): the form subscribes straight to Substack | none |
| Substack posts on Stories and the homepage | Substack's public RSS feed (`/api/substack`) | none |
| Optional Grading Night draft email | Buttondown | `BUTTONDOWN_API_KEY` (only if you ever move off Substack) |
| LIVE NOW banner and real view counts | YouTube Data API | `YOUTUBE_API_KEY` (optional) |
| "Hear the pick" links | Chapter timestamps in episode descriptions | none |

**Hear the pick:** put chapters in the episode description, one per line, like `14:32 Cowboys at Packers`.
Any chapter that names a team (nickname, city or code) links that week's game on the Sheet to that moment in the episode.

**Alerts on iPhone:** visitors add the site to their Home Screen first (Share → Add to Home Screen), then turn alerts on from there.

The newsletter draft is never sent automatically. It lands in Buttondown as a draft on Grading Night for the hosts to review, add the week's card image, and send.
