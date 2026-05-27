export class IntuitionSDK {
  constructor(config = {}) {
    this.apiKey = config.apiKey;
    this.network = config.network || 'base';
    this.endpoints = this.network === 'base' || this.network === 'mainnet'
      ? [
          'https://api.intuition.systems/v1/graphql',
          'https://api.intuition.systems/graphql',
          'https://multichain-api.intuition.systems/v1/graphql',
          'https://api.intuition.cafe/v1/graphql'
        ]
      : [
          'https://api.testnet.intuition.systems/v1/graphql',
          'https://api.testnet.intuition.systems/graphql'
        ];
    this.endpoint = this.endpoints[0];
  }

  async query({ query, variables }) {
    const headers = {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    };
    if (this.apiKey) {
      headers['X-API-Key'] = this.apiKey;
      headers['Authorization'] = `Bearer ${this.apiKey}`;
    }

    let lastError = null;

    // Try each candidate endpoint
    for (const url of this.endpoints) {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 4000);

      try {
        const res = await fetch(url, {
          method: 'POST',
          headers,
          body: JSON.stringify({
            query,
            variables
          }),
          signal: controller.signal
        });
        clearTimeout(timeoutId);

        if (res.ok) {
          // Success! Keep this active endpoint for subsequent calls and return
          this.endpoint = url;
          return await res.json();
        } else {
          lastError = { status: res.status, message: `Status ${res.status} returned by gateway` };
        }
      } catch (err) {
        clearTimeout(timeoutId);
        lastError = err;
      }
    }

    // All endpoints failed
    const finalErr = new Error(
      lastError && lastError.status === 404
        ? 'Intuition GraphQL indexer is offline or undergoing maintenance (Status 404)'
        : (lastError ? lastError.message : 'Unreachable gateway')
    );
    finalErr.status = lastError ? lastError.status : 404;
    throw finalErr;
  }

  async getRecentAtomsAndClaims(limitAtoms = 50, limitClaims = 30) {
    const graphqlQuery = `
      query getRecentAtomsAndClaims($limitAtoms: Int!, $limitClaims: Int!) {
        atoms(limit: $limitAtoms, order_by: {created_at: desc}) {
          id
          label
          value
          type
          creator
          created_at
        }
        claims(limit: $limitClaims, order_by: {created_at: desc}) {
          id
          subject {
            id
            label
          }
          predicate {
            id
            label
          }
          object {
            id
            label
          }
          creator
          created_at
        }
      }
    `;

    return this.query({
      query: graphqlQuery,
      variables: {
        limitAtoms,
        limitClaims
      }
    });
  }
}

export const IntuitiionSDK = IntuitionSDK;

if (typeof module !== 'undefined' && typeof module.exports !== 'undefined') {
  module.exports = {
    IntuitionSDK,
    IntuitiionSDK: IntuitionSDK
  };
}
