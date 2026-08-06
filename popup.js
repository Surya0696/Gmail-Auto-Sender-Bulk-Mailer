/**
 * Extension Popup UI Controller for Gmail Auto Sender.
 * Manages tab switching, CSV parsing, attachment handling, campaign controls,
 * dedicated Failed Mail List rendering, live state sync, preview modals, logs export, and settings storage.
 */

// Application state held in memory
let parsedRecipients = [];
let currentCsvFile = null;
let currentAttachment = null;
let liveSyncInterval = null;

document.addEventListener('DOMContentLoaded', async () => {
  await initUI();
  setupEventListeners();
  startLiveSync();
});

/**
 * Initializes UI values from stored settings and state.
 */
async function initUI() {
  const settings = await StorageManager.getSettings();
  const state = await StorageManager.getState();
  const campaign = await StorageManager.getCampaign();

  // Apply Dark/Light theme
  if (settings.darkMode) {
    document.body.classList.add('dark-theme');
    document.body.classList.remove('light-theme');
  } else {
    document.body.classList.add('light-theme');
    document.body.classList.remove('dark-theme');
  }

  // Restore Settings Form Fields
  document.getElementById('dailyLimitInput').value = settings.dailyLimit || 500;
  document.getElementById('delayPresetSelect').value = settings.delayPreset || '15-25';
  document.getElementById('minDelayInput').value = settings.minDelay || 15;
  document.getElementById('maxDelayInput').value = settings.maxDelay || 25;
  document.getElementById('retryCountInput').value = settings.retryCount !== undefined ? settings.retryCount : 1;
  document.getElementById('signatureInput').value = settings.signature || '';

  if (settings.delayPreset === 'custom') {
    document.getElementById('customDelayRow').classList.remove('hidden');
  }

  // Restore Email Form Fields
  if (campaign.subject) document.getElementById('subjectInput').value = campaign.subject;
  if (campaign.body) document.getElementById('bodyInput').value = campaign.body;

  if (campaign.recipients && campaign.recipients.length > 0) {
    parsedRecipients = campaign.recipients;
    showFileInfo('Saved List', campaign.recipients.length, 0);
  }

  // Restore Resume/Attachment if previously saved
  if (campaign.attachment && campaign.attachment.base64Data) {
    currentAttachment = campaign.attachment;
    showAttachmentInfo(campaign.attachment.fileName, campaign.attachment.fileSize);
  }

  // Update Progress Dashboard & Control Buttons
  updateCopyrightNotice();
  updateStateUI(state);
  await renderFailedMailListUI();
  await renderLogsUI();
}

/**
 * Dynamically updates the copyright notice text with the current month and year.
 */
function updateCopyrightNotice() {
  const el = document.getElementById('copyrightNotice');
  if (el) {
    const now = new Date();
    const monthYear = now.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
    el.textContent = `© ${monthYear} - Surya P R. All rights reserved.`;
  }
}

/**
 * Sets up all event listeners for DOM buttons, tabs, inputs, and modals.
 */
