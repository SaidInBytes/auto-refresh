// background.js
// Only job: remove a closed tab's entry from refreshTabs so stale tab ids
// can never accidentally be reused/misread as belonging to another tab.

chrome.tabs.onRemoved.addListener((tabId) => {
  chrome.storage.local.get(["refreshTabs"], (result) => {
    const refreshTabs = result.refreshTabs || {};
    if (tabId in refreshTabs) {
      delete refreshTabs[tabId];
      chrome.storage.local.set({ refreshTabs });
    }
  });
});
