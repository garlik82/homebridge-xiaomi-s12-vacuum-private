import { OneCMatterPlatform } from './platform.js';
import { XiaomiLocalClient } from './mi-local.js';

// ---------------------------------------------------------------------------
// Xiaomi S12 (xiaomi.vacuum.b106eu) MIoT mapping.
//
// NOTE: these siid/piid values were validated empirically against a real
// device (firmware 475022SD2401A18955) using a property scan, because the
// published miot-spec page did not match this firmware's actual behaviour
// for the "status" property. See conversation history for the validation
// steps (charging / paused / returning / cleaning states were each
// physically reproduced and captured).
//
// Confirmed:
//   siid 2, piid 1  -> status: 1 Standby, 2 Paused, 3 Returning, 4 Charging
//                       (just arrived/aligning), 5 Vacuuming (OR docked,
//                       disambiguated by piid 2), 6 Vacuum+Mop, 7 Mopping
//   siid 2, piid 2  -> dock flag: 0 away from dock, non-zero = docked/charging
//                       (NOT a fault code despite the generic spec)
//   siid 3, piid 1  -> battery percentage
//   siid 7, piid 3  -> box state: 0=None, 1=DustBox, 2=WaterBox, 3=TwoInOne
//   siid 7, piid 4  -> cloth state: 0=None, 1=Exist (mop pad installed)
//   siid 7, piid 5  -> suction level: 0 Quiet, 1 Standard, 2 Medium, 3 Turbo
//   siid 7, piid 6  -> water level: 0=Low, 1=Mid, 2=High (3 levels only)
//   siid 7, piid 8  -> side brush life %
//   siid 7, piid 10 -> main brush life %
//   siid 7, piid 12 -> filter (hypa) life %
//
// NOT yet empirically confirmed (taken from the published miot-spec page,
// use with caution and verify before relying on them):
//   siid 2, aiid 1  -> start sweep
//   siid 2, aiid 2  -> stop sweep
//   siid 7, aiid 7  -> go charge (param piid 43 = 1)
//   siid 7, aiid 3  -> room clean (params piid 24 room ids, piid 25 mode,
//                       piid 26 oper: 1 start / 0 stop)
//   siid 7, aiid 1  -> reset consumable (param piid 17: 1 Main/2 Side/3 Hypa/4 Cloth)
//   siid 4, piid 1  -> alarm/locate (set true to trigger "find me" chime) --
//                       there is no dedicated locate action in the published
//                       spec, this is a best-effort guess.
// ---------------------------------------------------------------------------

const START_VACUUM_AIID = 3;      // start vacuum only
const START_VACUUM_MOP_AIID = 5;  // start vacuum+mop
const START_MOP_AIID = 6;         // start mop only

const CLEAN_MODES = [
  { label: 'Vacuum Quiet',        mode: 0, suction: 0, waterLevel: 0, startAiid: START_VACUUM_AIID },
  { label: 'Vacuum Standard',     mode: 1, suction: 1, waterLevel: 0, startAiid: START_VACUUM_AIID },
  { label: 'Vacuum Medium',       mode: 2, suction: 2, waterLevel: 0, startAiid: START_VACUUM_AIID },
  { label: 'Vacuum Turbo',        mode: 3, suction: 3, waterLevel: 0, startAiid: START_VACUUM_AIID },
  { label: 'Vacuum & Mop Quiet',  mode: 4, suction: 0, waterLevel: 2, startAiid: START_VACUUM_MOP_AIID },
  { label: 'Vacuum & Mop',        mode: 5, suction: 1, waterLevel: 2, startAiid: START_VACUUM_MOP_AIID },
  { label: 'Vacuum & Mop Medium', mode: 6, suction: 2, waterLevel: 2, startAiid: START_VACUUM_MOP_AIID },
  { label: 'Vacuum & Mop Turbo',  mode: 7, suction: 3, waterLevel: 2, startAiid: START_VACUUM_MOP_AIID },
  { label: 'Mop Only',            mode: 8, suction: 0, waterLevel: 2, startAiid: START_MOP_AIID },
];

