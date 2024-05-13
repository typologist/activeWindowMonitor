import sinon from 'sinon';
import { random } from 'faker';
import { describe, it, before } from 'mocha';
import { ActiveWindowMonitor } from './ActiveWindowMonitor';
import { ActiveWindow, ActiveWindowEvent, ActiveWinResult } from './ActiveWindow';

const { spy, assert, useFakeTimers } = sinon;

// Extend the SinonFakeTimers type to reflect the library.
interface SinonFakeTimers extends sinon.SinonFakeTimers {
  tickAsync: any;
}

// Mocks.
class MouseCheckerMock {
  listeners = {
    mousemove: null,
  };

  on(event: string, listener: (...args: any[]) => void): this {
    this.listeners[event] = listener;
    return this;
  }

  emit(event: any, ...args: any[]): boolean {
    this.listeners[event](args);
    return true;
  }

  start() {}
  stop() {}

  removeAllListeners() {
    this.listeners = {} as any;
  }
}

class ActiveWinMock {
  currentWindow = { id: -1, url: '' };

  constructor() {
    this.changeWindow();
  }

  /**
   * Fakes the activeWin main function. Don't change the name.
   */
  activeWin = () => {
    return Promise.resolve(this.currentWindow as ActiveWinResult);
  };

  /**
   * Changes the current active window. A "null" value can be
   * passed to simulate the activeWin value when no window is active.
   */
  changeWindow(newWin?: Pick<ActiveWindow, 'id' | 'url' | 'owner'> | null) {
    let mockWin;

    if (typeof newWin !== 'undefined') {
      mockWin = newWin;
    } else {
      const id = random.number();
      mockWin = Object.assign(new ActiveWindow(), { id, url: `window ${id}` });
    }
    this.currentWindow = mockWin;
    return this.currentWindow;
  }
}

// Setup.
const awMock = new ActiveWinMock();
const { activeWin } = awMock;
const mouseChecker = new MouseCheckerMock() as any;

const CHECK_MS = 100;
const IDLE_MS = 1000;

// Helpers.
function startWithEventSpy(event: ActiveWindowEvent) {
  const awm = new ActiveWindowMonitor({ mouseChecker, activeWin }, CHECK_MS, IDLE_MS);
  const callback = spy();
  awm.on(event, callback);
  awm.start();
  return { awm, callback };
}

