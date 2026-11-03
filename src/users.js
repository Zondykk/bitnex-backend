import { supabase } from './supabase.js';

// Таблица уровней (должна совпадать с фронтом)
const LEVELS = [
  { level: 1, hold: 0,     rate: 20,  boost: 1.00 },
  { level: 2, hold: 150,   rate: 24,  boost: 1.20 },
  { level: 3, hold: 500,   rate: 30,  boost: 1.50 },
  { level: 4, hold: 1200,  rate: 40,  boost: 2.00 },
  { level: 5, hold: 2500,  rate: 55,  boost: 2.75 },
  { level: 6, hold: 6000,  rate: 80,  boost: 4.00 },
  { level: 7, hold: 15000, rate: 120, boost: 6.00 },
  { level: 8, hold: 40000, rate: 200, boost: 10.0 },
];

function getLevelInfo(walletHold) {
  let lvl = LEVELS[0];
  for (const l of LEVELS) {
    if (walletHold >= l.hold) lvl = l;
  }
  return lvl;
}

/**
 * Считает, сколько намайнилось с last_mining_at до сейчас
 * и обновляет pending + last_mining_at в базе.
 */
async function accrueMining(user) {
  const now = new Date();
  const last = user.last_mining_at ? new Date(user.last_mining_at) : new Date(user.created_at || now);
  const seconds = Math.max(0, (now - last) / 1000);

  if (seconds < 1) {
    return user; // слишком мало времени прошло
  }

  const lvl = getLevelInfo(Number(user.wallet_hold) || 0);
  // rate — BTX в час, переводим в секунды
  const earned = (lvl.rate / 3600) * seconds * lvl.boost;
  const newPending = Number(user.pending) + earned;

  const { data, error } = await supabase
    .from('users')
    .update({
      pending: newPending,
      last_mining_at: now.toISOString(),
      updated_at: now.toISOString(),
    })
    .eq('id', user.id)
    .select()
    .single();

  if (error) {
    console.error('accrueMining error:', error);
    return user;
  }
  return data;
}

/**
 * Создаёт или обновляет пользователя.
 */
export async function upsertUser(tgUser, startParam = null) {
  const id = tgUser.id;
  const refCode = String(id).slice(-9);

  const { data: existing } = await supabase
    .from('users')
    .select('*')
    .eq('id', id)
    .maybeSingle();

  if (existing) {
    // Начисляем майнинг перед возвратом
    const accrued = await accrueMining(existing);

    const { data, error } = await supabase
      .from('users')
      .update({
        username: tgUser.username || null,
        first_name: tgUser.first_name || null,
        last_name: tgUser.last_name || null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', id)
      .select()
      .single();

    if (error) throw error;
    return data || accrued;
  }

  // Новый пользователь
  let referrerId = null;
  if (startParam) {
    const { data: referrer } = await supabase
      .from('users')
      .select('id')
      .eq('ref_code', startParam)
      .maybeSingle();

    if (referrer && referrer.id !== id) {
      referrerId = referrer.id;
    }
  }

  const now = new Date().toISOString();

  const { data, error } = await supabase
    .from('users')
    .insert({
      id,
      username: tgUser.username || null,
      first_name: tgUser.first_name || null,
      last_name: tgUser.last_name || null,
      ref_code: refCode,
      referrer_id: referrerId,
      app_balance: 0,
      pending: 0,
      total_claimed: 0,
      wallet_hold: 0,
      last_mining_at: now,
    })
    .select()
    .single();

  if (error) throw error;
  return data;
}

/**
 * Получить пользователя + начислить майнинг
 */
export async function getUser(id) {
  const { data, error } = await supabase
    .from('users')
    .select('*')
    .eq('id', id)
    .maybeSingle();

  if (error) throw error;
  if (!data) return null;

  // Начисляем всё, что намайнилось пока приложение было закрыто
  return await accrueMining(data);
}

/**
 * Статистика рефералов
 */
export async function getReferralStats(userId) {
  const { count } = await supabase
    .from('users')
    .select('*', { count: 'exact', head: true })
    .eq('referrer_id', userId);

  const { data: earnings } = await supabase
    .from('referral_earnings')
    .select('amount')
    .eq('user_id', userId);

  const totalEarned = (earnings || []).reduce((sum, e) => sum + Number(e.amount), 0);

  return {
    count: count || 0,
    earned: totalEarned,
  };
}

/**
 * Собрать награды
 */
export async function claimRewards(userId) {
  // Сначала доначисляем всё актуальное
  let user = await getUser(userId);
  if (!user) throw new Error('User not found');

  const pending = Number(user.pending);
  if (pending < 0.0001) {
    return { claimed: 0, newBalance: Number(user.app_balance) };
  }

  const newBalance = Number(user.app_balance) + pending;
  const now = new Date().toISOString();

  const { error } = await supabase
    .from('users')
    .update({
      app_balance: newBalance,
      pending: 0,
      total_claimed: Number(user.total_claimed) + pending,
      last_mining_at: now,
      updated_at: now,
    })
    .eq('id', userId);

  if (error) throw error;

  // 5% рефереру
  if (user.referrer_id) {
    const bonus = pending * 0.05;

    const { data: referrer } = await supabase
      .from('users')
      .select('app_balance')
      .eq('id', user.referrer_id)
      .single();

    if (referrer) {
      await supabase
        .from('users')
        .update({
          app_balance: Number(referrer.app_balance) + bonus,
          updated_at: now,
        })
        .eq('id', user.referrer_id);

      await supabase.from('referral_earnings').insert({
        user_id: user.referrer_id,
        from_user_id: userId,
        amount: bonus,
      });
    }
  }

  return { claimed: pending, newBalance };
}
