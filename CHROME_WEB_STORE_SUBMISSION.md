# Chrome Web Store Submission Package (Pre-Filled)

All files required to publish **Joystick Universal Controller** have been generated in this folder:

1. **Extension Package (.zip):** [`joystick-universal-controller.zip`](file:///home/sreeniv/joystick_page_8/joystick-universal-controller.zip)
2. **Store Icon (128×128 PNG):** [`icon.png`](file:///home/sreeniv/joystick_page_8/icon.png)
3. **Store Screenshot (1280×800 24-bit PNG):** [`store_screenshot_1280x800.png`](file:///home/sreeniv/joystick_page_8/store_screenshot_1280x800.png)
4. **Small Promo Tile (440×280 24-bit PNG):** [`store_promo_440x280.png`](file:///home/sreeniv/joystick_page_8/store_promo_440x280.png)

---

## 1. "Store Listing" Tab Fields

### Detailed Description (Copy & Paste)
```text
Joystick Universal Controller is an accessibility browser extension designed for users with muscular weakness or motor impairments who cannot comfortably use a standard mouse. It enables full navigation of websites, interactive worksheets (such as Liveworksheets), web forms, and browser tabs using any USB or Bluetooth joystick or gamepad, while allowing seamless keyboard entry for typing.

KEY FEATURES
• On-Screen Joystick Cursor: Smooth, responsive cursor movement across any webpage with customizable cursor speed, cursor size (8px–60px), and stick deadzone.
• Smart Form & Worksheet Accessibility: Includes 30px proximity target snapping and high-contrast focus highlighting so users can easily select and type into form inputs, textareas, dropdowns, and interactive worksheet boxes without needing pixel-perfect aim.
• Customizable Button & Axis Mappings:
  - Browser Actions: Next Tab (default Button 5), Previous Tab (default Button 4), Refresh Page (default Button 10), New Tab, Close Tab, Navigate Back/Forward.
  - Page Actions: Click (default Button 2), Scroll Down (default Button 1), Scroll Up (default Button 0), Next/Previous Form Field, Right-Click, Copy, Paste, Cut, Undo, and Center Cursor.
• Persistent Cloud Sync: All custom button assignments, axis mappings, and sensitivity settings are automatically saved via Chrome Storage.

PRIVACY
This extension runs locally in your browser and does not collect, track, store, or transmit any personal or browsing data.
```

### Category
* **Primary Category:** `Accessibility`

### Language
* **Language:** `English`

### Graphic Assets to Upload
* **Store Icon:** Upload `/home/sreeniv/joystick_page_8/icon.png`
* **Screenshots:** Upload `/home/sreeniv/joystick_page_8/store_screenshot_1280x800.png`
* **Small Promo Tile (Optional):** Upload `/home/sreeniv/joystick_page_8/store_promo_440x280.png`

---

## 2. "Privacy Practices" Tab Fields

### Single Purpose Description
```text
Provides browser and webpage accessibility control (on-screen cursor movement, clicking, form field selection, scrolling, and tab navigation) using a joystick or gamepad for users with muscular weakness or motor impairments.
```

### Permission Justifications

* **Host Permission (`<all_urls>`) Justification:**
```text
Required to render the accessible joystick cursor overlay and allow the user to scroll, click links/buttons, and focus form inputs on any website they visit.
```

* **`offscreen` Justification:**
```text
Required to poll the browser's HTML5 Gamepad API (navigator.getGamepads()) in an offscreen document so joystick button and axis inputs are detected continuously across tabs.
```

* **`tabs` Justification:**
```text
Required to allow the user to switch between open browser tabs (Next Tab / Previous Tab), reload the current tab, and route joystick input updates to the active tab.
```

* **`storage` Justification:**
```text
Required to save the user's custom joystick button mappings, axis assignments, cursor speed, and cursor size locally via chrome.storage.sync.
```

* **`clipboardRead` Justification:**
```text
Required only when the user explicitly binds and presses the "Paste Text" joystick button action to paste clipboard text into a focused webpage input.
```

* **Are you using remote code?**
  * Select: **No, I am not using Remote code**

* **Data Usage Certification:**
  * Leave all data collection boxes **unchecked** (no user data is collected), and check the **3 certification checkboxes** at the bottom confirming compliance with Chrome Web Store Developer Program Policies.

