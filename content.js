/**
 * Gmail Web Content Script for Gmail Auto Sender Extension.
 * Interacts directly with Gmail's DOM to open compose windows, populate recipient, subject, body fields,
 * attach resume/files, and trigger email dispatch simulating human user input.
 */

// Selector definitions with fallback arrays for maximum compatibility with Gmail updates & extensions
const GMAIL_SELECTORS = {
  composeButton: [
    'div[role="button"][gh="cm"]',
    'div[role="button"][aria-label*="Compose"]',
    'div[aria-label*="Compose"]',
    'div.T-I.J-J5-Ji.T-I-KE.L3',
    '.z0 > div'
  ],
  composeWindow: [
    'div[role="dialog"][aria-label*="New Message"]',
    'div[role="dialog"]',
    'div.M9',
    'div.nH.if'
  ],
  toField: [
    'input[peoplekit-inputpath]',
    'div[peoplekit-inputpath] input',
    'input[aria-label*="To recipients"]',
    'input[aria-label*="To"]',
    'input[aria-label*="Recipients"]',
    'textarea[name="to"]',
    'input.agP.vO',
    'input.agP',
    'div[aria-label*="To"] input',
    'div[aria-label*="Recipients"] input',
    'div[role="combobox"] input',
    'td.a1 input'
  ],
  subjectField: [
    'input[name="subjectbox"]',
    'input[placeholder*="Subject"]',
    'input[aria-label*="Subject"]'
  ],
  bodyField: [
    'div[aria-label*="Message Body"]',
    'div[role="textbox"][aria-label*="Message Body"]',
    'div.Am.Al.editable',
    'div[contenteditable="true"]'
  ],
  attachmentInput: [
    'input[type="file"][name="Filedata"]',
    'input[type="file"][aria-label*="Attach"]',
    'input[type="file"]'
  ],
  sendButton: [
    'div.aoO',
    'div[role="button"][data-tooltip*="Send"]',
    'div[role="button"][aria-label*="Send"]',
    'div[aria-label*="Send"]',
    'div.T-I.J-J5-Ji.aoO'
  ],
  discardButton: [
    'div[role="button"][data-tooltip*="Discard draft"]',
    'div[role="button"][aria-label*="Discard draft"]',
    'div[data-tooltip*="Discard"]',
    'div[aria-label*="Discard"]',
    'div.oh.aY9',
    'div.og',
    'img.ha',
    'img[aria-label*="Save & close"]',
    'div[aria-label*="Close"]'
  ],
  sentToast: [
    'span.bAq', // Standard Gmail "Message sent" toast text element
    'div[role="alert"]'
  ]
};

/**
 * Message listener for extension communication from Background Service Worker or Popup.
 */
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'PING') {
    const isReady = checkGmailLoaded();
    sendResponse({ success: isReady, status: isReady ? 'ready' : 'not_ready' });
    return true;
  }

  if (request.action === 'SEND_SINGLE_EMAIL') {
    handleSendEmail(request.payload)
      .then((result) => sendResponse(result))
      .catch((err) => sendResponse({ success: false, error: err.message || 'Unknown error occurred' }));
    return true; // Keep response channel open for async execution
  }
});

/**
 * Checks whether the current page is an active Gmail interface.
 * @returns {boolean}
 */
function checkGmailLoaded() {
  const hasGmailUI = !!(
    document.querySelector('div[role="main"]') ||
    document.querySelector('input[aria-label*="Search"]') ||
    findFirstElement(GMAIL_SELECTORS.composeButton)
  );
  return hasGmailUI;
}

/**
 * Helper to find the first matching element from an array of fallback CSS selectors.
 * @param {Array<string>} selectorArray - Array of CSS selector strings.
 * @param {Element|Document} [parent=document] - Parent container element.
 * @returns {Element|null} Matched DOM element or null.
 */
function findFirstElement(selectorArray, parent = document) {
  for (const selector of selectorArray) {
    try {
      const el = parent.querySelector(selector);
      if (el) {
        return el;
      }
    } catch (e) {
      // Ignore invalid selector syntax errors
    }
  }
  return null;
}

/**
 * Main automation function to execute sending a single email.
 *
 * @param {Object} payload - { recipientEmail, subject, body, attachment }
 * @returns {Promise<Object>} Result object { success: boolean, error?: string }
 */
