// Car.js
// Represents a car (player or AI) in the race

export class Car {
  constructor(params) {
    this.x = params.x || 0;
    this.y = params.y || 0;
    this.vx = 0;
    this.vy = 0;
    this.speed = params.speed || 0;
    this.heading = params.heading || 0;
    this.throttle = 0;
    this.brake = false;
    this.steer = 0;
    this.tireWear = 0;
    this.damage = 0;
    this.isPlayer = !!params.isPlayer;
    this.color = params.color || '#fff';
    this.lap = 1;
    this.distance = 0;
    this.lapDistance = 0;
    // ...add more as needed
  }
}
