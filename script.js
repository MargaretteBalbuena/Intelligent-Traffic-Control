/*
================================================================
  STATE OBJECT
  A single source of truth for the entire dashboard.
  No DOM property is ever read back to infer state;
  the DOM is always a pure output of this object.
================================================================
*/
const trafficSystem = {
  /*
    ns / ew hold the current signal colour for each corridor.
    Possible values: 'red' | 'yellow' | 'green'
  */
  ns: 'green',
  ew: 'red',

  /*
    isTransitioning — the critical race-condition guard.
    When true, all user input (manual button + auto-cycle timer)
    is silently ignored until the async transition completes.
    This ensures two corridors can never be Green/Yellow
    simultaneously.
  */
  isTransitioning: false,

  /*
    autoCycle — whether the interval-based auto switcher is on.
    cycleInterval — desired seconds between auto switches.
    autoTimer — reference to the setInterval handle.
  */
  autoCycle: false,
  cycleInterval: 8, // seconds

  /*
    metrics tracked at runtime
  */
  totalCycles: 0,
  startTime: Date.now(),

  /*
    Countdown helpers — used to show the per-card timer badge.
    These are updated inside the countdown setInterval.
  */
  nsCountdown: 0,
  ewCountdown: 0,
};

// ─── keep a reference to the auto-cycle setInterval handle ───
let autoTimer = null;

// ─── keep a reference to the countdown-display setInterval ───
let countdownTimer = null;

/*
================================================================
  DOM REFERENCES
  Gathered once at startup; never queried again inside loops.
================================================================
*/
const DOM = {
  // traffic light bulbs
  nsBulbs:  { red: document.querySelector('#ns-red'),    yellow: document.querySelector('#ns-yellow'),    green: document.querySelector('#ns-green')    },
  ewBulbs:  { red: document.querySelector('#ew-red'),    yellow: document.querySelector('#ew-yellow'),    green: document.querySelector('#ew-green')    },

  // intersection wrapper cards (for border-glow class)
  cardNS:   document.querySelector('#card-ns'),
  cardEW:   document.querySelector('#card-ew'),

  // state badges below each light
  badgeNS:  document.querySelector('#badge-ns'),
  badgeEW:  document.querySelector('#badge-ew'),

  // countdown timers per card
  timerNS:  document.querySelector('#timer-ns'),
  timerEW:  document.querySelector('#timer-ew'),

  // mini map circles
  mapNS:    { red: document.querySelector('#map-ns-red'), yellow: document.querySelector('#map-ns-yellow'), green: document.querySelector('#map-ns-green') },
  mapEW:    { red: document.querySelector('#map-ew-red'), yellow: document.querySelector('#map-ew-yellow'), green: document.querySelector('#map-ew-green') },

  // animated cars
  carNS:    document.querySelector('#car-ns-group'),
  carEW:    document.querySelector('#car-ew-group'),

  // controls
  btnSwitch:    document.querySelector('#btn-switch'),
  autoToggle:   document.querySelector('#auto-toggle'),
  intervalSlider: document.querySelector('#interval-slider'),
  sliderDisplay:  document.querySelector('#slider-display'),

  // status chips
  chipMode:       document.querySelector('#chip-mode'),
  chipTransition: document.querySelector('#chip-transition'),

  // metrics
  metricCycles: document.querySelector('#metric-cycles'),
  metricUptime: document.querySelector('#metric-uptime'),
  metricActive: document.querySelector('#metric-active'),

  // log
  logBody:     document.querySelector('#log-body'),
  btnClearLogs: document.querySelector('#btn-clear-logs'),

  // clock display
  clock: document.querySelector('#clock'),
};

