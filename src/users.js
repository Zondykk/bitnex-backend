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

// Награды за стрик (день 1 → день 30)
const STREAK_REWARDS = [
  25, 35, 50, 70, 90,           // 1-5
  110, 130, 160, 190, 220,      // 6-10
  250, 280, 320, 360, 400,      // 11-15
  450, 500, 560, 620, 700,      // 16-20
  780, 860, 950, 1050, 1150,    // 21-25
  1250, 1400, 1550, 1700, 2000  // 26-30
];

const BTX_MASTER = 'EQA7OlHxE5Vag1Js8-mZEhx4BlfcfTP6UYbohMuQi5VfmILX';
const BTX_MASTER_RAW = '0:3b3a51f113955a83526cf3e999121c780657dc7d33fa5186e884cb908b955f98';

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

async function fetchBtxBalance(walletAddress) {
  if (!walletAddress) return 0;
  try {
    const url = `https://tonapi.io/v2/accounts/${walletAddress}/jettons`;
    const res = await fetch(url);
    if (!res.ok) return 0;
    const data = await res.json();
    const jettons = data.balances || [];
    const btx = jettons.find(j => {
      const addr = j.jetton?.address || '';
      return addr === BTX_MASTER || addr === BTX_MASTER_RAW;
    });
    if (!btx) return 0;
    return Number(btx.balance || 0) / 1e9;
  } catch (err) {
    console.error('fetchBtxBalance error:', err.message);
    return 0;
  }
}

async function accrueAndTouch(user, profile = null) {
  if (!user?.id) return user;
  const now = new Date();
  const calc = calcEarned(user, now);

  const needProfile = profile && (
    profile.username !== user.username ||
    profile.first_name !== user.first_name ||
    profile.last_name !== user.last_name
  );

  if (calc.seconds < 1 && !needProfile) return user;

  const patch = { updated_at: now.toISOString() };
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
    return { ...user, pending: calc.newPending, last_mining_at: now.toISOString() };
  }
  return data;
}

function getTodayDateString() {
  return new Date().toISOString().slice(0, 10); // YYYY-MM-DD
}

