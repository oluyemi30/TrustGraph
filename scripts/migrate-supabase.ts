import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import { db } from '../server/db';

dotenv.config();

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be configured in your environment.');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: false } });

async function main() {
  const activationCodes = db.getActivationCodes();
  const walletLinks = db.getWalletLinks();

  console.log(`Found ${activationCodes.length} local activation codes and ${walletLinks.length} wallet links.`);

  if (activationCodes.length > 0) {
    const preparedCodes = activationCodes.map(code => ({
      wallet_address: code.wallet_address.trim().toLowerCase(),
      code: code.code.trim().toUpperCase(),
      created_at: code.created_at
    }));

    const { error: activationError } = await supabase.from('activation_codes').upsert(preparedCodes, { onConflict: 'wallet_address' });
    if (activationError) {
      throw new Error(`Activation code migration failed: ${activationError.message}`);
    }
    console.log(`Migrated ${activationCodes.length} activation codes to Supabase.`);
  }

  if (walletLinks.length > 0) {
    const preparedLinks = walletLinks.map(link => ({
      wallet_address: link.wallet_address.trim().toLowerCase(),
      telegram_user: link.telegram_user.trim().toLowerCase(),
      telegram_id: link.telegram_id,
      activated_at: link.linked_at
    }));

    const { error: linksError } = await supabase.from('wallet_links').upsert(preparedLinks, { onConflict: 'wallet_address' });
    if (linksError) {
      throw new Error(`Wallet link migration failed: ${linksError.message}`);
    }
    console.log(`Migrated ${walletLinks.length} wallet links to Supabase.`);
  }

  console.log('Migration completed successfully. Verify Supabase tables for new rows.');
}

main().catch(err => {
  console.error('Migration failed:', err);
  process.exit(1);
});
