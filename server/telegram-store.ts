import { createClient } from '@supabase/supabase-js';
import { db } from './db';

const SUPABASE_URL = process.env.SUPABASE_URL || '';
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
export const useSupabaseStorage = Boolean(SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY);

const supabase = useSupabaseStorage
  ? createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false }
    })
  : null;

const ACTIVATION_CODE_TTL_MS = 15 * 60 * 1000;
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function randomActivationCode(): string {
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += CODE_CHARS.charAt(Math.floor(Math.random() * CODE_CHARS.length));
  }
  return code;
}

async function supabaseGenerateActivationCode(walletAddress: string): Promise<string> {
  if (!supabase) {
    throw new Error('Supabase storage is not configured. Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.');
  }

  const code = randomActivationCode();
  const wallet_address = walletAddress.trim().toLowerCase();
  const { error } = await supabase
    .from('activation_codes')
    .upsert(
      {
        wallet_address,
        code,
        created_at: new Date().toISOString()
      },
      { onConflict: 'wallet_address' }
    );

  if (error) {
    throw new Error(`Supabase generateActivationCode failed: ${error.message}`);
  }

  return code;
}

async function supabaseActivateTelegram(
  code: string,
  telegramUser: string,
  telegramId?: string
): Promise<{ success: boolean; walletAddress?: string; error?: string }> {
  if (!supabase) {
    throw new Error('Supabase storage is not configured. Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.');
  }

  const searchCode = code.trim().toUpperCase();
  const cleanUser = telegramUser.trim().replace(/^@/, '').toLowerCase();
  const walletLinkWindow = new Date(Date.now() - ACTIVATION_CODE_TTL_MS).toISOString();

  const { data, error } = await supabase
    .from('activation_codes')
    .select('wallet_address')
    .eq('code', searchCode)
    .gt('created_at', walletLinkWindow)
    .single();

  if (error || !data) {
    return { success: false, error: 'Invalid or expired activation code. Please generate a new code on the Web Portal.' };
  }

  const walletAddress = String(data.wallet_address).trim().toLowerCase();

  const deleteDuplicates = await supabase
    .from('wallet_links')
    .delete()
    .or(`wallet_address.eq.${walletAddress},telegram_user.eq.${cleanUser}`);

  if (deleteDuplicates.error) {
    throw new Error(`Supabase activateTelegram failed while cleaning duplicates: ${deleteDuplicates.error.message}`);
  }

  const { error: insertError } = await supabase.from('wallet_links').insert({
    wallet_address: walletAddress,
    telegram_user: cleanUser,
    telegram_id: telegramId ? String(telegramId) : null,
    activated_at: new Date().toISOString()
  });

  if (insertError) {
    throw new Error(`Supabase activateTelegram failed while inserting wallet link: ${insertError.message}`);
  }

  const { error: deleteCodeError } = await supabase
    .from('activation_codes')
    .delete()
    .eq('code', searchCode);

  if (deleteCodeError) {
    throw new Error(`Supabase activateTelegram failed while deleting activation code: ${deleteCodeError.message}`);
  }

  return { success: true, walletAddress };
}

async function supabaseGetLinkedWallet(telegramUser: string): Promise<string | undefined> {
  if (!supabase) {
    throw new Error('Supabase storage is not configured. Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.');
  }

  const cleanUser = telegramUser.trim().replace(/^@/, '').toLowerCase();
  const { data, error } = await supabase
    .from('wallet_links')
    .select('wallet_address')
    .eq('telegram_user', cleanUser)
    .single();

  if (error) {
    if (error.code === 'PGRST116') {
      return undefined;
    }
    throw new Error(`Supabase getLinkedWallet failed: ${error.message}`);
  }

  return data?.wallet_address ? String(data.wallet_address) : undefined;
}

async function supabaseGetTelegramUserForWallet(walletAddress: string): Promise<string | undefined> {
  if (!supabase) {
    throw new Error('Supabase storage is not configured. Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.');
  }

  const cleanAddr = walletAddress.trim().toLowerCase();
  const { data, error } = await supabase
    .from('wallet_links')
    .select('telegram_user')
    .eq('wallet_address', cleanAddr)
    .single();

  if (error) {
    if (error.code === 'PGRST116') {
      return undefined;
    }
    throw new Error(`Supabase getTelegramUserForWallet failed: ${error.message}`);
  }

  return data?.telegram_user ? String(data.telegram_user) : undefined;
}

async function supabaseUnlinkWallet(walletAddress: string): Promise<boolean> {
  if (!supabase) {
    throw new Error('Supabase storage is not configured. Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.');
  }

  const { error } = await supabase
    .from('wallet_links')
    .delete()
    .eq('wallet_address', walletAddress.trim());

  if (error) {
    throw new Error(`Supabase unlinkWallet failed: ${error.message}`);
  }

  return true;
}

export async function generateActivationCode(walletAddress: string): Promise<string> {
  if (useSupabaseStorage) {
    return await supabaseGenerateActivationCode(walletAddress);
  }
  return db.generateActivationCode(walletAddress);
}

export async function activateTelegram(
  code: string,
  telegramUser: string,
  telegramId?: string
): Promise<{ success: boolean; walletAddress?: string; error?: string }> {
  if (useSupabaseStorage) {
    return await supabaseActivateTelegram(code, telegramUser, telegramId);
  }
  return db.activateTelegram(code, telegramUser, telegramId);
}

export async function getLinkedWallet(telegramUser: string): Promise<string | undefined> {
  if (useSupabaseStorage) {
    return await supabaseGetLinkedWallet(telegramUser);
  }
  return db.getLinkedWallet(telegramUser);
}

export async function getTelegramUserForWallet(walletAddress: string): Promise<string | undefined> {
  if (useSupabaseStorage) {
    return await supabaseGetTelegramUserForWallet(walletAddress);
  }
  return db.getTelegramUserForWallet(walletAddress);
}

export async function unlinkWallet(walletAddress: string): Promise<boolean> {
  if (useSupabaseStorage) {
    return await supabaseUnlinkWallet(walletAddress);
  }
  return db.unlinkWallet(walletAddress);
}
