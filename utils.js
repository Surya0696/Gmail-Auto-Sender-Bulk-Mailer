/**
 * Utility functions for Gmail Auto Sender Chrome Extension.
 * Handles validation, template interpolation, delay calculations, formatting, attachment processing, and DOM helpers.
 */

/**
 * Validates an email address format using standard regex.
 * @param {string} email - The email string to validate.
 * @returns {boolean} True if the email is valid, false otherwise.
 */
function validateEmail(email) {
  if (!email || typeof email !== 'string') return false;
  const cleanEmail = email.trim();
  const emailRegex = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
  return emailRegex.test(cleanEmail);
}

/**
 * Returns a promise that resolves after the specified milliseconds.
 * @param {number} ms - Milliseconds to sleep.
 * @returns {Promise<void>}
 */
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Generates a random integer delay between minSec and maxSec in milliseconds.
 * @param {number} minSec - Minimum delay in seconds.
 * @param {number} maxSec - Maximum delay in seconds.
 * @returns {number} Delay in milliseconds.
 */
function getRandomDelay(minSec, maxSec) {
  const min = Math.max(1, Number(minSec) || 15);
  const max = Math.max(min, Number(maxSec) || 25);
  const randomSec = Math.random() * (max - min) + min;
  return Math.floor(randomSec * 1000);
}

/**
 * Formats a given number of seconds into HH:MM:SS or MM:SS format.
 * @param {number} seconds - Duration in seconds.
 * @returns {string} Formatted time string.
 */
function formatTime(seconds) {
  if (isNaN(seconds) || seconds <= 0) return '00:00';
  const hrs = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);

  const pad = (num) => String(num).padStart(2, '0');

  if (hrs > 0) {
    return `${pad(hrs)}:${pad(mins)}:${pad(secs)}`;
  }
  return `${pad(mins)}:${pad(secs)}`;
}

/**
 * Estimates remaining campaign completion time based on remaining email count and average delay.
 * @param {number} remainingCount - Number of remaining emails to send.
 * @param {number} minDelaySec - Minimum delay setting in seconds.
 * @param {number} maxDelaySec - Maximum delay setting in seconds.
 * @returns {string} Human readable formatted time string (e.g. "05:30" or "01:15:20").
 */
function estimateRemainingTime(remainingCount, minDelaySec, maxDelaySec) {
  if (!remainingCount || remainingCount <= 0) return '00:00';
  const avgDelaySec = (Number(minDelaySec) + Number(maxDelaySec)) / 2;
  const totalSeconds = remainingCount * avgDelaySec;
  return formatTime(totalSeconds);
}

/**
 * Formats file size in bytes to human-readable string (KB, MB).
 * @param {number} bytes - File size in bytes.
 * @returns {string} Formatted file size.
 */
function formatFileSize(bytes) {
  if (!bytes || isNaN(bytes) || bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

/**
 * Converts a File object into a base64 Data URL string for storage.
 * @param {File} file - Browser File object.
 * @returns {Promise<Object>} Object with { fileName, fileType, fileSize, base64Data }.
 */
function fileToBase64Payload(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      resolve({
        fileName: file.name,
        fileType: file.type || 'application/octet-stream',
        fileSize: file.size,
        base64Data: reader.result
      });
    };
    reader.onerror = (error) => reject(error);
    reader.readAsDataURL(file);
  });
}

/**
 * Reconstructs a JS File object from a base64 payload object.
 * @param {Object} payload - { fileName, fileType, base64Data }
 * @returns {File} Native JavaScript File instance.
 */
function base64PayloadToFile(payload) {
  if (!payload || !payload.base64Data) return null;
  const arr = payload.base64Data.split(',');
  const mimeMatch = arr[0].match(/:(.*?);/);
  const mime = mimeMatch ? mimeMatch[1] : (payload.fileType || 'application/octet-stream');
  const bstr = atob(arr[1]);
  let n = bstr.length;
  const u8arr = new Uint8Array(n);
  while (n--) {
    u8arr[n] = bstr.charCodeAt(n);
  }
  return new File([u8arr], payload.fileName || 'attachment', { type: mime });
}

/**
 * Interpolates template placeholders with CSV row data.
 * Supports {{name}}, {{email}}, and generic headers like {{company}}, {{city}}.
 * Handles fallback for missing name (e.g., "Hello {{name}}" -> "Hello,").
 *
 * @param {string} template - Raw subject or body text with placeholders.
 * @param {Object} rowData - Key-value pair object representing CSV row data.
 * @param {string} [defaultSignature=''] - Optional signature to append to body.
 * @returns {string} Interpolated text.
 */
function renderTemplate(template, rowData = {}, defaultSignature = '') {
  if (!template || typeof template !== 'string') return '';

  let result = template;
  const row = rowData || {};

  // Case-insensitive key lookup helper
  const getValue = (key) => {
    if (!key) return '';
    const targetKey = key.trim().toLowerCase();
    for (const [k, v] of Object.entries(row)) {
      if (k.trim().toLowerCase() === targetKey && v !== undefined && v !== null) {
        return String(v).trim();
      }
    }
    return '';
  };

  const nameVal = getValue('name');

  // Handle missing name fallback logic specifically for "Hello {{name}}" / "Hi {{name}}"
  if (!nameVal) {
    result = result.replace(/Hello\s+\{\{\s*name\s*\}\}/gi, 'Hello,');
    result = result.replace(/Hi\s+\{\{\s*name\s*\}\}/gi, 'Hi,');
    result = result.replace(/Dear\s+\{\{\s*name\s*\}\}/gi, 'Dear customer,');
  }

  // Generic placeholder replacement {{ any_key }}
  result = result.replace(/\{\{\s*([a-zA-Z0-9_\-]+)\s*\}\}/g, (match, placeholderKey) => {
    const val = getValue(placeholderKey);
    if (val) return val;
    if (placeholderKey.toLowerCase() === 'name') return '';
    return match;
  });

  // Append signature if provided and not already present
  if (defaultSignature && defaultSignature.trim().length > 0) {
    result = `${result}\n\n${defaultSignature.trim()}`;
  }

  return result;
}

/**
 * Formats a Date object into a readable timestamp string (YYYY-MM-DD HH:MM:SS).
 * @param {Date} [date=new Date()] - Date object.
 * @returns {string} Formatted timestamp.
 */
function formatTimestamp(date = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');
  const yyyy = date.getFullYear();
  const mm = pad(date.getMonth() + 1);
  const dd = pad(date.getDate());
  const hh = pad(date.getHours());
  const min = pad(date.getMinutes());
  const ss = pad(date.getSeconds());
  return `${yyyy}-${mm}-${dd} ${hh}:${min}:${ss}`;
}

/**
 * Escapes a string value for safe insertion into CSV files.
 * @param {string} val - Raw cell value.
 * @returns {string} Escaped CSV cell string.
 */
function escapeCsvValue(val) {
  if (val === null || val === undefined) return '""';
  const str = String(val).replace(/"/g, '""');
  if (str.includes(',') || str.includes('\n') || str.includes('"')) {
    return `"${str}"`;
  }
  return str;
}

// Export for ES modules / service worker context if supported
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    validateEmail,
    sleep,
    getRandomDelay,
    formatTime,
    estimateRemainingTime,
    formatFileSize,
    fileToBase64Payload,
    base64PayloadToFile,
    renderTemplate,
    formatTimestamp,
    escapeCsvValue
  };
}
