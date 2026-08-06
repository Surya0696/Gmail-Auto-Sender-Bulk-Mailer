/**
 * Background Service Worker for Gmail Auto Sender Extension (Manifest V3).
 * Coordinates campaign queue, delay timers, state recovery, desktop notifications,
 * attachment handling, and content script communication.
 */

// Import dependent utility modules into Service Worker global scope
importScripts('utils.js', 'csvParser.js', 'storage.js');

let activeTimerId = null;
let isDispatching = false;

/**
 * Extension installation and startup lifecycle events.
 */
chrome.runtime.onInstalled.addListener(() => {
  console.log('[Gmail Auto Sender] Extension installed.');
  StorageManager.getSettings();
});

chrome.runtime.onStartup.addListener(() => {
  console.log('[Gmail Auto Sender] Browser started. Recovering state...');
  recoverStateOnStartup();
});

/**
 * Listens for messages dispatched from popup UI or content script.
 */
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const { action, payload } = message;

  switch (action) {
    case 'START_CAMPAIGN':
      handleStartCampaign(payload)
        .then((res) => sendResponse(res))
        .catch((err) => sendResponse({ success: false, error: err.message }));
      return true;

    case 'PAUSE_CAMPAIGN':
      handlePauseCampaign()
        .then((res) => sendResponse(res));
      return true;

    case 'RESUME_CAMPAIGN':
      handleResumeCampaign()
        .then((res) => sendResponse(res));
      return true;

    case 'STOP_CAMPAIGN':
      handleStopCampaign()
        .then((res) => sendResponse(res));
      return true;

    case 'TEST_SEND':
      handleTestSend(payload)
        .then((res) => sendResponse(res))
        .catch((err) => sendResponse({ success: false, error: err.message }));
      return true;

    case 'GET_STATUS':
      StorageManager.getState().then((state) => sendResponse({ success: true, state }));
      return true;

    default:
      sendResponse({ success: false, error: 'Unknown action' });
      break;
  }
});

/**
 * Initializes a new campaign execution flow.
 * @param {Object} payload - { campaignData, settings }
 */
async function handleStartCampaign(payload) {
  const { campaignData, settings } = payload;

  if (!campaignData || !campaignData.recipients || campaignData.recipients.length === 0) {
    return { success: false, error: 'No recipient list provided' };
  }

  await StorageManager.saveSettings(settings);
  await StorageManager.saveCampaign(campaignData);

  const state = await StorageManager.saveState({
    status: 'RUNNING',
    currentIndex: 0,
    total: campaignData.recipients.length,
    sentCount: 0,
    failedCount: 0,
    skippedCount: 0,
    currentRecipient: campaignData.recipients[0].email,
    startTime: Date.now(),
    estimatedTimeRemaining: estimateRemainingTime(
      campaignData.recipients.length,
      settings.minDelay,
      settings.maxDelay
    )
  });

  updateBadge(`0/${state.total}`, '#1a73e8');

  runCampaignQueue();

  return { success: true, state };
}

/**
 * Pauses the currently running campaign.
 */
async function handlePauseCampaign() {
  if (activeTimerId) {
    clearTimeout(activeTimerId);
    activeTimerId = null;
  }
  isDispatching = false;

  const state = await StorageManager.saveState({ status: 'PAUSED' });
  updateBadge('PAUSE', '#f2994a');
  await StorageManager.addLog({
    recipient: 'System',
    subject: 'Campaign Status',
    status: 'paused',
    error: 'Campaign paused by user'
  });
  return { success: true, state };
}

/**
 * Resumes a paused campaign.
 */
async function handleResumeCampaign() {
  const state = await StorageManager.saveState({ status: 'RUNNING' });
  updateBadge('RUN', '#1a73e8');
  await StorageManager.addLog({
    recipient: 'System',
    subject: 'Campaign Status',
    status: 'waiting',
    error: 'Campaign resumed'
  });
  runCampaignQueue();
  return { success: true, state };
}

/**
 * Cancels/stops the current campaign.
 */
async function handleStopCampaign() {
  if (activeTimerId) {
    clearTimeout(activeTimerId);
    activeTimerId = null;
  }
  isDispatching = false;

  const state = await StorageManager.saveState({
    status: 'STOPPED',
    currentRecipient: null,
    estimatedTimeRemaining: '00:00'
  });
  updateBadge('STOP', '#eb5757');
  await StorageManager.addLog({
    recipient: 'System',
    subject: 'Campaign Status',
    status: 'failed',
    error: 'Campaign stopped by user'
  });
  return { success: true, state };
}

/**
 * Dispatches a single test email.
 * @param {Object} payload - { testEmail, subject, body, attachment }
 */
