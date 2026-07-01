/* Save the Date — deterministic game engine (the "computer facilitator").
   Pure functions: no DOM, no network. */
(function () {

  function hashStr(s) {
    let h = 2166136261 >>> 0;
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
    return h >>> 0;
  }

  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // Forecasts converge on the hidden truth as the crisis nears (uncertainty band narrows).
  function makeForecasts(rng, truth, rounds) {
    const maxBand = 40;
    const out = [];
    for (let r = 1; r <= rounds; r++) {
      const hw = maxBand * (1 - ((r - 1) / (rounds - 1)) * 0.85);
      let point = truth + (rng() - 0.5) * hw * 0.6;
      point = Math.max(0, Math.min(100, point));
      out.push({
        round: r,
        point: Math.round(point),
        low: Math.round(Math.max(0, point - hw)),
        high: Math.round(Math.min(100, point + hw)),
        confidence: Math.max(5, Math.round(100 - hw * 1.9))
      });
    }
    return out;
  }

  function roundCost(a, r)   { return Math.round(a.cost * Math.pow(a.costEsc, r - 1)); }
  function roundEffect(a, r) { return a.effect * Math.pow(a.decay, r - 1); }

  // Turn a round's vote tally into a committed set of actions, greedily by votes, within budget.
  function commit(tally, remaining, round, scenario) {
    const entries = Object.keys(tally)
      .map(id => ({ id, count: tally[id] }))
      .filter(e => e.count > 0)
      .sort((x, y) => y.count - x.count);
    const committed = [];
    let spent = 0, rem = remaining;
    const taken = new Set();
    for (const e of entries) {
      if (e.id === 'wait' || taken.has(e.id)) continue;
      const a = scenario.actionsById[e.id];
      if (!a) continue;
      const c = roundCost(a, round);
      if (c <= rem) {
        committed.push({ actionId: a.id, name: a.name, cost: c, effect: roundEffect(a, round) });
        rem -= c; spent += c; taken.add(e.id);
      }
    }
    return { committed, spent };
  }

  // Final resolution once all rounds are locked. truth passed in explicitly.
  function resolve(state, truth, scenario) {
    const res = {};
    for (const team of scenario.teamIds) {
      let protection = 0, falseAlarm = 0;
      const spent = state.teams[team].spent;
      const rounds = Object.keys(state.committed || {});
      for (const r of rounds) {
        const items = (state.committed[r] && state.committed[r][team]) || [];
        for (const it of items) {
          protection += it.effect;
          const a = scenario.actionsById[it.actionId];
          if (a && a.falseAlarm && truth < scenario.falseAlarmThreshold) falseAlarm += a.falseAlarm;
        }
      }
      const prevented = Math.min(protection, truth);
      const unspent = state.teams[team].budget - spent;
      const bonus = unspent * 0.2;
      res[team] = {
        protection: Math.round(protection),
        prevented: Math.round(prevented),
        potentialLoss: truth,
        finalLoss: Math.round(Math.max(0, truth - protection)),
        spent,
        unspent,
        bonus: Math.round(bonus),
        falseAlarm,
        score: Math.round(prevented + bonus - falseAlarm)
      };
    }
    return res;
  }

  function severityLabel(truth) {
    if (truth < 35) return 'a minor event — barely a flood at all';
    if (truth < 65) return 'a moderate flood';
    return 'a severe, devastating flood';
  }

  window.Engine = { hashStr, mulberry32, makeForecasts, roundCost, roundEffect, commit, resolve, severityLabel };
})();
