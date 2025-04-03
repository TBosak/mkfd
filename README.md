<p align="center">
  <img src="https://github.com/TBosak/mkfd/blob/main/public/logo.png?raw=true"
       alt="mkfd"
       height="15%"
       width="15%"/><br><br>
  <img alt="Docker Pulls" src="https://img.shields.io/docker/pulls/tbosk/mkfd">
  <img alt="GitHub Repo stars" src="https://img.shields.io/github/stars/tbosak/mkfd">
</p>

## 🏃 Running locally

### 🍞 Bun installation <sup>Visit [bun.sh](https://bun.sh/) for more info</sup>

```bash
curl https://bun.sh/install | bash
```

If you are using email feeds, you will need to install a version of NodeJS that can run typescript natively. Mkfd creates a Node process for email feeds, as Bun does not currently play well with the popular IMAP packages that are built to run in Node.

### 📦 To install dependencies

```bash
bun install
```

### 🚀 To run

```bash
bun run index.ts --passkey=your_passkey_here --cookieSecret=your_cookie_secret_here --encryptionKey=your_encryption_key_here --ssl=true/false
```

➡️ Access the GUI at `http://localhost:5000/`

---

## 🐳 Running with Docker

### 🏠 Locally

```bash
docker build -t mkfd .
docker run -p 5000:5000 -v /local/mount/path:/app/configs -e PASSKEY=your_passkey -e COOKIE_SECRET=your_cookie_secret -e ENCRYPTION_KEY=your_encryption_key -e SSL=true/false mkfd
```

### 📥 From Docker Hub

```bash
docker pull tbosk/mkfd:latest
docker run -p 5000:5000 -v /local/mount/path:/app/configs -e PASSKEY=your_passkey -e COOKIE_SECRET=your_cookie_secret -e ENCRYPTION_KEY=your_encryption_key -e SSL=true/false tbosk/mkfd:latest
```

If you don't supply the keys and cookie secret, the app will prompt you for them (just make sure to run docker with "it" flag to get an interactive shell). Make sure to reuse your encryption key for email feeds.

## 📧 Email Feeds

Mkfd supports email feeds via IMAP. You can use any email provider that supports IMAP, such as Gmail, Yahoo, or Outlook. To set up an email feed, you need to provide the following information:

- **Email address**: The email address you want to use for the feed.
- **IMAP server**: The IMAP server address for your email provider. For example, Gmail's IMAP server is `imap.gmail.com`.
- **IMAP port**: The port number for the IMAP server. For Gmail, this is `993`.
- **IMAP password**: The password for your email account. You may need to generate an app password if you have two-factor authentication enabled.
- **Folder**: The folder you want to monitor for new emails. Ex: `INBOX`.

The encryption key is used to encrypt your password before storing it in the yaml config file. This is important for security reasons, as it prevents anyone from accessing your password in plain text. Make sure to use an encryption key that is at least 16 characters long.

Email feeds do not refresh on intervals. The process runs continuously and updates when a new email is received.

## 🖼️ GUI

![mkfdgui](https://github.com/user-attachments/assets/620d4f1f-15a6-4120-8265-6ba07aa4aa27)

---

## 🌎 Environment Variables / Command Line Arguments

- **Passkey**: A passkey is a unique identifier that is used to authenticate requests to the Mkfd API. It is used to ensure that only authorized users can access the API and perform actions such as creating, updating, or deleting feeds.

- **Cookie secret**: A cookie secret is a random string that is used to sign cookies in the Mkfd application. It is used to ensure that cookies cannot be tampered with by malicious users. The cookie secret must be at least 32 characters long.

- **Encryption key**: An encryption key is a random string that is used to encrypt sensitive data in the Mkfd application. It is used to ensure that sensitive data, such as passwords, cannot be accessed by unauthorized users. The encryption key must be at least 16 characters long.

- **SSL**: A boolean value that indicates whether to use SSL for the Mkfd application. Set to true if serving over HTTPS, false if serving over HTTP.

---

## 🔧 To Do

- [ ] Add ALL possible RSS fields to models
- [x] Add option for parallel iterators
- [ ] Scraping how-to video
- [x] Add feed preview pane
- [ ] Store/compare feed data to enable timestamping feed items
- [x] Create dockerfile
- [ ] Create Helm chart files
- [x] Create GUI
- [ ] Utilities
  - [x] HTML stripper
  - [x] Source URL wrapper for relative links
  - [ ] Nested link follower/drilldown functionality for each feed item property
  - [x] Adjust date parser logic with overrides from an optional date format input
  - [ ] Add selector suggestion engine
- [ ] Amass contributors

<br>

[![paypal](https://www.paypalobjects.com/en_US/i/btn/btn_donateCC_LG.gif)](https://www.paypal.com/cgi-bin/webscr?cmd=_s-xclick&hosted_button_id=V5LC4XTQDDE82&source=url)