async function handleTestSend(payload) {
  const { testEmail, subject, body, attachment } = payload;
  const settings = await StorageManager.getSettings();

  const gmailTab = await findOrCreateGmailTab();
  if (!gmailTab) {
    return { success: false, error: 'Gmail web tab is not open or accessible.' };
  }

  await ensureContentScriptLoaded(gmailTab.id);

  const testRecipientRow = { email: testEmail, name: 'Tester' };
  const renderedSubject = renderTemplate(subject, testRecipientRow, settings.signature);
  const renderedBody = renderTemplate(body, testRecipientRow, settings.signature);

  const response = await chrome.tabs.sendMessage(gmailTab.id, {
    action: 'SEND_SINGLE_EMAIL',
    payload: {
      recipientEmail: testEmail,
      subject: renderedSubject,
      body: renderedBody,
      attachment: attachment || null
    }
  });

  if (response && response.success) {
    await StorageManager.addLog({
      recipient: testEmail,
      subject: renderedSubject,
      status: 'sent',
      error: `Test email successfully dispatched${attachment ? ' (with attachment)' : ''}`
    });
    showNotification('Test Email Sent', `Test email sent to ${testEmail}`);
    return { success: true };
  } else {
    const err = response ? response.error : 'No response from Gmail content script';
    await StorageManager.addLog({
      recipient: testEmail,
      subject: renderedSubject,
      status: 'failed',
      error: `Test send failed: ${err}`
    });
    return { success: false, error: err };
  }
}

/**
 * Main asynchronous queue execution loop.
 */
async function runCampaignQueue() {
  if (isDispatching) return;
  isDispatching = true;

  try {
    while (true) {
      let state = await StorageManager.getState();
      let campaign = await StorageManager.getCampaign();
      let settings = await StorageManager.getSettings();

      if (state.status !== 'RUNNING') {
        isDispatching = false;
        break;
      }

      if (state.currentIndex >= campaign.recipients.length) {
        await StorageManager.saveState({
          status: 'COMPLETED',
          currentRecipient: null,
          estimatedTimeRemaining: '00:00'
        });
        updateBadge('DONE', '#27ae60');
        const reportSummary = `Successfully processed ${state.total} recipients (✅ Sent: ${state.sentCount}, ⏭️ Skipped/Already Sent: ${state.skippedCount}, ⚠️ Failed: ${state.failedCount}).`;
        showNotification('Campaign Completed', reportSummary);
        await StorageManager.addLog({
          recipient: 'System',
          subject: 'Campaign Summary Report',
          status: 'sent',
          error: `📊 Campaign Finished!\n✅ Sent: ${state.sentCount}\n⏭️ Skipped/Already Sent: ${state.skippedCount}\n⚠️ Failed: ${state.failedCount}\n📊 Total Processed: ${state.total}`
        });
        isDispatching = false;
        break;
      }

      if (state.sentCount >= settings.dailyLimit) {
        await StorageManager.saveState({ status: 'PAUSED' });
        updateBadge('LIMIT', '#f2994a');
        showNotification('Daily Limit Reached', `Campaign paused after hitting daily limit of ${settings.dailyLimit} emails.`);
        await StorageManager.addLog({
          recipient: 'System',
          subject: 'Safety Limit',
          status: 'paused',
          error: `Daily limit of ${settings.dailyLimit} reached`
        });
        isDispatching = false;
        break;
      }

      const recipient = campaign.recipients[state.currentIndex];

      state = await StorageManager.saveState({
        currentRecipient: recipient.email,
        estimatedTimeRemaining: estimateRemainingTime(
          campaign.recipients.length - state.currentIndex,
          settings.minDelay,
          settings.maxDelay
        )
      });
      updateBadge(`${state.currentIndex + 1}/${state.total}`, '#1a73e8');

      // 1. Check Invalid Email Address Format
      if (!validateEmail(recipient.email)) {
        await StorageManager.addLog({
          recipient: recipient.email || 'Invalid Address',
          subject: campaign.subject,
          status: 'skipped',
          error: '❌ Invalid Email Address format'
        });
        state = await StorageManager.saveState({
          currentIndex: state.currentIndex + 1,
          skippedCount: state.skippedCount + 1
        });
        continue;
      }

      // 2. Check Previously Sent History
      const alreadySent = await StorageManager.isEmailSent(recipient.email);
      if (alreadySent) {
        await StorageManager.addLog({
          recipient: recipient.email,
          subject: campaign.subject,
          status: 'skipped',
          error: '📤 Already Sent to this recipient in a previous session'
        });
        state = await StorageManager.saveState({
          currentIndex: state.currentIndex + 1,
          skippedCount: state.skippedCount + 1
        });
        continue;
      }

      const gmailTab = await findOrCreateGmailTab();
      if (!gmailTab) {
        await StorageManager.saveState({ status: 'PAUSED' });
        await StorageManager.addLog({
          recipient: recipient.email,
          subject: campaign.subject,
          status: 'failed',
          error: 'Gmail tab not found or user closed Gmail tab'
        });
        showNotification('Gmail Not Open', 'Campaign paused because Gmail tab is not open.');
        isDispatching = false;
        break;
      }

      await ensureContentScriptLoaded(gmailTab.id);

      const rowData = recipient.data || { email: recipient.email, name: recipient.name };
      const renderedSubject = renderTemplate(campaign.subject, rowData, settings.signature);
      const renderedBody = renderTemplate(campaign.body, rowData, settings.signature);

      let sendResult = await sendEmailViaContentScript(
        gmailTab.id,
        recipient.email,
        renderedSubject,
        renderedBody,
        campaign.attachment
      );

      if (!sendResult.success && settings.retryCount > 0 && !sendResult.error?.includes('Invalid')) {
        console.warn(`[Gmail Auto Sender] Retrying send for ${recipient.email}...`);
        await sleep(2000);
        sendResult = await sendEmailViaContentScript(
          gmailTab.id,
          recipient.email,
          renderedSubject,
          renderedBody,
          campaign.attachment
        );
      }

      if (sendResult.success) {
        await StorageManager.addSentEmail(recipient.email);
        state = await StorageManager.saveState({
          currentIndex: state.currentIndex + 1,
          sentCount: state.sentCount + 1
        });
        await StorageManager.addLog({
          recipient: recipient.email,
          subject: renderedSubject,
          status: 'sent'
        });
      } else {
        state = await StorageManager.saveState({
          currentIndex: state.currentIndex + 1,
          failedCount: state.failedCount + 1
        });
        await StorageManager.addLog({
          recipient: recipient.email,
          subject: renderedSubject,
          status: 'failed',
          error: sendResult.error || 'Failed to send'
        });
      }

      state = await StorageManager.getState();

      if (state.status === 'RUNNING' && state.currentIndex < campaign.recipients.length) {
        const delayMs = getRandomDelay(settings.minDelay, settings.maxDelay);
        await interruptibleSleep(delayMs);
      }
    }
  } catch (err) {
    console.error('[Gmail Auto Sender] Queue exception:', err);
    await StorageManager.saveState({ status: 'PAUSED' });
    await StorageManager.addLog({
      recipient: 'System',
      subject: 'Error Exception',
      status: 'failed',
      error: err.message
    });
  } finally {
    isDispatching = false;
  }
}

