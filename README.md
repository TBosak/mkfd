<p align="center">
  <img src="https://user-images.githubusercontent.com/41713011/184979066-5ec001ec-bc72-4ed9-a18c-1fd2211edd76.png"
       alt="mkfd"
       height="35%"
       width="35%" /><br>
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
- [X] Create GUI  
- [ ] Utilities  
  - [X] HTML stripper  
  - [X] Source URL wrapper for relative links  
- [ ] Amass contributors  

<br>

[![paypal](https://www.paypalobjects.com/en_US/i/btn/btn_donateCC_LG.gif)](https://www.paypal.com/cgi-bin/webscr?cmd=_s-xclick&hosted_button_id=V5LC4XTQDDE82&source=url)
