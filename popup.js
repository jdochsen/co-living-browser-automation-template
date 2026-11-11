document.querySelector("#extension-version").textContent = " version " + chrome.runtime.getManifest().version;
const form = document.querySelector("form");
const nameInput = document.querySelector("#name");
const phoneInput = document.querySelector("#phone");
const preview = document.querySelector("#draft");
const status = document.querySelector("#status");
const button = form.querySelector('button[type="submit"]');
const contactButton = document.querySelector("#contact");
const voiceButton = document.querySelector("#use-voice");
const saveButton = document.querySelector("#save-contact");

const emailInput = document.querySelector("#email");
const propertyInput = document.querySelector("#property");
const sourceButtons = Array.from(document.querySelectorAll("[data-source]"));
let source = "turbotenant";
let settings = defaultSettings;
let loadGeneration = 0;
let loadedSavedContact = false;
let currentWindowId = null;

function setSource(value) {
  source = settings.enabled[value] ? value : (settings.enabled.turbotenant ? "turbotenant" : "padsplit");
  sourceButtons.forEach(button => button.setAttribute("aria-pressed", String(button.dataset.source === source)));
}

const template = document.querySelector("#message-template");

function updatePreview() {
  const canChooseTemplate = source === "turbotenant" && settings.enabled.padsplit;
  document.querySelector("#template-wrap").hidden = !canChooseTemplate;
  if (!canChooseTemplate) template.value = source;
  const fullName = nameInput.value.trim();
  const values = {
    fullName,
    firstName: fullName.split(/\s+/)[0],
    propertyAddress: propertyInput.value.trim() || "{{propertyAddress}}"
  };
  preview.value = settings.messages[template.value].replace(
    /\{\{(fullName|firstName|propertyAddress)\}\}/g,
    (match, key) => values[key]
  );
}

function selectDefaultTemplate() {
  template.value = source;
  updatePreview();
}

async function fillVoice(phone, message) {
  const recipientSelector = 'input[aria-label="Type a name or phone number"]';
  const messageSelector = 'textarea[placeholder="Type a message"]';
  const visible = selector => Array.from(document.querySelectorAll(selector))
    .filter(element => element.getClientRects().length > 0);

  if (!/^\/u\/\d+\/messages\/?$/.test(location.pathname)) {
    return "Open Messages in Google Voice first.";
  }
  const [recipient, ...otherRecipients] = visible(recipientSelector);
  const [draft, ...otherDrafts] = visible(messageSelector);
  if (!recipient || !draft || otherRecipients.length || otherDrafts.length) {
    return "Click Send new message in Google Voice, then try again.";
  }
  // An existing recipient chip can leave the input blank. Require a fresh
  // compose form with its original placeholder before writing anything.
  if (recipient.placeholder !== "Type a name or phone number" ||
      recipient.value || draft.value || recipient.disabled || draft.disabled ||
      recipient.readOnly || draft.readOnly) {
    return "Start a blank new message before trying again.";
  }

  function fill(field, prototype, value) {
    Object.getOwnPropertyDescriptor(prototype, "value").set.call(field, value);
    field.dispatchEvent(new Event("input", { bubbles: true }));
  }
  fill(draft, HTMLTextAreaElement.prototype, message);
  fill(recipient, HTMLInputElement.prototype, phone);
  recipient.focus();
  return "Select the matching number in Google Voice, then review the draft.";
}