/**
 * Sends single email command to content script in target tab.
 */
function sendEmailViaContentScript(tabId, recipientEmail, subject, body, attachment) {
  return new Promise((resolve) => {
    chrome.tabs.sendMessage(tabId, {
      action: 'SEND_SINGLE_EMAIL',
      payload: { recipientEmail, subject, body, attachment }
    }, (response) => {
      if (chrome.runtime.lastError) {
        resolve({ success: false, error: chrome.runtime.lastError.message });
      } else {
        resolve(response || { success: false, error: 'Empty content script response' });
      }
    });
  });
}

/**
 * Finds an open Gmail tab or opens a new background tab pointing to https://mail.google.com.
 */
async function findOrCreateGmailTab() {
  return new Promise((resolve) => {
    chrome.tabs.query({ url: 'https://mail.google.com/*' }, (tabs) => {
      if (tabs && tabs.length > 0) {
        resolve(tabs[0]);
      } else {
        chrome.tabs.create({ url: 'https://mail.google.com/', active: false }, (newTab) => {
          resolve(newTab || null);
        });
      }
    });
  });
}

/**
 * Dynamically ensures content script is injected into the target Gmail tab.
 */
async function ensureContentScriptLoaded(tabId) {
  return new Promise((resolve) => {
    chrome.tabs.sendMessage(tabId, { action: 'PING' }, (response) => {
      if (chrome.runtime.lastError || !response) {
        chrome.scripting.executeScript({
          target: { tabId },
          files: ['utils.js', 'content.js']
        }, () => {
          setTimeout(resolve, 500);
        });
      } else {
        resolve();
      }
    });
  });
}

/**
 * Sleep helper checking periodically if campaign was paused/stopped by user.
 */
async function interruptibleSleep(totalMs) {
  const stepMs = 500;
  let elapsed = 0;
  while (elapsed < totalMs) {
    const state = await StorageManager.getState();
    if (state.status !== 'RUNNING') {
      break;
    }
    await sleep(Math.min(stepMs, totalMs - elapsed));
    elapsed += stepMs;
  }
}

/**
 * Updates extension action icon badge text and color.
 */
function updateBadge(text, color) {
  chrome.action.setBadgeText({ text: text || '' });
  if (color) {
    chrome.action.setBadgeBackgroundColor({ color });
  }
}

/**
 * Displays desktop notification.
 */
function showNotification(title, message) {
  chrome.notifications.create(`notify_${Date.now()}`, {
    type: 'basic',
    iconUrl: 'icons/icon48.png',
    title: title || 'Gmail Auto Sender',
    message: message || '',
    priority: 2
  });
}

/**
 * Recovers running state when background service worker wakes up.
 */
async function recoverStateOnStartup() {
  const state = await StorageManager.getState();
  if (state.status === 'RUNNING') {
    runCampaignQueue();
  }
}
