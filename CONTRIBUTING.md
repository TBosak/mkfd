## 🤝 Contributing to Mkfd

Thanks for considering a contribution to **Mkfd**! This project turns webpages, email folders, or REST APIs into structured RSS feeds using Bun and Hono. Below are ways you can get involved and help improve the project.

---

### 🧑‍💻 Code Contributions

- **Fix Bugs**
  - Help identify and patch issues in feed parsing, scheduling, or UI logic.
- **Complete To-Do Items**
  - Check off tasks listed in [`README.md`](https://github.com/TBosak/mkfd#-to-do).
- **Feature Development**
  - Propose and implement new features.
- **Improve the Web UI**
  - Enhance the `index.html` GUI or improve its responsiveness and user experience.

### 📄 Documentation

- **Improve Existing Docs**
  - Expand `README.md` with usage examples and troubleshooting tips.
- **Add New Guides**
  - Create tutorials for building feeds from various sources.
  - Document how CSS selectors and API mappings work.

### 🧪 Testing

- **Write Tests**
  - Add unit/integration tests for utilities and adapters.
- **Report Bugs**
  - Open detailed GitHub issues with steps to reproduce problems.
- **Cross-Browser Testing**
  - Ensure GUI functionality across different browsers.

### 🛠️ DevOps

- **Improve Docker Setup**
  - Optimize the Dockerfile or suggest multi-arch improvements.
- **Create Helm Charts**
  - Add Kubernetes deployment files for streamlined hosting.
  - Work on TrueNAS app catalog integration.
- **Add CI for Testing**
  - Propose GitHub Actions for test and lint automation.

### 🌍 Community & Support

- **Help in Issues or Discussions**
  - Answer questions and guide new users.
- **Feature Requests**
  - Suggest new functionalities via GitHub issues.
- **Translations**
  - Contribute internationalization for UI or docs.

### 💡 Ideas & Feedback

- **Use the App**
  - Try building your own feeds and tell us what works or what doesn't.
- **Feedback Matters**
  - Open issues for ideas, bugs, or UI/UX improvements.

---

## 🛠️ Getting Started

1. Install dependencies:
    ```bash
    bun install
    ```
2. Run the app locally:
    ```bash
    bun run index.ts --passkey=your_passkey --cookieSecret=your_cookie_secret --encryptionKey=your_encryption_key_here
    ```
3. Access it via:
    ```
    http://localhost:5000/
    ```

---

## 🚀 How to Contribute

1. **Fork** the repository on GitHub.
2. **Clone** your fork locally:
   ```bash
   git clone https://github.com/your-username/mkfd.git
   cd mkfd
   ```
3. **Create a new branch** for your feature or fix:
   ```bash
   git checkout -b your-feature-name
   ```
4. **Make your changes**, test them locally, and commit:
   ```bash
   git commit -am "Add your message here"
   ```
5. **Push** the branch to your fork:
   ```bash
   git push origin your-feature-name
   ```
6. **Open a Pull Request** against the `main` branch on the original repository.

We’ll review your PR and work with you to get it merged. Welcome aboard ✨

Thanks again for helping improve Mkfd 💜
