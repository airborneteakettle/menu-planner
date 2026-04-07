import { api }                               from './api.js';
import { getWeekDates, formatDate, today,
         toISODate, toast, MEAL_TYPES }       from './utils.js';
import { openRecipeModal }                    from './recipes.js';

let _el       = null;
let weekOffset = 0;

export async function renderPlanner(el) {
  _el = el;
  el.innerHTML = `
    <div class="d-flex align-items-center gap-3 mb-4 flex-wrap">
      <h2 class="mb-0 fw-bold me-auto">Weekly Planner</h2>
      <button class="btn btn-outline-secondary btn-sm" id="btn-prev-week">
        <i class="bi bi-chevron-left"></i> Prev
      </button>
      <span id="week-label" class="fw-semibold small"></span>
      <button class="btn btn-outline-secondary btn-sm" id="btn-next-week">
        Next <i class="bi bi-chevron-right"></i>
      </button>
      <button class="btn btn-outline-success btn-sm" id="btn-today">Today</button>
    </div>
    <div class="table-responsive">
      <div id="planner-grid" class="loading-state">
        <div class="spinner-border text-success"></div>
      </div>
    </div>`;

  document.getElementById('btn-prev-week').addEventListener('click', () => { weekOffset--; drawGrid(); });
  document.getElementById('btn-next-week').addEventListener('click', () => { weekOffset++; drawGrid(); });
  document.getElementById('btn-today').addEventListener('click', () => { weekOffset = 0; drawGrid(); });

  await drawGrid();
}

async function drawGrid() {
  const grid = document.getElementById('planner-grid');
  if (!grid) return;

  const { start, end, dates } = getWeekDates(weekOffset);
  document.getElementById('week-label').textContent =
    `${formatDate(start, { month: 'short', day: 'numeric' })} – ${formatDate(end, { month: 'short', day: 'numeric', year: 'numeric' })}`;

  grid.innerHTML = `<div class="loading-state"><div class="spinner-border text-success"></div></div>`;

  let entries;
  try {
    entries = await api.menu.range(start, end);
  } catch (e) {
    grid.innerHTML = `<div class="alert alert-danger">${e.message}</div>`;
    return;
  }

  // Build lookup: grid[date][meal_type] = [entry, ...]
  const lookup = {};
  for (const e of entries) {
    const d = lookup[e.date] = lookup[e.date] || {};
    (d[e.meal_type] = d[e.meal_type] || []).push(e);
  }

  const todayStr = today();
  const DAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

  const headerCols = dates.map((d, i) => {
    const isToday = d === todayStr;
    const label = `${DAY_NAMES[i]}<br><small>${formatDate(d, { month: 'short', day: 'numeric' })}</small>`;
    return `<th class="${isToday ? 'today-col' : ''}">${label}</th>`;
  }).join('');

  const rows = MEAL_TYPES.map(meal => {
    const cells = dates.map(date => {
      const isToday = date === todayStr;
      const dayEntries = (lookup[date]?.[meal] || []);
      const chips = dayEntries.map(e => `
        <span class="entry-chip" data-recipe-id="${e.recipe_id}" data-entry-id="${e.id}">
          <span class="chip-name">${e.recipe_name}</span>
          <button class="btn-remove" data-entry-id="${e.id}" title="Remove">×</button>
        </span>`).join('');
      return `
        <td class="planner-cell${isToday ? ' today-col' : ''}"
            data-date="${date}" data-meal="${meal}">
          ${chips}
          <button class="btn-add-entry" data-date="${date}" data-meal="${meal}">+</button>
        </td>`;
    }).join('');

    return `
      <tr>
        <td class="meal-label-cell">${meal}</td>
        ${cells}
      </tr>`;
  }).join('');

  grid.innerHTML = `
    <table class="table table-bordered planner-table mb-0">
      <thead>
        <tr>
          <th style="width:80px"></th>
          ${headerCols}
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>`;

  // Wire up recipe chip clicks
  grid.querySelectorAll('.entry-chip .chip-name').forEach(chip =>
    chip.addEventListener('click', () =>
      openRecipeModal(+chip.closest('.entry-chip').dataset.recipeId)
    )
  );

  // Wire up remove buttons
  grid.querySelectorAll('.btn-remove').forEach(btn =>
    btn.addEventListener('click', async e => {
      e.stopPropagation();
      try {
        await api.menu.remove(+btn.dataset.entryId);
        toast('Removed from menu', 'secondary');
        await drawGrid();
      } catch (err) {
        toast(err.message, 'danger');
      }
    })
  );

  // Wire up add buttons
  grid.querySelectorAll('.btn-add-entry').forEach(btn =>
    btn.addEventListener('click', () => {
      window._addMenuCallback = () => drawGrid();
      // Open recipe picker first if no recipe preselected
      openPlannerAddModal(btn.dataset.date, btn.dataset.meal);
    })
  );
}

