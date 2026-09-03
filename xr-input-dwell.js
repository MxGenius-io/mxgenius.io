/** Deliberate-contact gate for XR fingertip controls. */
export class XRInputDwellGate {
  constructor({ dwellMs = 180 } = {}) {
    this.dwellMs = Math.min(1_000, Math.max(100, Math.trunc(Number(dwellMs) || 180)));
    this.contacts = new Map();
  }

  update(inputId, target, timeMs) {
    const key = String(inputId);
    const now = Number.isFinite(Number(timeMs)) ? Number(timeMs) : 0;
    if (!target) {
      this.contacts.delete(key);
      return false;
    }
    const previous = this.contacts.get(key);
    if (!previous || previous.target !== target || now < previous.enteredAt) {
      this.contacts.set(key, { target, enteredAt: now, fired: false });
      return false;
    }
    if (previous.fired || now - previous.enteredAt < this.dwellMs) return false;
    previous.fired = true;
    return true;
  }

  clear(inputId) {
    if (inputId === undefined) this.contacts.clear();
    else this.contacts.delete(String(inputId));
  }
}
