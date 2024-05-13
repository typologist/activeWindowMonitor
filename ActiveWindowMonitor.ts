import stringify from 'json-stringify-safe';
import { EventEmitter } from 'events';
import { ActiveWindow, ActiveWindowEvent, ActiveWindowServices } from './ActiveWindow';

export interface ActiveWindowMonitor {
  on(event: ActiveWindowEvent, listener: (...args: any[]) => void): this;
  on(event: 'windowchange', listener: (win: ActiveWindow) => void): this;
  on(event: 'windoworurlchange', listener: (win: ActiveWindow) => void): this;
  emit(event: ActiveWindowEvent, ...args: any[]): boolean;
}

/**
 * An EventEmitter implementation to monitor the OS active window
 * and emit various events when its status changes.
 */
export class ActiveWindowMonitor extends EventEmitter implements ActiveWindowMonitor {
  static START = 'start';
  static STOP = 'stop';
  static IDLE_AFTER_MS = 1000 * 60 * 5; // 5 min

  /**
   * How often to check to see if the active window has changed.
   */
  readonly checkInterval: number;

  /**
   * How many milliseconds before considering the user as idle.
   */
  readonly idleAfter: number;

  private currentState: string;
  private lastWindow: ActiveWindow;
  private isUserAwake: boolean | null;
  private checkTimeout: NodeJS.Timeout;
  private idleTimeout: NodeJS.Timeout;
  private lastError = {};
  private services: ActiveWindowServices;

  constructor(
    services: ActiveWindowServices,
    checkInterval = 3000,
    idleAfter = ActiveWindowMonitor.IDLE_AFTER_MS
  ) {
    super();
    this.services = services;
    this.checkInterval = checkInterval;
    this.idleAfter = idleAfter;
    this.services.mouseChecker.on('mousemove', this.awakeUser);
  }

  start = () => {
    this.setDefaults();
    this.services.mouseChecker.start();
    this.run();

    this.emit('start');
  };

  stop = () => {
    this.currentState = ActiveWindowMonitor.STOP;
    clearTimeout(this.checkTimeout);
    clearTimeout(this.idleTimeout);

    if (this.services.mouseChecker) {
      this.services.mouseChecker.stop();
    }
    this.emit('stop');
  };

  destroy() {
    this.services.mouseChecker.removeAllListeners();
    this.removeAllListeners();
  }

  private awakeUser = () => {
    if (!this.isUserAwake) {
      // User is waking up after being idle.
      if (this.isUserAwake === false) {
        this.emit('awake');
      }

      this.isUserAwake = true;
      clearTimeout(this.idleTimeout);
      this.idleTimeout = setTimeout(this.idleUser, this.idleAfter);
    }
  };

  private idleUser = async () => {
    this.isUserAwake = false;
    this.resetLastWindow();

    if (this.currentState === ActiveWindowMonitor.START) {
      this.emit('idle');
    }
  };

  private run = async () => {
    if (this.currentState !== ActiveWindowMonitor.START) {
      return;
    }

    this.once('check', () => {
      this.checkTimeout = setTimeout(this.run, this.checkInterval);
    });

    try {
      this.check();
    } catch (error) {
      console.warn('Failed to check active window.', error);
    }
  };

  private async check(): Promise<void> {
    try {
      const activeWinOptions = {
        // If this option is true, the window title can be captured. However, it would
        // also prompt macOS 10.15> to enable the "Screen recording permission".
        screenRecordingPermission: false,
      };
      const activeWinResult = await this.services.activeWin(activeWinOptions);

      this.emit('check');

      if (!this.isUserAwake) return;
      this.isUserAwake = null;

      // No window active. For example, when clicking on the desktop.
      if (!activeWinResult) {
        this.resetLastWindow();
        this.emit('windowinactive', 'Active window not detected.');
        return;
      }

      // We have a window.
      const activeWindow = Object.assign(new ActiveWindow(), activeWinResult);

      if (this.activeWindowOrUrlChanged(activeWindow)) {
        this.emit('windoworurlchange', activeWindow);

        if (this.activeWindowChanged(activeWindow)) {
          this.emit('windowchange', activeWindow);
        }

        this.lastWindow = activeWindow;
      }

      this.lastError = {};
    } catch (error) {
      // Emit a 'check' so the process can continue checking so if the user
      // changes to another non-failing window it works as usual.
      this.setDefaults();
      this.emit('check');

      // We only emit the first time a error appears (so we don't keep on
      // emitting the same error over and over).
      if (stringify(error) !== stringify(this.lastError)) {
        this.lastError = error;
        this.emit('error', error);
      } else {
        // Nothing here. The second and subsequent times the same error occurs
        // it will be passed and caught outside this method in a .catch()
      }
    }
  }

  private activeWindowChanged(activeWindow: ActiveWindow): boolean {
    return activeWindow.id !== this.lastWindow.id;
  }

  private activeWindowOrUrlChanged(activeWindow: ActiveWindow): boolean {
    const { id, url } = activeWindow;
    const urlChanged = url !== this.lastWindow.url;

    // Still check for the window id, in case of changing between
    // two apps with the same url we still detect the change.
    const windowChanged = id !== this.lastWindow.id;

    return urlChanged || windowChanged;
  }

  private resetLastWindow() {
    this.lastWindow = Object.assign(new ActiveWindow(), {
      id: -1,
      title: '',
      url: undefined,
      owner: { name: '' },
    });
  }

  private setDefaults() {
    this.currentState = ActiveWindowMonitor.START;
    this.isUserAwake = null;
    this.resetLastWindow();
    clearTimeout(this.checkTimeout);
  }
}