function setupEventListeners() {
  // Tab Navigation
  document.querySelectorAll('.tab-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const targetTabId = btn.getAttribute('data-tab');
      switchTab(targetTabId);
    });
  });

  // Theme Toggle
  document.getElementById('themeToggleBtn').addEventListener('click', toggleTheme);

  // CSV Drag and Drop & Browsing
  const dropZone = document.getElementById('dropZone');
  const csvFileInput = document.getElementById('csvFileInput');

  dropZone.addEventListener('dragover', (e) => {
    e.preventDefault();
    dropZone.classList.add('dragover');
  });

  dropZone.addEventListener('dragleave', () => dropZone.classList.remove('dragover'));

  dropZone.addEventListener('drop', (e) => {
    e.preventDefault();
    dropZone.classList.remove('dragover');
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      handleCsvFileSelect(e.dataTransfer.files[0]);
    }
  });

  csvFileInput.addEventListener('change', (e) => {
    if (e.target.files && e.target.files.length > 0) {
      handleCsvFileSelect(e.target.files[0]);
    }
  });

  document.getElementById('removeFileBtn').addEventListener('click', removeCsvFile);

  // Resume/Attachment File Selection
  const resumeFileInput = document.getElementById('resumeFileInput');
  resumeFileInput.addEventListener('change', async (e) => {
    if (e.target.files && e.target.files.length > 0) {
      await handleAttachmentSelect(e.target.files[0]);
    }
  });

  document.getElementById('removeAttachmentBtn').addEventListener('click', removeAttachmentFile);

  // Placeholder Chip Click
  document.querySelectorAll('.chip').forEach((chip) => {
    chip.addEventListener('click', () => {
      const tag = chip.getAttribute('data-tag');
      insertTextAtCursor(document.getElementById('bodyInput'), tag);
    });
  });

  // Delay Preset Change
  document.getElementById('delayPresetSelect').addEventListener('change', (e) => {
    const customRow = document.getElementById('customDelayRow');
    if (e.target.value === 'custom') {
      customRow.classList.remove('hidden');
    } else {
      customRow.classList.add('hidden');
      const [min, max] = e.target.value.split('-').map(Number);
      document.getElementById('minDelayInput').value = min;
      document.getElementById('maxDelayInput').value = max;
    }
  });

  // Campaign Buttons
  document.getElementById('startBtn').addEventListener('click', startCampaign);
  document.getElementById('pauseBtn').addEventListener('click', pauseCampaign);
  document.getElementById('resumeBtn').addEventListener('click', resumeCampaign);
  document.getElementById('stopBtn').addEventListener('click', stopCampaign);

  // Modals
  document.getElementById('previewBtn').addEventListener('click', openPreviewModal);
  document.getElementById('closePreviewBtn').addEventListener('click', closePreviewModal);
  document.getElementById('closePreviewModalBtn').addEventListener('click', closePreviewModal);

  document.getElementById('testSendBtn').addEventListener('click', openTestModal);
  document.getElementById('closeTestModalBtn').addEventListener('click', closeTestModal);
  document.getElementById('cancelTestModalBtn').addEventListener('click', closeTestModal);
  document.getElementById('confirmTestSendBtn').addEventListener('click', confirmTestSend);

  // View Failed List Quick Button
  document.getElementById('viewFailedListBtn').addEventListener('click', () => switchTab('logsTab'));

  // Logs Action Buttons
  document.getElementById('exportLogsBtn').addEventListener('click', exportLogsToCsv);
  document.getElementById('exportFailedLogsBtn').addEventListener('click', exportFailedLogsToCsv);
  document.getElementById('retryFailedBtn').addEventListener('click', retryFailedEmails);
  document.getElementById('campaignRetryFailedBtn').addEventListener('click', retryFailedEmails);

  document.getElementById('clearLogsBtn').addEventListener('click', clearAllLogs);
  document.getElementById('logFilterSelect').addEventListener('change', renderLogsUI);

  // Settings Save Button
  document.getElementById('saveSettingsBtn').addEventListener('click', saveSettingsFromForm);
}

/**
 * Handles Tab Switching.
 */
function switchTab(tabId) {
  document.querySelectorAll('.tab-btn').forEach((b) => b.classList.remove('active'));
  document.querySelectorAll('.tab-panel').forEach((p) => p.classList.remove('active'));

  const activeBtn = document.querySelector(`.tab-btn[data-tab="${tabId}"]`);
  const activePanel = document.getElementById(tabId);

  if (activeBtn && activePanel) {
    activeBtn.classList.add('active');
    activePanel.classList.add('active');
  }

  if (tabId === 'logsTab') {
    renderFailedMailListUI();
    renderLogsUI();
  }
}

/**
 * Toggles dark and light mode themes.
 */
async function toggleTheme() {
  const isDark = document.body.classList.contains('dark-theme');
  if (isDark) {
    document.body.classList.remove('dark-theme');
    document.body.classList.add('light-theme');
  } else {
    document.body.classList.remove('light-theme');
    document.body.classList.add('dark-theme');
  }
  await StorageManager.saveSettings({ darkMode: !isDark });
}

/**
 * Processes selected CSV file and parses content.
 */
