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

### 📦 To install dependencies

```bash
bun install
```

### 🚀 To run

```bash
bun run index.ts --passkey=your_passkey_here --cookieSecret=your_cookie_secret_here
```

➡️ Access the GUI at `http://localhost:5000/`

---

## 🐳 Running with Docker

### 🏠 Locally

```bash
docker build -t mkfd .
docker run -p 5000:5000 -v /local/mount/path:/configs -e PASSKEY=your_passkey -e COOKIE_SECRET=your_cookie_secret mkfd
```

### 📥 From Docker Hub

```bash
docker pull tbosk/mkfd:latest
docker run -p 5000:5000 -v /local/mount/path:/configs -e PASSKEY=your_passkey -e COOKIE_SECRET=your_cookie_secret tbosk/mkfd:latest
```

## 🖼️ GUI

![mkfdgui](https://github.com/user-attachments/assets/620d4f1f-15a6-4120-8265-6ba07aa4aa27)

---

## 🔧 To Do

- [x] **Locally** testing subscriptions to feeds
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
  - [ ] Nested link follower/drilldown functionality for each feed field
  - [x] Adjust date parser logic with overrides from an optional date format input
  - [ ] Add selector suggestion engine
- [ ] Amass contributors

<br>

[![paypal](https://www.paypalobjects.com/en_US/i/btn/btn_donateCC_LG.gif)](https://www.paypal.com/cgi-bin/webscr?cmd=_s-xclick&hosted_button_id=V5LC4XTQDDE82&source=url)
