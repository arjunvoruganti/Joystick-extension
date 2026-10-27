// Default settings (overwritten by saved config in chrome.storage.sync)
var DEFAULT_CONFIG = {
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

var config = { ...DEFAULT_CONFIG };

// Helper to safely verify extension context has not been invalidated by an extension reload
function isExtensionContextValid() {
    try {
        return Boolean(typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.id);
    } catch {
        return false;
    }
}

const EDITABLE_FIELD_SELECTOR = [
    'input:not([type="hidden"]):not([type="button"]):not([type="submit"]):not([type="reset"]):not([disabled])',
    'textarea:not([disabled])',
    'select:not([disabled])',
    '[contenteditable="true"]',
    '[contenteditable=""]',
    '[contenteditable="plaintext-only"]',
    '.editablediv',
    '[role="textbox"]'
].join(', ');

const CLICKABLE_CONTROL_SELECTOR = [
    EDITABLE_FIELD_SELECTOR,
    'button:not([disabled])',
    'a[href]',
    'label',
    'summary',
    '.selectablediv',
    '.dragdiv',
    '.dropdiv',
    '[role="button"]',
    '[role="checkbox"]',
    '[role="radio"]',
    '[role="combobox"]',
    '[role="option"]'
].join(', ');

const SNAP_RADIUS_PX = 30;

// Create or reuse the cursor and add it to the page
let cursor = document.getElementById('joystick-cursor');
if (!cursor) {
    cursor = document.createElement('div');
    cursor.id = 'joystick-cursor';
}

// All state is managed here
const state = {
    buttonStates: {},
    cursorX: window.innerWidth / 2,
    cursorY: window.innerHeight / 2,
    hoveredElement: null,
    activeEditableField: null,
    activeOwnerDoc: document,
    lastSheetsCanvasPoint: null,
    oskShift: false,
    oskCaps: false
};

function isGoogleSheetsPage() {
    return location.hostname === 'docs.google.com' && location.pathname.includes('/spreadsheets/');
}

function isGoogleDocsPage() {
    return location.hostname === 'docs.google.com' && location.pathname.includes('/document/');
}

function getGoogleSheetsCellEditor() {
    if (!isGoogleSheetsPage()) return null;
    return document.getElementById('waffle-rich-text-editor') ||
        document.querySelector('.cell-input[contenteditable="true"]');
}

function isGoogleSheetsGridElement(el) {
    if (!el || !isGoogleSheetsPage()) return false;
    if (el.tagName === 'CANVAS') return true;
    return Boolean(el.closest?.('#waffle-grid-container, .grid-table-container, .waffle-grid-container, .grid-shim'));
}

function isGoogleDocsCanvasElement(el) {
    if (!el || !isGoogleDocsPage()) return false;
    return Boolean(el.closest?.('.kix-appview-editor, .kix-canvas-tile-content'));
}

function isGoogleSheetsEditorInEditMode(editor) {
    if (!editor) return false;
    const rect = editor.getBoundingClientRect();
    if (rect.width < 4 || rect.height < 4 || rect.left < 0 || rect.top < 0) {
        return false;
    }
    const style = window.getComputedStyle(editor);
    if (style.display === 'none' || style.visibility === 'hidden') {
        return false;
    }
    const parent = editor.parentElement;
    if (parent) {
        const pRect = parent.getBoundingClientRect();
        const pStyle = window.getComputedStyle(parent);
        if (pStyle.display === 'none' || pStyle.visibility === 'hidden' || pRect.left < -50 || pRect.top < -50) {
            return false;
        }
    }
    return true;
}

function dispatchDoubleClickOnCanvas(canvasEl, clientX, clientY, ownerDoc) {
    if (!canvasEl) return;
    const win = ownerDoc?.defaultView || window;
    const baseInit = {
        bubbles: true,
        cancelable: true,
        composed: true,
        view: win,
        clientX,
        clientY,
        screenX: clientX,
        screenY: clientY,
        button: 0
    };

    // Click 1 (detail: 1)
    canvasEl.dispatchEvent(new PointerEvent('pointerdown', { ...baseInit, buttons: 1, detail: 1 }));
    canvasEl.dispatchEvent(new MouseEvent('mousedown', { ...baseInit, buttons: 1, detail: 1 }));
    canvasEl.dispatchEvent(new PointerEvent('pointerup', { ...baseInit, buttons: 0, detail: 1 }));
    canvasEl.dispatchEvent(new MouseEvent('mouseup', { ...baseInit, buttons: 0, detail: 1 }));
    canvasEl.dispatchEvent(new MouseEvent('click', { ...baseInit, buttons: 0, detail: 1 }));

    // Click 2 + dblclick (detail: 2) to open Google Sheets cell in active Edit Mode
    canvasEl.dispatchEvent(new PointerEvent('pointerdown', { ...baseInit, buttons: 1, detail: 2 }));
    canvasEl.dispatchEvent(new MouseEvent('mousedown', { ...baseInit, buttons: 1, detail: 2 }));
    canvasEl.dispatchEvent(new PointerEvent('pointerup', { ...baseInit, buttons: 0, detail: 2 }));
    canvasEl.dispatchEvent(new MouseEvent('mouseup', { ...baseInit, buttons: 0, detail: 2 }));
    canvasEl.dispatchEvent(new MouseEvent('click', { ...baseInit, buttons: 0, detail: 2 }));
    canvasEl.dispatchEvent(new MouseEvent('dblclick', { ...baseInit, buttons: 0, detail: 2 }));
}

function ensureGoogleSheetsEditMode(editor) {
    if (!editor || !isGoogleSheetsPage()) return;
    if (typeof editor.focus === 'function') {
        editor.focus({ preventScroll: true });
    }
    if (isGoogleSheetsEditorInEditMode(editor)) {
        return;
    }

    // In Google Sheets Navigation Mode, pressing Enter (keyCode 13) or F2 (keyCode 113)
    // on #waffle-rich-text-editor opens the currently selected cell in Edit Mode.
    const enterKeyInit = {
        bubbles: true,
        cancelable: true,
        composed: true,
        key: 'Enter',
        code: 'Enter',
        keyCode: 13,
        charCode: 13,
        which: 13
    };
    editor.dispatchEvent(new KeyboardEvent('keydown', enterKeyInit));
    editor.dispatchEvent(new KeyboardEvent('keypress', enterKeyInit));
    editor.dispatchEvent(new KeyboardEvent('keyup', enterKeyInit));

    // Fallback: if still not in Edit Mode and we have the last clicked canvas coordinates, double-click that cell
    if (!isGoogleSheetsEditorInEditMode(editor) && state.lastSheetsCanvasPoint?.el) {
        const { el, clientX, clientY, ownerDoc } = state.lastSheetsCanvasPoint;
        dispatchDoubleClickOnCanvas(el, clientX, clientY, ownerDoc || document);
    }

    if (typeof editor.focus === 'function') {
        editor.focus({ preventScroll: true });
    }
}

let oskContainer = document.getElementById('joystick-osk');
let oskLauncher = document.getElementById('joystick-osk-launcher');
let oskPreviewText = document.getElementById('joystick-osk-preview-text');

const OSK_LAYOUT = [
    [
        { key: '1', shift: '!' }, { key: '2', shift: '@' }, { key: '3', shift: '#' },
        { key: '4', shift: '$' }, { key: '5', shift: '%' }, { key: '6', shift: '^' },
        { key: '7', shift: '&' }, { key: '8', shift: '*' }, { key: '9', shift: '(' },
        { key: '0', shift: ')' }, { key: 'BACKSPACE', label: '⌫ Back', wide: true }
    ],
    [
        { key: 'q' }, { key: 'w' }, { key: 'e' }, { key: 'r' }, { key: 't' },
        { key: 'y' }, { key: 'u' }, { key: 'i' }, { key: 'o' }, { key: 'p' }
    ],
    [
        { key: 'a' }, { key: 's' }, { key: 'd' }, { key: 'f' }, { key: 'g' },
        { key: 'h' }, { key: 'j' }, { key: 'k' }, { key: 'l' },
        { key: 'ENTER', label: '↵ Enter', wide: true }
    ],
    [
        { key: 'SHIFT', label: '⇧ Shift', wide: true },
        { key: 'z' }, { key: 'x' }, { key: 'c' }, { key: 'v' },
        { key: 'b' }, { key: 'n' }, { key: 'm' },
        { key: ',', shift: '<' }, { key: '.', shift: '>' }, { key: '?', shift: '/' }
    ],
    [
        { key: 'CAPS', label: '⇪ Caps', wide: true },
        { key: ' ', label: 'Space', space: true },
        { key: "'", shift: '"' }, { key: '-', shift: '_' },
        { key: 'PREV_FIELD', label: '◀ Prev', wide: true },
        { key: 'NEXT_FIELD', label: 'Next ▶', wide: true },
        { key: 'DOCK', label: '⇅ Top/Bot', wide: true },
        { key: 'CLOSE', label: '✕ Hide', wide: true, close: true }
    ]
];

function updateOskLauncherVisibility() {
    if (!oskLauncher) return;
    if (config.ENABLE_OSK === false) {
        oskLauncher.classList.add('joystick-osk-launcher-hidden');
    } else {
        oskLauncher.classList.remove('joystick-osk-launcher-hidden');
    }
}

function updateOskPreview() {
    if (!oskPreviewText) {
        oskPreviewText = document.getElementById('joystick-osk-preview-text');
    }
    if (!oskPreviewText) return;

    const field = state.activeEditableField;
    if (isGoogleSheetsPage()) {
        const sheetsEditor = getGoogleSheetsCellEditor();
        if (sheetsEditor && (!field || field === sheetsEditor)) {
            const cellVal = (sheetsEditor.textContent || '').replace(/\n$/g, '');
            oskPreviewText.textContent = `Spreadsheet Cell: "${cellVal}|" (press ↵ Enter to commit cell)`;
            return;
        }
    }
    if (isGoogleDocsPage()) {
        oskPreviewText.textContent = 'Google Docs Editor Active — click keys below to type';
        return;
    }

    if (!field || !field.isConnected) {
        oskPreviewText.textContent = 'No text box selected — click a box or press Next ▶';
        return;
    }

    const val = (field.tagName === 'INPUT' || field.tagName === 'TEXTAREA')
        ? field.value
        : field.textContent;
    oskPreviewText.textContent = `Typing: "${val || ''}|"`;
}

function createOnScreenKeyboard() {
    if (!document.body) return null;

    let existingLauncher = document.getElementById('joystick-osk-launcher');
    if (!existingLauncher) {
        oskLauncher = document.createElement('button');
        oskLauncher.id = 'joystick-osk-launcher';
        oskLauncher.type = 'button';
        oskLauncher.textContent = '⌨️ Keyboard';
        oskLauncher.title = 'Toggle On-Screen Keyboard';
        oskLauncher.addEventListener('mousedown', (e) => {
            e.preventDefault();
            e.stopPropagation();
        });
        oskLauncher.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            toggleOnScreenKeyboard();
        });
        document.body.appendChild(oskLauncher);
    } else {
        oskLauncher = existingLauncher;
    }
    updateOskLauncherVisibility();

    const existing = document.getElementById('joystick-osk');
    if (existing) {
        oskContainer = existing;
        oskPreviewText = document.getElementById('joystick-osk-preview-text');
        return oskContainer;
    }

    oskContainer = document.createElement('div');
    oskContainer.id = 'joystick-osk';

    // Prevent mouse clicks on OSK from stealing focus from the active input field
    oskContainer.addEventListener('mousedown', (e) => {
        e.preventDefault();
        e.stopPropagation();
    });

    const previewBar = document.createElement('div');
    previewBar.id = 'joystick-osk-preview';
    oskPreviewText = document.createElement('span');
    oskPreviewText.id = 'joystick-osk-preview-text';
    oskPreviewText.textContent = 'Click any text box on the page (or press Next ▶) to type';
    const previewHint = document.createElement('span');
    previewHint.id = 'joystick-osk-preview-hint';
    previewHint.textContent = 'Joystick On-Screen Keyboard';
    previewBar.appendChild(oskPreviewText);
    previewBar.appendChild(previewHint);
    oskContainer.appendChild(previewBar);

    OSK_LAYOUT.forEach(row => {
        const rowEl = document.createElement('div');
        rowEl.className = 'joystick-osk-row';

        row.forEach(item => {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'joystick-osk-key';
            if (item.wide) btn.classList.add('joystick-osk-key-wide');
            if (item.space) btn.classList.add('joystick-osk-key-space');
            if (item.close) btn.classList.add('joystick-osk-key-close');

            btn.dataset.oskKey = item.key;
            if (item.shift) btn.dataset.oskShift = item.shift;
            btn.textContent = item.label || item.key;

            btn.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                handleOskKeyPress(btn);
            });

            rowEl.appendChild(btn);
        });

        oskContainer.appendChild(rowEl);
    });

    document.body.appendChild(oskContainer);
    return oskContainer;
}

