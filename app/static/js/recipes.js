import { api }                              from './api.js';
import { toast, fmt, MEAL_TYPES, MEAL_COLORS } from './utils.js';

let _el           = null;
let _allRecipes   = [];
let _activeTags   = new Set();
let _activeRating = 0;
let _sortField    = '';   // '' | 'calories' | 'protein_g' | 'carbs_g' | 'fat_g'
let _sortDir      = 'asc';
let _nutFilter    = { field: '', min: '', max: '' };
let _editMode         = false;
let _editingRecipeId  = null;

export async function renderRecipes(el) {
  _el = el;
  _activeTags   = new Set();
  _activeRating = 0;

  el.innerHTML = `
    <div class="d-flex align-items-center gap-2 mb-3 flex-wrap">
      <h2 class="mb-0 fw-bold me-auto">Recipes</h2>
      <select class="form-select form-select-sm" id="filter-meal-type" style="width:140px">
        <option value="">All meals</option>
        ${MEAL_TYPES.map(t => `<option value="${t}">${cap(t)}</option>`).join('')}
      </select>
      <select class="form-select form-select-sm" id="filter-rating" style="width:140px">
        <option value="0">Any rating</option>
        ${[5,4,3,2,1].map(n => `<option value="${n}">${stars(n, n)} & up</option>`).join('')}
      </select>
      <input class="form-control form-control-sm" id="search-recipes"
             placeholder="Search..." style="width:160px">
      <button class="btn btn-outline-success btn-sm" id="btn-open-add-recipe">
        <i class="bi bi-journal-plus me-1"></i>Add Recipe
      </button>
      <button class="btn btn-success btn-sm" id="btn-open-import">
        <i class="bi bi-link-45deg me-1"></i>Import Recipe
      </button>
    </div>

    <!-- Nutrition sort + filter row -->
    <div class="d-flex align-items-center gap-2 mb-3 flex-wrap">
      <span class="text-muted small">Sort:</span>
      <select class="form-select form-select-sm" id="sort-nutrition" style="width:160px">
        <option value="">Default</option>
        <option value="calories-asc">Calories ↑</option>
        <option value="calories-desc">Calories ↓</option>
        <option value="protein_g-desc">Protein ↓</option>
        <option value="protein_g-asc">Protein ↑</option>
        <option value="carbs_g-asc">Carbs ↑</option>
        <option value="carbs_g-desc">Carbs ↓</option>
        <option value="fat_g-asc">Fat ↑</option>
        <option value="fat_g-desc">Fat ↓</option>
      </select>

      <span class="text-muted small ms-2">Filter:</span>
      <select class="form-select form-select-sm" id="nut-filter-field" style="width:120px">
        <option value="">Any macro</option>
        <option value="calories">Calories</option>
        <option value="protein_g">Protein</option>
        <option value="carbs_g">Carbs</option>
        <option value="fat_g">Fat</option>
      </select>
      <input type="number" class="form-control form-control-sm" id="nut-filter-min"
             placeholder="Min" style="width:72px" min="0">
      <span class="text-muted small">–</span>
      <input type="number" class="form-control form-control-sm" id="nut-filter-max"
             placeholder="Max" style="width:72px" min="0">
    </div>

    <div id="tag-cloud" class="mb-3 d-flex flex-wrap gap-1 align-items-center">
      <span class="text-muted small me-1">Tags:</span>
    </div>
    <div id="recipe-grid" class="row g-3"></div>`;

  document.getElementById('btn-open-add-recipe').addEventListener('click', openManualAddModal);
  document.getElementById('btn-open-import').addEventListener('click', openImportModal);
  document.getElementById('search-recipes').addEventListener('input', applyFilters);
  document.getElementById('filter-meal-type').addEventListener('change', applyFilters);
  document.getElementById('filter-rating').addEventListener('change', e => {
    _activeRating = +e.target.value;
    applyFilters();
  });
  document.getElementById('sort-nutrition').addEventListener('change', e => {
    const [field, dir] = e.target.value ? e.target.value.split('-') : ['', 'asc'];
    _sortField = field;
    _sortDir   = dir;
    applyFilters();
  });
  ['nut-filter-field', 'nut-filter-min', 'nut-filter-max'].forEach(id =>
    document.getElementById(id).addEventListener('input', () => {
      _nutFilter = {
        field: document.getElementById('nut-filter-field').value,
        min:   document.getElementById('nut-filter-min').value,
        max:   document.getElementById('nut-filter-max').value,
      };
      applyFilters();
    })
  );

  setupImportModal();
  setupManualAddModal();
  await loadRecipes();
}

async function loadRecipes() {
  const grid = document.getElementById('recipe-grid');
  if (!grid) return;
  grid.innerHTML = `<div class="col-12 loading-state"><div class="spinner-border text-success"></div></div>`;

  try {
    [_allRecipes] = await Promise.all([
      api.recipes.list(),
      buildTagCloud(),
    ]);
    renderGrid(_allRecipes);
  } catch (err) {
    grid.innerHTML = `<div class="col-12"><div class="alert alert-danger">${err.message}</div></div>`;
  }
}

async function buildTagCloud() {
  const cloudEl = document.getElementById('tag-cloud');
  if (!cloudEl) return;
  try {
    const tags = await api.recipes.tags({ include_hidden: true });
    if (!tags.length) { cloudEl.classList.add('d-none'); return; }
    cloudEl.classList.remove('d-none');
    cloudEl.innerHTML = `<span class="text-muted small me-1">Tags:</span>` +
      tags.map(t => `
        <span class="tag-filter-pill badge rounded-pill border fw-normal"
              data-tag="${t}" style="cursor:pointer">${t}</span>`).join('');
    cloudEl.querySelectorAll('.tag-filter-pill').forEach(pill =>
      pill.addEventListener('click', () => toggleTagFilter(pill))
    );
  } catch { /* tag cloud is non-critical */ }
}

function toggleTagFilter(pill) {
  const tag = pill.dataset.tag;
  _activeTags.has(tag) ? _activeTags.delete(tag) : _activeTags.add(tag);
  pill.classList.toggle('bg-success', _activeTags.has(tag));
  pill.classList.toggle('text-white', _activeTags.has(tag));
  applyFilters();
}

function applyFilters() {
  const query     = (document.getElementById('search-recipes')?.value || '').toLowerCase();
  const mealFil   = document.getElementById('filter-meal-type')?.value || '';
  const minRating = _activeRating;

  let filtered = _allRecipes.filter(r => {
    if (query     && !r.name.toLowerCase().includes(query)) return false;
    if (mealFil   && r.meal_type !== mealFil && !r.tags.includes(mealFil)) return false;
    if (minRating && (r.rating || 0) < minRating) return false;
    if (_activeTags.size && !r.tags.some(t => _activeTags.has(t))) return false;

    // Nutrition range filter
    if (_nutFilter.field) {
      const val = r[_nutFilter.field] ?? null;
      if (val === null) return false;          // exclude recipes with no data for this macro
      if (_nutFilter.min !== '' && val < +_nutFilter.min) return false;
      if (_nutFilter.max !== '' && val > +_nutFilter.max) return false;
    }

    return true;
  });

  // Nutrition sort
  if (_sortField) {
    filtered = [...filtered].sort((a, b) => {
      const av = a[_sortField] ?? -Infinity;
      const bv = b[_sortField] ?? -Infinity;
      return _sortDir === 'asc' ? av - bv : bv - av;
    });
  }

  renderGrid(filtered);
}