async function handleSendEmail(payload) {
  const { recipientEmail, subject, body, attachment } = payload;

  if (!navigator.onLine) {
    return { success: false, error: 'Internet disconnected' };
  }

  if (!checkGmailLoaded()) {
    return { success: false, error: 'Gmail interface not loaded or user logged out' };
  }

  try {
    // Step 1: Force Close Any Existing/Stuck Compose Dialogs
    await closeAllComposeWindows();
    await sleep(400);

    // Step 2: Open a Brand New Compose Window
    const composeWindow = await openComposeWindow();
    if (!composeWindow) {
      return { success: false, error: 'Failed to open Gmail compose window' };
    }

    await sleep(500);

    // Step 3: Fill Recipient Email ("To" field)
    const toFilled = await fillToField(composeWindow, recipientEmail);
    if (!toFilled) {
      await closeAllComposeWindows();
      return { success: false, error: 'Could not set recipient "To" address field' };
    }

    await sleep(400);

    // Step 4: Fill Subject
    if (subject) {
      await fillSubjectField(composeWindow, subject);
    }

    await sleep(400);

    // Step 5: Fill Message Body
    if (body) {
      await fillBodyField(composeWindow, body);
    }

    await sleep(500);

    // Step 6: Attach Resume / File if present
    if (attachment && attachment.base64Data) {
      await attachFileToCompose(composeWindow, attachment);
      // Wait for Gmail attachment upload to complete
      await sleep(2500);
    }

    await sleep(600);

    // Step 7: Click Send Button and verify window closed
    const sent = await clickSendButton(composeWindow);
    if (!sent) {
      return { success: false, error: 'Failed to send email or click Send button' };
    }

    await sleep(1000);
    return { success: true };

  } catch (err) {
    console.error('[Gmail Auto Sender] Error sending email:', err);
    await closeAllComposeWindows();
    return { success: false, error: err.message || 'Automation sequence failed' };
  }
}

/**
 * Helper to close any open or stuck Gmail compose windows.
 */
async function closeAllComposeWindows() {
  try {
    const dialogs = document.querySelectorAll('div[role="dialog"], div.M9');
    for (const dialog of dialogs) {
      let closed = false;
      for (const selector of GMAIL_SELECTORS.discardButton) {
        const btn = dialog.querySelector(selector);
        if (btn) {
          simulateClick(btn);
          closed = true;
          await sleep(150);
          break;
        }
      }
      if (!closed) {
        try { dialog.remove(); } catch (e) {}
      }
    }
  } catch (e) {
    console.warn('[Gmail Auto Sender] Error clearing old compose windows:', e);
  }
  await sleep(300);
}

/**
 * Opens a fresh Gmail compose window after clearing any stuck compose dialogs.
 * @returns {Promise<Element|null>} New Compose dialog element.
 */
async function openComposeWindow() {
  // Always close any previous/stuck compose window to prevent mixing recipients
  await closeAllComposeWindows();
  await sleep(400);

  const composeBtn = findFirstElement(GMAIL_SELECTORS.composeButton);
  if (composeBtn) {
    simulateClick(composeBtn);
  } else {
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'c', keyCode: 67, bubbles: true }));
  }

  const startTime = Date.now();
  while (Date.now() - startTime < 7000) {
    await sleep(300);
    const composeDialog = findFirstElement(GMAIL_SELECTORS.composeWindow);
    if (composeDialog) {
      return composeDialog;
    }
  }

  return null;
}

/**
 * Populates the "To" recipient field with email address.
 */
async function fillToField(container, email) {
  let toInput = null;
  const startTime = Date.now();

  // Retry loop for up to 5 seconds while Gmail renders recipient DOM
  while (Date.now() - startTime < 5000) {
    toInput = findFirstElement(GMAIL_SELECTORS.toField, container) || findFirstElement(GMAIL_SELECTORS.toField);
    if (toInput) break;

    // Trigger click on recipient wrapper if present to activate input
    const toWrapper = (container || document).querySelector('div[aria-label*="To"], div[aria-label*="Recipients"], div[peoplekit-inputpath], td.a1, div.vO');
    if (toWrapper) {
      simulateClick(toWrapper);
    }
    await sleep(300);
  }

  if (!toInput) return false;

  toInput.focus();
  simulateClick(toInput);
  await sleep(150);

  if ('value' in toInput) {
    toInput.value = email;
  } else {
    toInput.textContent = email;
  }

  toInput.dispatchEvent(new Event('input', { bubbles: true }));
  toInput.dispatchEvent(new Event('change', { bubbles: true }));

  await sleep(200);

  toInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', keyCode: 13, which: 13, bubbles: true }));
  toInput.dispatchEvent(new KeyboardEvent('keydown', { key: ',', keyCode: 188, which: 188, bubbles: true }));
  toInput.dispatchEvent(new Event('blur', { bubbles: true }));

  return true;
}

/**
 * Populates the Subject field.
 */
async function fillSubjectField(container, subject) {
  const subjectInput = findFirstElement(GMAIL_SELECTORS.subjectField, container) || findFirstElement(GMAIL_SELECTORS.subjectField);
  if (!subjectInput) return false;

  subjectInput.focus();
  simulateClick(subjectInput);
  await sleep(100);

  subjectInput.value = '';
  subjectInput.value = subject;
  subjectInput.dispatchEvent(new Event('input', { bubbles: true }));
  subjectInput.dispatchEvent(new Event('change', { bubbles: true }));
  return true;
}

