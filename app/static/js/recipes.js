import { api }                              from './api.js';
import { toast, fmt, MEAL_TYPES, MEAL_COLORS } from './utils.js';

let _el = null;

export async function renderRecipes(el) {
  _el = el;
  el.innerHTML = `
    <div class="d-flex align-items-center gap-2 mb-4 flex-wrap">
      <h2 class="mb-0 fw-bold me-auto">Recipes</h2>
      <select class="form-select form-select-sm" id="filter-meal-type" style="width:140px">
        <option value="">All meals</option>
        ${MEAL_TYPES.map(t => `<option value="${t}">${cap(t)}</option>`).join('')}
      </select>
      <input class="form-control form-control-sm" id="search-recipes"
             placeholder="Search..." style="width:160px">
      <button class="btn btn-success btn-sm" id="btn-open-import">
        <i class="bi bi-link-45deg me-1"></i>Import Recipe
      </button>
    </div>
    <div id="recipe-grid" class="row g-3"></div>`;

  document.getElementById('btn-open-import').addEventListener('click', openImportModal);
  document.getElementById('search-recipes').addEventListener('input', filterCards);
  document.getElementById('filter-meal-type').addEventListener('change', filterCards);

  await loadRecipes();
  setupImportModal();
}

async function loadRecipes() {
  const grid = document.getElementById('recipe-grid');
  if (!grid) return;
  grid.innerHTML = `<div class="col-12 loading-state"><div class="spinner-border text-success"></div></div>`;

  try {
    const recipes = await api.recipes.list();
    if (!recipes.length) {
      grid.innerHTML = `
        <div class="col-12 text-center text-muted py-5">
          <i class="bi bi-journal-x fs-1 d-block mb-2"></i>
          No recipes yet. Import one with the button above.
        </div>`;
      return;
    }
    grid.innerHTML = recipes.map(recipeCard).join('');
    grid.querySelectorAll('.recipe-card').forEach(card => {
      card.addEventListener('click', e => {
        if (!e.target.closest('.btn-delete-recipe'))
          openRecipeModal(+card.dataset.id);
      });
      card.querySelector('.btn-delete-recipe')?.addEventListener('click', e => {
        e.stopPropagation();
        deleteRecipe(+card.dataset.id, card.dataset.name);
      });
    });
  } catch (err) {
    grid.innerHTML = `<div class="col-12"><div class="alert alert-danger">${err.message}</div></div>`;
  }
}

function recipeCard(r) {
  const color = MEAL_COLORS[r.meal_type] || 'secondary';
  return `
    <div class="col-sm-6 col-lg-4 col-xl-3">
      <div class="card recipe-card h-100" data-id="${r.id}" data-name="${r.name}">
        <div class="card-body pb-2">
          <div class="d-flex justify-content-between align-items-start mb-2">
            <h6 class="card-title mb-0 fw-semibold lh-sm">${r.name}</h6>
            <button class="btn btn-link btn-sm p-0 text-danger ms-2 btn-delete-recipe"
                    title="Delete">
              <i class="bi bi-trash3"></i>
            </button>
          </div>
          ${r.meal_type
            ? `<span class="meal-badge-pill bg-${color}-subtle text-${color}-emphasis">${cap(r.meal_type)}</span>`
            : ''}
        </div>
        <div class="card-footer bg-transparent border-0 pt-0">
          <div class="row text-center g-0 small text-muted">
            <div class="col border-end">
              <div class="fw-bold text-dark">${fmt(r.calories)}</div>
              <div style="font-size:.68rem">kcal</div>
            </div>
            <div class="col border-end">
              <div class="fw-bold text-dark">${fmt(r.protein_g)}g</div>
              <div style="font-size:.68rem">protein</div>
            </div>
            <div class="col border-end">
              <div class="fw-bold text-dark">${fmt(r.carbs_g)}g</div>
              <div style="font-size:.68rem">carbs</div>
            </div>
            <div class="col">
              <div class="fw-bold text-dark">${fmt(r.fat_g)}g</div>
              <div style="font-size:.68rem">fat</div>
            </div>
          </div>
        </div>
      </div>
    </div>`;
}

function filterCards() {
  const query   = (document.getElementById('search-recipes')?.value || '').toLowerCase();
  const mealFil = document.getElementById('filter-meal-type')?.value || '';
  document.querySelectorAll('#recipe-grid .recipe-card').forEach(card => {
    const name = card.dataset.name.toLowerCase();
    const meal = card.querySelector('.meal-badge-pill')?.textContent.toLowerCase() || '';
    const show = (!query || name.includes(query)) && (!mealFil || meal === mealFil);
    card.closest('.col-sm-6').classList.toggle('d-none', !show);
  });
}

async function deleteRecipe(id, name) {
  if (!confirm(`Delete "${name}"? This cannot be undone.`)) return;
  try {
    await api.recipes.delete(id);
    toast(`"${name}" deleted`, 'secondary');
    await loadRecipes();
  } catch (e) {
    toast(e.message, 'danger');
  }
}

// ── Recipe Detail Modal ────────────────────────────────────────────────────────
let _currentRecipeId = null;

