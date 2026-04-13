import { Client } from "discord.js-selfbot-v13";
import {
	Streamer,
	prepareStream,
	playStream,
	Utils,
	Encoders,
} from "@dank074/discord-video-stream";
import fs from "fs";
import path from "path";
import readline from "readline";

/**
 * Stream quality presets.
 * Defines resolution, FPS, and video bitrate.
 */
const STREAM_PRESETS = {
	"1080p60": { width: 1920, height: 1080, frameRate: 60, bitrateVideo: 4000 },
	"720p60": { width: 1280, height: 720, frameRate: 60, bitrateVideo: 2500 },
	"720p30": { width: 1280, height: 720, frameRate: 30, bitrateVideo: 1500 },
	"480p30": { width: 854, height: 480, frameRate: 30, bitrateVideo: 800 },
	"smooth": { width: 1280, height: 720, frameRate: 30, bitrateVideo: 2000 },
	"auto": { width: 1920, height: 1080, frameRate: 30, bitrateVideo: 2500 },
};

const AUDIO_OPTS = {
	bitrateAudio: 320,				// bitrate audio tinggi (kbps)
	audioFilters: "volume=3.0", // naikkan volume 3x (bisa diubah 1.5–5.0)
};

const MOVIE_DIR = "movie";
const LOADING_VID = "assets/loading.mp4";

/**
 * Discord voice streaming bot with console controller.
 */
class VoiceTrackerBot {
	/**
	 * @param {Object} options
	 * @param {string} options.token
	 * @param {string} options.guildId
	 * @param {string} options.voiceChannelId
	 * @param {string} options.textChannelId
	 * @param {string} [options.quality]
	 */
	constructor({ token, guildId, voiceChannelId, textChannelId, quality = "smooth" }) {
		this.token = token;
		this.guildId = guildId;
		this.voiceChannelId = voiceChannelId;
		this.textChannelId = textChannelId;
		this.quality = quality;

		this.client = new Client();
		this.streamer = new Streamer(this.client);

		this.userJoinTimes = new Map();
		this.isShuttingDown = false;
		this.currentStreamCommand = null;

		this.queuedVideo = null;
		this.resolveVideoFinished = null;

		this.rl = readline.createInterface({ input: process.stdin, output: process.stdout });

		this.registerConsoleCommands();
		this.registerEvents();
		this.registerProcessEvents();
	}

	/**
	 * Get list of available movies.
	 * @returns {string[]}
	 */
	getMovieList() {
		if (!fs.existsSync(MOVIE_DIR)) return [];
		return fs.readdirSync(MOVIE_DIR).filter((f) => f.toLowerCase().endsWith(".mp4")).sort();
	}

	/**
	 * Ask question in console.
	 * @param {string} q
	 * @returns {Promise<string>}
	 */
	askQuestion(q) {
		return new Promise((res) => this.rl.question(q, res));
	}

	/**
	 * Register console input commands.
	 */
	registerConsoleCommands() {
		this.rl.on("line", async (input) => {
			const cmd = input.trim().toLowerCase();

			if (cmd === "start") {
				await this.handleStartCommand();
			}

			if (cmd === "stop") {
				console.log("[CONSOLE] Stop → back to loading");
				this.queuedVideo = null;
				await this.killCurrentStream();
			}
		});
	}

	/**
	 * Handle start command from console.
	 */
	async handleStartCommand() {
		const movies = this.getMovieList();

		if (movies.length === 0) {
			console.log("[START] Folder movie/ kosong atau tidak ditemukan.");
			return;
		}

		console.log("\n[START] Film tersedia:");
		movies.forEach((m, i) => console.log(`	${i + 1}. ${m}`));

		const answer = await this.askQuestion("Pilih nomor film: ");
		const idx = parseInt(answer.trim(), 10) - 1;

		if (isNaN(idx) || idx < 0 || idx >= movies.length) {
			console.log("[START] Nomor tidak valid.");
			return;
		}

		const chosen = path.join(MOVIE_DIR, movies[idx]);
		console.log(`[START] Queued: ${chosen}`);

		this.queuedVideo = chosen;
		await this.killCurrentStream();
	}

	/**
	 * Register Discord events.
	 */
	registerEvents() {
		this.client.on("ready", this.handleReady.bind(this));
		this.client.on("voiceStateUpdate", this.handleVoiceStateUpdate.bind(this));
	}

	/**
	 * Register process signals.
	 */
	registerProcessEvents() {
		const shutdown = async () => {
			if (this.isShuttingDown) return;
			this.isShuttingDown = true;

			console.log("Shutting down...");

			try {
				this.killCurrentStream();
				this.rl.close();
				if (this.streamer.client.voice) this.streamer.leaveVoice();
				await this.client.destroy();
			} catch (e) {
				console.error("Shutdown error:", e);
			} finally {
				process.exit(0);
			}
		};

		process.once("SIGINT", shutdown);
		process.once("SIGTERM", shutdown);
	}

	/**
	 * Called when bot is ready.
	 */
	async handleReady() {
		console.log(`Logged in as ${this.client.user.tag}`);

		this.client.user.setPresence({
			activities: [{ name: "⊹ ࣪ ˖ ashinaa 𓂃𓈒𓏸", type: "PLAYING" }],
			status: "online",
		});

		try {
			const guild = this.getGuild();
			if (!guild) return console.error("Guild not found.");

			const voiceChannel = this.getVoiceChannel(guild);
			if (!voiceChannel) return console.error("Voice channel not found.");

			await this.streamer.joinVoice(this.guildId, this.voiceChannelId);
			console.log(`Joined voice channel: ${voiceChannel.name}`);

			await this.startStreamLoop();
		} catch (err) {
			console.error("Error on ready:", err);
		}
	}

