// For this MVP, popup directly injects scripts.
// Keeping service worker in place for future features.
chrome.runtime.onInstalled.addListener(() => {
  // noop
});