const STATUS_SIID = 2;
const STATUS_PIID = 1;
const DOCK_FLAG_PIID = 2; // not a real fault code on this firmware, see notes above
const SWEEP_MODE_PIID = 4; // 0=Vacuum, 1=Vacuum+Mop, 2=Mop only — confirmed writable

const BATTERY_SIID = 3;
const BATTERY_PIID = 1;

const SWEEP_SIID = 7;
const BOX_STATE_PIID = 3;   // 0=None, 1=DustBox, 2=WaterBox, 3=TwoInOne
const CLOTH_STATE_PIID = 4; // 0=None, 1=Exist
const SUCTION_PIID = 5;
const WATER_LEVEL_PIID = 6; // 0=Low, 1=Mid, 2=High (3 levels only)
const SIDE_BRUSH_LIFE_PIID = 8;
const MAIN_BRUSH_LIFE_PIID = 10;
const FILTER_LIFE_PIID = 12;

const START_SWEEP_AIID = 1;
const STOP_SWEEP_AIID = 2;
const GO_CHARGE_AIID = 7;
const GO_CHARGE_PARAM_PIID = 43;
const RESET_CONSUMABLE_AIID = 1;
const RESET_CONSUMABLE_PIID = 17;

const ROOM_CLEAN_AIID = 3;
const ROOM_IDS_PIID = 24;
const ROOM_MODE_PIID = 25;
const ROOM_OPER_PIID = 26;
const ROOM_OPER_START = 1;
const ROOM_OPER_PAUSE = 2;
const ROOM_OPER_STOP = 0;

const ALARM_SIID = 4;
const ALARM_PIID = 1;

const DEFAULT_MATTER_UPDATE_TIMEOUT_MS = 10000;
const DEFAULT_STATUS_UPDATE_WATCHDOG_MS = 90000;
const DEFAULT_POLL_INTERVAL_SECONDS = 30;
const IDENTIFY_DEDUP_WINDOW_MS = 2000;
// Mi Home changes are not pushed over the local miIO transport. Keep the
// Matter view fresh enough that Siri does not act on an old docked state.
const EXTERNAL_STATE_POLL_INTERVAL_MS = 5000;

const CONSUMABLES = [
  { key: 'mainBrush', label: 'Main brush', siid: SWEEP_SIID, lifePiid: MAIN_BRUSH_LIFE_PIID },
  { key: 'filter', label: 'Filter', siid: SWEEP_SIID, lifePiid: FILTER_LIFE_PIID },
  { key: 'sideBrush', label: 'Side brush', siid: SWEEP_SIID, lifePiid: SIDE_BRUSH_LIFE_PIID },
];

function describeStatus(status: number | undefined, dockFlag: number | undefined) {
  if (status === undefined) return 'Unknown';
  if (status === 1) return 'Standby';
  if (status === 2) return 'Paused';
  if (status === 3) return 'Returning to dock';
  if (status === 4) return 'Docked (not yet charging)';
  if (status === 5) return dockFlag !== undefined && dockFlag !== 0 ? 'Charging (docked)' : 'Vacuuming';
  if (status === 6) return 'Vacuum & Mop';
  if (status === 7) return 'Mopping';
  return `Unknown status ${status}`;
}

export class OneCVacuumAccessory {
  private isUpdating = false;
  private updateStartedAt = 0;
  private updateToken = 0;
  private consecutiveFailures = 0;
  private nextAllowedUpdate = 0;
  private readonly lastClusterState = new Map<string, string>();
  private lastCleanModeIndex = 1; // Vacuum Standard
  private lastConsumableSummary = '';
  private lastRoomCleanAreas: number[] = [];
  private cleanModeAtPause = -1; // mode index when pause was triggered
  private initialSyncDone = false; // sync clean mode from device only once on startup
  private lastChargeState = -1; // track charge state changes separately
  private lastIdentifyAt = Number.NEGATIVE_INFINITY;
  private readonly matterUpdateTimeoutMs: number;
  private readonly statusUpdateWatchdogMs: number;
  private readonly pollIntervalMs: number;