function readLead() {
  if (!location.pathname.startsWith("/owners/lead-profile/")) return null;
  const titleSuffix = " - Lead - TurboTenant";
  if (!document.title.endsWith(titleSuffix)) return null;
  const name = document.title.slice(0, -titleSuffix.length).trim();
  const headers = Array.from(document.querySelectorAll(".vgtsi"))
    .filter(header => header.getClientRects().length &&
      Array.from(header.querySelectorAll("span")).some(span =>
        span.children.length === 0 && span.getClientRects().length &&
        span.textContent.trim() === name));
  if (!name || headers.length !== 1) return null;
  const phones = Array.from(headers[0].querySelectorAll('a[href^="tel:"]'))
    .filter(link => link.getClientRects().length);
  const emails = Array.from(headers[0].querySelectorAll('a[href^="mailto:"]'))
    .filter(link => link.getClientRects().length);
  const propertyLabels = Array.from(headers[0].querySelectorAll(".dL3P-"))
    .filter(label => label.getClientRects().length);
  const propertyAddress = propertyLabels.length === 1
    ? propertyLabels[0].textContent.split("|").map(part => part.trim()).filter(Boolean).join(" ")
    : "";
  return {
    name, phone: phones.length === 1 ? phones[0].getAttribute("href").slice(4) : "",
    email: emails.length === 1 ? emails[0].getAttribute("href").slice(7).split("?")[0] : "",
    propertyAddress
  };
}

function readBooking() {
  if (!/^\/host\/booking-request\/\d+\/?$/.test(location.pathname)) return null;
  const visible = selector => Array.from(document.querySelectorAll(selector))
    .filter(element => element.getClientRects().length);
  const names = visible(".pst-headingH4");
  const contact = document.querySelector("#member-contact-details");
  if (names.length !== 1 || !contact?.getClientRects().length) return null;
  const rows = Array.from(contact.querySelectorAll('[class*="MemberContact_contactInfo"]'));
  function value(label) {
    const matches = rows.filter(row => row.children[0]?.textContent.trim() === label);
    return matches.length === 1 ? matches[0].children[1]?.textContent.trim() ?? "" : "";
  }
  const properties = visible('a[href^="/host/listing/"]');
  return {
    name: names[0].textContent.trim(), phone: value("Phone"), email: value("Email"),
    propertyAddress: properties.length === 1 ? properties[0].textContent.trim() : ""
  };
}