/*
================================================================
  updateUI()
  ────────────────────────────────────────────────────────────
  PURPOSE:
    Reads `trafficSystem` (state) and imperatively updates
    every visual element in the DOM to match.

  DESIGN RULE:
    This function contains NO logic — it only maps state → DOM.
    It is safe to call at any time; calling it twice in a row
    should produce an identical result (idempotent).

  FLOW:
    1. Compute which CSS class each bulb/card/badge should have.
    2. Use classList to apply exactly one active class.
    3. Update map mini-lights & animated cars.
    4. Enable/disable the switch button based on isTransitioning.
================================================================
*/
function updateUI() {
  const { ns, ew, isTransitioning } = trafficSystem;

  /* ── Helper: set exactly one active class on a light bulb ── */
  function setBulb(el, activeClass) {
    el.classList.remove('on-red', 'on-yellow', 'on-green');
    if (activeClass) el.classList.add(activeClass);
  }

  /* ── Helper: update a mini-map circle opacity ── */
  function setMapLight(circles, activeKey) {
    Object.entries(circles).forEach(([key, el]) => {
      el.style.opacity = key === activeKey ? '1' : '0.15';
    });
  }

  /* ── Helper: update card glow class ── */
  function setCardGlow(cardEl, colour) {
    cardEl.classList.remove('active-green', 'active-yellow', 'active-red');
    cardEl.classList.add(`active-${colour}`);
  }

  /* ── Helper: update a state badge text & class ── */
  function setBadge(el, colour) {
    el.classList.remove('badge-red', 'badge-yellow', 'badge-green');
    el.classList.add(`badge-${colour}`);
    el.textContent = colour.toUpperCase();
  }

  /* ── Apply NS corridor state ── */
  setBulb(DOM.nsBulbs.red,    ns === 'red'    ? 'on-red'    : null);
  setBulb(DOM.nsBulbs.yellow, ns === 'yellow' ? 'on-yellow' : null);
  setBulb(DOM.nsBulbs.green,  ns === 'green'  ? 'on-green'  : null);
  setMapLight(DOM.mapNS, ns);
  setCardGlow(DOM.cardNS, ns);
  setBadge(DOM.badgeNS, ns);

  /* ── Apply EW corridor state ── */
  setBulb(DOM.ewBulbs.red,    ew === 'red'    ? 'on-red'    : null);
  setBulb(DOM.ewBulbs.yellow, ew === 'yellow' ? 'on-yellow' : null);
  setBulb(DOM.ewBulbs.green,  ew === 'green'  ? 'on-green'  : null);
  setMapLight(DOM.mapEW, ew);
  setCardGlow(DOM.cardEW, ew);
  setBadge(DOM.badgeEW, ew);

  /* ── Animate SVG cars ──
       The NS car drives when NS is green.
       CSS transition handles the smooth movement.
       translateY values: parked at top (y≈12), crossing (y≈120).  */
  DOM.carNS.style.opacity   = ns === 'green' ? '1' : '0.25';
  DOM.carNS.style.transform = ns === 'green'
    ? 'translate(237px, 108px)'   // car moving through intersection
    : 'translate(237px, 12px)';   // car stopped at red

  DOM.carEW.style.opacity   = ew === 'green' ? '1' : '0.25';
  DOM.carEW.style.transform = ew === 'green'
    ? 'translate(155px, 69px)'    // car moving through intersection
    : 'translate(310px, 69px)';   // car stopped at red

  /* ── Switch button & transition chip state ── */
  DOM.btnSwitch.disabled = isTransitioning;
  DOM.chipTransition.textContent    = isTransitioning ? 'Transitioning' : 'Stable';
  DOM.chipTransition.className      = `chip ${isTransitioning ? 'chip--warn' : 'chip--idle'}`;

  /* ── Metrics ── */
  const elapsed = Math.floor((Date.now() - trafficSystem.startTime) / 1000);
  DOM.metricCycles.textContent = trafficSystem.totalCycles;
  DOM.metricActive.textContent = ns === 'green' ? 'N–S' : (ew === 'green' ? 'E–W' : '—');
  DOM.metricUptime.textContent = elapsed >= 60
    ? `${Math.floor(elapsed/60)}m${elapsed%60}s`
    : `${elapsed}s`;
}

