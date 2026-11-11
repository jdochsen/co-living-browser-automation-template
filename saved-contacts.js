const searchInput = document.querySelector("#search");
const rowsElement = document.querySelector("#rows");
const countElement = document.querySelector("#count");
const statusElement = document.querySelector("#status");
const exportButton = document.querySelector("#export");
const importButton = document.querySelector("#import");
const fileInput = document.querySelector("#file");
const loadButton = document.querySelector("#load-selected");
const loadSource = document.querySelector("#load-source");
const loadProperty = document.querySelector("#load-property");
let savedContacts = [];
let enabledSources = defaultSettings.enabled;
let loadRevision = 0;
let importing = false;
const selectedPhones = new Set();
let visiblePhones = [];
const selectAll = document.querySelector("#select-all");
const deleteButton = document.querySelector("#delete-selected");
let selecting = false;

function updateSelectionControls() {
  const contact = selectedPhones.size === 1
    ? savedContacts.find(item => selectedPhones.has(item.phone))
    : null;
  selectAll.checked = visiblePhones.length > 0 && selectedPhones.size === visiblePhones.length;
  selectAll.indeterminate = selectedPhones.size > 0 && !selectAll.checked;
  selectAll.disabled = !visiblePhones.length || selecting || importing;
  deleteButton.disabled = !selectedPhones.size || selecting || importing;
  loadButton.disabled = !contact || importing || selecting;
  loadSource.disabled = !contact || selecting;
  loadProperty.disabled = !contact || selecting;
  if (!enabledSources[loadSource.value]) loadSource.value = enabledSources.turbotenant ? "turbotenant" : "padsplit";
  const previous = loadProperty.value;
  loadProperty.replaceChildren();
  if (!contact) return;
  const matching = contact.inquiries.filter(inquiry => inquiry.source === loadSource.value);
  const inquiries = matching.length ? matching : contact.inquiries;
  const addresses = [...new Set(inquiries.map(inquiry => inquiry.propertyAddress))];
  for (const address of addresses) {
    const option = element("option", address || "Address not recorded");
    option.value = address;
    loadProperty.append(option);
  }
  if (addresses.includes(previous)) loadProperty.value = previous;
}

function statusMessage(text, error = false) {
  statusElement.textContent = text;
  statusElement.classList.toggle("error", error);
}

function element(tag, text, className) {
  const result = document.createElement(tag);
  result.textContent = text;
  if (className) result.className = className;
  return result;
}

function renderContacts() {
  const query = searchInput.value.trim().toLowerCase();
  const phoneQuery = /^[+()\d .-]+$/.test(query) ? query.replace(/\D/g, "") : "";
  const matches = savedContacts.filter(contact => {
    const text = [contact.name, contact.email, contact.phone,
      ...contact.inquiries.map(inquiry => inquiry.propertyAddress + " " + inquiry.source)].join(" ").toLowerCase();
    return !query || text.includes(query) || (phoneQuery && ("1" + contact.phone).includes(phoneQuery));
  });
  visiblePhones = matches.map(contact => contact.phone);
  const visible = new Set(visiblePhones);
  for (const phone of selectedPhones) {
    if (!visible.has(phone)) selectedPhones.delete(phone);
  }
  rowsElement.replaceChildren();
  for (const contact of matches) {
    const row = document.createElement("tr");
    const selectCell = document.createElement("td");
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.id = "select-" + contact.phone;
    checkbox.checked = selectedPhones.has(contact.phone);
    checkbox.disabled = selecting || importing;
    checkbox.setAttribute("aria-label", "Select " + contact.name);
    checkbox.addEventListener("change", () => {
      if (checkbox.checked) selectedPhones.add(contact.phone);
      else selectedPhones.delete(contact.phone);
      if (selectedPhones.size === 1) {
        const selected = savedContacts.find(item => selectedPhones.has(item.phone));
        loadSource.value = selected.inquiries.at(-1)?.source || "turbotenant";
      }
      renderContacts();
    });
    selectCell.append(checkbox);
    const nameCell = document.createElement("td");
    const label = element("label", contact.name);
    label.htmlFor = checkbox.id;
    nameCell.append(label);
    row.append(selectCell, nameCell, element("td", "+1 " + contact.phone), element("td", contact.email || "—"));
    const properties = document.createElement("td");
    for (const inquiry of contact.inquiries) {
      const entry = element("div", "", "inquiry");
      entry.append(element("div", inquiry.propertyAddress || "Address not recorded"),
        element("div", inquiry.source === "padsplit" ? "PadSplit" : "TurboTenant", "detail"));
      properties.append(entry);
    }
    const dates = document.createElement("td");
    dates.append(element("div", "Saved " + new Date(contact.createdAt).toLocaleDateString()),
      element("div", "Updated " + new Date(contact.updatedAt).toLocaleDateString(), "detail"));
    row.append(properties, dates);
    rowsElement.append(row);
  }
  countElement.textContent = matches.length + " of " + savedContacts.length + " contacts";
  document.querySelector("#table").hidden = !matches.length;
  const empty = document.querySelector("#empty");
  empty.hidden = !!matches.length;
  if (savedContacts.length && !matches.length) empty.textContent = "No contacts match this search.";
  else if (!savedContacts.length) empty.textContent = "No saved contacts yet. Open the helper on a lead or booking request and click Save contact to browser.";
  exportButton.disabled = !savedContacts.length || importing;
  updateSelectionControls();
}

