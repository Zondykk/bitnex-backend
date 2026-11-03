import crypto from 'crypto';
import { supabase } from './supabase.js';
import { 
  getPendingWithdrawals, 
  markWithdrawalPaid, 
  rejectWithdrawal 
} from './users.js';

// Список разрешённых админов (сюда добавляй новые ID)
const ALLOWED_ADMINS = [
  8340284827,   // твой ID
  // 123456789,  // пример нового админа
];

function hashPassword(password) {
  return crypto.createHash('sha256').update(password + 'bitnex_salt_2026').digest('hex');
}

export function isAllowedAdmin(userId) {
  return ALLOWED_ADMINS.includes(Number(userId));
}

export async function getAdmin(userId) {
  const { data, error } = await supabase
    .from('admins')
    .select('*')
    .eq('user_id', userId)
    .maybeSingle();

  if (error) throw error;
  return data;
}

export async function setAdminPassword(userId, password) {
  const hash = hashPassword(password);

  const { data, error } = await supabase
    .from('admins')
    .upsert({
      user_id: userId,
      password_hash: hash,
      updated_at: new Date().toISOString(),
    })
    .select('*')
    .single();

  if (error) throw error;
  return data;
}

export async function checkAdminPassword(userId, password) {
  const admin = await getAdmin(userId);
  if (!admin || !admin.password_hash) return false;

  const hash = hashPassword(password);
  return hash === admin.password_hash;
}

// Состояния пользователей (кто сейчас вводит пароль)
const adminStates = new Map();

export function setAdminState(userId, state) {
  adminStates.set(userId, state);
}

export function getAdminState(userId) {
  return adminStates.get(userId) || null;
}

export function clearAdminState(userId) {
  adminStates.delete(userId);
}

// ===== Админ-меню =====
export function getAdminKeyboard() {
  return {
    reply_markup: {
      keyboard: [
        [{ text: '📋 Заявки на вывод' }],
        [{ text: '📊 Статистика' }, { text: '🚪 Выйти' }],
      ],
      resize_keyboard: true,
    },
  };
}

export async function handleAdminCommand(ctx) {
  const userId = ctx.from.id;

  if (!isAllowedAdmin(userId)) {
    return ctx.reply('⛔ У вас нет доступа.');
  }

  const admin = await getAdmin(userId);

  if (!admin || !admin.password_hash) {
    // Первый вход — устанавливаем пароль
    setAdminState(userId, 'set_password');
    return ctx.reply(
      '🔐 Вы впервые входите в админку.\n\n' +
      'Придумайте и отправьте пароль (минимум 6 символов):'
    );
  }

  // Пароль уже есть — просим ввести
  setAdminState(userId, 'enter_password');
  return ctx.reply('🔑 Введите пароль для входа в админку:');
}

export async function handleAdminText(ctx) {
  const userId = ctx.from.id;
  const text = ctx.message.text?.trim();
  const state = getAdminState(userId);

  if (!state) return false; // не админский стейт

  // === Установка пароля ===
  if (state === 'set_password') {
    if (!text || text.length < 6) {
      return ctx.reply('Пароль слишком короткий. Минимум 6 символов. Попробуйте ещё раз:');
    }

    await setAdminPassword(userId, text);
    clearAdminState(userId);

    await ctx.reply(
      '✅ Пароль успешно установлен!\n\nТеперь вы в админ-панели.',
      getAdminKeyboard()
    );
    return true;
  }

  // === Ввод пароля ===
  if (state === 'enter_password') {
    const ok = await checkAdminPassword(userId, text);
    if (!ok) {
      clearAdminState(userId);
      return ctx.reply('❌ Неверный пароль.');
    }

    clearAdminState(userId);
    await ctx.reply('✅ Вход выполнен. Добро пожаловать в админку.', getAdminKeyboard());
    return true;
  }

  return false;
}

// ===== Обработка кнопок админки =====
export async function handleAdminButton(ctx) {
  const userId = ctx.from.id;
  if (!isAllowedAdmin(userId)) return false;

  const text = ctx.message?.text;

  if (text === '📋 Заявки на вывод') {
    const list = await getPendingWithdrawals();
    if (!list.length) {
      await ctx.reply('Нет pending заявок.');
      return true;
    }

    let msg = `<b>Заявки на вывод:</b>\n\n`;
    for (const w of list) {
      const name = w.users?.username || w.users?.first_name || w.user_id;
      msg += `🆔 <code>${w.id}</code>\n`;
      msg += `👤 ${name}\n`;
      msg += `💰 ${Number(w.amount).toLocaleString()} BTX\n`;
      msg += `📤 Выплатить: <b>${Number(w.net_amount).toLocaleString()} BTX</b>\n`;
      msg += `📍 <code>${w.wallet_address}</code>\n`;
      msg += `/paid_${w.id}   /reject_${w.id}\n\n`;
    }

    await ctx.replyWithHTML(msg);
    return true;
  }

  if (text === '📊 Статистика') {
    await ctx.reply('Статистика пока в разработке...');
    return true;
  }

  if (text === '🚪 Выйти') {
    await ctx.reply('Вы вышли из админки.', {
      reply_markup: { remove_keyboard: true },
    });
    return true;
  }

  // Команды вида /paid_123
  if (text?.startsWith('/paid_')) {
    const id = Number(text.replace('/paid_', ''));
    if (!id) return true;

    try {
      const w = await markWithdrawalPaid(id);
      await ctx.reply(`✅ Заявка ${id} отмечена как выплаченная (${Number(w.net_amount).toLocaleString()} BTX)`);
    } catch (e) {
      await ctx.reply(`Ошибка: ${e.message}`);
    }
    return true;
  }

  if (text?.startsWith('/reject_')) {
    const id = Number(text.replace('/reject_', ''));
    if (!id) return true;

    try {
      const w = await rejectWithdrawal(id);
      await ctx.reply(`❌ Заявка ${id} отклонена. Баланс возвращён.`);
    } catch (e) {
      await ctx.reply(`Ошибка: ${e.message}`);
    }
    return true;
  }

  return false;
}