const leadPage = "https://rental.turbotenant.com/owners/lead-profile/";
const voicePage = /^https:\/\/voice\.google\.com\/u\/\d+\/messages\/?(?:[?#]|$)/;
const contactsPage = /^https:\/\/contacts\.google\.com\//;

const contactKey = tabId => "pending-contact-" + tabId;
const contactLifetime = 30 * 60 * 1000;

async function loadLead() {
  const generation = ++loadGeneration;
  button.disabled = true;
  contactButton.disabled = true;
  voiceButton.disabled = true;
  saveButton.disabled = true;
  try {
    const [tab] = await chrome.tabs.query({active: true, currentWindow: true});
    currentWindowId = tab?.windowId;
    if (Number.isInteger(currentWindowId)) {
      const selection = await chrome.runtime.sendMessage({type: "get-selected-contact", windowId: currentWindowId});
      if (generation !== loadGeneration) return;
      if (!selection?.ok) throw new Error(selection?.message || "Could not read the selected contact.");
      if (selection.contact) {
        const contact = selection.contact;
        loadedSavedContact = true;
        document.querySelector("#selected-note").hidden = false;
        setSource(contact.source);
        nameInput.value = contact.name;
        phoneInput.value = contact.phone;
        emailInput.value = contact.email;
        propertyInput.value = contact.propertyAddress;
        selectDefaultTemplate();
        status.textContent = "Saved contact loaded. Review the details and message.";
        return;
      }
    }
    if (voicePage.test(tab?.url ?? "") || contactsPage.test(tab?.url ?? "")) {
      const key = contactKey(tab.id);
      const {[key]: pending} = await chrome.storage.session.get(key);
      if (pending && Date.now() - pending.preparedAt < contactLifetime) {
        setSource(pending.source);
        propertyInput.value = pending.propertyAddress ?? "";
        emailInput.value = pending.email ?? "";
        nameInput.value = pending.name;
        phoneInput.value = pending.phone;
        selectDefaultTemplate();
        if (pending.template === "turbotenant" || pending.template === "padsplit") template.value = pending.template;
        updatePreview();
        if (pending.message) preview.value = pending.message;
        status.textContent = "Choose Prepare contact, Use in Google Voice, or Prepare text.";
      } else {
        if (pending) await chrome.storage.session.remove(key);
        status.textContent = "Prepare a text from the selected source first to bring the name here.";
      }
      return;
    }
    const expectedSource = source;
    const matchesSource = source === "padsplit"
      ? tab?.url?.startsWith("https://www.padsplit.com/host/booking-request/")
      : tab?.url?.startsWith(leadPage);
    if (!matchesSource) {
      status.textContent = "Open a record on the selected website, or enter details manually.";
      return;
    }
    const [{result}] = await chrome.scripting.executeScript({
      target: {tabId: tab.id},
      func: source === "padsplit" ? readBooking : readLead
    });
    if (generation !== loadGeneration || expectedSource !== source) return;
    if (!result) {
      status.textContent = "Could not verify this record. On PadSplit, expand Member contact information, then reopen the helper.";
      return;
    }
    propertyInput.value = result.propertyAddress ?? "";
    emailInput.value = result.email ?? "";
    nameInput.value = result.name;
    phoneInput.value = result.phone;
    selectDefaultTemplate();
    status.textContent = result.phone
      ? "Check the name and number before preparing the draft."
      : "Name loaded. No single phone number found. Enter the number if you have it.";
  } catch {
    status.textContent = "Could not read this page. Enter the details manually.";
  } finally {
    if (generation === loadGeneration) {
      button.disabled = false;
      contactButton.disabled = false;
      voiceButton.disabled = false;
      saveButton.disabled = false;
    }
  }
}

propertyInput.addEventListener("input", selectDefaultTemplate);
template.addEventListener("change", updatePreview);
nameInput.addEventListener("change", updatePreview);
sourceButtons.forEach(control => control.addEventListener("click", () => {
  setSource(control.dataset.source);
  if (loadedSavedContact) {
    selectDefaultTemplate();
    return;
  }
  nameInput.value = "";
  phoneInput.value = "";
  emailInput.value = "";
  propertyInput.value = "";
  selectDefaultTemplate();
  loadLead();
}));
document.querySelector("#read-page").addEventListener("click", async () => {
  try {
    const response = await chrome.runtime.sendMessage({type: "clear-selected-contact", windowId: currentWindowId});
    if (!response?.ok) throw new Error(response?.message || "Could not clear the selection.");
    loadedSavedContact = false;
    document.querySelector("#selected-note").hidden = true;
    nameInput.value = "";
    phoneInput.value = "";
    emailInput.value = "";
    propertyInput.value = "";
    selectDefaultTemplate();
    await loadLead();
  } catch (error) {
    status.textContent = error.message;
  }
});
document.querySelector("#copy-email").addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText(emailInput.value);
    status.textContent = "Email copied.";
  } catch {
    status.textContent = "Select and copy the email field manually.";
  }
});
document.querySelector("#saved-contacts").addEventListener("click", () => {
  chrome.tabs.create({url: chrome.runtime.getURL("saved-contacts.html")});
});
saveButton.addEventListener("click", async () => {
  saveButton.disabled = true;
  try {
    const result = await chrome.runtime.sendMessage({
      type: "save-browser-contact",
      contact: {
        name: nameInput.value.trim(), phone: phoneInput.value.trim(),
        email: emailInput.value.trim(), propertyAddress: propertyInput.value.trim(), source
      }
    });
    if (!result?.ok) throw new Error(result?.message || "Could not save this contact.");
    status.textContent = result.added ? "Contact saved in this browser." : "Existing contact updated. Its other properties are retained.";
  } catch (error) {
    status.textContent = error.message || "Could not save this contact.";
  } finally {
    saveButton.disabled = false;
  }
});
document.querySelector("#open-settings").addEventListener("click", () => chrome.runtime.openOptionsPage());

