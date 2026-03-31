const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');

// ─── Audio Engine ────────────────────────────────────────────────────────────
let audioCtx = null;

function getAudio() {
  if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  return audioCtx;
}

function makeDistortionCurve(amount) {
  const n = 256, curve = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const x = (i * 2) / n - 1;
    curve[i] = ((Math.PI + amount) * x) / (Math.PI + amount * Math.abs(x));
  }
  return curve;
}

// Player engine hum
let engineOsc = null, engineGain = null;

function startEngineSound() {
  const ac = getAudio();
  if (engineOsc) return;

  engineOsc = ac.createOscillator();
  engineOsc.type = 'sawtooth';
  engineOsc.frequency.setValueAtTime(80, ac.currentTime);

  const dist = ac.createWaveShaper();
  dist.curve = makeDistortionCurve(60);

  engineGain = ac.createGain();
  engineGain.gain.setValueAtTime(0.07, ac.currentTime);

  engineOsc.connect(dist);
  dist.connect(engineGain);
  engineGain.connect(ac.destination);
  engineOsc.start();
}

function updateEngineSound(spd) {
  if (!engineOsc || !audioCtx) return;
  const freq = 70 + spd * 18;
  engineOsc.frequency.setTargetAtTime(freq, audioCtx.currentTime, 0.15);
}

function stopEngineSound() {
  if (!engineGain || !audioCtx) return;
  engineGain.gain.setTargetAtTime(0, audioCtx.currentTime, 0.15);
  setTimeout(() => {
    try { engineOsc && engineOsc.stop(); } catch (_) {}
    engineOsc = null;
    engineGain = null;
  }, 400);
}

// Whoosh when an enemy car passes the player
function playPassSound() {
  const ac = getAudio();
  const osc = ac.createOscillator();
  const gain = ac.createGain();
  const filter = ac.createBiquadFilter();

  osc.type = 'sawtooth';
  osc.frequency.setValueAtTime(500, ac.currentTime);
  osc.frequency.exponentialRampToValueAtTime(120, ac.currentTime + 0.25);

  filter.type = 'bandpass';
  filter.frequency.setValueAtTime(600, ac.currentTime);
  filter.Q.value = 1.5;

  gain.gain.setValueAtTime(0.18, ac.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.001, ac.currentTime + 0.28);

  osc.connect(filter);
  filter.connect(gain);
  gain.connect(ac.destination);
  osc.start();
  osc.stop(ac.currentTime + 0.3);
}

// Crash on collision
function playCrashSound() {
  const ac = getAudio();

  // Noise burst
  const bufLen = Math.floor(ac.sampleRate * 0.6);
  const buf = ac.createBuffer(1, bufLen, ac.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < bufLen; i++) {
    data[i] = (Math.random() * 2 - 1) * Math.exp(-i / (bufLen * 0.12));
  }
  const noise = ac.createBufferSource();
  noise.buffer = buf;

  const nFilter = ac.createBiquadFilter();
  nFilter.type = 'lowpass';
  nFilter.frequency.setValueAtTime(900, ac.currentTime);
  nFilter.frequency.exponentialRampToValueAtTime(150, ac.currentTime + 0.3);

  const nGain = ac.createGain();
  nGain.gain.setValueAtTime(0.6, ac.currentTime);
  nGain.gain.exponentialRampToValueAtTime(0.001, ac.currentTime + 0.55);

  noise.connect(nFilter);
  nFilter.connect(nGain);
  nGain.connect(ac.destination);
  noise.start();

  // Low thud
  const boom = ac.createOscillator();
  boom.type = 'sine';
  boom.frequency.setValueAtTime(110, ac.currentTime);
  boom.frequency.exponentialRampToValueAtTime(28, ac.currentTime + 0.35);

  const bGain = ac.createGain();
  bGain.gain.setValueAtTime(0.5, ac.currentTime);
  bGain.gain.exponentialRampToValueAtTime(0.001, ac.currentTime + 0.4);

  boom.connect(bGain);
  bGain.connect(ac.destination);
  boom.start();
  boom.stop(ac.currentTime + 0.4);
}
// ─────────────────────────────────────────────────────────────────────────────

const W = canvas.width;
const H = canvas.height;

// Road layout
const ROAD_LEFT = 85;
const ROAD_RIGHT = 315;
const ROAD_WIDTH = ROAD_RIGHT - ROAD_LEFT;
const LANE_COUNT = 3;
const LANE_WIDTH = ROAD_WIDTH / LANE_COUNT;

// Car dimensions
const CAR_W = 36;
const CAR_H = 60;

// Colors
const COLORS = {
  road: '#3a3a52',
  roadEdge: '#555570',
  lane: '#fff',
  grass: '#2a4a2a',
  playerBody: '#00d4ff',
  playerGlass: '#003344',
  playerWheel: '#111',
  playerDetail: '#0099cc',
};

// F1 livery colour sets { body, accent, stripe }
const F1_SCHEMES = [
  { body: '#f4f4f4', accent: '#cc001a', stripe: '#00d4ff' },  // player white/red/cyan
  { body: '#e8002d', accent: '#ffffff', stripe: '#ffcc00' },  // Ferrari red
  { body: '#0066cc', accent: '#ffffff', stripe: '#ff6600' },  // Williams blue
  { body: '#1db954', accent: '#000000', stripe: '#ffffff' },  // Jaguar green
  { body: '#ff8700', accent: '#000000', stripe: '#cc0000' },  // McLaren papaya
  { body: '#1b1b2e', accent: '#9b59b6', stripe: '#00e5ff' },  // dark purple
];

// State
let state = 'start'; // 'start' | 'playing' | 'dead'
let score = 0;
let highscore = parseInt(localStorage.getItem('cg_hs') || '0');
let speed = 3;
let frameCount = 0;
let spawnInterval = 90;

document.getElementById('highscore').textContent = highscore;

// Player
const player = {
    x: W / 2 - CAR_W / 2,
    y: H - 70,
  vx: 0,
  speed: 4.5,
  wheelAngle: 0,
  throttle: 1.0,   // 0.3 (braking) … 1.0 (cruise) … 2.2 (boost)
  braking: false,
};

// Skid marks: { x, y, vy, alpha }
const skidMarks = [];

