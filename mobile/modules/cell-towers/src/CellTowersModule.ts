import { requireOptionalNativeModule } from 'expo';

/** One tower the phone can hear. lac is the tac on LTE and 5G. */
export type Cell = {
  radio: 'gsm' | 'wcdma' | 'lte' | 'nr';
  mcc: number;
  mnc: number;
  lac: number;
  cid: number;
  dbm: number;
  serving: boolean;
};

type CellTowersModule = { getCells(): Promise<Cell[]> };

// Optional, because Expo Go and iPhones don't have it: Expo Go only carries its own native modules,
// and iOS doesn't let apps read towers. The app then uses network location instead.
export default requireOptionalNativeModule<CellTowersModule>('CellTowers');
