import { api }                         from './api.js';
import { today, formatDateLong, fmt, MEAL_TYPES } from './utils.js';
import { openRecipeModal }              from './recipes.js';

let _el = null;
let _weightChart = null;

export async function renderDashboard(el) {
  _el = el;
  const dateStr = today();

  el.innerHTML = `
    <div class="d-flex align-items-baseline gap-3 mb-4">
      <h2 class="mb-0 fw-bold">${formatDateLong(dateStr)}</h2>
      <a href="#planner" class="btn btn-outline-success btn-sm">
        <i class="bi bi-calendar-week me-1"></i>Open Planner
      </a>
    </div>
    <div id="dash-body">
      <div class="loading-state"><div class="spinner-border text-success"></div></div>
    </div>`;

  try {
    const [summary, weekly, weightEntries, goalData] = await Promise.all([
      api.menu.summary(dateStr),
      api.menu.weeklySummary(),
      api.weight.list(),
      api.goals.current().catch(() => null),
    ]);
    renderBody(el.querySelector('#dash-body'), summary, weekly, weightEntries, goalData);
  } catch (e) {
    el.querySelector('#dash-body').innerHTML =
      `<div class="alert alert-warning"><i class="bi bi-exclamation-triangle me-1"></i>${e.message}</div>`;
  }
}

// ── Macro helpers ─────────────────────────────────────────────────────────────

function macroRow(label, colorVar, actual, target) {
  const pct  = target ? Math.min(Math.round(actual / target * 100), 100) : 0;
  const over = target && actual > target;
  const unit = label.includes('Cal') ? ' kcal' : 'g';
  return `
    <div class="mb-3">
      <div class="d-flex justify-content-between align-items-baseline mb-1 small">
        <span class="fw-semibold">${label}</span>
        <span class="${over ? 'text-danger fw-semibold' : 'text-muted'}">
          ${fmt(actual)}${unit}${target ? ' / ' + fmt(target) + unit + ' · ' + pct + '%' : ''}
          ${over ? ' <i class="bi bi-exclamation-circle-fill text-danger"></i>' : ''}
        </span>
      </div>
      <div class="progress macro-bar">
        <div class="progress-bar" role="progressbar"
             style="width:${pct}%; background-color:var(${colorVar})"></div>
      </div>
    </div>`;
}

// ── Weekly card ───────────────────────────────────────────────────────────────