function updateOskKeyLabels() {
    if (!oskContainer) return;
    const upper = state.oskShift !== state.oskCaps;

    oskContainer.querySelectorAll('.joystick-osk-key').forEach(btn => {
        const baseKey = btn.dataset.oskKey;
        const shiftKey = btn.dataset.oskShift;

        if (baseKey === 'SHIFT') {
            btn.classList.toggle('joystick-osk-key-active', state.oskShift);
        } else if (baseKey === 'CAPS') {
            btn.classList.toggle('joystick-osk-key-active', state.oskCaps);
        } else if (state.oskShift && shiftKey) {
            btn.textContent = shiftKey;
        } else if (baseKey.length === 1 && /[a-z]/i.test(baseKey)) {
            btn.textContent = upper ? baseKey.toUpperCase() : baseKey.toLowerCase();
        } else if (baseKey.length === 1 && baseKey !== ' ') {
            btn.textContent = baseKey;
        }
    });
}

function showOnScreenKeyboard(targetField = null) {
    createOnScreenKeyboard();
    if (!oskContainer) return;

    if (targetField && typeof targetField.getBoundingClientRect === 'function') {
        const rect = targetField.getBoundingClientRect();
        // Only auto-adjust dock position when rect has valid on-screen coordinates
        if (rect.bottom > 0 && (rect.width === undefined || rect.width > 2)) {
            if (rect.bottom > window.innerHeight - 310) {
                oskContainer.classList.add('joystick-osk-top');
            } else {
                oskContainer.classList.remove('joystick-osk-top');
            }
        }
    }

    updateOskPreview();
    oskContainer.classList.add('joystick-osk-visible');
}

function hideOnScreenKeyboard() {
    if (oskContainer) {
        oskContainer.classList.remove('joystick-osk-visible');
    }
}

function toggleOnScreenKeyboard() {
    createOnScreenKeyboard();
    if (!oskContainer) return;
    if (oskContainer.classList.contains('joystick-osk-visible')) {
        hideOnScreenKeyboard();
    } else {
        showOnScreenKeyboard(state.activeEditableField);
    }
}

function resolveSpecialEditorTarget() {
    // If the user explicitly selected a regular input/textarea in the main document (e.g., spreadsheet/doc title or search box), respect it
    if (state.activeEditableField &&
        (state.activeEditableField.tagName === 'INPUT' || state.activeEditableField.tagName === 'TEXTAREA') &&
        document.activeElement === state.activeEditableField) {
        return { el: state.activeEditableField, doc: state.activeOwnerDoc || document };
    }

    // 1. Google Sheets cell editor (#waffle-rich-text-editor)
    if (isGoogleSheetsPage()) {
        const sheetsEditor = getGoogleSheetsCellEditor();
        if (sheetsEditor) {
            return { el: sheetsEditor, doc: document, isGoogleSheets: true };
        }
    }

    // 2. Google Docs text event target iframe (iframe.docs-texteventtarget-iframe)
    const docsIframe = document.querySelector('iframe.docs-texteventtarget-iframe');
    if (docsIframe) {
        try {
            const iframeDoc = docsIframe.contentDocument;
            const iframeWin = docsIframe.contentWindow;
            if (iframeDoc) {
                const target = iframeDoc.querySelector('[contenteditable="true"]') || iframeDoc.activeElement || iframeDoc.body;
                if (target) {
                    return { el: target, doc: iframeDoc, win: iframeWin, isGoogleDocs: true };
                }
            }
        } catch {}
    }

    return null;
}

