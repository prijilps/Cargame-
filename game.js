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
};

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
  player.x = W / 2 - CAR_W / 2;
  player.vx = 0;

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

function drawCar(x, y, w, h, colors, isPlayer) {
  const r = 6;

  // Body
  ctx.fillStyle = colors.body;
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
  ctx.fill();

  // Detail stripe
  ctx.fillStyle = colors.detail;
  ctx.fillRect(x + 4, y + h * 0.35, w - 8, 4);

  // Windshield (top for enemy, bottom for player since player faces down)
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

  // Wheels
  ctx.fillStyle = COLORS.playerWheel;
  const ww = 8, wh = 14;
  // Front-left
  ctx.fillRect(x - ww + 2, y + 10, ww, wh);
  // Front-right
  ctx.fillRect(x + w - 2, y + 10, ww, wh);
  // Rear-left
  ctx.fillRect(x - ww + 2, y + h - 10 - wh, ww, wh);
  // Rear-right
  ctx.fillRect(x + w - 2, y + h - 10 - wh, ww, wh);

  // Headlights / taillights
  if (isPlayer) {
    // Headlights (top of player car)
    ctx.fillStyle = '#ffffaa';
    ctx.fillRect(x + 4, y + 4, 8, 5);
    ctx.fillRect(x + w - 12, y + 4, 8, 5);
    // Taillights (bottom of player)
    ctx.fillStyle = '#ff4444';
    ctx.fillRect(x + 4, y + h - 8, 8, 5);
    ctx.fillRect(x + w - 12, y + h - 8, 8, 5);
  } else {
    // Headlights at bottom of enemy (facing down)
    ctx.fillStyle = '#ffffaa';
    ctx.fillRect(x + 4, y + h - 9, 8, 5);
    ctx.fillRect(x + w - 12, y + h - 9, 8, 5);
    // Taillights at top
    ctx.fillStyle = '#ff4444';
    ctx.fillRect(x + 4, y + 4, 8, 5);
    ctx.fillRect(x + w - 12, y + 4, 8, 5);
  }
}

function drawPlayer() {
  drawCar(
    Math.round(player.x), Math.round(player.y),
    CAR_W, CAR_H,
    { body: COLORS.playerBody, glass: COLORS.playerGlass, detail: COLORS.playerDetail },
    true
  );
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

  // Collision
  if (checkCollision()) {
    gameOver();
    return;
  }

  // Draw
  ctx.clearRect(0, 0, W, H);
  drawRoad();
  drawEnemies();
  drawPlayer();
  drawScore();

  requestAnimationFrame(loop);
}

// Initial draw of start screen background
(function initDraw() {
  ctx.clearRect(0, 0, W, H);
  drawRoad();
  drawCar(
    W / 2 - CAR_W / 2, H - 120, CAR_W, CAR_H,
    { body: COLORS.playerBody, glass: COLORS.playerGlass, detail: COLORS.playerDetail },
    true
  );
})();
