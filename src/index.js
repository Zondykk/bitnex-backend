import 'dotenv/config';
import { createBot } from './bot.js';
import { createApi } from './api.js';

const BOT_TOKEN = process.env.BOT_TOKEN;
const PORT = process.env.PORT || 3000;
const WEBHOOK_DOMAIN = process.env.WEBHOOK_DOMAIN || 'bitnex-backend-production.up.railway.app';

if (!BOT_TOKEN) {
  console.error('❌ BOT_TOKEN is missing');
  process.exit(1);
}

const app = createApi();
const bot = createBot(BOT_TOKEN);

// Webhook endpoint
app.use(bot.webhookCallback('/telegram-webhook'));

app.listen(PORT, async () => {
  console.log(`🚀 API running on port ${PORT}`);

  try {
    const webhookUrl = `https://${WEBHOOK_DOMAIN}/telegram-webhook`;
    await bot.telegram.setWebhook(webhookUrl);
    console.log(`🤖 Bot webhook set: ${webhookUrl}`);
  } catch (err) {
    console.error('Failed to set webhook:', err.message || err);
  }
});

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
