// popup.js
// Talks to content.js in the active tab only (via chrome.tabs.sendMessage,
// which already targets that specific tab), so other tabs are never affected.
// Seconds are always the source of truth internally; the unit dropdown only
// changes how the number is displayed, never how it is stored or sent.

const MIN_SECONDS = 1;
const MAX_SECONDS = 5 * 60; // 5 minutes
const SHORT_INTERVAL_WARNING_SECONDS = 5;

const intervalValueEl = document.getElementById("intervalValue");
const intervalUnitEl = document.getElementById("intervalUnit");
const errorTextEl = document.getElementById("errorText");
const warningTextEl = document.getElementById("warningText");
const startBtn = document.getElementById("startBtn");
const stopBtn = document.getElementById("stopBtn");
const statusTextEl = document.getElementById("statusText");
const countdownTextEl = document.getElementById("countdownText");

let activeTabId = null;
let pollTimer = null;
let previousUnit = intervalUnitEl.value;
let pageSupported = false;

localizeStaticText();
init();

// Fills every [data-i18n] element from the locale matching the browser's
// language (with English as the automatic fallback), so no UI text is
// ever hardcoded - chrome.i18n picks the right _locales/<lang>/messages.json.
function localizeStaticText() {
  document.querySelectorAll("[data-i18n]").forEach((el) => {
    const message = chrome.i18n.getMessage(el.getAttribute("data-i18n"));
    if (message) el.textContent = message;
  });
  document.documentElement.lang = chrome.i18n.getUILanguage();
}

async function init() {
  const tab = await getActiveTab();

  if (!tab || !isRefreshableUrl(tab.url)) {
    disableControls(chrome.i18n.getMessage("errorUnsupportedPage"));
    return;
  }

  activeTabId = tab.id;
  pageSupported = true;
  requestStatus({ syncInputs: true });
  // Keep the popup in sync with the live countdown while it stays open.
  // Opening/closing the popup never touches the timer itself - it only reads it.
  pollTimer = setInterval(requestStatus, 1000);
}

startBtn.addEventListener("click", onStartClick);
stopBtn.addEventListener("click", onStopClick);
intervalUnitEl.addEventListener("change", onUnitChange);
intervalValueEl.addEventListener("input", validateLiveInput);

function onStartClick() {
  if (!validateLiveInput()) return;

  const intervalSeconds = Math.round(currentIntervalSeconds());

  sendToContentScript(
    { type: "START", tabId: activeTabId, intervalSeconds, value: Number(intervalValueEl.value), unit: intervalUnitEl.value },
    (response) => {
      if (!response || !response.ok) {
        showError(chrome.i18n.getMessage("errorStartFailed"));
        return;
      }
      renderState(response.state, { syncInputs: true });
    }
  );
}

function onStopClick() {
  hideError();
  sendToContentScript({ type: "STOP", tabId: activeTabId }, (response) => {
    if (!response || !response.ok) {
      showError(chrome.i18n.getMessage("errorStopFailed"));
      return;
    }
    renderState(response.state, { syncInputs: true });
  });
}

function requestStatus(options = {}) {
  if (activeTabId === null) return;
  // Polling can race with the page reloading itself; ignore transient
  // failures here instead of treating the page as permanently unsupported.
  chrome.tabs.sendMessage(activeTabId, { type: "GET_STATUS", tabId: activeTabId }, (response) => {
    if (chrome.runtime.lastError || !response || !response.ok) return;
    renderState(response.state, options);
  });
}

function renderState(state, { syncInputs = false } = {}) {
  // Only overwrite the fields on initial load or right after Start/Stop -
  // the 1-second countdown poll must never revert what the user is typing.
  const valueIsFocused = document.activeElement === intervalValueEl;
  const unitIsFocused = document.activeElement === intervalUnitEl;

  if (syncInputs && !valueIsFocused && state.value !== undefined) intervalValueEl.value = state.value;
  if (syncInputs && !unitIsFocused && state.unit) {
    intervalUnitEl.value = state.unit;
    updateInputBounds();
    previousUnit = state.unit;
  }

  if (state.enabled) {
    statusTextEl.textContent = chrome.i18n.getMessage("statusActive");
    statusTextEl.className = "status-value status-active";

    const remainingMs = (state.nextRefresh || 0) - Date.now();
    const remainingSeconds = Math.max(0, Math.round(remainingMs / 1000));
    countdownTextEl.textContent = formatSeconds(remainingSeconds);
  } else {
    statusTextEl.textContent = chrome.i18n.getMessage("statusStopped");
    statusTextEl.className = "status-value status-stopped";
    countdownTextEl.textContent = "--";
  }
}

