const defaultSettings = {
  enabled: {turbotenant: true, padsplit: true},
  messages: {
    turbotenant: "Hi {{firstName}}, thank you for your interest in {{propertyAddress}}. Please let me know if you have any questions.",
    padsplit: "Room for rent at {{propertyAddress}}! Hi {{firstName}}, let me know if you would like more details."
  }
};

async function readSettings() {
  const {automationSettings: saved} = await chrome.storage.local.get("automationSettings");
  const enabled = {...defaultSettings.enabled, ...saved?.enabled};
  if (!enabled.turbotenant && !enabled.padsplit) Object.assign(enabled, defaultSettings.enabled);
  return {enabled, messages: {...defaultSettings.messages, ...saved?.messages}};
}
