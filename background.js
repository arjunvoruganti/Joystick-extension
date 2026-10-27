const OFFSCREEN_DOCUMENT_PATH = '/offscreen.html';

const DEFAULT_CONFIG = {
  NEXT_TAB_BUTTON: 5,
  PREV_TAB_BUTTON: 4,
  REFRESH_BUTTON: 10,
  MOUSE_X_AXIS: 6,
  MOUSE_Y_AXIS: 7,
  SCROLL_Y_AXIS: null,
  CURSOR_SPEED: 2,
  CURSOR_SIZE: 20,
  SCROLL_SPEED: 20,
  DEADZONE: 0.2,
  ENABLE_OSK: true,
  CUSTOM_ACTIONS: [
    { id: 0, action: 'click', button: 2 },
    { id: 1, action: 'scroll_down', button: 1 },
    { id: 2, action: 'scroll_up', button: 0 }
  ]
};

let config = { ...DEFAULT_CONFIG };
let configLoaded = false;
let buttonStates = {};
let creatingOffscreen = null;

async function ensureConfigLoaded() {
  if (configLoaded) return;
  const saved = await chrome.storage.sync.get(null);
  const toSave = {};

  for (const [key, defaultVal] of Object.entries(DEFAULT_CONFIG)) {
    if (saved[key] === undefined || (key === 'CUSTOM_ACTIONS' && (!Array.isArray(saved[key]) || saved[key].length === 0))) {
      toSave[key] = defaultVal;
    }
  }

  config = { ...DEFAULT_CONFIG, ...saved, ...toSave };
  configLoaded = true;

  if (Object.keys(toSave).length > 0) {
    await chrome.storage.sync.set(toSave);
  }
}

// Keep in-memory config synchronized without querying storage on every tick
chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== 'sync') return;
  for (const [key, { newValue }] of Object.entries(changes)) {
    config[key] = newValue !== undefined ? newValue : DEFAULT_CONFIG[key];
  }
});

async function setupOffscreenDocument(path) {
  const existingContexts = await chrome.runtime.getContexts({
    contextTypes: [chrome.runtime.ContextType.OFFSCREEN_DOCUMENT]
  });
  if (existingContexts.length > 0) return;

  if (creatingOffscreen) {
    await creatingOffscreen;
    return;
  }

  creatingOffscreen = chrome.offscreen.createDocument({
    url: path,
    reasons: ['BLOBS'],
    justification: 'Polling for gamepad input'
  });

  try {
    await creatingOffscreen;
  } finally {
    creatingOffscreen = null;
  }
}

// Initialize on service worker startup, install, and wake-up
setupOffscreenDocument(OFFSCREEN_DOCUMENT_PATH);
ensureConfigLoaded();

chrome.runtime.onStartup.addListener(() => {
  setupOffscreenDocument(OFFSCREEN_DOCUMENT_PATH);
  ensureConfigLoaded();
});

chrome.runtime.onInstalled.addListener(async () => {
  await ensureConfigLoaded();
  await setupOffscreenDocument(OFFSCREEN_DOCUMENT_PATH);
  chrome.runtime.openOptionsPage();
});

chrome.runtime.onMessage.addListener((message) => {
  if (message.type === 'gamepad-data' && message.gamepad) {
    handleGamepadInput(message.gamepad);
  } else if (message.type === 'browser-action') {
    handleBrowserAction(message.action);
  }
});

async function getActiveTab() {
  let [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  if (!tab) {
    [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  }
  return tab;
}

async function handleBrowserAction(action) {
  if (action === 'next_tab') switchToNextTab();
  else if (action === 'prev_tab') switchToPrevTab();
  else if (action === 'refresh') refreshCurrentTab();
  else if (action === 'new_tab') chrome.tabs.create({});
  else if (action === 'close_tab') {
    const tab = await getActiveTab();
    if (tab?.id) chrome.tabs.remove(tab.id);
  }
}

async function handleGamepadInput(gamepad) {
  if (!configLoaded) {
    await ensureConfigLoaded();
  }

  const nextTabBtn = config.NEXT_TAB_BUTTON;
  const prevTabBtn = config.PREV_TAB_BUTTON;
  const refreshBtn = config.REFRESH_BUTTON;

  // Handle browser-level actions directly on rising button edge
  if (nextTabBtn !== null && nextTabBtn !== undefined &&
      gamepad.buttons[nextTabBtn]?.pressed && !buttonStates[nextTabBtn]) {
    switchToNextTab();
  }
  if (prevTabBtn !== null && prevTabBtn !== undefined &&
      gamepad.buttons[prevTabBtn]?.pressed && !buttonStates[prevTabBtn]) {
    switchToPrevTab();
  }
  if (refreshBtn !== null && refreshBtn !== undefined &&
      gamepad.buttons[refreshBtn]?.pressed && !buttonStates[refreshBtn]) {
    refreshCurrentTab();
  }

  // Forward joystick data to the active tab content script
  sendMessageToContentScript({
    command: 'joystick_update',
    gamepad: gamepad
  });

  gamepad.buttons.forEach((button, i) => {
    buttonStates[i] = button.pressed;
  });
}

async function switchToNextTab() {
  const tabs = await chrome.tabs.query({ lastFocusedWindow: true });
  const activeTab = tabs.find(tab => tab.active);
  if (!activeTab || tabs.length <= 1) return;
  const nextIndex = (activeTab.index + 1) % tabs.length;
  chrome.tabs.update(tabs[nextIndex].id, { active: true });
}

async function switchToPrevTab() {
  const tabs = await chrome.tabs.query({ lastFocusedWindow: true });
  const activeTab = tabs.find(tab => tab.active);
  if (!activeTab || tabs.length <= 1) return;
  const prevIndex = (activeTab.index - 1 + tabs.length) % tabs.length;
  chrome.tabs.update(tabs[prevIndex].id, { active: true });
}

async function refreshCurrentTab() {
  const tab = await getActiveTab();
  if (tab?.id) chrome.tabs.reload(tab.id);
}

async function sendMessageToContentScript(message) {
  const tab = await getActiveTab();
  if (tab?.id) {
    try {
      await chrome.tabs.sendMessage(tab.id, message);
    } catch {
      // Ignore errors on restricted pages (e.g. chrome://) where content scripts cannot run
    }
  }
}