function handleOskKeyPress(keyButton) {
    if (!keyButton) return;
    const baseKey = keyButton.dataset.oskKey;
    const shiftChar = keyButton.dataset.oskShift;

    // Brief visual flash on the pressed key
    keyButton.classList.add('joystick-osk-key-active');
    setTimeout(() => {
        if (baseKey !== 'SHIFT' && baseKey !== 'CAPS') {
            keyButton.classList.remove('joystick-osk-key-active');
        } else {
            updateOskKeyLabels();
        }
    }, 120);

    if (baseKey === 'CLOSE') {
        hideOnScreenKeyboard();
        return;
    }
    if (baseKey === 'DOCK') {
        oskContainer?.classList.toggle('joystick-osk-top');
        return;
    }
    if (baseKey === 'SHIFT') {
        state.oskShift = !state.oskShift;
        updateOskKeyLabels();
        return;
    }
    if (baseKey === 'CAPS') {
        state.oskCaps = !state.oskCaps;
        updateOskKeyLabels();
        return;
    }
    if (baseKey === 'PREV_FIELD') {
        cycleEditableField(-1);
        return;
    }
    if (baseKey === 'NEXT_FIELD') {
        cycleEditableField(1);
        return;
    }

    // Check for Google Sheets or Google Docs special editor targets first
    const specialTarget = resolveSpecialEditorTarget();
    let ownerDoc = specialTarget ? specialTarget.doc : (state.activeOwnerDoc || document);
    let targetEl = specialTarget ? specialTarget.el : (state.activeEditableField || ownerDoc.activeElement);

    const isInvalidTarget = !targetEl ||
        targetEl.closest?.('#joystick-osk') ||
        targetEl.id === 'joystick-osk-launcher' ||
        (targetEl === ownerDoc.body && !specialTarget?.isGoogleDocs && !ownerDoc.body?.isContentEditable);

    if (isInvalidTarget) {
        cycleEditableField(1);
        targetEl = state.activeEditableField;
        ownerDoc = state.activeOwnerDoc || document;
        if (!targetEl) {
            updateOskPreview();
            return;
        }
    }

    const innerEditable = specialTarget ? targetEl : (findInnerEditable(targetEl) || targetEl);
    state.activeEditableField = innerEditable;
    state.activeOwnerDoc = ownerDoc;

    if (specialTarget?.win) {
        try { specialTarget.win.focus(); } catch {}
    }
    if (typeof innerEditable.focus === 'function') {
        innerEditable.focus({ preventScroll: true });
    }

    if (baseKey === 'BACKSPACE') {
        if (specialTarget?.isGoogleSheets) {
            ensureGoogleSheetsEditMode(innerEditable);
        }
        deleteFromField(innerEditable, ownerDoc, 'backward');
        updateOskPreview();
        return;
    }

    if (baseKey === 'ENTER') {
        const isSheetsCellEditor = specialTarget?.isGoogleSheets ||
            innerEditable.id === 'waffle-rich-text-editor' ||
            innerEditable.classList?.contains('cell-input');

        if (!isSheetsCellEditor && !specialTarget?.isGoogleDocs &&
            (innerEditable.tagName === 'TEXTAREA' || innerEditable.isContentEditable)) {
            insertTextIntoField(innerEditable, '\n', ownerDoc);
        } else {
            const enterInit = {
                bubbles: true,
                cancelable: true,
                composed: true,
                key: 'Enter',
                code: 'Enter',
                keyCode: 13,
                charCode: 13,
                which: 13
            };
            innerEditable.dispatchEvent(new KeyboardEvent('keydown', enterInit));
            innerEditable.dispatchEvent(new KeyboardEvent('keypress', enterInit));
            innerEditable.dispatchEvent(new KeyboardEvent('keyup', enterInit));
            innerEditable.form?.requestSubmit?.();
        }
        updateOskPreview();
        return;
    }

    let charToInsert = baseKey;
    if (state.oskShift && shiftChar) {
        charToInsert = shiftChar;
    } else if (baseKey.length === 1 && /[a-z]/i.test(baseKey)) {
        const upper = state.oskShift !== state.oskCaps;
        charToInsert = upper ? baseKey.toUpperCase() : baseKey.toLowerCase();
    }

    if (specialTarget?.isGoogleSheets) {
        ensureGoogleSheetsEditMode(innerEditable);
    }

    insertTextIntoField(innerEditable, charToInsert, ownerDoc);
    updateOskPreview();

    if (state.oskShift) {
        state.oskShift = false;
        updateOskKeyLabels();
    }
}

function attachCursor() {
    const existing = document.getElementById('joystick-cursor');
    if (existing) {
        cursor = existing;
    } else if (document.body) {
        document.body.appendChild(cursor);
        cursor.style.transform = `translate(${state.cursorX}px, ${state.cursorY}px)`;
    }
    createOnScreenKeyboard();
}

if (document.body) {
    attachCursor();
} else {
    window.addEventListener('DOMContentLoaded', attachCursor);
}

function applyCursorSize(size) {
    const px = Math.max(8, Math.min(80, Number(size) || 20));
    cursor.style.width = `${px}px`;
    cursor.style.height = `${px}px`;
    cursor.style.marginLeft = `${-px / 2}px`;
    cursor.style.marginTop = `${-px / 2}px`;
}

function loadConfigFromStorage() {
    if (!isExtensionContextValid()) return;
    try {
        chrome.storage.sync.get(null, (settings) => {
            if (!isExtensionContextValid()) return;
            config = { ...DEFAULT_CONFIG, ...settings };
            if (!Array.isArray(config.CUSTOM_ACTIONS) || config.CUSTOM_ACTIONS.length === 0) {
                config.CUSTOM_ACTIONS = DEFAULT_CONFIG.CUSTOM_ACTIONS;
            }
            applyCursorSize(config.CURSOR_SIZE);
            updateOskLauncherVisibility();
        });
    } catch {
        // Ignore if extension context was invalidated
    }
}

loadConfigFromStorage();

// Listen for changes to update settings in real-time
if (isExtensionContextValid()) {
    try {
        chrome.storage.onChanged.addListener((changes, areaName) => {
            if (!isExtensionContextValid() || areaName !== 'sync') return;
            for (const [key, { newValue }] of Object.entries(changes)) {
                config[key] = newValue !== undefined ? newValue : DEFAULT_CONFIG[key];
            }
            if (changes.CURSOR_SIZE) {
                applyCursorSize(config.CURSOR_SIZE);
            }
            if (changes.ENABLE_OSK) {
                updateOskLauncherVisibility();
                if (!config.ENABLE_OSK) {
                    hideOnScreenKeyboard();
                }
            }
        });
    } catch {}
}

function updateHoverHighlight(target) {
    if (state.hoveredElement === target) return;
    if (state.hoveredElement) {
        state.hoveredElement.classList.remove('joystick-hover-target');
        state.hoveredElement = null;
    }
    if (target && target !== document.body && target !== document.documentElement) {
        target.classList.add('joystick-hover-target');
        state.hoveredElement = target;
    }
}

// Show On-Screen Keyboard automatically whenever any editable field is focused (via mouse, Tab, or joystick)
window.addEventListener('focusin', (e) => {
    const target = e.target;
    if (!target || target.closest?.('#joystick-osk') || target.id === 'joystick-osk-launcher') return;
    const editable = findInnerEditable(target) || (isEditableElement(target) ? target : null);
    if (editable && editable.tagName !== 'SELECT') {
        state.activeEditableField = editable;
        state.activeOwnerDoc = editable.ownerDocument || document;
        updateHoverHighlight(editable);
        updateOskPreview();
        if (config.ENABLE_OSK !== false) {
            showOnScreenKeyboard(editable);
        }
    }
}, true);

window.addEventListener('input', () => {
    updateOskPreview();
}, true);

// Clear joystick active field if the user physically clicks elsewhere with a mouse (outside the OSK)
window.addEventListener('mousedown', (e) => {
    if (e.target && e.target.closest && (e.target.closest('#joystick-osk') || e.target.id === 'joystick-osk-launcher')) return;
    if (e.isTrusted) {
        if (isGoogleSheetsGridElement(e.target)) {
            state.lastSheetsCanvasPoint = { el: e.target, clientX: e.clientX, clientY: e.clientY, ownerDoc: document };
            const sheetsEditor = getGoogleSheetsCellEditor();
            if (sheetsEditor) {
                state.activeEditableField = sheetsEditor;
                state.activeOwnerDoc = document;
                updateOskPreview();
                if (config.ENABLE_OSK !== false) {
                    showOnScreenKeyboard(e.target);
                }
            }
            return;
        }
        if (isGoogleDocsCanvasElement(e.target)) {
            const special = resolveSpecialEditorTarget();
            if (special) {
                state.activeEditableField = special.el;
                state.activeOwnerDoc = special.doc;
                updateOskPreview();
                if (config.ENABLE_OSK !== false) {
                    showOnScreenKeyboard(e.target);
                }
            }
            return;
        }
        const clickedEditable = findInnerEditable(e.target) || e.target?.closest?.(EDITABLE_FIELD_SELECTOR);
        if (clickedEditable && clickedEditable.tagName !== 'SELECT') {
            state.activeEditableField = clickedEditable;
            state.activeOwnerDoc = clickedEditable.ownerDocument || document;
            updateOskPreview();
            if (config.ENABLE_OSK !== false) {
                showOnScreenKeyboard(clickedEditable);
            }
        } else if (state.activeEditableField && !state.activeEditableField.contains(e.target)) {
            state.activeEditableField = null;
            updateOskPreview();
        }
    }
}, true);

