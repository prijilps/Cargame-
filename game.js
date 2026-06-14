const canvas = document.getElementById('gameCanvas');
const ctx    = canvas.getContext('2d');
const W = canvas.width, H = canvas.height;

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
let engineOsc = null, engineGain = null;
function startEngineSound() {
  const ac = getAudio(); if (engineOsc) return;
  engineOsc = ac.createOscillator(); engineOsc.type = 'sawtooth';
  engineOsc.frequency.setValueAtTime(80, ac.currentTime);
  const dist = ac.createWaveShaper(); dist.curve = makeDistortionCurve(60);
  engineGain = ac.createGain(); engineGain.gain.setValueAtTime(0.07, ac.currentTime);
  engineOsc.connect(dist); dist.connect(engineGain); engineGain.connect(ac.destination);
  engineOsc.start();
}
function updateEngineSound(spd) {
  if (!engineOsc || !audioCtx) return;
  engineOsc.frequency.setTargetAtTime(70 + spd * 18, audioCtx.currentTime, 0.15);
}
function stopEngineSound() {
  if (!engineGain || !audioCtx) return;
  engineGain.gain.setTargetAtTime(0, audioCtx.currentTime, 0.15);
  setTimeout(() => { try { engineOsc && engineOsc.stop(); } catch(_){} engineOsc = engineGain = null; }, 400);
}
function playPassSound() {
  const ac = getAudio();
  const osc = ac.createOscillator(), gain = ac.createGain(), filter = ac.createBiquadFilter();
  osc.type = 'sawtooth'; osc.frequency.setValueAtTime(500, ac.currentTime);
  osc.frequency.exponentialRampToValueAtTime(120, ac.currentTime + 0.25);
  filter.type = 'bandpass'; filter.frequency.setValueAtTime(600, ac.currentTime); filter.Q.value = 1.5;
  gain.gain.setValueAtTime(0.18, ac.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.001, ac.currentTime + 0.28);
  osc.connect(filter); filter.connect(gain); gain.connect(ac.destination);
  osc.start(); osc.stop(ac.currentTime + 0.3);
}
function playCrashSound() {
  const ac = getAudio();
  const bufLen = Math.floor(ac.sampleRate * 0.6), buf = ac.createBuffer(1, bufLen, ac.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < bufLen; i++) data[i] = (Math.random()*2-1)*Math.exp(-i/(bufLen*0.12));
  const noise = ac.createBufferSource(); noise.buffer = buf;
  const nf = ac.createBiquadFilter(); nf.type = 'lowpass';
  nf.frequency.setValueAtTime(900, ac.currentTime);
  nf.frequency.exponentialRampToValueAtTime(150, ac.currentTime + 0.3);
  const ng = ac.createGain(); ng.gain.setValueAtTime(0.6, ac.currentTime);
  ng.gain.exponentialRampToValueAtTime(0.001, ac.currentTime + 0.55);
  noise.connect(nf); nf.connect(ng); ng.connect(ac.destination); noise.start();
  const boom = ac.createOscillator(); boom.type = 'sine';
  boom.frequency.setValueAtTime(110, ac.currentTime);
  boom.frequency.exponentialRampToValueAtTime(28, ac.currentTime + 0.35);
  const bg = ac.createGain(); bg.gain.setValueAtTime(0.5, ac.currentTime);
  bg.gain.exponentialRampToValueAtTime(0.001, ac.currentTime + 0.4);
  boom.connect(bg); bg.connect(ac.destination); boom.start(); boom.stop(ac.currentTime + 0.4);
}
function playLevelUpSound() {
  const ac = getAudio();
  [523, 659, 784, 1047].forEach((freq, i) => {
    const osc = ac.createOscillator(), g = ac.createGain();
    osc.type = 'sine'; osc.frequency.value = freq;
    g.gain.setValueAtTime(0, ac.currentTime + i*0.12);
    g.gain.linearRampToValueAtTime(0.18, ac.currentTime + i*0.12 + 0.05);
    g.gain.exponentialRampToValueAtTime(0.001, ac.currentTime + i*0.12 + 0.25);
    osc.connect(g); g.connect(ac.destination);
    osc.start(ac.currentTime + i*0.12); osc.stop(ac.currentTime + i*0.12 + 0.3);
  });
}

// ─── Levels ──────────────────────────────────────────────────────────────────
const LEVELS = [
  {
    name: 'SUNNY DAY', num: 1,
    sky: ['#1a6fbb','#4aabff','#87ceeb'],
    grass: ['#3a7d1e','#2d6016'],
    road: ['#555','#4a4a4a'],
    rumble: ['#dd2200','#eeeeee'],
    rivals: 9, duration: 60,
    speedMult: [0.82, 1.28],   // [min, max] speedMult for rivals
    baseSpeed: 3,
    labelColor: '#ffe066',
    sunColor: 'rgba(255,240,180,0.35)',
  },
  {
    name: 'SUNSET GLORY', num: 2,
    sky: ['#1a0a2e','#8b2500','#ff6b00'],
    grass: ['#1a3d0a','#112808'],
    road: ['#3a3a3a','#303030'],
    rumble: ['#ff4400','#ffcc00'],
    rivals: 9, duration: 55,
    speedMult: [0.90, 1.38],
    baseSpeed: 4.5,
    labelColor: '#ff8844',
    sunColor: 'rgba(255,120,0,0.45)',
  },
  {
    name: 'NIGHT RACE', num: 3,
    sky: ['#000005','#050520','#0a0a30'],
    grass: ['#0a1a04','#060f02'],
    road: ['#252525','#1e1e1e'],
    rumble: ['#aa0000','#00aaff'],
    rivals: 9, duration: 50,
    speedMult: [0.95, 1.45],
    baseSpeed: 6,
    labelColor: '#00d4ff',
    sunColor: 'rgba(0,100,255,0.20)',
  },
];