function renderGrid(recipes) {
  const grid = document.getElementById('recipe-grid');
  if (!grid) return;

  if (!recipes.length) {
    grid.innerHTML = `
      <div class="col-12 text-center text-muted py-5">
        <i class="bi bi-journal-x fs-1 d-block mb-2"></i>
        ${_allRecipes.length ? 'No recipes match your filters.' : 'No recipes yet. Import one above.'}
      </div>`;
    return;
  }

  grid.innerHTML = recipes.map(recipeCard).join('');

  grid.querySelectorAll('.recipe-card').forEach(card => {
    card.addEventListener('click', e => {
      if (!e.target.closest('.btn-delete-recipe'))
        openRecipeModal(+card.dataset.id);
    });
    card.querySelector('.btn-delete-recipe')?.addEventListener('click', async e => {
      e.stopPropagation();
      if (!confirm(`Delete "${card.dataset.name}"?`)) return;
      try {
        await api.recipes.delete(+card.dataset.id);
        toast(`"${card.dataset.name}" deleted`, 'secondary');
        await loadRecipes();
      } catch (err) { toast(err.message, 'danger'); }
    });
  });
}

const PROTEIN_TAGS = new Set([
  'chicken','beef','pork','turkey','lamb','salmon','tuna','shrimp',
  'fish','crab','lobster','shellfish','tofu','egg','beans',
]);
const DIET_TAG_CLS = { vegan: 'tag-pill-vegan', vegetarian: 'tag-pill-vegetarian' };

function buildPillsHtml(r) {
  const parts = [];
  // Show my_rating (personal) for the pill; fall back to avg if not yet rated
  const displayRating = r.my_rating || r.rating;
  if (displayRating) {
    const label = r.my_rating ? '' : ' title="avg"';
    parts.push(
      `<span class="badge bg-warning-subtle text-warning-emphasis border" style="font-size:.68rem;letter-spacing:0"${label}>${stars(Math.round(displayRating), 5)}</span>`
    );
  }
  const displayTags = [...r.tags];
  if (r.meal_type && !displayTags.includes(r.meal_type)) displayTags.unshift(r.meal_type);
  displayTags.forEach(t => {
    if (MEAL_TYPES.includes(t)) {
      const c = MEAL_COLORS[t] || 'secondary';
      parts.push(`<span class="meal-badge-pill bg-${c}-subtle text-${c}-emphasis">${cap(t)}</span>`);
    } else if (DIET_TAG_CLS[t]) {
      parts.push(`<span class="tag-pill-diet ${DIET_TAG_CLS[t]}">${cap(t)}</span>`);
    } else if (PROTEIN_TAGS.has(t)) {
      parts.push(`<span class="tag-pill-protein">${cap(t)}</span>`);
    } else {
      parts.push(`<span class="badge bg-light text-dark border" style="font-size:.68rem">${t}</span>`);
    }
  });
  return parts.join(' ');
}

function refreshCardPills(id) {
  const idx = _allRecipes.findIndex(r => r.id === id);
  if (idx === -1) return;
  const cardBody = document.querySelector(`.recipe-card[data-id="${id}"] .card-body`);
  if (!cardBody) return;
  const pillsHtml = buildPillsHtml(_allRecipes[idx]);
  const existing  = cardBody.querySelector('.d-flex.flex-wrap.gap-1');
  if (existing) {
    if (pillsHtml) existing.innerHTML = pillsHtml;
    else existing.remove();
  } else if (pillsHtml) {
    cardBody.querySelector('.d-flex.justify-content-between')
      .insertAdjacentHTML('afterend', `<div class="d-flex flex-wrap gap-1 mb-2">${pillsHtml}</div>`);
  }
}