export async function openRecipeModal(id) {
  _currentRecipeId = id;
  const titleEl = document.getElementById('recipe-modal-title');
  const metaEl  = document.getElementById('recipe-modal-meta');
  const bodyEl  = document.getElementById('recipe-modal-body');

  titleEl.textContent = 'Loading…';
  metaEl.innerHTML = '';
  bodyEl.innerHTML = '<div class="loading-state"><div class="spinner-border text-success"></div></div>';

  bootstrap.Modal.getOrCreateInstance(document.getElementById('modal-recipe')).show();

  try {
    const r = await api.recipes.get(id);
    titleEl.textContent = r.name;

    const srcBadge = r.nutrition_source === 'usda_estimate'
      ? `<span class="badge badge-usda ms-2">USDA estimate</span>`
      : r.nutrition_source
        ? `<span class="badge badge-page ms-2">Nutrition from page</span>`
        : '';

    metaEl.innerHTML = `
      ${r.meal_type ? `<span class="meal-badge-pill bg-${MEAL_COLORS[r.meal_type]||'secondary'}-subtle
                        text-${MEAL_COLORS[r.meal_type]||'secondary'}-emphasis me-2">${cap(r.meal_type)}</span>` : ''}
      ${r.servings ? `${r.servings} serving${r.servings !== 1 ? 's' : ''}` : ''}
      ${srcBadge}
      ${r.source_url ? `<a href="${r.source_url}" target="_blank" rel="noopener"
                          class="ms-2 text-muted small"><i class="bi bi-box-arrow-up-right"></i> Source</a>` : ''}`;

    const goal = r.vs_goal;
    function macroGoalText(key) {
      if (!goal || !goal[key]?.target) return '';
      const pct = Math.round((goal[key].recipe || 0) / goal[key].target * 100);
      return `<span class="text-muted small">(${pct}% of goal)</span>`;
    }

    bodyEl.innerHTML = `
      <div class="row g-4">
        <div class="col-md-5">
          <h6 class="fw-semibold mb-2">Nutrition <small class="text-muted fw-normal">per serving</small></h6>
          <table class="table table-sm table-borderless mb-0">
            <tr><td class="ps-0 text-muted">Calories</td>
                <td class="fw-semibold">${fmt(r.calories)} kcal</td>
                <td>${macroGoalText('calories')}</td></tr>
            <tr><td class="ps-0 text-muted">Protein</td>
                <td class="fw-semibold">${fmt(r.protein_g)}g</td>
                <td>${macroGoalText('protein_g')}</td></tr>
            <tr><td class="ps-0 text-muted">Carbs</td>
                <td class="fw-semibold">${fmt(r.carbs_g)}g</td>
                <td>${macroGoalText('carbs_g')}</td></tr>
            <tr><td class="ps-0 text-muted">Fat</td>
                <td class="fw-semibold">${fmt(r.fat_g)}g</td>
                <td>${macroGoalText('fat_g')}</td></tr>
          </table>

          ${r.ingredients?.length ? `
            <h6 class="fw-semibold mt-4 mb-2">Ingredients</h6>
            <ul class="list-unstyled mb-0">
              ${r.ingredients.map(i => `
                <li class="py-1 border-bottom small d-flex gap-2">
                  <span class="text-muted" style="min-width:70px">${i.quantity || ''}</span>
                  <span>${i.name}</span>
                </li>`).join('')}
            </ul>` : ''}
        </div>

        <div class="col-md-7">
          ${r.instructions ? `
            <h6 class="fw-semibold mb-2">Instructions</h6>
            <div class="instructions-text small lh-lg">
              ${r.instructions.replace(/\n/g, '<br>')}
            </div>` : '<p class="text-muted fst-italic">No instructions available.</p>'}
        </div>
      </div>`;

    // Wire "Add to Menu" button
    document.getElementById('btn-open-add-menu').onclick = () => {
      bootstrap.Modal.getOrCreateInstance(document.getElementById('modal-recipe')).hide();
      window._addMenuCallback = () => { if (_el) renderRecipes(_el); };
      window.openAddMenuModal(r.id, r.name, null, r.meal_type);
    };

  } catch (e) {
    bodyEl.innerHTML = `<div class="alert alert-danger">${e.message}</div>`;
  }
}

// ── Import Modal ───────────────────────────────────────────────────────────────
function openImportModal() {
  document.getElementById('import-url').value = '';
  document.getElementById('import-error').classList.add('d-none');
  bootstrap.Modal.getOrCreateInstance(document.getElementById('modal-import')).show();
  setTimeout(() => document.getElementById('import-url').focus(), 300);
}

function setupImportModal() {
  document.getElementById('btn-import-submit').addEventListener('click', handleImport);
  document.getElementById('import-url').addEventListener('keydown', e => {
    if (e.key === 'Enter') handleImport();
  });
}

async function handleImport() {
  const urlInput = document.getElementById('import-url');
  const errEl    = document.getElementById('import-error');
  const spinner  = document.getElementById('import-spinner');
  const btn      = document.getElementById('btn-import-submit');

  const url = urlInput.value.trim();
  if (!url) { errEl.textContent = 'Please enter a URL.'; errEl.classList.remove('d-none'); return; }

  errEl.classList.add('d-none');
  spinner.classList.remove('d-none');
  btn.disabled = true;

  try {
    const recipe = await api.recipes.import(url);
    bootstrap.Modal.getOrCreateInstance(document.getElementById('modal-import')).hide();
    toast(`"${recipe.name}" imported`);
    await loadRecipes();
    openRecipeModal(recipe.id);
  } catch (e) {
    errEl.textContent = e.message;
    errEl.classList.remove('d-none');
  } finally {
    spinner.classList.add('d-none');
    btn.disabled = false;
  }
}

function cap(s) {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : '';
}