function openPlannerAddModal(date, meal) {
  // Reuse the add-to-menu modal but we need to pick a recipe first
  // Show recipe picker inline in a simple prompt or modal
  // For now: open the recipes view to pick, then come back
  // Better: use a quick search modal
  openRecipePicker(date, meal);
}

function openRecipePicker(date, meal) {
  const existingModal = document.getElementById('modal-recipe-picker');
  if (existingModal) existingModal.remove();

  document.body.insertAdjacentHTML('beforeend', `
    <div class="modal fade" id="modal-recipe-picker" tabindex="-1">
      <div class="modal-dialog modal-dialog-scrollable">
        <div class="modal-content">
          <div class="modal-header">
            <h5 class="modal-title">
              Pick a Recipe &mdash;
              <small class="text-muted">${formatDate(date)} · ${meal}</small>
            </h5>
            <button type="button" class="btn-close" data-bs-dismiss="modal"></button>
          </div>
          <div class="modal-body p-2">
            <input class="form-control form-control-sm mb-2" id="picker-search"
                   placeholder="Search recipes...">
            <div id="picker-list" class="loading-state">
              <div class="spinner-border spinner-border-sm text-success"></div>
            </div>
          </div>
        </div>
      </div>
    </div>`);

  const modal = bootstrap.Modal.getOrCreateInstance(
    document.getElementById('modal-recipe-picker')
  );
  modal.show();

  api.recipes.list().then(recipes => {
    const listEl = document.getElementById('picker-list');
    if (!listEl) return;

    function renderList(items) {
      listEl.innerHTML = items.length
        ? items.map(r => `
            <div class="d-flex align-items-center p-2 border-bottom picker-row"
                 style="cursor:pointer" data-id="${r.id}" data-name="${r.name}">
              <div class="flex-grow-1">
                <div class="fw-medium small">${r.name}</div>
                <div class="text-muted" style="font-size:.72rem">
                  ${r.calories ? r.calories + ' kcal' : ''} ${r.meal_type || ''}
                </div>
              </div>
              <i class="bi bi-plus-circle text-success"></i>
            </div>`).join('')
        : '<p class="text-muted text-center py-3 small">No recipes found.</p>';

      listEl.querySelectorAll('.picker-row').forEach(row =>
        row.addEventListener('click', async () => {
          modal.hide();
          window._addMenuCallback = () => drawGrid();
          window.openAddMenuModal(+row.dataset.id, row.dataset.name, date, meal);
        })
      );
    }

    renderList(recipes);
    document.getElementById('picker-search').addEventListener('input', e => {
      const q = e.target.value.toLowerCase();
      renderList(q ? recipes.filter(r => r.name.toLowerCase().includes(q)) : recipes);
    });
  });

  document.getElementById('modal-recipe-picker').addEventListener('hidden.bs.modal', () => {
    document.getElementById('modal-recipe-picker')?.remove();
  });
}