function weeklyCard(w) {
  const { days, totals, weekly_targets: wt, has_goal, week_start, week_end } = w;

  const fmtDate = iso =>
    new Date(iso + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  const label = `${fmtDate(week_start)} – ${fmtDate(week_end)}`;

  const dailyCal  = has_goal && wt.calories ? wt.calories / 7 : 0;
  const maxCal    = Math.max(...days.map(d => d.calories), dailyCal, 1);
  const todayIso  = today();

  const dayStrip = days.map(d => {
    const isToday = d.date === todayIso;
    const pct     = Math.min(Math.round(d.calories / maxCal * 100), 100);
    const goalPct = dailyCal ? Math.min(Math.round(dailyCal / maxCal * 100), 100) : 0;
    const over    = dailyCal && d.calories > dailyCal;
    return `
      <div class="d-flex flex-column align-items-center flex-fill">
        <div class="small text-muted mb-1" style="font-size:.65rem">${fmt(d.calories) || '—'}</div>
        <div class="position-relative w-100" style="height:60px">
          ${goalPct ? `<div class="position-absolute w-100" style="bottom:${goalPct}%;height:2px;background:rgba(0,0,0,.2);z-index:1"></div>` : ''}
          <div class="position-absolute bottom-0 w-100 rounded-top"
               style="height:${pct}%;background:var(${over ? '--cal-color' : '--brand-mid'});opacity:${d.calories ? 1 : 0.15}"></div>
        </div>
        <div class="small mt-1 fw-semibold ${isToday ? 'text-success' : 'text-muted'}"
             style="font-size:.7rem">${d.day}</div>
      </div>`;
  }).join('');

  const macros = [
    ['Calories', '--cal-color',   totals.calories,  wt.calories,  'kcal'],
    ['Protein',  '--prot-color',  totals.protein_g, wt.protein_g, 'g'],
    ['Carbs',    '--carb-color',  totals.carbs_g,   wt.carbs_g,   'g'],
    ['Fat',      '--fat-color',   totals.fat_g,     wt.fat_g,     'g'],
    ['Fiber',    '--fiber-color', totals.fiber_g,   wt.fiber_g,   'g'],
  ];

  const macroRows = macros.map(([name, color, actual, target]) => {
    const pct  = target ? Math.min(Math.round(actual / target * 100), 100) : 0;
    const over = target && actual > target;
    return `
      <div class="mb-2">
        <div class="d-flex justify-content-between align-items-baseline mb-1 small">
          <span class="fw-semibold">${name}</span>
          <span class="${over ? 'text-danger fw-semibold' : 'text-muted'}">
            ${fmt(actual)}${name === 'Calories' ? ' kcal' : 'g'}
            ${target ? `<span class="text-muted fw-normal"> / ${fmt(target)}${name === 'Calories' ? ' kcal' : 'g'} · ${pct}%</span>` : ''}
          </span>
        </div>
        <div class="progress macro-bar">
          <div class="progress-bar" role="progressbar"
               style="width:${pct}%; background-color:var(${color})"></div>
        </div>
      </div>`;
  }).join('');

  return `
    <div class="card">
      <div class="card-header d-flex justify-content-between align-items-center">
        <span><i class="bi bi-calendar-week me-1"></i>This Week's Macros</span>
        <span class="small text-muted">${label}</span>
      </div>
      <div class="card-body">
        <div class="row g-4">
          <div class="col-md-5">
            <div class="small text-muted fw-semibold text-uppercase mb-2"
                 style="font-size:.7rem;letter-spacing:.05em">Daily Calories</div>
            <div class="d-flex gap-1 align-items-end">
              ${dayStrip}
            </div>
            ${dailyCal
              ? `<div class="text-muted mt-1" style="font-size:.7rem">
                   — daily target line (${fmt(dailyCal)} kcal)
                 </div>`
              : ''}
          </div>
          <div class="col-md-7">
            <div class="small text-muted fw-semibold text-uppercase mb-2"
                 style="font-size:.7rem;letter-spacing:.05em">
              Weekly Totals ${has_goal ? '' : '· <a href="#goals" class="text-warning">set a goal</a> to see targets'}
            </div>
            ${macroRows}
          </div>
        </div>
      </div>
    </div>`;
}

// ── Weight card ───────────────────────────────────────────────────────────────

function weightCard(entries, goalWeight) {
  const latest  = entries.length ? entries[entries.length - 1] : null;
  const current = latest?.weight ?? null;

  let statsHtml = '';
  if (current != null) {
    const diff     = goalWeight != null ? (current - goalWeight) : null;
    const diffSign = diff != null ? (diff > 0 ? '+' : '') : '';
    statsHtml = `
      <div class="d-flex gap-4 mb-3 small">
        <div>
          <div class="text-muted mb-0" style="font-size:.7rem;text-transform:uppercase;letter-spacing:.04em">Current</div>
          <div class="fw-bold fs-5">${current}</div>
        </div>
        ${goalWeight != null ? `
          <div>
            <div class="text-muted mb-0" style="font-size:.7rem;text-transform:uppercase;letter-spacing:.04em">Goal</div>
            <div class="fw-bold fs-5">${goalWeight}</div>
          </div>
          <div>
            <div class="text-muted mb-0" style="font-size:.7rem;text-transform:uppercase;letter-spacing:.04em">To go</div>
            <div class="fw-bold fs-5 ${diff > 0 ? 'text-warning' : 'text-success'}">${diffSign}${diff.toFixed(1)}</div>
          </div>` : ''}
      </div>`;
  } else {
    statsHtml = `<p class="text-muted small mb-3">No entries yet — log your first weight below.</p>`;
  }

  const chartHtml = entries.length > 1
    ? `<div class="mb-3" style="position:relative;height:180px">
         <canvas id="weight-chart"></canvas>
       </div>`
    : '';

  return `
    <div class="card">
      <div class="card-header d-flex justify-content-between align-items-center">
        <span><i class="bi bi-activity me-1"></i>Weight</span>
        ${goalWeight == null
          ? `<a href="#goals" class="btn btn-link btn-sm p-0 text-muted" style="font-size:.8rem">Set goal weight</a>`
          : ''}
      </div>
      <div class="card-body">
        ${statsHtml}
        ${chartHtml}
        <form id="weight-log-form" class="d-flex gap-2 align-items-center flex-wrap">
          <input type="number" class="form-control form-control-sm" id="wl-weight"
                 placeholder="Weight" min="0" step="0.1" style="max-width:110px"
                 ${latest ? `value="${latest.weight}"` : ''}>
          <input type="date" class="form-control form-control-sm" id="wl-date"
                 value="${today()}" style="max-width:160px">
          <button type="submit" class="btn btn-success btn-sm">
            <i class="bi bi-check-lg me-1"></i>Log
          </button>
        </form>
        ${entries.length > 0 ? `
          <div class="mt-3">
            <div class="small text-muted fw-semibold text-uppercase mb-1"
                 style="font-size:.68rem;letter-spacing:.04em">Recent entries</div>
            <div id="weight-entries-list">
              ${entries.slice(-5).reverse().map(e => `
                <div class="d-flex align-items-center gap-2 py-1 border-bottom small">
                  <span class="text-muted" style="min-width:90px">${e.date}</span>
                  <span class="fw-semibold">${e.weight}</span>
                  <button class="btn btn-link btn-sm p-0 text-danger ms-auto btn-del-weight"
                          data-id="${e.id}" title="Delete">
                    <i class="bi bi-trash3" style="font-size:.75rem"></i>
                  </button>
                </div>`).join('')}
            </div>
          </div>` : ''}
      </div>
    </div>`;
}

function buildWeightChart(entries, goalWeight) {
  const canvas = document.getElementById('weight-chart');
  if (!canvas) return;

  // Destroy previous instance if it exists (chart.js keeps a registry)
  const existing = Chart.getChart(canvas);
  if (existing) existing.destroy();

  const labels   = entries.map(e => e.date);
  const datasets = [
    {
      label: 'Weight',
      data: entries.map(e => e.weight),
      borderColor: '#2e7d32',
      backgroundColor: 'rgba(46,125,50,.08)',
      tension: 0.3,
      fill: true,
      pointRadius: 3,
      pointHoverRadius: 5,
      borderWidth: 2,
    },
  ];

  if (goalWeight != null) {
    datasets.push({
      label: 'Goal',
      data: entries.map(() => goalWeight),
      borderColor: '#e64a19',
      borderDash: [6, 3],
      pointRadius: 0,
      fill: false,
      borderWidth: 1.5,
    });
  }

  _weightChart = new Chart(canvas, {
    type: 'line',
    data: { labels, datasets },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          display: goalWeight != null,
          labels: { boxWidth: 12, font: { size: 11 }, padding: 8 },
        },
        tooltip: {
          callbacks: {
            title: items => items[0].label,
            label: item => ` ${item.dataset.label}: ${item.parsed.y}`,
          },
        },
      },
      scales: {
        x: {
          ticks: { font: { size: 10 }, maxTicksLimit: 7, maxRotation: 0 },
          grid:  { display: false },
        },
        y: {
          ticks: { font: { size: 10 } },
          grid:  { color: '#f0f0f0' },
        },
      },
    },
  });
}