// Keyboard assist: if the user selected a worksheet text box with the joystick,
// ensure keystrokes are never lost even if the page blurred the field after click.
window.addEventListener('keydown', (e) => {
    if (!isExtensionContextValid()) return;
    const field = state.activeEditableField;
    if (!field || !field.isConnected) return;

    const ownerDoc = state.activeOwnerDoc || document;
    const currentActive = ownerDoc.activeElement;

    // If the field (or an input inside it) already has native focus, let the browser handle typing normally
    if (currentActive === field || (field.contains && field.contains(currentActive) && isEditableElement(currentActive))) {
        return;
    }

    // Ignore browser shortcuts (Ctrl/Cmd/Alt)
    if (e.ctrlKey || e.metaKey || e.altKey) return;

    // Re-focus the joystick-selected field immediately
    const innerEditable = findInnerEditable(field) || field;
    if (typeof innerEditable.focus === 'function') {
        innerEditable.focus({ preventScroll: true });
    }
    placeCaretForTyping(innerEditable, ownerDoc);

    // Since focus was restored during keydown, Chrome won't fire native character insertion for this keystroke;
    // insert printable characters or handle Backspace/Delete directly so the first keystroke is not dropped.
    if (e.key.length === 1) {
        e.preventDefault();
        insertTextIntoField(innerEditable, e.key, ownerDoc);
        updateOskPreview();
    } else if (e.key === 'Backspace') {
        e.preventDefault();
        deleteFromField(innerEditable, ownerDoc, 'backward');
        updateOskPreview();
    } else if (e.key === 'Delete') {
        e.preventDefault();
        deleteFromField(innerEditable, ownerDoc, 'forward');
        updateOskPreview();
    }
}, true);

function setNativeInputValue(el, newValue) {
    const win = el.ownerDocument?.defaultView || window;
    const proto = el.tagName === 'TEXTAREA'
        ? win.HTMLTextAreaElement?.prototype
        : win.HTMLInputElement?.prototype;
    const descriptor = proto ? Object.getOwnPropertyDescriptor(proto, 'value') : null;
    if (descriptor && typeof descriptor.set === 'function') {
        descriptor.set.call(el, newValue);
    } else {
        el.value = newValue;
    }
}

function getVirtualKeyInfo(char) {
    if (!char || char.length === 0) return { keyCode: 0, code: '', shiftKey: false };
    if (/^[a-z]$/i.test(char)) {
        const upper = char.toUpperCase();
        return {
            keyCode: upper.charCodeAt(0),
            code: `Key${upper}`,
            shiftKey: char === upper && char !== char.toLowerCase()
        };
    }
    if (/^[0-9]$/.test(char)) {
        return { keyCode: char.charCodeAt(0), code: `Digit${char}`, shiftKey: false };
    }
    const shiftedDigits = {
        '!': '1', '@': '2', '#': '3', '$': '4', '%': '5',
        '^': '6', '&': '7', '*': '8', '(': '9', ')': '0'
    };
    if (shiftedDigits[char]) {
        const d = shiftedDigits[char];
        return { keyCode: d.charCodeAt(0), code: `Digit${d}`, shiftKey: true };
    }
    const punctMap = {
        ' ': { keyCode: 32, code: 'Space', shiftKey: false },
        ',': { keyCode: 188, code: 'Comma', shiftKey: false },
        '<': { keyCode: 188, code: 'Comma', shiftKey: true },
        '.': { keyCode: 190, code: 'Period', shiftKey: false },
        '>': { keyCode: 190, code: 'Period', shiftKey: true },
        '/': { keyCode: 191, code: 'Slash', shiftKey: false },
        '?': { keyCode: 191, code: 'Slash', shiftKey: true },
        "'": { keyCode: 222, code: 'Quote', shiftKey: false },
        '"': { keyCode: 222, code: 'Quote', shiftKey: true },
        '-': { keyCode: 189, code: 'Minus', shiftKey: false },
        '_': { keyCode: 189, code: 'Minus', shiftKey: true },
        '\n': { keyCode: 13, code: 'Enter', shiftKey: false }
    };
    if (punctMap[char]) {
        return punctMap[char];
    }
    return { keyCode: char.toUpperCase().charCodeAt(0) || 0, code: '', shiftKey: false };
}

function dispatchSyntheticKeyEvents(el, text, eventType = 'char') {
    const charCode = text.charCodeAt(0) || 0;
    const { keyCode, code, shiftKey } = getVirtualKeyInfo(text);
    const keydownInit = {
        bubbles: true,
        cancelable: true,
        composed: true,
        key: text === '\n' ? 'Enter' : text,
        code,
        keyCode,
        charCode: 0,
        which: keyCode,
        shiftKey
    };
    const keypressInit = {
        bubbles: true,
        cancelable: true,
        composed: true,
        key: text === '\n' ? 'Enter' : text,
        code,
        keyCode: charCode,
        charCode,
        which: charCode,
        shiftKey
    };
    el.dispatchEvent(new KeyboardEvent('keydown', keydownInit));
    if (eventType === 'char') {
        el.dispatchEvent(new KeyboardEvent('keypress', keypressInit));
        el.dispatchEvent(new InputEvent('beforeinput', {
            bubbles: true,
            cancelable: true,
            composed: true,
            inputType: 'insertText',
            data: text
        }));
    }
    return keydownInit;
}

function insertTextIntoField(el, text, ownerDoc) {
    if (!el) return;
    const doc = ownerDoc || el.ownerDocument || document;
    const isSheetsEditor = isGoogleSheetsPage() &&
        (el.id === 'waffle-rich-text-editor' || el.classList?.contains('cell-input'));
    const isDocsIframeEditor = isGoogleDocsPage() && doc !== document;

    if (isSheetsEditor) {
        ensureGoogleSheetsEditMode(el);
    }

    if (typeof el.focus === 'function') {
        el.focus({ preventScroll: true });
    }

    const keyupInit = dispatchSyntheticKeyEvents(el, text, 'char');

    // Google Docs texteventtarget iframe handles character insertion via the keypress event above
    if (isDocsIframeEditor) {
        el.dispatchEvent(new KeyboardEvent('keyup', keyupInit));
        return;
    }

    if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') {
        const prevVal = el.value || '';
        const start = typeof el.selectionStart === 'number' ? el.selectionStart : prevVal.length;
        const end = typeof el.selectionEnd === 'number' ? el.selectionEnd : prevVal.length;
        const expectedVal = prevVal.slice(0, start) + text + prevVal.slice(end);

        // Try native execCommand first, then guarantee value update via prototype setter (for React/Vue/Liveworksheets)
        let inserted = false;
        try {
            inserted = doc.execCommand('insertText', false, text) && el.value !== prevVal;
        } catch {}

        if (!inserted) {
            setNativeInputValue(el, expectedVal);
            try {
                const newPos = start + text.length;
                el.setSelectionRange(newPos, newPos);
            } catch {}
            el.dispatchEvent(new InputEvent('input', {
                bubbles: true,
                composed: true,
                inputType: 'insertText',
                data: text
            }));
        }
        el.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
        el.dispatchEvent(new KeyboardEvent('keyup', keyupInit));
    } else {
        if (!el.isContentEditable) {
            el.setAttribute('contenteditable', 'true');
            if (typeof el.focus === 'function') {
                el.focus({ preventScroll: true });
            }
        }
        placeCaretForTyping(el, doc);
        const prevText = el.textContent || '';

        let inserted = false;
        try {
            const cmdResult = doc.execCommand('insertText', false, text);
            inserted = cmdResult && (el.textContent !== prevText || isSheetsEditor);
        } catch {}

        if (!inserted) {
            el.textContent = prevText + text;
            placeCaretForTyping(el, doc);
            el.dispatchEvent(new InputEvent('input', {
                bubbles: true,
                composed: true,
                inputType: 'insertText',
                data: text
            }));
        }
        el.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
        el.dispatchEvent(new KeyboardEvent('keyup', keyupInit));
    }
}

