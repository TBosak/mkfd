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

## GUI

![mkfdgui](https://github.com/user-attachments/assets/620d4f1f-15a6-4120-8265-6ba07aa4aa27)

---

## 🔧 To Do

- [X] **Locally** testing subscriptions to feeds  
- [ ] Add all possible RSS fields to models  
- [X] Add option for parallel iterators  
- [ ] Add form validation  
- [ ] Add selector suggestion engine  
- [X] Add feed preview pane  
- [ ] Store/compare feed data to enable timestamping feed items  
- [X] Create dockerfile
- [ ] Create Helm chart files
- [X] Create GUI  
- [ ] Utilities  
  - [X] HTML stripper  
  - [X] Source URL wrapper for relative links  
- [ ] Amass contributors  

<br>

[![paypal](https://www.paypalobjects.com/en_US/i/btn/btn_donateCC_LG.gif)](https://www.paypal.com/cgi-bin/webscr?cmd=_s-xclick&hosted_button_id=V5LC4XTQDDE82&source=url)
