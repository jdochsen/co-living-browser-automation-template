(() => {
  if (globalThis.coLivingVoiceLoaded) return;
  globalThis.coLivingVoiceLoaded = true;
  let preparing = null;

  function showStatus(message) {
    let notice = document.querySelector("#co-living-voice-status");
    if (!notice) {
      notice = document.createElement("div");
      notice.id = "co-living-voice-status";
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

  async function fillRecipient(phone) {
    const visible = selector => Array.from(document.querySelectorAll(selector))
      .filter(element => element.getClientRects().length);
    let started = false;
    for (let attempt = 0; attempt < 200; attempt += 1) {
      const drafts = visible('textarea[placeholder="Type a message"]');
      const recipients = visible('input[aria-label="Type a name or phone number"]');
      if (drafts.some(field => field.value)) return "A message draft is open. Start a blank new message and click Use in Google Voice again.";
      if (recipients.length === 1 && drafts.length === 1) {
        const recipient = recipients[0];
        if (recipient.value === phone) return "Recipient ready. Select the matching number to continue.";
        if (recipient.value || recipient.disabled || recipient.readOnly ||
            recipient.placeholder !== "Type a name or phone number") {
          return "A recipient is already selected. Start a blank new message and try again.";
        }
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(recipient, phone);
        recipient.dispatchEvent(new Event("input", {bubbles: true}));
        recipient.focus();
        return "Recipient ready. Select the matching number to continue.";
      }
      const [newMessage] = visible('[aria-label="Send new message"]');
      if (!started && newMessage) {
        started = true;
        newMessage.click();
      }
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    return "Open Messages, click Send new message, and click Use in Google Voice again.";
  }

  async function prepare() {
    if (!/^\/u\/\d+\/messages\/?$/.test(location.pathname)) return;
    if (preparing) return preparing;
    preparing = (async () => {
      try {
        const response = await chrome.runtime.sendMessage({type: "get-pending-voice"});
        if (!response?.pending) return;
        showStatus(await fillRecipient("+1" + response.pending.phone));
      } catch {
        showStatus("Could not prepare the recipient. Reopen the helper and try again.");
      }
    })();
    try { await preparing; } finally { preparing = null; }
  }

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type !== "fill-voice-recipient") return;
    prepare().then(() => sendResponse({ok: true}));
    return true;
  });
  prepare();
})();
