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
 * Stream quality configuration presets
 * @typedef {Object} StreamPreset
 * @property {number} width - Video width in pixels
 * @property {number} height - Video height in pixels
 * @property {number} frameRate - Frames per second
 * @property {number} bitrateVideo - Video bitrate in kbps
 */

/**
 * Available stream quality presets
 * @type {Object.<string, StreamPreset>}
 */
const STREAM_PRESETS = {
	"1080p60": { width: 1920, height: 1080, frameRate: 60, bitrateVideo: 4000 },
	"720p60": { width: 1280, height: 720, frameRate: 60, bitrateVideo: 2500 },
	"720p30": { width: 1280, height: 720, frameRate: 30, bitrateVideo: 1500 },
	"480p30": { width: 854,	height: 480, frameRate: 30, bitrateVideo: 800 },
	"smooth": { width: 1280, height: 720, frameRate: 30, bitrateVideo: 2000 },
	"auto": { width: 1920, height: 1080, frameRate: 30, bitrateVideo: 2500 },
};

/**
 * Bot that tracks voice channel activity and streams videos to Discord voice channels
 */
class VoiceTrackerBot {
	/**
	 * Creates a new VoiceTrackerBot instance
	 * @param {Object} config - Bot configuration
	 * @param {string} config.token - Discord user token
	 * @param {string} config.guildId - Discord server ID
	 * @param {string} config.voiceChannelId - Voice channel ID to monitor and stream to
	 * @param {string} config.textChannelId - Text channel ID for notifications
	 * @param {string} [config.quality="smooth"] - Stream quality preset
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
		this.currentCommand = null;

		this.videoFolder = path.join(process.cwd(), "file");

		this.registerEvents();
		this.registerProcessEvents();
	}

	/**
	 * Registers Discord client event handlers
	 */
	registerEvents() {
		this.client.on("ready", this.handleReady.bind(this));
		this.client.on("voiceStateUpdate", this.handleVoiceStateUpdate.bind(this));
	}