// Race state
const RACE_DURATION   = 60;   // seconds
const TOTAL_OPPONENTS = 9;
let raceStartTime  = 0;
let raceTimeLeft   = RACE_DURATION;
let racePosition   = 10;
let playerDistance = 0;       // total distance player has travelled
let finishLineY    = -9999;   // screen Y of the finish line
let finishActive   = false;
let raceOver       = false;
let victoryFrame   = 0;
let finalPosition  = 10;
const confetti     = [];

// Countdown / race-start state
let countdownStart = 0;
let playerReady    = false;   // true after first ↑ press

// Road markings
const stripes = [];
const STRIPE_H = 40;
const STRIPE_GAP = 50;

for (let i = 0; i < Math.ceil(H / (STRIPE_H + STRIPE_GAP)) + 2; i++) {
  stripes.push({ y: i * (STRIPE_H + STRIPE_GAP) });
}

// Enemies
const enemies = [];

// Input
const keys = {};
document.addEventListener('keydown', e => { keys[e.key] = true; });
document.addEventListener('keyup', e => { keys[e.key] = false; });

// Touch / swipe support
let touchStartX = null, touchStartY = null;
canvas.addEventListener('touchstart', e => {
  touchStartX = e.touches[0].clientX;
  touchStartY = e.touches[0].clientY;
  keys['ArrowUp'] = true;   // any touch = accelerate / launch
  e.preventDefault();
}, { passive: false });
canvas.addEventListener('touchmove', e => {
  if (touchStartX === null) return;
  const dx = e.touches[0].clientX - touchStartX;
  const dy = e.touches[0].clientY - touchStartY;
  if (Math.abs(dx) >= Math.abs(dy)) {
    // Horizontal dominant → steer
    keys['ArrowLeft']  = dx < -12;
    keys['ArrowRight'] = dx >  12;
    keys['ArrowUp']    = true;
    keys['ArrowDown']  = false;
  } else {
    // Vertical dominant → throttle / brake
    keys['ArrowLeft']  = false;
    keys['ArrowRight'] = false;
    keys['ArrowDown']  = dy > 20;
    keys['ArrowUp']    = dy <= 20;
  }
  e.preventDefault();
}, { passive: false });
canvas.addEventListener('touchend', () => {
  keys['ArrowLeft'] = keys['ArrowRight'] = keys['ArrowUp'] = keys['ArrowDown'] = false;
  touchStartX = touchStartY = null;
});

// Buttons
document.getElementById('start-btn').addEventListener('click', startGame);
document.getElementById('restart-btn').addEventListener('click', startGame);

// Restart from victory screen on any key or tap
document.addEventListener('keydown', e => {
  if (state === 'victory' && e.key !== 'F5') startGame();
});
canvas.addEventListener('click', () => {
  if (state === 'victory') startGame();
});

function startGame() {
  score = 0;
  speed = 3;
  frameCount = 0;
  spawnInterval = 90;
  enemies.length = 0;
  skidMarks.length = 0;
  confetti.length = 0;
    player.x = W / 2 - CAR_W / 2;
    player.y = H - 70;
  player.vx = 0;
  player.wheelAngle = 0;
  player.throttle = 1.0;
  player.braking = false;

  // Race reset
  raceStartTime  = performance.now();
  raceTimeLeft   = RACE_DURATION;
  racePosition   = 10;
  playerDistance = 0;
  finishLineY    = -9999;
  finishActive   = false;
  raceOver       = false;
  victoryFrame   = 0;

  // Spawn 9 opponents at staggered positions ahead of player
  const grid = [
    { lane: 1, gap: 90 },  { lane: 0, gap: 90 },  { lane: 2, gap: 90 },
    { lane: 1, gap: 190 }, { lane: 0, gap: 190 }, { lane: 2, gap: 190 },
    { lane: 1, gap: 290 }, { lane: 0, gap: 290 }, { lane: 2, gap: 290 },
  ];
  grid.forEach(({ lane, gap }, i) => {
    const scheme = F1_SCHEMES[1 + (i % (F1_SCHEMES.length - 1))];
    const x = laneX(lane);
    // speedMult: all rivals are fast and competitive (1.25–1.75)
    const speedMult = 1.25 + Math.random() * 0.5;
    enemies.push({
      x, y: player.y - gap, targetX: x, lane,
      color: scheme,
      speedMult,
      worldSpeed:     0,
      effectiveSpeed: 0,          // starts at rest, ramps up after lights out
      launchDelay:    Math.random() * 0.4,  // 0–0.4s stagger (reaction time)
      launchProgress: 0,          // 0→1 over ~1.5s after their launch delay
      distance:       gap,
      wheelAngle: 0, passed: false,
      shiftCooldown: 60 + Math.random() * 80,
    });
  });

  // Reset stripes
  for (let i = 0; i < stripes.length; i++) {
    stripes[i].y = i * (STRIPE_H + STRIPE_GAP);
  }

  document.getElementById('start-screen').classList.add('hidden');
  document.getElementById('game-over-screen').classList.add('hidden');
  document.getElementById('score').textContent = '0';

  playerReady    = false;
  countdownStart = performance.now();
  state = 'countdown';
  startEngineSound();
  requestAnimationFrame(countdownLoop);
}

function laneX(lane) {
  return ROAD_LEFT + lane * LANE_WIDTH + (LANE_WIDTH - CAR_W) / 2;
}

// ─── Start-light countdown ────────────────────────────────────────────────────
const LIGHT_INTERVAL = 0.72; // seconds per light
const LIGHTS_OUT_AT  = 5 * LIGHT_INTERVAL + 0.9; // all out after 5 lights + pause

