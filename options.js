document.addEventListener('DOMContentLoaded', () => {
    const coreActions = ['NEXT_TAB_BUTTON', 'PREV_TAB_BUTTON', 'REFRESH_BUTTON'];
    const customActionsContainer = document.getElementById('custom-actions-container');
    const addActionButton = document.getElementById('add-action-btn');
    const template = document.getElementById('action-template');
    const statusEl = document.getElementById('status');
    
    let listeningFor = null;
    let activeListenElement = null;
    let gamepadLoop = null;

    function saveSettings() {
        const settings = {};
        // Save core actions
        coreActions.forEach(action => {
            const displayEl = document.getElementById(`${action}_display`);
            const buttonText = displayEl.textContent;
            if (buttonText.startsWith('Button')) {
                settings[action] = parseInt(buttonText.replace('Button ', ''));
            }
        });

        // Save custom actions
        const customActions = [];
        customActionsContainer.querySelectorAll('.action').forEach((actionRow, index) => {
            const action = actionRow.querySelector('.action-select').value;
            const buttonDisplay = actionRow.querySelector('.button-display').textContent;
            if (buttonDisplay.startsWith('Button')) {
                const button = parseInt(buttonDisplay.replace('Button ', ''));
                customActions.push({ id: index, action: action, button: button });
            }
        });
        settings.CUSTOM_ACTIONS = customActions;

        chrome.storage.sync.set(settings, () => {
            statusEl.textContent = 'Settings saved!';
            setTimeout(() => { statusEl.textContent = ''; }, 1500);
        });
    }

    function renderCustomAction(actionData = {}) {
        const clone = template.content.cloneNode(true);
        const actionRow = clone.querySelector('.action');
        const selectEl = actionRow.querySelector('.action-select');
        const buttonDisplay = actionRow.querySelector('.button-display');
        const setBtn = actionRow.querySelector('.set-btn');
        const removeBtn = actionRow.querySelector('.remove-btn');

        if (actionData.action) selectEl.value = actionData.action;
        if (actionData.button !== undefined) buttonDisplay.textContent = `Button ${actionData.button}`;

        selectEl.addEventListener('change', saveSettings);
        setBtn.addEventListener('click', () => startListening(buttonDisplay));
        removeBtn.addEventListener('click', () => {
            actionRow.remove();
            saveSettings();
        });

        customActionsContainer.appendChild(actionRow);
    }

    function loadSettings() {
        chrome.storage.sync.get(null, (settings) => {
            coreActions.forEach(action => {
                const displayEl = document.getElementById(`${action}_display`);
                if (settings[action] !== undefined) {
                    displayEl.textContent = `Button ${settings[action]}`;
                }
            });

            customActionsContainer.innerHTML = ''; // Clear existing
            const customActions = settings.CUSTOM_ACTIONS || [];
            if (customActions.length > 0) {
                customActions.forEach(renderCustomAction);
            } else {
                // Add some defaults for the first time
                renderCustomAction({ action: 'click', button: 0 });
                renderCustomAction({ action: 'scroll_down', button: 1 });
            }
        });
    }

    function startListening(displayElement) {
        listeningFor = true;
        activeListenElement = displayElement;
        statusEl.textContent = 'Listening... Press a joystick button.';
        if (!gamepadLoop) gamepadLoop = requestAnimationFrame(detectButtonPress);
    }

    function detectButtonPress() {
        const gamepads = navigator.getGamepads();
        const gamepad = gamepads[0];

        if (gamepad && listeningFor) {
            gamepad.buttons.forEach((button, index) => {
                if (button.pressed) {
                    activeListenElement.textContent = `Button ${index}`;
                    listeningFor = false;
                    activeListenElement = null;
                    statusEl.textContent = 'Button set!';
                    saveSettings();
                    cancelAnimationFrame(gamepadLoop);
                    gamepadLoop = null;
                }
            });
        }
        if (listeningFor) requestAnimationFrame(detectButtonPress);
    }
    
    document.querySelectorAll('button[data-action]').forEach(button => {
        const action = button.dataset.action;
        const displayEl = document.getElementById(`${action}_display`);
        button.addEventListener('click', () => startListening(displayEl));
    });

    addActionButton.addEventListener('click', () => renderCustomAction());

    loadSettings();
});