/*
================================================================
  sleep(ms)
  ────────────────────────────────────────────────────────────
  A Promise-based delay used inside the async transition
  function. Leverages the browser's macrotask queue via
  setTimeout so the Event Loop can render frames between steps.
================================================================
*/
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/*
================================================================
  startCountdown(corridor, seconds)
  ────────────────────────────────────────────────────────────
  Shows a live ticking countdown badge on the intersection card.
  Uses setInterval to tick down every second and hides itself
  when time runs out.
  `corridor` is 'ns' or 'ew'.
================================================================
*/
function startCountdown(corridor, seconds) {
  const timerEl = corridor === 'ns' ? DOM.timerNS : DOM.timerEW;
  timerEl.classList.remove('hidden');
  timerEl.textContent = `${seconds}s`;

  let remaining = seconds;
  const id = setInterval(() => {
    remaining--;
    if (remaining <= 0) {
      clearInterval(id);
      timerEl.classList.add('hidden');
    } else {
      timerEl.textContent = `${remaining}s`;
    }
  }, 1000);
}

/*
================================================================
  addLog(message, level)
  ────────────────────────────────────────────────────────────
  Appends a formatted entry to the sidebar log panel.
  `level` is one of: 'info' | 'warn' | 'success' | 'error'

  IMPLEMENTATION NOTE:
    Maximum 60 entries are kept to avoid unbounded DOM growth.
    We use insertAdjacentHTML for performance (single reflow).
    The log body uses `aria-live="polite"` so screen readers
    announce new entries non-intrusively.
================================================================
*/
function addLog(message, level = 'info') {
  const MAX_LOGS = 60;

  // Build timestamp string (HH:MM:SS)
  const now  = new Date();
  const time = [now.getHours(), now.getMinutes(), now.getSeconds()]
    .map(n => String(n).padStart(2, '0'))
    .join(':');

  // Level label shorthand displayed in the grid
  const labels = { info: 'INFO', warn: 'WARN', success: ' OK ', error: 'ERR!' };

  // Sanitise message to prevent XSS via log injection
  const safe = message
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

  const html = `
    <div class="log-entry ${level}" role="listitem">
      <span class="log-entry__time">${time}</span>
      <span class="log-entry__level">${labels[level] || 'INFO'}</span>
      <span class="log-entry__msg">${safe}</span>
    </div>`;

  // Prepend so newest entry is always at the top
  DOM.logBody.insertAdjacentHTML('afterbegin', html);

  // Prune oldest entries when cap is exceeded
  while (DOM.logBody.children.length > MAX_LOGS) {
    DOM.logBody.removeChild(DOM.logBody.lastChild);
  }
}

