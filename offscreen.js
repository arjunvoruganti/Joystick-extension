function isExtensionContextValid() {
  try {
    return Boolean(typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.id);
  } catch {
    return false;
  }
}

function getActiveGamepad() {
  const gamepads = navigator.getGamepads ? Array.from(navigator.getGamepads()).filter(Boolean) : [];
  if (gamepads.length === 0) return null;

  const active = gamepads.find(gp =>
    gp.buttons.some(b => b.pressed) ||
    gp.axes.some(axis => typeof axis === 'number' && Math.abs(axis) <= 1.05 && Math.abs(axis) > 0.05)
  );
  return active || gamepads[0];
}

const pollTimer = setInterval(() => {
  if (!isExtensionContextValid()) {
    clearInterval(pollTimer);
    return;
  }

  const gamepad = getActiveGamepad();

  if (gamepad) {
    const serializableGamepad = {
      axes: Array.from(gamepad.axes),
      buttons: gamepad.buttons.map(b => ({ pressed: b.pressed }))
    };

    try {
      chrome.runtime.sendMessage({
        type: 'gamepad-data',
        gamepad: serializableGamepad
      }).catch(() => {});
    } catch {
      clearInterval(pollTimer);
    }
  }
}, 50);
