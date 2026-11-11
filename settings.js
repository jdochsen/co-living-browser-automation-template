const form = document.querySelector("#settings");
const status = document.querySelector("#status");
const save = form.querySelector("button");
const sources = ["turbotenant", "padsplit"];

async function load() {
  try {
    const settings = await readSettings();
    for (const source of sources) {
      document.querySelector("#enable-" + source).checked = settings.enabled[source];
      document.querySelector("#message-" + source).value = settings.messages[source];
    }
    save.disabled = false;
  } catch {
    status.textContent = "Could not load settings. Reopen this page to retry.";
  }
}

form.addEventListener("submit", async event => {
  event.preventDefault();
  const enabled = {};
  const messages = {};
  for (const source of sources) {
    enabled[source] = document.querySelector("#enable-" + source).checked;
    messages[source] = document.querySelector("#message-" + source).value.trim();
  }
  if (!sources.some(source => enabled[source])) {
    status.textContent = "Enable at least one source.";
    return;
  }
  if (sources.some(source => !messages[source])) {
    status.textContent = "Enter a message for each source.";
    return;
  }
  save.disabled = true;
  try {
    await chrome.storage.local.set({automationSettings: {enabled, messages}});
    status.textContent = "Settings saved. Reopen the extension to use them.";
  } catch {
    status.textContent = "Could not save settings. Try again.";
  } finally {
    save.disabled = false;
  }
});
load();