/**
 * Populates the contenteditable message body field.
 */
async function fillBodyField(container, body) {
  const bodyInput = findFirstElement(GMAIL_SELECTORS.bodyField, container) || findFirstElement(GMAIL_SELECTORS.bodyField);
  if (!bodyInput) return false;

  bodyInput.focus();
  simulateClick(bodyInput);
  await sleep(150);

  // Clear existing content to prevent body text concatenation
  bodyInput.innerHTML = '';

  const htmlBody = body.replace(/\n/g, '<br>');

  try {
    document.execCommand('insertHTML', false, htmlBody);
  } catch (e) {
    bodyInput.innerHTML = htmlBody;
  }

  bodyInput.dispatchEvent(new Event('input', { bubbles: true }));
  bodyInput.dispatchEvent(new Event('change', { bubbles: true }));
  return true;
}

/**
 * Attaches a file (Resume/document) to Gmail's compose window using standard DataTransfer API.
 * @param {Element} container - Compose dialog DOM container.
 * @param {Object} attachmentPayload - { fileName, fileType, base64Data }
 * @returns {Promise<boolean>}
 */
async function attachFileToCompose(container, attachmentPayload) {
  try {
    // Check if attachment chip is already present to prevent duplicate attachments
    const existingChips = container.querySelectorAll('div[aria-label*="Attachment"], div.vI, div.aV, div[role="listitem"]');
    if (existingChips && existingChips.length > 0) {
      return true;
    }

    const file = base64PayloadToFile(attachmentPayload);
    if (!file) return false;

    let fileInput = findFirstElement(GMAIL_SELECTORS.attachmentInput, container) || findFirstElement(GMAIL_SELECTORS.attachmentInput);
    if (!fileInput) return false;

    const dataTransfer = new DataTransfer();
    dataTransfer.items.add(file);
    fileInput.files = dataTransfer.files;

    fileInput.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  } catch (err) {
    console.error('[Gmail Auto Sender] Attachment error:', err);
    return false;
  }
}

/**
 * Locates and triggers the Send button in Gmail compose dialog.
 */
async function clickSendButton(container) {
  if (!container || !document.contains(container)) return false;

  // 1. Target native Gmail blue Send button (div.aoO) specifically
  let sendBtn = container.querySelector('div.aoO') ||
                container.querySelector('div[role="button"][data-tooltip*="Send"]') ||
                container.querySelector('div[role="button"][aria-label*="Send"]') ||
                findFirstElement(GMAIL_SELECTORS.sendButton, container);

  if (sendBtn) {
    simulateClick(sendBtn);
  }

  // 2. Dispatch Ctrl + Enter on bodyInput as secondary dispatch trigger
  const bodyInput = findFirstElement(GMAIL_SELECTORS.bodyField, container);
  if (bodyInput) {
    bodyInput.focus();
    const isMac = navigator.platform.toUpperCase().indexOf('MAC') >= 0;
    const eventOpts = {
      key: 'Enter',
      code: 'Enter',
      keyCode: 13,
      which: 13,
      ctrlKey: !isMac,
      metaKey: isMac,
      bubbles: true,
      cancelable: true
    };
    bodyInput.dispatchEvent(new KeyboardEvent('keydown', eventOpts));
    bodyInput.dispatchEvent(new KeyboardEvent('keyup', eventOpts));
  }

  // 3. Wait up to 5 seconds to verify compose dialog disappears from screen
  const startTime = Date.now();
  while (Date.now() - startTime < 5000) {
    await sleep(400);
    if (!document.contains(container) || container.offsetParent === null) {
      return true; // Sent successfully!
    }
  }

  // 4. Retry click if window is still open
  sendBtn = container.querySelector('div.aoO') || findFirstElement(GMAIL_SELECTORS.sendButton, container);
  if (sendBtn) {
    simulateClick(sendBtn);
    await sleep(1500);
    if (!document.contains(container) || container.offsetParent === null) {
      return true;
    }
  }

  // If send failed, discard the draft so it doesn't linger or duplicate
  console.warn('[Gmail Auto Sender] Send action failed to close compose window. Discarding draft...');
  await closeAllComposeWindows();
  return false;
}

/**
 * Simulates realistic mouse click sequence.
 */
function simulateClick(element) {
  if (!element) return;
  const opts = { bubbles: true, cancelable: true, view: window };
  element.dispatchEvent(new MouseEvent('mousedown', opts));
  element.dispatchEvent(new MouseEvent('mouseup', opts));
  element.dispatchEvent(new MouseEvent('click', opts));
}