  constructor(
    private readonly platform: OneCMatterPlatform,
    private readonly accessory: any, // MatterAccessory
    private readonly client: XiaomiLocalClient,
  ) {
    const matterUpdateTimeout = Number(this.platform.config.matterUpdateTimeout);
    const statusUpdateWatchdog = Number(this.platform.config.statusUpdateWatchdog);
    this.matterUpdateTimeoutMs = Number.isFinite(matterUpdateTimeout) && matterUpdateTimeout > 0
      ? matterUpdateTimeout
      : DEFAULT_MATTER_UPDATE_TIMEOUT_MS;
    this.statusUpdateWatchdogMs = Number.isFinite(statusUpdateWatchdog) && statusUpdateWatchdog > 0
      ? statusUpdateWatchdog
      : DEFAULT_STATUS_UPDATE_WATCHDOG_MS;
    const pollInterval = Number(this.platform.config.pollInterval);
    this.pollIntervalMs = (Number.isFinite(pollInterval) && pollInterval > 0
      ? pollInterval
      : DEFAULT_POLL_INTERVAL_SECONDS) * 1000;

    // Register handlers
    this.accessory.handlers = {
      identify: {
        identify: async () => {
          const now = Date.now();
          if (now - this.lastIdentifyAt < IDENTIFY_DEDUP_WINDOW_MS) {
            this.platform.log.debug('Ignoring duplicate Matter Identify command');
            return;
          }
          this.lastIdentifyAt = now;

          this.platform.log.info('Matter: Identify command');
          try {
            // Best-effort: no dedicated locate action confirmed for this model yet.
            await this.client.setProperty(ALARM_SIID, ALARM_PIID, true);
          } catch (e: any) {
            // Do not suppress a controller retry when the locate action itself failed.
            if (this.lastIdentifyAt === now) {
              this.lastIdentifyAt = Number.NEGATIVE_INFINITY;
            }
            this.platform.log.warn('Locate (identify) failed - this action is unconfirmed for the S12:', e.message);
          }
          this.scheduleStatusUpdate();
        },
      },
      rvcOperationalState: {
        pause: async () => {
          this.platform.log.info('Matter: Pause command');
          this.cleanModeAtPause = this.lastCleanModeIndex; // remember mode at pause
          await this.client.doAction(SWEEP_SIID, ROOM_CLEAN_AIID, [
            { piid: ROOM_IDS_PIID, value: '' },
            { piid: ROOM_MODE_PIID, value: 0 },
            { piid: ROOM_OPER_PIID, value: ROOM_OPER_PAUSE },
          ]);
          await this.setOptimisticRunState(2, 0);
          this.scheduleStatusUpdate();
        },
        resume: async () => {
          this.platform.log.info('Matter: Resume command');
          await this.client.doAction(SWEEP_SIID, ROOM_CLEAN_AIID, [
            { piid: ROOM_IDS_PIID, value: '' },
            { piid: ROOM_MODE_PIID, value: 0 },
            { piid: ROOM_OPER_PIID, value: ROOM_OPER_START },
          ]);
          await this.setOptimisticRunState(1, 1);
          this.scheduleStatusUpdate();
        },
        goHome: async () => {
          this.platform.log.info('Matter: Go Home command');
          await this.client.doAction(SWEEP_SIID, GO_CHARGE_AIID, [
            { piid: GO_CHARGE_PARAM_PIID, value: 1 },
          ]);
          await this.setOptimisticRunState(64, 0);
          this.scheduleStatusUpdate();
        },
      },
      rvcRunMode: {
        changeToMode: async (args: any) => {
          const newMode = Number(args.newMode);
          this.platform.log.info(`Matter: Run mode change to ${newMode}`);
          if (newMode === 0) {
            // Stop
            await this.client.doAction(STATUS_SIID, STOP_SWEEP_AIID);
            await this.setOptimisticRunState(0, 0);
          } else {
            // Check if paused — resume instead of starting fresh
            const props = await this.client.getProperties([{ siid: STATUS_SIID, piid: STATUS_PIID }]);
            const currentStatus = props.find((p: any) => p.siid === STATUS_SIID && p.piid === STATUS_PIID)?.value;
            if (currentStatus === 2) {
              const modeAtPause = CLEAN_MODES.find(m => m.mode === this.cleanModeAtPause);
              const newCleanMode = CLEAN_MODES.find(m => m.mode === this.lastCleanModeIndex) ?? CLEAN_MODES[1];
              const typeChanged = modeAtPause && newCleanMode && modeAtPause.startAiid !== newCleanMode.startAiid;
              const modeChangedWhilePaused = this.cleanModeAtPause !== -1 && this.cleanModeAtPause !== this.lastCleanModeIndex;
              const autoPaused = this.cleanModeAtPause === -1;
              this.platform.log.info(`Matter: pause state — cleanModeAtPause=${this.cleanModeAtPause} lastCleanModeIndex=${this.lastCleanModeIndex} typeChanged=${typeChanged} modeChangedWhilePaused=${modeChangedWhilePaused} autoPaused=${autoPaused}`);

              if (autoPaused || (modeChangedWhilePaused && typeChanged)) {
                // Auto-pause (error) or cleaning type changed — stop and start fresh
                this.platform.log.info(`Matter: ${autoPaused ? 'Auto-pause detected' : 'Cleaning type changed'}, starting fresh with ${newCleanMode.label}`);
                await this.client.doAction(SWEEP_SIID, ROOM_CLEAN_AIID, [
                  { piid: ROOM_IDS_PIID, value: '' },
                  { piid: ROOM_MODE_PIID, value: 0 },
                  { piid: ROOM_OPER_PIID, value: ROOM_OPER_STOP },
                ]);
                await new Promise(res => setTimeout(res, 500));
                await this.client.setProperty(SWEEP_SIID, SUCTION_PIID, newCleanMode.suction);
                if (newCleanMode.waterLevel > 0) {
                  await this.client.setProperty(SWEEP_SIID, WATER_LEVEL_PIID, newCleanMode.waterLevel);
                }
                await this.client.doAction(STATUS_SIID, newCleanMode.startAiid);
              } else if (modeChangedWhilePaused && !typeChanged) {
                // Only suction changed — set new suction and resume
                this.platform.log.info(`Matter: Suction changed while paused, resuming with ${newCleanMode.label}`);
                await this.client.setProperty(SWEEP_SIID, SUCTION_PIID, newCleanMode.suction);
                await this.client.doAction(SWEEP_SIID, ROOM_CLEAN_AIID, [
                  { piid: ROOM_IDS_PIID, value: '' },
                  { piid: ROOM_MODE_PIID, value: 0 },
                  { piid: ROOM_OPER_PIID, value: ROOM_OPER_START },
                ]);
              } else {
                this.platform.log.info('Matter: Resuming from pause');
                await this.client.doAction(SWEEP_SIID, ROOM_CLEAN_AIID, [
                  { piid: ROOM_IDS_PIID, value: '' },
                  { piid: ROOM_MODE_PIID, value: 0 },
                  { piid: ROOM_OPER_PIID, value: ROOM_OPER_START },
                ]);
              }
              this.cleanModeAtPause = -1;
            } else {
              const cleanMode = CLEAN_MODES.find(m => m.mode === this.lastCleanModeIndex) ?? CLEAN_MODES[1];
              this.platform.log.info(`Matter: Starting with clean mode: ${cleanMode.label} (aiid ${cleanMode.startAiid})`);
              await this.client.setProperty(SWEEP_SIID, SUCTION_PIID, cleanMode.suction);
              if (cleanMode.waterLevel > 0) {
                await this.client.setProperty(SWEEP_SIID, WATER_LEVEL_PIID, cleanMode.waterLevel);
              }
              await this.client.doAction(STATUS_SIID, cleanMode.startAiid);
            }
            await this.setOptimisticRunState(1, 1);
          }
          this.scheduleStatusUpdate();
        },
      },
      rvcCleanMode: {
        changeToMode: async (args: any) => {
          const nextMode = Number(args.newMode);
          const cleanMode = CLEAN_MODES.find(m => m.mode === nextMode);
          if (!cleanMode) throw new Error(`Unsupported clean mode: ${args.newMode}`);
          this.platform.log.info(`Matter: Clean mode → ${cleanMode.label}`);
          this.lastCleanModeIndex = nextMode;
          const matter = this.platform.api.matter!;
          await this.updateClusterState(matter.clusterNames.RvcCleanMode, { currentMode: nextMode }, true);
          this.scheduleStatusUpdate(500);
        },
      },
    };

    // Experimental, opt-in: room-by-room cleaning via the ServiceArea cluster.
    // UNCONFIRMED for the S12 - verify piid 24/25/26 against your unit before relying on this.
    const rooms = Array.isArray(this.platform.config.rooms) ? this.platform.config.rooms : [];
    if (this.platform.config.enableRoomCleaning === true && rooms.length > 0) {
      this.accessory.handlers.serviceArea = {
        selectAreas: async (args: any) => {
          const areaIds: number[] = Array.isArray(args?.newAreas) ? args.newAreas : [];
          await this.startRoomClean(areaIds);
        },
      };
    }

    // Polling
    setInterval(() => this.updateStatus(), this.pollIntervalMs);
    setInterval(() => this.updateStatus(false, false), EXTERNAL_STATE_POLL_INTERVAL_MS);
    setTimeout(() => this.updateStatus(true), 1000); // Initial update after Matter registration settles (forced: syncs clean mode)
  }

