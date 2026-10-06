import { API } from 'homebridge';
import { XiaomiS12VacuumPlatform } from './platform.js';

export default (api: API) => {
  api.registerPlatform('homebridge-xiaomi-s12-vacuum', 'XiaomiS12Vacuum', XiaomiS12VacuumPlatform);
};
