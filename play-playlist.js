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

/**
 * Stream presets
 */
const STREAM_PRESETS = {
	"1080p60": { width: 1920, height: 1080, frameRate: 60, bitrateVideo: 4000 },
	"720p60": { width: 1280, height: 720, frameRate: 60, bitrateVideo: 2500 },
	"720p30": { width: 1280, height: 720, frameRate: 30, bitrateVideo: 1500 },
	"480p30": { width: 854, height: 480, frameRate: 30, bitrateVideo: 800 },
	"smooth": { width: 1280, height: 720, frameRate: 30, bitrateVideo: 2000 },
	"auto": { width: 1920, height: 1080, frameRate: 30, bitrateVideo: 2500 },
};

class VoiceTrackerBot {
	constructor({ token, guildId, voiceChannelId, textChannelId, quality = "smooth" }) {
		this.token = token;
		this.guildId = guildId;
		this.voiceChannelId = voiceChannelId;
		this.textChannelId = textChannelId;

		this.quality = quality;

		this.client = new Client({ checkUpdate: false });
		this.streamer = new Streamer(this.client);

		this.userJoinTimes = new Map();
		this.isShuttingDown = false;
		this.currentStreamCommand = null;

		this.isRestarting = false;

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
			const voiceChannel = this.getVoiceChannel(guild);

			await this.streamer.joinVoice(this.guildId, this.voiceChannelId);

			console.log(`Joined voice channel: ${voiceChannel.name}`);

			await this.startLoopStream();
		} catch (error) {
			console.error("Setup error:", error);
		}
	}

	getVideoFiles() {
		const allowed = [".mp4", ".mkv", ".webm", ".mov"];

		if (!fs.existsSync(this.videoFolder)) return [];

		return fs
			.readdirSync(this.videoFolder)
			.filter((file) =>
				allowed.includes(path.extname(file).toLowerCase()),
			)
			.map((file) => path.join(this.videoFolder, file));
	}

	getRandomVideo(lastVideo = null) {
		const videos = this.getVideoFiles();
		if (!videos.length) return null;

		const pool =
			videos.length > 1
				? videos.filter((v) => v !== lastVideo)
				: videos;

		return pool[Math.floor(Math.random() * pool.length)];
	}

	/**
	 * PREPARE NEXT VIDEO
	 */
	prepareNextStream(videoPath) {
		console.log(`[PREBUFFER] Preparing next video: ${path.basename(videoPath)}`);

		const streamOpts = STREAM_PRESETS[this.quality] || STREAM_PRESETS["auto"];

		const { command, output } = prepareStream(videoPath, {
			...streamOpts,
			videoCodec: Utils.normalizeVideoCodec("H264"),
			encoder: Encoders.software({
				x264: { preset: "ultrafast", tune: "zerolatency" },
			}),
			customInputOptions: ["-hwaccel", "auto"],
			customFfmpegFlags: [
				"-threads", "4",
				"-minrate", `${streamOpts.bitrateVideo}k`,
				"-bufsize", `${streamOpts.bitrateVideo}k`
			]
		});

		command.on("error", (err) => {
			console.error(`[PREBUFFER] FFmpeg error:`, err.message);
			this.nextStreamReady = null;
		});

		this.nextStreamReady = { command, output, videoPath };
	}

	async startLoopStream() {
		let lastVideo = null;

		while (!this.isShuttingDown) {

			if (this.isRestarting) {
				this.isRestarting = false;
				lastVideo = null;
			}

			let currentPath;
			let command;
			let output;

			if (this.nextStreamReady) {
				({ command, output, videoPath: currentPath } = this.nextStreamReady);
				this.nextStreamReady = null;
			} else {

				currentPath = this.getRandomVideo(lastVideo);

				if (!currentPath) {
					await new Promise((r) => setTimeout(r, 5000));
					continue;
				}

				const streamOpts = STREAM_PRESETS[this.quality] || STREAM_PRESETS["auto"];

				const prepared = prepareStream(currentPath, {
					...streamOpts,
					videoCodec: Utils.normalizeVideoCodec("H264"),
					encoder: Encoders.software({
						x264: { preset: "ultrafast", tune: "zerolatency" },
					}),
					customInputOptions: ["-hwaccel", "auto"],
					customFfmpegFlags: [
						"-threads", "4",
						"-minrate", `${streamOpts.bitrateVideo}k`,
						"-bufsize", `${streamOpts.bitrateVideo}k`
					]
				});

				command = prepared.command;
				output = prepared.output;
			}

			this.currentStreamCommand = command;

			const nextVideoPath = this.getRandomVideo(currentPath);

			if (nextVideoPath) {
				setTimeout(() => {
					if (!this.isShuttingDown) {
						this.prepareNextStream(nextVideoPath);
					}
				}, 3000);
			}

			try {
				console.log(`[STREAM] Playing: ${path.basename(currentPath)}`);

				await playStream(output, this.streamer, { type: "go-live" });

				lastVideo = currentPath;

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
		if (oldState.guild?.id !== this.guildId) return;
	}

	getGuild() {
		return this.client.guilds.cache.get(this.guildId);
	}

	getVoiceChannel(guild) {
		const channel = guild.channels.cache.get(this.voiceChannelId);
		if (!channel) return null;
		return channel;
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
	quality: "smooth" // preset: "1080p60", "720p60", "720p30", "480p30", "smooth", "auto"
});

bot.start();