	/**
	 * Registers process signal handlers for graceful shutdown
	 */
	registerProcessEvents() {
		const shutdown = async () => {
			if (this.isShuttingDown) return;
			this.isShuttingDown = true;
			console.log("Shutting down...");
			try {
				if (this.currentCommand) this.currentCommand.kill("SIGKILL");
				if (this.streamer.client.voice) this.streamer.leaveVoice();
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

	/**
	 * Handles Discord client ready event
	 * @returns {Promise<void>}
	 */
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

	/**
	 * Retrieves all supported video files from the video folder
	 * @returns {string[]} Array of video file paths
	 */
	getVideoFiles() {
		const allowed = [".mp4", ".mkv", ".webm", ".mov"];
		if (!fs.existsSync(this.videoFolder)) return [];
		return fs
			.readdirSync(this.videoFolder)
			.filter((file) => allowed.includes(path.extname(file).toLowerCase()))
			.map((file) => path.join(this.videoFolder, file));
	}

	/**
	 * Returns a random video file, optionally avoiding the last played video
	 * @param {string|null} lastVideo - Path of the last played video to avoid
	 * @returns {string|null} Random video file path or null if no videos available
	 */
	getRandomVideo(lastVideo = null) {
		const videos = this.getVideoFiles();
		if (!videos.length) return null;
		const pool = videos.length > 1 ? videos.filter((v) => v !== lastVideo) : videos;
		return pool[Math.floor(Math.random() * pool.length)];
	}

	/**
	 * Starts the continuous video streaming loop
	 * @returns {Promise<void>}
	 */
	async startLoopStream() {
		const streamOpts = STREAM_PRESETS[this.quality] || STREAM_PRESETS["auto"];

		const encoder = Encoders.software({
			x264: { preset: "superfast" },
		});

		let lastVideo = null;

		while (!this.isShuttingDown) {
			const videoPath = this.getRandomVideo(lastVideo);

			if (!videoPath) {
				console.error("No videos found in /file folder. Retrying in 5s...");
				await new Promise((r) => setTimeout(r, 5000));
				continue;
			}

			console.log(`Preparing stream: ${path.basename(videoPath)}`);

			const { command, output } = prepareStream(videoPath, {
				...streamOpts,
				encoder,
				videoCodec: Utils.normalizeVideoCodec("H264"),
			});

			this.currentCommand = command;

			command.on("error", (err) => {
				console.error("FFmpeg stream error:", err.message);
			});

			try {
				await this.sendMessage(`🎬 **Now Playing**\n${path.basename(videoPath)}`);
				console.log("Starting screen share (Go Live)...");

				await playStream(output, this.streamer, {
					type: "go-live",
					readAtNativeFps: true,
					bitrateKbps: streamOpts.bitrateVideo,
				});

				lastVideo = videoPath;
				console.log(`Finished: ${path.basename(videoPath)}. Selecting next...`);
			} catch (error) {
				console.error("Stream error:", error.message);
				await new Promise((r) => setTimeout(r, 2000));
			}
		}
	}

	/**
	 * Handles voice state updates and tracks user join/leave times
	 * @param {Object} oldState - Previous voice state
	 * @param {Object} newState - New voice state
	 * @returns {Promise<void>}
	 */
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
			const diff = Date.now() - joinTime;
			const minutes = Math.floor(diff / 60000);
			const seconds = Math.floor((diff % 60000) / 1000);
			console.log(`[TRACKER] ${username} left after ${minutes}m ${seconds}s.`);
			this.userJoinTimes.delete(userId);
		}
	}

	/**
	 * Retrieves the target guild
	 * @returns {?Object} Guild object or null if not found
	 */
	getGuild() {
		return this.client.guilds.cache.get(this.guildId);
	}

	/**
	 * Retrieves the voice channel from the specified guild
	 * @param {Object} guild - Discord guild object
	 * @returns {?Object} Voice channel object or null if invalid
	 */
	getVoiceChannel(guild) {
		const channel = guild.channels.cache.get(this.voiceChannelId);
		if (!channel) return null;
		const validTypes = ["GUILD_VOICE", "GUILD_STAGE_VOICE"];
		if (!validTypes.includes(channel.type)) return null;
		return channel;
	}

	/**
	 * Retrieves the target text channel
	 * @returns {?Object} Text channel object or null if not found
	 */
	getTextChannel() {
		return this.client.channels.cache.get(this.textChannelId);
	}

	/**
	 * Checks if a channel can send messages
	 * @param {Object} channel - Discord channel object
	 * @returns {boolean} True if channel can send messages
	 */
	canSendMessages(channel) {
		return channel && typeof channel.send === "function";
	}

	/**
	 * Sends a message to the configured text channel
	 * @param {string} message - Message content to send
	 * @returns {Promise<void>}
	 */
	async sendMessage(message) {
		const channel = this.getTextChannel();
		if (this.canSendMessages(channel)) {
			await channel.send(message).catch(() => {});
		}
	}

	/**
	 * Checks if the voice state update belongs to the target guild
	 * @param {Object} oldState - Previous voice state
	 * @param {Object} newState - New voice state
	 * @returns {boolean} True if both states belong to target guild
	 */
	isTargetGuild(oldState, newState) {
		return (
			oldState.guild?.id === this.guildId &&
			newState.guild?.id === this.guildId
		);
	}

	/**
	 * Validates required configuration parameters
	 * @throws {Error} Throws error if any required config is missing
	 */
	validateConfig() {
		if (!this.token) throw new Error("Missing token.");
		if (!this.guildId) throw new Error("Missing guild ID.");
		if (!this.voiceChannelId) throw new Error("Missing voice channel ID.");
	}

	/**
	 * Starts the bot by logging into Discord
	 * @returns {Promise<void>}
	 */
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
	quality: "smooth",
});

bot.start();