import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { createAddress, deleteAddress, listAddresses } from './addresses.mjs';
import { findById, publicUser, updateUser, isEmailTaken } from './store.mjs';
import { getLoyaltyForUser } from './loyalty.mjs';
import { getWelcomeDiscountStatus } from './welcome-discount.mjs';
import { sendPasswordChangedEmail, sendProfileUpdatedEmail } from './mail.mjs';

export function createClientRouter({ authMiddleware }) {
  const router = Router();

  router.get('/loyalty', authMiddleware, async (req, res) => {
    try {
      const user = await findById(req.userId);
      if (!user) return res.status(404).json({ error: 'Пользователь не найден' });
      const [loyalty, welcomeDiscount] = await Promise.all([
        getLoyaltyForUser(user),
        getWelcomeDiscountStatus(user),
      ]);
      res.json({ data: { ...loyalty, welcomeDiscount } });
    } catch (err) {
      console.error('[client] loyalty:', err);
      res.status(500).json({ error: 'Не удалось загрузить уровень лояльности' });
    }
  });

  router.get('/addresses', authMiddleware, async (req, res) => {
    try {
      const items = await listAddresses(req.userId);
      res.json({ data: items });
    } catch (err) {
      console.error('[client] addresses:', err);
      res.status(500).json({ error: 'Не удалось загрузить адреса' });
    }
  });

  router.post('/addresses', authMiddleware, async (req, res) => {
    try {
      const entry = await createAddress(req.userId, req.body);
      res.status(201).json({ data: entry });
    } catch (err) {
      console.error('[client] create address:', err);
      res.status(500).json({ error: 'Не удалось сохранить адрес' });
    }
  });

  router.delete('/addresses/:id', authMiddleware, async (req, res) => {
    try {
      const ok = await deleteAddress(req.userId, req.params.id);
      if (!ok) return res.status(404).json({ error: 'Адрес не найден' });
      res.json({ ok: true });
    } catch (err) {
      console.error('[client] delete address:', err);
      res.status(500).json({ error: 'Не удалось удалить адрес' });
    }
  });

  router.patch('/profile', authMiddleware, async (req, res) => {
    try {
      const user = await findById(req.userId);
      if (!user) return res.status(404).json({ error: 'Пользователь не найден' });

      const name = String(req.body.name ?? user.name).trim();
      const phone = String(req.body.phone ?? user.phone).trim();
      const email = String(req.body.email ?? user.email).trim().toLowerCase();
      const password = String(req.body.password || '');

      if (name.length < 2) return res.status(400).json({ error: 'Имя слишком короткое' });
      if (phone.length < 6) return res.status(400).json({ error: 'Укажите телефон' });
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ error: 'Некорректный email' });

      if (await isEmailTaken(email, user.id)) {
        return res.status(409).json({ error: 'Email уже занят' });
      }

      const patch = { name, phone, email };
      const profileChanged = name !== user.name || phone !== user.phone || email !== user.email;
      if (password) {
        if (password.length < 8) return res.status(400).json({ error: 'Пароль не короче 8 символов' });
        patch.passwordHash = await bcrypt.hash(password, 10);
      }
      const saved = await updateUser(user.id, patch);
      if (!saved) return res.status(404).json({ error: 'Пользователь не найден' });
      const updated = publicUser(saved);
      if (password) {
        sendPasswordChangedEmail(updated).catch((err) => {
          console.error('[mail] password changed notify failed:', err);
        });
      } else if (profileChanged) {
        sendProfileUpdatedEmail(updated).catch((err) => {
          console.error('[mail] profile updated notify failed:', err);
        });
      }
      res.json({ user: updated });
    } catch (err) {
      console.error('[client] profile:', err);
      res.status(500).json({ error: 'Не удалось обновить профиль' });
    }
  });

  return router;
}
