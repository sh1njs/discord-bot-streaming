import { Client } from "discord.js-selfbot-v13";
import {
	Streamer,
	prepareStream,
	playStream,
	Utils,
	Encoders,
} from "@dank074/discord-video-stream";
import fs from "fs";
import readline from "readline";

/**
 * Stream quality presets for video streaming
 *
 * Each preset defines resolution, framerate, and bitrate settings
 *
 * @constant {Object}
 */
const STREAM_PRESETS = {
	"1080p60": { width: 1920, height: 1080, frameRate: 60, bitrateVideo: 4000 },
	"720p60": { width: 1280, height: 720, frameRate: 60, bitrateVideo: 2500 },
	"720p30": { width: 1280, height: 720, frameRate: 30, bitrateVideo: 1500 },
	"480p30": { width: 854, height: 480, frameRate: 30, bitrateVideo: 800 },
	"smooth": { width: 1280, height: 720, frameRate: 30, bitrateVideo: 2000 },
	"auto": { width: 1920, height: 1080, frameRate: 30, bitrateVideo: 2500 },
};

/**
 * Main bot class for tracking voice channel activity and streaming video content
 *
 * Monitors user join/leave times in a specific voice channel and streams video
 */
class VoiceTrackerBot {
	/**
	 * Creates a new VoiceTrackerBot instance
	 *
	 * @param {Object} config - Configuration object
	 * @param {string} config.token - Discord user token for authentication
	 * @param {string} config.guildId - ID of the Discord guild/server
	 * @param {string} config.voiceChannelId - ID of the voice channel to monitor
	 * @param {string} config.textChannelId - ID of the text channel for logging
	 * @param {string} [config.quality="smooth"] - Stream quality preset key from STREAM_PRESETS
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

		this.mode = "loading"; // loading | video

		this.rl = readline.createInterface({
			input: process.stdin,
			output: process.stdout,
		});

		this.registerConsoleCommands();
		this.registerEvents();
		this.registerProcessEvents();
	}

	/**
	 * Console command handler
	 */
	registerConsoleCommands() {
		this.rl.on("line", async (input) => {
			const cmd = input.trim().toLowerCase();

			if (cmd === "start") {
				console.log("[CONSOLE] Start video requested");
				this.mode = "video";
				await this.restartStream();
			}

			if (cmd === "stop") {
				console.log("[CONSOLE] Stop video -> back to loading");
				this.mode = "loading";
				await this.restartStream();
			}
		});
	}

	registerEvents() {
		this.client.on("ready", this.handleReady.bind(this));
		this.client.on("voiceStateUpdate", this.handleVoiceStateUpdate.bind(this));
	}

	registerProcessEvents() {
		const shutdown = async () => {
			if (this.isShuttingDown) return;
			this.isShuttingDown = true;

			console.log("Shutting down...");

			try {
				if (this.currentStreamCommand) {
					this.currentStreamCommand.kill("SIGKILL");
				}

				this.rl.close();

				if (this.streamer.client.voice) {
					this.streamer.leaveVoice();
				}

				await this.client.destroy();
			} catch (error) {
				console.error("Shutdown error:", error);
			} finally {
				process.exit(0);
			}
		};

		process.once("SIGINT", shutdown);
		process.once("SIGTERM", shutdown);
	}

	async handleReady() {
		console.log(`Logged in as ${this.client.user.tag}`);

		this.client.user.setPresence({
			activities: [{ name: "⊹ ࣪ ˖ loading system <3", type: "PLAYING" }],
			status: "online",
		});

		const videoExists = fs.existsSync("video.mp4");

		if (!videoExists) {
			console.log("[BOOT] video.mp4 not found, forcing loading mode");
			this.mode = "loading";
		}

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
	 * restart stream manually (console trigger)
	 */
	async restartStream() {
		if (this.currentStreamCommand) {
			this.currentStreamCommand.kill("SIGKILL");
		}
		await this.startStreamLoop();
	}

	/**
	 * core streaming loop controller
	 */
	async startStreamLoop() {
		while (!this.isShuttingDown) {
			const file =
				this.mode === "video" && fs.existsSync("video.mp4")
					? "video.mp4"
					: "assets/loading.mp4";

			const isLoading = file.includes("loading");

			console.log(`[STREAM] Playing: ${file}`);

			const streamOpts = STREAM_PRESETS[this.quality] || STREAM_PRESETS.smooth;

			const { command, output } = prepareStream(file, {
				...streamOpts,
				videoCodec: Utils.normalizeVideoCodec("H264"),
				encoder: Encoders.software({
					x264: { preset: "veryfast", tune: "zerolatency" },
				}),
				customInputOptions: isLoading
					? ["-stream_loop", "-1"]
					: [],
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

				console.log("[STREAM] finished");

				// kalau video selesai -> balik ke loading
				if (!isLoading) {
					this.mode = "loading";
				}
			} catch (err) {
				console.error("[STREAM ERROR]", err.message);
				await new Promise((r) => setTimeout(r, 3000));
			}
		}
	}

	handleVoiceStateUpdate(oldState, newState) {
		if (!this.isTargetGuild(oldState, newState)) return;

		const userId = newState.id || oldState.id;
		if (userId === this.client.user.id) return;

		const joined = newState.channelId === this.voiceChannelId;
		const left = oldState.channelId === this.voiceChannelId;

		if (joined) {
			this.userJoinTimes.set(userId, Date.now());
			console.log(`[TRACK] user joined`);
		}

		if (left) {
			const t = this.userJoinTimes.get(userId);
			if (!t) return;

			console.log(`[TRACK] user left after ${Date.now() - t}ms`);
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

	async start() {
		try {
			this.validateConfig();
			await this.client.login(this.token);
		} catch (err) {
			console.error("Failed to start bot:", err);
		}
	}
}

/**
 * Bot instance configuration using environment variables
 */
const bot = new VoiceTrackerBot({
	token: process.env.USER_TOKEN,
	guildId: process.env.GUILD_ID,
	voiceChannelId: process.env.VOICE_CHANNEL_ID,
	textChannelId: process.env.TEXT_CHANNEL_ID,
	quality: "smooth",
});

bot.start();