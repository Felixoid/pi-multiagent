/** Keep timer-driven async tests alive while preserving production unref behavior. */

const probe = setTimeout(() => {}, 0);
const Timeout = probe.constructor;
clearTimeout(probe);

const originalUnref = Timeout.prototype.unref;

Timeout.prototype.unref = function patchedUnref() {
	const delay = Number(this._idleTimeout);
	if (Number.isFinite(delay) && delay > 0 && delay <= 2000) return this;
	return originalUnref.call(this);
};