/*
================================================================
  transitionLights()
  ────────────────────────────────────────────────────────────
  THE CORE ASYNC STATE MACHINE.

  This is an `async` function that orchestrates a safe,
  multi-step colour transition using `await sleep()`.

  GUARANTEED SEQUENCE (if NS is currently Green):
    1. Set isTransitioning = true   ← LOCK acquired
    2. NS → Yellow (3 s buffer)
    3. NS → Red
    4. Safety pause (1 s) — both are Red, nobody moves
    5. EW → Green
    6. Set isTransitioning = false  ← LOCK released

  The same sequence applies in reverse (EW → NS).

  WHY ASYNC / AWAIT?
    setTimeout callbacks would require nesting and make the
    sequence hard to follow. async/await flattens the logic
    into imperative, readable steps without blocking the UI
    thread — the Event Loop continues to process paint frames
    and user events between each `await`.

  RACE CONDITION PROTECTION:
    The guard `if (trafficSystem.isTransitioning) return;`
    at the TOP of handleLogic() ensures this function is
    never entered while a transition is already in-flight.
    Once the lock is set, no external code path can change
    trafficSystem.ns or trafficSystem.ew.
================================================================
*/
async function transitionLights() {
  // Determine which corridor is currently Green (the "active" one)
  const activeIsNS = trafficSystem.ns === 'green';

  const fromDir = activeIsNS ? 'N–S' : 'E–W';
  const toDir   = activeIsNS ? 'E–W' : 'N–S';

  addLog(`Transition requested: ${fromDir} → ${toDir}`, 'info');

  // ── STEP 1: ACQUIRE LOCK ──────────────────────────────────
  // Any handleLogic() call that arrives while this flag is
  // true will immediately return, preventing a second
  // concurrent transition from starting.
  trafficSystem.isTransitioning = true;
  updateUI();

  // ── STEP 2: YELLOW BUFFER (3 seconds) ────────────────────
  // The currently-green corridor turns Yellow.
  // This gives real-world drivers time to clear the junction.
  if (activeIsNS) {
    trafficSystem.ns = 'yellow';
  } else {
    trafficSystem.ew = 'yellow';
  }

  const YELLOW_DURATION = 3; // seconds
  startCountdown(activeIsNS ? 'ns' : 'ew', YELLOW_DURATION);
  addLog(`${fromDir} → YELLOW  (${YELLOW_DURATION}s buffer)`, 'warn');
  updateUI();

  // Await suspends execution HERE; the Event Loop is free to
  // process paint frames so the yellow light visually appears
  // before we continue.
  await sleep(YELLOW_DURATION * 1000);

  // ── STEP 3: ACTIVE CORRIDOR GOES RED ─────────────────────
  if (activeIsNS) {
    trafficSystem.ns = 'red';
  } else {
    trafficSystem.ew = 'red';
  }
  addLog(`${fromDir} → RED`, 'error');
  updateUI();

  // ── STEP 4: ALL-RED SAFETY PAUSE (1 second) ──────────────
  // Both corridors are now Red. This 1-second clearance
  // ensures any vehicle caught in the transition zone has
  // exited before the crossing direction turns Green.
  const SAFETY_PAUSE = 1; // seconds
  addLog(`All-RED safety pause (${SAFETY_PAUSE}s)…`, 'warn');
  await sleep(SAFETY_PAUSE * 1000);

  // ── STEP 5: OPPOSITE CORRIDOR TURNS GREEN ────────────────
  if (activeIsNS) {
    trafficSystem.ew = 'green';
  } else {
    trafficSystem.ns = 'green';
  }
  trafficSystem.totalCycles++;
  addLog(`${toDir} → GREEN  ✓  (cycle #${trafficSystem.totalCycles})`, 'success');

  // Start a countdown showing how long this corridor stays green
  // (only relevant in auto mode, but we display it regardless)
  if (trafficSystem.autoCycle) {
    startCountdown(activeIsNS ? 'ew' : 'ns', trafficSystem.cycleInterval);
  }

  updateUI();

  // ── STEP 6: RELEASE LOCK ──────────────────────────────────
  // The transition is complete. New input is now accepted.
  trafficSystem.isTransitioning = false;
  updateUI(); // re-render to re-enable the button
}

/*
================================================================
  handleLogic()
  ────────────────────────────────────────────────────────────
  ENTRY POINT for all state-change requests, whether triggered
  by a human click or the auto-cycle timer.

  GUARD:
    The very first check is the race-condition guard.
    If a transition is already in progress, we log the
    skip and return immediately — no state is mutated.

  FLOW:
    1. Guard (isTransitioning?)
    2. Validate current state (is one corridor actually Green?)
    3. Delegate to transitionLights() (async — returns immediately
       but continues running in the background on the Event Loop)
================================================================
*/
function handleLogic() {
  // ── RACE CONDITION GUARD ──────────────────────────────────
  // If the async transition is already running, drop this
  // request silently (or log it for debug purposes).
  if (trafficSystem.isTransitioning) {
    addLog('Input ignored — transition already in progress.', 'warn');
    return;
  }

  // ── SANITY CHECK ─────────────────────────────────────────
  // In normal operation exactly one corridor is green.
  // If state is somehow invalid, log and bail out.
  const nsIsGreen = trafficSystem.ns === 'green';
  const ewIsGreen = trafficSystem.ew === 'green';

  if (!nsIsGreen && !ewIsGreen) {
    addLog('State error: no corridor is Green. Re-initialising.', 'error');
    trafficSystem.ns = 'green';
    trafficSystem.ew = 'red';
    updateUI();
    return;
  }

  if (nsIsGreen && ewIsGreen) {
    addLog('State error: both corridors are Green! Forcing safe state.', 'error');
    trafficSystem.ew = 'red';
    updateUI();
    return;
  }

  // ── HAND OFF TO STATE MACHINE ─────────────────────────────
  // transitionLights() is async but we do NOT await it here.
  // It self-manages via the isTransitioning flag.
  transitionLights();
}

