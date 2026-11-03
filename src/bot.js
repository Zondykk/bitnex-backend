import { Telegraf, Markup } from 'telegraf';
import { upsertUser } from './users.js';

export function createBot(token) {
  const bot = new Telegraf(token);

  bot.start(async (ctx) => {
    const startParam = ctx.startPayload || null;
    const name = ctx.from.first_name || ctx.from.username || 'друг';
    const miniAppUrl = process.env.MINI_APP_URL;

    // Быстрый ответ сразу, регистрацию делаем параллельно
    const buttons = [];
    if (miniAppUrl) {
      buttons.push([Markup.button.webApp('⛏️ Открыть BitneX Mining', miniAppUrl)]);
    }
    buttons.push([Markup.button.url('📢 Канал', 'https://t.me/BitneXMining')]);

    let text = `Привет, ${name}! 👋\n\n`;
    text += `Добро пожаловать в <b>BitneX Mining</b>.\n`;
    text += `Майнь BTX, повышай уровень холдом и зарабатывай с друзей.\n\n`;
    text += `Нажми кнопку ниже, чтобы открыть приложение:`;

    // Отвечаем сразу — не ждём БД
    const replyPromise = ctx.replyWithHTML(text, Markup.inlineKeyboard(buttons));

    // Регистрация в фоне
    upsertUser(ctx.from, startParam).catch((err) => {
      console.error('start upsert error:', err);
    });

    await replyPromise;
  });

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
