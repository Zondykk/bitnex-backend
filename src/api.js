import express from 'express';
import cors from 'cors';
import {
  getUser,
  claimRewards,
  getReferralStats,
  upsertUser,
  getLevels,
  connectWallet,
  setWalletHold,
  createWithdrawRequest,
  getWithdrawals,
} from './users.js';

function userPayload(user, refs) {
  const levels = getLevels();
  const hold = Number(user.wallet_hold) || 0;
  let current = levels[0];
  for (const l of levels) {
    if (hold >= l.hold) current = l;
  }

  return {
    id: user.id,
    username: user.username,
    first_name: user.first_name,
    ref_code: user.ref_code,
    app_balance: Number(user.app_balance) || 0,
    pending: Number(user.pending) || 0,
    total_claimed: Number(user.total_claimed) || 0,
    wallet_hold: hold,
    wallet_address: user.wallet_address || null,
    referrer_id: user.referrer_id,
    last_mining_at: user.last_mining_at,
    level: current.level,
    rate: current.rate,
    boost: current.boost,
    referrals: {
      count: refs?.count || 0,
      earned: refs?.earned || 0,
    },
  };
}

export function createApi() {
  const app = express();
  app.use(cors());
  app.use(express.json());

  app.get('/', (req, res) => {
    res.json({ status: 'ok', service: 'BitneX API' });
  });

  app.get('/health', (req, res) => {
    res.json({ ok: true, ts: Date.now() });
  });

  app.get('/api/user/:id', async (req, res) => {
    try {
      const id = Number(req.params.id);
      if (!id) return res.status(400).json({ error: 'Invalid id' });

      const user = await getUser(id);
      if (!user) return res.status(404).json({ error: 'User not found' });

      const refs = await getReferralStats(id);
      res.json(userPayload(user, refs));
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'Server error', details: err.message });
    }
  });

  app.post('/api/claim', async (req, res) => {
    try {
      const { user_id } = req.body;
      if (!user_id) return res.status(400).json({ error: 'user_id required' });

      const result = await claimRewards(Number(user_id));
      res.json(result);
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: err.message || 'Server error' });
    }
  });

  app.post('/api/register', async (req, res) => {
    try {
      const { id, username, first_name, last_name, start_param } = req.body;
      if (!id) return res.status(400).json({ error: 'id required' });

      const user = await upsertUser(
        { id, username, first_name, last_name },
        start_param || null
      );

      const refs = await getReferralStats(user.id);
      res.json(userPayload(user, refs));
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'Server error', details: err.message });
    }
  });

  // Подключить кошелёк
  app.post('/api/wallet', async (req, res) => {
    try {
      const { user_id, wallet_address } = req.body;
      if (!user_id || !wallet_address) {
        return res.status(400).json({ error: 'user_id and wallet_address required' });
      }
      const user = await connectWallet(Number(user_id), String(wallet_address));
      const refs = await getReferralStats(user.id);
      res.json(userPayload(user, refs));
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: err.message || 'Server error' });
    }
  });

  // Обновить холд (пока вручную / после on-chain проверки)
  app.post('/api/wallet/hold', async (req, res) => {
    try {
      const { user_id, hold } = req.body;
      if (!user_id) return res.status(400).json({ error: 'user_id required' });
      const user = await setWalletHold(Number(user_id), hold);
      const refs = await getReferralStats(user.id);
      res.json(userPayload(user, refs));
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: err.message || 'Server error' });
    }
  });

  // Заявка на вывод
  app.post('/api/withdraw', async (req, res) => {
    try {
      const { user_id, amount } = req.body;
      if (!user_id) return res.status(400).json({ error: 'user_id required' });
      const row = await createWithdrawRequest(Number(user_id), amount);
      res.json({ ok: true, withdrawal: row });
    } catch (err) {
      console.error(err);
      res.status(400).json({ error: err.message || 'Server error' });
    }
  });

  // История выводов
  app.get('/api/withdrawals/:id', async (req, res) => {
    try {
      const id = Number(req.params.id);
      if (!id) return res.status(400).json({ error: 'Invalid id' });
      const list = await getWithdrawals(id);
      res.json({ withdrawals: list });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: err.message || 'Server error' });
    }
  });

  return app;
}