function drawStartLights(elapsed) {
  const lit     = Math.min(5, Math.floor(elapsed / LIGHT_INTERVAL));
  const allOut  = elapsed >= LIGHTS_OUT_AT;

  const cx = W / 2;
  const cy = 120;
  const r  = 11;
  const sp = 30;

  // Panel
  ctx.save();
  ctx.fillStyle = 'rgba(0,0,0,0.82)';
  ctx.beginPath();
  ctx.roundRect(cx - 90, cy - 28, 180, 56, 10);
  ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.15)';
  ctx.lineWidth = 1;
  ctx.stroke();

  for (let i = 0; i < 5; i++) {
    const x = cx - sp * 2 + i * sp;
    ctx.beginPath();
    ctx.arc(x, cy, r, 0, Math.PI * 2);
    if (allOut) {
      ctx.fillStyle = '#1a0000';
      ctx.shadowBlur = 0;
    } else if (i < lit) {
      ctx.fillStyle = '#ff1a00';
      ctx.shadowColor = '#ff4400';
      ctx.shadowBlur = 18;
    } else {
      ctx.fillStyle = '#2a0000';
      ctx.shadowBlur = 0;
    }
    ctx.fill();
    ctx.shadowBlur = 0;
  }

  if (allOut) {
    ctx.fillStyle = '#00ff55';
    ctx.shadowColor = '#00ff55';
    ctx.shadowBlur = 20;
    ctx.font = 'bold 30px monospace';
    ctx.textAlign = 'center';
    ctx.fillText('GO!', cx, cy + 50);
    ctx.shadowBlur = 0;
  } else if (lit === 0) {
    ctx.fillStyle = 'rgba(255,255,255,0.5)';
    ctx.font = '13px monospace';
    ctx.textAlign = 'center';
    ctx.fillText('GET READY', cx, cy + 42);
  }

  ctx.restore();
}

let countdownLastTime = 0;
function countdownLoop(timestamp) {
  if (state !== 'countdown') return;
  const elapsed = (performance.now() - countdownStart) / 1000;

  ctx.clearRect(0, 0, W, H);
  drawRoad();
  drawEnemies();
  drawPlayer();
  drawStartLights(elapsed);

  if (elapsed >= LIGHTS_OUT_AT + 0.55) {
    // Lights out — go!
    state = 'playing';
    raceStartTime = performance.now();
    lastTime = timestamp;
    requestAnimationFrame(loop);
    return;
  }
  requestAnimationFrame(countdownLoop);
}

function spawnEnemy() {
  const lane = Math.floor(Math.random() * LANE_COUNT);
  const tooClose = enemies.some(e => e.lane === lane && e.y < CAR_H * 2.5);
  if (tooClose) return;

  // Skip scheme index 0 (player livery) for enemies
  const scheme = F1_SCHEMES[1 + Math.floor(Math.random() * (F1_SCHEMES.length - 1))];
  const x = laneX(lane);

  enemies.push({
    x,
    y: -CAR_H,
    lane,
    targetX: x,
    color: scheme,
    speed: speed * (0.7 + Math.random() * 0.6),
    wheelAngle: 0,
    passed: false,
    shiftCooldown: 90 + Math.random() * 120,
  });
}

function drawRoad() {
  // Grass
  ctx.fillStyle = COLORS.grass;
  ctx.fillRect(0, 0, W, H);

  // Road surface
  ctx.fillStyle = COLORS.road;
  ctx.fillRect(ROAD_LEFT, 0, ROAD_WIDTH, H);

  // Road edges
  ctx.fillStyle = COLORS.roadEdge;
  ctx.fillRect(ROAD_LEFT - 4, 0, 4, H);
  ctx.fillRect(ROAD_RIGHT, 0, 4, H);

  // White edge stripes
  ctx.fillStyle = '#fff';
  ctx.fillRect(ROAD_LEFT - 6, 0, 2, H);
  ctx.fillRect(ROAD_RIGHT + 4, 0, 2, H);

  // Dashed lane markers
  ctx.strokeStyle = 'rgba(255,255,255,0.35)';
  ctx.lineWidth = 2;
  ctx.setLineDash([STRIPE_H, STRIPE_GAP]);
  for (let i = 1; i < LANE_COUNT; i++) {
    const lx = ROAD_LEFT + i * LANE_WIDTH;
    ctx.beginPath();
    // Offset by stripe scroll
    const offset = stripes[0].y % (STRIPE_H + STRIPE_GAP);
    ctx.setLineDash([STRIPE_H, STRIPE_GAP]);
    ctx.lineDashOffset = -(offset);
    ctx.moveTo(lx, 0);
    ctx.lineTo(lx, H);
    ctx.stroke();
  }
  ctx.setLineDash([]);
}

// Draw a single wheel centred at (cx, cy), rotated by angle
function drawWheel(cx, cy, ww, wh, angle) {
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(angle);
  ctx.fillRect(-ww / 2, -wh / 2, ww, wh);
  ctx.restore();
}

function drawCar(x, y, w, h, colors, isPlayer, wheelAngle) {
  const r = 6;
  const ww = 8, wh = 14;
  // Wheel centre positions (relative to car origin)
  const frontY  = y + 10 + wh / 2;   // front axle centre
  const rearY   = y + h - 10 - wh / 2; // rear axle centre
  const leftX   = x - ww / 2 + 2;
  const rightX  = x + w - 2 + ww / 2;
  const steer   = isPlayer ? (wheelAngle || 0) : 0;

  // ── Rear wheels (straight) ──
  ctx.fillStyle = COLORS.playerWheel;
  drawWheel(leftX,  rearY, ww, wh, 0);
  drawWheel(rightX, rearY, ww, wh, 0);

  // ── Body ──
  ctx.fillStyle = colors.body;
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
  ctx.fill();

  // Detail stripe
  ctx.fillStyle = colors.detail;
  ctx.fillRect(x + 4, y + h * 0.35, w - 8, 4);

  // Windshield
  ctx.fillStyle = colors.glass;
  if (isPlayer) {
    ctx.beginPath();
    ctx.roundRect(x + 5, y + 8, w - 10, h * 0.28, 4);
    ctx.fill();
  } else {
    ctx.beginPath();
    ctx.roundRect(x + 5, y + h * 0.1, w - 10, h * 0.28, 4);
    ctx.fill();
  }

  // ── Front wheels (steered) drawn on top of body edges ──
  ctx.fillStyle = COLORS.playerWheel;
  drawWheel(leftX,  frontY, ww, wh, steer);
  drawWheel(rightX, frontY, ww, wh, steer);

  // Headlights / taillights
  if (isPlayer) {
    ctx.fillStyle = '#ffffaa';
    ctx.fillRect(x + 4, y + 4, 8, 5);
    ctx.fillRect(x + w - 12, y + 4, 8, 5);
    ctx.fillStyle = '#ff4444';
    ctx.fillRect(x + 4, y + h - 8, 8, 5);
    ctx.fillRect(x + w - 12, y + h - 8, 8, 5);
  } else {
    ctx.fillStyle = '#ffffaa';
    ctx.fillRect(x + 4, y + h - 9, 8, 5);
    ctx.fillRect(x + w - 12, y + h - 9, 8, 5);
    ctx.fillStyle = '#ff4444';
    ctx.fillRect(x + 4, y + 4, 8, 5);
    ctx.fillRect(x + w - 12, y + 4, 8, 5);
  }
}

