import { Telegraf, Markup } from 'telegraf';
import { upsertUser } from './users.js';

export function createBot(token) {
  const bot = new Telegraf(token);

  // /start с возможным реферальным кодом
  bot.start(async (ctx) => {
    try {
      const startParam = ctx.startPayload || null; // то, что идёт после /start
      const user = await upsertUser(ctx.from, startParam);

      const name = user.first_name || user.username || 'друг';

      let text = `Привет, ${name}! 👋\n\n`;
      text += `Добро пожаловать в <b>BitneX Mining</b>.\n`;
      text += `Майнь BTX, повышай уровень холдом и зарабатывай с друзей.\n\n`;

      if (user.referrer_id && startParam) {
        text += `✅ Ты пришёл по реферальной ссылке\n\n`;
      }

      text += `Нажми кнопку ниже, чтобы открыть приложение:`;

      const miniAppUrl = process.env.MINI_APP_URL;

      const buttons = [];

      if (miniAppUrl) {
        buttons.push([Markup.button.webApp('⛏️ Открыть BitneX Mining', miniAppUrl)]);
      }

      buttons.push([Markup.button.url('📢 Канал', 'https://t.me/BitneXMining')]); // замени на свой канал если есть

      await ctx.replyWithHTML(text, Markup.inlineKeyboard(buttons));
    } catch (err) {
      console.error('start error:', err);
      await ctx.reply('Произошла ошибка. Попробуй ещё раз чуть позже.');
    }
  });

  // Простая команда /app
  bot.command('app', async (ctx) => {
    const miniAppUrl = process.env.MINI_APP_URL;
    if (!miniAppUrl) {
      return ctx.reply('Mini App ещё не подключен.');
    }
    await ctx.reply('Открывай приложение:', Markup.inlineKeyboard([
      Markup.button.webApp('⛏️ BitneX Mining', miniAppUrl)
    ]));
  });

  bot.catch((err) => {
    console.error('Bot error:', err);
  });

  return bot;
}
