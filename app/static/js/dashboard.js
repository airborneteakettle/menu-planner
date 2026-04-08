import { api }                         from './api.js';
import { today, formatDateLong, fmt, MEAL_TYPES } from './utils.js';
import { openRecipeModal }              from './recipes.js';

let _el = null;

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
    const [summary, weekly] = await Promise.all([
      api.menu.summary(dateStr),
      api.menu.weeklySummary(),
    ]);
    renderBody(el.querySelector('#dash-body'), summary, weekly);
  } catch (e) {
    el.querySelector('#dash-body').innerHTML =
      `<div class="alert alert-warning"><i class="bi bi-exclamation-triangle me-1"></i>${e.message}</div>`;
  }
}

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

function weeklyCard(w) {
  const { days, totals, weekly_targets: wt, has_goal, week_start, week_end } = w;

  const fmtDate = iso =>
    new Date(iso + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  const label = `${fmtDate(week_start)} – ${fmtDate(week_end)}`;

  // Day-by-day calorie strip
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
    ['Calories', '--cal-color',  totals.calories,  wt.calories,  'kcal'],
    ['Protein',  '--prot-color', totals.protein_g, wt.protein_g, 'g'],
    ['Carbs',    '--carb-color', totals.carbs_g,   wt.carbs_g,   'g'],
    ['Fat',      '--fat-color',  totals.fat_g,     wt.fat_g,     'g'],
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

function renderBody(el, summary, weekly) {
  const { totals, vs_goal, meals, goal } = summary;
  const hasGoal = goal && goal.calories_target != null;

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
            ${macroRow('Calories', '--cal-color',  totals.calories,  hasGoal ? g.calories?.target  : null)}
            ${macroRow('Protein', '--prot-color',  totals.protein_g, hasGoal ? g.protein_g?.target : null)}
            ${macroRow('Carbs',   '--carb-color',  totals.carbs_g,   hasGoal ? g.carbs_g?.target   : null)}
            ${macroRow('Fat',     '--fat-color',   totals.fat_g,     hasGoal ? g.fat_g?.target     : null)}
            ${goal?.fiber_g_target
              ? macroRow('Fiber', '--fiber-color', totals.fiber_g || 0, goal.fiber_g_target)
              : ''}
          </div>
        </div>
      </div>
    </div>
    <div class="row g-4 mt-0">
      <div class="col-12">
        ${weeklyCard(weekly)}
      </div>
    </div>`;

  el.querySelectorAll('.entry-chip[data-recipe-id]').forEach(chip =>
    chip.addEventListener('click', () => openRecipeModal(+chip.dataset.recipeId))
  );
}
