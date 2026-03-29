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
  y: H - 120,
  vx: 0,
  speed: 4.5,
  wheelAngle: 0,  // current front-wheel steer angle (radians)
};

// Skid marks: { x, y, alpha }
const skidMarks = [];

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
let touchStartX = null;
canvas.addEventListener('touchstart', e => {
  touchStartX = e.touches[0].clientX;
  e.preventDefault();
}, { passive: false });
canvas.addEventListener('touchmove', e => {
  if (touchStartX === null) return;
  const dx = e.touches[0].clientX - touchStartX;
  if (dx > 10) { keys['ArrowRight'] = true; keys['ArrowLeft'] = false; }
  else if (dx < -10) { keys['ArrowLeft'] = true; keys['ArrowRight'] = false; }
  e.preventDefault();
}, { passive: false });
canvas.addEventListener('touchend', () => {
  keys['ArrowLeft'] = false;
  keys['ArrowRight'] = false;
  touchStartX = null;
});

// Buttons
document.getElementById('start-btn').addEventListener('click', startGame);
document.getElementById('restart-btn').addEventListener('click', startGame);

function startGame() {
  score = 0;
  speed = 3;
  frameCount = 0;
  spawnInterval = 90;
  enemies.length = 0;
  skidMarks.length = 0;
  player.x = W / 2 - CAR_W / 2;
  player.vx = 0;
  player.wheelAngle = 0;

  // Reset stripes
  for (let i = 0; i < stripes.length; i++) {
    stripes[i].y = i * (STRIPE_H + STRIPE_GAP);
  }

  document.getElementById('start-screen').classList.add('hidden');
  document.getElementById('game-over-screen').classList.add('hidden');
  document.getElementById('score').textContent = '0';

  state = 'playing';
  startEngineSound();
  requestAnimationFrame(loop);
}

function laneX(lane) {
  return ROAD_LEFT + lane * LANE_WIDTH + (LANE_WIDTH - CAR_W) / 2;
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

function drawPlayer() {
  drawF1PlayerCar(Math.round(player.x), Math.round(player.y), player.wheelAngle);
}

function drawEnemies() {
  for (const e of enemies) {
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
  document.getElementById('final-score').textContent = score;
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

  // Spawn enemies
  if (frameCount % Math.round(spawnInterval) === 0) {
    spawnEnemy();
  }

  // Update road stripes (visual only)
  for (const s of stripes) {
    s.y += speed * dt;
    if (s.y > H + STRIPE_GAP) {
      s.y -= (STRIPE_H + STRIPE_GAP) * stripes.length;
    }
  }

  // Update enemies
  for (let i = enemies.length - 1; i >= 0; i--) {
    const e = enemies[i];
    e.y += e.speed * dt;

    // ── Lane-shift AI (activates progressively after score 200) ──
    if (score > 200 && e.y > 0 && e.y < H - CAR_H) {
      e.shiftCooldown -= dt;
      if (e.shiftCooldown <= 0) {
        const others = [0, 1, 2].filter(l => l !== e.lane);
        e.lane   = others[Math.floor(Math.random() * 2)];
        e.targetX = laneX(e.lane);
        // Gets more aggressive with score
        const aggression = Math.min(score / 800, 1);
        e.shiftCooldown = Math.max(30, 110 - aggression * 70) + Math.random() * 50;
      }
      // Slide smoothly toward target lane
      const dx   = e.targetX - e.x;
      const step = Math.min(Math.abs(dx), (2 + score * 0.003) * dt) * Math.sign(dx);
      e.x += step;
      // Wheel angle follows lateral motion
      e.wheelAngle += (Math.max(-0.45, Math.min(0.45, dx * 0.07)) - e.wheelAngle) * 0.2;
    }

    // Whoosh when enemy passes player
    if (!e.passed && e.y > player.y + CAR_H) {
      e.passed = true;
      playPassSound();
    }
    if (e.y > H + CAR_H) {
      enemies.splice(i, 1);
    }
  }

  updateEngineSound(speed);

  // Player input
  const moveSpeed = player.speed * dt;
  if (keys['ArrowLeft'] || keys['a'] || keys['A']) {
    player.vx = -moveSpeed;
  } else if (keys['ArrowRight'] || keys['d'] || keys['D']) {
    player.vx = moveSpeed;
  } else {
    player.vx *= 0.75;
  }

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
    skidMarks.push({ x: lx, y: frontY, vy: speed, alpha: 0.65 });
    skidMarks.push({ x: rx, y: frontY, vy: speed, alpha: 0.65 });
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
  drawSkidMarks();
  drawEnemies();
  drawPlayer();
  drawScore();

  requestAnimationFrame(loop);
}

// Initial draw of start screen background
(function initDraw() {
  ctx.clearRect(0, 0, W, H);
  drawRoad();
  drawF1PlayerCar(W / 2 - CAR_W / 2, H - 120, 0);
})();
