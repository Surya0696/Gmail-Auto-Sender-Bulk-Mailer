# Gmail Web Auto-Sender (Manifest V3 Chrome Extension)

An automated bulk mailer for **Gmail Web** (`https://mail.google.com`). This extension opens Gmail in Chrome, parses a recipient CSV file, attaches your resume/document, personalizes every email individually, and sends each email standardly via Gmail's compose interface with human-like delays, queue controls, state persistence, dark mode, failed mail list exports, and instant retry features.

---

## 🌟 Features

- **Chrome Extension (Manifest V3)**: Built with modern ES6 JS, Service Worker background orchestration, and content scripts.
- **Direct Gmail Web Automation**: Operates inside `https://mail.google.com` without requiring Gmail API keys or SMTP server configuration.
- **Failed Mail List & Export**: Dedicated **"❌ Export Failed CSV"** button to download a clean CSV file containing only failed email addresses and error diagnostic reasons (`failed_emails_list_YYYY-MM-DD.csv`).
- **Instant Retry Failed Queue**: **"🔄 Retry Failed Emails"** button to automatically re-populate the queue with only failed recipients and attempt sending to them again.
- **Resume & Document Attachment**: Attach your resume (`.pdf`, `.docx`, `.doc`, `.txt`) to send along with every personalized bulk email.
- **Individual Bulk Emailing**: Sends separate, individually-addressed emails to each recipient (NOT one email with CC/BCC or multiple addresses in 'To').
- **CSV Import & Generic Placeholders**: Supports any CSV format containing an `email` header (plus `name` or custom columns like `{{company}}`, `{{role}}`).
- **Smart Fallback Handling**: `Hello {{name}}` automatically renders as `Hello,` if the recipient's name is missing.
- **Randomized Delays & Rate Limiting**: Presets for `10-15s`, `15-25s`, `20-40s`, or custom ranges to mimic human sending and stay within Gmail limits.
- **Campaign Controls**: Start, Pause, Resume, Stop anytime. Live progress bar, counters, and estimated time remaining (HH:MM:SS).
- **State Recovery & Persistence**: Automatically resumes campaigns after extension reloads or browser restarts using `chrome.storage.local` with `unlimitedStorage` for large resume files.
- **Test Send & Email Preview**: Preview personalized email output for recipient #1 (including attachment confirmation) or dispatch a single test email before launching the campaign.
- **Log Management & Export**: Track status (`✔ Sent`, `❌ Failed`, `⏳ Skipped`), filter by event type, and export all or failed logs to CSV.
- **Safety Rules**: Prevents duplicate sends, skips invalid email address formats, retries failed sends once, and enforces customizable daily caps.
- **Modern UI**: Gmail/Material Design tabbed interface with Dark Mode and Light Mode support.

---

## 📁 Extension File Structure

```
d:/email/
├── manifest.json       # Manifest V3 specification with unlimitedStorage
├── popup.html          # Extension Popup Interface (Campaign, Attachment Box, Failed Mail Bar, Logs, Settings, Modals)
├── popup.css           # Material Design CSS theme (Dark/Light mode & Failed Mail Actions styling)
├── popup.js            # UI controller, attachment reader, failed mail exporter & retry handlers
├── background.js       # Service Worker campaign queue coordinator & attachment relay
├── content.js          # Gmail DOM automation script (Compose, To, Subject, Body, Attachment, Send)
├── utils.js            # Helpers (Validation, Base64/File conversion, Delays, Interpolation)
├── csvParser.js        # RFC-4180 compliant CSV parser
├── storage.js          # chrome.storage.local wrapper for persistence
├── icons/              # Extension icons (16px, 48px, 128px)
└── README.md           # User manual and documentation
```

---

## 🚀 Installation Guide

### 1. Enable Developer Mode in Chrome

1. Open Google Chrome.
2. Navigate to `chrome://extensions/` in the address bar.
3. Toggle the **Developer mode** switch in the top-right corner to **ON**.

### 2. Load Unpacked Extension

1. Click the **Load unpacked** button in the top-left corner.
2. Browse to and select the extension directory (`d:\email`).
3. The **Gmail Auto Sender - Bulk Mailer** icon will appear in your Chrome extensions bar.

---

## 📄 CSV Format & Placeholder Instructions

### Sample CSV (With Name & Role):

```csv
email,name,role,company
john@example.com,John,Software Engineer,Acme Corp
david@example.com,David,Product Manager,TechSolutions
sarah@example.com,Sarah,UI/UX Designer,DesignHub
```

### Placeholder Usage:

- `Subject`: `Application for {{role}} - {{name}}`
- `Body`: `Hello {{name}},\n\nPlease find attached my resume for the {{role}} position at {{company}}.\n\nBest regards,`

#### Smart Fallback Rules:

- If `name` is present: `Hello {{name}}` -> `Hello John`
- If `name` is missing: `Hello {{name}}` -> `Hello,`

---

## 📊 Managing Failed Emails

### 1. Export Failed Mail List

- Open the extension popup and go to the **Logs** tab (or check the Live Progress card when failures occur).
- Click **❌ Export Failed CSV**.
- The extension will instantly generate and download `failed_emails_list_<timestamp>.csv` containing the failed email addresses, failure timestamps, and exact diagnostic reasons.

### 2. Retry Failed Emails

- Click **🔄 Retry Failed Emails**.
- The extension automatically creates a new queue containing **only** the failed recipients.
- Click **🚀 Start Sending** to retry sending to those recipients.

---

## 📖 How to Attach Resume & Send

1. **Open Gmail**: Log in to `https://mail.google.com` in Google Chrome.
2. **Open Extension**: Click the **Gmail Auto Sender** icon in your browser toolbar.
3. **Upload CSV**: Drag and drop your `.csv` file into **1. Recipient List**.
4. **Draft Email**: Write your **Subject** and **Body** with placeholders like `{{name}}`, `{{role}}`.
5. **Attach Resume**:
   - In section **3. Attach Resume / Document (Optional)**, select your resume file (e.g. `My_Resume.pdf`).
   - The file size and name chip will appear.
6. **Preview & Test**:
   - Click **Preview** to verify how your email and attachment will appear for Recipient #1.
   - Click **Test Send** to send a test copy (with resume attached) to your test email address.
7. **Start Campaign**: Click **🚀 Start Sending**.

---

## ⚖ Safety Best Practices

1. **Recommended Delay**: Use `15-25 seconds` or higher between emails.
2. **Daily Sending Limits**: Free Gmail (max 500 emails/day), Workspace (max 2,000 emails/day).

## Create by Surya P R

## Thank You