function deleteFromField(el, ownerDoc, direction) {
    if (!el) return;
    const doc = ownerDoc || el.ownerDocument || document;
    const isSheetsEditor = isGoogleSheetsPage() &&
        (el.id === 'waffle-rich-text-editor' || el.classList?.contains('cell-input'));
    const isDocsIframeEditor = isGoogleDocsPage() && doc !== document;

    if (isSheetsEditor) {
        ensureGoogleSheetsEditMode(el);
    }

    if (typeof el.focus === 'function') {
        el.focus({ preventScroll: true });
    }

    const keyName = direction === 'backward' ? 'Backspace' : 'Delete';
    const keyCode = direction === 'backward' ? 8 : 46;
    const keyInit = {
        bubbles: true,
        cancelable: true,
        composed: true,
        key: keyName,
        code: keyName,
        keyCode,
        charCode: 0,
        which: keyCode
    };
    el.dispatchEvent(new KeyboardEvent('keydown', keyInit));

    if (isDocsIframeEditor) {
        el.dispatchEvent(new KeyboardEvent('keyup', keyInit));
        return;
    }

    if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') {
        const prevVal = el.value || '';
        const start = typeof el.selectionStart === 'number' ? el.selectionStart : prevVal.length;
        const end = typeof el.selectionEnd === 'number' ? el.selectionEnd : prevVal.length;
        let nextVal = prevVal;
        let nextPos = start;

        if (start !== end) {
            nextVal = prevVal.slice(0, start) + prevVal.slice(end);
            nextPos = start;
        } else if (direction === 'backward' && start > 0) {
            nextVal = prevVal.slice(0, start - 1) + prevVal.slice(start);
            nextPos = start - 1;
        } else if (direction === 'forward' && start < prevVal.length) {
            nextVal = prevVal.slice(0, start) + prevVal.slice(start + 1);
            nextPos = start;
        }

        setNativeInputValue(el, nextVal);
        try {
            el.setSelectionRange(nextPos, nextPos);
        } catch {}
        el.dispatchEvent(new InputEvent('input', {
            bubbles: true,
            composed: true,
            inputType: direction === 'backward' ? 'deleteContentBackward' : 'deleteContentForward'
        }));
        el.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
    } else {
        placeCaretForTyping(el, doc);
        const prevText = el.textContent || '';
        let deleted = false;
        try {
            const cmdResult = doc.execCommand(direction === 'backward' ? 'delete' : 'forwardDelete', false, null);
            deleted = cmdResult && (el.textContent !== prevText || isSheetsEditor);
        } catch {}

        if (!deleted && prevText.length > 0) {
            el.textContent = direction === 'backward' ? prevText.slice(0, -1) : prevText.slice(1);
            placeCaretForTyping(el, doc);
            el.dispatchEvent(new InputEvent('input', {
                bubbles: true,
                composed: true,
                inputType: direction === 'backward' ? 'deleteContentBackward' : 'deleteContentForward'
            }));
        }
        el.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
    }

    el.dispatchEvent(new KeyboardEvent('keyup', keyInit));
}

const hatSwitchAxisIndices = new Set([9]);
let lastBackgroundGamepadUpdateAt = 0;

function isValidAnalogValue(val) {
    return typeof val === 'number' && !Number.isNaN(val) && Math.abs(val) <= 1.05;
}

// Decode macOS / DirectInput single-axis 8-way POV Hat Switch (values -1.0..+1.0 in steps of 2/7, neutral > 1.05)
function decodeMacHatSwitch(axes) {
    if (!Array.isArray(axes)) return { x: 0, y: 0 };

    for (let i = 0; i < axes.length; i++) {
        if (axes[i] > 1.05) {
            hatSwitchAxisIndices.add(i);
        }
    }

    const HAT_VECTORS = [
        { x: 0, y: -1 },        // 0: North (Up)
        { x: 0.7071, y: -0.7071 }, // 1: North-East
        { x: 1, y: 0 },         // 2: East (Right)
        { x: 0.7071, y: 0.7071 },  // 3: South-East
        { x: 0, y: 1 },         // 4: South (Down)
        { x: -0.7071, y: 0.7071 }, // 5: South-West
        { x: -1, y: 0 },        // 6: West (Left)
        { x: -0.7071, y: -0.7071 } // 7: North-West
    ];

    for (const idx of hatSwitchAxisIndices) {
        if (idx >= axes.length) continue;
        const val = axes[idx];
        // Neutral on macOS HID Hat Switch is > 1.05 (typically 1.2857 or 3.2857); also ignore exact 0 unless axis > 9
        if (typeof val !== 'number' || Number.isNaN(val) || Math.abs(val) > 1.05) continue;
        if (idx === 9 && Math.abs(val) < 0.01) continue;

        const dirIndex = Math.round((val + 1) * 3.5);
        if (dirIndex >= 0 && dirIndex <= 7 && Math.abs(val - ((dirIndex * 2) / 7 - 1)) < 0.16) {
            return HAT_VECTORS[dirIndex];
        }
    }

    return { x: 0, y: 0 };
}

function getLocalActiveGamepad() {
    if (!navigator.getGamepads) return null;
    try {
        const gamepads = Array.from(navigator.getGamepads()).filter(Boolean);
        if (gamepads.length === 0) return null;
        const active = gamepads.find(gp =>
            gp.buttons.some(b => b.pressed) ||
            gp.axes.some(a => isValidAnalogValue(a) && Math.abs(a) > 0.05)
        );
        return active || gamepads[0];
    } catch {
        return null;
    }
}

// Listen for joystick updates from the background script
if (isExtensionContextValid()) {
    try {
        chrome.runtime.onMessage.addListener((message) => {
            if (!isExtensionContextValid()) return;
            if (message.command === 'joystick_update') {
                lastBackgroundGamepadUpdateAt = Date.now();
                handleJoystickUpdate(message.gamepad, false);
            }
        });
    } catch {}
}

// Direct active-tab gamepad polling fallback for macOS (where Chrome only delivers Gamepad API updates to focused visible tabs)
const localGamepadTimer = setInterval(() => {
    if (!isExtensionContextValid()) {
        clearInterval(localGamepadTimer);
        return;
    }
    if (document.visibilityState !== 'visible') return;
    if (Date.now() - lastBackgroundGamepadUpdateAt < 120) return;

    const gp = getLocalActiveGamepad();
    if (gp) {
        handleJoystickUpdate({
            axes: Array.from(gp.axes),
            buttons: gp.buttons.map(b => ({ pressed: Boolean(b.pressed) }))
        }, true);
    }
}, 50);

