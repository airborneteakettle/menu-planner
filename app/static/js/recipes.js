import { api }                              from './api.js';
import { toast, fmt, MEAL_TYPES, MEAL_COLORS } from './utils.js';

let _el          = null;
let _allRecipes  = [];
let _activeTags  = new Set();
let _activeRating = 0;

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
  const query    = (document.getElementById('search-recipes')?.value || '').toLowerCase();
  const mealFil  = document.getElementById('filter-meal-type')?.value || '';
  const minRating = _activeRating;

  const filtered = _allRecipes.filter(r => {
    if (query    && !r.name.toLowerCase().includes(query)) return false;
    if (mealFil  && r.meal_type !== mealFil && !r.tags.includes(mealFil)) return false;
    if (minRating && (r.rating || 0) < minRating) return false;
    if (_activeTags.size && !r.tags.some(t => _activeTags.has(t))) return false;
    return true;
  });

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
  if (r.rating) {
    parts.push(
      `<span class="badge bg-warning-subtle text-warning-emphasis border" style="font-size:.68rem;letter-spacing:0">${stars(r.rating, 5)}</span>`
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
    <div class="col-sm-6 col-lg-4 col-xl-3">
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
        <div class="star-input" data-recipe-id="${r.id}" data-current="${r.rating || 0}">
          ${[1,2,3,4,5].map(v =>
            `<span class="star-btn" data-val="${v}"
                   style="color:${(r.rating||0) >= v ? '#f59e0b' : '#d1d5db'}">★</span>`
          ).join('')}
          <a href="#" class="clear-rating ms-1 small text-muted ${r.rating ? '' : 'd-none'}">clear</a>
        </div>
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
            ${r.ingredients.map(i => `
              <li class="py-1 border-bottom small d-flex gap-2">
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
        const idx = _allRecipes.findIndex(r => r.id === recipe.id);
        if (idx !== -1) { _allRecipes[idx].rating = val; refreshCardPills(recipe.id); }
      } catch (e) { toast(e.message, 'danger'); }
    });
  });

  clearLink?.addEventListener('click', async e => {
    e.preventDefault();
    try {
      await api.recipes.setRating(recipe.id, null);
      container.dataset.current = 0;
      paint(0);
      clearLink.classList.add('d-none');
      const idx = _allRecipes.findIndex(r => r.id === recipe.id);
      if (idx !== -1) { _allRecipes[idx].rating = null; refreshCardPills(recipe.id); }
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
  const url      = urlInput.value.trim();
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


// ── Manual Add Modal ──────────────────────────────────────────────────────────

let _pendingNutrition = null; // nutrition fetched but not yet saved

function openManualAddModal() {
  _pendingNutrition = null;
  document.getElementById('ar-name').value         = '';
  document.getElementById('ar-servings').value     = '4';
  document.getElementById('ar-instructions').value = '';
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

function setupManualAddModal() {
  document.getElementById('ar-add-ingredient').addEventListener('click', () => addIngredientRow());
  document.getElementById('ar-btn-check').addEventListener('click', checkNutrition);
  document.getElementById('ar-btn-save').addEventListener('click', saveManualRecipe);
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
      const amount = row.querySelector('.ar-ing-amount').value.trim();
      const unit   = row.querySelector('.ar-ing-unit').value;
      const name   = row.querySelector('.ar-ing-name').value.trim();
      const qty    = [amount, unit].filter(Boolean).join(' ') || null;
      return { quantity: qty, name };
    })
    .filter(i => i.name);
}

function renderNutritionBreakdown(totals, breakdown) {
  const fmtN = v => (v == null ? '<span class="text-muted">—</span>' : fmt(v));

  const rows = breakdown.map(row => `
    <tr class="${row.found ? '' : 'text-muted fst-italic'}">
      <td class="ps-0">
        ${row.quantity ? `<span class="text-muted me-1" style="font-size:.78rem">${escHtml(row.quantity)}</span>` : ''}
        ${escHtml(row.name)}
        ${!row.found ? `<span class="badge bg-warning-subtle text-warning-emphasis ms-1" style="font-size:.65rem">not found</span>` : ''}
      </td>
      <td class="text-end">${fmtN(row.calories)}</td>
      <td class="text-end">${fmtN(row.protein_g)}</td>
      <td class="text-end">${fmtN(row.carbs_g)}</td>
      <td class="text-end">${fmtN(row.fat_g)}</td>
    </tr>`).join('');

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
  const ingredients = getIngredients();
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
    _pendingNutrition = totals;

    document.getElementById('ar-nutrition-panel').innerHTML = renderNutritionBreakdown(totals, breakdown);
    panel.classList.remove('d-none');
    document.getElementById('ar-btn-save').classList.remove('d-none');
  } catch (e) {
    errEl.textContent = e.message;
    errEl.classList.remove('d-none');
  } finally {
    spinner.classList.add('d-none');
    icon.classList.remove('d-none');
    btn.disabled = false;
  }
}

async function saveManualRecipe() {
  const saveBtn = document.getElementById('ar-btn-save');
  saveBtn.disabled = true;

  const nutrition    = _pendingNutrition || {};
  const ingredients  = getIngredients();
  const instructions = document.getElementById('ar-instructions').value.trim() || null;

  try {
    const recipe = await api.recipes.create({
      name:         document.getElementById('ar-name').value.trim(),
      servings:     +document.getElementById('ar-servings').value || 1,
      calories:     nutrition.calories  || null,
      protein_g:    nutrition.protein_g || null,
      carbs_g:      nutrition.carbs_g   || null,
      fat_g:        nutrition.fat_g     || null,
      nutrition_source: _pendingNutrition ? 'usda_estimate' : null,
      ingredients,
      instructions,
    });
    bootstrap.Modal.getOrCreateInstance(document.getElementById('modal-add-recipe')).hide();
    toast(`"${recipe.name}" saved`);
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
  return s.replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}
