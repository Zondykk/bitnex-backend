import 'dotenv/config';
import { createBot } from './bot.js';
import { createApi } from './api.js';

const BOT_TOKEN = process.env.BOT_TOKEN;
const PORT = process.env.PORT || 3000;

if (!BOT_TOKEN) {
  console.error('❌ BOT_TOKEN is missing');
  process.exit(1);
}

// Запускаем API
const app = createApi();
app.listen(PORT, () => {
  console.log(`🚀 API running on port ${PORT}`);
});

// Запускаем бота
const bot = createBot(BOT_TOKEN);

bot.launch()
  .then(() => console.log('🤖 Bot started'))
  .catch((err) => {
    console.error('Bot launch error:', err);
    process.exit(1);
  });

// Корректная остановка
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
