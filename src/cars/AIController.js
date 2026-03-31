// AIController.js
// Handles AI driving logic and racecraft

export class AIController {
  decide(car, raceState, track) {
    // Follow racing line
    const target = track.getRacingLinePoint(car.position, car.speed);
    // Overtake if faster and gap exists
    // Defensive if player is close behind
    // Pit strategy, mistakes, aggression, etc.
    // Also avoid hitting the player car from behind (SWIFT lane change)
    if (raceState.playerCar) {
      const player = raceState.playerCar;
      const dx = Math.abs(player.x - car.x);
      const dy = player.y - car.y;
      if (dx < 10 && dy > 0 && dy < safeGap) {
        // Try to change lane (more aggressive offset)
        const laneOffsets = [-80, 80, -40, 40];
        let foundLane = false;
        for (const offset of laneOffsets) {
          const targetX = car.x + offset;
          const laneFree = !allCars.some(o => o !== car && Math.abs(o.x - targetX) < 10 && Math.abs(o.y - car.y) < safeGap);
          if (laneFree) {
            steer = offset < 0 ? -1 : 1;
            foundLane = true;
            break;
          }
        }
        if (!foundLane) {
          throttle = 0.7;
          brake = 0.3;
        }
      }
    }
    // If not blocked by another car or player, always use max throttle
    if (!blocked) {
      throttle = 1;
      brake = 0;
      // Try to overtake if possible (prefer lane change over slowing)
      // Already handled above, so just ensure no unnecessary delay
    }
    // Use car's own speedFactor and aggression for pace
    let baseThrottle = car.speedFactor;
    throttle = Math.min(1, baseThrottle);
    // Optionally, use aggression to bias overtaking or risk
    // Return control inputs: { throttle, brake, steer, drs, ers }
    return {
      throttle: 1,
      brake: 0,
      steer: 0,
      drs: false,
      ers: false
    };
  }
}
