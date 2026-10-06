import miio from 'miio';

const STATUS_LABELS = {
  1: 'Cleaning',
  2: 'Idle',
  3: 'Paused',
  4: 'Error',
  5: 'Returning to dock',
  6: 'Charging',
  7: 'Mopping',
  12: 'Sweeping and mopping',
  13: 'Charging complete',
  14: 'Upgrading',
};

const FAULT_LABELS = {
  0: 'No fault',
  1: 'Left wheel error',
  2: 'Right wheel error',
  3: 'Cliff sensor error',
  4: 'Low battery',
  5: 'Main brush blocked',
  6: 'Side brush error',
  7: 'Fan error',
  8: 'Dust compartment or water tank issue',
  9: 'Charging error',
  10: 'Water shortage',
  11: 'Vacuum is lifted or off the ground',
  12: 'Stuck or trapped',
  13: 'Restricted area or virtual wall detected',
  14: 'Dust compartment missing',
  15: 'Water tank missing',
};

const CHARGING_LABELS = {
  1: 'Charging',
  2: 'Discharging',
  4: 'Charging / docked',
  5: 'Returning to charger',
};

const SUCTION_LABELS = {
  0: 'Quiet',
  1: 'Default',
  2: 'Medium',
  3: 'Strong',
};

const PROPERTY_MAP = {
  fault: { siid: 3, piid: 1 },
  status: { siid: 3, piid: 2 },
  battery: { siid: 2, piid: 1 },
  charging: { siid: 2, piid: 2 },
  suction: { siid: 18, piid: 6 },
  mainBrushTime: { siid: 26, piid: 1 },
  mainBrushLife: { siid: 26, piid: 2 },
  filterLife: { siid: 27, piid: 1 },
  filterTime: { siid: 27, piid: 2 },
  sideBrushTime: { siid: 28, piid: 1 },
  sideBrushLife: { siid: 28, piid: 2 },
};

const RESET_ACTIONS = {
  'main-brush': { label: 'Main brush', siid: 26, aiid: 1 },
  filter: { label: 'Filter', siid: 27, aiid: 1 },
  'side-brush': { label: 'Side brush', siid: 28, aiid: 1 },
};

async function callWithTimeout(promise, label, timeoutMs = 15000) {
  let timeout;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timeout = setTimeout(() => reject(new Error(`${label} timed out after ${timeoutMs}ms`)), timeoutMs);
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

function usage() {
  console.error('Usage: npm run check:local -- <ip> <token> <deviceId> [--find|--raw|--reset <main-brush|filter|side-brush>]');
}

function getValue(results, key) {
  const prop = PROPERTY_MAP[key];
  return results.find(item => item.siid === prop.siid && item.piid === prop.piid)?.value;
}

function label(labels, value, fallback) {
  if (value === undefined) return 'Unknown';
  return labels[value] || `${fallback} ${value}`;
}

function assertMiotSuccess(result, label) {
  const responses = Array.isArray(result) ? result : [result];
  const failed = responses.find(response => response?.code !== undefined && response.code !== 0);
  if (failed) {
    throw new Error(`${label} failed with MIoT code ${failed.code}`);
  }
}

function printHumanSummary(results) {
  const fault = getValue(results, 'fault');
  const status = getValue(results, 'status');
  const battery = getValue(results, 'battery');
  const charging = getValue(results, 'charging');
  const suction = getValue(results, 'suction');

  console.log('');
  console.log('Vacuum summary');
  console.log('--------------');
  console.log(`Status: ${label(STATUS_LABELS, status, 'Unknown status')}`);
  console.log(`Fault: ${label(FAULT_LABELS, fault, 'Unknown fault')}`);
  console.log(`Battery: ${battery ?? 'Unknown'}%`);
  console.log(`Charging: ${label(CHARGING_LABELS, charging, 'Unknown charging state')}`);
  console.log(`Suction: ${label(SUCTION_LABELS, suction, 'Unknown suction mode')}`);
  console.log('');
  console.log('Consumables');
  console.log('-----------');
  console.log(`Main brush: ${getValue(results, 'mainBrushLife') ?? '?'}% (${getValue(results, 'mainBrushTime') ?? '?'}h left)`);
  console.log(`Filter: ${getValue(results, 'filterLife') ?? '?'}% (${getValue(results, 'filterTime') ?? '?'}h left)`);
  console.log(`Side brush: ${getValue(results, 'sideBrushLife') ?? '?'}% (${getValue(results, 'sideBrushTime') ?? '?'}h left)`);
}

async function callAction(device, did, action) {
  const result = await callWithTimeout(device.call('action', {
    siid: action.siid,
    aiid: action.aiid,
    did: String(did),
    in: [],
  }, { retries: 5 }), action.label);

  if (result?.code !== undefined && result.code !== 0) {
    throw new Error(`${action.label} action failed with MIoT code ${result.code}`);
  }

  return result;
}

async function testAction() {
  const [, , address, token, did, command, commandArg] = process.argv;

  if (!address || !token || !did) {
    usage();
    process.exit(2);
  }

  try {
    console.log(`Connecting to vacuum at ${address}:54321...`);
    const device = await miio.device({
      address,
      token,
    });

    if (command === '--find') {
      console.log('Sending locate command...');
      const locateResult = await callAction(device, did, { label: 'Locate', siid: 17, aiid: 1 });
      console.log('Locate result:', JSON.stringify(locateResult, null, 2));
      device.destroy();
      process.exit(0);
    }

    if (command === '--reset') {
      const action = RESET_ACTIONS[commandArg];
      if (!action) {
        usage();
        process.exit(2);
      }

      console.log(`Resetting ${action.label.toLowerCase()} consumable counter...`);
      const resetResult = await callAction(device, did, action);
      console.log('Reset result:', JSON.stringify(resetResult, null, 2));
      device.destroy();
      process.exit(0);
    }

    console.log('Reading status, battery, charging state, suction mode, and consumables...');
    const props = Object.values(PROPERTY_MAP).map(prop => ({
      did: String(did),
      siid: prop.siid,
      piid: prop.piid,
    }));
    const result = await callWithTimeout(
      device.call('get_properties', props, { retries: 5 }),
      'get_properties',
    );
    if (!Array.isArray(result)) {
      throw new Error('Unexpected response format from get_properties');
    }
    assertMiotSuccess(result, 'get_properties');

    if (command === '--raw') {
      console.log('Property result:', JSON.stringify(result, null, 2));
    } else {
      printHumanSummary(result);
    }

    device.destroy();
    process.exit(0);
  } catch (e) {
    console.error('Local check failed:', e.message);
    process.exit(1);
  }
}

testAction();
