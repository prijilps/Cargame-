// PlayerController.js
// Handles player input and assists

export class PlayerController {
  getInput(inputState) {
    // Map keyboard/gamepad/touch to car controls
    return {
      throttle: inputState.up ? 1 : 0,
      brake: inputState.down ? 1 : 0,
      steer: (inputState.left ? -1 : 0) + (inputState.right ? 1 : 0),
      drs: inputState.drs,
      ers: inputState.ers
    };
  }
}