function handleJoystickUpdate(gamepad, fromLocalTabPoll = false) {
    if (!gamepad || !isExtensionContextValid()) return;
    attachCursor();

    const deadzone = Number(config.DEADZONE) || 0.2;
    const cursorSpeed = Number(config.CURSOR_SPEED) || 2;
    const scrollSpeed = Number(config.SCROLL_SPEED) || 20;

    // Detect any macOS single-axis HID Hat Switch first so hatSwitchAxisIndices stays updated
    const hatVector = decodeMacHatSwitch(gamepad.axes);

    const readAxis = (idx) => {
        if (idx === null || idx === undefined || hatSwitchAxisIndices.has(idx)) return 0;
        const val = gamepad.axes[idx];
        return isValidAnalogValue(val) ? val : 0;
    };

    // 1. Handle Cursor Movement
    const axisXIndex = config.MOUSE_X_AXIS !== undefined && config.MOUSE_X_AXIS !== null ? config.MOUSE_X_AXIS : 6;
    const axisYIndex = config.MOUSE_Y_AXIS !== undefined && config.MOUSE_Y_AXIS !== null ? config.MOUSE_Y_AXIS : 7;

    let stickX = readAxis(axisXIndex);
    let stickY = readAxis(axisYIndex);

    // Cross-platform fallback for macOS / Windows / Linux PXN Joysticks:
    // Check Left/Right Analog Axes (0/1, 2/3, 2/5), macOS POV Hat Switch, and Standard D-Pad Buttons (12-15)
    if (Math.abs(stickX) < deadzone) {
        if (Math.abs(readAxis(0)) > deadzone) stickX = readAxis(0);
        else if (Math.abs(readAxis(2)) > deadzone) stickX = readAxis(2);
        else if (Math.abs(hatVector.x) > 0.1) stickX = hatVector.x;
        else if (gamepad.buttons[14]?.pressed) stickX = -1;
        else if (gamepad.buttons[15]?.pressed) stickX = 1;
    }

    if (Math.abs(stickY) < deadzone) {
        if (Math.abs(readAxis(1)) > deadzone) stickY = readAxis(1);
        else if (Math.abs(readAxis(3)) > deadzone) stickY = readAxis(3);
        else if (Math.abs(readAxis(5)) > deadzone) stickY = readAxis(5);
        else if (Math.abs(hatVector.y) > 0.1) stickY = hatVector.y;
        else if (gamepad.buttons[12]?.pressed) stickY = -1;
        else if (gamepad.buttons[13]?.pressed) stickY = 1;
    }

    if (Math.abs(stickX) > deadzone) state.cursorX += stickX * cursorSpeed;
    if (Math.abs(stickY) > deadzone) state.cursorY += stickY * cursorSpeed;

    state.cursorX = Math.max(0, Math.min(window.innerWidth - 10, state.cursorX));
    state.cursorY = Math.max(0, Math.min(window.innerHeight - 10, state.cursorY));

    cursor.style.transform = `translate(${state.cursorX}px, ${state.cursorY}px)`;

    // 2. Handle Analog Stick Scrolling (if SCROLL_Y_AXIS is configured)
    if (config.SCROLL_Y_AXIS !== null && config.SCROLL_Y_AXIS !== undefined) {
        const rawScrollY = readAxis(config.SCROLL_Y_AXIS);
        if (Math.abs(rawScrollY) > deadzone) {
            const { rawElement } = getDeepElementsFromPoint(state.cursorX, state.cursorY);
            const scrollableContainer = findScrollableParent(rawElement);
            if (scrollableContainer) {
                scrollableContainer.scrollBy(0, rawScrollY * scrollSpeed);
            }
        }
    }

    // 2.5 If polling locally in the active tab on macOS (because offscreen document isn't focused),
    // trigger core browser tab/refresh actions on rising button edges
    if (fromLocalTabPoll) {
        const nextBtn = config.NEXT_TAB_BUTTON;
        const prevBtn = config.PREV_TAB_BUTTON;
        const refreshBtn = config.REFRESH_BUTTON;
        if (nextBtn !== null && nextBtn !== undefined && gamepad.buttons[nextBtn]?.pressed && !state.buttonStates[nextBtn]) {
            safeSendRuntimeMessage({ type: 'browser-action', action: 'next_tab' });
        }
        if (prevBtn !== null && prevBtn !== undefined && gamepad.buttons[prevBtn]?.pressed && !state.buttonStates[prevBtn]) {
            safeSendRuntimeMessage({ type: 'browser-action', action: 'prev_tab' });
        }
        if (refreshBtn !== null && refreshBtn !== undefined && gamepad.buttons[refreshBtn]?.pressed && !state.buttonStates[refreshBtn]) {
            safeSendRuntimeMessage({ type: 'browser-action', action: 'refresh' });
        }
    }

    // 3. Handle dynamically configured page actions
    if (config.CUSTOM_ACTIONS && Array.isArray(config.CUSTOM_ACTIONS)) {
        config.CUSTOM_ACTIONS.forEach(item => {
            if (item.button === null || item.button === undefined) return;
            const buttonIsPressed = Boolean(gamepad.buttons[item.button]?.pressed);
            const buttonWasPressed = Boolean(state.buttonStates[item.button]);

            // Continuous actions (scroll_up / scroll_down)
            if (item.action === 'scroll_up' || item.action === 'scroll_down') {
                if (buttonIsPressed) {
                    executePageAction(item.action);
                }
            } else {
                // Single-shot actions on rising edge
                if (buttonIsPressed && !buttonWasPressed) {
                    executePageAction(item.action);
                }
            }
        });
    }

    // Update button states for the next frame
    gamepad.buttons.forEach((button, i) => {
        state.buttonStates[i] = Boolean(button.pressed);
    });
}

function isEditableElement(el) {
    if (!el || !el.tagName) return false;
    if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT') {
        return !el.disabled && el.type !== 'hidden' && el.type !== 'button' && el.type !== 'submit' && el.type !== 'reset';
    }
    if (el.isContentEditable) return true;
    if (el.matches?.(EDITABLE_FIELD_SELECTOR)) return true;
    return false;
}

// Look inside a wrapper element (including open Shadow DOMs) for an actual child <input>, <textarea>, or [contenteditable]
function findInnerEditable(el) {
    if (!el) return null;
    if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT') return el;

    const childSelector = 'input:not([type="hidden"]):not([disabled]), textarea:not([disabled]), select:not([disabled]), [contenteditable="true"], [contenteditable=""], .editablediv';
    if (el.querySelector) {
        const child = el.querySelector(childSelector);
        if (child) return child;
    }
    if (el.shadowRoot && el.shadowRoot.querySelector) {
        const shadowChild = el.shadowRoot.querySelector(childSelector);
        if (shadowChild) return shadowChild;
    }
    if (el.isContentEditable || el.matches?.(EDITABLE_FIELD_SELECTOR)) return el;
    return null;
}

// Drill through open Shadow DOMs and same-origin iframes at (x, y) and return all stacked elements (deepest first)
function getDeepElementsFromPoint(x, y) {
    let doc = document;
    let root = document;
    let localX = x;
    let localY = y;
    let el = doc.elementFromPoint(localX, localY);
    const deepChain = [];

    while (el) {
        deepChain.unshift(el);
        if (el.tagName === 'IFRAME') {
            try {
                const iframeDoc = el.contentDocument;
                if (iframeDoc) {
                    const rect = el.getBoundingClientRect();
                    localX -= rect.left;
                    localY -= rect.top;
                    doc = iframeDoc;
                    root = iframeDoc;
                    const inner = doc.elementFromPoint(localX, localY);
                    if (!inner || inner === el) break;
                    el = inner;
                    continue;
                }
            } catch {
                break;
            }
        }
        if (el.shadowRoot && typeof el.shadowRoot.elementFromPoint === 'function') {
            root = el.shadowRoot;
            const inner = el.shadowRoot.elementFromPoint(localX, localY);
            if (!inner || inner === el) break;
            el = inner;
            continue;
        }
        break;
    }

    const rootStack = (root.elementsFromPoint ? root.elementsFromPoint(localX, localY) : [])
        .filter(item => item && item.id !== 'joystick-cursor');
    const docStack = (doc !== root && doc.elementsFromPoint ? doc.elementsFromPoint(localX, localY) : [])
        .filter(item => item && item.id !== 'joystick-cursor');

    const combined = [...deepChain, ...rootStack, ...docStack].filter(
        (item, idx, arr) => item && item.id !== 'joystick-cursor' && arr.indexOf(item) === idx
    );

    return {
        rawElement: combined[0] || el,
        stack: combined,
        clientX: localX,
        clientY: localY,
        ownerDoc: doc
    };
}

