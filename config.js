module.exports = {
  "port": process.env.PORT || 4000,
  "agi_port": "5038",
  "agi_host": process.env.AGI_HOST,
  "agi_login": process.env.AGI_LOGIN,
  "agi_pass": process.env.AGI_PASS,
  "statpass": process.env.STAT_PASS,

  "telegram_token": process.env.BOT_TOKEN, // Telegram bot token

  "ids": process.env.IDS.split(","), // Array of authorized users ID Telegram, for example: '1234567,987654321'
  "admin_id": process.env.ADMIN_ID // Admin users ID Telegram, who get notitfications about all requests (just for additional security)

};
