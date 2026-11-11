importScripts("contact-data.js", "contact-store.js");

const lifetime = 30 * 60 * 1000;
const contactKey = tabId => "pending-contact-" + tabId;
const isVoice = url => /^https:\/\/voice\.google\.com\/u\/\d+\/messages\/?(?:[?#]|$)/.test(url ?? "");
const isNewContact = url => /^https:\/\/contacts\.google\.com\/(?:u\/\d+\/)?new\/?(?:[?#]|$)/.test(url ?? "");
const transfers = new Map();

function isCurrent(pending) {
  return pending && Number.isFinite(pending.preparedAt) &&
    Date.now() - pending.preparedAt < lifetime &&
    ["padsplit", "turbotenant"].includes(pending.source) &&
    typeof pending.name === "string" && pending.name.trim() &&
    /^[2-9]\d{2}[2-9]\d{6}$/.test(pending.phone) &&
    typeof pending.email === "string";
}

async function pendingFor(tabId) {
  const key = contactKey(tabId);
  const {[key]: pending} = await chrome.storage.session.get(key);
  return isCurrent(pending) ? pending : null;
}

function sameContact(first, second) {
  return first && first.name === second.name && first.phone === second.phone && first.email === second.email;
}

async function fillExisting(tab, voice) {
  const type = voice ? "fill-voice-recipient" : "fill-pending-contact";
  const file = voice ? "voice.js" : "contacts.js";
  try {
    await chrome.tabs.sendMessage(tab.id, {type});
  } catch {
    await chrome.scripting.executeScript({target: {tabId: tab.id}, files: [file]});
  }
  await chrome.tabs.update(tab.id, {active: true});
}

async function prepareDestination(message, active, voice) {
  const row = ContactData.contactRow(message, new Date().toISOString());
  const pending = {...row, message: String(message.message ?? ""),
    preparedAt: Date.now(), voiceRecipientOnly: voice};
  const tabs = await chrome.tabs.query({windowId: active.windowId});
  const windowKey = "prepared-contact-window-" + active.windowId;
  const {[windowKey]: previous} = await chrome.storage.session.get(windowKey);
  if (isCurrent(previous) && sameContact(previous, pending) && previous.contactTabId) {
    pending.contactTabId = previous.contactTabId;
  }
  let target;
  if (voice) {
    const candidates = tabs.filter(tab => isVoice(tab.url));
    target = candidates.find(tab => tab.id === active.id) ??
      (candidates.length === 1 ? candidates[0] : null);
    if (candidates.length > 1 && !target) {
      return {message: "Open the Google Voice tab you want to use, then click Use in Google Voice."};
    }
  } else {
    const activePending = await pendingFor(active.id);
    if (isNewContact(active.url) && sameContact(activePending, pending)) target = active;
    if (!target && isCurrent(previous) && sameContact(previous, pending)) {
      target = tabs.find(tab => tab.id === previous.contactTabId);
    }
  }
  // Chrome can omit URLs for internal pages without the tabs permission.
  // Reopen an unverified prior target instead of leaving it on a blank page.
  const targetUrl = target?.url || target?.pendingUrl;
  if (!voice && target && !targetUrl) target = null;
  const wasNew = !target;
  if (wasNew) target = await chrome.tabs.create({url: "about:blank", active: false, windowId: active.windowId});
  if (!voice && !wasNew && targetUrl !== "about:blank" && !isNewContact(targetUrl)) {
    await chrome.tabs.update(target.id, {active: true});
    return {message: "The contact tab is already open. Review that contact there."};
  }
  if (!voice) pending.contactTabId = target.id;
  await chrome.storage.session.set({[contactKey(target.id)]: pending, [windowKey]: pending});
  await chrome.storage.session.remove("selected-contact-" + active.windowId);
  if (wasNew || targetUrl === "about:blank") {
    await chrome.tabs.update(target.id, {
      url: voice ? "https://voice.google.com/u/0/messages" : "https://contacts.google.com/new",
      active: true
    });
  } else await fillExisting(target, voice);
  return {message: voice
    ? "Select the matching number in Google Voice to use this contact."
    : "Review the prepared contact in Google Contacts and click Save."};
}

async function prepareContact(message, voice) {
  const active = await chrome.tabs.get(message.activeTabId);
  // Serialize transfers in each window, even when two popups are used in quick succession.
  const key = active.windowId;
  const previous = transfers.get(key) ?? Promise.resolve();
  const operation = previous.catch(() => {}).then(() => prepareDestination(message, active, voice));
  transfers.set(key, operation);
  try {
    return await operation;
  } finally {
    if (transfers.get(key) === operation) transfers.delete(key);
  }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (sender.id !== chrome.runtime.id) return;
  if (message.type === "get-pending-contact" || message.type === "get-pending-voice") {
    const voice = message.type === "get-pending-voice";
    const matchesPage = voice ? isVoice : isNewContact;
    if (!sender.tab || !matchesPage(sender.url) || !matchesPage(sender.tab.url)) return;
    (async () => {
      const pending = await pendingFor(sender.tab.id);
      if (voice) {
        if (!pending?.voiceRecipientOnly) return {pending: null};
        await chrome.storage.session.set({[contactKey(sender.tab.id)]: {...pending, voiceRecipientOnly: false}});
      }
      return pending ? {pending} : {message: "Prepared details expired. Load the contact again in the helper."};
    })().then(sendResponse).catch(() => sendResponse({message: "Could not retrieve the prepared contact."}));
    return true;
  }
  if (["prepare-google-contact", "prepare-voice-recipient"].includes(message.type) &&
      !sender.tab && sender.url === chrome.runtime.getURL("popup.html")) {
    prepareContact(message, message.type === "prepare-voice-recipient")
      .then(sendResponse)
      .catch(() => sendResponse({message: "Could not prepare the contact. Reopen the helper and try again."}));
    return true;
  }
});
