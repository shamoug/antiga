/* Save the Date — scenario definition.
   One scenario for now: "The River Rises" (flood in Southeast Asia).
   The engine is scenario-agnostic; new scenarios can follow this same shape. */
(function () {
  const actions = [
    { id: 'warn',     name: 'Issue public warning',      desc: 'Cheap; keeps the public alert. Small, steady benefit.',
      cost: 5,  effect: 8,  decay: 0.90, costEsc: 1.00, falseAlarm: 0 },
    { id: 'evacuate', name: 'Evacuate low-lying areas',  desc: 'Protects many lives — but far less useful once the water rises, and a costly move if it turns out to be a false alarm.',
      cost: 20, effect: 35, decay: 0.60, costEsc: 1.25, falseAlarm: 15 },
    { id: 'barriers', name: 'Reinforce flood barriers',  desc: 'Protects assets. Cannot be built at the last minute.',
      cost: 18, effect: 30, decay: 0.70, costEsc: 1.20, falseAlarm: 5 },
    { id: 'supplies', name: 'Pre-position relief supplies', desc: 'Robust — stays useful even late in the crisis.',
      cost: 12, effect: 15, decay: 0.95, costEsc: 1.05, falseAlarm: 2 },
    { id: 'levee',    name: 'Fund joint upstream levee',  desc: 'COORDINATION: fully effective ONLY if BOTH towns fund it the same round. Powerful early, near-useless late.',
      cost: 30, effect: 45, decay: 0.50, costEsc: 1.30, falseAlarm: 8, joint: true },
    { id: 'wait',     name: 'Hold / conserve budget',    desc: 'Spend nothing this round and wait for a clearer forecast.',
      cost: 0,  effect: 0,  decay: 1.00, costEsc: 1.00, falseAlarm: 0 }
  ];
  const actionsById = {};
  actions.forEach(a => { actionsById[a.id] = a; });

  window.FLOOD_SCENARIO = {
    id: 'flood',
    title: 'The River Rises',
    setting: 'Two towns share one river in Southeast Asia. A storm may be coming. Nobody yet knows how bad.',
    teamIds: ['red', 'blue'],
    teams: {
      red:  { name: 'Red Town',  color: '#e5484d' },
      blue: { name: 'Blue Town', color: '#3e63dd' }
    },
    rounds: 5,
    budget: 100,
    roundDuration: 60,           // seconds per round
    coordinationBonus: 1.4,      // both towns fund levee same round
    coordinationPenalty: 0.4,    // only one town funds levee (wasted coordination)
    falseAlarmThreshold: 35,     // true severity below this = the crisis was mild
    roundLabels: [
      '120 hours to impact',
      '96 hours to impact',
      '72 hours to impact',
      '48 hours to impact',
      '24 hours to impact'
    ],
    actions,
    actionsById,
    debrief: [
      'When was the cheapest, most effective moment to act — and did you take it?',
      'What did waiting for a more confident forecast actually cost you?',
      'Did the two towns manage to fund the joint levee together in the same round? What made coordinating hard?',
      'If you replayed this, where in the system would you intervene, and when?'
    ]
  };
})();
