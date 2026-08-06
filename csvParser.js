/**
 * RFC-4180 compliant CSV Parser for Gmail Auto Sender.
 * Handles quoted fields, commas inside quotes, dynamic headers, empty lines, and column auto-detection.
 */

/**
 * Parses raw CSV content into structured JSON recipient objects.
 *
 * @param {string} csvText - The raw CSV file string content.
 * @returns {Object} Result object containing recipients array, headers, totalRows, validRows, invalidCount.
 */
function parseCSV(csvText) {
  if (!csvText || typeof csvText !== "string") {
    return {
      recipients: [],
      headers: [],
      totalRows: 0,
      validRows: 0,
      invalidCount: 0,
      error: "Empty or invalid CSV file",
    };
  }

  // Tokenize CSV into rows and fields accounting for quotes
  const rows = tokenizeCSV(csvText);

  if (rows.length === 0) {
    return {
      recipients: [],
      headers: [],
      totalRows: 0,
      validRows: 0,
      invalidCount: 0,
      error: "No data rows found in CSV",
    };
  }

  // Extract candidate headers from first row
  let rawHeaders = rows[0].map((h) => h.trim());
  let dataRows = rows.slice(1);
  let emailColIndex = -1;

  // Find index of 'email' column (case insensitive)
  emailColIndex = rawHeaders.findIndex(
    (h) =>
      h.toLowerCase() === "email" ||
      h.toLowerCase() === "e-mail" ||
      h.toLowerCase() === "email address",
  );

  // If header doesn't explicitly name 'email', check if row 0 itself is data or if another column contains email addresses
  if (emailColIndex === -1) {
    // Check if header row itself contains an email (meaning no header line was provided)
    const firstRowHasEmail = rawHeaders.some((cell) =>
      validateEmailFormat(cell),
    );
    if (firstRowHasEmail) {
      // Find which column has the email in the first row
      emailColIndex = rawHeaders.findIndex((cell) => validateEmailFormat(cell));
      // Assume column 0 is email if index not found
      if (emailColIndex === -1) emailColIndex = 0;
      // Re-assign default headers
      dataRows = rows; // include first row as data
      rawHeaders = rawHeaders.map((_, i) =>
        i === emailColIndex ? "email" : i === 1 ? "name" : `column_${i + 1}`,
      );
    } else {
      // Check first data row to find which column looks like emails
      if (dataRows.length > 0) {
        const sampleRow = dataRows[0];
        emailColIndex = sampleRow.findIndex((cell) =>
          validateEmailFormat(cell),
        );
      }
      if (emailColIndex === -1) {
        // Default to column 0
        emailColIndex = 0;
      }
    }
  }

  // Standardize headers
  const headers = rawHeaders.map((h, i) => {
    const clean = h.trim().toLowerCase();
    if (i === emailColIndex) return "email";
    return clean || `column_${i + 1}`;
  });

  const recipients = [];
  const seenEmails = new Set();
  let invalidCount = 0;
  let duplicateCount = 0;

  for (let i = 0; i < dataRows.length; i++) {
    const row = dataRows[i];
    // Skip empty lines
    if (row.length === 0 || (row.length === 1 && row[0].trim() === "")) {
      continue;
    }

    const rowObject = {};
    headers.forEach((headerName, index) => {
      rowObject[headerName] = row[index] ? row[index].trim() : "";
    });

    const emailValue =
      rowObject["email"] ||
      (row[emailColIndex] ? row[emailColIndex].trim() : "");

    if (emailValue && validateEmailFormat(emailValue)) {
      const lowerEmail = emailValue.toLowerCase();
      if (seenEmails.has(lowerEmail)) {
        duplicateCount++;
      } else {
        seenEmails.add(lowerEmail);
        recipients.push({
          id: `recipient_${recipients.length + 1}_${Date.now()}`,
          email: emailValue,
          name: rowObject["name"] || "",
          data: rowObject,
          status: "pending", // pending, sent, failed, skipped
          error: null,
          timestamp: null,
        });
      }
    } else {
      invalidCount++;
    }
  }

  return {
    recipients,
    headers,
    totalRows: dataRows.length,
    validRows: recipients.length,
    invalidCount,
    duplicateCount,
    error:
      recipients.length === 0 ? "No valid email addresses found in CSV" : null,
  };
}

/**
 * Tokenizes CSV string into 2D array of fields, respecting quotes & linebreaks within fields.
 * @param {string} text - Raw CSV text.
 * @returns {Array<Array<string>>} 2D array of row fields.
 */
function tokenizeCSV(text) {
  const rows = [];
  let currentRow = [];
  let currentField = "";
  let inQuotes = false;

  // Clean BOM header if present
  const cleanText = text.replace(/^\uFEFF/, "");

  for (let i = 0; i < cleanText.length; i++) {
    const char = cleanText[i];
    const nextChar = cleanText[i + 1];

    if (inQuotes) {
      if (char === '"') {
        if (nextChar === '"') {
          // Escaped double quote inside quote
          currentField += '"';
          i++; // skip next quote
        } else {
          // Closing quote
          inQuotes = false;
        }
      } else {
        currentField += char;
      }
    } else {
      if (char === '"') {
        inQuotes = true;
      } else if (char === ",") {
        currentRow.push(currentField);
        currentField = "";
      } else if (char === "\r") {
        if (nextChar === "\n") {
          i++; // skip \n
        }
        currentRow.push(currentField);
        rows.push(currentRow);
        currentRow = [];
        currentField = "";
      } else if (char === "\n") {
        currentRow.push(currentField);
        rows.push(currentRow);
        currentRow = [];
        currentField = "";
      } else {
        currentField += char;
      }
    }
  }

  // Push final field/row if not empty
  if (currentField.length > 0 || currentRow.length > 0) {
    currentRow.push(currentField);
    rows.push(currentRow);
  }

  return rows;
}

/**
 * Simple internal email validation helper for CSV parser.
 * @param {string} str - String to check.
 * @returns {boolean}
 */
function validateEmailFormat(str) {
  if (!str || typeof str !== "string") return false;
  const clean = str.trim();
  return /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/.test(clean);
}

// Export module if in Node context
if (typeof module !== "undefined" && module.exports) {
  module.exports = { parseCSV, tokenizeCSV };
}
