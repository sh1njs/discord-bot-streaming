<div align="center">

```
██████╗ ██████╗      ██████╗ ████████╗██████╗ ███████╗ █████╗ ███╗   ███╗
██╔══██╗██╔════╝     ██╔════╝╚══██╔══╝██╔══██╗██╔════╝██╔══██╗████╗ ████║
██║  ██║██║          ╚█████╗    ██║   ██████╔╝█████╗  ███████║██╔████╔██║
██║  ██║██║           ╚═══██╗   ██║   ██╔══██╗██╔══╝  ██╔══██║██║╚██╔╝██║
██████╔╝╚██████╗     ██████╔╝   ██║   ██║  ██║███████╗██║  ██║██║ ╚═╝ ██║
╚═════╝  ╚═════╝     ╚═════╝    ╚═╝   ╚═╝  ╚═╝╚══════╝╚═╝  ╚═╝╚═╝     ╚═╝
```

<img src="https://img.shields.io/badge/Node.js-339933?style=for-the-badge&logo=nodedotjs&logoColor=white"/>
<img src="https://img.shields.io/badge/Discord-5865F2?style=for-the-badge&logo=discord&logoColor=white"/>
<img src="https://img.shields.io/badge/FFmpeg-007808?style=for-the-badge&logo=ffmpeg&logoColor=white"/>
<img src="https://img.shields.io/badge/License-MIT-yellow?style=for-the-badge"/>

**A self-bot powered Discord voice channel video streamer.**  
Stream movies directly into any voice channel with Go-Live quality — controlled from your terminal.

</div>

---

## ✨ Overview

**DC Stream** is a Node.js self-bot that streams `.mp4` videos into Discord voice channels using the Go-Live feature. It plays a **loading loop** video when idle, and switches to a **movie** on demand — all controlled via a simple terminal interface.

> ⚠️ **Disclaimer:** This project uses a Discord self-bot (`discord.js-selfbot-v13`), which violates Discord's Terms of Service. Use at your own risk. This project is intended for educational purposes only.

---

## 📁 Project Structure

```
DC/
├── assets/
│   ├── loading.mp4        # Looped idle video (plays when no movie is queued)
│   └── sc.js              # Helper/utility script
├── movie/
│   └── *.mp4              # Drop your movies here
├── play.js                # Main bot entrypoint
├── ecosystem.config.cjs   # PM2 process manager config
└── package.json
```

---

## ⚡ Features

| Feature | Description |
|---|---|
| 🎬 **Movie Streaming** | Stream any `.mp4` file into a Discord voice channel |
| 🔁 **Loading Loop** | Automatically loops `loading.mp4` when no movie is queued |
| 🖥️ **Console Controller** | Interact with the bot live from your terminal |
| 🎯 **Quality Presets** | Choose from multiple resolution/FPS/bitrate presets |
| 🔊 **Audio Boost** | Volume amplification support up to 5x |
| 👥 **Voice Tracking** | Tracks when users join/leave the target voice channel |
| ♻️ **Auto Loop** | Seamlessly returns to loading loop after movie ends |
| 🛡️ **Graceful Shutdown** | Handles `SIGINT`/`SIGTERM` cleanly |

---

## 🎨 Stream Quality Presets

| Preset | Resolution | FPS | Video Bitrate |
|---|---|---|---|
| `1080p60` | 1920×1080 | 60 | 4000 kbps |
| `720p60` | 1280×720 | 60 | 2500 kbps |
| `720p30` | 1280×720 | 30 | 1500 kbps |
| `480p30` | 854×480 | 30 | 800 kbps |
| `smooth` *(default)* | 1280×720 | 30 | 2000 kbps |
| `auto` | 1920×1080 | 30 | 2500 kbps |

> **Tip:** Use `smooth` for best compatibility. Use `1080p60` only if your machine and upload speed can handle it.

---

## 🛠️ Installation

### Prerequisites

- **Node.js** v18 or higher
- **FFmpeg** installed and available in `PATH`
- A Discord account token *(not a bot token)*

### Steps