// Tests.
describe('ActiveWindowMonitor', function () {
  let clock: SinonFakeTimers;

  before(function () {
    clock = useFakeTimers() as SinonFakeTimers;
  });

  describe('"stop" method', function () {
    it('should stop the service and resume emitting when "start" is called again', async function () {
      const awm = new ActiveWindowMonitor({ mouseChecker, activeWin }, CHECK_MS, IDLE_MS);
      const callback = spy();
      awm.on('check', callback);

      awm.start();

      await clock.tickAsync(CHECK_MS - 1);
      assert.calledOnce(callback);

      // Stop and wait.
      awm.stop();
      mouseChecker.emit('mousemove');
      await clock.tickAsync(CHECK_MS * 3);
      assert.calledOnce(callback);

      // Restart it, and ensure it's being called again.
      awm.start();

      await clock.tickAsync(CHECK_MS * 3 - 1);
      assert.callCount(callback, 4);
    });

    it('should not emit any event when stopped', async function () {
      const awm = new ActiveWindowMonitor({ mouseChecker, activeWin }, CHECK_MS, IDLE_MS);
      const callback = spy();
      awm.on('windowchange', callback);
      awm.on('windoworurlchange', callback);
      awm.on('idle', callback);

      awm.start();
      mouseChecker.emit('mousemove');
      await clock.tickAsync(IDLE_MS);
      assert.calledThrice(callback);

      awm.stop();
      mouseChecker.emit('mousemove');
      await clock.tickAsync(IDLE_MS);
      assert.calledThrice(callback);
    });
  });

  describe('"check" event', function () {
    it('should invoke the "check" callback every x milliseconds', async function () {
      const awm = new ActiveWindowMonitor({ mouseChecker, activeWin }, CHECK_MS, IDLE_MS);
      const callback = spy();
      awm.on('check', callback);

      assert.notCalled(callback);

      awm.start();

      await clock.tickAsync(CHECK_MS * 3 - 1);
      assert.calledThrice(callback);
    });

    it('should keep on invoking "check" even if goes idle.', async function () {
      const { callback, awm } = startWithEventSpy('check');
      const idleCallback = spy();
      awm.on('idle', idleCallback);

      mouseChecker.emit('mousemove');

      await clock.tickAsync(IDLE_MS);
      assert.calledOnce(idleCallback);

      // We're iddle at this point, but should still get checks.
      // Reset the spy calls, so we can count more easily.
      callback.resetHistory();
      await clock.tickAsync(CHECK_MS * 3);
      assert.calledThrice(callback);
    });
  });

  describe('"idle" event', function () {
    it('should invoke "idle" callback once the user hasn\'t moved for x milliseconds', async function () {
      const { callback } = startWithEventSpy('idle');

      mouseChecker.emit('mousemove');

      await clock.tickAsync(IDLE_MS);
      assert.calledOnce(callback);

      // Still called only once.
      await clock.tickAsync(IDLE_MS * 2);
      assert.calledOnce(callback);
    });

    it('should not invoke "idle" callback until the defined idle time is reached.', async function () {
      const { callback } = startWithEventSpy('idle');

      mouseChecker.emit('mousemove');

      // Don't call it before the user is idle.
      await clock.tickAsync(IDLE_MS - 1);
      assert.notCalled(callback);
    });
  });

  describe('"windowchange" event', function () {
    it('should invoke callback if the user has moved', async function () {
      const { callback } = startWithEventSpy('windowchange');

      // Move the user.
      mouseChecker.emit('mousemove');

      // Since the window hasn't changed, we only expect one emission even after a long wait.
      await clock.tickAsync(CHECK_MS * 3);
      assert.calledOnce(callback);
    });

    it("should not invoke callback if the user hasn't moved yet", async function () {
      const { callback } = startWithEventSpy('windowchange');

      // A non user-initiated change of window shouldn't still do anything either. Becase the
      // active window could've been changed automatically, for example, when restarting the OS.
      awMock.changeWindow();

      await clock.tickAsync();
      assert.notCalled(callback);
    });

    it('should pass the new active window object when it changes.', async function () {
      const { callback } = startWithEventSpy('windowchange');

      const window1 = awMock.currentWindow;
      mouseChecker.emit('mousemove');

      await clock.tickAsync();
      assert.calledOnce(callback);
      assert.calledWith(callback, sinon.match(window1));

      // Change to window 2.
      const window2 = awMock.changeWindow();
      mouseChecker.emit('mousemove');

      await clock.tickAsync(CHECK_MS);
      assert.calledTwice(callback);
      assert.calledWith(callback, sinon.match(window2));
    });

    it('should not pass the same active window object again', async function () {
      const { callback } = startWithEventSpy('windowchange');

      mouseChecker.emit('mousemove');

      await clock.tickAsync();
      assert.calledWithExactly(callback, awMock.currentWindow);

      // Move again should cause no more emissions.
      mouseChecker.emit('mousemove');
      await clock.tickAsync(CHECK_MS * 2);
      assert.calledOnce(callback);
    });

    it('should resume passing the active window if the user moves after being idle', async function () {
      const { callback, awm } = startWithEventSpy('windowchange');
      const idleCallback = spy();
      const window1 = awMock.currentWindow;
      awm.on('idle', idleCallback);

      mouseChecker.emit('mousemove');

      await clock.tickAsync(IDLE_MS);
      assert.calledOnceWithExactly(callback, sinon.match(window1));

      // Move after being idle.
      mouseChecker.emit('mousemove');

      // Go back to the same window.
      // We should emit again even if it's the same window. Otherwise, there's
      // no way to resume detecting activity if the user goes back to the same one.
      await clock.tickAsync(CHECK_MS);
      assert.calledTwice(callback);

      await clock.tickAsync(IDLE_MS);

      // Go back to another window.
      const window2 = awMock.changeWindow();
      mouseChecker.emit('mousemove');

      await clock.tickAsync(CHECK_MS);
      assert.calledWith(callback, sinon.match(window2));
    });

    it('should resume passing the active window after "stop" and "start" method again.', async function () {
      const { callback, awm } = startWithEventSpy('windowchange');
      const window1 = awMock.currentWindow;

      mouseChecker.emit('mousemove');
      await clock.tickAsync(CHECK_MS);
      assert.calledOnce(callback);

      awm.stop();

      // No new calls, still one.
      mouseChecker.emit('mousemove');
      await clock.tickAsync(CHECK_MS);
      assert.calledOnce(callback);

      // Restart on the same window.
      awm.start();
      mouseChecker.emit('mousemove');

      await clock.tickAsync(CHECK_MS);
      assert.calledTwice(callback);
      assert.alwaysCalledWith(callback, sinon.match(window1));

      // Restart on another window.
      const window2 = awMock.changeWindow();

      awm.stop();
      await clock.tickAsync(CHECK_MS);

      awm.start();
      mouseChecker.emit('mousemove');

      await clock.tickAsync(CHECK_MS);
      assert.calledThrice(callback);
      assert.calledWith(callback, sinon.match(window2));
    });

    it('should resume passing the active window after an error', async function () {
      // When the library finds a window that doesn't recognize, we might have an exception
      // which rejects the promise. We should continue the proccess as soon as the user changes
      // to an active window with no error.
      const activeWinWithError = () => Promise.reject();
      const awm = new ActiveWindowMonitor(
        { mouseChecker, activeWin: activeWinWithError },
        CHECK_MS,
        IDLE_MS
      );

      const errorCallback = spy();
      const windoChangeCallback = spy();
      awm.on('error', errorCallback);
      awm.on('windowchange', windoChangeCallback);
      awm.start();

      mouseChecker.emit('mousemove');

      await clock.tickAsync();
      assert.called(errorCallback);

      // Change the window to a non-error causing one.
      awm.services.activeWin = activeWin; // restore the mock method.
      const window2 = awMock.changeWindow();
      mouseChecker.emit('mousemove');

      await clock.tickAsync(CHECK_MS);
      assert.calledWith(windoChangeCallback, sinon.match(window2));
    });
  });

  describe('"windoworurlchange" event', function () {
    it('should invoke callback if the url changes, even on the same window', async function () {
      const { callback } = startWithEventSpy('windoworurlchange');

      const window1 = awMock.currentWindow;
      mouseChecker.emit('mousemove');

      await clock.tickAsync();
      assert.calledOnce(callback);
      assert.calledWith(callback, sinon.match(window1));

      // Change just the url.
      awMock.currentWindow.url = `${awMock.currentWindow.url}-changed`;
      const window1Changed = awMock.currentWindow;
      mouseChecker.emit('mousemove');

      await clock.tickAsync(CHECK_MS);
      assert.calledTwice(callback);
      assert.calledWith(callback, sinon.match(window1Changed));
    });

    it('should invoke callback if the window changes, even to another one with same url', async function () {
      const { callback } = startWithEventSpy('windoworurlchange');

      mouseChecker.emit('mousemove');

      await clock.tickAsync();
      assert.calledOnce(callback);

      awMock.currentWindow.id += 1;
      const window2 = awMock.currentWindow;
      mouseChecker.emit('mousemove');

      await clock.tickAsync(CHECK_MS);
      assert.calledTwice(callback);
      assert.calledWith(callback, sinon.match(window2));
    });
  });

  describe('"error" event', function () {
    it('invoke callback after an error', async function () {
      const error = 'activeWin library error';
      const activeWinWithError = () => Promise.reject(error);
      const awm = new ActiveWindowMonitor(
        { mouseChecker, activeWin: activeWinWithError },
        CHECK_MS,
        IDLE_MS
      );
      const callback = spy();
      awm.on('error', callback);
      awm.start();

      mouseChecker.emit('mousemove');

      await clock.tickAsync();
      assert.calledWithExactly(callback, error);

      // If the error is still the same (for example, if the user keeps the
      // failing window as active) we don't keep on emitting it again.
      mouseChecker.emit('mousemove');

      await clock.tickAsync();
      assert.calledOnce(callback);

      // If the error changes to something different. We emit it again.
      const error2 = 'activeWin library error';
      awm.services.activeWin = () => Promise.reject(error2);
      mouseChecker.emit('mousemove');

      await clock.tickAsync(CHECK_MS);
      assert.calledWith(callback, error2);
    });
  });

  describe('"windowinactive" event', function () {
    it('should invoke callback if the active window is not recognized', async function () {
      // Set the current window to none, so this event gets emitted
      // instead of "windowchange".
      awMock.changeWindow(null);
      const { callback, awm } = startWithEventSpy('windowinactive');

      mouseChecker.emit('mousemove');

      await clock.tickAsync();
      assert.calledWith(callback, 'Active window not detected.');

      // Make sure once valid, we keep on emitting.
      const windowChangeCallback = spy();
      awm.on('windowchange', windowChangeCallback);
      const window2 = awMock.changeWindow();
      mouseChecker.emit('mousemove');

      await clock.tickAsync(CHECK_MS);
      assert.calledWith(windowChangeCallback, sinon.match(window2));
    });
  });
});
