import { Client } from "discord.js-selfbot-v13";
import {
 Streamer,
 prepareStream,
 playStream,
 Utils,
 Encoders,
} from "@dank074/discord-video-stream";

/**
 * Stream quality presets for video streaming
 * Each preset defines resolution, framerate, and bitrate settings
 * @constant {Object}
 */
const STREAM_PRESETS = {
 "1080p60": { width: 1920, height: 1080, frameRate: 60, bitrateVideo: 4000 },
 "720p60":	{ width: 1280, height: 720,	frameRate: 60, bitrateVideo: 2500 },
 "720p30":	{ width: 1280, height: 720,	frameRate: 30, bitrateVideo: 1500 },
 "480p30":	{ width: 854,	height: 480,	frameRate: 30, bitrateVideo: 800	},
 "smooth":	{ width: 1280, height: 720,	frameRate: 30, bitrateVideo: 2000 },
 "auto":		{ width: 1920, height: 1080, frameRate: 30, bitrateVideo: 2500 },
};

/**
 * Main bot class for tracking voice channel activity and streaming video content
 * Monitors user join/leave times in a specific voice channel and streams video
 */
class VoiceTrackerBot {
 /**
	* Creates a new VoiceTrackerBot instance
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

	this.registerEvents();
	this.registerProcessEvents();
 }

 /**
	* Registers Discord client event handlers
	* Sets up ready and voiceStateUpdate event listeners
	*/
 registerEvents() {
	this.client.on("ready", this.handleReady.bind(this));
	this.client.on(
	 "voiceStateUpdate",
	 this.handleVoiceStateUpdate.bind(this),
	);
 }

 /**
	* Registers process-level event handlers for graceful shutdown
	* Handles SIGINT and SIGTERM signals to clean up resources
	*/
 registerProcessEvents() {
	const shutdown = async () => {
	 if (this.isShuttingDown) return;

	 this.isShuttingDown = true;
	 console.log("Shutting down...");

	 try {
		if (this.currentStreamCommand) {
		 this.currentStreamCommand.kill("SIGKILL");
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

 /**
	* Handles the Discord client 'ready' event
	* Sets up bot presence, joins voice channel, and starts video streaming
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

	 const videoPath = "video.mp4";

	 // mulai loop stream
	 await this.startLoopStream(videoPath);
	} catch (error) {
	 console.error("Error setting up voice or stream:", error);
	}
 }

 /**
	* Starts an infinite loop that streams video to the voice channel.
	* Resolusi dan framerate mengikuti preset quality yang dipilih untuk stabilitas,
	* menggunakan customInputOptions untuk native FFmpeg loop (-stream_loop -1)
	* dan hardware acceleration, serta customFfmpegFlags untuk thread dan bitrate tuning.
	* @param {string} videoPath - Path to the video file to stream
	*/
 async startLoopStream(videoPath) {
	while (!this.isShuttingDown) {
	 console.log(`Preparing stream for video: ${videoPath}`);

	 const streamOpts = STREAM_PRESETS[this.quality] || STREAM_PRESETS["smooth"];

	 console.log(`[QUALITY] Using preset "${this.quality}": ${streamOpts.width}x${streamOpts.height} @ ${streamOpts.frameRate}fps, ${streamOpts.bitrateVideo}kbps`);

	 const { command, output } = prepareStream(videoPath, {
		...streamOpts,

		videoCodec: Utils.normalizeVideoCodec("H264"),
		encoder: Encoders.software({
		 x264: { preset: "veryfast", tune: "zerolatency" },
		}),

		customInputOptions: [
		 "-stream_loop", "-1",
		 "-hwaccel", "auto",
		],

		customFfmpegFlags: [
		 "-threads", "4",
		 "-minrate", `${streamOpts.bitrateVideo}k`,
		 "-bufsize", `${streamOpts.bitrateVideo}k`,
		],
	 });

	 this.currentStreamCommand = command;

	 command.on("error", (err) => {
		console.error("FFmpeg error:", err.message);
	 });

	 try {
		console.log("Starting screen share (Go Live)...");
		await playStream(output, this.streamer, { type: "go-live" });
		console.log("Stream ended, restarting video...");
	 } catch (error) {
		console.error("Error playing stream:", error.message);

		if (this.currentStreamCommand) {
		 this.currentStreamCommand.kill("SIGKILL");
		}

		await new Promise((resolve) => setTimeout(resolve, 5000));
	 }
	}
 }

 /**
	* Handles voice state update events to track user join/leave times
	* Records when users join and leave the target voice channel
	* @param {Object} oldState - Previous voice state before update
	* @param {Object} newState - New voice state after update
	*/
 async handleVoiceStateUpdate(oldState, newState) {
	if (!this.isTargetGuild(oldState, newState)) return;

	const userId = newState.id || oldState.id;
	if (userId === this.client.user.id) return;

	const member = newState.member || oldState.member;
	const username =
	 member?.displayName || member?.user?.username || "Unknown user";

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

	 console.log(
		`[TRACKER] ${username} left the voice channel after ${minutes}m ${seconds}s.`,
	 );

	 this.userJoinTimes.delete(userId);
	}
 }

 /**
	* Retrieves the guild object from the client's cache
	* @returns {Object|null} The guild object or null if not found
	*/
 getGuild() {
	return this.client.guilds.cache.get(this.guildId);
 }

 /**
	* Retrieves and validates the voice channel from the guild
	* @param {Object} guild - Discord guild object
	* @returns {Object|null} The voice channel object or null if invalid/not found
	*/
 getVoiceChannel(guild) {
	const channel = guild.channels.cache.get(this.voiceChannelId);
	if (!channel) return null;

	const validTypes = ["GUILD_VOICE", "GUILD_STAGE_VOICE"];
	if (!validTypes.includes(channel.type)) return null;

	return channel;
 }

 /**
	* Checks if the voice state update is for the target guild
	* @param {Object} oldState - Previous voice state
	* @param {Object} newState - New voice state
	* @returns {boolean} True if both states belong to the target guild
	*/
 isTargetGuild(oldState, newState) {
	return (
	 oldState.guild?.id === this.guildId &&
	 newState.guild?.id === this.guildId
	);
 }

 /**
	* Validates that all required configuration values are present
	* @throws {Error} Throws error if any required config is missing
	*/
 validateConfig() {
	if (!this.token) throw new Error("Missing token.");
	if (!this.guildId) throw new Error("Missing guild ID.");
	if (!this.voiceChannelId)
	 throw new Error("Missing voice channel ID.");
 }

 /**
	* Starts the bot by validating config and logging into Discord
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

/**
 * Bot instance configuration using environment variables
 * @constant {VoiceTrackerBot}
 */
const bot = new VoiceTrackerBot({
	token: process.env.USER_TOKEN,
	guildId: process.env.GUILD_ID,
	voiceChannelId: process.env.VOICE_CHANNEL_ID,
	textChannelId: process.env.TEXT_CHANNEL_ID,
	quality: "smooth", // ganti ke: "480p30" | "720p30" | "720p60" | "1080p60" | "auto"
});

/**
 * Initializes and starts the bot
 */
bot.start();