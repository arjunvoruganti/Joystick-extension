const OFFSCREEN_DOCUMENT_PATH = '/offscreen.html';

async function setupOffscreenDocument(path) {
  const existingContexts = await chrome.runtime.getContexts({
    contextTypes: [chrome.runtime.ContextType.OFFSCREEN_DOCUMENT]
  });
  if (existingContexts.length > 0) return;
  await chrome.offscreen.createDocument({
    url: path,
    reasons: ['BLOBS'],
    justification: 'Polling for gamepad input'
  });
}

chrome.runtime.onStartup.addListener(() => setupOffscreenDocument(OFFSCREEN_DOCUMENT_PATH));
chrome.runtime.onInstalled.addListener(() => {
    setupOffscreenDocument(OFFSCREEN_DOCUMENT_PATH);
    chrome.runtime.openOptionsPage();
});

chrome.runtime.onMessage.addListener(handleGamepadInput);

let buttonStates = {};

async function handleGamepadInput(message) {
  if (message.type !== 'gamepad-data' || !message.gamepad) return;

  // FIX: Load saved settings just-in-time
  const config = await chrome.storage.sync.get(null);
  const gamepad = message.gamepad;
  
  // Handle browser-level actions directly
  if (gamepad.buttons[config.NEXT_TAB_BUTTON]?.pressed && !buttonStates[config.NEXT_TAB_BUTTON]) {
    switchToNextTab();
  }
  if (gamepad.buttons[config.PREV_TAB_BUTTON]?.pressed && !buttonStates[config.PREV_TAB_BUTTON]) {
    switchToPrevTab();
  }
  if (gamepad.buttons[config.REFRESH_BUTTON]?.pressed && !buttonStates[config.REFRESH_BUTTON]) {
    refreshCurrentTab();
  }
  
  // Forward joystick data to the content script for page-level actions
  sendMessageToContentScript({
      command: 'joystick_update',
      gamepad: gamepad
  });

  gamepad.buttons.forEach((button, i) => { buttonStates[i] = button.pressed; });
}

async function switchToNextTab() {
  const tabs = await chrome.tabs.query({ currentWindow: true });
  const activeTab = tabs.find(tab => tab.active);
  if (tabs.length <= 1) return;
  let nextIndex = (activeTab.index + 1) % tabs.length;
  chrome.tabs.update(tabs[nextIndex].id, { active: true });
}

async function switchToPrevTab() {
  const tabs = await chrome.tabs.query({ currentWindow: true });
  const activeTab = tabs.find(tab => tab.active);
  if (tabs.length <= 1) return;
  let prevIndex = (activeTab.index - 1 + tabs.length) % tabs.length;
  chrome.tabs.update(tabs[prevIndex].id, { active: true });
}

async function refreshCurrentTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab) chrome.tabs.reload(tab.id);
}

async function sendMessageToContentScript(message) {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab) {
    try { await chrome.tabs.sendMessage(tab.id, message); }
    catch(e) { /* Ignore errors on pages where content script can't run */ }
  }
}
