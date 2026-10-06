import assert from 'node:assert/strict';
import test from 'node:test';

import { XiaomiS12VacuumAccessory } from '../dist/accessory.js';

// Xiaomi S12 (xiaomi.vacuum.b106eu) MIoT mapping — see src/accessory.ts.
const STATUS = { siid: 2, piid: 1 };
const DOCK_FLAG = { siid: 2, piid: 2 };
const SWEEP_MODE = { siid: 2, piid: 4 };
const BATTERY = { siid: 3, piid: 1 };
const SUCTION = { siid: 7, piid: 5 };
const ALARM = { siid: 4, piid: 1 };

const logger = () => ({ debug() {}, error() {}, info() {}, warn() {} });

function createFixture(t, config = {}, propertyValues = {}) {
  const intervals = [];
  t.mock.method(global, 'setInterval', (_callback, delay) => {
    intervals.push(delay);
    return { timer: 'interval' };
  });
  t.mock.method(global, 'setTimeout', () => ({ timer: 'timeout' }));

  const updates = [];
  const actions = [];
  const properties = [];
  const matter = {
    clusterNames: {
      RvcOperationalState: 'rvcOperationalState',
      RvcRunMode: 'rvcRunMode',
      RvcCleanMode: 'rvcCleanMode',
      PowerSource: 'powerSource',
      ServiceArea: 'serviceArea',
    },
    updateAccessoryState: async (uuid, cluster, payload) => {
      updates.push({ uuid, cluster, payload });
    },
  };
  const client = {
    doAction: async (...args) => { actions.push(args); },
    getProperties: async () => [
      { ...STATUS, value: propertyValues.status ?? 5 },
      { ...DOCK_FLAG, value: propertyValues.dockFlag ?? 0 },
      { ...SWEEP_MODE, value: propertyValues.sweepMode ?? 0 },
      { ...BATTERY, value: propertyValues.battery ?? 80 },
      { ...SUCTION, value: propertyValues.suction ?? 1 },
    ],
    setProperty: async (...args) => { properties.push(args); },
  };
  const accessory = { UUID: 'test-vacuum', handlers: {} };
  const platform = { api: { matter }, config, log: logger() };

  const controller = new XiaomiS12VacuumAccessory(platform, accessory, client);
  return { accessory, actions, client, controller, intervals, properties, updates };
}

test('maps a vacuuming status response to Matter clusters', async t => {
  const { controller, updates } = createFixture(t);

  await controller.updateStatus();

  assert.deepEqual(updates, [
    { uuid: 'test-vacuum', cluster: 'rvcOperationalState', payload: { operationalState: 1 } },
    { uuid: 'test-vacuum', cluster: 'rvcRunMode', payload: { currentMode: 1 } },
    { uuid: 'test-vacuum', cluster: 'rvcCleanMode', payload: { currentMode: 1 } },
    {
      uuid: 'test-vacuum',
      cluster: 'powerSource',
      payload: { batPercentRemaining: 160, batChargeLevel: 0, batChargeState: 3 },
    },
  ]);
});

test('go-home handler sends the S12 go-charge action and optimistic Matter state', async t => {
  const { accessory, actions, updates } = createFixture(t);

  await accessory.handlers.rvcOperationalState.goHome();

  assert.deepEqual(actions, [[7, 7, [{ piid: 43, value: 1 }]]]);
  assert.deepEqual(updates, [
    { uuid: 'test-vacuum', cluster: 'rvcOperationalState', payload: { operationalState: 64 } },
    { uuid: 'test-vacuum', cluster: 'rvcRunMode', payload: { currentMode: 0 } },
  ]);
});

test('coalesces duplicate Matter Identify commands', async t => {
  const { accessory, properties } = createFixture(t);

  await accessory.handlers.identify.identify();
  await accessory.handlers.identify.identify();

  assert.deepEqual(properties, [[ALARM.siid, ALARM.piid, true]]);
});

