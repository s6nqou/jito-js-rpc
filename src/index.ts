import axios from 'axios';
import type { RpcResponse, GetTipAccountsResult, SendBundleParams, SendBundleResult, SendTransactionParams, SendTransactionResult, GetInflightBundleStatusesParams, GetInflightBundleStatusesResult, GetBundleStatusesParams, GetBundleStatusesResult } from './types';

export class JitoJsonRpcClient {
  private baseUrl;
  private uuid;
  private client;
  private logger?: Console;

  constructor(baseUrl: string, uuid: string = '') {
    this.baseUrl = baseUrl;
    this.uuid = uuid;
    this.client = axios.create({
      headers: {
        'Content-Type': 'application/json',
      },
    });
  }

  enableConsoleLog() {
    this.logger = console;
  }

  private async sendRequest(endpoint: string, method: string, params?: any) {
    const url = `${this.baseUrl}${endpoint}`;

    const data = {
      jsonrpc: '2.0',
      id: 1,
      method,
      params: params || [],
    };

    this.logger?.log(`Sending request to: ${url}`);
    this.logger?.log(`Request body: ${JSON.stringify(data, null, 2)}`);

    try {
      const response = await this.client.post(url, data);
      this.logger?.log(`Response status: ${response.status}`);
      this.logger?.log(`Response body: ${JSON.stringify(response.data, null, 2)}`);
      return response.data;
    } catch (error) {
      if (axios.isAxiosError(error)) {
        this.logger?.error(`HTTP error: ${error.message}`);
        throw error;
      } else {
        this.logger?.error(`Unexpected error: ${error}`);
        throw new Error('An unexpected error occurred');
      }
    }
  }

  async getTipAccounts(): Promise<RpcResponse<GetTipAccountsResult>> {
    const endpoint = this.uuid ? `/bundles?uuid=${this.uuid}` : '/bundles';
    return this.sendRequest(endpoint, 'getTipAccounts');
  }

  async getRandomTipAccount() {
    const tipAccountsResponse = await this.getTipAccounts();
    if (tipAccountsResponse.result && Array.isArray(tipAccountsResponse.result) && tipAccountsResponse.result.length > 0) {
      const randomIndex = Math.floor(Math.random() * tipAccountsResponse.result.length);
      return tipAccountsResponse.result[randomIndex];
    } else {
      throw new Error('No tip accounts available');
    }
  }

  async sendBundle(params: SendBundleParams): Promise<RpcResponse<SendBundleResult>> {
    const endpoint = this.uuid ? `/bundles?uuid=${this.uuid}` : '/bundles';
    return this.sendRequest(endpoint, 'sendBundle', params);
  }

  async sendTxn(params: SendTransactionParams, bundleOnly = false): Promise<RpcResponse<SendTransactionResult>> {
    let endpoint = '/transactions';
    const queryParams = [];

    if (bundleOnly) {
      queryParams.push('bundleOnly=true');
    }

    if (this.uuid) {
      queryParams.push(`uuid=${this.uuid}`);
    }

    if (queryParams.length > 0) {
      endpoint += `?${queryParams.join('&')}`;
    }

    return this.sendRequest(endpoint, 'sendTransaction', params);
  }

  async getInFlightBundleStatuses(params: GetInflightBundleStatusesParams): Promise<RpcResponse<GetInflightBundleStatusesResult>> {
    const endpoint = this.uuid ? `/bundles?uuid=${this.uuid}` : '/bundles';
    return this.sendRequest(endpoint, 'getInflightBundleStatuses', params);
  }

  async getBundleStatuses(params: GetBundleStatusesParams): Promise<RpcResponse<GetBundleStatusesResult>> {
    const endpoint = this.uuid ? `/bundles?uuid=${this.uuid}` : '/bundles';
    return this.sendRequest(endpoint, 'getBundleStatuses', params);
  }

  async confirmInflightBundle(bundleId: string, timeoutMs = 60000) {
    const start = Date.now();

    while (Date.now() - start < timeoutMs) {
      try {
        const response = await this.getInFlightBundleStatuses([[bundleId]]);

        if (response.result && response.result.value && response.result.value.length > 0) {
          const bundleStatus = response.result.value[0];

          this.logger?.log(`Bundle status: ${bundleStatus.status}, Landed slot: ${bundleStatus.landed_slot}`);

          if (bundleStatus.status === "Failed") {
            return bundleStatus;
          } else if (bundleStatus.status === "Landed") {
            // If the bundle has landed, get more detailed status
            const detailedStatus = await this.getBundleStatuses([[bundleId]]);
            if (detailedStatus.result && detailedStatus.result.value && detailedStatus.result.value.length > 0) {
              return detailedStatus.result.value[0];
            } else {
              this.logger?.log('No detailed status returned for landed bundle.');
              return bundleStatus;
            }
          }
        } else {
          this.logger?.log('No status returned for the bundle. It may be invalid or very old.');
        }
      } catch (error) {
        this.logger?.error('Error checking bundle status:', error);
      }

      // Wait for a short time before checking again
      await new Promise(resolve => setTimeout(resolve, 2000));
    }

    // If we've reached this point, the bundle hasn't reached a final state within the timeout
    this.logger?.log(`Bundle ${bundleId} has not reached a final state within ${timeoutMs}ms`);
    return { status: 'Timeout' };
  }

}