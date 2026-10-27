// This is the final, stable version.

// Create the cursor and add it to the page
const cursor = document.createElement('div');
cursor.id = 'joystick-cursor';
document.body.appendChild(cursor);

// All state is managed here
const state = {
    buttonStates: {},
    cursorX: window.innerWidth / 2,
    cursorY: window.innerHeight / 2
};

// --- Default settings, will be overwritten by saved config ---
let config = {
    MOUSE_X_AXIS: 6,
    MOUSE_Y_AXIS: 7,
    CUSTOM_ACTIONS: []
};

// --- Settings ---
const CURSOR_SPEED = 15;
const SCROLL_SPEED = 20;
const DEADZONE = 0.2;

// Load all settings from storage
chrome.storage.sync.get(null, (settings) => {
    config = { ...config, ...settings };
    console.log("Joystick page settings loaded:", config);
});

// Listen for changes to update settings in real-time
chrome.storage.onChanged.addListener((changes) => {
    for (let [key, { newValue }] of Object.entries(changes)) {
        config[key] = newValue;
    }
    console.log("Joystick page settings updated:", config);
});

// Listen for joystick updates from the background script
chrome.runtime.onMessage.addListener((message) => {
    if (message.command === 'joystick_update') {
        handleJoystickUpdate(message.gamepad);
    }
});

function handleJoystickUpdate(gamepad) {
    if (!gamepad) return;

    // 1. Handle Cursor Movement
    let axisXIndex = config.MOUSE_X_AXIS !== undefined ? config.MOUSE_X_AXIS : 6;
    let axisYIndex = config.MOUSE_Y_AXIS !== undefined ? config.MOUSE_Y_AXIS : 7;

    let stickX = gamepad.axes[axisXIndex] || 0;
    let stickY = gamepad.axes[axisYIndex] || 0;

    // The Greedy Axis Fallback: 
    // Chrome frequently updates underlying HID device mappings. If the physical 
    // axes 6 and 7 are now mapping to standard axes, we catch them dynamically here.
    if (Math.abs(stickX) < DEADZONE) {
        if (gamepad.axes[0] && Math.abs(gamepad.axes[0]) > DEADZONE) stickX = gamepad.axes[0];
        else if (gamepad.axes[2] && Math.abs(gamepad.axes[2]) > DEADZONE) stickX = gamepad.axes[2];
    }
    
    if (Math.abs(stickY) < DEADZONE) {
        if (gamepad.axes[1] && Math.abs(gamepad.axes[1]) > DEADZONE) stickY = gamepad.axes[1];
        else if (gamepad.axes[3] && Math.abs(gamepad.axes[3]) > DEADZONE) stickY = gamepad.axes[3];
    }

    if (Math.abs(stickX) > DEADZONE) state.cursorX += stickX * CURSOR_SPEED;
    if (Math.abs(stickY) > DEADZONE) state.cursorY += stickY * CURSOR_SPEED;
    
    state.cursorX = Math.max(0, Math.min(window.innerWidth - 20, state.cursorX));
    state.cursorY = Math.max(0, Math.min(window.innerHeight - 20, state.cursorY));
    
    cursor.style.transform = `translate(${state.cursorX}px, ${state.cursorY}px)`;

    // 2. Handle dynamically configured actions
    if (config.CUSTOM_ACTIONS && Array.isArray(config.CUSTOM_ACTIONS)) {
        config.CUSTOM_ACTIONS.forEach(item => {
            const buttonIsPressed = gamepad.buttons[item.button]?.pressed;
            const buttonWasPressed = state.buttonStates[item.button];

            // For continuous actions like scrolling, we don't check if it "was pressed"
            if (item.action === 'scroll_up' || item.action === 'scroll_down') {
                if (buttonIsPressed) {
                    executePageAction(item.action);
                }
            } 
            // For single-shot actions, we check for a new press
            else {
                if (buttonIsPressed && !buttonWasPressed) {
                    executePageAction(item.action);
                }
            }
        });
    }

    // Update button states for the next check
    gamepad.buttons.forEach((button, i) => { state.buttonStates[i] = button.pressed; });
}

async function executePageAction(action) {
    const elementUnderCursor = document.elementFromPoint(state.cursorX, state.cursorY);
    
    switch (action) {
        case 'click':
            if (elementUnderCursor) elementUnderCursor.click();
            break;
        case 'scroll_up':
        case 'scroll_down':
            const scrollableContainer = findScrollableParent(elementUnderCursor);
            if (scrollableContainer) {
                const scrollAmount = (action === 'scroll_up' ? -SCROLL_SPEED : SCROLL_SPEED);
                scrollableContainer.scrollBy(0, scrollAmount);
            }
            break;
        case 'copy': 
            document.execCommand('copy');
            break;
        case 'paste':
            try {
                const text = await navigator.clipboard.readText();
                document.execCommand('insertText', false, text);
            } catch (err) {
                console.error('Failed to paste text. Permission might be needed.', err);
            }
            break;
        case 'cut': 
            document.execCommand('cut');
            break;
        case 'undo': 
            document.execCommand('undo');
            break;
        case 'rescan':
            break;
    }
}

function findScrollableParent(element) {
    if (!element) return document.scrollingElement || document.documentElement;
    let parent = element.parentElement;
    while (parent) {
        const style = window.getComputedStyle(parent);
        if (style.overflowY === 'auto' || style.overflowY === 'scroll') {
            if (parent.scrollHeight > parent.clientHeight) return parent;
        }
        parent = parent.parentElement;
    }
    return document.scrollingElement || document.documentElement;
}