function recipeCard(r) {
  const pillsHtml = buildPillsHtml(r);

  return `
    <div class="col-6 col-sm-6 col-lg-4 col-xl-3">
      <div class="card recipe-card h-100" data-id="${r.id}" data-name="${escHtml(r.name)}">
        <div class="card-body pb-1">
          <div class="d-flex justify-content-between align-items-start mb-1">
            <h6 class="card-title mb-0 fw-semibold lh-sm">${r.name}</h6>
            <button class="btn btn-link btn-sm p-0 text-danger ms-2 btn-delete-recipe" title="Delete">
              <i class="bi bi-trash3"></i>
            </button>
          </div>
          ${pillsHtml ? `<div class="d-flex flex-wrap gap-1 mb-2">${pillsHtml}</div>` : ''}
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
    const [r, allTags] = await Promise.all([
      api.recipes.get(id),
      api.recipes.tags(),
    ]);
    populateModal(r, allTags);
  } catch (e) {
    bodyEl.innerHTML = `<div class="alert alert-danger">${e.message}</div>`;
  }
}

function populateModal(r, allTags) {
  const titleEl = document.getElementById('recipe-modal-title');
  const metaEl  = document.getElementById('recipe-modal-meta');
  const bodyEl  = document.getElementById('recipe-modal-body');

  titleEl.textContent = r.name;

  const srcBadge = r.nutrition_source === 'usda_estimate'
    ? `<span class="badge badge-usda ms-2">USDA estimate</span>`
    : r.nutrition_source
      ? `<span class="badge badge-page ms-2">Nutrition from page</span>`
      : '';

  metaEl.innerHTML = `
    ${r.meal_type
      ? `<span class="meal-badge-pill bg-${MEAL_COLORS[r.meal_type]||'secondary'}-subtle
              text-${MEAL_COLORS[r.meal_type]||'secondary'}-emphasis me-2">${cap(r.meal_type)}</span>`
      : ''}
    ${r.servings ? `${r.servings} serving${r.servings !== 1 ? 's' : ''}` : ''}
    ${srcBadge}
    ${r.source_url
      ? `<a href="${r.source_url}" target="_blank" rel="noopener" class="ms-2 text-muted small">
           <i class="bi bi-box-arrow-up-right"></i> Source</a>`
      : ''}`;

  const goal = r.vs_goal;
  function goalPct(key) {
    if (!goal?.[key]?.target) return '';
    const pct = Math.round((goal[key].recipe || 0) / goal[key].target * 100);
    return `<span class="text-muted small">(${pct}% of goal)</span>`;
  }

  bodyEl.innerHTML = `
    <!-- Rating + Tags row -->
    <div class="d-flex flex-wrap gap-4 mb-3 pb-3 border-bottom">
      <div>
        <div class="small text-muted fw-semibold mb-1 text-uppercase" style="font-size:.7rem;letter-spacing:.05em">Rating</div>
        <div class="star-input" data-recipe-id="${r.id}" data-current="${r.my_rating || 0}">
          ${[1,2,3,4,5].map(v =>
            `<span class="star-btn" data-val="${v}"
                   style="color:${(r.my_rating||0) >= v ? '#f59e0b' : '#d1d5db'}">★</span>`
          ).join('')}
          <a href="#" class="clear-rating ms-1 small text-muted ${r.my_rating ? '' : 'd-none'}">clear</a>
        </div>
        ${r.rating ? `<div class="small text-muted mt-1">Avg: ${stars(Math.round(r.rating), 5)} <span style="font-size:.75rem">(${r.rating})</span></div>` : ''}
      </div>
      <div class="flex-grow-1">
        <div class="small text-muted fw-semibold mb-1 text-uppercase" style="font-size:.7rem;letter-spacing:.05em">Tags</div>
        <div class="tag-editor" data-recipe-id="${r.id}">
          <div class="tag-chips d-flex flex-wrap gap-1 mb-1">
            ${(r.tags || []).map(t =>
              `<span class="badge bg-light text-dark border tag-chip" data-tag="${t}">
                 ${t}<a href="#" class="remove-tag ms-1 text-muted" data-tag="${t}">×</a>
               </span>`
            ).join('')}
          </div>
          <div class="d-flex gap-1">
            <input type="text" class="form-control form-control-sm tag-input"
                   placeholder="Add tag…" list="modal-tags-datalist" style="max-width:180px">
            <button class="btn btn-outline-secondary btn-sm btn-add-tag">Add</button>
          </div>
          <datalist id="modal-tags-datalist">
            ${allTags.map(t => `<option value="${t}">`).join('')}
          </datalist>
        </div>
      </div>
    </div>

    <!-- Nutrition + Ingredients | Instructions -->
    <div class="row g-4">
      <div class="col-md-5">
        <h6 class="fw-semibold mb-2">Nutrition <small class="text-muted fw-normal">per serving</small></h6>
        <table class="table table-sm table-borderless mb-0">
          <tr><td class="ps-0 text-muted">Calories</td>
              <td class="fw-semibold">${fmt(r.calories)} kcal</td><td>${goalPct('calories')}</td></tr>
          <tr><td class="ps-0 text-muted">Protein</td>
              <td class="fw-semibold">${fmt(r.protein_g)}g</td><td>${goalPct('protein_g')}</td></tr>
          <tr><td class="ps-0 text-muted">Carbs</td>
              <td class="fw-semibold">${fmt(r.carbs_g)}g</td><td>${goalPct('carbs_g')}</td></tr>
          <tr><td class="ps-0 text-muted">Fat</td>
              <td class="fw-semibold">${fmt(r.fat_g)}g</td><td>${goalPct('fat_g')}</td></tr>
        </table>

        ${r.ingredients?.length ? `
          <h6 class="fw-semibold mt-4 mb-2">Ingredients</h6>
          <ul class="list-unstyled mb-0">
            ${r.ingredients.map(i => i.is_header
              ? `<li class="pt-3 pb-1 small fw-bold text-uppercase text-muted" style="letter-spacing:.06em;border-bottom:2px solid #dee2e6">${i.name}</li>`
              : `<li class="py-1 border-bottom small d-flex gap-2">
                  <span class="text-muted" style="min-width:70px">${i.quantity || ''}</span>
                  <span>${i.name}</span>
                </li>`).join('')}
          </ul>` : ''}
      </div>

      <div class="col-md-7">
        ${r.instructions
          ? `<h6 class="fw-semibold mb-2">Instructions</h6>
             ${renderInstructions(r.instructions)}`
          : '<p class="text-muted fst-italic">No instructions available.</p>'}
      </div>
    </div>`;

  wireStars(bodyEl, r);
  wireTags(bodyEl, r);

  document.getElementById('btn-open-add-menu').onclick = () => {
    bootstrap.Modal.getOrCreateInstance(document.getElementById('modal-recipe')).hide();
    window._addMenuCallback = () => { if (_el) renderRecipes(_el); };
    window.openAddMenuModal(r.id, r.name, null, r.meal_type);
  };

  document.getElementById('btn-edit-recipe').onclick = () => {
    bootstrap.Modal.getOrCreateInstance(document.getElementById('modal-recipe')).hide();
    openEditModal(r);
  };

  const reimportBtn = document.getElementById('btn-reimport-recipe');
  if (r.source_url) {
    reimportBtn.classList.remove('d-none');
    reimportBtn.onclick = () => reimportRecipe(r.source_url);
  } else {
    reimportBtn.classList.add('d-none');
  }
}

function wireStars(bodyEl, recipe) {
  const container = bodyEl.querySelector('.star-input');
  const btns = container.querySelectorAll('.star-btn');
  const clearLink = container.querySelector('.clear-rating');

  function paint(val) {
    btns.forEach(b => b.style.color = +b.dataset.val <= val ? '#f59e0b' : '#d1d5db');
  }

  btns.forEach(btn => {
    btn.addEventListener('mouseover', () => paint(+btn.dataset.val));
    btn.addEventListener('mouseout',  () => paint(+container.dataset.current));
    btn.addEventListener('click', async () => {
      const val = +btn.dataset.val;
      try {
        await api.recipes.setRating(recipe.id, val);
        container.dataset.current = val;
        paint(val);
        clearLink.classList.remove('d-none');
        const updated = await api.recipes.setRating(recipe.id, val);
        container.dataset.current = val;
        paint(val);
        clearLink.classList.remove('d-none');
        const idx = _allRecipes.findIndex(r => r.id === recipe.id);
        if (idx !== -1) {
          _allRecipes[idx].my_rating = val;
          _allRecipes[idx].rating    = updated?.rating ?? val;
          refreshCardPills(recipe.id);
        }
      } catch (e) { toast(e.message, 'danger'); }
    });
  });

  clearLink?.addEventListener('click', async e => {
    e.preventDefault();
    try {
      const updated = await api.recipes.setRating(recipe.id, null);
      container.dataset.current = 0;
      paint(0);
      clearLink.classList.add('d-none');
      const idx = _allRecipes.findIndex(r => r.id === recipe.id);
      if (idx !== -1) {
        _allRecipes[idx].my_rating = null;
        _allRecipes[idx].rating    = updated?.rating ?? null;
        refreshCardPills(recipe.id);
      }
    } catch (e) { toast(e.message, 'danger'); }
  });
}

function wireTags(bodyEl, recipe) {
  const editor  = bodyEl.querySelector('.tag-editor');
  const chipsEl = editor.querySelector('.tag-chips');
  const input   = editor.querySelector('.tag-input');
  const addBtn  = editor.querySelector('.btn-add-tag');

  let currentTags = [...(recipe.tags || [])];

  async function saveTags(tags) {
    try {
      await api.recipes.update(recipe.id, { tags });
      currentTags = tags;
      const idx = _allRecipes.findIndex(r => r.id === recipe.id);
      if (idx !== -1) { _allRecipes[idx].tags = tags; refreshCardPills(recipe.id); }
      buildTagCloud();
    } catch (e) { toast(e.message, 'danger'); }
  }

  function renderChips() {
    chipsEl.innerHTML = currentTags.map(t =>
      `<span class="badge bg-light text-dark border tag-chip">
         ${t}<a href="#" class="remove-tag ms-1 text-muted" data-tag="${t}">×</a>
       </span>`
    ).join('');
    chipsEl.querySelectorAll('.remove-tag').forEach(a =>
      a.addEventListener('click', async e => {
        e.preventDefault();
        const newTags = currentTags.filter(t => t !== a.dataset.tag);
        await saveTags(newTags);
        renderChips();
      })
    );
  }

  async function addTag() {
    const tag = input.value.trim().toLowerCase();
    if (!tag || currentTags.includes(tag)) { input.value = ''; return; }
    await saveTags([...currentTags, tag]);
    renderChips();
    input.value = '';
  }

  addBtn.addEventListener('click', addTag);
  input.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); addTag(); } });

  renderChips();
}


// ── Edit Modal ────────────────────────────────────────────────────────────────

function splitQuantity(qty) {
  // Put the whole quantity string in the amount field; leave unit blank.
  // On save, qty = [amount, unit].filter(Boolean).join(' ') reproduces the original.
  return [qty || '', ''];
}

function openEditModal(recipe) {
  _editMode         = true;
  _editingRecipeId  = recipe.id;
  _pendingNutrition = null;
  _breakdown        = [];
  _totals           = {};

  document.querySelector('#modal-add-recipe .modal-title').innerHTML =
    '<i class="bi bi-pencil me-1"></i>Edit Recipe';

  document.getElementById('ar-name').value         = recipe.name || '';
  document.getElementById('ar-servings').value     = recipe.servings || 1;
  document.getElementById('ar-instructions').value = recipe.instructions || '';

  // Stored values are per-serving; the modal expects total-recipe nutrition
  const srv = recipe.servings || 1;
  const toTotal = v => (v != null ? Math.round(v * srv * 10) / 10 : '');
  document.getElementById('ar-calories').value = recipe.calories != null ? Math.round(recipe.calories * srv) : '';
  document.getElementById('ar-protein').value  = toTotal(recipe.protein_g);
  document.getElementById('ar-carbs').value    = toTotal(recipe.carbs_g);
  document.getElementById('ar-fat').value      = toTotal(recipe.fat_g);
  document.getElementById('ar-fiber').value    = toTotal(recipe.fiber_g);

  document.getElementById('ar-per-serving-preview').classList.add('d-none');
  document.getElementById('ar-error').classList.add('d-none');
  document.getElementById('ar-nutrition-panel').classList.add('d-none');
  document.getElementById('ar-check-icon').classList.remove('d-none');

  // Populate ingredient rows from existing data
  const container = document.getElementById('ar-ingredients');
  container.innerHTML = '';
  if (recipe.ingredients?.length) {
    for (const ing of recipe.ingredients) {
      if (ing.is_header) {
        addHeaderRow(ing.name);
      } else {
        const [amt, unit] = splitQuantity(ing.quantity);
        addIngredientRow(amt, unit, ing.name);
      }
    }
  } else {
    addIngredientRow();
    addIngredientRow();
  }

  // Show Save immediately — we already have data
  document.getElementById('ar-btn-save').classList.remove('d-none');
  _updatePerServingPreview();

  bootstrap.Modal.getOrCreateInstance(document.getElementById('modal-add-recipe')).show();
  setTimeout(() => document.getElementById('ar-name').focus(), 300);
}


async function reimportRecipe(url) {
  const btn     = document.getElementById('btn-reimport-recipe');
  const spinner = document.getElementById('reimport-spinner');
  const icon    = document.getElementById('reimport-icon');
  btn.disabled  = true;
  spinner.classList.remove('d-none');
  icon.classList.add('d-none');
  try {
    const recipe = await api.recipes.import(url);
    toast(`"${recipe.name}" re-imported`);
    await loadRecipes();
    openRecipeModal(recipe.id);
  } catch (e) {
    if (e.data?._scrape_failed) {
      // Close recipe modal, open import modal with fallback UI pre-shown
      bootstrap.Modal.getOrCreateInstance(document.getElementById('modal-recipe')).hide();
      openImportModal();
      // Wait for modal to be visible then pre-fill and trigger fallback display
      setTimeout(() => {
        document.getElementById('import-url').value = url;
        const nameInput = document.getElementById('import-fallback-name');
        nameInput.value = e.data.suggested_name || '';
        document.getElementById('import-error').textContent = 'Could not scrape this page. Save a placeholder instead?';
        document.getElementById('import-error').classList.remove('d-none');
        document.getElementById('import-fallback').classList.remove('d-none');
        document.getElementById('btn-import-save-stub').classList.remove('d-none');
        setTimeout(() => nameInput.focus(), 50);
      }, 400);
    } else {
      toast(e.message, 'danger');
    }
  } finally {
    btn.disabled = false;
    spinner.classList.add('d-none');
    icon.classList.remove('d-none');
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
  document.getElementById('btn-import-save-stub').addEventListener('click', handleImportStub);
  document.getElementById('import-fallback-name').addEventListener('keydown', e => {
    if (e.key === 'Enter') handleImportStub();
  });
  // Reset fallback UI when modal is closed
  document.getElementById('modal-import').addEventListener('hidden.bs.modal', resetImportModal);
}

function resetImportModal() {
  document.getElementById('import-error').classList.add('d-none');
  document.getElementById('import-fallback').classList.add('d-none');
  document.getElementById('btn-import-save-stub').classList.add('d-none');
  document.getElementById('btn-import-submit').classList.remove('d-none');
}

async function handleImport() {
  const urlInput = document.getElementById('import-url');
  const errEl    = document.getElementById('import-error');
  const spinner  = document.getElementById('import-spinner');
  const btn      = document.getElementById('btn-import-submit');
  const url      = urlInput.value.trim();
  if (!url) { errEl.textContent = 'Please enter a URL.'; errEl.classList.remove('d-none'); return; }

  errEl.classList.add('d-none');
  document.getElementById('import-fallback').classList.add('d-none');
  document.getElementById('btn-import-save-stub').classList.add('d-none');
  spinner.classList.remove('d-none');
  btn.disabled = true;

  try {
    const recipe = await api.recipes.import(url);
    bootstrap.Modal.getOrCreateInstance(document.getElementById('modal-import')).hide();
    toast(recipe._updated ? `"${recipe.name}" updated` : `"${recipe.name}" imported`);
    await loadRecipes();
    openRecipeModal(recipe.id);
  } catch (e) {
    if (e.data?._scrape_failed) {
      errEl.textContent = 'Could not scrape this page. Save a placeholder instead?';
      errEl.classList.remove('d-none');
      const nameInput = document.getElementById('import-fallback-name');
      nameInput.value = e.data.suggested_name || '';
      document.getElementById('import-fallback').classList.remove('d-none');
      document.getElementById('btn-import-save-stub').classList.remove('d-none');
      setTimeout(() => nameInput.focus(), 50);
    } else {
      errEl.textContent = e.message;
      errEl.classList.remove('d-none');
    }
  } finally {
    spinner.classList.add('d-none');
    btn.disabled = false;
  }
}

async function handleImportStub() {
  const url          = document.getElementById('import-url').value.trim();
  const nameInput    = document.getElementById('import-fallback-name');
  const name         = nameInput.value.trim();
  const stubBtn      = document.getElementById('btn-import-save-stub');
  if (!name) { nameInput.focus(); return; }

  stubBtn.disabled = true;
  try {
    const recipe = await api.recipes.import(url, name);
    bootstrap.Modal.getOrCreateInstance(document.getElementById('modal-import')).hide();
    toast(`"${recipe.name}" saved as placeholder`);
    await loadRecipes();
    openRecipeModal(recipe.id);
  } catch (e) {
    document.getElementById('import-error').textContent = e.message;
    document.getElementById('import-error').classList.remove('d-none');
  } finally {
    stubBtn.disabled = false;
  }
}


// ── Manual Add Modal ──────────────────────────────────────────────────────────

let _pendingNutrition = null; // nutrition fetched but not yet saved
let _breakdown        = [];   // current per-ingredient rows (with any overrides applied)
let _totals           = {};   // current totals (recomputed when overrides applied)

// ── Ingredient picker state ───────────────────────────────────────────────────
let _pickerRowIdx     = -1;
let _pickerIngredient = '';
let _pickerOffset     = 0;
let _pickerCandidates = [];

function openManualAddModal() {
  _editMode         = false;
  _editingRecipeId  = null;
  _pendingNutrition = null;
  _breakdown        = [];
  _totals           = {};
  document.querySelector('#modal-add-recipe .modal-title').innerHTML =
    '<i class="bi bi-journal-plus me-1"></i>Add Recipe';
  document.getElementById('ar-name').value         = '';
  document.getElementById('ar-servings').value     = '4';
  document.getElementById('ar-instructions').value = '';
  document.getElementById('ar-calories').value     = '';
  document.getElementById('ar-protein').value      = '';
  document.getElementById('ar-carbs').value        = '';
  document.getElementById('ar-fat').value          = '';
  document.getElementById('ar-fiber').value        = '';
  document.getElementById('ar-per-serving-preview').classList.add('d-none');
  document.getElementById('ar-error').classList.add('d-none');
  document.getElementById('ar-nutrition-panel').classList.add('d-none');
  document.getElementById('ar-btn-save').classList.add('d-none');
  document.getElementById('ar-check-icon').classList.remove('d-none');

  // Seed two blank ingredient rows
  const container = document.getElementById('ar-ingredients');
  container.innerHTML = '';
  addIngredientRow();
  addIngredientRow();

  bootstrap.Modal.getOrCreateInstance(document.getElementById('modal-add-recipe')).show();
  setTimeout(() => document.getElementById('ar-name').focus(), 300);
}

const UNITS = [
  '',
  'tsp', 'tbsp',
  'cup', 'fl oz',
  'oz', 'lb',
  'g', 'kg', 'ml', 'L',
  'pinch', 'dash',
  'clove', 'slice', 'can', 'bunch', 'sprig', 'stalk', 'whole',
];

function _updateSaveVisibility() {
  const anyMacro = [...document.querySelectorAll('.ar-macro')]
    .some(el => el.value.trim() !== '');
  document.getElementById('ar-btn-save').classList.toggle('d-none', !anyMacro && !_pendingNutrition);
  _updatePerServingPreview();
}

function _updatePerServingPreview() {
  const preview  = document.getElementById('ar-per-serving-preview');
  const servings = +document.getElementById('ar-servings').value || 1;
  const cals  = parseFloat(document.getElementById('ar-calories').value);
  const prot  = parseFloat(document.getElementById('ar-protein').value);
  const carbs = parseFloat(document.getElementById('ar-carbs').value);
  const fat   = parseFloat(document.getElementById('ar-fat').value);

  const anyFilled = [cals, prot, carbs, fat].some(v => !isNaN(v) && v > 0);
  if (!anyFilled || servings <= 1) { preview.classList.add('d-none'); return; }

  const fmt1 = v => isNaN(v) ? '—' : Math.round(v / servings);
  preview.textContent =
    `Per serving (÷${servings}): ${fmt1(cals)} kcal · ${fmt1(prot)}g protein · ${fmt1(carbs)}g carbs · ${fmt1(fat)}g fat`;
  preview.classList.remove('d-none');
}

function setupManualAddModal() {
  document.getElementById('ar-add-ingredient').addEventListener('click', () => addIngredientRow());
  document.getElementById('ar-add-header').addEventListener('click', () => addHeaderRow());
  document.getElementById('ar-btn-check').addEventListener('click', checkNutrition);
  document.getElementById('ar-btn-save').addEventListener('click', saveManualRecipe);
  document.querySelectorAll('.ar-macro').forEach(el =>
    el.addEventListener('input', _updateSaveVisibility)
  );
  document.getElementById('ar-servings').addEventListener('input', _updatePerServingPreview);

  document.getElementById('ar-paste-toggle').addEventListener('click', () => {
    const area = document.getElementById('ar-paste-area');
    const hidden = area.classList.toggle('d-none');
    if (!hidden) setTimeout(() => document.getElementById('ar-paste-input').focus(), 50);
  });
  document.getElementById('ar-paste-parse').addEventListener('click', parsePastedIngredients);
}

// ── Ingredient paste parser ───────────────────────────────────────────────────

const _UNIT_MAP = {
  'teaspoon': 'tsp', 'teaspoons': 'tsp', 'tsp': 'tsp', 'tsps': 'tsp',
  'tablespoon': 'tbsp', 'tablespoons': 'tbsp', 'tbsp': 'tbsp', 'tbsps': 'tbsp', 'tbs': 'tbsp',
  'cup': 'cup', 'cups': 'cup',
  'fluidounce': 'fl oz', 'fluidounces': 'fl oz', 'floz': 'fl oz',
  'ounce': 'oz', 'ounces': 'oz', 'oz': 'oz',
  'pound': 'lb', 'pounds': 'lb', 'lb': 'lb', 'lbs': 'lb',
  'gram': 'g', 'grams': 'g',
  'kilogram': 'kg', 'kilograms': 'kg', 'kg': 'kg',
  'milliliter': 'ml', 'milliliters': 'ml', 'ml': 'ml',
  'liter': 'L', 'liters': 'L',
  'pinch': 'pinch', 'pinches': 'pinch',
  'dash': 'dash', 'dashes': 'dash',
  'clove': 'clove', 'cloves': 'clove',
  'slice': 'slice', 'slices': 'slice',
  'can': 'can', 'cans': 'can',
  'bunch': 'bunch', 'bunches': 'bunch',
  'sprig': 'sprig', 'sprigs': 'sprig',
  'stalk': 'stalk', 'stalks': 'stalk',
  'whole': 'whole',
};

const _UNICODE_FRACS = {'½':'1/2','¼':'1/4','¾':'3/4','⅓':'1/3','⅔':'2/3','⅛':'1/8','⅜':'3/8','⅝':'5/8','⅞':'7/8'};

// Common ingredient words that can appear without a quantity — excluded from header detection
const _INGREDIENT_WORDS = new Set([
  'salt', 'pepper', 'water', 'oil', 'butter', 'sugar', 'flour', 'cream',
  'milk', 'eggs', 'egg', 'vinegar', 'garlic', 'onion', 'sauce', 'broth',
  'stock', 'wine', 'honey', 'mustard', 'lemon', 'lime', 'herbs', 'spices',
  'powder', 'flakes', 'extract', 'juice', 'zest', 'cheese', 'yeast', 'baking',
]);

function _looksLikeHeader(line) {
  if (/\d/.test(line)) return false;         // has a number → ingredient
  if (line.includes(',')) return false;       // has comma → ingredient with descriptor
  const words = line.trim().split(/\s+/);
  if (words.length > 4) return false;         // too long to be a section name
  // If any word matches a known no-quantity ingredient, it's not a header
  if (words.some(w => _INGREDIENT_WORDS.has(w.toLowerCase()))) return false;
  return true;
}

function parseIngredientLine(line) {
  line = line.trim();
  if (!line) return null;

  // Detect section headers before any other processing
  if (_looksLikeHeader(line)) return { amount: '', unit: '', name: line, is_header: true };

  // Normalize unicode fractions and fancy dashes in numbers
  line = line.replace(/[½¼¾⅓⅔⅛⅜⅝⅞]/g, m => _UNICODE_FRACS[m] || m);

  // Match leading number: mixed "1 1/2", fraction "1/2", decimal "1.5", integer "5"
  let amount = '', rest = line;
  const numM = line.match(/^(\d+\s+\d+\/\d+|\d+\/\d+|\d+\.?\d*)/);
  if (numM) {
    amount = numM[1].trim();
    rest = line.slice(numM[0].length).trim();
  }

  // Match optional unit (handles "fluid ounce/ounces" as two-word unit)
  let unit = '';
  const unitM = rest.match(/^(fluid\s+ounces?|fluid\s+oz|[a-zA-Z]+)\s*/i);
  if (unitM) {
    const key = unitM[1].replace(/\s+/g, '').toLowerCase();
    const mapped = _UNIT_MAP[key] || _UNIT_MAP[unitM[1].toLowerCase()];
    if (mapped) {
      unit = mapped;
      rest = rest.slice(unitM[0].length).trim();
    }
  }

  // Strip parentheticals like "(455 grams)" or "(16 oz)"
  rest = rest.replace(/\([^)]*\)/g, ' ').replace(/\s{2,}/g, ' ').trim();
  // Strip leading comma/dash left over after stripping parens
  rest = rest.replace(/^[,\-–—]\s*/, '').trim();

  return amount || rest ? { amount, unit, name: rest } : null;
}

function parsePastedIngredients() {
  const text = document.getElementById('ar-paste-input').value;
  const lines = text.split(/\r?\n/);
  const parsed = lines.map(parseIngredientLine).filter(Boolean);
  if (!parsed.length) return;

  const container = document.getElementById('ar-ingredients');
  // Clear placeholder blank rows if they're still empty
  container.querySelectorAll('.ar-ingredient-row').forEach(row => {
    const input = row.classList.contains('ar-header-row')
      ? row.querySelector('.ar-ing-header')
      : null;
    const hasContent = input
      ? input.value.trim()
      : (row.querySelector('.ar-ing-amount').value.trim() || row.querySelector('.ar-ing-name').value.trim());
    if (!hasContent) row.remove();
  });

  for (const { amount, unit, name, is_header } of parsed) {
    if (is_header) addHeaderRow(name);
    else addIngredientRow(amount, unit, name);
  }

  // Hide paste area and clear it
  document.getElementById('ar-paste-input').value = '';
  document.getElementById('ar-paste-area').classList.add('d-none');
}

function addHeaderRow(name = '') {
  const container = document.getElementById('ar-ingredients');
  const row = document.createElement('div');
  row.className = 'input-group input-group-sm mb-1 ar-ingredient-row ar-header-row';
  row.innerHTML = `
    <span class="input-group-text bg-light text-muted small" style="font-size:0.7rem;letter-spacing:.05em;white-space:nowrap">SECTION</span>
    <input type="text" class="form-control fw-semibold ar-ing-header" placeholder="Section name (e.g. Dressing)" value="${escHtml(name)}">
    <button type="button" class="btn btn-outline-secondary ar-remove-row" tabindex="-1">
      <i class="bi bi-x"></i>
    </button>`;
  row.querySelector('.ar-remove-row').addEventListener('click', () => row.remove());
  container.appendChild(row);
  if (!name) setTimeout(() => row.querySelector('.ar-ing-header').focus(), 50);
}

function addIngredientRow(amount = '', unit = '', name = '') {
  const container = document.getElementById('ar-ingredients');
  const row = document.createElement('div');
  row.className = 'input-group input-group-sm mb-1 ar-ingredient-row';
  row.innerHTML = `
    <input  type="text" class="form-control ar-ing-amount" placeholder="Qty"
            style="max-width:72px" value="${escHtml(amount)}">
    <select class="form-select ar-ing-unit" style="max-width:100px">
      ${UNITS.map(u => `<option value="${u}"${u === unit ? ' selected' : ''}>${u || '—'}</option>`).join('')}
    </select>
    <input  type="text" class="form-control ar-ing-name" placeholder="Ingredient name"
            value="${escHtml(name)}">
    <button type="button" class="btn btn-outline-secondary ar-remove-row" tabindex="-1">
      <i class="bi bi-x"></i>
    </button>`;

  row.querySelector('.ar-remove-row').addEventListener('click', () => {
    if (container.querySelectorAll('.ar-ingredient-row').length > 1) row.remove();
  });

  // Enter in name field → advance to next row or add one
  row.querySelector('.ar-ing-name').addEventListener('keydown', e => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    const rows = [...container.querySelectorAll('.ar-ingredient-row')];
    const next = rows[rows.indexOf(row) + 1];
    if (next) next.querySelector('.ar-ing-amount').focus();
    else { addIngredientRow(); container.lastElementChild.querySelector('.ar-ing-amount').focus(); }
  });

  container.appendChild(row);
}

function getIngredients() {
  return [...document.querySelectorAll('.ar-ingredient-row')]
    .map(row => {
      if (row.classList.contains('ar-header-row')) {
        const name = row.querySelector('.ar-ing-header').value.trim();
        return name ? { quantity: null, name, is_header: true } : null;
      }
      const amount = row.querySelector('.ar-ing-amount').value.trim();
      const unit   = row.querySelector('.ar-ing-unit').value;
      const name   = row.querySelector('.ar-ing-name').value.trim();
      const qty    = [amount, unit].filter(Boolean).join(' ') || null;
      return { quantity: qty, name };
    })
    .filter(i => i?.name);
}

function renderNutritionBreakdown(totals, breakdown) {
  const fmtN = v => (v == null ? '<span class="text-muted">—</span>' : fmt(v));

  const rows = breakdown.map((row, idx) => {
    const ingredient = (row.quantity ? row.quantity + ' ' : '') + row.name;
    return `
    <tr class="${row.found || row._override ? '' : 'text-muted fst-italic'}">
      <td class="ps-0">
        ${row.quantity ? `<span class="text-muted me-1" style="font-size:.78rem">${escHtml(row.quantity)}</span>` : ''}
        ${escHtml(row.name)}
        ${row._override
          ? `<br><span class="text-muted" style="font-size:.68rem">→ ${escHtml(row._override)}</span>`
          : ''}
        ${!row.found && !row._override
          ? `<span class="badge bg-warning-subtle text-warning-emphasis ms-1" style="font-size:.65rem">not found</span>`
          : ''}
        <button class="btn-pick-food ms-1"
                data-row-index="${idx}"
                data-ingredient="${escAttr(ingredient)}"
                title="Choose different food match">
          <i class="bi bi-search" style="font-size:.7rem"></i>
        </button>
      </td>
      <td class="text-end">${fmtN(row.calories)}</td>
      <td class="text-end">${fmtN(row.protein_g)}</td>
      <td class="text-end">${fmtN(row.carbs_g)}</td>
      <td class="text-end">${fmtN(row.fat_g)}</td>
    </tr>`;
  }).join('');

  return `
    <div class="small fw-semibold text-muted text-uppercase mb-2"
         style="font-size:.7rem;letter-spacing:.05em">
      Estimated Nutrition
      <span class="badge badge-usda ms-1 text-lowercase" style="font-size:.65rem">USDA estimate</span>
    </div>
    <div style="max-height:220px;overflow-y:auto">
      <table class="table table-sm table-borderless mb-0" style="font-size:.8rem">
        <thead>
          <tr class="text-muted border-bottom">
            <th class="ps-0 fw-normal">Ingredient</th>
            <th class="text-end fw-normal">kcal</th>
            <th class="text-end fw-normal">Protein</th>
            <th class="text-end fw-normal">Carbs</th>
            <th class="text-end fw-normal">Fat</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
        <tfoot>
          <tr class="border-top fw-semibold">
            <td class="ps-0">Total</td>
            <td class="text-end">${fmt(totals.calories)}</td>
            <td class="text-end">${fmt(totals.protein_g)}g</td>
            <td class="text-end">${fmt(totals.carbs_g)}g</td>
            <td class="text-end">${fmt(totals.fat_g)}g</td>
          </tr>
          <tr class="text-muted" style="font-size:.72rem">
            <td class="ps-0">Per serving (÷${
              (() => { const s = +document.getElementById('ar-servings').value || 1; return s; })()
            })</td>
            <td class="text-end">${fmt(totals.calories  / (+document.getElementById('ar-servings').value || 1))}</td>
            <td class="text-end">${fmt(totals.protein_g / (+document.getElementById('ar-servings').value || 1))}g</td>
            <td class="text-end">${fmt(totals.carbs_g   / (+document.getElementById('ar-servings').value || 1))}g</td>
            <td class="text-end">${fmt(totals.fat_g     / (+document.getElementById('ar-servings').value || 1))}g</td>
          </tr>
        </tfoot>
      </table>
    </div>`;
}

async function checkNutrition() {
  const errEl   = document.getElementById('ar-error');
  const spinner = document.getElementById('ar-spinner');
  const icon    = document.getElementById('ar-check-icon');
  const btn     = document.getElementById('ar-btn-check');
  const panel   = document.getElementById('ar-nutrition-panel');

  const name = document.getElementById('ar-name').value.trim();
  if (!name) {
    errEl.textContent = 'Recipe name is required.';
    errEl.classList.remove('d-none');
    document.getElementById('ar-name').focus();
    return;
  }
  const ingredients = getIngredients().filter(i => !i.is_header);
  if (!ingredients.length) {
    errEl.textContent = 'Add at least one ingredient.';
    errEl.classList.remove('d-none');
    return;
  }

  errEl.classList.add('d-none');
  spinner.classList.remove('d-none');
  icon.classList.add('d-none');
  btn.disabled = true;

  try {
    const { totals, breakdown } = await api.recipes.estimateNutrition(ingredients);

    // Store breakdown so overrides can mutate it and recalculate totals
    _breakdown = breakdown;
    _totals    = { ...totals };
    _pendingNutrition = _totals;

    _applyNutritionToForm(_totals);
    renderAndWireBreakdown();
    panel.classList.remove('d-none');
    _updateSaveVisibility();
  } catch (e) {
    errEl.textContent = e.message;
    errEl.classList.remove('d-none');
  } finally {
    spinner.classList.add('d-none');
    icon.classList.remove('d-none');
    btn.disabled = false;
  }
}

// ── Nutrition helpers ─────────────────────────────────────────────────────────

function _applyNutritionToForm(totals) {
  const fmtN = v => (v != null && v > 0) ? String(Math.round(v * 10) / 10) : '';
  document.getElementById('ar-calories').value = totals.calories  ? String(Math.round(totals.calories)) : '';
  document.getElementById('ar-protein').value  = fmtN(totals.protein_g);
  document.getElementById('ar-carbs').value    = fmtN(totals.carbs_g);
  document.getElementById('ar-fat').value      = fmtN(totals.fat_g);
  document.getElementById('ar-fiber').value    = fmtN(totals.fiber_g);
  _updatePerServingPreview();
}

function renderAndWireBreakdown() {
  const panel = document.getElementById('ar-nutrition-panel');
  panel.innerHTML = renderNutritionBreakdown(_totals, _breakdown);
  panel.querySelectorAll('.btn-pick-food').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      openIngredientPicker(+btn.dataset.rowIndex, btn.dataset.ingredient);
    });
  });
}

// ── Ingredient picker ─────────────────────────────────────────────────────────

function openIngredientPicker(rowIndex, ingredient) {
  _pickerRowIdx     = rowIndex;
  _pickerIngredient = ingredient;
  _pickerOffset     = 0;
  _pickerCandidates = [];

  // Render picker inline inside the nutrition panel — avoids z-index issues
  // with Bootstrap modals (offcanvas sits behind the modal backdrop).
  const panel = document.getElementById('ar-nutrition-panel');
  panel.innerHTML = `
    <div class="d-flex align-items-center gap-2 mb-2 border-bottom pb-2">
      <button class="btn btn-sm btn-outline-secondary flex-shrink-0" id="picker-back-btn">
        <i class="bi bi-arrow-left me-1"></i>Back
      </button>
      <span class="small fw-medium text-truncate">${escHtml(ingredient)}</span>
    </div>
    <div id="picker-body">
      <div class="loading-state py-3"><div class="spinner-border spinner-border-sm text-success"></div></div>
    </div>`;
  panel.classList.remove('d-none');

  document.getElementById('picker-back-btn').addEventListener('click', renderAndWireBreakdown);

  loadPickerPage(0);
}

async function loadPickerPage(offset) {
  _pickerOffset = offset;
  const body = document.getElementById('picker-body');
  if (!body) return;
  body.innerHTML = `<div class="loading-state"><div class="spinner-border text-success"></div></div>`;

  try {
    const data = await api.recipes.searchIngredient(_pickerIngredient, offset);
    _pickerCandidates = data.candidates;
    body.innerHTML = renderPickerPage(data);

    // Wire "Select" buttons
    body.querySelectorAll('.btn-select-candidate').forEach(btn => {
      btn.addEventListener('click', () => {
        const candidate = _pickerCandidates[+btn.dataset.idx];
        applyNutritionOverride(_pickerRowIdx, candidate);
        // applyNutritionOverride calls renderAndWireBreakdown which replaces the panel
      });
    });

    // Wire "Next 10" button
    const nextBtn = body.querySelector('#picker-next-btn');
    if (nextBtn) {
      nextBtn.addEventListener('click', () => loadPickerPage(+nextBtn.dataset.offset));
    }
  } catch (e) {
    body.innerHTML = `<div class="alert alert-danger m-3">${e.message}</div>`;
  }
}

function renderPickerPage(data) {
  const { food_name, grams, candidates, has_more, offset, total } = data;

  if (!candidates.length) {
    return `<p class="text-muted small p-3 mb-0">No results found for "${escHtml(food_name)}".</p>`;
  }

  const unit   = grams != null ? `scaled to ${grams}g` : 'per 100g';
  const header = `
    <div class="px-3 pt-2 pb-1 border-bottom bg-light" style="font-size:.75rem;color:#666">
      Showing ${offset + 1}–${offset + candidates.length}${total > 0 ? ' of ' + total : ''} &middot;
      values ${unit}
    </div>`;

  const rows = candidates.map((c, idx) => {
    const dtClass = c.dataType === 'Foundation'
      ? 'bg-success-subtle text-success-emphasis'
      : 'bg-secondary-subtle text-secondary-emphasis';
    const calStr  = c.calories  != null ? Math.round(c.calories)  + ' kcal' : '—';
    const protStr = c.protein_g != null ? c.protein_g + 'g prot'  : '';
    const carbStr = c.carbs_g   != null ? c.carbs_g   + 'g carbs' : '';
    const fatStr  = c.fat_g     != null ? c.fat_g     + 'g fat'   : '';
    const macros  = [calStr, protStr, carbStr, fatStr].filter(Boolean).join(' · ');

    return `
      <div class="picker-candidate border-bottom px-3 py-2">
        <div class="d-flex align-items-start gap-2">
          <div class="flex-grow-1 min-w-0">
            <div class="fw-medium lh-sm picker-desc">${escHtml(c.description)}</div>
            <div class="d-flex align-items-center gap-2 mt-1 flex-wrap">
              <span class="badge ${dtClass}" style="font-size:.6rem">${escHtml(c.dataType)}</span>
              <span class="text-muted picker-macros">${escHtml(macros)}</span>
            </div>
          </div>
          <button class="btn btn-outline-success btn-sm flex-shrink-0 btn-select-candidate"
                  data-idx="${idx}">Select</button>
        </div>
      </div>`;
  }).join('');

  const moreBtn = has_more ? `
    <div class="text-center p-3">
      <button class="btn btn-outline-secondary btn-sm" id="picker-next-btn"
              data-offset="${offset + candidates.length}">
        <i class="bi bi-arrow-down me-1"></i>Next 10
      </button>
    </div>` : '';

  return header + rows + moreBtn;
}

function applyNutritionOverride(rowIndex, candidate) {
  if (rowIndex < 0 || rowIndex >= _breakdown.length) return;

  _breakdown[rowIndex] = {
    ..._breakdown[rowIndex],
    found:     true,
    calories:  candidate.calories,
    protein_g: candidate.protein_g,
    carbs_g:   candidate.carbs_g,
    fat_g:     candidate.fat_g,
    fiber_g:   candidate.fiber_g,
    _override: candidate.description,
  };

  // Recompute totals from breakdown
  const KEYS = ['calories', 'protein_g', 'fat_g', 'carbs_g', 'fiber_g'];
  _totals = Object.fromEntries(KEYS.map(k => [k, 0]));
  for (const row of _breakdown) {
    if (row.found || row._override) {
      for (const k of KEYS) _totals[k] += row[k] || 0;
    }
  }
  // Round totals
  for (const k of KEYS) _totals[k] = Math.round(_totals[k] * 10) / 10;

  _pendingNutrition = { ..._totals };
  _applyNutritionToForm(_totals);
  renderAndWireBreakdown();
  document.getElementById('ar-nutrition-panel').classList.remove('d-none');
  _updateSaveVisibility();
}

async function saveManualRecipe() {
  const saveBtn = document.getElementById('ar-btn-save');
  saveBtn.disabled = true;

  const nutrition    = _pendingNutrition || {};
  const ingredients  = getIngredients();
  const instructions = document.getElementById('ar-instructions').value.trim() || null;
  const servings = +document.getElementById('ar-servings').value || 1;

  // Manual macro fields are total recipe nutrition — divide by servings, same as USDA
  const manualCals  = parseFloat(document.getElementById('ar-calories').value) || null;
  const manualProt  = parseFloat(document.getElementById('ar-protein').value)  || null;
  const manualCarbs = parseFloat(document.getElementById('ar-carbs').value)    || null;
  const manualFat   = parseFloat(document.getElementById('ar-fat').value)      || null;
  const manualFiber = parseFloat(document.getElementById('ar-fiber').value)    || null;
  // If USDA check was run it already populated the form fields, so form values
  // ARE the USDA values. Source is usda_estimate when _pendingNutrition is set,
  // manual when the user typed values without running the check.
  const hasManual   = !_pendingNutrition && (manualCals || manualProt || manualCarbs || manualFat);

  // Both manual totals and USDA totals are divided by servings before storing
  const perServing = (v) => (v || null) && Math.round((v / servings) * 10) / 10;

  const finalCals  = perServing(manualCals  ?? nutrition.calories);
  const finalProt  = perServing(manualProt  ?? nutrition.protein_g);
  const finalCarbs = perServing(manualCarbs ?? nutrition.carbs_g);
  const finalFat   = perServing(manualFat   ?? nutrition.fat_g);
  const finalFiber = perServing(manualFiber ?? nutrition.fiber_g);
  const nutritionSource = _pendingNutrition ? 'usda_estimate' : (hasManual ? 'manual' : null);

  const payload = {
    name:             document.getElementById('ar-name').value.trim(),
    servings,
    calories:         finalCals,
    protein_g:        finalProt,
    carbs_g:          finalCarbs,
    fat_g:            finalFat,
    fiber_g:          finalFiber,
    nutrition_source: nutritionSource,
    ingredients,
    instructions,
  };

  try {
    let recipe;
    if (_editMode && _editingRecipeId) {
      recipe = await api.recipes.update(_editingRecipeId, payload);
      toast(`"${recipe.name}" updated`);
    } else {
      recipe = await api.recipes.create(payload);
      toast(`"${recipe.name}" saved`);
    }
    bootstrap.Modal.getOrCreateInstance(document.getElementById('modal-add-recipe')).hide();
    await loadRecipes();
    openRecipeModal(recipe.id);
  } catch (e) {
    document.getElementById('ar-error').textContent = e.message;
    document.getElementById('ar-error').classList.remove('d-none');
  } finally {
    saveBtn.disabled = false;
  }
}

// ── Shared helpers ─────────────────────────────────────────────────────────────

export function stars(filled, total = 5) {
  return Array.from({ length: total }, (_, i) =>
    `<span style="color:${i < filled ? '#f59e0b' : '#d1d5db'}">★</span>`
  ).join('');
}

function renderInstructions(text) {
  const lines = text.split('\n').map(s => s.trim()).filter(Boolean);
  // Numbered steps stored as "1. Step text"
  if (lines.length && /^\d+\.\s/.test(lines[0])) {
    return `<ol class="small lh-lg ps-3 mb-0">
      ${lines.map(s => `<li class="mb-2">${s.replace(/^\d+\.\s*/, '')}</li>`).join('')}
    </ol>`;
  }
  return `<div class="small lh-lg">${lines.join('<br>')}</div>`;
}

function cap(s) { return s ? s.charAt(0).toUpperCase() + s.slice(1) : ''; }

function escHtml(s) {
  return String(s).replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}
function escAttr(s) {
  return String(s).replace(/&/g,'&amp;').replace(/"/g,'&quot;');
}
