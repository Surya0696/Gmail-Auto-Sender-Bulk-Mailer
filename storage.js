/**
 * Chrome Storage Manager for Gmail Auto Sender Extension.
 * Handles state persistence, settings, logs, campaign data, and attachment storage in chrome.storage.local.
 */

const DEFAULT_SETTINGS = {
  dailyLimit: 500,
  delayPreset: "15-25",
  minDelay: 15,
  maxDelay: 25,
  retryCount: 1,
  signature: "",
  randomDelay: true,
  darkMode: true,
};

const DEFAULT_CAMPAIGN_STATE = {
  status: "IDLE", // 'IDLE', 'RUNNING', 'PAUSED', 'STOPPED', 'COMPLETED'
  currentIndex: 0,
  total: 0,
  sentCount: 0,
  failedCount: 0,
  skippedCount: 0,
  currentRecipient: null,
  startTime: null,
  estimatedTimeRemaining: "00:00",
  lastUpdated: Date.now(),
};

/**
 * Storage wrapper module providing promise-based access to chrome.storage.local.
 */
const StorageManager = {
  /**
   * Retrieves user settings from chrome.storage.local.
   * @returns {Promise<Object>} Settings object merged with defaults.
   */
  async getSettings() {
    return new Promise((resolve) => {
      chrome.storage.local.get(["settings"], (result) => {
        resolve({ ...DEFAULT_SETTINGS, ...(result.settings || {}) });
      });
    });
  },

  /**
   * Saves updated settings to chrome.storage.local.
   * @param {Object} newSettings - Object containing settings updates.
   * @returns {Promise<Object>} Updated settings object.
   */
  async saveSettings(newSettings) {
    const current = await this.getSettings();
    const updated = { ...current, ...newSettings };
    return new Promise((resolve) => {
      chrome.storage.local.set({ settings: updated }, () => {
        resolve(updated);
      });
    });
  },

  /**
   * Saves active campaign details (recipients array, subject template, body template, attachment).
   * @param {Object} campaign - Campaign configuration { recipients, subject, body, attachment }.
   * @returns {Promise<void>}
   */
  async saveCampaign(campaign) {
    return new Promise((resolve) => {
      chrome.storage.local.set({ campaignData: campaign }, resolve);
    });
  },

  /**
   * Retrieves active campaign details.
   * @returns {Promise<Object>} Campaign data object { recipients: [], subject: '', body: '', attachment: null }.
   */
  async getCampaign() {
    return new Promise((resolve) => {
      chrome.storage.local.get(["campaignData"], (result) => {
        resolve(
          result.campaignData || {
            recipients: [],
            subject: "",
            body: "",
            attachment: null,
          },
        );
      });
    });
  },

  /**
   * Saves current campaign status state (progress index, sent/failed metrics, state flag).
   * @param {Object} state - State update properties.
   * @returns {Promise<Object>} Updated full state object.
   */
  async saveState(state) {
    const current = await this.getState();
    const updated = { ...current, ...state, lastUpdated: Date.now() };
    return new Promise((resolve) => {
      chrome.storage.local.set({ campaignState: updated }, () => {
        resolve(updated);
      });
    });
  },

  /**
   * Retrieves current campaign state.
   * @returns {Promise<Object>} Full campaign state object.
   */
  async getState() {
    return new Promise((resolve) => {
      chrome.storage.local.get(["campaignState"], (result) => {
        resolve({ ...DEFAULT_CAMPAIGN_STATE, ...(result.campaignState || {}) });
      });
    });
  },

  /**
   * Resets campaign state to initial IDLE default.
   * @returns {Promise<Object>} Initial state.
   */
  async resetState() {
    return new Promise((resolve) => {
      chrome.storage.local.set(
        { campaignState: DEFAULT_CAMPAIGN_STATE },
        () => {
          resolve(DEFAULT_CAMPAIGN_STATE);
        },
      );
    });
  },

  /**
   * Retrieves all logged campaign activity events.
   * @returns {Promise<Array<Object>>} Array of log objects.
   */
  async getLogs() {
    return new Promise((resolve) => {
      chrome.storage.local.get(["logs"], (result) => {
        resolve(result.logs || []);
      });
    });
  },

  /**
   * Appends a new event entry to logs in chrome.storage.local.
   * @param {Object} logEntry - Log payload { recipient, subject, status, error, timestamp }.
   * @returns {Promise<Array<Object>>} Updated logs array.
   */
  async addLog(logEntry) {
    const logs = await this.getLogs();
    const newEntry = {
      id: `log_${Date.now()}_${Math.random().toString(36).substr(2, 4)}`,
      timestamp: formatTimestamp(new Date()),
      recipient: logEntry.recipient || "Unknown",
      subject: logEntry.subject || "No Subject",
      status: logEntry.status || "waiting", // 'sent', 'failed', 'waiting', 'skipped'
      error: logEntry.error || null,
    };
    logs.unshift(newEntry);
    const trimmedLogs = logs.slice(0, 1000);
    return new Promise((resolve) => {
      chrome.storage.local.set({ logs: trimmedLogs }, () => {
        resolve(trimmedLogs);
      });
    });
  },

  /**
   * Clears all campaign logs.
   * @returns {Promise<void>}
   */
  async clearLogs() {
    return new Promise((resolve) => {
      chrome.storage.local.set({ logs: [] }, resolve);
    });
  },

  /**
   * Retrieves array of previously sent email addresses from persistent history.
   * @returns {Promise<Array<string>>}
   */
  async getSentHistory() {
    return new Promise((resolve) => {
      chrome.storage.local.get(["sentHistory"], (result) => {
        resolve(result.sentHistory || []);
      });
    });
  },

  /**
   * Adds a successfully sent email address to persistent sent history.
   * @param {string} email - Recipient email.
   * @returns {Promise<void>}
   */
  async addSentEmail(email) {
    if (!email) return;
    const history = await this.getSentHistory();
    const cleanEmail = email.trim().toLowerCase();
    if (!history.includes(cleanEmail)) {
      history.push(cleanEmail);
      return new Promise((resolve) => {
        chrome.storage.local.set({ sentHistory: history }, resolve);
      });
    }
  },

  /**
   * Checks whether an email address has already been sent to previously.
   * @param {string} email - Recipient email.
   * @returns {Promise<boolean>} True if already sent.
   */
  async isEmailSent(email) {
    if (!email) return false;
    const history = await this.getSentHistory();
    return history.includes(email.trim().toLowerCase());
  },
};

// Export object for environment support
if (typeof module !== "undefined" && module.exports) {
  module.exports = StorageManager;
}
