// CarPhysics.js
// Handles 2D F1 car physics for realistic driving feel

export class CarPhysics {
  update(car, input, dt, trackSurface) {
    // Acceleration/braking
    car.speed += (input.throttle - input.brake * car.brakePower) * car.accel * dt;
    // Steering sensitivity decreases with speed
    const steerEffect = input.steer * Math.max(0.3, 1 - car.speed / car.maxSpeed);
    car.heading += steerEffect * car.steerRate * dt;
    // Grip/traction
    const grip = trackSurface.grip * (1 - car.tireWear * 0.5);
    if (Math.abs(steerEffect) > grip) car.slip += (Math.abs(steerEffect) - grip) * dt;
    // Kerb/grass
    if (trackSurface.type === 'kerb') car.speed *= 0.98;
    if (trackSurface.type === 'grass') car.speed *= 0.95;
    // TODO: Draft, dirty air, damage, etc.
  }
}