function handleCsvFileSelect(file) {
  if (!file || !file.name.endsWith('.csv')) {
    showToast('Please select a valid .csv file');
    return;
  }

  currentCsvFile = file;
  const reader = new FileReader();

  reader.onload = (e) => {
    const csvContent = e.target.result;
    const result = parseCSV(csvContent);

    if (result.error && result.recipients.length === 0) {
      showToast(result.error);
      return;
    }

    parsedRecipients = result.recipients;
    showFileInfo(file.name, result.validRows, result.invalidCount);

    saveCurrentCampaignData();
    showToast(`Loaded ${result.validRows} recipient emails`);
  };

  reader.readAsText(file);
}

/**
 * Displays CSV file metadata chip UI.
 */
function showFileInfo(fileName, validCount, invalidCount) {
  document.getElementById('dropZone').classList.add('hidden');
  const chip = document.getElementById('fileInfoChip');
  chip.classList.remove('hidden');

  document.getElementById('fileName').textContent = fileName;
  document.getElementById('fileMetrics').textContent = `${validCount} valid emails${invalidCount > 0 ? ` (${invalidCount} invalid skipped)` : ''}`;
}

/**
 * Clears current CSV selection.
 */
function removeCsvFile() {
  parsedRecipients = [];
  currentCsvFile = null;
  document.getElementById('csvFileInput').value = '';
  document.getElementById('fileInfoChip').classList.add('hidden');
  document.getElementById('dropZone').classList.remove('hidden');

  saveCurrentCampaignData();
}

/**
 * Reads and attaches a Resume/document file.
 */
async function handleAttachmentSelect(file) {
  if (!file) return;

  try {
    const payload = await fileToBase64Payload(file);
    currentAttachment = payload;
    showAttachmentInfo(file.name, file.size);
    saveCurrentCampaignData();
    showToast(`Attached ${file.name}`);
  } catch (err) {
    showToast('Failed to read attachment file');
  }
}

/**
 * Displays attachment chip UI.
 */
function showAttachmentInfo(fileName, fileSize) {
  document.getElementById('attachmentUploadBox').classList.add('hidden');
  const chip = document.getElementById('attachmentInfoChip');
  chip.classList.remove('hidden');

  document.getElementById('attachmentName').textContent = fileName;
  document.getElementById('attachmentSize').textContent = formatFileSize(fileSize);
}

/**
 * Removes attached file.
 */
function removeAttachmentFile() {
  currentAttachment = null;
  document.getElementById('resumeFileInput').value = '';
  document.getElementById('attachmentInfoChip').classList.add('hidden');
  document.getElementById('attachmentUploadBox').classList.remove('hidden');

  saveCurrentCampaignData();
  showToast('Attachment removed');
}

/**
 * Helper to save active campaign data into storage.
 */
function saveCurrentCampaignData() {
  const subject = document.getElementById('subjectInput').value.trim();
  const body = document.getElementById('bodyInput').value.trim();
  StorageManager.saveCampaign({
    recipients: parsedRecipients,
    subject,
    body,
    attachment: currentAttachment
  });
}

/**
 * Inserts text/tag into a target textarea at current cursor position.
 */
function insertTextAtCursor(inputEl, text) {
  const start = inputEl.selectionStart;
  const end = inputEl.selectionEnd;
  const val = inputEl.value;

  inputEl.value = val.substring(0, start) + text + val.substring(end);
  inputEl.selectionStart = inputEl.selectionEnd = start + text.length;
  inputEl.focus();
}

/**
 * Starts the campaign dispatch process.
 */
async function startCampaign() {
  const subject = document.getElementById('subjectInput').value.trim();
  const body = document.getElementById('bodyInput').value.trim();

  if (!parsedRecipients || parsedRecipients.length === 0) {
    showToast('Please upload a CSV file with recipients first');
    return;
  }

  if (!subject) {
    showToast('Please enter an email Subject');
    return;
  }

  if (!body) {
    showToast('Please enter an email Message Body');
    return;
  }

  const settings = gatherSettingsFromForm();

  const payload = {
    campaignData: {
      recipients: parsedRecipients,
      subject,
      body,
      attachment: currentAttachment
    },
    settings
  };

  chrome.runtime.sendMessage({ action: 'START_CAMPAIGN', payload }, (response) => {
    if (response && response.success) {
      showToast('Campaign started!');
      updateStateUI(response.state);
    } else {
      showToast(response ? response.error : 'Failed to start campaign');
    }
  });
}

