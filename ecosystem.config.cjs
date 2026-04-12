module.exports = {
	apps: [
		{
			script: "play.js",
			name: "ashinaa",
			node_args: "--watch --env-file .env",
			watch: false,
			instances: 1,
			exec_mode: "fork",
		},
	],
};
