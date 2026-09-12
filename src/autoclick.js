function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Reads the current OS cursor position via the same library (nut-js/libnut) that later
// performs the replay click. Capturing and replaying through the same coordinate space
// is what matters here — Electron's own screen APIs report positions in DIP (scaled by
// each monitor's DPI), while nut-js/Windows operate in physical pixels, so mixing the two
// silently misaligns clicks on any secondary monitor with different scaling. Sampling the
// live cursor instead of a synthetic overlay click sidesteps that mismatch entirely.
async function sampleCursorPosition() {
  const { mouse } = require('@nut-tree-fork/nut-js');
  const pos = await mouse.getPosition();
  return { x: pos.x, y: pos.y };
}

// Waits `delayMs` after the launcher was spawned, then simulates a real OS-level mouse
// click at the saved coordinate — this is what actually presses the launcher's own Play
// button, since Electron itself can't send input into another app's window.
async function replayClick(x, y, delayMs) {
  await sleep(Math.max(0, delayMs || 0));
  const { mouse, Point } = require('@nut-tree-fork/nut-js');
  await mouse.setPosition(new Point(x, y));
  await mouse.leftClick();
}

module.exports = { sampleCursorPosition, replayClick };