/*
================================================================
  startAutoTimer()  /  stopAutoTimer()
  ────────────────────────────────────────────────────────────
  Manage the setInterval that drives automatic cycling.
  stopAutoTimer() always clears the interval reference safely.
================================================================
*/
function startAutoTimer() {
  stopAutoTimer(); // always cancel any existing timer first
  autoTimer = setInterval(() => {
    addLog(`Auto-cycle triggered (every ${trafficSystem.cycleInterval}s)`, 'info');
    handleLogic();
  }, trafficSystem.cycleInterval * 1000);

  addLog(`Auto-cycle ENABLED — switching every ${trafficSystem.cycleInterval}s`, 'success');
}

function stopAutoTimer() {
  if (autoTimer !== null) {
    clearInterval(autoTimer);
    autoTimer = null;
  }
}

/*
================================================================
  init()
  ────────────────────────────────────────────────────────────
  BOOTSTRAP function. Runs exactly once when the page loads.

  Responsibilities:
    1. Render the initial state to the DOM (updateUI).
    2. Attach all event listeners.
    3. Start the live clock and uptime ticker.
    4. Write the initial system log entries.

  WHY A DEDICATED init()?
    Keeping setup code isolated here makes it easy to test,
    replay, or defer (e.g. if the DOM were not ready yet).
================================================================
*/
function init() {
  // ── 1. Render initial state ───────────────────────────────
  updateUI();
  addLog('System initialised. N–S corridor is GREEN.', 'success');
  addLog('State machine ready. Race condition guard: ACTIVE.', 'info');
  addLog('Click "Switch Direction" or enable Auto-Cycle to begin.', 'info');

  // ── 2. Manual switch button ───────────────────────────────
  DOM.btnSwitch.addEventListener('click', () => {
    addLog('Manual switch requested by operator.', 'info');
    handleLogic();
  });

  // ── 3. Auto-cycle toggle ──────────────────────────────────
  DOM.autoToggle.addEventListener('change', () => {
    trafficSystem.autoCycle = DOM.autoToggle.checked;
    DOM.chipMode.textContent = trafficSystem.autoCycle ? 'Auto Mode' : 'Manual Mode';
    DOM.chipMode.className   = `chip ${trafficSystem.autoCycle ? 'chip--active' : 'chip--idle'}`;

    if (trafficSystem.autoCycle) {
      startAutoTimer();
    } else {
      stopAutoTimer();
      addLog('Auto-cycle DISABLED — manual control restored.', 'warn');
    }
  });

  // ── 4. Interval slider ────────────────────────────────────
  DOM.intervalSlider.addEventListener('input', () => {
    const val = parseInt(DOM.intervalSlider.value, 10);
    trafficSystem.cycleInterval = val;
    DOM.sliderDisplay.textContent = `${val}s`;

    // If auto mode is on, restart the timer with the new interval
    if (trafficSystem.autoCycle) {
      addLog(`Cycle interval updated → ${val}s. Restarting timer.`, 'info');
      startAutoTimer();
    }
  });

  // ── 5. Clear logs button ──────────────────────────────────
  DOM.btnClearLogs.addEventListener('click', () => {
    DOM.logBody.innerHTML = '';
    addLog('Log cleared by operator.', 'warn');
  });

  // ── 6. Live clock update (every second via Event Loop) ────
  // Uses setInterval to schedule a macrotask each second.
  // This does NOT block — each tick is a separate callback
  // dispatched from the task queue when the stack is clear.
  setInterval(() => {
    const now = new Date();
    DOM.clock.textContent = now.toLocaleTimeString();
    updateUI(); // refresh uptime metric on same tick
  }, 1000);
}

/*
================================================================
  ENTRY POINT
  DOMContentLoaded fires once the HTML is parsed and the DOM
  is ready. We guard here rather than calling init() directly
  so the script can be moved to the <head> in the future
  without breaking DOM access.
================================================================
*/
document.addEventListener('DOMContentLoaded', init);
