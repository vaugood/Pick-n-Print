async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

async function ensureContentScript(tabId) {
  // Inject content.css + the fidelity engine + the picker script.
  // snapshot.js must load before content.js: both execute as classic
  // scripts sharing one isolated-world global scope, and content.js's
  // print pipeline calls buildPrintHTML(), which snapshot.js defines.
  await chrome.scripting.insertCSS({
    target: { tabId },
    files: ["content.css"]
  });
  await chrome.scripting.executeScript({
    target: { tabId },
    files: ["snapshot.js", "content.js"]
  });
}

async function send(tabId, message) {
  return chrome.tabs.sendMessage(tabId, message);
}

document.getElementById("start").addEventListener("click", async () => {
  const tab = await getActiveTab();
  await ensureContentScript(tab.id);
  await send(tab.id, { type: "EPP_START" });
  window.close();
});

document.getElementById("stop").addEventListener("click", async () => {
  const tab = await getActiveTab();
  await ensureContentScript(tab.id);
  await send(tab.id, { type: "EPP_STOP" });
  window.close();
});

document.getElementById("print").addEventListener("click", async () => {
  const tab = await getActiveTab();
  await ensureContentScript(tab.id);
  await send(tab.id, { type: "EPP_PRINT" });
  window.close();
});

document.getElementById("clear").addEventListener("click", async () => {
  const tab = await getActiveTab();
  await ensureContentScript(tab.id);
  await send(tab.id, { type: "EPP_CLEAR" });
  window.close();
});