async function initialize() {
  try {
    settings = await readSettings();
    for (const control of sourceButtons) control.hidden = !settings.enabled[control.dataset.source];
    const [tab] = await chrome.tabs.query({active: true, currentWindow: true});
    const activeSource = tab?.url?.startsWith("https://www.padsplit.com/host/") ? "padsplit" : "turbotenant";
    setSource(activeSource);
    selectDefaultTemplate();
    await loadLead();
  } catch {
    status.textContent = "Could not load extension settings. Reopen the extension to retry.";
  }
}
initialize();

form.addEventListener("submit", async event => {
  event.preventDefault();
  const rawPhone = phoneInput.value.trim();
  const digits = rawPhone.replace(/\D/g, "").replace(/^1(?=\d{10}$)/, "");
  if (!nameInput.value.trim() || !/^\+?[\d().\s-]+$/.test(rawPhone) ||
      !/^[2-9]\d{2}[2-9]\d{6}$/.test(digits)) {
    status.textContent = "Enter a name and a valid 10-digit US phone number.";
    return;
  }
  const preparingContact = event.submitter === contactButton;
  const usingVoice = event.submitter === voiceButton;
  if (!preparingContact && !usingVoice && /{{propertyAddress}}/.test(preview.value)) {
    status.textContent = "Enter the property address before preparing this message.";
    return;
  }
  if (!preparingContact && !usingVoice && !preview.value.trim()) {
    status.textContent = "Enter the message you want to prepare.";
    return;
  }
  button.disabled = true;
  contactButton.disabled = true;
  voiceButton.disabled = true;
  try {
    const tabs = await chrome.tabs.query({currentWindow: true});
    const activeTab = tabs.find(candidate => candidate.active);
    if (preparingContact || usingVoice) {
      if (!emailInput.checkValidity()) {
        status.textContent = "Check the email address before preparing the contact.";
        return;
      }
      const response = await chrome.runtime.sendMessage({
        type: preparingContact ? "prepare-google-contact" : "prepare-voice-recipient",
        activeTabId: activeTab?.id,
        name: nameInput.value.trim(), phone: digits, email: emailInput.value.trim(),
        source, propertyAddress: propertyInput.value.trim(), message: preview.value
      });
      status.textContent = response?.message ?? "Could not prepare the contact.";
      return;
    }
    const voiceTabs = tabs.filter(candidate => voicePage.test(candidate.url ?? ""));
    const tab = voiceTabs.find(candidate => candidate.active) ??
      (voiceTabs.length === 1 ? voiceTabs[0] : null);
    if (!tab) {
      status.textContent = "Keep one Google Voice Messages tab open in this window.";
      return;
    }
    const [{result}] = await chrome.scripting.executeScript({
      target: {tabId: tab.id},
      func: fillVoice,
      args: [`+1${digits}`, preview.value]
    });
    if (result === "Select the matching number in Google Voice, then review the draft.") {
      await chrome.storage.session.set({
        [contactKey(tab.id)]: {
          name: nameInput.value.trim(),
          phone: digits,
          source,
          email: emailInput.value.trim(),
          propertyAddress: propertyInput.value.trim(),
          message: preview.value,
          template: template.value,
          preparedAt: Date.now()
        }
      });
      if (loadedSavedContact && Number.isInteger(currentWindowId)) {
        await chrome.runtime.sendMessage({type: "clear-selected-contact", windowId: currentWindowId});
        loadedSavedContact = false;
        document.querySelector("#selected-note").hidden = true;
      }
    }
    status.textContent = result;
    if (result === "Select the matching number in Google Voice, then review the draft.") {
      await chrome.tabs.update(tab.id, {active: true});
    }
  } catch {
    status.textContent = "Could not prepare this action. Check the open tab and try again.";
  } finally {
    button.disabled = false;
    contactButton.disabled = false;
    voiceButton.disabled = false;
  }
});







