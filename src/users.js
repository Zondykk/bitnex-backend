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

function calcEarned(user, now = new Date()) {
  let last;
  if (user.last_mining_at) last = new Date(user.last_mining_at);
  else if (user.created_at) last = new Date(user.created_at);
  else last = now;

  const seconds = Math.max(0, (now.getTime() - last.getTime()) / 1000);
  if (seconds < 1) {
    return { earned: 0, seconds, newPending: Number(user.pending || 0) };
  }

  const lvl = getLevelInfo(user.wallet_hold);
  const earned = (lvl.rate / 3600) * seconds * lvl.boost;
  return {
    earned,
    seconds,
    newPending: Number(user.pending || 0) + earned,
    rate: lvl.rate,
    boost: lvl.boost,
    level: lvl.level,
  };
}

/** Один UPDATE: доначисление + опционально профиль */
async function accrueAndTouch(user, profile = null) {
  if (!user?.id) return user;

  const now = new Date();
  const calc = calcEarned(user, now);

  // Если прошло < 1с и профиль не меняем — ничего не пишем
  const needProfile = profile && (
    profile.username !== user.username ||
    profile.first_name !== user.first_name ||
    profile.last_name !== user.last_name
  );

  if (calc.seconds < 1 && !needProfile) {
    return user;
  }

  const patch = {
    updated_at: now.toISOString(),
  };

  if (calc.seconds >= 1) {
    patch.pending = calc.newPending;
    patch.last_mining_at = now.toISOString();
  }

  if (needProfile) {
    patch.username = profile.username || null;
    patch.first_name = profile.first_name || null;
    patch.last_name = profile.last_name || null;
  }

  const { data, error } = await supabase
    .from('users')
    .update(patch)
    .eq('id', user.id)
    .select('*')
    .single();

  if (error) {
    console.error('accrueAndTouch error:', error.message || error);
    return {
      ...user,
      pending: calc.newPending,
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

  if (findErr) throw findErr;

  if (existing) {
    return await accrueAndTouch(existing, {
      username: tgUser.username || null,
      first_name: tgUser.first_name || null,
      last_name: tgUser.last_name || null,
    });
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

  if (error) throw error;
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

  return await accrueAndTouch(data);
}

export async function getReferralStats(userId) {
  const [countRes, earningsRes] = await Promise.all([
    supabase
      .from('users')
      .select('*', { count: 'exact', head: true })
      .eq('referrer_id', userId),
    supabase
      .from('referral_earnings')
      .select('amount')
      .eq('user_id', userId),
  ]);

  const totalEarned = (earningsRes.data || []).reduce(
    (sum, e) => sum + Number(e.amount),
    0
  );

  return {
    count: countRes.count || 0,
    earned: totalEarned,
  };
}

export async function claimRewards(userId) {
  const { data: user, error: findErr } = await supabase
    .from('users')
    .select('*')
    .eq('id', userId)
    .maybeSingle();

  if (findErr) throw findErr;
  if (!user) throw new Error('User not found');

  const now = new Date();
  const calc = calcEarned(user, now);
  const pending = calc.newPending;

  if (pending < 0.0001) {
    return { claimed: 0, newBalance: Number(user.app_balance) || 0 };
  }

  const newBalance = Number(user.app_balance || 0) + pending;
  const iso = now.toISOString();

  const { error } = await supabase
    .from('users')
    .update({
      app_balance: newBalance,
      pending: 0,
      total_claimed: Number(user.total_claimed || 0) + pending,
      last_mining_at: iso,
      updated_at: iso,
    })
    .eq('id', userId);

  if (error) throw error;

  // Реф 5% — не блокируем ответ
  if (user.referrer_id) {
    const bonus = pending * 0.05;
    Promise.resolve()
      .then(async () => {
        const { data: referrer } = await supabase
          .from('users')
          .select('app_balance')
          .eq('id', user.referrer_id)
          .maybeSingle();

        if (!referrer) return;

        await supabase
          .from('users')
          .update({
            app_balance: Number(referrer.app_balance || 0) + bonus,
            updated_at: iso,
          })
          .eq('id', user.referrer_id);

        await supabase.from('referral_earnings').insert({
          user_id: user.referrer_id,
          from_user_id: userId,
          amount: bonus,
        });
      })
      .catch((e) => console.error('ref bonus error', e));
  }

  return { claimed: pending, newBalance };
}

export function getLevels() {
  return LEVELS;
}