	/**
	 * Kill current ffmpeg stream process.
	 */
	killCurrentStream() {
		if (this.currentStreamCommand) {
			try {
				this.currentStreamCommand.kill("SIGKILL");
			} catch (_) {}
			this.currentStreamCommand = null;
		}
	}

	/**
	 * Play a video once.
	 * @param {string} filePath
	 */
	async playOnce(filePath) {
		const streamOpts = STREAM_PRESETS[this.quality] || STREAM_PRESETS.smooth;

		const { command, output } = prepareStream(filePath, {
			...streamOpts,
			videoCodec: Utils.normalizeVideoCodec("H264"),
			encoder: Encoders.software({
				x264: { preset: "veryfast", tune: "zerolatency" },
			}),
			bitrateAudio: AUDIO_OPTS.bitrateAudio,	 // ← tambah ini
			audioFilters: AUDIO_OPTS.audioFilters,	 // ← tambah ini
			customFfmpegFlags: [
				"-threads",
				"4",
				"-minrate",
				`${streamOpts.bitrateVideo}k`,
				"-bufsize",
				`${streamOpts.bitrateVideo}k`,
			],
		});

		this.currentStreamCommand = command;

		try {
			await playStream(output, this.streamer, { type: "go-live" });
		} catch (err) {
			console.error(`[STREAM ERROR] ${err.message}`);
		} finally {
			this.currentStreamCommand = null;
		}
	}

	/**
	 * Play loading loop video.
	 */
	async playLoadingLoop() {
		const streamOpts = STREAM_PRESETS[this.quality] || STREAM_PRESETS.smooth;

		const { command, output } = prepareStream(LOADING_VID, {
			...streamOpts,
			videoCodec: Utils.normalizeVideoCodec("H264"),
			encoder: Encoders.software({
				x264: { preset: "veryfast", tune: "zerolatency" },
			}),
			customInputOptions: ["-stream_loop", "-1"],
			customFfmpegFlags: [
				"-threads",
				"4",
				"-minrate",
				`${streamOpts.bitrateVideo}k`,
				"-bufsize",
				`${streamOpts.bitrateVideo}k`,
			],
		});

		this.currentStreamCommand = command;

		try {
			await playStream(output, this.streamer, { type: "go-live" });
		} catch (err) {
			if (!this.isShuttingDown) {
				console.log("[LOADING] Stream interrupted (switching video)");
			}
		} finally {
			this.currentStreamCommand = null;
		}
	}

	/**
	 * Main streaming loop.
	 */
	async startStreamLoop() {
		while (!this.isShuttingDown) {
			if (this.queuedVideo) {
				const videoToPlay = this.queuedVideo;
				this.queuedVideo = null;

				console.log(`[STREAM] Playing movie: ${videoToPlay}`);
				await this.playOnce(videoToPlay);
				console.log("[STREAM] Movie selesai → kembali ke loading loop");
			} else {
				console.log("[STREAM] Loading loop ...");
				await this.playLoadingLoop();
			}

			if (!this.isShuttingDown) {
				await new Promise((r) => setTimeout(r, 500));
			}
		}
	}

	/**
	 * Handle voice state updates.
	 */
	handleVoiceStateUpdate(oldState, newState) {
		if (!this.isTargetGuild(oldState, newState)) return;

		const userId = newState.id || oldState.id;
		if (userId === this.client.user.id) return;

		const member = newState.member || oldState.member;
		const username =
			member?.displayName || member?.user?.username || "Unknown user";

		if (newState.channelId === this.voiceChannelId) {
			this.userJoinTimes.set(userId, Date.now());
			console.log(`[TRACK] ${username} joined`);
		}

		if (oldState.channelId === this.voiceChannelId) {
			const t = this.userJoinTimes.get(userId);
			if (!t) return;
			console.log(`[TRACK] ${username} left after ${Date.now() - t}ms`);
			this.userJoinTimes.delete(userId);
		}
	}

	getGuild() {
		return this.client.guilds.cache.get(this.guildId);
	}

	getVoiceChannel(guild) {
		return guild.channels.cache.get(this.voiceChannelId);
	}

	isTargetGuild(oldState, newState) {
		return oldState.guild?.id === this.guildId && newState.guild?.id === this.guildId;
	}

	validateConfig() {
		if (!this.token) throw new Error("Missing token.");
		if (!this.guildId) throw new Error("Missing guild ID.");
		if (!this.voiceChannelId) throw new Error("Missing voice channel ID.");
	}

	/**
	 * Start bot.
	 */
	async start() {
		try {
			this.validateConfig();
			await this.client.login(this.token);
		} catch (err) {
			console.error("Failed to start bot:", err);
		}
	}
}

const bot = new VoiceTrackerBot({
	token: process.env.USER_TOKEN,
	guildId: process.env.GUILD_ID,
	voiceChannelId: process.env.VOICE_CHANNEL_ID,
	textChannelId: process.env.TEXT_CHANNEL_ID,
	quality: "smooth",
});

bot.start();