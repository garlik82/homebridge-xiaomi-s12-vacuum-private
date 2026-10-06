import miio from 'miio';

type DeviceFactory = (options: { address: string; token: string }) => Promise<any>;
type Sleep = (milliseconds: number) => Promise<void>;

export class XiaomiLocalClient {
  private device: any = null;
  private readonly connectAttempts: number;
  private readonly requestTimeoutMs: number;

  constructor(
    private readonly log: any,
    private readonly config: any,
    private readonly deviceFactory: DeviceFactory = miio.device,
    private readonly sleep: Sleep = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds)),
  ) {
    this.connectAttempts = Number(this.config.connectAttempts || 5);
    const requestTimeout = Number(this.config.requestTimeout);
    this.requestTimeoutMs = Number.isFinite(requestTimeout) && requestTimeout > 0 ? requestTimeout : 15000;
  }

  private async resetDevice() {
    if (!this.device) return;

    try {
      await Promise.resolve(this.device.destroy?.());
    } catch (e: any) {
      this.log.debug('Failed to destroy stale Xiaomi connection:', e.message);
    } finally {
      this.device = null;
    }
  }

  private assertMiotSuccess(result: any, label: string) {
    const responses = Array.isArray(result) ? result : [result];
    const failed = responses.find((res: any) => res && res.code !== undefined && res.code !== 0);

    if (failed) {
      throw new Error(`${label} failed with MIoT code ${failed.code}`);
    }
  }

  private async callDevice(method: string, params: any, label: string) {
    if (!this.device) await this.init();

    let timeout: NodeJS.Timeout | undefined;
    try {
      return await Promise.race([
        this.device.call(method, params, { retries: this.connectAttempts }),
        new Promise((_, reject) => {
          timeout = setTimeout(
            () => reject(new Error(`${label} timed out after ${this.requestTimeoutMs}ms`)),
            this.requestTimeoutMs,
          );
        }),
      ]);
    } finally {
      if (timeout) clearTimeout(timeout);
    }
  }

  async init() {
    try {
      await this.resetDevice();
      this.log.info(`Connecting to Xiaomi device at ${this.config.ip}:54321`);
      this.device = await this.deviceFactory({
        address: this.config.ip,
        token: this.config.token,
      });
      this.log.info('Xiaomi Local LAN connection initialized');
    } catch (e: any) {
      await this.resetDevice();
      this.log.error(`Failed to connect to Xiaomi device locally at ${this.config.ip}:54321: ${e.message}`);
      this.log.error('Check that the vacuum is awake, on the same network/VLAN, reachable on UDP port 54321, and that the local token is correct.');
      throw e;
    }
  }

  async getProperties(props: { siid: number; piid: number }[]) {
    const maxRetries = 3;
    let attempt = 0;
    let lastError: Error | undefined;

    while (attempt < maxRetries) {
      try {
        const miotProps = props.map(p => ({
          did: String(this.config.deviceId),
          siid: p.siid,
          piid: p.piid,
        }));
        
        const results = await this.callDevice('get_properties', miotProps, 'get_properties');
        this.log.debug('Received local property result:', JSON.stringify(results));
        
        if (!Array.isArray(results)) {
          throw new Error('Unexpected response format from get_properties');
        }
        this.assertMiotSuccess(results, 'get_properties');

        return results.map((res: any, i: number) => {
          const prop = props[i];
          const siid = res?.siid !== undefined ? res.siid : prop?.siid;
          const piid = res?.piid !== undefined ? res.piid : prop?.piid;
          return {
            siid,
            piid,
            value: res?.value !== undefined ? res.value : res,
          };
        }).filter(item => item.siid !== undefined && item.piid !== undefined);
      } catch (e: any) {
        attempt++;
        lastError = e instanceof Error ? e : new Error(String(e));
        this.log.warn(`Failed to get local properties (attempt ${attempt}/${maxRetries}):`, e.message);
        await this.resetDevice();
        if (attempt < maxRetries) {
          await this.sleep(2000 * attempt);
        }
      }
    }

    throw new Error(`Failed to get local properties after ${maxRetries} attempts: ${lastError?.message ?? 'Unknown error'}`);
  }

  async doAction(siid: number, aiid: number, params: any[] = []) {
    try {
      const result = await this.callDevice('action', {
        siid,
        aiid,
        did: String(this.config.deviceId),
        in: params,
      }, `Action siid ${siid} aiid ${aiid}`);
      this.assertMiotSuccess(result, `Action siid ${siid} aiid ${aiid}`);
      
      this.log.info(`Local Action siid ${siid} aiid ${aiid} successful`);
      return result;
    } catch (e: any) {
      this.log.error('Failed to execute local action:', e.message);
      await this.resetDevice();
      throw e;
    }
  }

  async setProperty(siid: number, piid: number, value: any) {
    try {
      const result = await this.callDevice('set_properties', [{
        did: String(this.config.deviceId),
        siid,
        piid,
        value,
      }], `Property siid ${siid} piid ${piid}`);
      this.assertMiotSuccess(result, `Property siid ${siid} piid ${piid}`);

      this.log.info(`Local Property siid ${siid} piid ${piid} set to ${value}`);
      return result;
    } catch (e: any) {
      this.log.error('Failed to set local property:', e.message);
      await this.resetDevice();
      throw e;
    }
  }

  async getDeviceInfo() {
    try {
      const result = await this.callDevice('miIO.info', [], 'miIO.info');
      return result;
    } catch (e: any) {
      this.log.error('Failed to fetch local device info:', e.message);
      await this.resetDevice();
      throw e;
    }
  }
}
