import express from 'express';
import cors from 'cors';
import { getUser, claimRewards, getReferralStats, upsertUser } from './users.js';

export function createApi() {
  const app = express();
  app.use(cors());
  app.use(express.json());

  // Проверка, что сервер жив
  app.get('/', (req, res) => {
    res.json({ status: 'ok', service: 'BitneX API' });
  });

  // Получить данные пользователя
  // GET /api/user/:id
  app.get('/api/user/:id', async (req, res) => {
    try {
      const id = Number(req.params.id);
      if (!id) return res.status(400).json({ error: 'Invalid id' });

      const user = await getUser(id);
      if (!user) return res.status(404).json({ error: 'User not found' });

      const refs = await getReferralStats(id);

      res.json({
        id: user.id,
        username: user.username,
        first_name: user.first_name,
        ref_code: user.ref_code,
        app_balance: Number(user.app_balance),
        pending: Number(user.pending),
        total_claimed: Number(user.total_claimed),
        wallet_hold: Number(user.wallet_hold),
        referrer_id: user.referrer_id,
        referrals: {
          count: refs.count,
          earned: refs.earned,
        },
      });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'Server error' });
    }
  });

  // Собрать награды
  // POST /api/claim
  // body: { user_id: number }
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

  // Регистрация / обновление пользователя из Mini App
  // POST /api/register
  // body: { id, username, first_name, last_name, start_param }
  app.post('/api/register', async (req, res) => {
    try {
      const { id, username, first_name, last_name, start_param } = req.body;
      if (!id) return res.status(400).json({ error: 'id required' });

      const user = await upsertUser(
        { id, username, first_name, last_name },
        start_param || null
      );

      const refs = await getReferralStats(user.id);

      res.json({
        id: user.id,
        ref_code: user.ref_code,
        app_balance: Number(user.app_balance),
        pending: Number(user.pending),
        wallet_hold: Number(user.wallet_hold),
        referrals: {
          count: refs.count,
          earned: refs.earned,
        },
      });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'Server error' });
    }
  });

  return app;
}
