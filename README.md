# Save the Date — The Anticipation Game

A fully online, browser-based, multiplayer **systems-thinking game** about acting under uncertainty.
Two towns share one river in Southeast Asia and face a possible flood. Every round the forecast
gets sharper — but acting gets more expensive and less effective. Act too early and you may waste
resources on a false alarm; wait for certainty and it's already too late.

There is **no human facilitator** — a deterministic engine runs the game (clock, forecasts,
resolution, scoring). There are **no in-person players** — everyone joins online. It is a static
site: no backend, no build step. Shared state travels over a public **MQTT** broker.

## How to play

1. One person clicks **Create game** and shares the 4-letter room code (or the invite link).
2. Everyone else clicks **Join game** and enters the code. Players are auto-balanced into **Red Town**
   and **Blue Town**.
3. The host clicks **Start**. Each round (60s), teammates **vote** on preparedness actions. When the
   timer ends, the most-voted affordable actions are enacted, the forecast sharpens, and the crisis
   steps closer.
4. After 5 rounds the flood hits. See each town's score, the **timing trade-off chart**, and the
   debrief questions.

The teaching point: find the **best moment to act** in the window between the first warning and the
crisis — and notice that the two towns' **joint upstream levee** only pays off if both fund it in the
same round (coordination).

## Publish on GitHub Pages

1. Create a repo and push these files (everything in this folder).
2. Repo **Settings → Pages → Build and deployment → Deploy from a branch**, pick `main` / `root`.
3. Open the published URL. Share it — that's the whole game.

The `.nojekyll` file is included so GitHub Pages serves the files as-is.

## Run locally

Because it loads a script from a CDN over `https`, serve it (don't open the file directly):

```
python -m http.server 5178
# then open http://localhost:5178
```

Open two browser tabs (or send the link to a phone) to test multiplayer.

## How it works

- **`scenario.js`** — the flood scenario as data: teams, budget, actions (each with a cost that
  *escalates* and an effectiveness that *decays* per round), the coordination levee, and false-alarm
  thresholds. New scenarios can follow the same shape.
- **`engine.js`** — pure functions (no DOM, no network): forecast generation (uncertainty band
  narrows toward a hidden truth), turning votes into committed actions within budget, and final
  scoring.
- **`sync.js`** — the MQTT layer. Game state lives in a **retained** message on
  `savethedate/v1/<room>/state`, so anyone who joins gets the current game instantly. Players publish
  join/vote messages to `savethedate/v1/<room>/msg`.
- **`app.js`** — UI plus the host loop. The game **creator's browser is the authoritative host**: it
  runs the round timer, tallies votes, resolves each round, and publishes state. Everyone else renders
  that state and sends votes.

### Changing the MQTT broker

Default broker is `wss://broker.emqx.io:8084/mqtt` (free, public, secure WebSockets). If it's blocked
on your network, edit `BROKER_URL` in **`sync.js`** — alternatives are listed there (HiveMQ,
Mosquitto test).

### Tuning the game

Edit **`scenario.js`**: `rounds`, `roundDuration` (seconds), `budget`, each action's `cost` /
`effect` / `decay` / `costEsc`, `coordinationBonus` / `coordinationPenalty`, and
`falseAlarmThreshold`. Those parameters *are* the "information vs. ability to act" trade-off.

## Known limitations

- The host (game creator) must stay connected; if they close the tab, the game pauses. Host migration
  isn't implemented yet.
- Uses a free public MQTT broker with no authentication — fine for workshops; don't use real room
  codes for anything sensitive.
