import { Client } from "discord.js-selfbot-v13";
import {
	Streamer,
	prepareStream,
	playStream,
	Utils,
	Encoders,
} from "@dank074/discord-video-stream";

/**
 * STREAM SOURCE (TV)
 */
const TV_SOURCE =
"https://live.eu-north-1a.cf.dmcdn.net/sec2(THF9Lr4DiBQxqQzDxeNUeBQIxMAJlixy0mLGzxbZ43p8uu4aJ0jP8SfPQzMu9w-az0uPhAyCiyOQzXGc0WBzDbuZdjzqYHlAU5FvmlWvYJzP0EfST3OHZGtS7sA7kM5w)/dm/3/x8qckyq/d/live-720.m3u8";

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

		this.client = new Client({ checkUpdate:false });
		this.streamer = new Streamer(this.client);

		this.isShuttingDown = false;
		this.currentStreamCommand = null;

		this.registerEvents();
		this.registerProcessEvents();
	}

	registerEvents(){
		this.client.on("ready", this.handleReady.bind(this));
	}

	registerProcessEvents(){

		const shutdown = async () => {

			if(this.isShuttingDown) return;

			this.isShuttingDown = true;

			console.log("Shutting down...");

			try{

				if(this.currentStreamCommand)
				this.currentStreamCommand.kill("SIGKILL");

				if(this.streamer.client.voice)
				this.streamer.leaveVoice();

				await this.client.destroy();

			}catch(e){
				console.error(e);
			}finally{
				process.exit(0);
			}
		};

		process.once("SIGINT",shutdown);
		process.once("SIGTERM",shutdown);
	}

	async handleReady(){

		console.log(`Logged in as ${this.client.user.tag}`);

		this.client.user.setPresence({
			activities:[{name:"⊹ ࣪ ˖ ashinaa <𝟑 .ᐟ",type:"WATCHING"}],
			status:"online"
		});

		try{

			const guild = this.client.guilds.cache.get(this.guildId);
			const voiceChannel = guild.channels.cache.get(this.voiceChannelId);

			await this.streamer.joinVoice(this.guildId,this.voiceChannelId);

			console.log(`Joined voice channel: ${voiceChannel.name}`);

			await this.startTVStream();

		}catch(err){
			console.error("Setup error:",err);
		}
	}

	async startTVStream(){

		while(!this.isShuttingDown){

			try{

				const streamOpts = STREAM_PRESETS[this.quality] || STREAM_PRESETS["auto"];

				console.log(`[TV] Preparing stream`);

				const { command, output } = await prepareStream(TV_SOURCE,{

					...streamOpts,

					videoCodec:Utils.normalizeVideoCodec("H264"),

					encoder:Encoders.software({
						x264:{preset:"ultrafast",tune:"zerolatency"}
					}),

					customHeaders:{
						"User-Agent":"Mozilla/5.0",
						"Referer":"https://www.dailymotion.com"
					},

					customInputOptions:[
						"-reconnect","1",
						"-reconnect_streamed","1",
						"-reconnect_delay_max","5",
						"-fflags","+genpts"
					],

					customFfmpegFlags:[
						"-threads","4",
						"-minrate",`${streamOpts.bitrateVideo}k`,
						"-bufsize",`${streamOpts.bitrateVideo}k`
					]

				});

				this.currentStreamCommand = command;

				command.on("start",cmd=>console.log("[FFMPEG]",cmd));

				command.on("error",err=>{
					console.error("FFmpeg error:",err.message);
				});

				console.log("[GO LIVE] Starting TV stream...");

				await playStream(output,this.streamer,{type:"go-live"});

				console.log("[STREAM] Ended, restarting...");

			}
			catch(err){

				console.error("Stream error:",err.message);

				if(this.currentStreamCommand)
				this.currentStreamCommand.kill("SIGKILL");

				await new Promise(r=>setTimeout(r,5000));
			}
		}
	}

	async start(){

		try{
			await this.client.login(this.token);
		}
		catch(e){
			console.error("Login failed:",e);
		}
	}

}

const bot = new VoiceTrackerBot({
	token:process.env.USER_TOKEN,
	guildId:process.env.GUILD_ID,
	voiceChannelId:process.env.VOICE_CHANNEL_ID,
	textChannelId:process.env.TEXT_CHANNEL_ID,
	quality:"smooth"
});

bot.start();