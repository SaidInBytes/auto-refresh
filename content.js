// content.js
// Runs inside the page and owns the actual refresh timer.
//
// State is stored in chrome.storage.local under a single "refreshTabs" map,
// keyed by tab id: { "12": { enabled, intervalSeconds, nextRefresh, ... } }.
// Every read/write here only ever touches this tab's own entry in that map,
// so one tab's refresh state can never affect another tab.

(function () {
  const STORAGE_KEY = "refreshTabs";
  const SESSION_TAB_ID_KEY = "operatorAutoRefreshTabId";

  let refreshTimer = null;
  // Content scripts can't ask Chrome for their own tab id, so it's learned
  // from messages sent by the popup and cached in sessionStorage - which is
  // unique to this tab and survives reloads (but never leaks to other tabs).
  let tabId = sessionStorage.getItem(SESSION_TAB_ID_KEY);

  function getAllTabStates(callback) {
    chrome.storage.local.get([STORAGE_KEY], (result) => {
      callback(result[STORAGE_KEY] || {});
    });
  }

  function setTabState(id, state) {
    getAllTabStates((all) => {
      all[id] = state;
      chrome.storage.local.set({ [STORAGE_KEY]: all });
    });
  }

  function clearRefreshTimer() {
    if (refreshTimer) {
      clearTimeout(refreshTimer);
      refreshTimer = null;
    }
  }

  // Always clears any existing timer first, so a reload or a repeated START
  // can never leave two timers running at once.
  function beginCycle(id, intervalSeconds, value, unit) {
    clearRefreshTimer();
    const nextRefresh = Date.now() + intervalSeconds * 1000;
    const state = { enabled: true, value, unit, intervalSeconds, nextRefresh };
    setTabState(id, state);
    refreshTimer = setTimeout(() => location.reload(), intervalSeconds * 1000);
    return state;
  }

  function stopCycle(id) {
    clearRefreshTimer();
    getAllTabStates((all) => {
      const prev = all[id] || {};
      all[id] = { ...prev, enabled: false };
      chrome.storage.local.set({ [STORAGE_KEY]: all });
    });
  }

  // Runs once per page load (including reloads triggered by our own timer)
  // and resumes the countdown only if THIS tab's own id has an enabled state.
  function resumeIfEnabled() {
    if (!tabId) return; // No Start has ever happened in this tab yet.
    getAllTabStates((all) => {
      const state = all[tabId];
      if (state && state.enabled) {
        beginCycle(tabId, state.intervalSeconds, state.value, state.unit);
      }
    });
  }

  resumeIfEnabled();

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (!message || !message.type) return false;

    switch (message.type) {
      case "START": {
        tabId = message.tabId;
        sessionStorage.setItem(SESSION_TAB_ID_KEY, String(tabId));
        const state = beginCycle(tabId, message.intervalSeconds, message.value, message.unit);
        sendResponse({ ok: true, state });
        return false;
      }

      case "STOP": {
        tabId = message.tabId;
        stopCycle(tabId);
        sendResponse({ ok: true, state: { enabled: false } });
        return false;
      }

      case "GET_STATUS": {
        tabId = message.tabId;
        sessionStorage.setItem(SESSION_TAB_ID_KEY, String(tabId));
        getAllTabStates((all) => {
          const state = all[tabId] || { enabled: false };
          sendResponse({ ok: true, state });
        });
        return true; // Response is sent asynchronously.
      }

      default:
        return false;
    }
  });
})();
