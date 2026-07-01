/* Save the Date — app glue: UI, host loop, player actions. */
(function () {
  const SC = window.FLOOD_SCENARIO;

  // ---- state ----
  let sync = null;
  let isHost = false;
  let playerId = null;
  let myName = '';
  let room = '';
  let state = null;          // latest shared state
  let truthLocal = null;     // host only: hidden true severity
  let votes = {};            // host only: { round: { playerId: [actionIds] } }
  let mySelection = new Set();
  let lastRenderRound = -1;
  let hostTick = null;
  let timerTick = null;

  // ---- helpers ----
  const $ = (id) => document.getElementById(id);
  const val = (sel) => { const el = document.querySelector(sel); return el ? el.value.trim() : ''; };

  function getPlayerId() {
    let id = localStorage.getItem('sd_pid');
    if (!id) { id = 'p' + Math.floor(Math.random() * 1e9).toString(36) + Date.now().toString(36).slice(-4); localStorage.setItem('sd_pid', id); }
    return id;
  }
  function randomRoom() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let s = ''; for (let i = 0; i < 4; i++) s += chars[Math.floor(Math.random() * chars.length)];
    return s;
  }
  function showScreen(name) {
    document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
    $('screen-' + name).classList.add('active');
  }
  function setStatus(msg) { const el = $('connStatus'); if (el) el.textContent = msg; }

  // ---- create / join ----
  async function createGame() {
    myName = val('#createName') || 'Host';
    room = randomRoom();
    playerId = getPlayerId();
    isHost = true;
    const seed = Engine.hashStr(room + '|' + Date.now());
    const rng = Engine.mulberry32(seed);
    truthLocal = Math.round(15 + rng() * 80);            // hidden 15..95
    const forecasts = Engine.makeForecasts(rng, truthLocal, SC.rounds);

    state = {
      v: 1, room, phase: 'lobby', scenarioId: SC.id, title: SC.title, setting: SC.setting,
      forecasts, rounds: SC.rounds, roundDuration: SC.roundDuration,
      players: {}, teams: { red: { budget: SC.budget, spent: 0 }, blue: { budget: SC.budget, spent: 0 } },
      committed: {}, tally: { red: {}, blue: {} }, round: 0, roundEndsAt: 0,
      results: null, hostId: playerId
    };
    state.players[playerId] = { name: myName, team: 'red' };
    votes = {};

    setStatus('Connecting…');
    try {
      sync = new MqttSync(room);
      sync.on('state', onState); sync.on('msg', onHostMsg); sync.on('error', onErr);
      await sync.connect('sd-' + playerId + '-' + Math.random().toString(36).slice(2, 6));
      sync.subscribeState(); sync.subscribeMsg();
      publishState();
      startHostLoop();
      startTimerLoop();
      render();
    } catch (e) { setStatus('Could not connect to broker. Try again or switch broker in sync.js. (' + e.message + ')'); isHost = false; }
  }

  async function joinGame() {
    myName = val('#joinName') || 'Player';
    room = (val('#joinRoom') || '').toUpperCase();
    if (!room) { alert('Enter a room code.'); return; }
    playerId = getPlayerId();
    isHost = false;
    setStatus('Connecting…');
    try {
      sync = new MqttSync(room);
      sync.on('state', onState); sync.on('error', onErr);
      await sync.connect('sd-' + playerId + '-' + Math.random().toString(36).slice(2, 6));
      sync.subscribeState();
      // give the retained state a moment, then announce ourselves
      setTimeout(() => sync.sendMsg({ type: 'join', playerId, name: myName }), 400);
      startTimerLoop();
      setStatus('Joining room ' + room + '…');
    } catch (e) { setStatus('Could not connect. Check the code or your connection. (' + e.message + ')'); }
  }

  function onErr(e) { setStatus('Connection issue: ' + (e && e.message ? e.message : e)); }

  // ---- incoming state (all clients) ----
  function onState(data) {
    state = data;
    render();
  }

  // ---- host: handle player messages ----
  function onHostMsg(msg) {
    if (!isHost || !state) return;
    if (msg.type === 'join') {
      if (!state.players[msg.playerId]) {
        state.players[msg.playerId] = { name: msg.name || 'Player', team: assignTeam() };
      } else if (msg.name) {
        state.players[msg.playerId].name = msg.name;
      }
      publishState(); render();
    } else if (msg.type === 'vote') {
      votes[msg.round] = votes[msg.round] || {};
      votes[msg.round][msg.playerId] = Array.isArray(msg.actionIds) ? msg.actionIds : [];
      recomputeTally(msg.round);
      publishState(); render();
    }
  }

  function assignTeam() {
    let red = 0, blue = 0;
    for (const pid in state.players) { state.players[pid].team === 'red' ? red++ : blue++; }
    return red <= blue ? 'red' : 'blue';
  }

  function recomputeTally(round) {
    const t = { red: {}, blue: {} };
    const rv = votes[round] || {};
    for (const pid in rv) {
      const p = state.players[pid]; if (!p) continue;
      for (const id of rv[pid]) t[p.team][id] = (t[p.team][id] || 0) + 1;
    }
    state.tally = t;
  }

  function publishState() { if (sync) sync.publishState(state); }

  // ---- host loop ----
  function startHostLoop() {
    if (hostTick) clearInterval(hostTick);
    hostTick = setInterval(() => {
      if (!isHost || !state || state.phase !== 'playing') return;
      if (Date.now() >= state.roundEndsAt) { lockRound(state.round); advanceRound(); }
    }, 1000);
  }

  function startGame() {
    if (!isHost) return;
    state.phase = 'playing';
    state.round = 1;
    state.roundEndsAt = Date.now() + state.roundDuration * 1000;
    state.tally = { red: {}, blue: {} };
    votes = {};
    publishState(); render();
  }

  function lockRound(r) {
    const remRed = state.teams.red.budget - state.teams.red.spent;
    const remBlue = state.teams.blue.budget - state.teams.blue.spent;
    const red = Engine.commit(state.tally.red || {}, remRed, r, SC);
    const blue = Engine.commit(state.tally.blue || {}, remBlue, r, SC);

    // Coordination: joint levee only fully effective if BOTH funded it this round.
    const rLev = red.committed.find(x => x.actionId === 'levee');
    const bLev = blue.committed.find(x => x.actionId === 'levee');
    if (rLev && bLev) { rLev.effect *= SC.coordinationBonus; bLev.effect *= SC.coordinationBonus; }
    else { if (rLev) rLev.effect *= SC.coordinationPenalty; if (bLev) bLev.effect *= SC.coordinationPenalty; }

    state.committed[r] = { red: red.committed, blue: blue.committed };
    state.teams.red.spent += red.spent;
    state.teams.blue.spent += blue.spent;
  }

  function advanceRound() {
    if (state.round >= state.rounds) { finish(); return; }
    state.round += 1;
    state.roundEndsAt = Date.now() + state.roundDuration * 1000;
    state.tally = { red: {}, blue: {} };
    publishState(); render();
  }

  function finish() {
    state.phase = 'results';
    state.results = Engine.resolve(state, truthLocal, SC);
    state.results.truth = truthLocal;
    publishState(); render();
  }

  // ---- player voting ----
  function toggleAction(id) {
    if (state.phase !== 'playing') return;
    if (id === 'wait') { mySelection.clear(); }
    else { mySelection.has(id) ? mySelection.delete(id) : mySelection.add(id); }
    sendVote();
    render();
  }

  function sendVote() {
    const ids = [...mySelection];
    if (isHost) {
      votes[state.round] = votes[state.round] || {};
      votes[state.round][playerId] = ids;
      recomputeTally(state.round);
      publishState();
    } else {
      sync.sendMsg({ type: 'vote', playerId, round: state.round, actionIds: ids });
    }
  }

  // ---- timer loop (all clients, cosmetic) ----
  function startTimerLoop() {
    if (timerTick) clearInterval(timerTick);
    timerTick = setInterval(() => {
      if (!state || state.phase !== 'playing') return;
      const el = $('timer'); if (!el) return;
      const left = Math.max(0, Math.ceil((state.roundEndsAt - Date.now()) / 1000));
      const m = Math.floor(left / 60), s = left % 60;
      el.textContent = m + ':' + String(s).padStart(2, '0');
    }, 300);
  }

  // ---- rendering ----
  function myTeam() { return state && state.players[playerId] ? state.players[playerId].team : null; }

  function render() {
    if (!state) return;
    if (state.phase === 'lobby') { renderLobby(); showScreen('lobby'); }
    else if (state.phase === 'playing') { renderGame(); showScreen('game'); }
    else if (state.phase === 'results') { renderResults(); showScreen('results'); }
  }

  function renderLobby() {
    $('lobbyRoom').textContent = state.room;
    const grid = $('lobbyTeams'); grid.innerHTML = '';
    for (const tid of SC.teamIds) {
      const t = SC.teams[tid];
      const members = Object.keys(state.players).filter(pid => state.players[pid].team === tid)
        .map(pid => state.players[pid].name);
      const div = document.createElement('div');
      div.className = 'teamcard';
      div.style.borderColor = t.color;
      div.innerHTML = '<h3 style="color:' + t.color + '">' + t.name + '</h3>' +
        '<ul>' + (members.length ? members.map(m => '<li>' + esc(m) + (state.players[Object.keys(state.players).find(p=>state.players[p].name===m)] ? '' : '') + '</li>').join('') : '<li class="muted">— empty —</li>') + '</ul>';
      grid.appendChild(div);
    }
    const ctrl = $('lobbyControls');
    const count = Object.keys(state.players).length;
    if (isHost) {
      ctrl.innerHTML = '<p class="hint">' + count + ' player(s) joined. Players are auto-assigned to balance the towns.</p>' +
        '<button class="primary" onclick="SD.startGame()">Start the game</button>';
    } else {
      ctrl.innerHTML = myTeam()
        ? '<p class="hint">You are in <b>' + SC.teams[myTeam()].name + '</b>. Waiting for the host to start…</p>'
        : '<p class="hint">Joining…</p>';
    }
  }

  function renderGame() {
    const team = myTeam();
    if (state.round !== lastRenderRound) { mySelection = new Set(); lastRenderRound = state.round; }

    $('roundLabel').textContent = 'Round ' + state.round + ' / ' + state.rounds + ' — ' + SC.roundLabels[state.round - 1];
    $('crisisName').textContent = state.title;

    const fc = state.forecasts[state.round - 1];
    $('confidence').textContent = 'Confidence: ' + fc.confidence + '%';
    const range = $('bandRange');
    range.style.left = fc.low + '%';
    range.style.width = Math.max(1, fc.high - fc.low) + '%';
    $('bandPoint').style.left = fc.point + '%';

    // budget
    const rem = team ? state.teams[team].budget - state.teams[team].spent : 0;
    $('myTeamTitle').textContent = team ? SC.teams[team].name + ' — you' : 'Spectator';
    $('myTeamTitle').style.color = team ? SC.teams[team].color : '';
    $('budgetLabel').innerHTML = team
      ? 'Preparedness budget remaining: <b>' + rem + '</b> / ' + state.teams[team].budget
      : 'You are observing.';

    // action cards
    const cards = $('actionCards'); cards.innerHTML = '';
    if (team) {
      const tally = state.tally[team] || {};
      for (const a of SC.actions) {
        const cost = Engine.roundCost(a, state.round);
        const eff = Math.round(Engine.roundEffect(a, state.round));
        const selected = a.id === 'wait' ? mySelection.size === 0 : mySelection.has(a.id);
        const unaffordable = a.id !== 'wait' && cost > rem;
        const div = document.createElement('div');
        div.className = 'acard' + (selected ? ' sel' : '') + (unaffordable ? ' dim' : '');
        div.onclick = () => toggleAction(a.id);
        let meta = a.id === 'wait'
          ? '<span class="pill">Cost 0</span>'
          : '<span class="pill">Cost ' + cost + '</span><span class="pill">Protection ' + eff + '</span>';
        if (a.joint) meta += '<span class="pill joint">Coordinated</span>';
        if (a.falseAlarm) meta += '<span class="pill warn">False-alarm risk</span>';
        const v = tally[a.id] || 0;
        div.innerHTML = '<div class="acard-top"><b>' + a.name + '</b><span class="votes">' + (v ? '👍 ' + v : '') + '</span></div>' +
          '<div class="meta">' + meta + '</div>' +
          '<div class="desc">' + a.desc + '</div>';
        cards.appendChild(div);
      }
      const selCost = [...mySelection].reduce((s, id) => s + Engine.roundCost(SC.actionsById[id], state.round), 0);
      $('selCost').innerHTML = 'Your vote this round costs <b>' + selCost + '</b>' +
        (selCost > rem ? ' <span class="over">— over budget; lowest-cost votes win first</span>' : '') +
        '. Decisions lock when the timer ends; the most-voted affordable actions are enacted.';
    } else {
      $('selCost').textContent = '';
    }

    renderBoard();
  }

  function renderBoard() {
    const board = $('board');
    let html = '';
    // per-town spent so far
    html += '<div class="board-row head"><span></span>' +
      SC.teamIds.map(t => '<span style="color:' + SC.teams[t].color + '">' + SC.teams[t].name + '</span>').join('') + '</div>';
    html += '<div class="board-row"><span class="rl">Budget spent</span>' +
      SC.teamIds.map(t => '<span>' + state.teams[t].spent + '</span>').join('') + '</div>';
    // committed actions per completed round
    for (let r = 1; r < state.round; r++) {
      const c = state.committed[r] || { red: [], blue: [] };
      html += '<div class="board-row"><span class="rl">R' + r + ' committed</span>' +
        SC.teamIds.map(t => '<span>' + (c[t] && c[t].length ? c[t].map(x => shortName(x.actionId)).join(', ') : '—') + '</span>').join('') + '</div>';
    }
    html += '<p class="hint small">Other town\'s current-round choice is hidden until the round locks — you decide at the same time.</p>';
    board.innerHTML = html;
  }

  function renderResults() {
    const r = state.results;
    const truth = r.truth;
    $('revealBox').innerHTML = '<div class="sev">The storm hit at severity <b>' + truth + '/100</b> — ' +
      Engine.severityLabel(truth) + '.</div>';

    const grid = $('scoreCards'); grid.innerHTML = '';
    let winner = null, best = -Infinity;
    for (const tid of SC.teamIds) if (r[tid].score > best) { best = r[tid].score; winner = tid; }
    for (const tid of SC.teamIds) {
      const t = SC.teams[tid]; const d = r[tid];
      const div = document.createElement('div');
      div.className = 'teamcard';
      div.style.borderColor = t.color;
      div.innerHTML = '<h3 style="color:' + t.color + '">' + t.name +
        (tid === winner ? ' 🏆' : '') + '</h3>' +
        '<div class="bigscore">' + d.score + '</div><div class="muted">final score</div>' +
        '<table class="scoretab">' +
        row('Damage prevented', '+' + d.prevented) +
        row('Unspent-budget bonus', '+' + d.bonus) +
        row('False-alarm penalty', d.falseAlarm ? '−' + d.falseAlarm : '0') +
        row('Total spent', d.spent) +
        row('Residual loss', d.finalLoss) +
        '</table>';
      grid.appendChild(div);
    }

    const ul = $('debrief'); ul.innerHTML = SC.debrief.map(q => '<li>' + q + '</li>').join('');
    drawChart();
  }
  function row(k, v) { return '<tr><td>' + k + '</td><td>' + v + '</td></tr>'; }

  function shortName(id) {
    return ({ warn: 'Warn', evacuate: 'Evacuate', barriers: 'Barriers', supplies: 'Supplies', levee: 'Levee', wait: 'Wait' })[id] || id;
  }
  function esc(s) { return String(s).replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c])); }

  // ---- results chart ----
  function drawChart() {
    const cv = $('chart'); if (!cv) return;
    const ctx = cv.getContext('2d');
    const W = cv.width, H = cv.height, pad = 46;
    ctx.clearRect(0, 0, W, H);
    const rounds = state.rounds;
    const x = r => pad + (r - 1) / (rounds - 1) * (W - pad * 2);
    const y = v => H - pad - v * (H - pad * 2);

    // axes
    ctx.strokeStyle = '#cbd5e1'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(pad, pad); ctx.lineTo(pad, H - pad); ctx.lineTo(W - pad, H - pad); ctx.stroke();
    ctx.fillStyle = '#64748b'; ctx.font = '12px system-ui';
    for (let r = 1; r <= rounds; r++) { ctx.textAlign = 'center'; ctx.fillText('R' + r, x(r), H - pad + 16); }
    ctx.textAlign = 'right'; ctx.fillText('high', pad - 8, y(1) + 4); ctx.fillText('low', pad - 8, y(0) + 4);

    // reference curves (evacuate as representative action)
    const ev = SC.actionsById.evacuate;
    const costMax = Math.pow(ev.costEsc, rounds - 1);
    const line = (fn, color, dash) => {
      ctx.strokeStyle = color; ctx.lineWidth = 2.5; ctx.setLineDash(dash || []);
      ctx.beginPath();
      for (let r = 1; r <= rounds; r++) { const px = x(r), py = y(fn(r)); r === 1 ? ctx.moveTo(px, py) : ctx.lineTo(px, py); }
      ctx.stroke(); ctx.setLineDash([]);
    };
    line(r => Math.pow(ev.costEsc, r - 1) / costMax, '#f59e0b');           // cost of acting (rising)
    line(r => Math.pow(ev.decay, r - 1), '#10b981');                        // effectiveness (falling)
    line(r => state.forecasts[r - 1].confidence / 100, '#6366f1', [6, 4]);  // confidence (rising)

    // spend bubbles per team per round
    for (const tid of SC.teamIds) {
      ctx.fillStyle = SC.teams[tid].color;
      for (let r = 1; r <= rounds; r++) {
        const items = (state.committed[r] && state.committed[r][tid]) || [];
        const spend = items.reduce((s, it) => s + it.cost, 0);
        if (spend > 0) {
          const off = tid === 'red' ? -6 : 6;
          ctx.globalAlpha = 0.75;
          ctx.beginPath(); ctx.arc(x(r) + off, y(0.06), 4 + spend * 0.4, 0, Math.PI * 2); ctx.fill();
          ctx.globalAlpha = 1;
        }
      }
    }

    // legend
    const leg = [['Cost of acting', '#f59e0b'], ['Effectiveness', '#10b981'], ['Forecast confidence', '#6366f1']];
    let lx = pad + 6;
    ctx.font = '12px system-ui'; ctx.textAlign = 'left';
    leg.forEach(([label, color]) => {
      ctx.fillStyle = color; ctx.fillRect(lx, pad - 14, 14, 4);
      ctx.fillStyle = '#334155'; ctx.fillText(label, lx + 20, pad - 8);
      lx += ctx.measureText(label).width + 60;
    });
  }

  // ---- misc ----
  function copyLink() {
    const url = location.origin + location.pathname + '?room=' + state.room;
    navigator.clipboard && navigator.clipboard.writeText(url);
    const btn = event.target; const t = btn.textContent; btn.textContent = 'Copied!'; setTimeout(() => btn.textContent = t, 1500);
  }
  function playAgain() { location.href = location.origin + location.pathname; }

  // prefill room from ?room=
  (function initFromUrl() {
    const m = location.search.match(/[?&]room=([A-Za-z0-9]+)/);
    if (m) { window.addEventListener('DOMContentLoaded', () => { const el = $('joinRoom'); if (el) el.value = m[1].toUpperCase(); }); }
  })();

  window.SD = { createGame, joinGame, startGame, toggleAction, copyLink, playAgain };
})();
