import { screen } from 'electron';
import { EventEmitter } from 'events';

export default class MouseChecker extends EventEmitter {
  private lastMousePos?: Electron.Point;
  private mousePositionInterval: NodeJS.Timeout | null;

  start() {
    this.mousePositionInterval = setInterval(() => {
      const mousePos = screen.getCursorScreenPoint();

      if (
        !this.lastMousePos ||
        (mousePos.x !== this.lastMousePos.x && mousePos.y !== this.lastMousePos.y)
      ) {
        this.emit('mousemove');
        this.lastMousePos = mousePos;
      }
    }, 2000);
  }

  stop() {
    if (this.mousePositionInterval) {
      clearInterval(this.mousePositionInterval);
      this.mousePositionInterval = null;
    }
  }
}
