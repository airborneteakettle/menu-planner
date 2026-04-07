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
    const summary = await api.menu.summary(dateStr);
    renderBody(el.querySelector('#dash-body'), summary);
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

function renderBody(el, summary) {
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
            <span><i class="bi bi-bar-chart-fill me-1"></i>Nutrition Summary</span>
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
    </div>`;

  el.querySelectorAll('.entry-chip[data-recipe-id]').forEach(chip =>
    chip.addEventListener('click', () => openRecipeModal(+chip.dataset.recipeId))
  );
}
