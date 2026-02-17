<div align="center">

# 🎵 Musify

**Experience music in its purest aesthetic form.**

[![Live Demo](https://img.shields.io/badge/Demo-Live-brightgreen?style=for-the-badge&logo=netlify)](https://adixdd-musify.netlify.app/)
[![Tech Stack](https://img.shields.io/badge/Stack-Node%20%7C%20FastAPI%20%7C%20JS-blue?style=for-the-badge)](https://github.com/adityaprajapati-0/Musify)
[![License](https://img.shields.io/badge/License-MIT-orange?style=for-the-badge)](LICENSE)

<br/>

> [!TIP]
> **Musify** is a multi-page, ultra-aesthetic music web application featuring high-end glassmorphism, real-time data sync, and an AI-powered Singing Judge.

</div>

---

## 💎 Features at a Glance

| Feature              | Description                                                                |
| :------------------- | :------------------------------------------------------------------------- |
| **🎨 Premium UI**    | Fluid glassmorphism, animated wave effects, and curated color palettes.    |
| **⚡ Shared Player** | Persistent top bar player that stays synced as you navigate between pages. |
| **🤖 AI Judge**      | Voice-cloning and LLM-powered feedback for your singing performances.      |
| **🔍 Smart Search**  | Deep integration with iTunes and Apple Music for real-time song data.      |
| **📱 Responsive**    | Edge-to-edge aesthetic flow adapted for both desktop and mobile users.     |

---

## 🏗️ System Architecture

```mermaid
graph TD
    User((User)) --> Frontend[Frontend: HTML/JS/CSS]
    Frontend --> Proxy[Node.js Proxy Server]
    Proxy --> MusicAPIs[iTunes/Apple Music APIs]
    Proxy --> AI_Engine[AI Judge: Python FastAPI]
    AI_Engine --> LLM[Groq Llama 3]
    AI_Engine --> TTS[Edge TTS]
    AI_Engine --> Analysis[Audio Analysis Engine]
```

---

## 🚀 Getting Started

### 1. Launch the Backend & Proxy

```powershell
.\start-server.ps1 -Port 5501
```

### 2. Prepare the AI Engine

```powershell
cd "ai_engine"
pip install -r requirements.txt
uvicorn main:app --host 0.0.0.0 --port 8000
```

### 3. Open the Experience

Navigate to [adixdd-musify.netlify.app](https://adixdd-musify.netlify.app/) and start the flow.

---

## 🛠️ Tech Stack Showcase

<div align="center">

![JS](https://img.shields.io/badge/JavaScript-F7DF1E?style=for-the-badge&logo=javascript&logoColor=black)
![Node](https://img.shields.io/badge/Node.js-339933?style=for-the-badge&logo=nodedotjs&logoColor=white)
![Python](https://img.shields.io/badge/Python-3776AB?style=for-the-badge&logo=python&logoColor=white)
![FastAPI](https://img.shields.io/badge/FastAPI-005571?style=for-the-badge&logo=fastapi&logoColor=white)
![Powershell](https://img.shields.io/badge/PowerShell-5391FE?style=for-the-badge&logo=powershell&logoColor=white)

</div>

---

## 📂 Project Structure

- `index.html` — The minimalist hero entry point.
- `songs.html` — Trending charts and artist discovery.
- `ai.html` — The high-tech Singing Judge interface.
- `common.js` — Core logic and state management.
- `server.js` — The robust local proxy layer.
- `ai_engine/` — Deep learning audio processing & feedback.

---

<div align="center">

_Crafted with passion for the ultimate music discovery experience._

**© 2026 Musify Team**

</div>
