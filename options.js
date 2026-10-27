document.addEventListener('DOMContentLoaded', () => {
    const coreActions = ['NEXT_TAB_BUTTON', 'PREV_TAB_BUTTON', 'REFRESH_BUTTON'];
    const axisKeys = ['MOUSE_X_AXIS', 'MOUSE_Y_AXIS', 'SCROLL_Y_AXIS'];
    const customActionsContainer = document.getElementById('custom-actions-container');
    const addActionButton = document.getElementById('add-action-btn');
    const resetDefaultsButton = document.getElementById('reset-defaults-btn');
    const template = document.getElementById('action-template');
    const statusEl = document.getElementById('status');

    const enableOskCheckbox = document.getElementById('ENABLE_OSK_checkbox');
    const cursorSpeedSlider = document.getElementById('CURSOR_SPEED_slider');
    const cursorSpeedValue = document.getElementById('CURSOR_SPEED_value');
    const cursorSizeSlider = document.getElementById('CURSOR_SIZE_slider');
    const cursorSizeValue = document.getElementById('CURSOR_SIZE_value');
    const scrollSpeedSlider = document.getElementById('SCROLL_SPEED_slider');
    const scrollSpeedValue = document.getElementById('SCROLL_SPEED_value');
    const deadzoneSlider = document.getElementById('DEADZONE_slider');
    const deadzoneValue = document.getElementById('DEADZONE_value');

    const DEFAULT_SETTINGS = {
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

    let listeningMode = null; // 'button' | 'axis' | null
    let activeListenElement = null;
    let gamepadLoop = null;
    let waitForRelease = false;
    let baselineAxes = [];

    function showStatus(msg, duration = 1500) {
        statusEl.textContent = msg;
        if (duration > 0) {
            setTimeout(() => {
                if (statusEl.textContent === msg) {
                    statusEl.textContent = '';
                }
            }, duration);
        }
    }

    function saveSettings(statusMessage = 'Settings saved!') {
        const settings = {};

        // Save core actions
        coreActions.forEach(action => {
            const displayEl = document.getElementById(`${action}_display`);
            const buttonText = displayEl.textContent.trim();
            if (buttonText.startsWith('Button ')) {
                const parsed = parseInt(buttonText.replace('Button ', ''), 10);
                settings[action] = !Number.isNaN(parsed) ? parsed : null;
            } else {
                settings[action] = null;
            }
        });

        // Save axis mappings
        axisKeys.forEach(axisKey => {
            const displayEl = document.getElementById(`${axisKey}_display`);
            const axisText = displayEl.textContent.trim();
            if (axisText.startsWith('Axis ')) {
                const parsed = parseInt(axisText.replace('Axis ', ''), 10);
                settings[axisKey] = !Number.isNaN(parsed) ? parsed : null;
            } else {
                settings[axisKey] = null;
            }
        });

        // Save sensitivity & OSK settings
        settings.ENABLE_OSK = Boolean(enableOskCheckbox.checked);
        settings.CURSOR_SPEED = Number(cursorSpeedSlider.value);
        settings.CURSOR_SIZE = Number(cursorSizeSlider.value);
        settings.SCROLL_SPEED = Number(scrollSpeedSlider.value);
        settings.DEADZONE = Number(deadzoneSlider.value);

        // Save custom page actions
        const customActions = [];
        customActionsContainer.querySelectorAll('.action').forEach((actionRow, index) => {
            const action = actionRow.querySelector('.action-select').value;
            const buttonDisplay = actionRow.querySelector('.button-display').textContent.trim();
            let button = null;
            if (buttonDisplay.startsWith('Button ')) {
                const parsed = parseInt(buttonDisplay.replace('Button ', ''), 10);
                if (!Number.isNaN(parsed)) {
                    button = parsed;
                }
            }
            customActions.push({ id: index, action: action, button: button });
        });
        settings.CUSTOM_ACTIONS = customActions;

        chrome.storage.sync.set(settings, () => {
            if (statusMessage) showStatus(statusMessage);
        });
    }

    function renderCustomAction(actionData = {}) {
        const clone = template.content.cloneNode(true);
        const actionRow = clone.querySelector('.action');
        const selectEl = actionRow.querySelector('.action-select');
        const buttonDisplay = actionRow.querySelector('.button-display');
        const setBtn = actionRow.querySelector('.set-btn');
        const removeBtn = actionRow.querySelector('.remove-btn');

        if (actionData.action) {
            selectEl.value = actionData.action;
        }
        if (actionData.button !== undefined && actionData.button !== null) {
            buttonDisplay.textContent = `Button ${actionData.button}`;
        } else {
            buttonDisplay.textContent = 'Not Set';
        }

        selectEl.addEventListener('change', () => saveSettings());
        setBtn.addEventListener('click', () => startListening(buttonDisplay, 'button'));
        removeBtn.addEventListener('click', () => {
            actionRow.remove();
            saveSettings();
        });

        customActionsContainer.appendChild(actionRow);
    }

    function applySettingsToUI(settings) {
        coreActions.forEach(action => {
            const displayEl = document.getElementById(`${action}_display`);
            const val = settings[action];
            displayEl.textContent = (val !== undefined && val !== null) ? `Button ${val}` : 'Not Set';
        });

        axisKeys.forEach(axisKey => {
            const displayEl = document.getElementById(`${axisKey}_display`);
            const val = settings[axisKey];
            displayEl.textContent = (val !== undefined && val !== null) ? `Axis ${val}` : 'Not Set';
        });

        enableOskCheckbox.checked = settings.ENABLE_OSK !== undefined ? Boolean(settings.ENABLE_OSK) : DEFAULT_SETTINGS.ENABLE_OSK;

        const cursorSpeed = settings.CURSOR_SPEED ?? DEFAULT_SETTINGS.CURSOR_SPEED;
        cursorSpeedSlider.value = cursorSpeed;
        cursorSpeedValue.textContent = cursorSpeed;

        const cursorSize = settings.CURSOR_SIZE ?? DEFAULT_SETTINGS.CURSOR_SIZE;
        cursorSizeSlider.value = cursorSize;
        cursorSizeValue.textContent = `${cursorSize}px`;

        const scrollSpeed = settings.SCROLL_SPEED ?? DEFAULT_SETTINGS.SCROLL_SPEED;
        scrollSpeedSlider.value = scrollSpeed;
        scrollSpeedValue.textContent = scrollSpeed;

        const deadzone = settings.DEADZONE ?? DEFAULT_SETTINGS.DEADZONE;
        deadzoneSlider.value = deadzone;
        deadzoneValue.textContent = Number(deadzone).toFixed(2);

        customActionsContainer.innerHTML = '';
        const customActions = Array.isArray(settings.CUSTOM_ACTIONS) && settings.CUSTOM_ACTIONS.length > 0
            ? settings.CUSTOM_ACTIONS
            : DEFAULT_SETTINGS.CUSTOM_ACTIONS;

        customActions.forEach(renderCustomAction);
    }

    function loadSettings() {
        chrome.storage.sync.get(null, (stored) => {
            let needsInitialSave = false;
            const effectiveSettings = { ...stored };

            for (const [key, defaultVal] of Object.entries(DEFAULT_SETTINGS)) {
                if (effectiveSettings[key] === undefined || (key === 'CURSOR_SPEED' && effectiveSettings[key] === 15)) {
                    effectiveSettings[key] = defaultVal;
                    needsInitialSave = true;
                }
            }

            if (!Array.isArray(effectiveSettings.CUSTOM_ACTIONS) || effectiveSettings.CUSTOM_ACTIONS.length === 0) {
                effectiveSettings.CUSTOM_ACTIONS = DEFAULT_SETTINGS.CUSTOM_ACTIONS;
                needsInitialSave = true;
            }

            applySettingsToUI(effectiveSettings);

            if (needsInitialSave) {
                saveSettings('');
            }
        });
    }

    function getActiveGamepad() {
        const gamepads = navigator.getGamepads ? Array.from(navigator.getGamepads()).filter(Boolean) : [];
        if (gamepads.length === 0) return null;
        return gamepads.find(gp =>
            gp.buttons.some(b => b.pressed) ||
            gp.axes.some(a => Math.abs(a) > 0.2)
        ) || gamepads[0];
    }

    function startListening(displayElement, mode = 'button') {
        listeningMode = mode;
        activeListenElement = displayElement;
        waitForRelease = true;
        const gp = getActiveGamepad();
        baselineAxes = gp ? Array.from(gp.axes) : [];

        showStatus(
            mode === 'axis'
                ? 'Listening... Move a joystick axis.'
                : 'Listening... Press a joystick button.',
            0
        );
        if (!gamepadLoop) {
            gamepadLoop = requestAnimationFrame(detectGamepadInput);
        }
    }

    function detectGamepadInput() {
        const gamepad = getActiveGamepad();

        if (gamepad && listeningMode) {
            if (listeningMode === 'button') {
                const anyPressed = gamepad.buttons.some(b => b.pressed);
                if (waitForRelease) {
                    if (!anyPressed) waitForRelease = false;
                } else {
                    for (let index = 0; index < gamepad.buttons.length; index++) {
                        if (gamepad.buttons[index].pressed) {
                            activeListenElement.textContent = `Button ${index}`;
                            finishListening('Button set & saved!');
                            return;
                        }
                    }
                }
            } else if (listeningMode === 'axis') {
                for (let index = 0; index < gamepad.axes.length; index++) {
                    const base = baselineAxes[index] ?? 0;
                    if (Math.abs(gamepad.axes[index] - base) > 0.45 && Math.abs(gamepad.axes[index]) > 0.5) {
                        activeListenElement.textContent = `Axis ${index}`;
                        finishListening('Axis set & saved!');
                        return;
                    }
                }
            }
        }

        if (listeningMode) {
            gamepadLoop = requestAnimationFrame(detectGamepadInput);
        }
    }

    function finishListening(message) {
        listeningMode = null;
        activeListenElement = null;
        saveSettings(message);
        if (gamepadLoop) {
            cancelAnimationFrame(gamepadLoop);
            gamepadLoop = null;
        }
    }

    document.querySelectorAll('button[data-action]').forEach(button => {
        const action = button.dataset.action;
        const displayEl = document.getElementById(`${action}_display`);
        button.addEventListener('click', () => startListening(displayEl, 'button'));
    });

    document.querySelectorAll('button[data-clear-action]').forEach(button => {
        const action = button.dataset.clearAction;
        const displayEl = document.getElementById(`${action}_display`);
        button.addEventListener('click', () => {
            displayEl.textContent = 'Not Set';
            saveSettings('Core action cleared!');
        });
    });

    document.querySelectorAll('button[data-axis]').forEach(button => {
        const axisKey = button.dataset.axis;
        const displayEl = document.getElementById(`${axisKey}_display`);
        button.addEventListener('click', () => startListening(displayEl, 'axis'));
    });

    document.querySelectorAll('button[data-clear-axis]').forEach(button => {
        const axisKey = button.dataset.clearAxis;
        const displayEl = document.getElementById(`${axisKey}_display`);
        button.addEventListener('click', () => {
            displayEl.textContent = 'Not Set';
            saveSettings('Axis cleared!');
        });
    });

    enableOskCheckbox.addEventListener('change', () => saveSettings());

    cursorSpeedSlider.addEventListener('input', () => {
        cursorSpeedValue.textContent = cursorSpeedSlider.value;
    });
    cursorSpeedSlider.addEventListener('change', () => saveSettings());

    cursorSizeSlider.addEventListener('input', () => {
        cursorSizeValue.textContent = `${cursorSizeSlider.value}px`;
    });
    cursorSizeSlider.addEventListener('change', () => saveSettings());

    scrollSpeedSlider.addEventListener('input', () => {
        scrollSpeedValue.textContent = scrollSpeedSlider.value;
    });
    scrollSpeedSlider.addEventListener('change', () => saveSettings());

    deadzoneSlider.addEventListener('input', () => {
        deadzoneValue.textContent = Number(deadzoneSlider.value).toFixed(2);
    });
    deadzoneSlider.addEventListener('change', () => saveSettings());

    addActionButton.addEventListener('click', () => {
        renderCustomAction({ action: 'click', button: null });
        saveSettings();
    });

    resetDefaultsButton.addEventListener('click', () => {
        applySettingsToUI(DEFAULT_SETTINGS);
        saveSettings('Defaults restored & saved!');
    });

    loadSettings();
});
