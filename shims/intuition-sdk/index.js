class IntuitionSDK {
  constructor(config = {}) {
    this.apiKey = config.apiKey;
    this.network = config.network || 'base';
    this.endpoint = this.network === 'base' || this.network === 'mainnet'
      ? 'https://api.intuition.systems/v1/graphql'
      : 'https://api.testnet.intuition.systems/v1/graphql';
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

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 6000);

    const res = await fetch(this.endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        query,
        variables
      }),
      signal: controller.signal
    });
    clearTimeout(timeoutId);

    if (!res.ok) {
      throw new Error(`Intuition GraphQL Query failed with status ${res.status}`);
    }

    return await res.json();
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

module.exports = {
  IntuitionSDK,
  IntuitiionSDK: IntuitionSDK
};