function drawSkidMarks() {
  for (const m of skidMarks) {
    ctx.fillStyle = `rgba(15, 10, 5, ${m.alpha})`;
    ctx.fillRect(m.x - 1.5, m.y - 5, 3, 10);  // narrow centered streak under tire
  }
}

// ── Shared F1 geometry (nose at -y, rear at +y; flip with ctx.scale for enemy) ─
function _drawF1Core(C, wa) {
  const dark    = '#001e30';
  const tire    = '#181818';
  const rim     = '#363636';
  const cockpit = '#050f18';

  function box(x, y, w, h, r) {
    ctx.beginPath(); ctx.roundRect(x, y, w, h, r ?? 2); ctx.fill();
  }

  // ── Rear wing ──────────────────────────────────────────────
  ctx.fillStyle = C.accent;
  box(-21, 34, 42, 5, 1);
  box(-22, 29, 4, 14, 1);
  box( 18, 29, 4, 14, 1);
  ctx.fillStyle = C.body;
  box(-19, 30, 38, 6, 1);
  ctx.fillStyle = C.accent;
  box(-19, 30, 38, 2, 0);

  // ── Rear tires ─────────────────────────────────────────────
  for (const sx of [-1, 1]) {
    ctx.save(); ctx.translate(sx * 17, 27);
    ctx.fillStyle = tire;  box(-5.5, -10, 11, 20, 3);
    ctx.fillStyle = rim;   box(-3.5,  -6.5, 7, 13, 2);
    ctx.strokeStyle = 'rgba(90,90,90,0.5)'; ctx.lineWidth = 0.6;
    ctx.beginPath(); ctx.arc(0, 0, 4.5, 0, Math.PI * 2); ctx.stroke();
    ctx.restore();
  }

  // ── Body shadow ────────────────────────────────────────────
  ctx.fillStyle = 'rgba(0,0,0,0.2)';
  ctx.beginPath();
  ctx.moveTo( 1,-41); ctx.bezierCurveTo( 3,-32,  9,-22, 10,-11);
  ctx.bezierCurveTo(13, -3, 13,  7, 12, 18);
  ctx.lineTo(10,39); ctx.lineTo(-8,39); ctx.lineTo(-10,18);
  ctx.bezierCurveTo(-11, 7,-11, -3, -8,-11);
  ctx.bezierCurveTo(-7,-22, -1,-32,  1,-41);
  ctx.closePath(); ctx.fill();

  // ── Body ───────────────────────────────────────────────────
  ctx.fillStyle = C.body;
  ctx.beginPath();
  ctx.moveTo( 0,-42); ctx.bezierCurveTo( 2,-34,  8,-22,  9,-11);
  ctx.bezierCurveTo(11, -3, 12,  6, 10, 18);
  ctx.lineTo(9,38); ctx.lineTo(-9,38); ctx.lineTo(-10,18);
  ctx.bezierCurveTo(-12,  6,-11, -3, -9,-11);
  ctx.bezierCurveTo(-8,-22, -2,-34,  0,-42);
  ctx.closePath(); ctx.fill();

  // Nose arrow
  ctx.fillStyle = C.accent;
  ctx.beginPath();
  ctx.moveTo(0,-42); ctx.lineTo(5,-17); ctx.lineTo(-5,-17);
  ctx.closePath(); ctx.fill();

  // Sidepod livery
  ctx.fillStyle = C.accent;
  for (const sx of [-1, 1]) {
    ctx.beginPath();
    ctx.moveTo(sx*9,38); ctx.lineTo(sx*10,18);
    ctx.bezierCurveTo(sx*12,7, sx*11,-2, sx*9,-6);
    ctx.lineTo(sx*7,-6); ctx.lineTo(sx*7,38);
    ctx.closePath(); ctx.fill();
  }

  // Centre identity stripe
  ctx.fillStyle = C.stripe;
  ctx.globalAlpha = 0.45;
  box(-1.5,-17, 3, 53);
  ctx.globalAlpha = 1;

  // Air intakes
  ctx.fillStyle = 'rgba(0,0,0,0.3)';
  ctx.beginPath(); ctx.ellipse(-8.5,-1, 2,4.5,  0.2, 0, Math.PI*2); ctx.fill();
  ctx.beginPath(); ctx.ellipse( 8.5,-1, 2,4.5, -0.2, 0, Math.PI*2); ctx.fill();

  // Roll hoop
  ctx.fillStyle = dark;   box(-2.5,-20, 5,9, 1);
  ctx.fillStyle = C.accent; box(-2,-21.5, 4,3, 1);

  // Cockpit
  ctx.fillStyle = dark;
  ctx.beginPath(); ctx.ellipse(0,2, 7,11, 0,0, Math.PI*2); ctx.fill();
  ctx.fillStyle = cockpit;
  ctx.beginPath(); ctx.ellipse(0,2, 5.5,9.5, 0,0, Math.PI*2); ctx.fill();
  ctx.fillStyle = '#08192a';
  ctx.beginPath(); ctx.ellipse(0,4, 3.5,7, 0,0, Math.PI*2); ctx.fill();

  // Helmet
  ctx.fillStyle = '#bb2200';
  ctx.beginPath(); ctx.arc(0,-1.5, 4,0, Math.PI*2); ctx.fill();
  ctx.fillStyle = '#ee4400';
  ctx.beginPath(); ctx.arc(-0.5,-2.3, 2.2,0, Math.PI*2); ctx.fill();
  ctx.fillStyle = 'rgba(0,210,255,0.75)';
  ctx.beginPath(); ctx.ellipse(0.2,-1, 2.6,1.5,-0.15,0, Math.PI*2); ctx.fill();

  // Suspension arms
  ctx.strokeStyle = 'rgba(0,0,0,0.5)'; ctx.lineWidth = 1.2; ctx.setLineDash([]);
  ctx.beginPath();
  ctx.moveTo(-7,-14); ctx.lineTo(-14,-26);
  ctx.moveTo( 7,-14); ctx.lineTo( 14,-26);
  ctx.moveTo(-9, 12); ctx.lineTo(-17, 20);
  ctx.moveTo( 9, 12); ctx.lineTo( 17, 20);
  ctx.stroke();

  // Front tires (steerable)
  for (const sx of [-1, 1]) {
    ctx.save(); ctx.translate(sx*14,-26); ctx.rotate(wa||0);
    ctx.fillStyle = tire;  box(-4.5,-8, 9,16, 3);
    ctx.fillStyle = rim;   box(-2.5,-5.5, 5,11, 2);
    ctx.strokeStyle = 'rgba(90,90,90,0.5)'; ctx.lineWidth = 0.6;
    ctx.beginPath(); ctx.arc(0,0, 3.5,0, Math.PI*2); ctx.stroke();
    ctx.restore();
  }

  // Front wing
  ctx.fillStyle = C.accent;
  box(-22,-42, 4,12, 1); box(18,-42, 4,12, 1);
  ctx.fillStyle = C.body;
  box(-21,-43, 42,5, 1);
  ctx.fillStyle = C.accent;
  box(-20,-46, 40,4, 1);
  ctx.fillStyle = C.stripe;
  ctx.globalAlpha = 0.65;
  box(-6,-42, 12,4, 1);
  ctx.globalAlpha = 1;
}
// ─────────────────────────────────────────────────────────────────────────────

