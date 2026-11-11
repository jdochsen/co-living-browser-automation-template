(() => {
  function phoneNumber(value) {
    const text = String(value ?? "").trim();
    if (!/^\+?[\d().\s-]+$/.test(text)) throw new Error("Enter a valid US phone number.");
    const digits = text.replace(/\D/g, "").replace(/^1(?=\d{10}$)/, "");
    if (!/^[2-9]\d{2}[2-9]\d{6}$/.test(digits)) throw new Error("Enter a valid 10-digit US phone number.");
    return digits;
  }

  function sourceName(value) {
    const source = String(value ?? "").toLowerCase().replace(/\s/g, "");
    if (!["turbotenant", "padsplit"].includes(source)) throw new Error("Source must be TurboTenant or PadSplit.");
    return source;
  }

  function textValue(value, label, maximum) {
    if (typeof value !== "string") throw new Error(label + " must be text.");
    const text = value.trim();
    if (text.length > maximum) throw new Error(label + " is too long.");
    return text;
  }

  function contactRow(value, now) {
    if (!value || typeof value !== "object") throw new Error("Contact information is missing.");
    const name = textValue(value.name, "Full name", 120);
    if (!name) throw new Error("Enter a full name before saving.");
    const email = textValue(value.email ?? "", "Email", 320);
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error("Check the email address.");
    const date = (value, fallback) => {
      if (!value) return fallback;
      if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) {
        throw new Error("A saved date is invalid.");
      }
      return new Date(value).toISOString();
    };
    const createdAt = date(value.createdAt, now);
    const updatedAt = date(value.updatedAt, createdAt);
    return {
      name, phone: phoneNumber(value.phone), email,
      propertyAddress: textValue(value.propertyAddress ?? "", "Property address", 300),
      source: sourceName(value.source), createdAt, updatedAt
    };
  }

  const columns = ["Full name", "Phone", "Email", "Property address", "Source", "Date saved", "Updated at"];
  const dangerousCell = value => /^[\s\uFEFF]*[=+@-]/.test(value) || /^[\t\r]/.test(value);
  function csvCell(value) {
    let text = String(value ?? "");
    // An apostrophe keeps spreadsheet applications from interpreting text as a formula.
    if (text.startsWith("'") || dangerousCell(text)) text = "'" + text;
    return '"' + text.replace(/"/g, '""') + '"';
  }
  function unescapeCell(value) {
    if (value.startsWith("''") || (value.startsWith("'") && dangerousCell(value.slice(1)))) {
      return value.slice(1);
    }
    return value;
  }

  function exportCsv(contacts) {
    const rows = [columns];
    for (const contact of contacts) {
      for (const inquiry of contact.inquiries) {
        rows.push([contact.name, "+1" + contact.phone, contact.email,
          inquiry.propertyAddress, inquiry.source === "padsplit" ? "PadSplit" : "TurboTenant",
          contact.createdAt, contact.updatedAt]);
      }
    }
    return "\uFEFF" + rows.map(row => row.map(csvCell).join(",")).join("\r\n") + "\r\n";
  }

  function parseCsv(text) {
    if (typeof text !== "string" || text.length > 5 * 1024 * 1024) throw new Error("Choose a CSV file smaller than 5 MB.");
    text = text.replace(/^\uFEFF/, "");
    const rows = [];
    let row = [], field = "", quoted = false, closed = false;
    function endField() { row.push(field); field = ""; closed = false; }
    function endRow() {
      endField();
      if (row.some(cell => cell.trim())) rows.push(row);
      row = [];
      if (rows.length > 10001) throw new Error("Import at most 10,000 rows at a time.");
    }
    for (let index = 0; index < text.length; index += 1) {
      const char = text[index];
      if (quoted) {
        if (char === '"') {
          if (text[index + 1] === '"') { field += '"'; index += 1; }
          else { quoted = false; closed = true; }
        } else field += char;
      } else if (char === ",") endField();
      else if (char === "\n" || char === "\r") {
        if (char === "\r" && text[index + 1] === "\n") index += 1;
        endRow();
      } else if (closed) throw new Error("Unexpected text after a closing quote in the CSV.");
      else if (char === '"') {
        if (field) throw new Error("A quote is misplaced in the CSV.");
        quoted = true;
      } else field += char;
    }
    if (quoted) throw new Error("The CSV has an unclosed quoted field.");
    if (field || row.length || closed) endRow();
    if (!rows.length) throw new Error("The CSV is empty.");
    const header = rows.shift().map(value => unescapeCell(value).trim().toLowerCase());
    if (new Set(header).size !== header.length) throw new Error("The CSV has duplicate column names.");
    const indexes = columns.map(column => header.indexOf(column.toLowerCase()));
    if (indexes.some(index => index < 0)) throw new Error("Use a CSV exported by this contact list. Required columns are missing.");
    const now = new Date().toISOString();
    return rows.map((row, index) => {
      if (row.length !== header.length) throw new Error("CSV row " + (index + 2) + " has the wrong number of columns.");
      const values = indexes.map(column => unescapeCell(row[column]));
      try {
        return contactRow({
          name: values[0], phone: values[1], email: values[2],
          propertyAddress: values[3], source: values[4],
          createdAt: values[5], updatedAt: values[6]
        }, now);
      } catch (error) {
        throw new Error("CSV row " + (index + 2) + ". " + error.message);
      }
    });
  }

  globalThis.ContactData = {phoneNumber, contactRow, exportCsv, parseCsv};
})();
