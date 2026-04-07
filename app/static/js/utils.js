export function today() {
  return toISODate(new Date());
}

export function toISODate(d) {
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function formatDate(isoStr, opts = {}) {
  return new Date(isoStr + 'T00:00:00').toLocaleDateString('en-US', {
    weekday: 'short', month: 'short', day: 'numeric', ...opts,
  });
}

export function formatDateLong(isoStr) {
  return new Date(isoStr + 'T00:00:00').toLocaleDateString('en-US', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
  });
}

/** Returns the Mon–Sun dates for a given week offset (0 = current week). */
export function getWeekDates(weekOffset = 0) {
  const now = new Date();
  const day = now.getDay(); // 0=Sun
  const diffToMon = day === 0 ? -6 : 1 - day;
  const monday = new Date(now);
  monday.setDate(now.getDate() + diffToMon + weekOffset * 7);
  monday.setHours(0, 0, 0, 0);

  const dates = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(monday);
    d.setDate(monday.getDate() + i);
    return toISODate(d);
  });
  return { start: dates[0], end: dates[6], dates };
}

export function fmt(n, decimals = 0) {
  if (n == null) return '—';
  return Number(n).toFixed(decimals);
}

export function toast(message, type = 'success') {
  const id = 'toast-' + Date.now();
  document.getElementById('toast-container').insertAdjacentHTML('beforeend', `
    <div id="${id}" class="toast align-items-center text-bg-${type} border-0" role="alert">
      <div class="d-flex">
        <div class="toast-body fw-medium">${message}</div>
        <button type="button" class="btn-close btn-close-white me-2 m-auto"
                data-bs-dismiss="toast"></button>
      </div>
    </div>`);
  const el = document.getElementById(id);
  bootstrap.Toast.getOrCreateInstance(el, { delay: 3500 }).show();
  el.addEventListener('hidden.bs.toast', () => el.remove());
}

export const MEAL_TYPES = ['breakfast', 'lunch', 'dinner', 'snack'];

export const MEAL_COLORS = {
  breakfast: 'warning',
  lunch:     'info',
  dinner:    'success',
  snack:     'secondary',
};
