import { supabase } from './supabase.js';

/**
 * Создаёт или обновляет пользователя.
 * Возвращает объект пользователя.
 */
export async function upsertUser(tgUser, startParam = null) {
  const id = tgUser.id;
  const refCode = String(id).slice(-9);

  // Ищем, есть ли уже пользователь
  const { data: existing } = await supabase
    .from('users')
    .select('*')
    .eq('id', id)
    .maybeSingle();

  if (existing) {
    // Обновляем имя/username на всякий случай
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
    return data;
  }

  // Новый пользователь — ищем реферера
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
    })
    .select()
    .single();

  if (error) throw error;
  return data;
}

/**
 * Получить пользователя по Telegram ID
 */
export async function getUser(id) {
  const { data, error } = await supabase
    .from('users')
    .select('*')
    .eq('id', id)
    .maybeSingle();

  if (error) throw error;
  return data;
}

/**
 * Получить статистику рефералов
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
 * Собрать награды (claim)
 */
export async function claimRewards(userId) {
  const user = await getUser(userId);
  if (!user) throw new Error('User not found');

  const pending = Number(user.pending);
  if (pending < 0.0001) {
    return { claimed: 0, newBalance: Number(user.app_balance) };
  }

  const newBalance = Number(user.app_balance) + pending;

  // Обновляем баланс пользователя
  const { error } = await supabase
    .from('users')
    .update({
      app_balance: newBalance,
      pending: 0,
      total_claimed: Number(user.total_claimed) + pending,
      updated_at: new Date().toISOString(),
    })
    .eq('id', userId);

  if (error) throw error;

  // Если есть реферер — начисляем ему 5%
  if (user.referrer_id) {
    const bonus = pending * 0.05;

    // Добавляем бонус рефереру
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
          updated_at: new Date().toISOString(),
        })
        .eq('id', user.referrer_id);

      // Записываем в историю
      await supabase.from('referral_earnings').insert({
        user_id: user.referrer_id,
        from_user_id: userId,
        amount: bonus,
      });
    }
  }

  return { claimed: pending, newBalance };
}