  private scheduleStatusUpdate(delay = 500) {
    setTimeout(() => this.updateStatus(true), delay);
  }

  private async startRoomClean(areaIds: number[]) {
    if (!areaIds.length) {
      this.platform.log.warn('Room clean requested with no areas selected; ignoring.');
      return;
    }

    const roomIds = areaIds.map(id => Number(id)).join(',');
    const cleanMode = CLEAN_MODES.find(m => m.mode === this.lastCleanModeIndex) ?? CLEAN_MODES[1];

    this.platform.log.info(`Matter: Start room clean for area(s) ${roomIds} with mode: ${cleanMode.label}`);

    // Set suction and water level first
    await this.client.setProperty(SWEEP_SIID, SUCTION_PIID, cleanMode.suction);
    if (cleanMode.waterLevel > 0) {
      await this.client.setProperty(SWEEP_SIID, WATER_LEVEL_PIID, cleanMode.waterLevel);
    }

    // Set sweep mode based on clean mode
    let sweepMode = 0; // Vacuum only
    if (cleanMode.startAiid === START_VACUUM_MOP_AIID) sweepMode = 1; // Vacuum + Mop
    if (cleanMode.startAiid === START_MOP_AIID) sweepMode = 2; // Mop only
    await this.client.setProperty(STATUS_SIID, SWEEP_MODE_PIID, sweepMode);

    await this.client.doAction(SWEEP_SIID, ROOM_CLEAN_AIID, [
      { piid: ROOM_IDS_PIID, value: roomIds },
      { piid: ROOM_MODE_PIID, value: 0 }, // 0 = Global
      { piid: ROOM_OPER_PIID, value: 1 }, // 1 = Start
    ]);
    await this.setOptimisticRunState(1, 1);

    // Set selectedAreas but leave currentArea null — Home app shows "navigating to area"
    // currentArea will be updated to areaIds[0] once cleaning starts (in updateStatus)
    const matter = this.platform.api.matter!;
    await this.updateClusterState(matter.clusterNames.ServiceArea, {
      currentArea: null,
      selectedAreas: areaIds,
    }, true);
    this.lastRoomCleanAreas = areaIds;

    this.scheduleStatusUpdate();
  }

