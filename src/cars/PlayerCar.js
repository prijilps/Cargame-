// PlayerCar.js
// Specialized player car logic for rendering and update
import { Car } from './Car.js';

export class PlayerCar extends Car {
  constructor(params) {
    super({ ...params, isPlayer: true });
    // Add player-specific properties if needed
  }
  // Optionally add player-specific update/render methods
}
