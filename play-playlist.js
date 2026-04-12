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

const STREAM_PRESETS = {
	"1080p60": { width: 1920, height: 1080, frameRate: 60, bitrateVideo: 4000 },
	"720p60":  { width: 1280, height: 720,  frameRate: 60, bitrateVideo: 2500 },
	"720p30":  { width: 1280, height: 720,  frameRate: 30, bitrateVideo: 1500 },
	"480p30":  { width: 854,  height: 480,  frameRate: 30, bitrateVideo: 800  },
	"smooth":  { width: 1280, height: 720,  frameRate: 30, bitrateVideo: 2000 },
	"auto":    { width: 1920, height: 1080, frameRate: 30, bitrateVideo: 2500 },
};

class VoiceTrackerBot {
	/**
	 * @param {Object} config
	 * @param {string} config.token
	 * @param {string} config.guildId
	 * @param {string} config.voiceChannelId
	 * @param {string} config.textChannelId
	 * @param {string} [config.quality="smooth"]
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

		/** @type {{ command: any, output: any, videoPath: string } | null} */
		this.nextStreamReady = null;

		this.videoFolder = path.join(process.cwd(), "file");

		this.registerEvents();
		this.registerProcessEvents();
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

				if (this.nextStreamReady) {
					this.nextStreamReady.command.kill("SIGKILL");
					this.nextStreamReady = null;
				}

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
			activities: [{ name: "⊹ ࣪ ˖ ashinaa <𝟑 .ᐟ", type: "PLAYING" }],
			status: "online",
		});

		try {
			const guild = this.getGuild();
			if (!guild) {
				console.error("Guild not found.");
				return;
			}

			const voiceChannel = this.getVoiceChannel(guild);
			if (!voiceChannel) {
				console.error("Voice channel not found or invalid.");
				return;
			}

			await this.streamer.joinVoice(this.guildId, this.voiceChannelId);
			console.log(`Joined voice channel: ${voiceChannel.name}`);

			await this.startLoopStream();
		} catch (error) {
			console.error("Error setting up voice or stream:", error);
		}
	}

	getVideoFiles() {
		const allowed = [".mp4", ".mkv", ".webm", ".mov"];

		if (!fs.existsSync(this.videoFolder)) return [];

		return fs
			.readdirSync(this.videoFolder)
			.filter((file) => allowed.includes(path.extname(file).toLowerCase()))
			.map((file) => path.join(this.videoFolder, file));
	}

	getRandomVideo(lastVideo = null) {
		const videos = this.getVideoFiles();
		if (!videos.length) return null;

		const pool = videos.length > 1 ? videos.filter((v) => v !== lastVideo) : videos;

		return pool[Math.floor(Math.random() * pool.length)];
	}

	prepareNextStream(videoPath) {
		console.log(`[PREBUFFER] Preparing next video: ${path.basename(videoPath)}`);

		const streamOpts = STREAM_PRESETS[this.quality] || STREAM_PRESETS["auto"];

		const { command, output } = prepareStream(videoPath, {
			...streamOpts,
			videoCodec: Utils.normalizeVideoCodec("H264"),
			encoder: Encoders.software({
				x264: { preset: "veryfast", tune: "zerolatency" },
			}),
			customInputOptions: ["-hwaccel", "auto"],
			customFfmpegFlags: ["-threads", "4"],
		});

		command.on("error", (err) => {
			console.error(`[PREBUFFER] FFmpeg error for ${path.basename(videoPath)}:`, err.message);
			this.nextStreamReady = null;
		});

		this.nextStreamReady = { command, output, videoPath };
	}

	getTextChannel() {
		return this.client.channels.cache.get(this.textChannelId);
	}

	canSendMessages(channel) {
		return channel && typeof channel.send === "function";
	}

	async sendMessage(message) {
		const textChannel = this.getTextChannel();
		if (this.canSendMessages(textChannel)) {
			await textChannel.send(message);
		}
	}

	async startLoopStream() {
		let lastVideo = null;

		while (!this.isShuttingDown) {
			let currentPath;
			let command;
			let output;

			if (this.nextStreamReady) {
				({ command, output, videoPath: currentPath } = this.nextStreamReady);
				this.nextStreamReady = null;
				console.log(`[STREAM] Using pre-buffered video: ${path.basename(currentPath)}`);
			} else {
				currentPath = this.getRandomVideo(lastVideo);

				if (!currentPath) {
					console.error("No videos found in /file folder. Retrying in 5s...");
					await new Promise((r) => setTimeout(r, 5000));
					continue;
				}

				console.log(`[STREAM] Preparing video: ${path.basename(currentPath)}`);

				const streamOpts = STREAM_PRESETS[this.quality] || STREAM_PRESETS["auto"];

				const prepared = prepareStream(currentPath, {
					...streamOpts,
					videoCodec: Utils.normalizeVideoCodec("H264"),
					encoder: Encoders.software({
						x264: { preset: "veryfast", tune: "zerolatency" },
					}),
					customInputOptions: ["-hwaccel", "auto"],
					customFfmpegFlags: ["-threads", "4"],
				});

				command = prepared.command;
				output = prepared.output;

				command.on("error", (err) => {
					console.error("FFmpeg stream error:", err.message);
				});
			}

			this.currentStreamCommand = command;

			const nextVideoPath = this.getRandomVideo(currentPath);
			if (nextVideoPath && !this.isShuttingDown) {
				setTimeout(() => {
					if (!this.isShuttingDown) {
						this.prepareNextStream(nextVideoPath);
					}
				}, 3000);
			}

			try {
				const videoName = path.basename(currentPath);
				console.log(`[STREAM] Now playing: ${videoName}`);
				await this.sendMessage(`🎬 Now playing: **${videoName}**`);

				await playStream(output, this.streamer, { type: "go-live" });

				lastVideo = currentPath;
				console.log(`[STREAM] Finished: ${path.basename(currentPath)}. Switching to next...`);

				if (nextVideoPath) {
					await this.sendMessage(`⏭️ Up next: **${path.basename(nextVideoPath)}**`);
				}
			} catch (error) {
				console.error("Stream error:", error.message);

				if (this.nextStreamReady) {
					this.nextStreamReady.command.kill("SIGKILL");
					this.nextStreamReady = null;
				}

				await new Promise((r) => setTimeout(r, 2000));
			}
		}
	}

	async handleVoiceStateUpdate(oldState, newState) {
		if (!this.isTargetGuild(oldState, newState)) return;

		const userId = newState.id || oldState.id;
		if (userId === this.client.user.id) return;

		const member = newState.member || oldState.member;
		const username = member?.displayName || member?.user?.username || "Unknown user";

		const joinedTargetChannel =
			newState.channelId === this.voiceChannelId &&
			oldState.channelId !== this.voiceChannelId;

		const leftTargetChannel =
			oldState.channelId === this.voiceChannelId &&
			newState.channelId !== this.voiceChannelId;

		if (joinedTargetChannel) {
			this.userJoinTimes.set(userId, Date.now());
			console.log(`[TRACKER] ${username} joined the voice channel.`);
		}

		if (leftTargetChannel) {
			const joinTime = this.userJoinTimes.get(userId);
			if (!joinTime) return;

			const timeSpent = Date.now() - joinTime;
			const minutes = Math.floor(timeSpent / 60000);
			const seconds = Math.floor((timeSpent % 60000) / 1000);

			console.log(`[TRACKER] ${username} left the voice channel after ${minutes}m ${seconds}s.`);

			this.userJoinTimes.delete(userId);
		}
	}

	getGuild() {
		return this.client.guilds.cache.get(this.guildId);
	}

	getVoiceChannel(guild) {
		const channel = guild.channels.cache.get(this.voiceChannelId);
		if (!channel) return null;

		const validTypes = ["GUILD_VOICE", "GUILD_STAGE_VOICE"];
		if (!validTypes.includes(channel.type)) return null;

		return channel;
	}

	isTargetGuild(oldState, newState) {
		return (
			oldState.guild?.id === this.guildId &&
			newState.guild?.id === this.guildId
		);
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
		} catch (error) {
			console.error("Failed to start bot:", error);
		}
	}
}

const bot = new VoiceTrackerBot({
	token: process.env.USER_TOKEN,
	guildId: process.env.GUILD_ID,
	voiceChannelId: process.env.VOICE_CHANNEL_ID,
	textChannelId: process.env.TEXT_CHANNEL_ID,
	quality: "smooth", // ganti sesuai kebutuhan: "1080p60", "720p60", "720p30", "480p30", "smooth", "auto"
});

bot.start();