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
const ROAD_LEFT = 60;
const ROAD_RIGHT = 340;
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

const ENEMY_COLORS = [
  { body: '#ff4444', glass: '#330000', detail: '#cc2222' },
  { body: '#ffaa00', glass: '#331a00', detail: '#cc8800' },
  { body: '#44ff88', glass: '#003322', detail: '#22cc66' },
  { body: '#cc44ff', glass: '#220033', detail: '#9922cc' },
  { body: '#ff8844', glass: '#331100', detail: '#cc5522' },
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

function spawnEnemy() {
  const lane = Math.floor(Math.random() * LANE_COUNT);
  const x = ROAD_LEFT + lane * LANE_WIDTH + (LANE_WIDTH - CAR_W) / 2;
  const colorSet = ENEMY_COLORS[Math.floor(Math.random() * ENEMY_COLORS.length)];

  // Avoid spawning directly on top of an existing enemy in same lane
  const tooClose = enemies.some(e => e.lane === lane && e.y < CAR_H * 2.5);
  if (tooClose) return;

  enemies.push({
    x,
    y: -CAR_H,
    lane,
    color: colorSet,
    speed: speed * (0.7 + Math.random() * 0.6),
    passed: false,
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
    ctx.fillStyle = `rgba(20, 15, 5, ${m.alpha})`;
    ctx.fillRect(m.x - 2, m.y - 4, 4, 8);
  }
}

// ── F1 top-down player car ────────────────────────────────────────────────────
function drawF1PlayerCar(px, py, wa) {
  const cx = Math.round(px + CAR_W / 2);
  const cy = Math.round(py + CAR_H / 2);

  ctx.save();
  ctx.translate(cx, cy);
  // Car faces UP: nose at -y, rear at +y

  const white   = '#f4f4f4';
  const red     = '#cc001a';
  const cyan    = '#00d4ff';
  const dark    = '#001e30';
  const tire    = '#181818';
  const rim     = '#363636';
  const cockpit = '#050f18';

  function box(x, y, w, h, r) {
    ctx.beginPath(); ctx.roundRect(x, y, w, h, r ?? 2); ctx.fill();
  }

  // ── Rear wing ──────────────────────────────────────────────
  ctx.fillStyle = red;
  box(-27, 22, 54, 6, 1);             // upper plane
  box(-28, 17, 5,  16, 1);            // left endplate
  box( 23, 17, 5,  16, 1);            // right endplate
  ctx.fillStyle = white;
  box(-25, 18, 50,  7, 1);            // lower plane (wider, lighter)
  ctx.fillStyle = red;
  box(-25, 18, 50,  2, 0);            // leading edge stripe

  // ── Rear tires ─────────────────────────────────────────────
  for (const sx of [-1, 1]) {
    ctx.save(); ctx.translate(sx * 22, 19);
    ctx.fillStyle = tire;
    box(-6.5, -10, 13, 20, 3);        // fat rear rubber
    ctx.fillStyle = rim;
    box(-4,   -6.5, 8, 13, 2);        // alloy rim
    ctx.strokeStyle = 'rgba(90,90,90,0.5)';
    ctx.lineWidth = 0.6;
    ctx.beginPath(); ctx.arc(0, 0, 5, 0, Math.PI * 2); ctx.stroke(); // rim ring
    ctx.restore();
  }

  // ── Body drop shadow ───────────────────────────────────────
  ctx.fillStyle = 'rgba(0,0,0,0.2)';
  ctx.beginPath();
  ctx.moveTo( 1, -32);
  ctx.bezierCurveTo( 4, -24,  13, -17,  15,  -8);
  ctx.bezierCurveTo( 18,  -1,  18,   7,  17,  15);
  ctx.lineTo( 14, 30); ctx.lineTo(-12, 30); ctx.lineTo(-15, 15);
  ctx.bezierCurveTo(-16,   7, -16,  -1, -13,  -8);
  ctx.bezierCurveTo(-11, -17,  -2, -24,   1, -32);
  ctx.closePath(); ctx.fill();

  // ── White body silhouette ──────────────────────────────────
  ctx.fillStyle = white;
  ctx.beginPath();
  ctx.moveTo( 0, -33);
  ctx.bezierCurveTo( 2.5, -26,  11, -16,  13,  -8);
  ctx.bezierCurveTo( 16,  -1,  17,   6,  15,  14);
  ctx.lineTo( 13, 29); ctx.lineTo(-13, 29); ctx.lineTo(-15, 14);
  ctx.bezierCurveTo(-17,   6, -16,  -1, -13,  -8);
  ctx.bezierCurveTo(-11, -16,  -2.5, -26,  0, -33);
  ctx.closePath(); ctx.fill();

  // ── Red nose arrow (livery) ────────────────────────────────
  ctx.fillStyle = red;
  ctx.beginPath();
  ctx.moveTo(0, -33); ctx.lineTo(7, -13); ctx.lineTo(-7, -13);
  ctx.closePath(); ctx.fill();

  // ── Red sidepod livery ─────────────────────────────────────
  ctx.fillStyle = red;
  // Left sidepod
  ctx.beginPath();
  ctx.moveTo(-13, 29); ctx.lineTo(-15, 14);
  ctx.bezierCurveTo(-17, 5, -16, -1, -13, -5);
  ctx.lineTo(-11, -5); ctx.lineTo(-11, 29);
  ctx.closePath(); ctx.fill();
  // Right sidepod
  ctx.beginPath();
  ctx.moveTo(13, 29); ctx.lineTo(15, 14);
  ctx.bezierCurveTo(17, 5, 16, -1, 13, -5);
  ctx.lineTo(11, -5); ctx.lineTo(11, 29);
  ctx.closePath(); ctx.fill();

  // ── Cyan identity stripe (player colour) ──────────────────
  ctx.fillStyle = cyan;
  ctx.globalAlpha = 0.4;
  box(-2, -13, 4, 40);
  ctx.globalAlpha = 1;

  // ── Sidepod air intakes ────────────────────────────────────
  ctx.fillStyle = 'rgba(0,0,0,0.3)';
  ctx.beginPath(); ctx.ellipse(-12, -1, 2.5, 5,  0.25, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.ellipse( 12, -1, 2.5, 5, -0.25, 0, Math.PI * 2); ctx.fill();

  // ── Roll hoop / engine intake fin ─────────────────────────
  ctx.fillStyle = dark;
  box(-3, -16, 6, 9, 1);
  ctx.fillStyle = red;
  box(-2.5, -17.5, 5, 3, 1);

  // ── Cockpit surround ──────────────────────────────────────
  ctx.fillStyle = dark;
  ctx.beginPath(); ctx.ellipse(0, 1, 9, 11.5, 0, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = cockpit;
  ctx.beginPath(); ctx.ellipse(0, 1, 7.5, 10, 0, 0, Math.PI * 2); ctx.fill();

  // Seat bucket
  ctx.fillStyle = '#08192a';
  ctx.beginPath(); ctx.ellipse(0, 3, 5, 7.5, 0, 0, Math.PI * 2); ctx.fill();

  // ── Helmet ────────────────────────────────────────────────
  ctx.fillStyle = '#bb2200';
  ctx.beginPath(); ctx.arc(0, -1.5, 4.5, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#ee4400';
  ctx.beginPath(); ctx.arc(-0.6, -2.5, 2.5, 0, Math.PI * 2); ctx.fill();
  // Visor
  ctx.fillStyle = 'rgba(0, 210, 255, 0.75)';
  ctx.beginPath(); ctx.ellipse(0.3, -1.2, 3, 1.8, -0.15, 0, Math.PI * 2); ctx.fill();

  // ── Suspension wishbones ──────────────────────────────────
  ctx.strokeStyle = 'rgba(0,0,0,0.5)';
  ctx.lineWidth = 1.2;
  ctx.setLineDash([]);
  ctx.beginPath();
  ctx.moveTo(-10, -11); ctx.lineTo(-18, -21);   // FL upper
  ctx.moveTo( 10, -11); ctx.lineTo( 18, -21);   // FR upper
  ctx.moveTo(-13,   9); ctx.lineTo(-22, 14);    // RL
  ctx.moveTo( 13,   9); ctx.lineTo( 22, 14);    // RR
  ctx.stroke();

  // ── Front tires (steerable) ───────────────────────────────
  for (const sx of [-1, 1]) {
    ctx.save(); ctx.translate(sx * 18, -21); ctx.rotate(wa || 0);
    ctx.fillStyle = tire;
    box(-5, -8.5, 10, 17, 3);          // smaller front rubber
    ctx.fillStyle = rim;
    box(-3,  -6,   6, 12, 2);          // rim
    ctx.strokeStyle = 'rgba(90,90,90,0.5)';
    ctx.lineWidth = 0.6;
    ctx.beginPath(); ctx.arc(0, 0, 4, 0, Math.PI * 2); ctx.stroke();
    ctx.restore();
  }

  // ── Front wing ────────────────────────────────────────────
  // Endplates
  ctx.fillStyle = red;
  box(-28, -30,  5, 12, 1);
  box( 23, -30,  5, 12, 1);
  // Main lower plane (white)
  ctx.fillStyle = white;
  box(-27, -32, 54,  6, 1);
  // Upper flap (red)
  ctx.fillStyle = red;
  box(-26, -35, 52,  4, 1);
  // Nose box in centre
  ctx.fillStyle = cyan;
  ctx.globalAlpha = 0.65;
  box(-8, -30, 16, 4, 1);
  ctx.globalAlpha = 1;

  ctx.restore();
}
// ─────────────────────────────────────────────────────────────────────────────

function drawPlayer() {
  drawF1PlayerCar(Math.round(player.x), Math.round(player.y), player.wheelAngle);
}

function drawEnemies() {
  for (const e of enemies) {
    drawCar(Math.round(e.x), Math.round(e.y), CAR_W, CAR_H, e.color, false);
  }
}

function drawScore() {
  document.getElementById('score').textContent = score;
  document.getElementById('highscore').textContent = highscore;
}

function checkCollision() {
  const px = player.x + 4;
  const py = player.y + 8;
  const pw = CAR_W - 8;
  const ph = CAR_H - 12;

  for (const e of enemies) {
    const ex = e.x + 4;
    const ey = e.y + 8;
    const ew = CAR_W - 8;
    const eh = CAR_H - 12;

    if (px < ex + ew && px + pw > ex && py < ey + eh && py + ph > ey) {
      return true;
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
    enemies[i].y += enemies[i].speed * dt;
    // Whoosh when enemy passes player
    if (!enemies[i].passed && enemies[i].y > player.y + CAR_H) {
      enemies[i].passed = true;
      playPassSound();
    }
    if (enemies[i].y > H + CAR_H) {
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

  // Smooth wheel steer angle (max ±0.38 rad ≈ 22°)
  const targetAngle = Math.max(-0.38, Math.min(0.38, player.vx / player.speed * 0.38));
  player.wheelAngle += (targetAngle - player.wheelAngle) * 0.18;

  // Skid marks at rear wheels when turning
  if (Math.abs(player.vx) > 1.4 && frameCount % 2 === 0) {
    const rearY = player.y + CAR_H - 17;
    skidMarks.push({ x: player.x - 2,          y: rearY, alpha: 0.55 });
    skidMarks.push({ x: player.x + CAR_W + 2,  y: rearY, alpha: 0.55 });
  }

  // Fade & cull skid marks
  for (let i = skidMarks.length - 1; i >= 0; i--) {
    skidMarks[i].alpha -= 0.014;
    if (skidMarks[i].alpha <= 0) skidMarks.splice(i, 1);
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