// Find the best editable field or interactive control at (x, y) or within SNAP_RADIUS_PX
function findInteractiveTarget(x, y) {
    // 0. Check if cursor is over the OSK Launcher or inside the visible On-Screen Keyboard
    if (oskLauncher && !oskLauncher.classList.contains('joystick-osk-launcher-hidden')) {
        const lRect = oskLauncher.getBoundingClientRect();
        if (x >= lRect.left && x <= lRect.right && y >= lRect.top && y <= lRect.bottom) {
            return {
                targetElement: oskLauncher,
                interactiveElement: oskLauncher,
                isOskLauncher: true,
                clientX: x,
                clientY: y,
                ownerDoc: document
            };
        }
    }

    if (oskContainer && oskContainer.classList.contains('joystick-osk-visible')) {
        const kRect = oskContainer.getBoundingClientRect();
        if (x >= kRect.left && x <= kRect.right && y >= kRect.top && y <= kRect.bottom) {
            // Find the exact or nearest key inside #joystick-osk so clicking in gaps between keys never misses
            const keys = oskContainer.querySelectorAll('.joystick-osk-key');
            let bestKey = null;
            let bestDist = Infinity;
            for (const keyEl of keys) {
                const r = keyEl.getBoundingClientRect();
                const dx = Math.max(r.left - x, 0, x - r.right);
                const dy = Math.max(r.top - y, 0, y - r.bottom);
                const dist = Math.hypot(dx, dy);
                if (dist < bestDist) {
                    bestDist = dist;
                    bestKey = keyEl;
                }
            }
            if (bestKey) {
                return {
                    targetElement: bestKey,
                    interactiveElement: bestKey,
                    isOskKey: true,
                    clientX: x,
                    clientY: y,
                    ownerDoc: document
                };
            }
        }
    }

    const { rawElement, stack, clientX, clientY, ownerDoc } = getDeepElementsFromPoint(x, y);

    // 1. Check all elements stacked directly at (clientX, clientY) for an editable field first
    for (const item of stack) {
        if (item === ownerDoc.body || item === ownerDoc.documentElement) continue;
        if (item.closest?.('#joystick-osk')) continue;

        const editableMatch = item.closest?.(EDITABLE_FIELD_SELECTOR) || (isEditableElement(item) ? item : null);
        if (editableMatch) {
            const actual = findInnerEditable(editableMatch) || editableMatch;
            return {
                targetElement: actual,
                interactiveElement: actual,
                clientX,
                clientY,
                ownerDoc
            };
        }

        const rect = item.getBoundingClientRect?.();
        if (rect && rect.width < 600 && rect.height < 300) {
            const innerEditable = findInnerEditable(item);
            if (innerEditable) {
                return {
                    targetElement: innerEditable,
                    interactiveElement: innerEditable,
                    clientX,
                    clientY,
                    ownerDoc
                };
            }
        }
    }

    // 2. Check stacked elements at (clientX, clientY) for clickable buttons/links/selectable worksheet boxes
    for (const item of stack) {
        if (item === ownerDoc.body || item === ownerDoc.documentElement) continue;
        if (item.closest?.('#joystick-osk')) continue;
        const controlMatch = item.closest?.(CLICKABLE_CONTROL_SELECTOR);
        if (controlMatch) {
            const inner = findInnerEditable(controlMatch) || controlMatch;
            return {
                targetElement: inner,
                interactiveElement: inner,
                clientX,
                clientY,
                ownerDoc
            };
        }
    }

    // 2.5 If directly over a Google Sheets grid canvas or Google Docs page canvas, click exact coordinates without snapping away
    if (isGoogleSheetsGridElement(rawElement) || isGoogleDocsCanvasElement(rawElement)) {
        return {
            targetElement: rawElement,
            interactiveElement: rawElement,
            clientX,
            clientY,
            ownerDoc
        };
    }

    // 3. Proximity snap assist within SNAP_RADIUS_PX (prioritizing editable fields & real controls)
    const candidates = ownerDoc.querySelectorAll(CLICKABLE_CONTROL_SELECTOR);
    let closestEl = null;
    let closestDist = SNAP_RADIUS_PX;

    for (const candidate of candidates) {
        if (candidate.closest?.('#joystick-osk')) continue;
        if (candidate.id === 'waffle-rich-text-editor') continue;
        const rect = candidate.getBoundingClientRect();
        if (rect.width === 0 || rect.height === 0) continue;

        const dx = Math.max(rect.left - clientX, 0, clientX - rect.right);
        const dy = Math.max(rect.top - clientY, 0, clientY - rect.bottom);
        const dist = Math.hypot(dx, dy);

        if (dist < closestDist) {
            closestDist = dist;
            closestEl = findInnerEditable(candidate) || candidate;
        }
    }

    if (closestEl) {
        const rect = closestEl.getBoundingClientRect();
        const snapX = Math.max(rect.left + 2, Math.min(rect.right - 2, clientX));
        const snapY = Math.max(rect.top + 2, Math.min(rect.bottom - 2, clientY));
        return {
            targetElement: closestEl,
            interactiveElement: closestEl,
            clientX: snapX,
            clientY: snapY,
            ownerDoc
        };
    }

    return {
        targetElement: rawElement,
        interactiveElement: rawElement,
        clientX,
        clientY,
        ownerDoc
    };
}

function placeCaretForTyping(el, ownerDoc) {
    if (!el) return;
    const win = ownerDoc?.defaultView || window;

    if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') {
        try {
            const len = el.value ? el.value.length : 0;
            el.setSelectionRange(len, len);
        } catch {}
        return;
    }

    // Liveworksheets & general contenteditable divs (e.g. .editablediv, [contenteditable="true"], [role="textbox"])
    if ((el.classList?.contains('editablediv') || el.getAttribute?.('role') === 'textbox') &&
        !el.isContentEditable && !el.querySelector?.('input, textarea')) {
        el.setAttribute('contenteditable', 'true');
    }

    if (el.isContentEditable || el.getAttribute?.('contenteditable') === 'true') {
        try {
            const selection = win.getSelection();
            if (selection) {
                const range = ownerDoc.createRange();
                range.selectNodeContents(el);
                range.collapse(false);
                selection.removeAllRanges();
                selection.addRange(range);
            }
        } catch {}
    }
}

function activateAndFocusElement(targetElement, clientX, clientY, ownerDoc) {
    if (!targetElement) return;
    const win = ownerDoc?.defaultView || window;

    try {
        window.focus();
        if (win !== window) win.focus();
    } catch {}

    // Special handling for clicking a cell on the Google Sheets grid canvas
    if (isGoogleSheetsGridElement(targetElement)) {
        state.lastSheetsCanvasPoint = { el: targetElement, clientX, clientY, ownerDoc };
        dispatchDoubleClickOnCanvas(targetElement, clientX, clientY, ownerDoc);

        const sheetsEditor = getGoogleSheetsCellEditor();
        if (sheetsEditor) {
            state.activeEditableField = sheetsEditor;
            state.activeOwnerDoc = document;
            if (typeof sheetsEditor.focus === 'function') {
                sheetsEditor.focus({ preventScroll: true });
            }
            placeCaretForTyping(sheetsEditor, document);
            updateOskPreview();
            if (config.ENABLE_OSK !== false) {
                showOnScreenKeyboard({ getBoundingClientRect: () => ({ bottom: clientY }) });
            }
        }
        return;
    }

    // Special handling for clicking on the Google Docs page canvas
    if (isGoogleDocsCanvasElement(targetElement)) {
        const eventInit = {
            bubbles: true,
            cancelable: true,
            composed: true,
            view: win,
            clientX,
            clientY,
            button: 0,
            buttons: 1
        };
        targetElement.dispatchEvent(new PointerEvent('pointerdown', eventInit));
        targetElement.dispatchEvent(new MouseEvent('mousedown', eventInit));
        targetElement.dispatchEvent(new PointerEvent('pointerup', { ...eventInit, buttons: 0 }));
        targetElement.dispatchEvent(new MouseEvent('mouseup', { ...eventInit, buttons: 0 }));
        targetElement.dispatchEvent(new MouseEvent('click', { ...eventInit, buttons: 0 }));

        const special = resolveSpecialEditorTarget();
        if (special) {
            state.activeEditableField = special.el;
            state.activeOwnerDoc = special.doc;
            try { special.win?.focus(); } catch {}
            if (typeof special.el.focus === 'function') {
                special.el.focus({ preventScroll: true });
            }
            updateOskPreview();
            if (config.ENABLE_OSK !== false) {
                showOnScreenKeyboard({ getBoundingClientRect: () => ({ bottom: clientY }) });
            }
        }
        return;
    }

    let focusTarget = findInnerEditable(targetElement) || targetElement.closest?.(CLICKABLE_CONTROL_SELECTOR) || targetElement;
    if (focusTarget.tagName === 'LABEL' && focusTarget.control) {
        focusTarget = focusTarget.control;
    }

    const prevActive = ownerDoc.activeElement;
    if (prevActive && prevActive !== focusTarget && prevActive !== ownerDoc.body && typeof prevActive.blur === 'function') {
        prevActive.blur();
    }

    const eventInit = {
        bubbles: true,
        cancelable: true,
        composed: true,
        view: win,
        clientX,
        clientY,
        button: 0,
        buttons: 1
    };

    targetElement.dispatchEvent(new PointerEvent('pointerover', eventInit));
    targetElement.dispatchEvent(new MouseEvent('mouseover', eventInit));
    targetElement.dispatchEvent(new PointerEvent('pointerdown', eventInit));
    targetElement.dispatchEvent(new MouseEvent('mousedown', eventInit));

    if (typeof focusTarget.focus === 'function') {
        focusTarget.focus({ preventScroll: true });
    }

    const upEventInit = { ...eventInit, buttons: 0 };
    targetElement.dispatchEvent(new PointerEvent('pointerup', upEventInit));
    targetElement.dispatchEvent(new MouseEvent('mouseup', upEventInit));

    if (typeof targetElement.click === 'function') {
        targetElement.click();
    } else {
        targetElement.dispatchEvent(new MouseEvent('click', upEventInit));
    }

    if (focusTarget !== targetElement && typeof focusTarget.click === 'function') {
        focusTarget.click();
    }

    // Check if clicking caused the page to dynamically create or focus an inner input/textarea/contenteditable
    let finalTarget = findInnerEditable(focusTarget) || findInnerEditable(targetElement) || focusTarget;
    if (ownerDoc.activeElement && ownerDoc.activeElement !== ownerDoc.body && isEditableElement(ownerDoc.activeElement)) {
        finalTarget = ownerDoc.activeElement;
    }

    if (typeof finalTarget.focus === 'function') {
        finalTarget.focus({ preventScroll: true });
    }
    placeCaretForTyping(finalTarget, ownerDoc);

    if (isEditableElement(finalTarget)) {
        state.activeEditableField = finalTarget;
        state.activeOwnerDoc = ownerDoc;
        updateHoverHighlight(finalTarget);
        updateOskPreview();
        if (config.ENABLE_OSK !== false && finalTarget.tagName !== 'SELECT') {
            showOnScreenKeyboard(finalTarget);
        }
    } else {
        state.activeEditableField = null;
        updateOskPreview();
    }

    setTimeout(() => {
        let asyncTarget = findInnerEditable(finalTarget) || finalTarget;
        if (ownerDoc.activeElement && ownerDoc.activeElement !== ownerDoc.body && isEditableElement(ownerDoc.activeElement)) {
            asyncTarget = ownerDoc.activeElement;
        }
        if (isEditableElement(asyncTarget)) {
            state.activeEditableField = asyncTarget;
            state.activeOwnerDoc = ownerDoc;
            if (ownerDoc.activeElement !== asyncTarget && typeof asyncTarget.focus === 'function') {
                asyncTarget.focus({ preventScroll: true });
            }
            placeCaretForTyping(asyncTarget, ownerDoc);
            updateOskPreview();
            if (config.ENABLE_OSK !== false && asyncTarget.tagName !== 'SELECT') {
                showOnScreenKeyboard(asyncTarget);
            }
        }
    }, 20);

    if (finalTarget.tagName === 'SELECT' && typeof finalTarget.showPicker === 'function') {
        try {
            finalTarget.showPicker();
        } catch {}
    }
}