function drawF1PlayerCar(px, py, wa) {
  const cx = Math.round(px + CAR_W / 2);
  const cy = Math.round(py + CAR_H / 2);
  ctx.save();
  ctx.translate(cx, cy);
  _drawF1Core({ body:'#f4f4f4', accent:'#cc001a', stripe:'#00d4ff' }, wa);
  ctx.restore();
}

function drawF1EnemyCar(px, py, wa, colors) {
  const cx = Math.round(px + CAR_W / 2);
  const cy = Math.round(py + CAR_H / 2);
  ctx.save();
  ctx.translate(cx, cy);
  _drawF1Core(colors, wa);
  ctx.restore();
}

function drawBrakeLights(px, py) {
  const cx = px + CAR_W / 2;
  const cy = py + CAR_H / 2;
  // Pulse: gentle sine wave so light throbs while braking
  const pulse = 0.6 + 0.4 * Math.sin(frameCount * 0.45);

  ctx.save();
  ctx.shadowColor = '#ff1100';
  ctx.shadowBlur  = 20 * pulse;

  // Central F1 brake light on rear wing
  ctx.fillStyle = `rgba(255, 20, 0, ${pulse})`;
  ctx.beginPath(); ctx.ellipse(cx, cy + 36, 5, 3.5, 0, 0, Math.PI * 2); ctx.fill();

  // Two smaller wing-tip lights
  ctx.fillStyle = `rgba(255, 0, 0, ${0.75 * pulse})`;
  ctx.beginPath(); ctx.ellipse(cx - 11, cy + 34, 3.5, 2.5, 0, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.ellipse(cx + 11, cy + 34, 3.5, 2.5, 0, 0, Math.PI * 2); ctx.fill();

  ctx.restore();
}

function drawPlayer() {
  drawF1PlayerCar(Math.round(player.x), Math.round(player.y), player.wheelAngle);
  if (player.braking) drawBrakeLights(Math.round(player.x), Math.round(player.y));
}

function drawEnemies() {
  for (const e of enemies) {
    if (e.y < -CAR_H * 2 || e.y > H + CAR_H * 2) continue; // off-screen, skip draw
    drawF1EnemyCar(Math.round(e.x), Math.round(e.y), e.wheelAngle, e.color);
  }
}

function drawScore() {
  document.getElementById('score').textContent = score;
  document.getElementById('highscore').textContent = highscore;
}

function checkCollision() {
  const cx = player.x + CAR_W / 2;
  const cy = player.y + CAR_H / 2;

  // Three hitboxes matching the actual F1 car shape:
  //  1. Main body  — narrow, full nose-to-rear length
  //  2. Front wing — wide, shallow (at nose)
  //  3. Rear wing  — wide, shallow (at tail)
  const hitboxes = [
    { x: cx - 9,  y: cy - 40, w: 18, h: 78 },
    { x: cx - 21, y: cy - 46, w: 42, h: 8  },
    { x: cx - 21, y: cy + 29, w: 42, h: 9  },
  ];

  for (const e of enemies) {
    // Enemy body + tires: wheels protrude ~6px on each side (ww=8, offset=2)
    const ex = e.x - 5;
    const ey = e.y + 8;
    const ew = CAR_W + 10;   // 46px — covers body + both tire protrusions
    const eh = CAR_H - 14;

    for (const hb of hitboxes) {
      if (hb.x < ex + ew && hb.x + hb.w > ex &&
          hb.y < ey + eh && hb.y + hb.h > ey) {
        return true;
      }
    }
  }
  return false;
}

function gameOver() {
  state = 'dead';
  stopEngineSound();
  playCrashSound();
  const newBest = score > highscore;
  if (newBest) {
    highscore = score;
    localStorage.setItem('cg_hs', highscore);
  }
  document.getElementById('final-score').textContent = `P${racePosition}`;
  document.getElementById('new-best').classList.toggle('hidden', !newBest);
  document.getElementById('game-over-screen').classList.remove('hidden');
}

let lastTime = 0;

function loop(timestamp) {
  if (state !== 'playing') return;

  const dt = Math.min((timestamp - lastTime) / 16.67, 3); // normalized to ~60fps
  lastTime = timestamp;

  frameCount++;

  // Increase difficulty over time
  score = Math.floor(frameCount / 3);
  speed = 3 + score * 0.005;
  spawnInterval = Math.max(35, 90 - score * 0.1);

  // No auto-spawn — fixed 9-car field for the race

  // Accumulate player race distance
  playerDistance += speed * player.throttle * dt;

  // Update road stripes — throttle makes road rush past faster / slower
  for (const s of stripes) {
    s.y += speed * player.throttle * dt;
    if (s.y > H + STRIPE_GAP) {
      s.y -= (STRIPE_H + STRIPE_GAP) * stripes.length;
    }
  }

  // Race clock & finish line
  raceTimeLeft = Math.max(0, RACE_DURATION - (performance.now() - raceStartTime) / 1000);
  const secs = Math.ceil(raceTimeLeft);
  document.getElementById('race-time').textContent =
    `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}`;

  // Spawn finish line 10 s before time runs out
  if (!finishActive && raceTimeLeft <= 10) {
    finishActive = true;
    finishLineY  = -80;  // just above screen top
  }
  if (finishActive) {
    finishLineY += speed * player.throttle * dt;
    // Player crossed finish line
    if (!raceOver && finishLineY > player.y + CAR_H / 2) {
      raceOver = true;
      finalPosition = racePosition;
      stopEngineSound();
      spawnConfetti();
      state = 'victory';
      requestAnimationFrame(victoryLoop);
      return;
    }
  }
  // Time ran out without crossing — finish at current position
  if (!raceOver && raceTimeLeft <= 0) {
    raceOver = true;
    finalPosition = racePosition;
    stopEngineSound();
    spawnConfetti();
    state = 'victory';
    requestAnimationFrame(victoryLoop);
    return;
  }

  // ── Rival AI ─────────────────────────────────────────────────────────────
  for (let i = 0; i < enemies.length; i++) {
    const e = enemies[i];

    // 0. Keep worldSpeed in sync. During race-start, ramp effectiveSpeed from 0→worldSpeed
    e.worldSpeed = speed * e.speedMult;
    if (e.launchProgress < 1) {
      e.launchDelay -= dt * 0.016; // convert dt units to seconds
      if (e.launchDelay <= 0) {
        e.launchProgress = Math.min(1, e.launchProgress + dt * 0.022); // ~1.5s ramp
        e.effectiveSpeed = e.worldSpeed * e.launchProgress;
      }
      // skip blocking/overtake AI during launch phase
      e.y += (speed * player.throttle - e.effectiveSpeed) * dt;
      e.distance += e.effectiveSpeed * dt;
      e.x += (e.targetX - e.x) * 0.1;
      continue;
    }

    // 1. Look for a rival directly ahead in the same path (blocking zone)
    let minGap = Infinity;
    let blocked = false;
    for (let j = 0; j < enemies.length; j++) {
      if (j === i) continue;
      const o = enemies[j];
      const lateralClose = Math.abs(o.x - e.x) < CAR_W + 10;
      const ahead        = o.y < e.y;                  // higher on screen = further ahead
      const gap          = e.y - o.y;
      if (lateralClose && ahead && gap < 140) {
        blocked = true;
        minGap  = Math.min(minGap, gap);
      }
    }

    // 2. Speed control — brake when blocked, recover when clear
    if (blocked) {
      const targetSpeed = e.worldSpeed * Math.max(0.1, (minGap - CAR_H) / 70);
      e.effectiveSpeed  = Math.max(0, e.effectiveSpeed - e.worldSpeed * 0.04 * dt);
      e.effectiveSpeed  = Math.max(e.effectiveSpeed, targetSpeed);
    } else {
      // Accelerate back — slight boost when pulling clear (slingshot)
      e.effectiveSpeed = Math.min(e.worldSpeed * 1.08, e.effectiveSpeed + e.worldSpeed * 0.035 * dt);
    }

    // 3. Overtake maneuver — change lane when blocked and gap is tight
    e.shiftCooldown -= dt;
    if (blocked && minGap < 100 && e.shiftCooldown <= 0) {
      const freeLanes = [0, 1, 2].filter(lane => {
        if (lane === e.lane) return false;
        // Lane is free if no other rival is close at this y-position
        return !enemies.some((o, j) => j !== i &&
          Math.abs(laneX(lane) - o.x) < LANE_WIDTH * 0.55 &&
          Math.abs(o.y - e.y) < 110);
      });
      if (freeLanes.length > 0) {
        e.lane      = freeLanes[Math.floor(Math.random() * freeLanes.length)];
        e.targetX   = laneX(e.lane);
        e.shiftCooldown = 35 + Math.random() * 45;
      } else {
        e.shiftCooldown = 20; // retry soon
      }
    }

    // 5. Move along track — screen speed = player road − rival world speed
    // --- Prevent AI from ever hitting player from behind ---
    let safeEffectiveSpeed = e.effectiveSpeed;
    const playerAhead = player.y < e.y;
    const sameLane = Math.abs(e.x - player.x) < LANE_WIDTH * 0.55;
    const verticalGap = e.y - player.y;
    let behindPlayer = false;
    if (playerAhead && sameLane && verticalGap < CAR_H * 1.2 && verticalGap > 0) {
      // If approaching player from behind in same lane, always shift lane if possible
      behindPlayer = true;
      const freeLanes = [0, 1, 2].filter(lane => {
        if (lane === e.lane) return false;
        // Lane is free if no other rival or player is close at this y-position
        const hasRival = enemies.some((o, j) => j !== i && Math.abs(laneX(lane) - o.x) < LANE_WIDTH * 0.55 && Math.abs(o.y - e.y) < 110);
        const hasPlayer = Math.abs(laneX(lane) - player.x) < LANE_WIDTH * 0.55 && Math.abs(player.y - e.y) < 110;
        return !hasRival && !hasPlayer;
      });
      if (freeLanes.length > 0) {
        // Always shift immediately to a free lane
        e.lane = freeLanes[Math.floor(Math.random() * freeLanes.length)];
        e.targetX = laneX(e.lane);
        // Reset shiftCooldown to avoid rapid oscillation
        e.shiftCooldown = 35 + Math.random() * 45;
      } else {
        // No lane available, slow down to avoid collision
        safeEffectiveSpeed = Math.min(safeEffectiveSpeed, (verticalGap - CAR_H * 0.7) * 0.7);
      }
    }

    // 4. Lateral slide toward target lane — make it faster when behind player
    const dx   = e.targetX - e.x;
    const maxLateralSpeed = behindPlayer ? 7.5 * dt : 3.5 * dt;  // 2x faster escape when behind player
    const step = Math.min(Math.abs(dx), maxLateralSpeed) * Math.sign(dx);
    e.x += step;
    e.wheelAngle += (Math.max(-0.48, Math.min(0.48, dx * 0.08)) - e.wheelAngle) * 0.22;
    e.y += (speed * player.throttle - safeEffectiveSpeed) * dt;

    // Accumulate rival's absolute race distance
    e.distance += safeEffectiveSpeed * dt;

    // 6. Whoosh when rival passes player
    if (!e.passed && e.y > player.y + CAR_H) {
      e.passed = true;
      playPassSound();
    }
    // 7. Remove only if very far off the top (rival far ahead — effectively lapped player)
    //    Do NOT remove cars that fall off the bottom; they're just behind you in the race
    if (e.y < -H * 2) enemies.splice(i, 1);
  }

  // ── Lateral separation — push overlapping rivals apart ────────────────────
  for (let i = 0; i < enemies.length; i++) {
    for (let j = i + 1; j < enemies.length; j++) {
      const a = enemies[i], b = enemies[j];
      if (Math.abs(b.y - a.y) > CAR_H * 1.4) continue; // too far apart vertically
      const dx      = b.x - a.x;
      const overlap = (CAR_W + 8) - Math.abs(dx);
      if (overlap > 0 && Math.abs(dx) > 0) {
        const push = overlap * 0.55 * (dx > 0 ? 1 : -1);
        a.x -= push * 0.5;
        b.x += push * 0.5;
        a.x = Math.max(ROAD_LEFT + 2, Math.min(ROAD_RIGHT - CAR_W - 2, a.x));
        b.x = Math.max(ROAD_LEFT + 2, Math.min(ROAD_RIGHT - CAR_W - 2, b.x));
        // Update target lanes to match pushed positions
        a.targetX = a.x;
        b.targetX = b.x;
      }
    }
  }

  // Race position = 1 + rivals who have travelled more distance than player
  racePosition = 1 + enemies.filter(e => e.distance > playerDistance).length;
  racePosition = Math.max(1, Math.min(10, racePosition));
  document.getElementById('race-pos').textContent = `P${racePosition}/10`;

  updateEngineSound(speed * player.throttle);

  // Detect first ↑ press to release player from grid
  if (!playerReady && (keys['ArrowUp'] || keys['w'] || keys['W'])) {
    playerReady = true;
  }

  // Player input — left/right steer
  const moveSpeed = player.speed * dt;
  if (keys['ArrowLeft'] || keys['a'] || keys['A']) {
    player.vx = -moveSpeed;
  } else if (keys['ArrowRight'] || keys['d'] || keys['D']) {
    player.vx = moveSpeed;
  } else {
    player.vx *= 0.75;
  }

  // Up = accelerate, Down = brake — locked until playerReady
  if (!playerReady) {
    player.throttle = 0;
    player.braking  = false;
  } else if (keys['ArrowUp'] || keys['w'] || keys['W']) {
    player.throttle = Math.min(2.2, player.throttle + 0.05 * dt);
  } else if (keys['ArrowDown'] || keys['s'] || keys['S']) {
    player.throttle = Math.max(0.25, player.throttle - 0.08 * dt);
  } else {
    player.throttle += (1.0 - player.throttle) * 0.04 * dt; // drift back to cruise
  }
  player.braking = playerReady && (keys['ArrowDown'] || keys['s'] || keys['S']);

  player.x += player.vx;
  player.x = Math.max(ROAD_LEFT + 2, Math.min(ROAD_RIGHT - CAR_W - 2, player.x));

  // Smooth wheel steer angle (max ±0.52 rad ≈ 30°) — snappier so it's clearly visible
  const targetAngle = Math.max(-0.52, Math.min(0.52, player.vx / player.speed * 0.52));
  player.wheelAngle += (targetAngle - player.wheelAngle) * 0.28;

  // Drag marks under front tires while turning.
  // Marks are stamped at tire position and scroll downward with the road
  // so they look embedded in the tarmac behind the car.
  if (Math.abs(player.vx) > 1.4 && frameCount % 2 === 0) {
    const frontY = player.y + CAR_H / 2 - 26;
    const lx = player.x + CAR_W / 2 - 14;
    const rx = player.x + CAR_W / 2 + 14;
    skidMarks.push({ x: lx, y: frontY, vy: speed * player.throttle, alpha: 0.65 });
    skidMarks.push({ x: rx, y: frontY, vy: speed * player.throttle, alpha: 0.65 });
  }

  // Scroll & fade marks — vy matches road speed so marks stay on the tarmac
  for (let i = skidMarks.length - 1; i >= 0; i--) {
    skidMarks[i].y     += skidMarks[i].vy * dt;
    skidMarks[i].alpha -= 0.012;
    if (skidMarks[i].alpha <= 0 || skidMarks[i].y > H + 20) skidMarks.splice(i, 1);
  }

  // Collision
  if (checkCollision()) {
    gameOver();
    return;
  }

  // Draw
  ctx.clearRect(0, 0, W, H);
  drawRoad();
  if (finishActive) drawFinishLine(finishLineY);
  drawSkidMarks();
  drawEnemies();
  drawPlayer();
  drawScore();

  // "Press ↑" hint while waiting for player launch
  if (!playerReady) {
    const pulse = 0.6 + 0.4 * Math.sin(Date.now() / 220);
    ctx.save();
    ctx.globalAlpha = pulse;
    ctx.fillStyle = '#ffd700';
    ctx.shadowColor = '#ffd700';
    ctx.shadowBlur = 12;
    ctx.font = 'bold 15px monospace';
    ctx.textAlign = 'center';
    ctx.fillText('PRESS ↑ TO GO!', W / 2, player.y + CAR_H + 22);
    ctx.restore();
  }

  requestAnimationFrame(loop);
}

// ── Victory loop ─────────────────────────────────────────────────────────────
function victoryLoop() {
  if (state !== 'victory') return;
  victoryFrame++;
  ctx.clearRect(0, 0, W, H);
  drawRoad();
  drawVictoryScene();
  requestAnimationFrame(victoryLoop);
}

// ── Finish line ───────────────────────────────────────────────────────────────
function drawFinishLine(fy) {
  const sq = 18;
  const cols = Math.floor((ROAD_RIGHT - ROAD_LEFT) / sq);
  const rows = 3;
  for (let c = 0; c < cols; c++) {
    for (let r = 0; r < rows; r++) {
      ctx.fillStyle = (c + r) % 2 === 0 ? '#ffffff' : '#000000';
      ctx.fillRect(ROAD_LEFT + c * sq, fy + r * sq - sq * rows, sq, sq);
    }
  }
  // Glow
  ctx.save();
  ctx.shadowColor = '#ffffff';
  ctx.shadowBlur = 14;
  ctx.strokeStyle = 'rgba(255,255,255,0.6)';
  ctx.lineWidth = 2;
  ctx.strokeRect(ROAD_LEFT, fy - sq * rows, ROAD_RIGHT - ROAD_LEFT, sq * rows);
  ctx.restore();
}

// ── Confetti ──────────────────────────────────────────────────────────────────
function spawnConfetti() {
  const colors = ['#FFD700','#ff4444','#00d4ff','#44ff88','#ff88ff','#ffffff'];
  for (let i = 0; i < 100; i++) {
    confetti.push({
      x: Math.random() * W, y: -10 - Math.random() * H * 0.5,
      vx: (Math.random() - 0.5) * 2.5,
      vy: 1.5 + Math.random() * 3,
      color: colors[Math.floor(Math.random() * colors.length)],
      w: 6 + Math.random() * 6, h: 3 + Math.random() * 4,
      angle: Math.random() * Math.PI,
      va: (Math.random() - 0.5) * 0.18,
    });
  }
}

// ── Trophy ────────────────────────────────────────────────────────────────────
function drawTrophy(x, y) {
  const bounce = Math.sin(victoryFrame * 0.05) * 7;
  ctx.save();
  ctx.translate(x, y + bounce);

  // Glow
  ctx.shadowColor = '#FFD700'; ctx.shadowBlur = 30;

  // Cup body
  ctx.fillStyle = '#FFD700';
  ctx.beginPath();
  ctx.moveTo(-30, -50); ctx.lineTo(30, -50);
  ctx.lineTo(22, 5);    ctx.lineTo(10, 5);
  ctx.lineTo(10, 18);   ctx.lineTo(22, 18);
  ctx.lineTo(22, 28);   ctx.lineTo(-22, 28);
  ctx.lineTo(-22, 18);  ctx.lineTo(-10, 18);
  ctx.lineTo(-10, 5);   ctx.lineTo(-22, 5);
  ctx.closePath(); ctx.fill();

  // Shine
  ctx.fillStyle = 'rgba(255,255,220,0.35)';
  ctx.beginPath();
  ctx.moveTo(-18, -48); ctx.lineTo(-5, -48); ctx.lineTo(-10, 0); ctx.lineTo(-22, 0);
  ctx.closePath(); ctx.fill();

  // Handles
  ctx.strokeStyle = '#FFD700'; ctx.lineWidth = 5; ctx.shadowBlur = 20;
  ctx.beginPath(); ctx.arc(-38, -22, 14, Math.PI * 0.6, Math.PI * 1.4, false); ctx.stroke();
  ctx.beginPath(); ctx.arc( 38, -22, 14, Math.PI * 1.6, Math.PI * 0.4, false); ctx.stroke();

  // Star on cup
  ctx.fillStyle = '#fff7aa'; ctx.shadowBlur = 0;
  ctx.font = 'bold 18px sans-serif'; ctx.textAlign = 'center';
  ctx.fillText('★', 0, -22);

  ctx.restore();
}

// ── Waving checkered flag ─────────────────────────────────────────────────────
function drawWavingFlag(x, y) {
  ctx.save(); ctx.translate(x, y);

  // Pole
  ctx.strokeStyle = '#aaaaaa'; ctx.lineWidth = 3;
  ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(0, -90); ctx.stroke();

  // Waving flag (4×3 checker squares)
  const sqW = 13, sqH = 12, cols = 4, rows = 3;
  for (let c = 0; c < cols; c++) {
    const wave = Math.sin(c * 1.1 + victoryFrame * 0.1) * 5;
    for (let r = 0; r < rows; r++) {
      ctx.fillStyle = (c + r) % 2 === 0 ? '#ffffff' : '#000000';
      ctx.fillRect(c * sqW, -90 + r * sqH + wave, sqW, sqH);
    }
  }
  ctx.restore();
}

// ── Full victory scene ────────────────────────────────────────────────────────
function drawVictoryScene() {
  // Update & draw confetti
  ctx.save();
  for (const p of confetti) {
    p.x += p.vx; p.y += p.vy; p.angle += p.va;
    if (p.y > H + 20) { p.y = -10; p.x = Math.random() * W; }
    ctx.save();
    ctx.translate(p.x, p.y); ctx.rotate(p.angle);
    ctx.fillStyle = p.color;
    ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
    ctx.restore();
  }
  ctx.restore();

  // Dark panel
  ctx.fillStyle = 'rgba(5, 8, 20, 0.82)';
  ctx.beginPath(); ctx.roundRect(W / 2 - 145, H / 2 - 165, 290, 310, 18); ctx.fill();

  // Gold border
  ctx.strokeStyle = '#FFD700'; ctx.lineWidth = 2;
  ctx.shadowColor = '#FFD700'; ctx.shadowBlur = 12;
  ctx.beginPath(); ctx.roundRect(W / 2 - 145, H / 2 - 165, 290, 310, 18); ctx.stroke();
  ctx.shadowBlur = 0;

  // Trophy + flag
  drawTrophy(W / 2 - 55, H / 2 - 70);
  drawWavingFlag(W / 2 + 60, H / 2 - 40);

  // Position banner
  const posText  = finalPosition === 1 ? 'RACE WINNER!' : `FINISHED P${finalPosition}`;
  const posColor = finalPosition === 1 ? '#FFD700' : '#ffffff';
  ctx.fillStyle = posColor;
  ctx.shadowColor = posColor; ctx.shadowBlur = 16;
  ctx.font = `bold ${finalPosition === 1 ? 30 : 24}px sans-serif`;
  ctx.textAlign = 'center';
  ctx.fillText(posText, W / 2, H / 2 + 80);
  ctx.shadowBlur = 0;

  // Sub text
  ctx.fillStyle = 'rgba(255,255,255,0.7)';
  ctx.font = '15px sans-serif';
  ctx.fillText(finalPosition === 1 ? '🏆 Podium Finish!' : 'Back on track!', W / 2, H / 2 + 108);

  // Replay button hint
  ctx.fillStyle = 'rgba(255,255,255,0.5)';
  ctx.font = '13px sans-serif';
  ctx.fillText('Tap / press any key to race again', W / 2, H / 2 + 138);
}

// ── Initial draw of start screen background ───────────────────────────────────
(function initDraw() {
  ctx.clearRect(0, 0, W, H);
  drawRoad();
  drawF1PlayerCar(W / 2 - CAR_W / 2, H - 120, 0);
})();