async function loadContacts() {
  const revision = ++loadRevision;
  try {
    const response = await chrome.runtime.sendMessage({type: "list-saved-contacts"});
    if (revision !== loadRevision) return;
    if (!response?.ok) throw new Error(response?.message || "Could not load saved contacts.");
    savedContacts = response.contacts.sort((first, second) =>
      second.updatedAt.localeCompare(first.updatedAt) || first.name.localeCompare(second.name));
    renderContacts();
  } catch (error) {
    statusMessage(error.message, true);
  }
}

searchInput.addEventListener("input", renderContacts);
loadSource.addEventListener("change", updateSelectionControls);
selectAll.addEventListener("change", () => {
  selectedPhones.clear();
  if (selectAll.checked) {
    for (const phone of visiblePhones) selectedPhones.add(phone);
    if (selectedPhones.size === 1) {
      const contact = savedContacts.find(item => selectedPhones.has(item.phone));
      loadSource.value = contact.inquiries.at(-1)?.source || "turbotenant";
    }
  }
  renderContacts();
});
deleteButton.addEventListener("click", async () => {
  const phones = [...selectedPhones];
  if (!phones.length || !confirm("Delete " + phones.length + " selected contacts from this browser?")) return;
  selecting = true;
  renderContacts();
  try {
    const result = await chrome.runtime.sendMessage({type: "delete-saved-contacts", phones});
    if (!result?.ok) throw new Error(result?.message || "Could not delete selected contacts.");
    selectedPhones.clear();
    await loadContacts();
    statusMessage("Deleted " + result.deleted + " contacts from this browser.");
  } catch (error) {
    statusMessage(error.message, true);
  } finally {
    selecting = false;
    renderContacts();
  }
});
loadButton.addEventListener("click", async () => {
  if (selectedPhones.size !== 1) return;
  const selection = {phone: selectedPhones.values().next().value, source: loadSource.value, propertyAddress: loadProperty.value};
  selecting = true;
  updateSelectionControls();
  try {
    const tab = await chrome.tabs.getCurrent();
    const response = await chrome.runtime.sendMessage({
      type: "select-saved-contact", windowId: tab.windowId,
      ...selection
    });
    if (!response?.ok) throw new Error(response?.message || "Could not load this contact.");
    statusMessage("Contact ready in the extension.");
    try {
      await chrome.action.openPopup({windowId: tab.windowId});
    } catch {
      statusMessage("Contact ready. Click the Co-Living Browser Automation toolbar icon to open it.");
    }
  } catch (error) {
    statusMessage(error.message, true);
  } finally {
    selecting = false;
    renderContacts();
  }
});
exportButton.addEventListener("click", () => {
  const csv = ContactData.exportCsv(savedContacts);
  const url = URL.createObjectURL(new Blob([csv], {type: "text/csv;charset=utf-8"}));
  const download = document.createElement("a");
  const date = new Date();
  const stamp = [date.getFullYear(), String(date.getMonth() + 1).padStart(2, "0"), String(date.getDate()).padStart(2, "0")].join("-");
  download.href = url;
  download.download = "co-living-contacts-" + stamp + ".csv";
  document.body.append(download);
  download.click();
  download.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  statusMessage("CSV backup downloaded with all " + savedContacts.length + " contacts.");
});
importButton.addEventListener("click", () => fileInput.click());
fileInput.addEventListener("change", async () => {
  const file = fileInput.files[0];
  if (!file) return;
  importing = true;
  importButton.disabled = true;
  exportButton.disabled = true;
  renderContacts();
  statusMessage("Importing contacts…");
  try {
    if (file.size > 5 * 1024 * 1024) throw new Error("Choose a CSV file smaller than 5 MB.");
    const response = await chrome.runtime.sendMessage({type: "import-browser-contacts", csv: await file.text()});
    if (!response?.ok) throw new Error(response?.message || "Could not import this CSV.");
    await loadContacts();
    statusMessage("Imported " + response.added + " new contacts. Matched " + response.updated + " existing contacts.");
  } catch (error) {
    statusMessage(error.message, true);
  } finally {
    importing = false;
    importButton.disabled = false;
    fileInput.value = "";
    renderContacts();
  }
});
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && changes.savedContactsV1) loadContacts();
});
readSettings().then(settings => {
  enabledSources = settings.enabled;
  for (const option of loadSource.options) {
    option.hidden = !enabledSources[option.value];
    option.disabled = !enabledSources[option.value];
  }
  return loadContacts();
}).catch(() => statusMessage("Could not load extension settings.", true));
