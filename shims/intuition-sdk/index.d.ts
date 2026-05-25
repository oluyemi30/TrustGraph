export interface IntuitionSDKConfig {
  apiKey?: string;
  network?: string;
}

export class IntuitionSDK {
  apiKey?: string;
  network: string;
  endpoint: string;

  constructor(config?: IntuitionSDKConfig);

  query(options: { query: string; variables?: any }): Promise<any>;

  getRecentAtomsAndClaims(limitAtoms?: number, limitClaims?: number): Promise<any>;
}

export class IntuitiionSDK extends IntuitionSDK {}
