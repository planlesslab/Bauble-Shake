// Shake detection from the phone's accelerometer.
//
// A "shake" is a sharp change in acceleration between two sensor samples.
// Stronger jolts can knock off two ornaments at once.

export const SHAKE = {
  threshold: 14,   // m/s² change between samples that counts as a shake
  strong: 32,      // change that counts as a big shake (2 ornaments)
  cooldownMs: 110, // minimum gap between shakes
};

export class ShakeDetector {
  constructor(onShake) {
    this.onShake = onShake;
    this.prev = null;
    this.lastShake = 0;
    this.listening = false;
    this.sawData = false;
    this.handle = this.handle.bind(this);
  }

  /** Must be called from a tap (iOS needs a user gesture). */
  async requestPermission() {
    if (typeof DeviceMotionEvent === "undefined") return "unsupported";
    if (typeof DeviceMotionEvent.requestPermission === "function") {
      try {
        const res = await DeviceMotionEvent.requestPermission();
        return res === "granted" ? "granted" : "denied";
      } catch {
        return "denied";
      }
    }
    return "granted";
  }

  start() {
    if (this.listening) return;
    window.addEventListener("devicemotion", this.handle);
    this.listening = true;
  }

  stop() {
    window.removeEventListener("devicemotion", this.handle);
    this.listening = false;
    this.prev = null;
  }

  /** Resolves true if real sensor data arrives within `ms`. */
  waitForSensor(ms = 1500) {
    if (this.sawData) return Promise.resolve(true);
    return new Promise((resolve) => {
      const t0 = Date.now();
      const tick = () => {
        if (this.sawData) return resolve(true);
        if (Date.now() - t0 > ms) return resolve(false);
        setTimeout(tick, 100);
      };
      tick();
    });
  }

  handle(e) {
    const a = e.accelerationIncludingGravity || e.acceleration;
    if (!a || a.x == null) return;
    this.sawData = true;
    const cur = { x: a.x, y: a.y, z: a.z || 0 };
    if (this.prev) {
      const dx = cur.x - this.prev.x;
      const dy = cur.y - this.prev.y;
      const dz = cur.z - this.prev.z;
      const delta = Math.sqrt(dx * dx + dy * dy + dz * dz);
      const now = performance.now();
      if (delta > SHAKE.threshold && now - this.lastShake > SHAKE.cooldownMs) {
        this.lastShake = now;
        const power = delta > SHAKE.strong ? 2 : 1;
        this.onShake(power, dx < 0 ? -1 : 1);
      }
    }
    this.prev = cur;
  }
}
