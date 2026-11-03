import { Telegraf, Markup } from 'telegraf';
import { 
  upsertUser, 
  getPendingWithdrawals, 
  markWithdrawalPaid, 
  rejectWithdrawal 
} from './users.js';

const ADMIN_ID = 8340284827;

export function createBot(token) {
  const bot = new Telegraf(token);

  // ===== ОБЫЧНЫЕ КОМАНДЫ =====

  bot.start(async (ctx) => {
    const startParam = ctx.startPayload || null;
    const name = ctx.from.first_name || ctx.from.username || 'друг';
    const miniAppUrl = process.env.MINI_APP_URL;

    const buttons = [];
    if (miniAppUrl) {
      buttons.push([Markup.button.webApp('⛏️ Открыть BitneX Mining', miniAppUrl)]);
    }
    buttons.push([Markup.button.url('📢 Канал', 'https://t.me/BitneXMining')]);

    let text = `Привет, ${name}! 👋\n\n`;
    text += `Добро пожаловать в <b>BitneX Mining</b>.\n`;
    text += `Майнь BTX, повышай уровень холдом и зарабатывай с друзей.\n\n`;
    text += `Нажми кнопку ниже, чтобы открыть приложение:`;

    const replyPromise = ctx.replyWithHTML(text, Markup.inlineKeyboard(buttons));

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

  // ===== АДМИН КОМАНДЫ =====

  bot.command('withdrawals', async (ctx) => {
    if (ctx.from.id !== ADMIN_ID) return;

    try {
      const list = await getPendingWithdrawals();
      if (!list.length) {
        return ctx.reply('Нет pending заявок на вывод.');
      }

      let text = `<b>Заявки на вывод (pending):</b>\n\n`;
      for (const w of list) {
        const name = w.users?.username || w.users?.first_name || w.user_id;
        text += `🆔 <code>${w.id}</code>\n`;
        text += `👤 ${name} (id: ${w.user_id})\n`;
        text += `💰 ${Number(w.amount).toLocaleString()} BTX\n`;
        text += `📤 К выплате: <b>${Number(w.net_amount).toLocaleString()} BTX</b>\n`;
        text += `📍 <code>${w.wallet_address}</code>\n`;
        text += `📅 ${new Date(w.created_at).toLocaleString('ru-RU')}\n\n`;
      }

      text += `Команды:\n`;
      text += `/paid ID — отметить выплаченной\n`;
      text += `/reject ID — отклонить (вернуть баланс)`;

      await ctx.replyWithHTML(text);
    } catch (err) {
      console.error(err);
      ctx.reply('Ошибка при получении заявок');
    }
  });

  bot.command('paid', async (ctx) => {
    if (ctx.from.id !== ADMIN_ID) return;

    const id = Number(ctx.message.text.split(' ')[1]);
    if (!id) return ctx.reply('Использование: /paid 123');

    try {
      const w = await markWithdrawalPaid(id);
      await ctx.replyWithHTML(
        `✅ Заявка <code>${w.id}</code> отмечена как <b>выплаченная</b>\n` +
        `Сумма: ${Number(w.net_amount).toLocaleString()} BTX`
      );
    } catch (err) {
      ctx.reply(`Ошибка: ${err.message}`);
    }
  });

  bot.command('reject', async (ctx) => {
    if (ctx.from.id !== ADMIN_ID) return;

    const id = Number(ctx.message.text.split(' ')[1]);
    if (!id) return ctx.reply('Использование: /reject 123');

    try {
      const w = await rejectWithdrawal(id);
      await ctx.replyWithHTML(
        `❌ Заявка <code>${w.id}</code> отклонена\n` +
        `Баланс ${Number(w.amount).toLocaleString()} BTX возвращён пользователю`
      );
    } catch (err) {
      ctx.reply(`Ошибка: ${err.message}`);
    }
  });

  bot.catch((err) => {
    console.error('Bot error:', err);
  });

  return bot;
}

// Функция для уведомления админа (будет вызываться из api)
export async function notifyAdminAboutWithdrawal(bot, withdrawal, user) {
  try {
    const name = user?.username || user?.first_name || withdrawal.user_id;
    const text = 
      `🔔 <b>Новая заявка на вывод!</b>\n\n` +
      `🆔 ID заявки: <code>${withdrawal.id}</code>\n` +
      `👤 Пользователь: ${name} (<code>${withdrawal.user_id}</code>)\n` +
      `💰 Сумма: <b>${Number(withdrawal.amount).toLocaleString()} BTX</b>\n` +
      `📤 К выплате: <b>${Number(withdrawal.net_amount).toLocaleString()} BTX</b>\n` +
      `📍 Кошелёк:\n<code>${withdrawal.wallet_address}</code>\n\n` +
      `Команды:\n/paid ${withdrawal.id}\n/reject ${withdrawal.id}`;

    await bot.telegram.sendMessage(ADMIN_ID, text, { parse_mode: 'HTML' });
  } catch (err) {
    console.error('notifyAdmin error:', err.message);
  }
}
