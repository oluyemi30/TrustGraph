export async function apiFetch<T = any>(url: string, options?: RequestInit): Promise<T> {
  const customBase =
    typeof window !== 'undefined' ? (localStorage.getItem('TRUSTGRAPH_API_URL') || '').trim() : '';
  const cleanBase = customBase.endsWith('/') ? customBase.slice(0, -1) : customBase;
  const cleanUrl = url.startsWith('/') ? url : `/${url}`;
  const targetUrl = cleanBase ? `${cleanBase}${cleanUrl}` : url;

  const res = await fetch(targetUrl, options);
  const contentType = res.headers.get('content-type') || '';

  if (contentType.includes('text/html')) {
    throw new Error(`Expected JSON API response from ${url}, received HTML.`);
  }

  let data: any = null;
  try {
    data = await res.json();
  } catch {
    if (!res.ok) {
      throw new Error(`HTTP ${res.status} calling ${url}`);
    }
    throw new Error(`Invalid JSON payload returned from ${url}`);
  }

  if (!res.ok || data?.success === false) {
    throw new Error(data?.error || `Request failed with status ${res.status}`);
  }

  return data as T;
}

export function formatEvidenceLabel(category: string): string {
  switch (category) {
    case 'onchain_verified':
      return 'Verified On-Chain · Robinhood Chain';
    case 'offchain_signed':
      return 'Off-Chain · Wallet-Signed';
    case 'external_intuition':
      return 'External · Intuition (Base)';
    case 'external_intuition_sample':
      return 'Sample Data · Dev Only';
    default:
      return 'Off-Chain · Unverified Community';
  }
}
