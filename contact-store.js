const savedContactsKey = "savedContactsV1";
let contactWrites = Promise.resolve();
const contactsAccessReady = chrome.storage.local.setAccessLevel({accessLevel: "TRUSTED_CONTEXTS"});

async function readSavedContacts() {
  await contactsAccessReady;
  const {[savedContactsKey]: saved} = await chrome.storage.local.get(savedContactsKey);
  if (!saved) return [];
  if (saved.version !== 1 || !Array.isArray(saved.contacts)) {
    throw new Error("The saved contact list has an unsupported format.");
  }
  return saved.contacts;
}

function mergeContactRows(existing, rows, fromImport) {
  const contacts = structuredClone(existing);
  const byPhone = new Map(contacts.map(contact => [contact.phone, contact]));
  const added = new Set(), updated = new Set();
  for (const row of rows) {
    let contact = byPhone.get(row.phone);
    if (!contact) {
      contact = {name: row.name, phone: row.phone, email: row.email,
        createdAt: row.createdAt, updatedAt: row.updatedAt, inquiries: []};
      byPhone.set(row.phone, contact);
      contacts.push(contact);
      added.add(row.phone);
    } else {
      const mayUpdate = !fromImport || row.updatedAt > contact.updatedAt;
      if (mayUpdate) contact.name = row.name;
      if (row.email && (mayUpdate || !contact.email)) contact.email = row.email;
      contact.createdAt = row.createdAt < contact.createdAt ? row.createdAt : contact.createdAt;
      contact.updatedAt = row.updatedAt > contact.updatedAt ? row.updatedAt : contact.updatedAt;
      if (!added.has(row.phone)) updated.add(row.phone);
    }
    const sameProperty = inquiry => inquiry.source === row.source &&
      inquiry.propertyAddress.toLowerCase() === row.propertyAddress.toLowerCase();
    if (!contact.inquiries.some(sameProperty)) {
      contact.inquiries.push({propertyAddress: row.propertyAddress, source: row.source});
    }
  }
  return {contacts, added: added.size, updated: updated.size};
}

function queueContactWrite(write) {
  const operation = contactWrites.then(write);
  // Serialize modifications from different popups and imports. A failed write
  // leaves the last saved list intact and does not block later operations.
  contactWrites = operation.catch(() => {});
  return operation;
}

function saveContactRows(rows, fromImport) {
  return queueContactWrite(async () => {
    const saved = await readSavedContacts();
    const result = mergeContactRows(saved, rows, fromImport);
    await chrome.storage.local.set({[savedContactsKey]: {version: 1, contacts: result.contacts}});
    return {ok: true, added: result.added, updated: result.updated, count: result.contacts.length};
  });
}

async function handleContactListMessage(message) {
  if (["select-saved-contact", "get-selected-contact", "clear-selected-contact"].includes(message.type)) {
    if (!Number.isInteger(message.windowId)) throw new Error("Could not identify this Chrome window.");
    const key = "selected-contact-" + message.windowId;
    if (message.type === "clear-selected-contact") {
      await chrome.storage.session.remove(key);
      return {ok: true};
    }
    await contactWrites;
    if (message.type === "select-saved-contact") {
      const contacts = await readSavedContacts();
      const phone = ContactData.phoneNumber(message.phone);
      const contact = contacts.find(item => item.phone === phone);
      if (!contact || !["padsplit", "turbotenant"].includes(message.source) ||
          !contact.inquiries.some(inquiry => inquiry.propertyAddress === message.propertyAddress)) {
        throw new Error("Select a saved contact and one of its property addresses.");
      }
      await chrome.storage.session.set({[key]: {
        phone, source: message.source, propertyAddress: message.propertyAddress
      }});
      return {ok: true};
    }
    const {[key]: selected} = await chrome.storage.session.get(key);
    if (!selected) return {ok: true, contact: null};
    const contact = (await readSavedContacts()).find(item => item.phone === selected.phone);
    if (!contact) {
      await chrome.storage.session.remove(key);
      return {ok: true, contact: null};
    }
    return {ok: true, contact: {
      name: contact.name, phone: contact.phone, email: contact.email,
      propertyAddress: selected.propertyAddress, source: selected.source
    }};
  }
  if (message.type === "delete-saved-contacts") {
    if (!Array.isArray(message.phones)) throw new Error("Select contacts to delete.");
    const phones = new Set(message.phones.map(ContactData.phoneNumber));
    return queueContactWrite(async () => {
      const saved = await readSavedContacts();
      const contacts = saved.filter(contact => !phones.has(contact.phone));
      await chrome.storage.local.set({[savedContactsKey]: {version: 1, contacts}});
      return {ok: true, deleted: saved.length - contacts.length};
    });
  }
  if (message.type === "list-saved-contacts") {
    await contactWrites;
    return {ok: true, contacts: await readSavedContacts()};
  }
  if (message.type === "save-browser-contact") {
    const row = ContactData.contactRow(message.contact, new Date().toISOString());
    return saveContactRows([row], false);
  }
  if (message.type === "import-browser-contacts") {
    const rows = ContactData.parseCsv(message.csv);
    return saveContactRows(rows, true);
  }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (sender.id !== chrome.runtime.id || sender.tab &&
      !sender.url?.startsWith(chrome.runtime.getURL(""))) return;
  if (![chrome.runtime.getURL("popup.html"), chrome.runtime.getURL("saved-contacts.html")].includes(sender.url)) return;
  if (!["list-saved-contacts", "save-browser-contact", "import-browser-contacts", "delete-saved-contacts",
    "select-saved-contact", "get-selected-contact", "clear-selected-contact"].includes(message.type)) return;
  handleContactListMessage(message).then(sendResponse)
    .catch(error => sendResponse({ok: false, message: error.message || "Could not save the contact list."}));
  return true;
});