```bash
# 1. Clone the repository
git clone https://github.com/sh1njs/discord-bot-streaming.git
cd discord-bot-streaming

# 2. Install dependencies
npm install

# 3. Set up environment variables
cp .env.example .env   # then fill in your values
```

---

## 🔧 Configuration

Create a `.env` file in the root directory:

```env
USER_TOKEN=your_discord_account_token_here
GUILD_ID=your_server_id_here
VOICE_CHANNEL_ID=your_voice_channel_id_here
TEXT_CHANNEL_ID=your_text_channel_id_here
```

### How to get your values

| Variable | How to get it |
|---|---|
| `USER_TOKEN` | Open Discord in browser → DevTools (F12) → Network tab → Find any request → Look for `Authorization` header |
| `GUILD_ID` | Right-click your server icon → *Copy Server ID* (Developer Mode must be ON) |
| `VOICE_CHANNEL_ID` | Right-click a voice channel → *Copy Channel ID* |
| `TEXT_CHANNEL_ID` | Right-click a text channel → *Copy Channel ID* |

> **Enable Developer Mode:** Discord Settings → Advanced → Developer Mode ✅

---

## 🚀 Running the Bot

### Direct run

```bash
node play.js
```

### Using PM2 (recommended for 24/7)

```bash
# Install PM2 globally
npm install -g pm2

# Start with PM2
pm2 start ecosystem.config.cjs

# View logs
pm2 logs

# Stop the bot
pm2 stop all
```

---

## 🎮 Console Commands

Once the bot is running, you control it directly from your terminal:

```
start   →  Browse and queue a movie from the /movie folder
stop    →  Stop the current movie and return to loading loop
```

### Example session

```
[STREAM] Loading loop ...

> start

[START] Available movies:
   1. Let The World Burn - AMV - Anime MV.mp4

Pilih nomor film: 1
[START] Queued: movie/Let The World Burn - AMV - Anime MV.mp4
[STREAM] Playing movie: movie/Let The World Burn - AMV - Anime MV.mp4
[STREAM] Movie done → returning to loading loop

> stop
[CONSOLE] Stop → back to loading
```

---

## 🎬 Adding Movies

Simply drop any `.mp4` file into the `movie/` folder:

```bash
cp /path/to/your/movie.mp4 movie/
```

The bot will automatically pick it up the next time you run the `start` command. No restart needed.

---

## 🔊 Audio Configuration

Audio is configured in `play.js` under `AUDIO_OPTS`:

```js
const AUDIO_OPTS = {
  bitrateAudio: 320,         // Audio bitrate in kbps (higher = better quality)
  audioFilters: "volume=3.0" // Volume multiplier (1.0 = normal, 3.0 = 3x louder)
};
```

> Adjust `volume` between `1.5` and `5.0` depending on your source audio level.

---

## 🔄 Changing Quality Preset

In `play.js`, find the bot instantiation at the bottom and change `quality`:

```js
const bot = new VoiceTrackerBot({
  token: process.env.USER_TOKEN,
  guildId: process.env.GUILD_ID,
  voiceChannelId: process.env.VOICE_CHANNEL_ID,
  textChannelId: process.env.TEXT_CHANNEL_ID,
  quality: "smooth", // ← change this to any preset name
});
```

---

## 📦 Dependencies

| Package | Purpose |
|---|---|
| `discord.js-selfbot-v13` | Discord self-bot client |
| `@dank074/discord-video-stream` | Video/audio streaming to Discord voice |
| `ffmpeg` (system) | Media encoding and processing |

---

## 🤝 Contributing

Pull requests are welcome! For major changes, please open an issue first.

1. Fork the repo
2. Create your branch: `git checkout -b feature/my-feature`
3. Commit your changes: `git commit -m 'add: my feature'`
4. Push: `git push origin feature/my-feature`
5. Open a Pull Request

---

## ⚠️ Legal Notice

This project is **not affiliated with Discord Inc.** Using self-bots may result in account termination. The author takes no responsibility for any actions taken against your account.

---

<div align="center">

Made with 🖤 by [sh1njs](https://github.com/sh1njs)

</div>