// ─── F1 Liveries ─────────────────────────────────────────────────────────────
const F1_SCHEMES = [
  { body:'#f4f4f4', accent:'#cc001a', stripe:'#00d4ff' }, // player (white/red/cyan)
  { body:'#e8002d', accent:'#ffffff', stripe:'#ffcc00' }, // Ferrari
  { body:'#0066cc', accent:'#ffffff', stripe:'#ff6600' }, // Williams
  { body:'#1db954', accent:'#000000', stripe:'#ffffff' }, // Jaguar
  { body:'#ff8700', accent:'#000000', stripe:'#cc0000' }, // McLaren papaya
  { body:'#1b1b2e', accent:'#9b59b6', stripe:'#00e5ff' }, // Alpine purple
  { body:'#006f62', accent:'#ffffff', stripe:'#ff0000' }, // Aston Martin
  { body:'#1e0f44', accent:'#ff6600', stripe:'#ffcc00' }, // Force India
];

// ─── 3D Projection Constants ──────────────────────────────────────────────────
const HORIZON_Y  = 245;            // horizon line (px)
const ROAD_SCALE = W / 2;          // = 200, pixels per world-unit at depth=1
const ROAD_HW    = 0.76;           // road half-width (world units)
const FAR_Z      = 20;             // max render depth
const STRIPE_F   = 3.2;            // road colour stripes per world-unit
const LANES      = [-0.50, 0, 0.50]; // lane centre world-X

// Car world dimensions (controls collision & perspective scale)
const CAR_WW = 0.40;  // car half-width in world units  (at depth=1 → 80px total)
const CAR_WH = 0.28;  // car height in world units       (at depth=1 → 56px)

// Crash thresholds
const CRASH_X = 0.38;
const CRASH_Z = 0.48;

// ─── State ───────────────────────────────────────────────────────────────────
let state      = 'start';   // 'start'|'countdown'|'playing'|'levelup'|'dead'|'victory'
let currentLevel = 0;       // index into LEVELS[]
let score      = 0;
let highscore  = parseInt(localStorage.getItem('cg_hs') || '0');
let frameCount = 0;
let speed      = 3;         // road speed scalar (for audio / ramp)

document.getElementById('highscore').textContent = highscore;

// Player
const player = {
  x: 0, z: 0,          // world position
  vx: 0,               // lateral velocity (world/frame)
  throttle: 1.0,
  braking: false,
};

// Race
const RACE_DURATION = 60;
let raceStartTime = 0, raceTimeLeft = 60, racePosition = 10;
let finishActive = false, finishWorldZ = 0, raceOver = false;
let victoryFrame = 0, finalPosition = 10;
const confetti = [];
let countdownStart = 0, playerReady = false;
let slipstreaming = false;   // true when closely behind a rival
let levelUpTimer  = 0;       // frames to show level-up banner

const enemies = [];

// ─── Input ───────────────────────────────────────────────────────────────────
const keys = {};
document.addEventListener('keydown', e => { keys[e.key] = true; });
document.addEventListener('keyup',   e => { keys[e.key] = false; });

let touchStartX = null, touchStartY = null;
canvas.addEventListener('touchstart', e => {
  touchStartX = e.touches[0].clientX;
  touchStartY = e.touches[0].clientY;
  keys['ArrowUp'] = true;
  e.preventDefault();
}, { passive: false });
canvas.addEventListener('touchmove', e => {
  if (touchStartX === null) return;
  const dx = e.touches[0].clientX - touchStartX;
  const dy = e.touches[0].clientY - touchStartY;
  if (Math.abs(dx) >= Math.abs(dy)) {
    keys['ArrowLeft']  = dx < -12;
    keys['ArrowRight'] = dx >  12;
    keys['ArrowUp']    = true;
    keys['ArrowDown']  = false;
  } else {
    keys['ArrowLeft'] = keys['ArrowRight'] = false;
    keys['ArrowDown'] = dy > 20;
    keys['ArrowUp']   = dy <= 20;
  }
  e.preventDefault();
}, { passive: false });
canvas.addEventListener('touchend', () => {
  keys['ArrowLeft'] = keys['ArrowRight'] = keys['ArrowUp'] = keys['ArrowDown'] = false;
  touchStartX = touchStartY = null;
});

document.getElementById('start-btn').addEventListener('click', () => startGame(0));
document.getElementById('restart-btn').addEventListener('click', () => startGame(currentLevel));
document.addEventListener('keydown', e => {
  if (state === 'victory' && e.key !== 'F5') startGame(0);
});
canvas.addEventListener('click', () => { if (state === 'victory') startGame(0); });

// ─── Projection Helpers ───────────────────────────────────────────────────────
function projX(worldX, z) { return W/2 + (worldX - player.x) * ROAD_SCALE / z; }
function projY(z)          { return HORIZON_Y + (H - HORIZON_Y) / z; }
function projS(z)          { return ROAD_SCALE / z; }