/**
 * Pauses campaign execution.
 */
function pauseCampaign() {
  chrome.runtime.sendMessage({ action: 'PAUSE_CAMPAIGN' }, (response) => {
    if (response && response.success) {
      showToast('Campaign paused');
      updateStateUI(response.state);
    }
  });
}

/**
 * Resumes campaign execution.
 */
function resumeCampaign() {
  chrome.runtime.sendMessage({ action: 'RESUME_CAMPAIGN' }, (response) => {
    if (response && response.success) {
      showToast('Campaign resumed');
      updateStateUI(response.state);
    }
  });
}

/**
 * Stops campaign execution.
 */
function stopCampaign() {
  chrome.runtime.sendMessage({ action: 'STOP_CAMPAIGN' }, (response) => {
    if (response && response.success) {
      showToast('Campaign stopped');
      updateStateUI(response.state);
    }
  });
}

/**
 * Opens email preview modal.
 */
function openPreviewModal() {
  const subject = document.getElementById('subjectInput').value.trim();
  const body = document.getElementById('bodyInput').value.trim();
  const signature = document.getElementById('signatureInput').value.trim();

  const sampleRow = parsedRecipients.length > 0 ? (parsedRecipients[0].data || parsedRecipients[0]) : { email: 'demo@example.com', name: 'John Doe' };

  const renderedSubject = renderTemplate(subject || 'Sample Subject {{name}}', sampleRow, signature);
  const renderedBody = renderTemplate(body || 'Hello {{name}},\n\nThis is a preview email body.', sampleRow, signature);

  document.getElementById('previewTo').textContent = sampleRow.email || 'demo@example.com';
  document.getElementById('previewSubject').textContent = renderedSubject;
  document.getElementById('previewAttachmentVal').textContent = currentAttachment ? `${currentAttachment.fileName} (${formatFileSize(currentAttachment.fileSize)})` : 'None';
  document.getElementById('previewBody').textContent = renderedBody;

  document.getElementById('previewModal').classList.remove('hidden');
}

function closePreviewModal() {
  document.getElementById('previewModal').classList.add('hidden');
}

/**
 * Opens test email modal.
 */
function openTestModal() {
  document.getElementById('testSendModal').classList.remove('hidden');
}

function closeTestModal() {
  document.getElementById('testSendModal').classList.add('hidden');
}

/**
 * Confirms single test email dispatch.
 */
function confirmTestSend() {
  const testEmail = document.getElementById('testEmailInput').value.trim();
  const subject = document.getElementById('subjectInput').value.trim();
  const body = document.getElementById('bodyInput').value.trim();

  if (!testEmail || !validateEmail(testEmail)) {
    showToast('Please enter a valid test email address');
    return;
  }

  closeTestModal();
  showToast('Dispatching test email...');

  chrome.runtime.sendMessage({
    action: 'TEST_SEND',
    payload: {
      testEmail,
      subject,
      body,
      attachment: currentAttachment
    }
  }, (response) => {
    if (response && response.success) {
      showToast('Test email sent successfully!');
    } else {
      showToast(`Test send failed: ${response ? response.error : 'Unknown error'}`);
    }
  });
}

/**
 * Synchronizes UI controls and dashboard metrics with background state.
 */