test('allows another Matter Identify command after the deduplication window', async t => {
  let now = 10000;
  t.mock.method(Date, 'now', () => now);
  const { accessory, properties } = createFixture(t);

  await accessory.handlers.identify.identify();
  now += 2000;
  await accessory.handlers.identify.identify();

  assert.deepEqual(properties, [[4, 1, true], [4, 1, true]]);
});

test('allows an immediate Matter Identify retry after a failed locate', async t => {
  const { accessory, client, properties } = createFixture(t);
  let shouldFail = true;
  client.setProperty = async (...args) => {
    properties.push(args);
    if (shouldFail) {
      shouldFail = false;
      throw new Error('locate failed');
    }
  };

  // S12 locate is unconfirmed, so failures are logged rather than thrown.
  await accessory.handlers.identify.identify();
  await accessory.handlers.identify.identify();

  assert.deepEqual(properties, [[4, 1, true], [4, 1, true]]);
});

test('checks Mi Home state every five seconds without changing the full poll interval', t => {
  const { intervals } = createFixture(t, { pollInterval: 60 });

  assert.deepEqual(intervals, [60000, 5000]);
});

test('reports charging and fully charged dock states to Matter', async t => {
  const charging = createFixture(t, {}, { status: 5, dockFlag: 2104, battery: 75 });
  await charging.controller.updateStatus();
  assert.deepEqual(charging.updates[0].payload, { operationalState: 65 });
  assert.deepEqual(charging.updates[1].payload, { currentMode: 0 });
  assert.equal(charging.updates[3].payload.batChargeState, 1);

  const docked = createFixture(t, {}, { status: 5, dockFlag: 2103, battery: 100 });
  await docked.controller.updateStatus();
  assert.deepEqual(docked.updates[0].payload, { operationalState: 66 });
  assert.equal(docked.updates[3].payload.batChargeState, 2);
});

test('treats status 4 (just arrived at dock) as docked', async t => {
  const { controller, updates } = createFixture(t, {}, { status: 4, dockFlag: 0, battery: 50 });
  await controller.updateStatus();
  assert.deepEqual(updates[0].payload, { operationalState: 65 });
});

test('does not treat repositioning / leaving-dock flags as docked', async t => {
  for (const dockFlag of [2108, 2110]) {
    const { controller, updates } = createFixture(t, {}, { status: 5, dockFlag, battery: 100 });
    await controller.updateStatus();
    assert.deepEqual(updates[0].payload, { operationalState: 1 }, `dockFlag ${dockFlag}`);
    assert.equal(updates[3].payload.batChargeState, 3);
  }
});

test('maps paused and returning states', async t => {
  const paused = createFixture(t, {}, { status: 2 });
  await paused.controller.updateStatus();
  assert.deepEqual(paused.updates[0].payload, { operationalState: 2 });
  assert.equal(paused.updates[3].payload.batChargeState, 3);

  const returning = createFixture(t, {}, { status: 3 });
  await returning.controller.updateStatus();
  assert.deepEqual(returning.updates[0].payload, { operationalState: 64 });
});

test('reports low battery charge levels', async t => {
  const warning = createFixture(t, {}, { status: 1, battery: 15 });
  await warning.controller.updateStatus();
  assert.equal(warning.updates[3].payload.batChargeLevel, 1);

  const critical = createFixture(t, {}, { status: 1, battery: 5 });
  await critical.controller.updateStatus();
  assert.equal(critical.updates[3].payload.batChargeLevel, 2);
});

test('syncs clean mode from device suction and sweep mode on the first forced poll', async t => {
  const { controller, updates } = createFixture(t, {}, { status: 1, suction: 3, sweepMode: 1 });
  await controller.updateStatus(true);
  const cleanMode = updates.find(u => u.cluster === 'rvcCleanMode');
  assert.deepEqual(cleanMode.payload, { currentMode: 7 }); // Vacuum & Mop Turbo
});