function cycleEditableField(direction = 1) {
    const allFields = Array.from(document.querySelectorAll(EDITABLE_FIELD_SELECTOR))
        .map(el => findInnerEditable(el) || el)
        .filter((el, idx, arr) => {
            if (arr.indexOf(el) !== idx) return false;
            const rect = el.getBoundingClientRect();
            const style = window.getComputedStyle(el);
            return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none';
        });

    if (allFields.length === 0) return;

    allFields.sort((a, b) => {
        const rA = a.getBoundingClientRect();
        const rB = b.getBoundingClientRect();
        if (Math.abs(rA.top - rB.top) > 12) return rA.top - rB.top;
        return rA.left - rB.left;
    });

    const currentField = state.activeEditableField || document.activeElement;
    const currentIndex = allFields.indexOf(currentField);
    let nextIndex = 0;
    if (currentIndex !== -1) {
        nextIndex = (currentIndex + direction + allFields.length) % allFields.length;
    } else if (direction < 0) {
        nextIndex = allFields.length - 1;
    }

    const nextField = allFields[nextIndex];
    nextField.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'nearest' });

    const rect = nextField.getBoundingClientRect();
    state.cursorX = Math.max(0, Math.min(window.innerWidth - 10, rect.left + rect.width / 2));
    state.cursorY = Math.max(0, Math.min(window.innerHeight - 10, rect.top + rect.height / 2));
    cursor.style.transform = `translate(${state.cursorX}px, ${state.cursorY}px)`;
    updateHoverHighlight(nextField);
    activateAndFocusElement(nextField, state.cursorX, state.cursorY, document);
}

function pulseCursorClick() {
    cursor.classList.add('joystick-cursor-clicking');
    setTimeout(() => {
        cursor.classList.remove('joystick-cursor-clicking');
    }, 150);
}

function safeSendRuntimeMessage(msg) {
    if (!isExtensionContextValid()) return;
    try {
        chrome.runtime.sendMessage(msg).catch(() => {});
    } catch {}
}

async function executePageAction(action) {
    if (!isExtensionContextValid()) return;
    const x = state.cursorX;
    const y = state.cursorY;
    const scrollSpeed = Number(config.SCROLL_SPEED) || 20;

    switch (action) {
        case 'click': {
            pulseCursorClick();
            const { targetElement, interactiveElement, isOskKey, isOskLauncher, clientX, clientY, ownerDoc } = findInteractiveTarget(x, y);
            if (isOskLauncher) {
                toggleOnScreenKeyboard();
            } else if (isOskKey && targetElement) {
                handleOskKeyPress(targetElement);
            } else if (targetElement) {
                updateHoverHighlight(interactiveElement || targetElement);
                activateAndFocusElement(targetElement, clientX, clientY, ownerDoc);
            }
            break;
        }
        case 'toggle_keyboard':
            toggleOnScreenKeyboard();
            break;
        case 'right_click': {
            pulseCursorClick();
            const { targetElement, clientX, clientY, ownerDoc } = findInteractiveTarget(x, y);
            if (targetElement) {
                targetElement.dispatchEvent(new MouseEvent('contextmenu', {
                    bubbles: true,
                    cancelable: true,
                    view: ownerDoc?.defaultView || window,
                    clientX,
                    clientY,
                    button: 2
                }));
            }
            break;
        }
        case 'next_field':
            cycleEditableField(1);
            break;
        case 'prev_field':
            cycleEditableField(-1);
            break;
        case 'scroll_up':
        case 'scroll_down': {
            const { rawElement } = getDeepElementsFromPoint(x, y);
            const scrollableContainer = findScrollableParent(rawElement);
            if (scrollableContainer) {
                const scrollAmount = action === 'scroll_up' ? -scrollSpeed : scrollSpeed;
                scrollableContainer.scrollBy(0, scrollAmount);
            }
            break;
        }
        case 'copy': {
            const selectedText = window.getSelection()?.toString();
            if (selectedText && navigator.clipboard?.writeText) {
                navigator.clipboard.writeText(selectedText).catch(() => document.execCommand('copy'));
            } else {
                document.execCommand('copy');
            }
            break;
        }
        case 'paste': {
            try {
                const text = await navigator.clipboard.readText();
                const { targetElement, interactiveElement, clientX, clientY, ownerDoc } = findInteractiveTarget(x, y);
                let targetEl = state.activeEditableField || ownerDoc.activeElement;
                if (!targetEl || targetEl === ownerDoc.body) {
                    const hoveredInput = findInnerEditable(interactiveElement || targetElement) ||
                        (interactiveElement || targetElement)?.closest?.(EDITABLE_FIELD_SELECTOR);
                    if (hoveredInput) {
                        activateAndFocusElement(hoveredInput, clientX, clientY, ownerDoc);
                        targetEl = hoveredInput;
                    }
                }
                if (targetEl) {
                    insertTextIntoField(targetEl, text, ownerDoc);
                    updateOskPreview();
                }
            } catch (err) {
                console.error('Failed to paste text. Permission might be needed.', err);
            }
            break;
        }
        case 'cut':
            document.execCommand('cut');
            break;
        case 'undo':
            document.execCommand('undo');
            break;
        case 'go_back':
            window.history.back();
            break;
        case 'go_forward':
            window.history.forward();
            break;
        case 'new_tab':
            safeSendRuntimeMessage({ type: 'browser-action', action: 'new_tab' });
            break;
        case 'close_tab':
            safeSendRuntimeMessage({ type: 'browser-action', action: 'close_tab' });
            break;
        case 'rescan':
            loadConfigFromStorage();
            state.cursorX = window.innerWidth / 2;
            state.cursorY = window.innerHeight / 2;
            cursor.style.transform = `translate(${state.cursorX}px, ${state.cursorY}px)`;
            break;
    }
}

function findScrollableParent(element) {
    let current = element;
    while (current && current !== document.body && current !== document.documentElement) {
        const style = (current.ownerDocument?.defaultView || window).getComputedStyle(current);
        if (style.overflowY === 'auto' || style.overflowY === 'scroll' || style.overflowY === 'overlay') {
            if (current.scrollHeight > current.clientHeight) return current;
        }
        current = current.parentElement;
    }
    return document.scrollingElement || document.documentElement;
}