function updateStateUI(state) {
  if (!state) return;

  const statusBadge = document.getElementById('statusBadge');
  const status = state.status || 'IDLE';

  statusBadge.textContent = status;
  statusBadge.className = `status-pill ${status.toLowerCase()}`;

  const total = state.total || 0;
  const sent = state.sentCount || 0;
  const failed = state.failedCount || 0;
  const remaining = Math.max(0, total - (sent + failed + (state.skippedCount || 0)));

  document.getElementById('sentCountText').textContent = sent;
  document.getElementById('remainingCountText').textContent = remaining;
  document.getElementById('failedCountText').textContent = failed;
  document.getElementById('currentRecipientText').textContent = state.currentRecipient || 'None';
  document.getElementById('estTimeText').textContent = `Est. Time: ${state.estimatedTimeRemaining || '--:--'}`;

  const progressPercent = total > 0 ? Math.min(100, Math.round(((sent + failed + (state.skippedCount || 0)) / total) * 100)) : 0;
  document.getElementById('progressBar').style.width = `${progressPercent}%`;

  // Failed Actions Row visibility
  const failedRow = document.getElementById('failedActionsRow');
  if (failed > 0) {
    failedRow.classList.remove('hidden');
  } else {
    failedRow.classList.add('hidden');
  }

  // Control Buttons Visibility State
  const startBtn = document.getElementById('startBtn');
  const pauseBtn = document.getElementById('pauseBtn');
  const resumeBtn = document.getElementById('resumeBtn');
  const stopBtn = document.getElementById('stopBtn');

  startBtn.classList.add('hidden');
  pauseBtn.classList.add('hidden');
  resumeBtn.classList.add('hidden');
  stopBtn.classList.add('hidden');

  if (status === 'RUNNING') {
    pauseBtn.classList.remove('hidden');
    stopBtn.classList.remove('hidden');
  } else if (status === 'PAUSED') {
    resumeBtn.classList.remove('hidden');
    stopBtn.classList.remove('hidden');
  } else {
    startBtn.classList.remove('hidden');
  }
}

/**
 * Renders the dedicated Failed Mail List Table.
 */
