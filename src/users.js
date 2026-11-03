import { supabase } from './supabase.js';

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
    if (Number(walletHold) >= l.hold) lvl = l;
  }
  return lvl;
}

/**
 * Серверный майнинг 24/7.
 * Считает elapsed time с last_mining_at и доначисляет pending.
 */
async function accrueMining(user) {
  if (!user || !user.id) return user;

  const now = new Date();
  let last;
  if (user.last_mining_at) {
    last = new Date(user.last_mining_at);
  } else if (user.created_at) {
    last = new Date(user.created_at);
  } else {
    last = now;
  }

  const seconds = Math.max(0, (now.getTime() - last.getTime()) / 1000);

  // Минимум 2 секунды, чтобы не спамить БД
  if (seconds < 2) {
    return user;
  }

  const lvl = getLevelInfo(user.wallet_hold);
  const earned = (lvl.rate / 3600) * seconds * lvl.boost;
  const newPending = Number(user.pending || 0) + earned;

  const { data, error } = await supabase
    .from('users')
    .update({
      pending: newPending,
      last_mining_at: now.toISOString(),
      updated_at: now.toISOString(),
    })
    .eq('id', user.id)
    .select('*')
    .single();

  if (error) {
    console.error('accrueMining error:', error.message || error);
    // Возвращаем хотя бы локально посчитанное, чтобы UI не врал
    return {
      ...user,
      pending: newPending,
      last_mining_at: now.toISOString(),
    };
  }

  return data;
}

export async function upsertUser(tgUser, startParam = null) {
  const id = tgUser.id;
  const refCode = String(id).slice(-9);

  const { data: existing, error: findErr } = await supabase
    .from('users')
    .select('*')
    .eq('id', id)
    .maybeSingle();

  if (findErr) {
    console.error('find user error:', findErr);
    throw findErr;
  }

  if (existing) {
    // 1) Доначисляем майнинг
    let user = await accrueMining(existing);

    // 2) Обновляем профиль (не трогаем pending)
    const { data, error } = await supabase
      .from('users')
      .update({
        username: tgUser.username || null,
        first_name: tgUser.first_name || null,
        last_name: tgUser.last_name || null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', id)
      .select('*')
      .single();

    if (error) {
      console.error('update profile error:', error);
      return user;
    }

    // Берём pending из accrued (на случай если select вернул старое)
    return {
      ...data,
      pending: user.pending,
      last_mining_at: user.last_mining_at,
    };
  }

  // Новый пользователь
  let referrerId = null;
  if (startParam) {
    const { data: referrer } = await supabase
      .from('users')
      .select('id')
      .eq('ref_code', String(startParam))
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
    .select('*')
    .single();

  if (error) {
    console.error('insert user error:', error);
    throw error;
  }
  return data;
}

export async function getUser(id) {
  const { data, error } = await supabase
    .from('users')
    .select('*')
    .eq('id', id)
    .maybeSingle();

  if (error) throw error;
  if (!data) return null;

  return await accrueMining(data);
}

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

export async function claimRewards(userId) {
  // Сначала доначисляем всё, что намайнилось
  let user = await getUser(userId);
  if (!user) throw new Error('User not found');

  const pending = Number(user.pending) || 0;
  if (pending < 0.0001) {
    return { claimed: 0, newBalance: Number(user.app_balance) || 0 };
  }

  const newBalance = Number(user.app_balance || 0) + pending;
  const now = new Date().toISOString();

  const { error } = await supabase
    .from('users')
    .update({
      app_balance: newBalance,
      pending: 0,
      total_claimed: Number(user.total_claimed || 0) + pending,
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
      .maybeSingle();

    if (referrer) {
      await supabase
        .from('users')
        .update({
          app_balance: Number(referrer.app_balance || 0) + bonus,
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

export function getLevels() {
  return LEVELS;
}
