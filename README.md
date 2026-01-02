<p align="center">
  <img src="https://github.com/TBosak/mkfd/blob/main/public/logo.png?raw=true"
       alt="mkfd"
       height="100px"
       width="100px"/><br><br>
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

### 🐙 Docker Compose

For easier deployment, use the provided `docker-compose.yml`:

1. Copy `.env.example` to `.env` and fill in your values:
```bash
cp .env.example .env
# Edit .env with your preferred editor
```

2. Start the application:
```bash
docker-compose up -d
```

The docker-compose setup includes:
- Automatic restart policy
- Health monitoring
- Volume mount for configs
- Optional autoheal service (uncomment in docker-compose.yml to enable)

### 🏥 Auto-restart on Failure

The Docker image includes a healthcheck that monitors the application every 5 minutes. You can configure Docker to automatically restart the container if the healthcheck fails:

```bash
docker run -p 5000:5000 -v /local/mount/path:/app/configs \
  --restart=unless-stopped \
  -e PASSKEY=your_passkey \
  -e COOKIE_SECRET=your_cookie_secret \
  -e ENCRYPTION_KEY=your_encryption_key \
  -e SSL=true/false \
  tbosk/mkfd:latest
```

Alternatively, use [Autoheal](https://github.com/willfarrell/docker-autoheal) to automatically restart unhealthy containers in docker-compose setups.

## 🔌 Chrome Extensions for Advanced Scraping

Mkfd supports loading Chrome extensions when using advanced scraping mode (Playwright).

### 📁 Setting Up Extensions

1. **Prepare your extensions**: Create a directory for unpacked Chrome extensions. Each extension should be in its own subdirectory.

   ```
   extensions/
   ├── extension1/
   │   ├── manifest.json
   │   └── ... (other extension files)
   └── extension2/
       ├── manifest.json
       └── ... (other extension files)
   ```

2. **Configure the path**: Set the `CHROME_EXTENSIONS_PATH` environment variable to point to your extensions directory.
This is optional, the default path is "/app/extensions".

### 🐳 Docker Setup

When using Docker or Docker Compose, mount your extensions directory as a volume:

**Docker Run:**
```bash
docker run -p 5000:5000 \
  -v /local/mount/path:/app/configs \
  -v /path/to/extensions:/app/extensions \
  -e PASSKEY=your_passkey \
  -e COOKIE_SECRET=your_cookie_secret \
  -e ENCRYPTION_KEY=your_encryption_key \
  tbosk/mkfd:latest
```

**Docker Compose:**

The included `docker-compose.yml` already has extensions support configured:
- Extensions directory: `./extensions` (in the same directory as docker-compose.yml)
- Environment variable is set automatically

Simply place your unpacked extensions in `./extensions/` and they will be loaded when using advanced scraping mode.

### ⚙️ How It Works

- Extensions are automatically discovered and loaded when using advanced scraping mode
- Each subdirectory in the extensions path is treated as a separate extension
- Extensions only load when "Advanced Scraping" is enabled for a feed
- If no extensions are found or the path doesn't exist, advanced scraping works normally without extensions

## 📧 Email Feeds

Mkfd supports email feeds via IMAP. You can use any email provider that supports IMAP, such as Gmail, Yahoo, or Outlook. To set up an email feed, you need to provide the following information:

- **Email address**: The email address you want to use for the feed.
- **IMAP server**: The IMAP server address for your email provider. For example, Gmail's IMAP server is `imap.gmail.com`.
- **IMAP port**: The port number for the IMAP server. For Gmail, this is `993`.
- **IMAP password**: The password for your email account. You may need to generate an app password if you have two-factor authentication enabled.
- **Folder**: The folder you want to monitor for new emails. Ex: `INBOX`.

The encryption key is used to encrypt your password before storing it in the yaml config file. This is important for security reasons, as it prevents anyone from accessing your password in plain text. Make sure to use an encryption key that is at least 16 characters long.

Email feeds do not refresh on intervals. The process runs continuously and updates when a new email is received.

### Memory Allocation

Email feeds run in a separate Node.js process with a default memory allocation of 4GB. If you have large mailboxes or need different memory settings, you can override this by setting the `NODE_OPTIONS` environment variable:

```bash
# Increase to 8GB
NODE_OPTIONS="--max-old-space-size=8192" bun run index.ts

# Docker example
docker run -e NODE_OPTIONS="--max-old-space-size=8192" -p 5000:5000 ... tbosk/mkfd:latest
```

## 🖼️ GUI

<img width="1788" height="1879" alt="image" src="https://github.com/user-attachments/assets/7c3cd96d-e66f-4193-834e-ba4553cb8261" />

---

## 🌎 Environment Variables / Command Line Arguments

- **Passkey**: A passkey is a unique identifier that is used to authenticate requests to the Mkfd API. It is used to ensure that only authorized users can access the API and perform actions such as creating, updating, or deleting feeds.

- **Cookie secret**: A cookie secret is a random string that is used to sign cookies in the Mkfd application. It is used to ensure that cookies cannot be tampered with by malicious users. The cookie secret must be at least 32 characters long.

- **Encryption key**: An encryption key is a random string that is used to encrypt sensitive data in the Mkfd application. It is used to ensure that sensitive data, such as passwords, cannot be accessed by unauthorized users. The encryption key must 16, 24, or 32 characters long.

- **SSL**: A boolean value that indicates whether to use SSL for the Mkfd application. Set to true if serving over HTTPS, false if serving over HTTP.

---

## 🔗 What is a Drill Chain?

A drill chain is a sequence of CSS selector steps used to navigate through multiple HTML pages to extract a final value (e.g., a link, image, or text). This is useful when data cannot be accessed from a single page or selector alone—such as when a link leads to another page that contains the actual data of interest.

### 🔍 Why Use Drill Chains?

Some websites structure content across multiple layers:
 - The first page contains a list of links.
 - The second page (linked from the first) contains the actual title, image, or description.
 - Drill chains automate that navigation process.

---

## 🔧 To Do

- [x] Add ALL possible RSS fields to models
- [x] Add option for parallel iterators
- [ ] Scraping how-to video/gif
- [ ] Email feed how-to video/gif
- [x] Add feed preview pane
- [ ] Store/compare all feed data to enable timestamping feed items
- [x] Create dockerfile
- [x] Create GUI
- [x] Utilities
  - [x] HTML stripper
  - [x] Source URL wrapper for relative links
  - [x] Nested link follower/drilldown functionality for each feed item property
  - [x] Adjust date parser logic with overrides from an optional date format input
  - [x] Add selector suggestion engine
- [x] Front-end redesign (react + shadcn)
  - [ ] Redesign active feeds page
  - [ ] New dark mode or theme system
- [x] Flaresolverr integration
- [ ] Change detection feeds
  - [ ] With diff descriptions
- [ ] Amass contributors

<br>

[![paypal](https://www.paypalobjects.com/en_US/i/btn/btn_donateCC_LG.gif)](https://www.paypal.com/cgi-bin/webscr?cmd=_s-xclick&hosted_button_id=V5LC4XTQDDE82&source=url)