function getYesterdayDateString() {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return d.toISOString().slice(0, 10);
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

  let referrerId = null;
  if (startParam) {
    const { data: referrer } = await supabase
      .from('users')
      .select('id')
      .eq('ref_code', String(startParam))
      .maybeSingle();
    if (referrer && referrer.id !== id) referrerId = referrer.id;
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
      streak_count: 0,
      last_streak_date: null,
      total_streak_claimed: 0,
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

  if (data.wallet_address) {
    const hold = await fetchBtxBalance(data.wallet_address);
    if (Math.abs(hold - Number(data.wallet_hold || 0)) > 0.01) {
      await supabase
        .from('users')
        .update({ wallet_hold: hold, updated_at: new Date().toISOString() })
        .eq('id', id);
      data.wallet_hold = hold;
    }
  }

  return await accrueAndTouch(data);
}

export async function getReferralStats(userId) {
  const [countRes, earningsRes] = await Promise.all([
    supabase.from('users').select('*', { count: 'exact', head: true }).eq('referrer_id', userId),
    supabase.from('referral_earnings').select('amount').eq('user_id', userId),
  ]);

  const totalEarned = (earningsRes.data || []).reduce((sum, e) => sum + Number(e.amount), 0);
  return { count: countRes.count || 0, earned: totalEarned };
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

  if (user.referrer_id) {
    const bonus = pending * 0.05;
    Promise.resolve().then(async () => {
      const { data: referrer } = await supabase
        .from('users')
        .select('app_balance')
        .eq('id', user.referrer_id)
        .maybeSingle();
      if (!referrer) return;
      await supabase.from('users').update({
        app_balance: Number(referrer.app_balance || 0) + bonus,
        updated_at: iso,
      }).eq('id', user.referrer_id);
      await supabase.from('referral_earnings').insert({
        user_id: user.referrer_id,
        from_user_id: userId,
        amount: bonus,
      });
    }).catch(e => console.error('ref bonus error', e));
  }

  return { claimed: pending, newBalance };
}

export function getLevels() {
  return LEVELS;
}

export async function connectWallet(userId, walletAddress) {
  if (!userId || !walletAddress) throw new Error('userId and walletAddress required');

  const { data, error } = await supabase
    .from('users')
    .update({ wallet_address: walletAddress, updated_at: new Date().toISOString() })
    .eq('id', userId)
    .select('*')
    .single();

  if (error) throw error;

  const hold = await fetchBtxBalance(walletAddress);
  const { data: updated, error: holdErr } = await supabase
    .from('users')
    .update({ wallet_hold: hold, updated_at: new Date().toISOString() })
    .eq('id', userId)
    .select('*')
    .single();

  if (holdErr) {
    console.error('set hold error:', holdErr);
    return data;
  }
  return updated;
}

export async function setWalletHold(userId, hold) {
  const value = Math.max(0, Number(hold) || 0);
  const user = await getUser(userId);
  if (!user) throw new Error('User not found');

  const { data, error } = await supabase
    .from('users')
    .update({ wallet_hold: value, updated_at: new Date().toISOString() })
    .eq('id', userId)
    .select('*')
    .single();

  if (error) throw error;
  return data;
}

// ==================== DAILY STREAK ====================

export function getStreakInfo(user) {
  const today = getTodayDateString();
  const yesterday = getYesterdayDateString();
  const lastDate = user.last_streak_date;
  let streak = Number(user.streak_count || 0);

  // Если уже собирал сегодня
  const claimedToday = lastDate === today;

  // Если пропустил день — серия сбрасывается
  if (lastDate && lastDate !== today && lastDate !== yesterday) {
    streak = 0;
  }

  const nextDay = claimedToday ? streak + 1 : streak + 1;
  const rewardIndex = Math.min(nextDay - 1, STREAK_REWARDS.length - 1);
  const reward = STREAK_REWARDS[rewardIndex] || STREAK_REWARDS[STREAK_REWARDS.length - 1];

  return {
    streak_count: streak,
    claimed_today: claimedToday,
    next_reward: reward,
    next_day: nextDay > 30 ? 1 : nextDay,
    total_claimed: Number(user.total_streak_claimed || 0),
    rewards: STREAK_REWARDS,
  };
}

export async function claimStreak(userId) {
  const user = await getUser(userId);
  if (!user) throw new Error('User not found');

  const today = getTodayDateString();
  const yesterday = getYesterdayDateString();
  const lastDate = user.last_streak_date;
  let streak = Number(user.streak_count || 0);

  if (lastDate === today) {
    throw new Error('Вы уже получили награду сегодня');
  }

  // Проверяем непрерывность
  if (lastDate === yesterday) {
    streak += 1;
  } else {
    streak = 1; // начинаем заново
  }

  // Ограничиваем 30 днями (потом начинается новый круг)
  if (streak > 30) streak = 1;

  const rewardIndex = Math.min(streak - 1, STREAK_REWARDS.length - 1);
  const reward = STREAK_REWARDS[rewardIndex];

  const newBalance = Number(user.app_balance || 0) + reward;

  const { data, error } = await supabase
    .from('users')
    .update({
      streak_count: streak,
      last_streak_date: today,
      app_balance: newBalance,
      total_streak_claimed: Number(user.total_streak_claimed || 0) + reward,
      updated_at: new Date().toISOString(),
    })
    .eq('id', userId)
    .select('*')
    .single();

  if (error) throw error;

  return {
    success: true,
    reward,
    new_streak: streak,
    new_balance: newBalance,
  };
}

// ==================== WITHDRAWALS ====================

export async function createWithdrawRequest(userId, amount) {
  const amt = Number(amount);
  if (!amt || amt < 10000) throw new Error('Минимум 10 000 BTX');

  const user = await getUser(userId);
  if (!user) throw new Error('User not found');

  const balance = Number(user.app_balance) || 0;
  const hold = Number(user.wallet_hold) || 0;

  if (balance < amt) throw new Error('Недостаточно баланса');
  if (hold < amt * 0.25) throw new Error('Недостаточно холда на кошельке (нужно 25%)');
  if (!user.wallet_address) throw new Error('Сначала подключите TON-кошелёк');

  const { data: last } = await supabase
    .from('withdrawals')
    .select('created_at')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (last?.created_at) {
    const diff = Date.now() - new Date(last.created_at).getTime();
    if (diff < 24 * 60 * 60 * 1000) {
      const hoursLeft = Math.ceil((24 * 60 * 60 * 1000 - diff) / 3600000);
      throw new Error(`Следующая заявка через ~${hoursLeft} ч`);
    }
  }

  const fee = amt * 0.05;
  const net = amt - fee;

  const { error: balErr } = await supabase
    .from('users')
    .update({ app_balance: balance - amt, updated_at: new Date().toISOString() })
    .eq('id', userId);

  if (balErr) throw balErr;

  const { data, error } = await supabase
    .from('withdrawals')
    .insert({
      user_id: userId,
      amount: amt,
      fee,
      net_amount: net,
      wallet_address: user.wallet_address,
      status: 'pending',
    })
    .select('*')
    .single();

  if (error) {
    await supabase.from('users').update({ app_balance: balance }).eq('id', userId);
    throw error;
  }

  return data;
}

export async function getWithdrawals(userId) {
  const { data, error } = await supabase
    .from('withdrawals')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(20);
  if (error) throw error;
  return data || [];
}

export async function getPendingWithdrawals() {
  const { data, error } = await supabase
    .from('withdrawals')
    .select('*, users(id, username, first_name)')
    .eq('status', 'pending')
    .order('created_at', { ascending: true });
  if (error) throw error;
  return data || [];
}

export async function markWithdrawalPaid(id) {
  const { data, error } = await supabase
    .from('withdrawals')
    .update({ status: 'paid', updated_at: new Date().toISOString() })
    .eq('id', id)
    .eq('status', 'pending')
    .select('*')
    .single();
  if (error) throw error;
  return data;
}

export async function rejectWithdrawal(id) {
  const { data: w, error: findErr } = await supabase
    .from('withdrawals')
    .select('*')
    .eq('id', id)
    .eq('status', 'pending')
    .single();

  if (findErr || !w) throw new Error('Заявка не найдена или уже обработана');

  const { data: user } = await supabase
    .from('users')
    .select('app_balance')
    .eq('id', w.user_id)
    .single();

  if (user) {
    await supabase
      .from('users')
      .update({
        app_balance: Number(user.app_balance || 0) + Number(w.amount),
        updated_at: new Date().toISOString(),
      })
      .eq('id', w.user_id);
  }

  const { data, error } = await supabase
    .from('withdrawals')
    .update({ status: 'rejected', updated_at: new Date().toISOString() })
    .eq('id', id)
    .select('*')
    .single();

  if (error) throw error;
  return data;
}
