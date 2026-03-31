// AICar.js
// Specialized AI car logic for rendering and update
import { Car } from './Car.js';

export class AICar extends Car {
  constructor(params) {
    super({ ...params, isPlayer: false });
    // Each AI car gets a unique speed factor and aggression
    this.speedFactor = params.speedFactor || (1.1 + Math.random() * 0.4); // 1.1–1.5
    this.aggression = params.aggression || (0.7 + Math.random() * 0.6); // 0.7–1.3
  }
  // Optionally add AI-specific update/render methods
}
