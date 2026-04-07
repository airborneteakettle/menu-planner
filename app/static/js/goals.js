import { api }           from './api.js';
import { toast, fmt }    from './utils.js';

let _el = null;

export async function renderGoals(el) {
  _el = el;
  el.innerHTML = `
    <div class="d-flex align-items-center mb-4">
      <h2 class="mb-0 fw-bold me-auto">Diet Goals</h2>
    </div>
    <div id="goals-body">
      <div class="loading-state"><div class="spinner-border text-success"></div></div>
    </div>`;
  await loadGoals();
}

async function loadGoals() {
  const body = document.getElementById('goals-body');
  if (!body) return;

  let current = null;
  let history  = [];
  try {
    [current, history] = await Promise.all([
      api.goals.current().catch(() => null),
      api.goals.list(),
    ]);
  } catch (e) {
    body.innerHTML = `<div class="alert alert-danger">${e.message}</div>`;
    return;
  }

  const statCard = (label, value, unit, colorVar) => `
    <div class="col">
      <div class="goal-stat card h-100">
        <div class="value" style="color:var(${colorVar})">${value ?? '—'}</div>
        <div class="label">${label}</div>
        ${unit ? `<div class="text-muted" style="font-size:.7rem">${unit}</div>` : ''}
      </div>
    </div>`;

  const currentHtml = current ? `
    <div class="card mb-4">
      <div class="card-header d-flex justify-content-between align-items-center">
        <span><i class="bi bi-bullseye me-1"></i>Current Goal</span>
        <small class="text-muted">Set ${current.created_at}</small>
      </div>
      <div class="card-body">
        <div class="row row-cols-2 row-cols-md-5 g-3 text-center">
          ${statCard('Calories',  fmt(current.calories_target),  'kcal', '--cal-color')}
          ${statCard('Protein',   fmt(current.protein_g_target), 'g',    '--prot-color')}
          ${statCard('Carbs',     fmt(current.carbs_g_target),   'g',    '--carb-color')}
          ${statCard('Fat',       fmt(current.fat_g_target),     'g',    '--fat-color')}
          ${statCard('Fiber',     fmt(current.fiber_g_target),   current.fiber_g_target ? 'g' : 'not set', '--fiber-color')}
        </div>
        ${current.notes ? `<p class="text-muted small mt-3 mb-0"><i class="bi bi-sticky me-1"></i>${current.notes}</p>` : ''}
      </div>
    </div>` : `
    <div class="alert alert-info mb-4">
      <i class="bi bi-info-circle me-1"></i>
      No goal set yet. Use the form below to set your daily targets.
    </div>`;

  // History table (excluding current)
  const pastGoals = history.slice(1);
  const historyHtml = pastGoals.length ? `
    <div class="card mb-4">
      <div class="card-header"><i class="bi bi-clock-history me-1"></i>Previous Goals</div>
      <div class="card-body p-0">
        <table class="table table-sm table-hover mb-0">
          <thead class="table-light">
            <tr>
              <th>Date</th>
              <th class="text-end">Calories</th>
              <th class="text-end">Protein</th>
              <th class="text-end">Carbs</th>
              <th class="text-end">Fat</th>
              <th class="text-end">Fiber</th>
            </tr>
          </thead>
          <tbody>
            ${pastGoals.map(g => `
              <tr>
                <td>${g.created_at}</td>
                <td class="text-end">${fmt(g.calories_target)} kcal</td>
                <td class="text-end">${fmt(g.protein_g_target)}g</td>
                <td class="text-end">${fmt(g.carbs_g_target)}g</td>
                <td class="text-end">${fmt(g.fat_g_target)}g</td>
                <td class="text-end">${g.fiber_g_target ? fmt(g.fiber_g_target) + 'g' : '—'}</td>
              </tr>`).join('')}
          </tbody>
        </table>
      </div>
    </div>` : '';

  body.innerHTML = `
    ${currentHtml}
    ${historyHtml}

    <div class="card">
      <div class="card-header"><i class="bi bi-pencil-square me-1"></i>
        ${current ? 'Update Goal' : 'Set Goal'}
      </div>
      <div class="card-body">
        <form id="goal-form">
          <div class="row g-3">
            <div class="col-sm-6 col-md-4">
              <label class="form-label fw-medium">Daily Calories (kcal)</label>
              <input type="number" class="form-control" name="calories_target" min="0" step="50"
                     value="${current?.calories_target ?? ''}" placeholder="e.g. 1800">
            </div>
            <div class="col-sm-6 col-md-4">
              <label class="form-label fw-medium">Protein (g)</label>
              <input type="number" class="form-control" name="protein_g_target" min="0" step="5"
                     value="${current?.protein_g_target ?? ''}" placeholder="e.g. 150">
            </div>
            <div class="col-sm-6 col-md-4">
              <label class="form-label fw-medium">Carbs (g)</label>
              <input type="number" class="form-control" name="carbs_g_target" min="0" step="5"
                     value="${current?.carbs_g_target ?? ''}" placeholder="e.g. 200">
            </div>
            <div class="col-sm-6 col-md-4">
              <label class="form-label fw-medium">Fat (g)</label>
              <input type="number" class="form-control" name="fat_g_target" min="0" step="5"
                     value="${current?.fat_g_target ?? ''}" placeholder="e.g. 65">
            </div>
            <div class="col-sm-6 col-md-4">
              <label class="form-label fw-medium">
                Fiber (g) <span class="text-muted fw-normal small">optional</span>
              </label>
              <input type="number" class="form-control" name="fiber_g_target" min="0" step="1"
                     value="${current?.fiber_g_target ?? ''}" placeholder="e.g. 25">
            </div>
            <div class="col-12">
              <label class="form-label fw-medium">Notes <span class="text-muted fw-normal small">optional</span></label>
              <input type="text" class="form-control" name="notes"
                     value="${current?.notes ?? ''}" placeholder="e.g. Cutting phase, 500 cal deficit">
            </div>
          </div>
          <div id="goal-error" class="alert alert-danger mt-3 d-none"></div>
          <div class="mt-3">
            <button type="submit" class="btn btn-success">
              <i class="bi bi-check-circle me-1"></i>Save Goal
            </button>
          </div>
        </form>
      </div>
    </div>`;

  document.getElementById('goal-form').addEventListener('submit', async e => {
    e.preventDefault();
    const errEl = document.getElementById('goal-error');
    errEl.classList.add('d-none');

    const fd = new FormData(e.target);
    const payload = {};
    for (const [k, v] of fd.entries()) {
      if (v !== '') payload[k] = parseFloat(v) || v;
    }

    try {
      await api.goals.create(payload);
      toast('Goal saved');
      await loadGoals();
    } catch (err) {
      errEl.textContent = err.message;
      errEl.classList.remove('d-none');
    }
  });
}