function updateInputBounds() {
  if (intervalUnitEl.value === "minutes") {
    intervalValueEl.min = "0.1";
    intervalValueEl.max = "5";
    intervalValueEl.step = "0.1";
  } else {
    intervalValueEl.min = "1";
    intervalValueEl.max = "300";
    intervalValueEl.step = "1";
  }
}

// Converts the currently displayed value + unit into an exact number of seconds.
function currentIntervalSeconds() {
  const rawValue = Number(intervalValueEl.value);
  const unit = intervalUnitEl.value;
  return unit === "minutes" ? rawValue * 60 : rawValue;
}

// Switching units must preserve the exact interval (e.g. 90 seconds must
// become exactly 1.5 minutes, and switching back must give 90 again - never
// a rounded value like 2 minutes / 120 seconds).
function onUnitChange() {
  const rawValue = Number(intervalValueEl.value) || 0;
  const seconds = previousUnit === "minutes" ? rawValue * 60 : rawValue;
  const newUnit = intervalUnitEl.value;

  const newValue = newUnit === "minutes" ? seconds / 60 : seconds;
  intervalValueEl.value = roundForDisplay(newValue);

  updateInputBounds();
  previousUnit = newUnit;
  validateLiveInput();
}

// Rounds only to avoid floating point artifacts (e.g. 1.4999999999999998),
// without losing the precision needed to preserve the exact interval.
function roundForDisplay(value) {
  return Math.round(value * 100) / 100;
}

// Validates as the user types/changes unit and warns immediately instead of
// waiting for the Start button to be clicked.
function validateLiveInput() {
  if (!pageSupported) return true;

  const rawValue = intervalValueEl.value.trim();
  const numericValue = Number(rawValue);

  if (rawValue === "" || !Number.isFinite(numericValue) || numericValue <= 0) {
    showError(chrome.i18n.getMessage("errorInvalidNumber"));
    hideWarning();
    startBtn.disabled = true;
    return false;
  }

  const intervalSeconds = currentIntervalSeconds();

  if (intervalSeconds < MIN_SECONDS || intervalSeconds > MAX_SECONDS) {
    showError(chrome.i18n.getMessage("errorIntervalRange"));
    hideWarning();
    startBtn.disabled = true;
    return false;
  }

  hideError();
  startBtn.disabled = false;

  // Non-blocking: very short intervals are still allowed, just flagged.
  if (intervalSeconds < SHORT_INTERVAL_WARNING_SECONDS) {
    showWarning(chrome.i18n.getMessage("warningShortInterval"));
  } else {
    hideWarning();
  }

  return true;
}

function formatSeconds(totalSeconds) {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function showError(message) {
  errorTextEl.textContent = message;
  errorTextEl.hidden = false;
}

function hideError() {
  errorTextEl.hidden = true;
}

function showWarning(message) {
  warningTextEl.textContent = message;
  warningTextEl.hidden = false;
}

function hideWarning() {
  warningTextEl.hidden = true;
}

function disableControls(message) {
  showError(message);
  startBtn.disabled = true;
  stopBtn.disabled = true;
  intervalValueEl.disabled = true;
  intervalUnitEl.disabled = true;
}

function isRefreshableUrl(url) {
  if (!url) return false;
  // Only plain http/https pages are supported. chrome://, the Web Store,
  // file:// and other internal pages never get a content script injected.
  return /^https?:\/\//i.test(url);
}

function getActiveTab() {
  return new Promise((resolve) => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      resolve(tabs && tabs[0] ? tabs[0] : null);
    });
  });
}

// Wraps chrome.tabs.sendMessage. Reports a normal (recoverable) error instead
// of permanently disabling the popup, since a failure here is often just a
// momentary hiccup (e.g. the page is mid-reload) rather than an unsupported page.
function sendToContentScript(message, callback) {
  if (activeTabId === null) return;
  chrome.tabs.sendMessage(activeTabId, message, (response) => {
    if (chrome.runtime.lastError) {
      showError(chrome.i18n.getMessage("errorTemporary"));
      return;
    }
    callback(response);
  });
}
