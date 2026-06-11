import { generateActivationCode } from '../../server/telegram-store';

export default async function handler(req: any, res: any) {
  try {
    if (req.method !== 'POST') {
      res.status(405).json({ success: false, error: 'Method Not Allowed' });
      return;
    }

    const { walletAddress } = req.body || req.query;
    if (!walletAddress) {
      res.status(400).json({ success: false, error: 'walletAddress is required' });
      return;
    }

    const code = await generateActivationCode(String(walletAddress));
    res.json({ success: true, code });
  } catch (err: any) {
    console.error('[api/telegram/generate-code] Error:', err);
    res.status(500).json({ success: false, error: err?.message || 'Internal Server Error' });
  }
}
