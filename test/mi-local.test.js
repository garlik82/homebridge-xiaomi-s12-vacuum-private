import assert from 'node:assert/strict';
import test from 'node:test';

import { XiaomiLocalClient } from '../dist/mi-local.js';

const logger = () => ({ debug() {}, error() {}, info() {}, warn() {} });

test('returns requested property values from a successful MIoT response', async () => {
  const device = {
    call: async () => [{ siid: 3, piid: 2, code: 0, value: 1 }],
    destroy() {},
  };
  const client = new XiaomiLocalClient(
    logger(),
    { ip: '192.0.2.1', token: 'a'.repeat(32), deviceId: '1' },
    async () => device,
    async () => {},
  );

  const properties = await client.getProperties([{ siid: 3, piid: 2 }]);

  assert.deepEqual(properties, [{ siid: 3, piid: 2, value: 1 }]);
});

test('retries and rejects MIoT property errors instead of treating them as values', async () => {
  let calls = 0;
  let destroys = 0;
  const device = {
    call: async () => {
      calls++;
      return [{ siid: 3, piid: 2, code: -1 }];
    },
    destroy() { destroys++; },
  };
  const client = new XiaomiLocalClient(
    logger(),
    { ip: '192.0.2.1', token: 'a'.repeat(32), deviceId: '1' },
    async () => device,
    async () => {},
  );

  await assert.rejects(client.getProperties([{ siid: 3, piid: 2 }]), /MIoT code -1/);
  assert.equal(calls, 3);
  assert.equal(destroys, 3);
});