// ── Main render ───────────────────────────────────────────────────────────────

function renderBody(el, summary, weekly, weightEntries, goalData) {
  const { totals, vs_goal, meals, goal } = summary;
  const hasGoal   = goal && goal.calories_target != null;
  const goalWeight = goalData?.goal_weight ?? null;

  // Group meals by type
  const byType = {};
  for (const m of meals) {
    (byType[m.meal_type] = byType[m.meal_type] || []).push(m);
  }

  const mealsHtml = MEAL_TYPES.map(type => {
    const entries = byType[type] || [];
    return `
      <div class="d-flex align-items-start py-2 border-bottom">
        <span class="text-muted small fw-semibold text-uppercase me-3"
              style="min-width:75px;padding-top:3px">${type}</span>
        <div class="flex-grow-1 d-flex flex-wrap gap-1">
          ${entries.length
            ? entries.map(e => `
                <span class="entry-chip" data-recipe-id="${e.recipe_id}">
                  ${e.recipe_name}
                  <small class="text-muted">(${e.servings}x)</small>
                </span>`).join('')
            : '<span class="text-muted small fst-italic">Nothing planned</span>'}
        </div>
      </div>`;
  }).join('');

  const g = vs_goal;
  el.innerHTML = `
    <div class="row g-4">
      <div class="col-lg-5">
        <div class="card h-100">
          <div class="card-header d-flex justify-content-between align-items-center">
            <span><i class="bi bi-egg-fried me-1"></i>Today's Meals</span>
            <a href="#planner" class="btn btn-link btn-sm p-0 text-success">Edit</a>
          </div>
          <div class="card-body p-3">
            ${meals.length
              ? mealsHtml
              : `<p class="text-muted text-center py-4 mb-0">
                   No meals planned today.<br>
                   <a href="#planner">Open the planner</a> to add some.
                 </p>`}
          </div>
        </div>
      </div>
      <div class="col-lg-7">
        <div class="card h-100">
          <div class="card-header d-flex justify-content-between align-items-center">
            <span><i class="bi bi-bar-chart-fill me-1"></i>Today's Nutrition</span>
            ${!hasGoal
              ? `<a href="#goals" class="btn btn-warning btn-sm py-0">Set a goal</a>`
              : ''}
          </div>
          <div class="card-body">
            ${macroRow('Calories', '--cal-color',   totals.calories,  hasGoal ? g.calories?.target  : null)}
            ${macroRow('Protein',  '--prot-color',  totals.protein_g, hasGoal ? g.protein_g?.target : null)}
            ${macroRow('Carbs',    '--carb-color',  totals.carbs_g,   hasGoal ? g.carbs_g?.target   : null)}
            ${macroRow('Fat',      '--fat-color',   totals.fat_g,     hasGoal ? g.fat_g?.target     : null)}
            ${macroRow('Fiber',    '--fiber-color', totals.fiber_g || 0, goal?.fiber_g_target || null)}
          </div>
        </div>
      </div>
    </div>
    <div class="row g-4 mt-0">
      <div class="col-12">
        ${weeklyCard(weekly)}
      </div>
    </div>
    <div class="row g-4 mt-0">
      <div class="col-lg-6">
        ${weightCard(weightEntries, goalWeight)}
      </div>
    </div>`;

  // Wire meal chips
  el.querySelectorAll('.entry-chip[data-recipe-id]').forEach(chip =>
    chip.addEventListener('click', () => openRecipeModal(+chip.dataset.recipeId))
  );

  // Wire weight log form
  document.getElementById('weight-log-form').addEventListener('submit', async e => {
    e.preventDefault();
    const weight = parseFloat(document.getElementById('wl-weight').value);
    const date   = document.getElementById('wl-date').value;
    if (!weight || !date) return;
    try {
      await api.weight.log({ weight, date });
      window.refreshView();
    } catch (err) { toast(err.message, 'danger'); }
  });

  // Wire delete buttons
  el.querySelectorAll('.btn-del-weight').forEach(btn =>
    btn.addEventListener('click', async () => {
      try {
        await api.weight.remove(+btn.dataset.id);
        window.refreshView();
      } catch (err) { toast(err.message, 'danger'); }
    })
  );

  // Build chart after DOM is ready
  if (weightEntries.length > 1) {
    buildWeightChart(weightEntries, goalWeight);
  }
}

function toast(msg, type = 'success') {
  const id = 'toast-' + Date.now();
  document.getElementById('toast-container').insertAdjacentHTML('beforeend', `
    <div id="${id}" class="toast align-items-center text-bg-${type} border-0 show" role="alert">
      <div class="d-flex">
        <div class="toast-body">${msg}</div>
        <button type="button" class="btn-close btn-close-white me-2 m-auto"
                data-bs-dismiss="toast"></button>
      </div>
    </div>`);
  setTimeout(() => document.getElementById(id)?.remove(), 4000);
}