async function renderFailedMailListUI() {
  const logs = await StorageManager.getLogs();
  const failedLogs = logs.filter((item) => item.status === 'failed');
  const tbody = document.getElementById('failedTableBody');
  const countEl = document.getElementById('failedListCount');

  countEl.textContent = failedLogs.length;
  tbody.innerHTML = '';

  if (failedLogs.length === 0) {
    tbody.innerHTML = '<tr><td colspan="3" class="empty-log">No failed emails in this campaign.</td></tr>';
    return;
  }

  failedLogs.forEach((item) => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td class="failed-email-cell">${escapeHtml(item.recipient)}</td>
      <td class="failed-reason-cell">${escapeHtml(item.error || 'Send Failed')}</td>
      <td class="failed-time-cell">${escapeHtml(item.timestamp ? item.timestamp.split(' ')[1] : '')}</td>
    `;
    tbody.appendChild(tr);
  });
}

/**
 * Renders campaign logs table.
 */
async function renderLogsUI() {
  const logs = await StorageManager.getLogs();
  const filter = document.getElementById('logFilterSelect').value;
  const listEl = document.getElementById('logsList');

  listEl.innerHTML = '';

  const filtered = logs.filter((item) => filter === 'ALL' || item.status === filter);

  if (filtered.length === 0) {
    listEl.innerHTML = '<li class="empty-log">No campaign events found.</li>';
    return;
  }

  filtered.forEach((item) => {
    const li = document.createElement('li');
    let badgeClass = item.status || 'waiting';

    li.innerHTML = `
      <div class="log-item">
        <div class="log-header-row">
          <span class="log-recipient">${escapeHtml(item.recipient)}</span>
          <span class="log-badge ${badgeClass}">${escapeHtml(item.status)}</span>
        </div>
        <div class="log-header-row">
          <span class="log-detail">${escapeHtml(item.subject || item.error || '')}</span>
          <span class="log-time">${escapeHtml(item.timestamp || '')}</span>
        </div>
        ${item.error && item.status === 'failed' ? `<div class="log-detail" style="color:var(--danger-color)">Error: ${escapeHtml(item.error)}</div>` : ''}
      </div>
    `;
    listEl.appendChild(li);
  });
}

/**
 * Exports ALL stored logs to downloadable CSV file.
 */
async function exportLogsToCsv() {
  const logs = await StorageManager.getLogs();

  if (!logs || logs.length === 0) {
    showToast('No log data to export');
    return;
  }

  let csvContent = 'Timestamp,Recipient,Subject,Status,Error\n';

  logs.forEach((log) => {
    const row = [
      escapeCsvValue(log.timestamp),
      escapeCsvValue(log.recipient),
      escapeCsvValue(log.subject),
      escapeCsvValue(log.status),
      escapeCsvValue(log.error || '')
    ].join(',');
    csvContent += row + '\n';
  });

  downloadCsv(csvContent, `gmail_campaign_all_logs_${Date.now()}.csv`);
  showToast('All logs exported to CSV');
}

/**
 * Exports ONLY FAILED emails to downloadable CSV file.
 */
async function exportFailedLogsToCsv() {
  const logs = await StorageManager.getLogs();
  const failedLogs = logs.filter((l) => l.status === 'failed' && validateEmail(l.recipient));

  if (!failedLogs || failedLogs.length === 0) {
    showToast('No failed emails found in campaign logs');
    return;
  }

  let csvContent = 'email,timestamp,subject,error_reason\n';

  failedLogs.forEach((log) => {
    const row = [
      escapeCsvValue(log.recipient),
      escapeCsvValue(log.timestamp),
      escapeCsvValue(log.subject),
      escapeCsvValue(log.error || 'Send Failed')
    ].join(',');
    csvContent += row + '\n';
  });

  downloadCsv(csvContent, `failed_emails_list_${Date.now()}.csv`);
  showToast(`Exported ${failedLogs.length} failed emails to CSV`);
}

/**
 * Creates a new campaign queue containing ONLY the failed recipients and restarts campaign.
 */
async function retryFailedEmails() {
  const logs = await StorageManager.getLogs();
  const failedLogs = logs.filter((l) => l.status === 'failed' && validateEmail(l.recipient));

  if (!failedLogs || failedLogs.length === 0) {
    showToast('No failed emails found to retry');
    return;
  }

  const failedEmailsSet = new Set(failedLogs.map((l) => l.recipient.toLowerCase()));

  let retryList = parsedRecipients.filter((r) => failedEmailsSet.has(r.email.toLowerCase()));

  if (retryList.length === 0) {
    retryList = Array.from(failedEmailsSet).map((email, idx) => ({
      id: `retry_${idx}_${Date.now()}`,
      email,
      name: '',
      data: { email },
      status: 'pending',
      error: null
    }));
  }

  parsedRecipients = retryList;
  showFileInfo('Failed Retry Queue', parsedRecipients.length, 0);

  switchTab('campaignTab');

  showToast(`Loaded ${parsedRecipients.length} failed emails for retry. Click Start!`);
}

/**
 * Downloads a CSV string as a file.
 */
function downloadCsv(csvContent, fileName) {
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.setAttribute('href', url);
  link.setAttribute('download', fileName);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

/**
 * Clears all logs.
 */
async function clearAllLogs() {
  await StorageManager.clearLogs();
  await renderFailedMailListUI();
  await renderLogsUI();
  showToast('Logs cleared');
}

/**
 * Reads form settings inputs and updates chrome.storage.local.
 */
async function saveSettingsFromForm() {
  const settings = gatherSettingsFromForm();
  await StorageManager.saveSettings(settings);
  showToast('Settings saved successfully!');
}

/**
 * Helper to collect current settings values from DOM.
 */
function gatherSettingsFromForm() {
  const preset = document.getElementById('delayPresetSelect').value;
  let minSec = Number(document.getElementById('minDelayInput').value);
  let maxSec = Number(document.getElementById('maxDelayInput').value);

  if (preset !== 'custom') {
    const [min, max] = preset.split('-').map(Number);
    minSec = min;
    maxSec = max;
  }

  return {
    dailyLimit: Number(document.getElementById('dailyLimitInput').value) || 500,
    delayPreset: preset,
    minDelay: Math.max(1, minSec),
    maxDelay: Math.max(minSec, maxSec),
    retryCount: Number(document.getElementById('retryCountInput').value),
    signature: document.getElementById('signatureInput').value.trim(),
    randomDelay: true,
    darkMode: document.body.classList.contains('dark-theme')
  };
}

/**
 * Polls background service worker for live campaign progress updates.
 */
function startLiveSync() {
  if (liveSyncInterval) clearInterval(liveSyncInterval);

  liveSyncInterval = setInterval(async () => {
    const state = await StorageManager.getState();
    updateStateUI(state);
    renderFailedMailListUI();
  }, 1000);
}

/**
 * Displays a toast notification message.
 */
function showToast(message) {
  const toast = document.getElementById('toast');
  const msgEl = document.getElementById('toastMessage');
  msgEl.textContent = message;

  toast.classList.remove('hidden');
  setTimeout(() => {
    toast.classList.add('hidden');
  }, 3000);
}

/**
 * Helper to escape HTML characters.
 */
function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
