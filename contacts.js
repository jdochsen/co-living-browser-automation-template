(() => {
if (globalThis.coLivingContactsLoaded) return;
globalThis.coLivingContactsLoaded = true;
async function fillGoogleContact(name, phone, email) {
  if (!/^\/(?:u\/\d+\/)?new\/?$/.test(location.pathname)) {
    return "Open a blank new contact in Google Contacts.";
  }
  const labels = ["First name", "Last name", "Phone", "Email"];
  const values = [name, "", phone, email];
  const matchesValue = (value, index) => index === 2
    ? value.replace(/\D/g, "") === phone.replace(/\D/g, "")
    : value === values[index];
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const fields = labels.map(label => Array.from(document.querySelectorAll(
      'input[aria-label="' + label + '"]')).filter(e => e.getClientRects().length));
    if (fields.every(matches => matches.length === 1)) {
      if (fields.some(([field], index) => field.disabled || field.readOnly ||
          (field.value && !matchesValue(field.value, index)))) {
        return "The contact form has existing information. Review it before making changes.";
      }
      // Preserve the supplied full name without guessing which words are family names.
      fields.forEach(([field], index) => {
        if (matchesValue(field.value, index)) return;
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")
          .set.call(field, values[index]);
        field.dispatchEvent(new Event("input", {bubbles: true}));
        field.dispatchEvent(new Event("change", {bubbles: true}));
      });
      await new Promise(resolve => setTimeout(resolve, 250));
      const current = labels.map(label => Array.from(document.querySelectorAll(
        'input[aria-label="' + label + '"]')).filter(e => e.getClientRects().length));
      if (current.every((matches, index) => matches.length === 1 &&
          matchesValue(matches[0].value, index))) {
        return "Name, phone, and email filled. Check the Google account and click Save.";
      }
    }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  return "Contact form is loading. Reopen the helper here and click Prepare contact.";
}


let filling = null;

function showStatus(message) {
  let notice = document.querySelector("#co-living-contact-status");
  if (!notice) {
    notice = document.createElement("div");
    notice.id = "co-living-contact-status";
    notice.setAttribute("role", "status");
    Object.assign(notice.style, {
      position: "fixed", bottom: "20px", right: "20px", zIndex: "2147483647",
      background: "#17243a", color: "white", padding: "16px", borderRadius: "8px",
      maxWidth: "360px", font: "15px system-ui", boxShadow: "0 3px 15px #0004"
    });
    document.body.appendChild(notice);
  }
  notice.textContent = message;
}

async function prepareContact() {
  if (!/^\/(?:u\/\d+\/)?new\/?$/.test(location.pathname)) return;
  if (filling) return filling;
  filling = (async () => {
    try {
      const response = await chrome.runtime.sendMessage({type: "get-pending-contact"});
      if (!response?.pending) {
        if (response?.message) showStatus(response.message);
        return;
      }
      const {name, phone, email} = response.pending;
      showStatus("Preparing the name, phone, and email…");
      const result = await fillGoogleContact(name, "+1" + phone, email);
      showStatus(result);
    } catch {
      showStatus("Could not load the contact details. Reopen the helper here and click Prepare contact.");
    }
  })();
  try {
    await filling;
  } finally {
    filling = null;
  }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type !== "fill-pending-contact") return;
  prepareContact().then(() => sendResponse({ok: true}));
  return true;
});
prepareContact();

})();