// ─── Road (pseudo-3D) ─────────────────────────────────────────────────────────
function drawRoad() {
  const lv = LEVELS[currentLevel];

  // Sky gradient
  const sg = ctx.createLinearGradient(0, 0, 0, HORIZON_Y);
  sg.addColorStop(0,    lv.sky[0]);
  sg.addColorStop(0.65, lv.sky[1]);
  sg.addColorStop(1,    lv.sky[2]);
  ctx.fillStyle = sg; ctx.fillRect(0, 0, W, HORIZON_Y);

  // Sun / glow near horizon
  const haze = ctx.createRadialGradient(W/2, HORIZON_Y, 0, W/2, HORIZON_Y, 160);
  haze.addColorStop(0, lv.sunColor); haze.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = haze; ctx.fillRect(0, HORIZON_Y-110, W, 110);

  // Night: stars
  if (currentLevel === 2) {
    ctx.fillStyle = '#ffffff';
    for (let i = 0; i < 60; i++) {
      const sx = ((i * 137 + 11) % W), sy = ((i * 97 + 7) % HORIZON_Y);
      const r = (i % 3 === 0) ? 1.2 : 0.6;
      ctx.globalAlpha = 0.4 + 0.6 * ((i % 5) / 5);
      ctx.beginPath(); ctx.arc(sx, sy, r, 0, Math.PI*2); ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  // Road segments
  const N = 42;
  for (let i = 0; i < N; i++) {
    const y1 = H   - i       * (H - HORIZON_Y - 2) / N;
    const y2 = H   - (i + 1) * (H - HORIZON_Y - 2) / N;
    const z1 = Math.min(FAR_Z, (H - HORIZON_Y) / Math.max(0.4, y1 - HORIZON_Y));
    const z2 = Math.min(FAR_Z, (H - HORIZON_Y) / Math.max(0.4, y2 - HORIZON_Y));
    const seg = Math.floor((player.z + z1) * STRIPE_F);
    const alt = seg % 2 === 0;

    // Grass
    ctx.fillStyle = alt ? lv.grass[0] : lv.grass[1];
    ctx.fillRect(0, Math.round(y2), W, Math.ceil(y1 - y2) + 1);

    // Road body
    const rl1 = projX(-ROAD_HW, z1), rr1 = projX(ROAD_HW, z1);
    const rl2 = projX(-ROAD_HW, z2), rr2 = projX(ROAD_HW, z2);
    ctx.fillStyle = alt ? lv.road[0] : lv.road[1];
    ctx.beginPath();
    ctx.moveTo(Math.round(rl1), Math.round(y1)); ctx.lineTo(Math.round(rr1), Math.round(y1));
    ctx.lineTo(Math.round(rr2), Math.round(y2)); ctx.lineTo(Math.round(rl2), Math.round(y2));
    ctx.closePath(); ctx.fill();

    // Rumble strips
    const rw1 = Math.max(1, 13/z1), rw2 = Math.max(1, 13/z2);
    ctx.fillStyle = alt ? lv.rumble[0] : lv.rumble[1];
    ctx.beginPath(); ctx.moveTo(rl1,rr1); // left
    ctx.moveTo(Math.round(rl1),      Math.round(y1));
    ctx.lineTo(Math.round(rl1+rw1),  Math.round(y1));
    ctx.lineTo(Math.round(rl2+rw2),  Math.round(y2));
    ctx.lineTo(Math.round(rl2),      Math.round(y2));
    ctx.closePath(); ctx.fill();
    ctx.beginPath();
    ctx.moveTo(Math.round(rr1-rw1),  Math.round(y1));
    ctx.lineTo(Math.round(rr1),      Math.round(y1));
    ctx.lineTo(Math.round(rr2),      Math.round(y2));
    ctx.lineTo(Math.round(rr2-rw2),  Math.round(y2));
    ctx.closePath(); ctx.fill();

    // Centre dashes
    if (alt) {
      const cw1 = Math.max(0.5, 3/z1), cw2 = Math.max(0.5, 3/z2);
      const cx1 = projX(0, z1), cx2 = projX(0, z2);
      ctx.fillStyle = 'rgba(255,255,255,0.75)';
      ctx.beginPath();
      ctx.moveTo(cx1-cw1, Math.round(y1)); ctx.lineTo(cx1+cw1, Math.round(y1));
      ctx.lineTo(cx2+cw2, Math.round(y2)); ctx.lineTo(cx2-cw2, Math.round(y2));
      ctx.closePath(); ctx.fill();
    }

    // Night headlight cones on road near camera
    if (currentLevel === 2 && i < 8) {
      const alpha = (1 - i/8) * 0.12;
      ctx.fillStyle = `rgba(255,255,200,${alpha})`;
      ctx.beginPath();
      ctx.moveTo(rl1, Math.round(y1)); ctx.lineTo(rr1, Math.round(y1));
      ctx.lineTo(Math.round(rr2), Math.round(y2)); ctx.lineTo(Math.round(rl2), Math.round(y2));
      ctx.closePath(); ctx.fill();
    }
  }
}

// ─── F1 Car — Back View ───────────────────────────────────────────────────────
function drawF1Back(cx, groundY, w, h, colors, braking) {
  if (w < 4) return;
  const s = w / 64;

  // Ground shadow
  ctx.save();
  ctx.fillStyle = 'rgba(0,0,0,0.28)';
  ctx.beginPath();
  ctx.ellipse(cx, groundY, w*0.42, Math.max(2, h*0.07), 0, 0, Math.PI*2);
  ctx.fill(); ctx.restore();

  // Rear tires
  const tw = w * 0.21, th = h * 0.40;
  const txL = cx - w*0.48, txR = cx + w*0.48 - tw, tyT = groundY - th;
  ctx.fillStyle = '#181818';
  ctx.fillRect(txL, tyT, tw, th);
  ctx.fillRect(txR, tyT, tw, th);
  // Rim
  ctx.fillStyle = '#7a7a7a';
  ctx.beginPath(); ctx.ellipse(txL+tw/2, tyT+th/2, tw*0.28, th*0.28, 0, 0, Math.PI*2); ctx.fill();
  ctx.beginPath(); ctx.ellipse(txR+tw/2, tyT+th/2, tw*0.28, th*0.28, 0, 0, Math.PI*2); ctx.fill();
  ctx.fillStyle = '#333';
  ctx.beginPath(); ctx.ellipse(txL+tw/2, tyT+th/2, tw*0.10, th*0.10, 0, 0, Math.PI*2); ctx.fill();
  ctx.beginPath(); ctx.ellipse(txR+tw/2, tyT+th/2, tw*0.10, th*0.10, 0, 0, Math.PI*2); ctx.fill();

  // Body
  const bw = w*0.43, bh = h*0.82, bx = cx-bw/2, by = groundY-bh;
  ctx.fillStyle = colors.body;
  ctx.beginPath(); ctx.roundRect(bx, by, bw, bh, [3*s, 3*s, 0, 0]); ctx.fill();
  // Accent lower band
  ctx.fillStyle = colors.accent;
  ctx.fillRect(bx, groundY-bh*0.46, bw, bh*0.46);
  // Livery stripe
  ctx.fillStyle = colors.stripe;
  ctx.fillRect(cx-bw*0.13, by, bw*0.26, bh*0.30);

  // Airbox
  const aw = bw*0.29, ah = bh*0.36;
  ctx.fillStyle = colors.body;
  ctx.beginPath(); ctx.roundRect(cx-aw/2, by, aw, ah, [4*s, 4*s, 0, 0]); ctx.fill();
  ctx.fillStyle = colors.stripe;
  ctx.fillRect(cx-aw*0.10, by, aw*0.20, ah*0.38);

  // Rear wing
  const wingW = w*0.91, wingH = h*0.13, wingY = by - wingH*0.5;
  ctx.fillStyle = colors.accent;
  ctx.fillRect(cx-wingW/2, wingY-wingH, wingW, wingH);
  ctx.fillStyle = colors.body;
  ctx.fillRect(cx-wingW*0.58/2, wingY-wingH*1.82, wingW*0.58, wingH*0.52);

  // Endplates
  const epW = Math.max(2, w*0.046), epH = h*0.28, epY = wingY - epH;
  ctx.fillStyle = colors.body;
  ctx.fillRect(cx-wingW/2,        epY, epW, epH);
  ctx.fillRect(cx+wingW/2-epW,    epY, epW, epH);
  ctx.fillStyle = colors.stripe;
  ctx.fillRect(cx-wingW/2,        epY+epH*0.35, epW, epH*0.13);
  ctx.fillRect(cx+wingW/2-epW,    epY+epH*0.35, epW, epH*0.13);

  // Brake lights
  if (braking) {
    const pulse = 0.7 + 0.3*Math.sin(Date.now()/55);
    ctx.save();
    ctx.shadowColor = '#ff0000'; ctx.shadowBlur = 16*pulse;
    ctx.fillStyle = `rgba(255,20,0,${0.75*pulse})`;
    const blW = tw*0.56, blH = th*0.18;
    ctx.fillRect(txL+(tw-blW)/2, tyT+th*0.07, blW, blH);
    ctx.fillRect(txR+(tw-blW)/2, tyT+th*0.07, blW, blH);
    ctx.restore();
  }

  // Slipstream glow on rivals close ahead (done externally)
}

// ─── Player Car ───────────────────────────────────────────────────────────────
function drawPlayerCar() {
  const lean  = player.vx * 380;
  const cx    = W/2 + lean;
  drawF1Back(cx, H-18, 78, 58, F1_SCHEMES[0], player.braking);

  // Slipstream visual — cyan shimmer behind leading car
  if (slipstreaming) {
    ctx.save();
    ctx.globalAlpha = 0.18 + 0.10*Math.sin(Date.now()/80);
    ctx.fillStyle = '#00ffee';
    ctx.beginPath();
    ctx.ellipse(cx, H-35, 36, 18, 0, 0, Math.PI*2);
    ctx.fill(); ctx.restore();
  }
}

// ─── Enemy Cars ───────────────────────────────────────────────────────────────
function drawEnemyCars() {
  const visible = [];
  for (const e of enemies) {
    const depth = e.worldZ - player.z;
    if (depth < 0.3 || depth > FAR_Z) continue;
    visible.push({ e, depth });
  }
  visible.sort((a, b) => b.depth - a.depth); // painter's order

  for (const { e, depth } of visible) {
    const sc  = projS(depth);
    const sx  = projX(e.worldX, depth);
    const sy  = projY(depth);
    const cw  = CAR_WW * sc * 2;
    const ch  = CAR_WH * sc;
    if (cw < 3) continue;
    drawF1Back(sx, sy, cw, ch, e.color, false);

    // Night: headlights glow behind rivals (they're ahead of us)
    if (currentLevel === 2) {
      ctx.save();
      ctx.globalAlpha = Math.min(0.5, 0.6/depth);
      const lg = ctx.createRadialGradient(sx, sy, 0, sx, sy, cw*0.8);
      lg.addColorStop(0, 'rgba(255,255,180,0.5)'); lg.addColorStop(1,'rgba(0,0,0,0)');
      ctx.fillStyle = lg; ctx.fillRect(sx-cw, sy-ch*0.5, cw*2, ch);
      ctx.restore();
    }
  }
}

// ─── Finish Line (3D projected) ───────────────────────────────────────────────
function drawFinishLine3D() {
  if (!finishActive) return;
  const depth = finishWorldZ - player.z;
  if (depth <= 0.1 || depth > FAR_Z) return;
  const sy  = projY(depth);
  const rl  = projX(-ROAD_HW, depth), rr = projX(ROAD_HW, depth);
  const lh  = Math.max(2, 14/depth);
  const rw  = rr - rl;
  const nch = Math.max(2, Math.round(rw / (lh*1.4)));
  ctx.save();
  ctx.shadowColor = '#ffffff'; ctx.shadowBlur = 10;
  for (let c = 0; c < nch; c++) {
    ctx.fillStyle = c%2===0 ? '#ffffff' : '#111111';
    ctx.fillRect(rl + c*rw/nch, sy-lh, rw/nch+1, lh*2);
  }
  ctx.restore();
}

// ─── Start Lights ─────────────────────────────────────────────────────────────
const LIGHT_INTERVAL = 0.72;
const LIGHTS_OUT_AT  = 5 * LIGHT_INTERVAL + 0.9;

function drawStartLights(elapsed) {
  const lit    = Math.min(5, Math.floor(elapsed / LIGHT_INTERVAL));
  const allOut = elapsed >= LIGHTS_OUT_AT;
  const cx = W/2, cy = 128, r = 11, sp = 30;
  ctx.save();
  ctx.fillStyle = 'rgba(0,0,0,0.83)';
  ctx.beginPath(); ctx.roundRect(cx-90, cy-28, 180, 56, 10); ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.15)'; ctx.lineWidth = 1; ctx.stroke();
  for (let i = 0; i < 5; i++) {
    const x = cx - sp*2 + i*sp;
    ctx.beginPath(); ctx.arc(x, cy, r, 0, Math.PI*2);
    if (allOut) { ctx.fillStyle = '#1a0000'; ctx.shadowBlur = 0; }
    else if (i < lit) { ctx.fillStyle = '#ff1a00'; ctx.shadowColor = '#ff4400'; ctx.shadowBlur = 18; }
    else { ctx.fillStyle = '#2a0000'; ctx.shadowBlur = 0; }
    ctx.fill(); ctx.shadowBlur = 0;
  }
  if (allOut) {
    ctx.fillStyle = '#00ff55'; ctx.shadowColor = '#00ff55'; ctx.shadowBlur = 20;
    ctx.font = 'bold 30px monospace'; ctx.textAlign = 'center';
    ctx.fillText('GO!', cx, cy+50); ctx.shadowBlur = 0;
  } else if (lit === 0) {
    ctx.fillStyle = 'rgba(255,255,255,0.5)'; ctx.font = '13px monospace'; ctx.textAlign = 'center';
    ctx.fillText('GET READY', cx, cy+42);
  }
  ctx.restore();
}

// ─── Level-up Banner ──────────────────────────────────────────────────────────
function drawLevelBanner() {
  if (levelUpTimer <= 0) return;
  const t = levelUpTimer / 160;
  ctx.save(); ctx.globalAlpha = Math.min(1, t * 3);
  const lv = LEVELS[currentLevel];
  ctx.fillStyle = 'rgba(0,0,0,0.72)';
  ctx.beginPath(); ctx.roundRect(W/2-130, H/2-45, 260, 90, 12); ctx.fill();
  ctx.strokeStyle = lv.labelColor; ctx.lineWidth = 2;
  ctx.shadowColor = lv.labelColor; ctx.shadowBlur = 14;
  ctx.stroke(); ctx.shadowBlur = 0;
  ctx.fillStyle = lv.labelColor;
  ctx.font = 'bold 13px monospace'; ctx.textAlign = 'center';
  ctx.fillText(`LEVEL ${lv.num}`, W/2, H/2-16);
  ctx.font = 'bold 22px sans-serif';
  ctx.fillText(lv.name, W/2, H/2+12);
  ctx.fillStyle = 'rgba(255,255,255,0.6)'; ctx.font = '13px sans-serif';
  ctx.fillText('Rivals are faster — stay sharp!', W/2, H/2+34);
  ctx.restore();
  levelUpTimer--;
}

// ─── Start / Countdown ───────────────────────────────────────────────────────
function startGame(levelIdx) {
  currentLevel = levelIdx;
  const lv = LEVELS[currentLevel];

  score = 0; frameCount = 0;
  speed = lv.baseSpeed;
  enemies.length = 0; confetti.length = 0;

  player.x = 0; player.z = 0; player.vx = 0;
  player.throttle = 1.0; player.braking = false;

  raceStartTime = performance.now();
  raceTimeLeft  = lv.duration;
  racePosition  = 10;
  finishActive  = false; finishWorldZ = 0; raceOver = false;
  victoryFrame  = 0; finalPosition = 10;
  slipstreaming = false; levelUpTimer = 0;

  const [sMin, sMax] = lv.speedMult;
  const grid = [
    {lane:1,zOff:1.9},{lane:0,zOff:1.9},{lane:2,zOff:1.9},
    {lane:1,zOff:3.7},{lane:0,zOff:3.7},{lane:2,zOff:3.7},
    {lane:1,zOff:6.1},{lane:0,zOff:6.1},{lane:2,zOff:6.1},
  ];
  grid.forEach(({lane, zOff}, i) => {
    const scheme    = F1_SCHEMES[1 + (i % (F1_SCHEMES.length - 1))];
    const sMult     = sMin + Math.random() * (sMax - sMin);
    enemies.push({
      worldX: LANES[lane], worldZ: player.z + zOff,
      targetX: LANES[lane], lane,
      color: scheme, speedMult: sMult,
      worldSpeed: 0, effectiveSpeed: 0,
      launchDelay: Math.random() * 0.4,
      launchProgress: 0,
      wasAhead: true,
      shiftCooldown: 50 + Math.random() * 70,
    });
  });

  document.getElementById('start-screen').classList.add('hidden');
  document.getElementById('game-over-screen').classList.add('hidden');
  document.getElementById('score').textContent = '0';
  document.getElementById('race-pos').textContent = 'P10/10';

  playerReady    = false;
  countdownStart = performance.now();
  state = 'countdown';
  startEngineSound();
  requestAnimationFrame(countdownLoop);
}

let countdownLastTS = 0;
function countdownLoop(ts) {
  if (state !== 'countdown') return;
  const elapsed = (performance.now() - countdownStart) / 1000;
  ctx.clearRect(0, 0, W, H);
  drawRoad(); drawEnemyCars(); drawPlayerCar();
  drawStartLights(elapsed);
  if (elapsed >= LIGHTS_OUT_AT + 0.55) {
    state = 'playing'; raceStartTime = performance.now(); lastTime = ts;
    requestAnimationFrame(loop); return;
  }
  requestAnimationFrame(countdownLoop);
}

// ─── Main Loop ───────────────────────────────────────────────────────────────
let lastTime = 0;

function loop(ts) {
  if (state !== 'playing') return;

  const dt = Math.min((ts - lastTime) / 16.67, 3);
  lastTime = ts;

  frameCount++;
  score = Math.floor(frameCount / 3);
  speed = LEVELS[currentLevel].baseSpeed + score * 0.004;
  document.getElementById('score').textContent = score;

  // World speed in world-units/frame
  const worldSpeed = speed / (H - HORIZON_Y);

  // ── Race clock ────────────────────────────────────────────────────────────
  raceTimeLeft = Math.max(0, LEVELS[currentLevel].duration - (performance.now()-raceStartTime)/1000);
  const secs = Math.ceil(raceTimeLeft);
  document.getElementById('race-time').textContent =
    `${Math.floor(secs/60)}:${String(secs%60).padStart(2,'0')}`;

  // Finish line
  if (!finishActive && raceTimeLeft <= 10) {
    finishActive = true; finishWorldZ = player.z + 3.8;
  }
  if (finishActive && !raceOver && player.z >= finishWorldZ) {
    endRace(); return;
  }
  if (!raceOver && raceTimeLeft <= 0) { endRace(); return; }

  // ── Player input ──────────────────────────────────────────────────────────
  if (!playerReady && (keys['ArrowUp'] || keys['w'] || keys['W'])) playerReady = true;

  const STEER = 0.0027;
  if (keys['ArrowLeft']  || keys['a'] || keys['A']) player.vx -= STEER * dt;
  if (keys['ArrowRight'] || keys['d'] || keys['D']) player.vx += STEER * dt;
  // Speed-sensitive friction: harder to steer at max throttle
  const friction = Math.pow(0.78 + player.throttle * 0.04, dt);
  player.vx *= friction;
  player.vx  = Math.max(-0.022, Math.min(0.022, player.vx));
  player.x  += player.vx * dt;
  player.x   = Math.max(-(ROAD_HW-0.10), Math.min(ROAD_HW-0.10, player.x));

  // Off-road friction penalty
  const offRoad = Math.abs(player.x) > ROAD_HW - 0.10;
  const throttleTarget = offRoad ? Math.min(player.throttle, 0.7) : player.throttle;

  if (!playerReady) {
    player.throttle = 0; player.braking = false;
  } else if (keys['ArrowUp'] || keys['w'] || keys['W']) {
    player.throttle = Math.min(2.2, player.throttle + 0.055 * dt);
  } else if (keys['ArrowDown'] || keys['s'] || keys['S']) {
    // Momentum-based braking: speed proportional deceleration
    player.throttle = Math.max(0.22, player.throttle - 0.10 * dt);
  } else {
    player.throttle += (throttleTarget - player.throttle) * 0.04 * dt;
  }
  player.braking = playerReady && (keys['ArrowDown'] || keys['s'] || keys['S']);

  // Slipstream: boost when directly behind a rival within range
  slipstreaming = false;
  for (const e of enemies) {
    const dz = e.worldZ - player.z;
    const dx = Math.abs(e.worldX - player.x);
    if (dz > 0.4 && dz < 1.8 && dx < 0.28) {
      slipstreaming = true;
      if (playerReady) player.throttle = Math.min(2.5, player.throttle + 0.012 * dt);
      break;
    }
  }

  player.z += worldSpeed * player.throttle * dt;

  // ── Rival AI ──────────────────────────────────────────────────────────────
  for (let i = 0; i < enemies.length; i++) {
    const e = enemies[i];
    e.worldSpeed = worldSpeed * e.speedMult;

    // Launch ramp (fixed dt unit: dt=1 means 1/60s)
    if (e.launchProgress < 1) {
      e.launchDelay    -= dt / 60;
      if (e.launchDelay <= 0) {
        e.launchProgress  = Math.min(1, e.launchProgress + dt / 90);
        e.effectiveSpeed  = e.worldSpeed * e.launchProgress;
      }
      e.worldZ += e.effectiveSpeed * dt;
      e.worldX += (e.targetX - e.worldX) * 0.06;
      continue;
    }

    // Blocking detection (world-space)
    let minGap = Infinity, blocked = false;
    for (let j = 0; j < enemies.length; j++) {
      if (j === i) continue;
      const o  = enemies[j];
      const dz = o.worldZ - e.worldZ;
      const dx = Math.abs(o.worldX - e.worldX);
      if (dx < 0.34 && dz > 0 && dz < 3.2) { blocked = true; minGap = Math.min(minGap, dz); }
    }

    // Speed control
    if (blocked) {
      const tgt = e.worldSpeed * Math.max(0.08, (minGap - 0.48) / 2.2);
      e.effectiveSpeed = Math.max(0, e.effectiveSpeed - e.worldSpeed * 0.045 * dt);
      e.effectiveSpeed = Math.max(e.effectiveSpeed, tgt);
    } else {
      e.effectiveSpeed = Math.min(e.worldSpeed * 1.10, e.effectiveSpeed + e.worldSpeed * 0.038 * dt);
    }

    // Lane-change overtake
    e.shiftCooldown -= dt;
    if (blocked && minGap < 2.2 && e.shiftCooldown <= 0) {
      const free = [0,1,2].filter(ln => {
        if (ln === e.lane) return false;
        return !enemies.some((o,j) => j !== i &&
          Math.abs(LANES[ln] - o.worldX) < 0.30 &&
          Math.abs(o.worldZ  - e.worldZ) < 2.2);
      });
      if (free.length > 0) {
        e.lane = free[Math.floor(Math.random()*free.length)];
        e.targetX = LANES[e.lane];
        e.shiftCooldown = 30 + Math.random() * 40;
      } else {
        e.shiftCooldown = 18;
      }
    }

    // Lateral slide (steering speed scales with level aggression)
    const slideRate = 0.016 + currentLevel * 0.003;
    const dxL = e.targetX - e.worldX;
    e.worldX += Math.sign(dxL) * Math.min(Math.abs(dxL), slideRate * dt);

    // Forward movement
    e.worldZ += e.effectiveSpeed * dt;

    // Pass sound (sign change = player and rival swapped positions)
    const isAhead = e.worldZ > player.z;
    if (e.wasAhead !== isAhead) { playPassSound(); }
    e.wasAhead = isAhead;
  }

  // Lateral separation
  for (let i = 0; i < enemies.length; i++) {
    for (let j = i+1; j < enemies.length; j++) {
      const a = enemies[i], b = enemies[j];
      if (Math.abs(b.worldZ - a.worldZ) > 0.55) continue;
      const dx = b.worldX - a.worldX;
      const ov = 0.30 - Math.abs(dx);
      if (ov > 0 && Math.abs(dx) > 0) {
        const push = ov * 0.55 * Math.sign(dx);
        a.worldX -= push*0.5; b.worldX += push*0.5;
        a.worldX = Math.max(-ROAD_HW+0.06, Math.min(ROAD_HW-0.06, a.worldX));
        b.worldX = Math.max(-ROAD_HW+0.06, Math.min(ROAD_HW-0.06, b.worldX));
        a.targetX = a.worldX; b.targetX = b.worldX;
      }
    }
  }

  // Race position
  racePosition = 1 + enemies.filter(e => e.worldZ > player.z).length;
  racePosition = Math.max(1, Math.min(10, racePosition));
  document.getElementById('race-pos').textContent = `P${racePosition}/10`;

  updateEngineSound(speed * player.throttle);

  // Collision (only when playing, not mid-launch)
  if (playerReady && checkCollision()) { gameOver(); return; }

  // ── Draw ──────────────────────────────────────────────────────────────────
  ctx.clearRect(0, 0, W, H);
  drawRoad();
  drawFinishLine3D();
  drawEnemyCars();
  drawPlayerCar();
  drawLevelBanner();

  // "Press ↑ to GO" hint
  if (!playerReady) {
    const pulse = 0.55 + 0.45*Math.sin(Date.now()/200);
    ctx.save(); ctx.globalAlpha = pulse;
    ctx.fillStyle = '#ffd700'; ctx.shadowColor = '#ffd700'; ctx.shadowBlur = 14;
    ctx.font = 'bold 15px monospace'; ctx.textAlign = 'center';
    ctx.fillText('PRESS ↑ TO GO!', W/2, H - 95);
    ctx.restore();
  }

  requestAnimationFrame(loop);
}

// ─── Collision ────────────────────────────────────────────────────────────────
function checkCollision() {
  for (const e of enemies) {
    if (Math.abs(e.worldZ - player.z) < CRASH_Z &&
        Math.abs(e.worldX - player.x) < CRASH_X) return true;
  }
  return false;
}

// ─── End Race (win or time) ───────────────────────────────────────────────────
function endRace() {
  raceOver = true; finalPosition = racePosition;
  const nextLevel = currentLevel + 1;
  // Won level — advance or full victory
  if (nextLevel < LEVELS.length && finalPosition <= 3) {
    // Show level-up then start next level
    stopEngineSound(); spawnConfetti();
    state = 'levelup';
    levelUpTimer = 160;
    playLevelUpSound();
    setTimeout(() => startGame(nextLevel), 2800);
    // Draw level-up overlay in a mini loop
    requestAnimationFrame(function lvlLoop() {
      if (state !== 'levelup') return;
      ctx.clearRect(0,0,W,H); drawRoad();
      // Big banner
      ctx.save();
      for (const p of confetti) {
        p.x+=p.vx; p.y+=p.vy; p.angle+=p.va;
        if (p.y>H+20){p.y=-10;p.x=Math.random()*W;}
        ctx.save(); ctx.translate(p.x,p.y); ctx.rotate(p.angle);
        ctx.fillStyle=p.color; ctx.fillRect(-p.w/2,-p.h/2,p.w,p.h); ctx.restore();
      }
      ctx.restore();
      const lv = LEVELS[nextLevel];
      ctx.save();
      ctx.fillStyle='rgba(0,0,0,0.78)';
      ctx.beginPath(); ctx.roundRect(W/2-145,H/2-90,290,180,16); ctx.fill();
      ctx.strokeStyle=lv.labelColor; ctx.lineWidth=2;
      ctx.shadowColor=lv.labelColor; ctx.shadowBlur=18; ctx.stroke(); ctx.shadowBlur=0;
      ctx.fillStyle='#ffffff'; ctx.font='bold 13px monospace'; ctx.textAlign='center';
      ctx.fillText('LEVEL COMPLETE!', W/2, H/2-52);
      ctx.fillStyle=lv.labelColor; ctx.font='bold 26px sans-serif';
      ctx.fillText(`Next: ${lv.name}`, W/2, H/2-18);
      ctx.fillStyle='rgba(255,255,255,0.65)'; ctx.font='14px sans-serif';
      ctx.fillText(`You finished P${finalPosition} 🏆`, W/2, H/2+14);
      ctx.fillStyle='rgba(255,255,255,0.4)'; ctx.font='12px sans-serif';
      ctx.fillText('Get ready…', W/2, H/2+42);
      ctx.restore();
      requestAnimationFrame(lvlLoop);
    });
  } else {
    stopEngineSound(); spawnConfetti();
    state = 'victory'; victoryFrame = 0;
    requestAnimationFrame(victoryLoop);
  }
}

// ─── Game Over ────────────────────────────────────────────────────────────────
function gameOver() {
  state = 'dead'; stopEngineSound(); playCrashSound();
  const newBest = score > highscore;
  if (newBest) { highscore = score; localStorage.setItem('cg_hs', highscore); }
  document.getElementById('final-score').textContent = `P${racePosition}`;
  document.getElementById('new-best').classList.toggle('hidden', !newBest);
  document.getElementById('game-over-screen').classList.remove('hidden');
}

// ─── Confetti ─────────────────────────────────────────────────────────────────
function spawnConfetti() {
  const cols = ['#FFD700','#ff4444','#00d4ff','#44ff88','#ff88ff','#ffffff'];
  for (let i = 0; i < 100; i++) confetti.push({
    x: Math.random()*W, y: -10-Math.random()*H*0.4,
    vx:(Math.random()-0.5)*2.5, vy:1.5+Math.random()*3,
    color:cols[Math.floor(Math.random()*cols.length)],
    w:6+Math.random()*6, h:3+Math.random()*4,
    angle:Math.random()*Math.PI, va:(Math.random()-0.5)*0.18,
  });
}

// ─── Trophy ───────────────────────────────────────────────────────────────────
function drawTrophy(x, y) {
  const b = Math.sin(victoryFrame*0.05)*7;
  ctx.save(); ctx.translate(x, y+b);
  ctx.shadowColor='#FFD700'; ctx.shadowBlur=30; ctx.fillStyle='#FFD700';
  ctx.beginPath();
  ctx.moveTo(-30,-50);ctx.lineTo(30,-50);ctx.lineTo(22,5);ctx.lineTo(10,5);
  ctx.lineTo(10,18);ctx.lineTo(22,18);ctx.lineTo(22,28);ctx.lineTo(-22,28);
  ctx.lineTo(-22,18);ctx.lineTo(-10,18);ctx.lineTo(-10,5);ctx.lineTo(-22,5);
  ctx.closePath();ctx.fill();
  ctx.fillStyle='rgba(255,255,220,0.35)';
  ctx.beginPath();ctx.moveTo(-18,-48);ctx.lineTo(-5,-48);ctx.lineTo(-10,0);ctx.lineTo(-22,0);
  ctx.closePath();ctx.fill();
  ctx.strokeStyle='#FFD700';ctx.lineWidth=5;ctx.shadowBlur=20;
  ctx.beginPath();ctx.arc(-38,-22,14,Math.PI*0.6,Math.PI*1.4);ctx.stroke();
  ctx.beginPath();ctx.arc(38,-22,14,Math.PI*1.6,Math.PI*0.4,false);ctx.stroke();
  ctx.fillStyle='#fff7aa';ctx.shadowBlur=0;
  ctx.font='bold 18px sans-serif';ctx.textAlign='center';ctx.fillText('★',0,-22);
  ctx.restore();
}
function drawWavingFlag(x, y) {
  ctx.save();ctx.translate(x,y);
  ctx.strokeStyle='#aaa';ctx.lineWidth=3;
  ctx.beginPath();ctx.moveTo(0,0);ctx.lineTo(0,-90);ctx.stroke();
  const sqW=13,sqH=12,cols=4,rows=3;
  for(let c=0;c<cols;c++){
    const wave=Math.sin(c*1.1+victoryFrame*0.1)*5;
    for(let r=0;r<rows;r++){
      ctx.fillStyle=(c+r)%2===0?'#ffffff':'#000000';
      ctx.fillRect(c*sqW,-90+r*sqH+wave,sqW,sqH);
    }
  }
  ctx.restore();
}
function drawVictoryScene() {
  ctx.save();
  for (const p of confetti) {
    p.x+=p.vx;p.y+=p.vy;p.angle+=p.va;
    if(p.y>H+20){p.y=-10;p.x=Math.random()*W;}
    ctx.save();ctx.translate(p.x,p.y);ctx.rotate(p.angle);
    ctx.fillStyle=p.color;ctx.fillRect(-p.w/2,-p.h/2,p.w,p.h);ctx.restore();
  }
  ctx.restore();
  ctx.fillStyle='rgba(5,8,20,0.82)';
  ctx.beginPath();ctx.roundRect(W/2-145,H/2-165,290,310,18);ctx.fill();
  ctx.strokeStyle='#FFD700';ctx.lineWidth=2;ctx.shadowColor='#FFD700';ctx.shadowBlur=12;
  ctx.beginPath();ctx.roundRect(W/2-145,H/2-165,290,310,18);ctx.stroke();ctx.shadowBlur=0;
  drawTrophy(W/2-55,H/2-70);
  drawWavingFlag(W/2+60,H/2-40);
  const pt=finalPosition===1?'RACE WINNER!':
    currentLevel===LEVELS.length-1&&finalPosition<=3?`ALL LEVELS DONE! P${finalPosition}`:`FINISHED P${finalPosition}`;
  const pc=finalPosition<=3?'#FFD700':'#ffffff';
  ctx.fillStyle=pc;ctx.shadowColor=pc;ctx.shadowBlur=16;
  ctx.font=`bold ${finalPosition===1?30:22}px sans-serif`;ctx.textAlign='center';
  ctx.fillText(pt,W/2,H/2+80);ctx.shadowBlur=0;
  ctx.fillStyle='rgba(255,255,255,0.7)';ctx.font='14px sans-serif';
  const sub = currentLevel===LEVELS.length-1?'You conquered all 3 levels!':'Press any key to race again';
  ctx.fillText(sub,W/2,H/2+108);
  ctx.fillStyle='rgba(255,255,255,0.45)';ctx.font='12px sans-serif';
  ctx.fillText('Tap / press any key to restart',W/2,H/2+136);
}
function victoryLoop() {
  if (state!=='victory') return;
  victoryFrame++;
  ctx.clearRect(0,0,W,H); drawRoad(); drawVictoryScene();
  requestAnimationFrame(victoryLoop);
}

// ─── Init draw ────────────────────────────────────────────────────────────────
(function initDraw() {
  ctx.clearRect(0, 0, W, H);
  drawRoad();
  drawF1Back(W/2, H-18, 78, 58, F1_SCHEMES[0], false);
})();
