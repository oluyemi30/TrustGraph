import { VercelRequest, VercelResponse } from '@vercel/node';
import { db } from '../../../../server/db';

export default function handler(req: VercelRequest, res: VercelResponse) {
  try {
    if (req.method !== 'GET') {
      res.status(405).json({ success: false, error: 'Method Not Allowed' });
      return;
    }

    const { walletAddress } = req.query;
    if (!walletAddress) {
      res.status(400).json({ success: false, error: 'walletAddress is required in path' });
      return;
    }

    const addr = Array.isArray(walletAddress) ? walletAddress[0] : walletAddress;
    const telegramUser = db.getTelegramUserForWallet(String(addr));
    res.json({ success: true, linked: !!telegramUser, telegramUser });
  } catch (err: any) {
    console.error('[api/telegram/status] Error:', err);
    res.status(500).json({ success: false, error: err?.message || 'Internal Server Error' });
  }
}
