(() => {
  class WitnessMediaHealth {
    constructor({
      stallMs = 4_500,
      recoveryWindowMs = 5_000,
      stableResetMs = 30_000,
      maxRecoveryAttempts = 3,
      now = () => Date.now(),
      schedule = (callback, delay) => setTimeout(callback, delay),
      cancel = (timer) => clearTimeout(timer),
      onState = () => {},
      onRecover = () => {}
    } = {}) {
      this.stallMs = Math.max(500, Number(stallMs) || 4_500);
      this.recoveryWindowMs = Math.max(500, Number(recoveryWindowMs) || 5_000);
      this.stableResetMs = Math.max(this.stallMs, Number(stableResetMs) || 30_000);
      this.maxRecoveryAttempts = Math.max(1, Number(maxRecoveryAttempts) || 3);
      this.now = now;
      this.schedule = schedule;
      this.cancel = cancel;
      this.onState = onState;
      this.onRecover = onRecover;
      this.active = false;
      this.state = 'idle';
      this.reason = '';
      this.hasFrame = false;
      this.lastFrameAt = 0;
      this.liveSinceAt = -1;
      this.recoveryAttempt = 0;
      this.stallTimer = 0;
      this.recoveryTimer = 0;
    }

    start() {
      this.clearTimers();
      this.active = true;
      this.reason = 'waiting-for-first-frame';
      this.hasFrame = false;
      this.lastFrameAt = 0;
      this.liveSinceAt = -1;
      this.setState('waiting');
      this.armStall(this.stallMs);
    }

    frame() {
      if (!this.active) return;
      const frameAt = this.now();
      if (this.state !== 'live' || this.liveSinceAt < 0) this.liveSinceAt = frameAt;
      this.hasFrame = true;
      this.lastFrameAt = frameAt;
      this.reason = '';
      if (frameAt - this.liveSinceAt >= this.stableResetMs) this.recoveryAttempt = 0;
      this.clearRecovery();
      this.setState('live');
      this.armStall(this.stallMs);
    }

    interrupt(reason = 'media-interrupted', { delayMs = 0 } = {}) {
      if (!this.active) return;
      this.reason = String(reason || 'media-interrupted');
      this.liveSinceAt = -1;
      this.clearStall();
      this.setState('recovering');
      this.scheduleRecovery(Math.max(0, Number(delayMs) || 0));
    }

    pause() {
      this.active = false;
      this.clearTimers();
      this.setState('paused');
    }

    stop() {
      this.active = false;
      this.clearTimers();
      this.reason = '';
      this.hasFrame = false;
      this.lastFrameAt = 0;
      this.liveSinceAt = -1;
      this.recoveryAttempt = 0;
      this.setState('idle');
    }

    status() {
      return {
        active: this.active,
        state: this.state,
        reason: this.reason,
        hasFrame: this.hasFrame,
        lastFrameAt: this.lastFrameAt,
        recoveryAttempt: this.recoveryAttempt
      };
    }

    clearStall() {
      if (this.stallTimer) this.cancel(this.stallTimer);
      this.stallTimer = 0;
    }

    clearRecovery() {
      if (this.recoveryTimer) this.cancel(this.recoveryTimer);
      this.recoveryTimer = 0;
    }

    clearTimers() {
      this.clearStall();
      this.clearRecovery();
    }

    armStall(delay) {
      this.clearStall();
      if (!this.active) return;
      this.stallTimer = this.schedule(() => {
        this.stallTimer = 0;
        if (!this.active) return;
        const elapsed = this.hasFrame ? this.now() - this.lastFrameAt : this.stallMs;
        if (this.hasFrame && elapsed < this.stallMs) {
          this.armStall(this.stallMs - elapsed);
          return;
        }
        this.interrupt(this.hasFrame ? 'frame-stalled' : 'first-frame-timeout');
      }, Math.max(0, delay));
    }

    scheduleRecovery(delay) {
      this.clearRecovery();
      if (!this.active || this.state === 'live') return;
      if (this.recoveryAttempt >= this.maxRecoveryAttempts) {
        this.setState('unavailable');
        return;
      }
      this.recoveryTimer = this.schedule(() => {
        this.recoveryTimer = 0;
        if (!this.active || this.state === 'live') return;
        this.recoveryAttempt += 1;
        this.setState('recovering', true);
        try {
          this.onRecover({
            attempt: this.recoveryAttempt,
            reason: this.reason,
            maxAttempts: this.maxRecoveryAttempts
          });
        } catch (_) {
          // The bounded timer owns retry policy; a callback failure cannot start a loop.
        }
        if (!this.active || this.state === 'live') return;
        this.recoveryTimer = this.schedule(() => {
          this.recoveryTimer = 0;
          if (!this.active || this.state === 'live') return;
          this.scheduleRecovery(0);
        }, this.recoveryWindowMs);
      }, delay);
    }

    setState(state, force = false) {
      if (!force && this.state === state) return;
      this.state = state;
      this.onState(this.status());
    }
  }

  globalThis.MXWitnessMediaHealth = WitnessMediaHealth;
})();
