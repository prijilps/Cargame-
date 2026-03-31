// main.js
// Entry point for the new modular F1 game

import { Car } from './cars/Car.js';
import { CarPhysics } from './physics/CarPhysics.js';
import { PlayerController } from './cars/PlayerController.js';
import { AIController } from './cars/AIController.js';
import { Track } from './tracks/Track.js';
import { RaceManager } from './race/RaceManager.js';
import { HUD } from './ui/HUD.js';
import { InputManager } from './input/InputManager.js';
import { PlayerCar } from './cars/PlayerCar.js';
import { AICar } from './cars/AICar.js';

// Example setup for player car
const playerCar = new PlayerCar({ x: 100, y: 500, speed: 0, color: '#00d4ff' });
const playerController = new PlayerController();
const carPhysics = new CarPhysics();
const inputManager = new InputManager();

// Example setup for AI cars
const aiCars = [];
const aiControllers = [];
for (let i = 0; i < 9; i++) {
  aiCars.push(new AICar({
    x: 100 + i * 20,
    y: 300 - i * 40,
    speed: 0,
    color: '#f00',
    speedFactor: 1.1 + Math.random() * 0.4,
    aggression: 0.7 + Math.random() * 0.6
  }));
  aiControllers.push(new AIController());
}

const allCars = [playerCar, ...aiCars];

// Example track (placeholder)
const track = new Track({});

// Game loop (simplified)
function gameLoop(dt) {
  // Update input
  inputManager.update();
  // Player input
  const playerInput = playerController.getInput(inputManager.state);
  carPhysics.update(playerCar, playerInput, dt, track.getSurfaceAt(playerCar));
  // AI input
  for (let i = 0; i < aiCars.length; i++) {
    const aiInput = aiControllers[i].decide(aiCars[i], { allCars, playerCar }, track);
    carPhysics.update(aiCars[i], aiInput, dt, track.getSurfaceAt(aiCars[i]));
  }
  // Lap and position logic
  const TRACK_LENGTH = 1200; // Example lap length in pixels
  updateLapAndDistance(playerCar);
  aiCars.forEach(updateLapAndDistance);
  const playerPos = getRacePosition(playerCar, allCars);
  // ...draw, update race state, etc.
}

// Rendering setup
const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');

function drawCar2D(car) {
  ctx.save();
  ctx.translate(car.x, car.y);
  ctx.fillStyle = car.color;
  ctx.fillRect(-18, -30, 36, 60); // Simple rectangle for car body
  ctx.restore();
}

function render() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  // Center player car vertically
  const centerY = canvas.height / 2;
  const yOffset = centerY - playerCar.y;
  // Draw all cars with y offset
  function drawCar2DOffset(car) {
    ctx.save();
    ctx.translate(car.x, car.y + yOffset);
    ctx.fillStyle = car.color;
    ctx.fillRect(-18, -30, 36, 60);
    ctx.restore();
  }
  drawCar2DOffset(playerCar);
  aiCars.forEach(drawCar2DOffset);
  // UI overlays
  ctx.fillStyle = '#fff';
  ctx.font = '18px monospace';
  ctx.fillText(`Lap: ${playerCar.lap}`, 20, 30);
  ctx.fillText(`Pos: ${getRacePosition(playerCar, allCars)}/${allCars.length}`, 20, 55);
}

let lastTimestamp = performance.now();
function animationLoop(timestamp) {
  const dt = Math.min((timestamp - lastTimestamp) / 1000, 0.05); // seconds
  lastTimestamp = timestamp;
  gameLoop(dt);
  render();
  requestAnimationFrame(animationLoop);
}

// Start the animation loop
animationLoop(performance.now());

// Lap and position logic
const TRACK_LENGTH = 1200; // Example lap length in pixels

function updateLapAndDistance(car) {
  car.distance += car.speed;
  car.lapDistance += car.speed;
  if (car.lapDistance >= TRACK_LENGTH) {
    car.lap++;
    car.lapDistance -= TRACK_LENGTH;
  }
}

function getRacePosition(targetCar, allCars) {
  // Lower lap = behind, if same lap, compare lapDistance
  return 1 + allCars.filter(c => (c.lap > targetCar.lap) || (c.lap === targetCar.lap && c.lapDistance > targetCar.lapDistance)).length;
}
