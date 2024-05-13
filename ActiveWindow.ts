import EventEmitter from 'events';
import activeWin, {
  BaseOwner,
  BaseResult,
  MacOSResult,
  LinuxResult,
  Options,
  WindowsResult,
} from 'active-win';

export class ActiveApp implements BaseOwner {
  name: string;
  processId: number;
  path: string;
}

export class ActiveWindow implements BaseResult {
  title: string;
  id: number;
  bounds: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  owner: ActiveApp;
  memoryUsage: number;
  url?: string;
  platform: string;

  isMac(): boolean {
    return !!this.url;
  }
}

export type ActiveWindowServices = {
  mouseChecker: EventEmitter & { start; stop };
  activeWin: (options: Options | undefined) => Promise<activeWin.Result | undefined>;
};

export type ActiveWindowEvent =
  | 'windowchange' // A new window was set as active.
  | 'windoworurlchange' // The window url (or the window) has changed.
  | 'windowinactive' // No active window was detected.
  | 'check' // Every time a check for a new active window is made.
  | 'idle' // No user activity detected for x time.
  | 'awake' // User initiated activity after being idle.
  | 'error' // Something went wrong.
  | 'start'
  | 'stop';

export type ActiveWinResult = MacOSResult | LinuxResult | WindowsResult | undefined;
