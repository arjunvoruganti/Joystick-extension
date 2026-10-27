setInterval(async () => {
  const gamepads = navigator.getGamepads();
  const gamepad = gamepads[0];

  if (gamepad) {
    const serializableGamepad = {
      axes: Array.from(gamepad.axes),
      buttons: gamepad.buttons.map(b => ({ pressed: b.pressed }))
    };
    
    chrome.runtime.sendMessage({
      type: 'gamepad-data',
      gamepad: serializableGamepad
    });
  }
}, 100);
