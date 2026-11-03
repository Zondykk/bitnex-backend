import express from 'express';
import cors from 'cors';
import { getUser, claimRewards, getReferralStats, upsertUser, getLevels } from './users.js';

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

  // Получить пользователя (с доначислением майнинга)
  app.get('/api/user/:id', async (req, res) => {
    try {
      const id = Number(req.params.id);
      if (!id) return res.status(400).json({ error: 'Invalid id' });

      const user = await getUser(id);
      if (!user) return res.status(404).json({ error: 'User not found' });

      const refs = await getReferralStats(id);
      const levels = getLevels();
      const hold = Number(user.wallet_hold) || 0;
      let current = levels[0];
      for (const l of levels) {
        if (hold >= l.hold) current = l;
      }

      res.json({
        id: user.id,
        username: user.username,
        first_name: user.first_name,
        ref_code: user.ref_code,
        app_balance: Number(user.app_balance) || 0,
        pending: Number(user.pending) || 0,
        total_claimed: Number(user.total_claimed) || 0,
        wallet_hold: hold,
        referrer_id: user.referrer_id,
        last_mining_at: user.last_mining_at,
        level: current.level,
        rate: current.rate,
        boost: current.boost,
        referrals: {
          count: refs.count,
          earned: refs.earned,
        },
      });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'Server error', details: err.message });
    }
  });

  // Claim
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

  // Регистрация / логин из Mini App
  app.post('/api/register', async (req, res) => {
    try {
      const { id, username, first_name, last_name, start_param } = req.body;
      if (!id) return res.status(400).json({ error: 'id required' });

      const user = await upsertUser(
        { id, username, first_name, last_name },
        start_param || null
      );

      const refs = await getReferralStats(user.id);
      const levels = getLevels();
      const hold = Number(user.wallet_hold) || 0;
      let current = levels[0];
      for (const l of levels) {
        if (hold >= l.hold) current = l;
      }

      res.json({
        id: user.id,
        ref_code: user.ref_code,
        app_balance: Number(user.app_balance) || 0,
        pending: Number(user.pending) || 0,
        total_claimed: Number(user.total_claimed) || 0,
        wallet_hold: hold,
        last_mining_at: user.last_mining_at,
        level: current.level,
        rate: current.rate,
        boost: current.boost,
        referrals: {
          count: refs.count,
          earned: refs.earned,
        },
      });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'Server error', details: err.message });
    }
  });

  return app;
}