  private async setOptimisticRunState(operationalState: number, currentMode: number) {
    const matter = this.platform.api.matter!;
    await this.updateClusterState(matter.clusterNames.RvcOperationalState, { operationalState }, true);
    await this.updateClusterState(matter.clusterNames.RvcRunMode, { currentMode }, true);
  }

  private async updateClusterState(clusterName: string, payload: Record<string, any>, force = false) {
    const cacheKey = `${this.accessory.UUID}:${clusterName}`;
    const serialized = JSON.stringify(payload);

    if (!force && this.lastClusterState.get(cacheKey) === serialized) {
      return;
    }

    const matter = this.platform.api.matter!;
    await this.withTimeout(
      matter.updateAccessoryState(this.accessory.UUID, clusterName, payload),
      this.matterUpdateTimeoutMs,
      `Matter state update for ${clusterName}`,
    );
    this.lastClusterState.set(cacheKey, serialized);
  }

  private async withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
    let timeout: NodeJS.Timeout | undefined;

    try {
      return await Promise.race([
        promise,
        new Promise<T>((_, reject) => {
          timeout = setTimeout(
            () => reject(new Error(`${label} timed out after ${timeoutMs}ms`)),
            timeoutMs,
          );
        }),
      ]);
    } finally {
      if (timeout) clearTimeout(timeout);
    }
  }

  async updateStatus(force = false, includeConsumables = true) {
    const now = Date.now();
    if (this.isUpdating) {
      const updateAge = now - this.updateStartedAt;
      if (updateAge > this.statusUpdateWatchdogMs) {
        this.platform.log.warn(`Previous status update has been running for ${Math.round(updateAge / 1000)} seconds; allowing a fresh poll.`);
        this.isUpdating = false;
      } else {
        this.platform.log.debug('Skipping status update because a previous update is still running');
        return;
      }
    }
    if (!force && now < this.nextAllowedUpdate) {
      this.platform.log.debug('Skipping status update during temporary backoff');
      return;
    }

    this.isUpdating = true;
    this.updateStartedAt = now;
    const token = ++this.updateToken;
    try {
      const props = await this.client.getProperties([
        { siid: STATUS_SIID, piid: STATUS_PIID },
        { siid: STATUS_SIID, piid: DOCK_FLAG_PIID },
        { siid: STATUS_SIID, piid: SWEEP_MODE_PIID },
        { siid: BATTERY_SIID, piid: BATTERY_PIID },
        { siid: SWEEP_SIID, piid: SUCTION_PIID },
        ...(includeConsumables ? CONSUMABLES.map(item => ({ siid: item.siid, piid: item.lifePiid })) : []),
      ]);

      if (!props || props.length === 0) return;

      const status = props.find((p: any) => p.siid === STATUS_SIID && p.piid === STATUS_PIID)?.value;
      const dockFlag = props.find((p: any) => p.siid === STATUS_SIID && p.piid === DOCK_FLAG_PIID)?.value;
      const sweepMode = props.find((p: any) => p.siid === STATUS_SIID && p.piid === SWEEP_MODE_PIID)?.value;
      const battery = props.find((p: any) => p.siid === BATTERY_SIID && p.piid === BATTERY_PIID)?.value;
      const suctionMode = props.find((p: any) => p.siid === SWEEP_SIID && p.piid === SUCTION_PIID)?.value;
      const consumables = CONSUMABLES.map(item => ({
        ...item,
        life: props.find((p: any) => p.siid === item.siid && p.piid === item.lifePiid)?.value,
      }));

      // dockFlag values confirmed empirically:
      // 2103, 2104 = docked/charging
      // 2108 = repositioning (localising on map, just left dock)
      // 2110 = leaving dock
      // 0 = away from dock (cleaning/navigating)
      const DOCK_FLAGS_DOCKED = new Set([2103, 2104]);
      const isDocked = status === 4 || (status === 5 && dockFlag !== undefined && DOCK_FLAGS_DOCKED.has(dockFlag));
      const isCleaning = (status === 5 && !isDocked) || status === 6 || status === 7;
      const isStandby = status === 1;

      // Debug level: with the 5s external-state poll this would flood the log at info.
      this.platform.log.debug(`Vacuum status: ${describeStatus(status, dockFlag)}`);
      if (includeConsumables) {
        this.logConsumables(consumables);
      }
      this.consecutiveFailures = 0;
      this.nextAllowedUpdate = 0;

      // Matter RVC OperationalState: 0 Stopped, 1 Running, 2 Paused, 3 Error,
      //   64 SeekingCharger, 65 Charging, 66 Docked
      let opState = 0; // Stopped
      if (isCleaning) opState = 1;        // Running
      else if (status === 2) opState = 2; // Paused
      else if (status === 3) opState = 64; // SeekingCharger
      else if (isDocked) opState = battery === 100 ? 66 : 65; // Docked or Charging
      else if (isStandby) opState = 0;    // Stopped

      const matter = this.platform.api.matter!;
      await this.updateClusterState(matter.clusterNames.RvcOperationalState, {
        operationalState: opState,
      }, force);

      // Map to RvcRunMode
      await this.updateClusterState(matter.clusterNames.RvcRunMode, {
        currentMode: isCleaning ? 1 : 0,
      }, force);

      // Update ServiceArea currentArea when cleaning room(s)
      if (this.lastRoomCleanAreas.length > 0) {
        if (isCleaning) {
          await this.updateClusterState(matter.clusterNames.ServiceArea, {
            currentArea: this.lastRoomCleanAreas[0],
            selectedAreas: this.lastRoomCleanAreas,
          }, false);
        } else if (isDocked || isStandby) {
          // Reset when done
          await this.updateClusterState(matter.clusterNames.ServiceArea, {
            currentArea: null,
            selectedAreas: [],
          }, false);
          this.lastRoomCleanAreas = [];
        }
      }

      // Map suction back to clean mode
      if (suctionMode !== undefined) {
        // On first poll (force=true), sync lastCleanModeIndex from device suction + sweep_mode
        if (force && !this.initialSyncDone) {
          this.initialSyncDone = true;
          // sweepMode: 0=Vacuum, 1=Vacuum+Mop, 2=Mop only
          const expectedAiid = sweepMode === 1 ? START_VACUUM_MOP_AIID : sweepMode === 2 ? START_MOP_AIID : START_VACUUM_AIID;
          const matchedMode = CLEAN_MODES.find(m => m.suction === suctionMode && m.startAiid === expectedAiid);
          if (matchedMode && matchedMode.mode !== this.lastCleanModeIndex) {
            this.lastCleanModeIndex = matchedMode.mode;
            this.platform.log.info(`Synced clean mode from device: ${matchedMode.label}`);
          }
        }
        await this.updateClusterState(matter.clusterNames.RvcCleanMode, {
          currentMode: this.lastCleanModeIndex,
        }, force);
      }

      // Battery (PowerSource cluster)
      if (battery !== undefined) {
        // Matter batPercentRemaining is 0-200 (0.5% steps)
        let chargeState = 0; // Unknown
        if (isDocked) {
          chargeState = battery === 100 ? 2 : 1; // IsAtFullCharge or IsCharging
        } else if (isCleaning || isStandby || status === 2 || status === 3) {
          chargeState = 3; // IsNotCharging
        }

        // batChargeLevel: 0=OK, 1=Warning, 2=Critical
        const batChargeLevel = battery > 20 ? 0 : battery > 10 ? 1 : 2;

        // batPercentRemaining is a "quiet" Matter attribute (minimumEmitInterval 10s) —
        // it only gets reported to subscribers when a NON-quiet attribute changes in the
        // same update. batChargeState is non-quiet, so we send it together every time to
        // force batPercentRemaining to be emitted. We toggle batChargeState via a real value.
        await this.updateClusterState(matter.clusterNames.PowerSource, {
          batPercentRemaining: battery * 2,
          batChargeLevel,
          batChargeState: chargeState,
        }, true);
      }

    } catch (e: any) {
      this.consecutiveFailures++;
      const baseInterval = Math.min(this.pollIntervalMs, EXTERNAL_STATE_POLL_INTERVAL_MS);
      const backoff = Math.min(baseInterval * 2 ** this.consecutiveFailures, 5 * 60 * 1000);
      this.nextAllowedUpdate = Date.now() + backoff;
      this.platform.log.error('Error updating status:', e.message);
      this.platform.log.warn(`Backing off vacuum polling for ${Math.round(backoff / 1000)} seconds`);
    } finally {
      if (token === this.updateToken) {
        this.isUpdating = false;
        this.updateStartedAt = 0;
      }
    }
  }

  private logConsumables(consumables: Array<{ label: string; life: any }>) {
    if (this.platform.config.enableConsumableLogs === false) {
      return;
    }

    const summary = consumables
      .filter(item => item.life !== undefined)
      .map(item => `${item.label}: ${item.life}%`)
      .join(', ');

    if (!summary || summary === this.lastConsumableSummary) {
      return;
    }

    this.lastConsumableSummary = summary;
    this.platform.log.info(`Vacuum consumables: ${summary}`);

    const lowThreshold = Number(this.platform.config.lowConsumableThreshold ?? 20);
    for (const item of consumables) {
      if (typeof item.life === 'number' && item.life <= lowThreshold) {
        this.platform.log.warn(`${item.label} life is low: ${item.life}% remaining`);
      }
    }
  }
}
