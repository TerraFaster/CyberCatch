# 🌐 CyberCatch // Neon-Cyberpunk Web Arcade

[![Node.js](https://img.shields.io/badge/Node.js-18%2B-green.svg)](https://nodejs.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Vanilla JS](https://img.shields.io/badge/Client-Vanilla%20JS-blue.svg)](https://developer.mozilla.org/en-US/docs/Web/JavaScript)
[![HTML5 Canvas](https://img.shields.io/badge/Graphics-HTML5%20Canvas-orange.svg)](https://developer.mozilla.org/en-US/docs/Web/API/Canvas_API)

A high-performance, neon-cyberpunk browser arcade game inspired by the classic Soviet hand-held game *"Nu, pogodi!"* (Wolf catches eggs). Intercept falling data cores (cyber-eggs) before your system shields overload. 

CyberCatch features a client-side HTML5 Canvas 2D engine paired with a server-authoritative Node.js backend. It enforces strict security policies through replay simulation to verify scores, award achievement progress, and manage the in-game cosmetic economy.

---

## 🕹️ Live Demo & Visuals

* **Responsive Cyberpunk HUD** with dynamic CSS scanline overlay, CRT filter effects, and holographic retro system logs overlaying the canvas.
* **Custom Glassmorphism UI** features a tailored toast notification and modal dialog system replacing default browser dialogs, keeping player immersion completely unbroken.

---

## ✨ Features

### 🎮 Core Gameplay & Progression
* **Egg Spawning & Types:** 7 distinct data core types (Standard, Slow, Overclock, Freeze, Double Score, Repair, and Virus) each with custom speeds, colors, and behaviors.
* **Upgrades Shop:** Spend upgrade points earned at the end of each round to customize your hardware:
  * **Engine Speed:** Horizontal movement velocity.
  * **Receiver Hitbox:** Catcher grab range.
  * **Anchor (Slow-field):** Active duration of the time-dilating field.
  * **Shield Matrix:** Maximum lives/integrity.

### ⚡ Twitch Chat Integration
* Connect your Twitch channel anonymously via WebSocket (IRC).
* Audience commands allow viewers to trigger chaotic global game events in real-time:
  * `!storm` — Double score, rapid spawns.
  * `!blackout` — Reduces screen visibility (fog of war).
  * `!virus` — Floods the screen with virus cores.
  * `!shift` — Inverts movement controls.
  * `!laser` — Fires telegraphed hazard beams to dodge.
  * `!gravity` — Reverses gravity, causing cores to fall upward.

### 🛡️ Server-Authoritative Anti-Cheat & Replays
* Every game records a tiny, deterministic input log (keys, timeline tick, and mouse/touch coordinate vectors).
* The backend does **not** trust client score submissions. Instead, it re-simulates the entire game tick-by-tick from the input stream.
* Personal records, credits (CC), quest progress, and achievements are saved only if the server validation simulation matches the submitted result.
* Replays are compressed (Gzip/Base64) and can be saved, shared via a unique URL, and played back directly inside the browser.

### 🛍️ Economy & Customization
* **CyberCredits (CC):** Earned from verified gameplay runs (1 CC per 10 points).
* **Cosmetics:** Unlock custom wolf skins and holographic particle trails in the Shop menu.
* **TerraSite Dev Sync:** Cloud synchronization integration for cross-device authentication and profile storage.

---

## 🛠️ Tech Stack

### Client-Side (Frontend)
* **Graphics:** Native 2D Context HTML5 Canvas (custom vector render pipelines, neon glow effects).
* **Audio:** Procedural Web Audio API sound generator. No heavy audio asset downloads required.
* **Styles:** Custom CSS3 with cyberpunk font-families (`Orbitron` & `Share Tech Mono`), customized CSS variables, CRT grid filters, and custom smooth transitions.
* **Frameworks:** **None.** Pure Vanilla JS (ES Modules).

### Server-Side (Backend)
* **Platform:** Node.js (v18+).
* **Framework:** **None.** Built on Node's native `http` module.
* **Database:** No database server required. Persists state locally using atomic JSON flat-files (`server/leaderboard.json`, `server/user_profiles.json`, `server/replays/`).

---

## 📂 Project Structure

```text
cybercatch/
├── client/                  # Frontend static files served by the backend
│   ├── index.html           # Main markup & modal templates
│   ├── style.css            # Cyan/Pink design system, responsive layouts & custom modal/toast CSS
│   ├── assets/              # Static media assets (fallback images/logos)
│   └── js/
│       ├── main.js           # DOM listeners, Twitch sockets, sub-menu routing
│       ├── engine.js         # Game loop, physics updates, upgrades shop
│       ├── render.js         # Canvas render layers (HUD, lasers, particles)
│       ├── api.js            # Node REST API client & cloud synchronizer
│       ├── state.js          # Shared mutable game variables
│       ├── config.js         # Skins, upgrades, trails database definitions
│       ├── sound.js          # Web Audio synth for procedurally generated SFX
│       └── utils.js          # Seeded randomizer, Replay Codec, Toast/Modal controllers
├── server/
│   └── server.js             # API Router, Static File Server, Replay verification engine
├── .gitignore               # Configured to ignore runtime DB files, logs, and node_modules
├── start.bat                # Windows server batch launcher
└── package.json             # App scripts and core dependencies
```

---

## 🚀 Getting Started

### 📋 Prerequisites
* **Node.js v18.0.0** or higher.
* A modern web browser supporting ES Modules and Web Audio.

### 🔧 Local Installation
1. Clone or copy the directory.
2. In the project root, start the server:
   ```bash
   # Run the server (defaults to port 7995)
   node server/server.js
   
   # Or start on a custom port
   PORT=8080 node server/server.js
   ```
   *Windows users can simply double-click the `start.bat` file.*

3. Open **`http://localhost:7995`** in your browser. The Node.js backend serves static files itself, removing any CORS issues or need for separate static host configurations.

---

## ⚙️ Configuration Options

| Environment Variable | CLI Argument | Default Value | Purpose |
|---|---|---|---|
| `PORT` | `process.argv[2]` | `7995` | Local TCP port for the HTTP/API server. |
| — | `SECRET_SALT` (in code) | `CYBER_SECRET_SALT_2026` | Signature token salt. Change in `server/server.js` and `client/js/utils.js` if you deploy your own fork. |

---

To deploy the application to a production VPS:

1. **Transfer Files:** Upload the `client/` and `server/` directories, along with `package.json`, to your server directory (e.g., `/var/www/html/cybercatch`).
2. **Process Management:** Install **PM2** globally (`npm install -g pm2`) and start the application:
   ```bash
   pm2 start server/server.js --name "cybercatch" -- 7995
   ```
3. **Reverse Proxy:** Configure a web server (like Nginx or Apache) to forward public API and static file requests to `http://localhost:7995`. This keeps traffic on standard ports (80/443) and handles SSL terminations securely.

---

## 📜 License

This project is licensed under the MIT License - see the LICENSE file for details.
