import { api }                               from './api.js';
import { getWeekDates, formatDate, today,
         toISODate, toast, MEAL_TYPES }       from './utils.js';
import { openRecipeModal, UNITS, parseIngredientLine, escHtml } from './recipes.js';

let _el        = null;
let weekOffset = 0;
let _users     = [];   // other users for share UI
let dayIndex = (new Date().getDay() + 6) % 7; // 0=Mon … 6=Sun for current day

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
  document.getElementById('btn-today').addEventListener('click',     () => { weekOffset = 0; drawGrid(); });

  // Load other users once (for share UI); if only one user, sharing controls stay hidden
  api.users.list().then(u => { _users = u; }).catch(() => {});

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

  // Build lookup: lookup[date][meal_type] = [entry, ...]
  const lookup = {};
  for (const e of entries) {
    const d = lookup[e.date] = lookup[e.date] || {};
    (d[e.meal_type] = d[e.meal_type] || []).push(e);
  }

  const todayStr = today();

  if (window.innerWidth < 768) {
    buildDayView(grid, dates, lookup, todayStr);
  } else {
    buildWeekTable(grid, dates, lookup, todayStr);
  }
}

function buildWeekTable(grid, dates, lookup, todayStr) {
  const DAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

  const headerCols = dates.map((d, i) => {
    const isToday = d === todayStr;
    const label = `${DAY_NAMES[i]}<br><small>${formatDate(d, { month: 'short', day: 'numeric' })}</small>`;
    return `<th class="${isToday ? 'today-col' : ''}">${label}</th>`;
  }).join('');

  const rows = MEAL_TYPES.map(meal => {
    const cells = dates.map(date => {
      const isToday    = date === todayStr;
      const dayEntries = lookup[date]?.[meal] || [];
      const chips      = dayEntries.map(e => entryChipHtml(e)).join('');
      return `
        <td class="planner-cell${isToday ? ' today-col' : ''}"
            data-date="${date}" data-meal="${meal}">
          ${chips}
          <button class="btn-add-entry" data-date="${date}" data-meal="${meal}">+</button>
        </td>`;
    }).join('');

    return `<tr><td class="meal-label-cell">${meal}</td>${cells}</tr>`;
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

  wireGrid(grid);
}

function buildDayView(grid, dates, lookup, todayStr) {
  const DAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  const date    = dates[dayIndex];
  const isToday = date === todayStr;

  const dayLabel = `${DAY_NAMES[dayIndex]}, ${formatDate(date, { month: 'short', day: 'numeric' })}`;

  const mealCards = MEAL_TYPES.map(meal => {
    const dayEntries = lookup[date]?.[meal] || [];
    const chips = dayEntries.map(e => entryChipHtml(e)).join('');
    return `
      <div class="card mb-2 border-0 shadow-sm day-meal-card">
        <div class="card-header bg-white py-2 d-flex align-items-center">
          <span class="small fw-bold text-uppercase" style="letter-spacing:.04em;color:#555">${meal}</span>
        </div>
        <div class="card-body py-2 px-3">
          <div class="d-flex flex-wrap gap-1 align-items-center">
            ${chips}
            <button class="btn-add-entry" data-date="${date}" data-meal="${meal}">+</button>
          </div>
        </div>
      </div>`;
  }).join('');

  grid.innerHTML = `
    <div class="d-flex align-items-center gap-2 mb-3">
      <button class="btn btn-outline-secondary btn-sm flex-shrink-0" id="btn-prev-day" title="Previous day">
        <i class="bi bi-chevron-left"></i>
      </button>
      <div class="text-center flex-grow-1">
        <div class="fw-semibold${isToday ? ' text-success' : ''}">${dayLabel}</div>
        ${isToday ? '<div class="badge bg-success" style="font-size:.6rem;line-height:1.4">Today</div>' : ''}
      </div>
      <button class="btn btn-outline-secondary btn-sm flex-shrink-0" id="btn-next-day" title="Next day">
        <i class="bi bi-chevron-right"></i>
      </button>
    </div>
    ${mealCards}`;

  document.getElementById('btn-prev-day').addEventListener('click', () => {
    if (dayIndex > 0) {
      dayIndex--;
      buildDayView(grid, dates, lookup, todayStr);
      wireGrid(grid);
    } else {
      weekOffset--;
      dayIndex = 6;
      drawGrid();
    }
  });

  document.getElementById('btn-next-day').addEventListener('click', () => {
    if (dayIndex < 6) {
      dayIndex++;
      buildDayView(grid, dates, lookup, todayStr);
      wireGrid(grid);
    } else {
      weekOffset++;
      dayIndex = 0;
      drawGrid();
    }
  });

  wireGrid(grid);
}

function entryChipHtml(e) {
  const isShared   = !e.is_mine;
  const hasShares  = e.shared_with?.length > 0;
  const sharedWith = (e.shared_with || []).join(', ');

  const chipClass  = isShared ? 'entry-chip entry-chip-shared' : 'entry-chip';
  const ownerBadge = isShared
    ? `<span class="chip-owner" title="Shared by ${e.owner}">${e.owner?.[0]?.toUpperCase()}</span>`
    : '';
  const shareIndicator = hasShares
    ? `<span class="chip-shared-badge" title="Shared with ${sharedWith}"><i class="bi bi-people-fill"></i></span>`
    : '';
  const shareBtn = e.is_mine
    ? `<button class="btn-share-entry" data-entry-id="${e.id}"
               data-shared-with='${JSON.stringify(e.shared_with || [])}' title="Share">
         <i class="bi bi-person-plus"></i>
       </button>`
    : '';
  const adhocBadge = e.is_adhoc
    ? `<span class="chip-adhoc-badge" title="Ad hoc meal"><i class="bi bi-pencil-square"></i></span>`
    : '';

  const n = e.nutrition;
  const nutritionHtml = n ? `
    <span class="chip-nutrition">
      ${n.calories != null  ? `<span>${Math.round(n.calories)}<span class="chip-nut-unit">cal</span></span>` : ''}
      ${n.protein_g != null ? `<span>${n.protein_g}<span class="chip-nut-unit">P</span></span>` : ''}
      ${n.fat_g != null     ? `<span>${n.fat_g}<span class="chip-nut-unit">F</span></span>` : ''}
      ${n.carbs_g != null   ? `<span>${n.carbs_g}<span class="chip-nut-unit">C</span></span>` : ''}
      ${n.fiber_g != null   ? `<span>${n.fiber_g}<span class="chip-nut-unit">Fi</span></span>` : ''}
    </span>` : '';

  return `
    <span class="${chipClass}"
          data-recipe-id="${e.recipe_id || ''}"
          data-entry-id="${e.id}"
          data-is-mine="${e.is_mine}"
          data-is-adhoc="${e.is_adhoc}">
      <span style="display:flex;align-items:center;gap:4px;width:100%">
        ${ownerBadge}
        ${adhocBadge}
        <span class="chip-name ${e.is_adhoc ? 'chip-name-adhoc' : ''}">${e.recipe_name || ''}</span>
        ${shareIndicator}
        ${shareBtn}
        <button class="btn-remove" data-entry-id="${e.id}" title="Remove">×</button>
      </span>
      ${nutritionHtml}
    </span>`;
}

function wireGrid(grid) {
  grid.querySelectorAll('.chip-name').forEach(el => {
    const chip = el.closest('.entry-chip');
    if (chip.dataset.isAdhoc === 'true') return; // no detail view for ad hoc
    el.addEventListener('click', () => openRecipeModal(+chip.dataset.recipeId));
  });

  grid.querySelectorAll('.btn-remove').forEach(btn =>
    btn.addEventListener('click', async e => {
      e.stopPropagation();
      try {
        await api.menu.remove(+btn.dataset.entryId);
        await drawGrid();
      } catch (err) { toast(err.message, 'danger'); }
    })
  );

  grid.querySelectorAll('.btn-add-entry').forEach(btn =>
    btn.addEventListener('click', () => {
      window._addMenuCallback = () => drawGrid();
      openRecipePicker(btn.dataset.date, btn.dataset.meal);
    })
  );

  grid.querySelectorAll('.btn-share-entry').forEach(btn =>
    btn.addEventListener('click', e => {
      e.stopPropagation();
      openSharePopover(btn);
    })
  );
}

// ── Share popover ─────────────────────────────────────────────────────────────

function openSharePopover(btn) {
  document.querySelectorAll('.share-popover').forEach(p => p.remove());

  if (!_users.length) {
    toast('No other users to share with.', 'secondary');
    return;
  }

  const entryId    = +btn.dataset.entryId;
  const sharedWith = JSON.parse(btn.dataset.sharedWith || '[]');

  const popover = document.createElement('div');
  popover.className = 'share-popover card shadow';
  popover.innerHTML = `
    <div class="card-body p-2">
      <div class="small fw-semibold text-muted mb-2" style="font-size:.7rem;text-transform:uppercase;letter-spacing:.05em">
        Share with
      </div>
      ${_users.map(u => {
        const shared = sharedWith.includes(u.username);
        return `
          <div class="form-check mb-1">
            <input class="form-check-input share-toggle" type="checkbox"
                   id="share-${entryId}-${u.id}"
                   data-user-id="${u.id}" data-username="${u.username}"
                   ${shared ? 'checked' : ''}>
            <label class="form-check-label small" for="share-${entryId}-${u.id}">
              ${u.username}
            </label>
          </div>`;
      }).join('')}
    </div>`;

  // Position near the button
  document.body.appendChild(popover);
  const rect = btn.getBoundingClientRect();
  popover.style.position = 'fixed';
  popover.style.top  = (rect.bottom + 4) + 'px';
  popover.style.left = (rect.left)       + 'px';
  popover.style.zIndex = '9999';
  popover.style.minWidth = '160px';

  popover.querySelectorAll('.share-toggle').forEach(cb => {
    cb.addEventListener('change', async () => {
      try {
        if (cb.checked) {
          await api.menu.share(entryId, +cb.dataset.userId);
        } else {
          await api.menu.unshare(entryId, +cb.dataset.userId);
        }
        // Update the button's data attribute for next open
        const chip = document.querySelector(`.entry-chip[data-entry-id="${entryId}"]`);
        if (chip) {
          const shareBtn = chip.querySelector('.btn-share-entry');
          if (shareBtn) {
            const current = JSON.parse(shareBtn.dataset.sharedWith || '[]');
            const next = cb.checked
              ? [...current, cb.dataset.username]
              : current.filter(u => u !== cb.dataset.username);
            shareBtn.dataset.sharedWith = JSON.stringify(next);

            // Update share indicator badge
            const indicator = chip.querySelector('.chip-shared-badge');
            if (next.length && !indicator) {
              chip.querySelector('.chip-name').insertAdjacentHTML('afterend',
                `<span class="chip-shared-badge" title="Shared with ${next.join(', ')}"><i class="bi bi-people-fill"></i></span>`);
            } else if (!next.length && indicator) {
              indicator.remove();
            } else if (indicator) {
              indicator.title = `Shared with ${next.join(', ')}`;
            }
          }
        }
      } catch (err) { toast(err.message, 'danger'); cb.checked = !cb.checked; }
    });
  });

  // Close on outside click
  setTimeout(() => {
    document.addEventListener('click', function close(ev) {
      if (!popover.contains(ev.target) && ev.target !== btn) {
        popover.remove();
        document.removeEventListener('click', close);
      }
    });
  }, 0);
}

// ── Recipe picker ─────────────────────────────────────────────────────────────

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
            <div class="d-flex gap-2 mb-2">
              <button class="btn btn-outline-secondary btn-sm flex-grow-1" id="btn-picker-adhoc">
                <i class="bi bi-pencil-square me-1"></i>Ad Hoc Meal
              </button>
              ${_users.length ? `
                <div class="dropdown">
                  <button class="btn btn-outline-secondary btn-sm dropdown-toggle" type="button"
                          data-bs-toggle="dropdown">
                    <i class="bi bi-people me-1"></i>Share with
                  </button>
                  <div class="dropdown-menu p-2" style="min-width:160px">
                    ${_users.map(u => `
                      <div class="form-check mb-1">
                        <input class="form-check-input picker-share" type="checkbox"
                               id="picker-share-${u.id}" data-user-id="${u.id}">
                        <label class="form-check-label small" for="picker-share-${u.id}">
                          ${u.username}
                        </label>
                      </div>`).join('')}
                  </div>
                </div>` : ''}
            </div>
            <input class="form-control form-control-sm mb-2" id="picker-search"
                   placeholder="Search all recipes...">
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

    // Top 5 by rating (my_rating first, then avg, unrated last)
    const top5 = [...recipes]
      .sort((a, b) => (b.my_rating || b.rating || 0) - (a.my_rating || a.rating || 0))
      .slice(0, 5);

    function renderList(items, isSearch = false) {
      const header = !isSearch
        ? `<div class="text-muted mb-1 px-1" style="font-size:.7rem;text-transform:uppercase;letter-spacing:.05em">Top rated</div>`
        : '';
      listEl.innerHTML = header + (items.length
        ? items.map(r => {
            const stars = r.my_rating || r.rating
              ? '★'.repeat(Math.round(r.my_rating || r.rating))
              : '';
            return `
              <div class="d-flex align-items-center p-2 border-bottom picker-row"
                   style="cursor:pointer" data-id="${r.id}" data-name="${r.name}">
                <div class="flex-grow-1">
                  <div class="fw-medium small">${r.name}</div>
                  <div class="text-muted" style="font-size:.72rem">
                    ${r.calories ? r.calories + ' kcal · ' : ''}${r.meal_type || ''}
                    ${stars ? `<span style="color:#f59e0b">${stars}</span>` : ''}
                  </div>
                </div>
                <i class="bi bi-plus-circle text-success"></i>
              </div>`;
          }).join('')
        : '<p class="text-muted text-center py-3 small">No recipes found.</p>');

      listEl.querySelectorAll('.picker-row').forEach(row =>
        row.addEventListener('click', () => {
          const shareWith = [...document.querySelectorAll('.picker-share:checked')]
            .map(cb => +cb.dataset.userId);
          modal.hide();
          window._addMenuCallback = () => drawGrid();
          window.openAddMenuModal(+row.dataset.id, row.dataset.name, date, meal, shareWith);
        })
      );
    }

    renderList(top5);
    document.getElementById('picker-search').addEventListener('input', e => {
      const q = e.target.value.trim().toLowerCase();
      if (q) {
        renderList(recipes.filter(r => r.name.toLowerCase().includes(q)), true);
      } else {
        renderList(top5);
      }
    });
  });

  document.getElementById('btn-picker-adhoc').addEventListener('click', () => {
    modal.hide();
    openAdHocModal(date, meal);
  });

  document.getElementById('modal-recipe-picker').addEventListener('hidden.bs.modal', () => {
    document.getElementById('modal-recipe-picker')?.remove();
  });
}

// ── Ad Hoc Meal: ingredient rows ──────────────────────────────────────────────

// Picker state for row-level USDA lookup inside the ad hoc modal
let _ahPickerIngRow    = null;   // the row element being looked up
let _ahPickerOffset    = 0;
let _ahPickerCandidates = [];
let _ahPickerIngredient = '';

function ahAddIngredientRow(amount = '', unit = '', name = '') {
  const container = document.getElementById('ah-ingredients');
  const row = document.createElement('div');
  row.className = 'input-group input-group-sm mb-1 ah-ingredient-row';
  row.innerHTML = `
    <input  type="text" class="form-control ah-ing-amount" placeholder="Qty"
            style="max-width:72px" value="${escHtml(amount)}">
    <select class="form-select ah-ing-unit" style="max-width:100px">
      ${UNITS.map(u => `<option value="${u}"${u === unit ? ' selected' : ''}>${u || '—'}</option>`).join('')}
    </select>
    <input  type="text" class="form-control ah-ing-name" placeholder="Ingredient name"
            value="${escHtml(name)}">
    <button type="button" class="btn btn-outline-secondary ah-ing-lookup" tabindex="-1"
            title="Look up in USDA database">
      <i class="bi bi-search"></i>
    </button>
    <button type="button" class="btn btn-outline-secondary ah-remove-row" tabindex="-1">
      <i class="bi bi-x"></i>
    </button>`;

  row.querySelector('.ah-remove-row').addEventListener('click', () => {
    if (container.querySelectorAll('.ah-ingredient-row').length > 1) row.remove();
  });

  row.querySelector('.ah-ing-lookup').addEventListener('click', () => ahOpenRowPicker(row));

  row.querySelector('.ah-ing-name').addEventListener('input', () => {
    if (row._preNutrition) {
      row._preNutrition = null;
      const btn = row.querySelector('.ah-ing-lookup');
      btn.innerHTML = '<i class="bi bi-search"></i>';
      btn.className  = 'btn btn-outline-secondary ah-ing-lookup';
      btn.title      = 'Look up in USDA database';
    }
  });

  row.querySelector('.ah-ing-name').addEventListener('keydown', e => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    const rows = [...container.querySelectorAll('.ah-ingredient-row')];
    const next = rows[rows.indexOf(row) + 1];
    if (next) next.querySelector('.ah-ing-amount').focus();
    else { ahAddIngredientRow(); container.lastElementChild.querySelector('.ah-ing-amount').focus(); }
  });

  container.appendChild(row);
}

function ahAddHeaderRow(name = '') {
  const container = document.getElementById('ah-ingredients');
  const row = document.createElement('div');
  row.className = 'input-group input-group-sm mb-1 ah-ingredient-row ah-header-row';
  row.innerHTML = `
    <span class="input-group-text bg-light text-muted small" style="font-size:0.7rem;letter-spacing:.05em;white-space:nowrap">SECTION</span>
    <input type="text" class="form-control fw-semibold ah-ing-header" placeholder="Section name" value="${escHtml(name)}">
    <button type="button" class="btn btn-outline-secondary ah-remove-row" tabindex="-1">
      <i class="bi bi-x"></i>
    </button>`;
  row.querySelector('.ah-remove-row').addEventListener('click', () => row.remove());
  container.appendChild(row);
  if (!name) setTimeout(() => row.querySelector('.ah-ing-header').focus(), 50);
}

function ahGetIngredients() {
  return [...document.querySelectorAll('.ah-ingredient-row')]
    .map(row => {
      if (row.classList.contains('ah-header-row')) {
        const name = row.querySelector('.ah-ing-header').value.trim();
        return name ? { quantity: null, name, is_header: true } : null;
      }
      const amount = row.querySelector('.ah-ing-amount').value.trim();
      const unit   = row.querySelector('.ah-ing-unit').value;
      const name   = row.querySelector('.ah-ing-name').value.trim();
      const qty    = [amount, unit].filter(Boolean).join(' ') || null;
      return { quantity: qty, name, preNutrition: row._preNutrition || null };
    })
    .filter(i => i?.name);
}

function ahParsePasted() {
  const text = document.getElementById('ah-paste-input').value;
  const lines = text.split(/\r?\n/);
  const parsed = lines.map(parseIngredientLine).filter(Boolean);
  if (!parsed.length) return;

  const container = document.getElementById('ah-ingredients');
  container.querySelectorAll('.ah-ingredient-row').forEach(row => {
    const input = row.classList.contains('ah-header-row') ? row.querySelector('.ah-ing-header') : null;
    const hasContent = input
      ? input.value.trim()
      : (row.querySelector('.ah-ing-amount').value.trim() || row.querySelector('.ah-ing-name').value.trim());
    if (!hasContent) row.remove();
  });

  for (const { amount, unit, name, is_header } of parsed) {
    if (is_header) ahAddHeaderRow(name);
    else ahAddIngredientRow(amount, unit, name);
  }

  document.getElementById('ah-paste-input').value = '';
  document.getElementById('ah-paste-area').classList.add('d-none');
}

// ── Ad Hoc: per-row USDA picker ───────────────────────────────────────────────

function ahOpenRowPicker(row) {
  _ahPickerIngRow = row;
  const amount = row.querySelector('.ah-ing-amount').value.trim();
  const unit   = row.querySelector('.ah-ing-unit').value;
  const name   = row.querySelector('.ah-ing-name').value.trim();
  if (!name) { row.querySelector('.ah-ing-name').focus(); return; }
  _ahPickerIngredient = [amount, unit, name].filter(Boolean).join(' ');
  _ahPickerOffset     = 0;
  _ahPickerCandidates = [];
  ahLoadPickerPage(0);
}

async function ahLoadPickerPage(offset) {
  _ahPickerOffset = offset;
  const panel = document.getElementById('ah-nutrition-panel');
  panel.classList.remove('d-none');
  panel.innerHTML = `
    <div class="d-flex align-items-center gap-2 mb-2 border-bottom pb-2">
      <button class="btn btn-sm btn-outline-secondary flex-shrink-0" id="ah-picker-back">
        <i class="bi bi-arrow-left me-1"></i>Back
      </button>
      <span class="small fw-medium text-truncate">${escHtml(_ahPickerIngredient)}</span>
    </div>
    <div id="ah-picker-body">
      <div class="loading-state py-3"><div class="spinner-border spinner-border-sm text-success"></div></div>
    </div>`;

  document.getElementById('ah-picker-back').addEventListener('click', () => {
    panel.classList.add('d-none');
    panel.innerHTML = '';
  });

  try {
    const data = await api.recipes.searchIngredient(_ahPickerIngredient, offset);
    _ahPickerCandidates = data.candidates;
    const body = document.getElementById('ah-picker-body');
    if (!body) return;
    body.innerHTML = ahRenderPickerPage(data);

    body.querySelectorAll('.ah-picker-select').forEach(btn => {
      btn.addEventListener('click', () => ahApplyRowPreselection(_ahPickerIngRow, _ahPickerCandidates[+btn.dataset.idx]));
    });
    const nextBtn = body.querySelector('#ah-picker-next');
    if (nextBtn) nextBtn.addEventListener('click', () => ahLoadPickerPage(+nextBtn.dataset.offset));
  } catch (e) {
    const body = document.getElementById('ah-picker-body');
    if (body) body.innerHTML = `<div class="alert alert-danger m-2">${escHtml(e.message)}</div>`;
  }
}

function ahRenderPickerPage({ food_name, grams, candidates, has_more, offset, total }) {
  if (!candidates.length)
    return `<p class="text-muted small p-3 mb-0">No results found for "${escHtml(food_name)}".</p>`;

  const unit = grams != null ? `scaled to ${grams}g` : 'per 100g';
  const header = `
    <div class="px-3 pt-2 pb-1 border-bottom bg-light" style="font-size:.75rem;color:#666">
      Showing ${offset + 1}–${offset + candidates.length}${total > 0 ? ' of ' + total : ''} &middot; values ${unit}
    </div>`;

  const rows = candidates.map((c, idx) => {
    const dtClass = c.dataType === 'Foundation'
      ? 'bg-success-subtle text-success-emphasis'
      : c.dataType === 'Branded'
        ? 'bg-warning-subtle text-warning-emphasis'
        : 'bg-secondary-subtle text-secondary-emphasis';
    const calStr  = c.calories  != null ? Math.round(c.calories) + ' kcal' : '—';
    const protStr = c.protein_g != null ? c.protein_g + 'g prot'  : '';
    const carbStr = c.carbs_g   != null ? c.carbs_g   + 'g carbs' : '';
    const fatStr  = c.fat_g     != null ? c.fat_g     + 'g fat'   : '';
    const macros  = [calStr, protStr, carbStr, fatStr].filter(Boolean).join(' · ');
    const servingLabel = c.serving_size_g
      ? `<span class="text-muted" style="font-size:.65rem">${c.serving_size_g}g/serving</span>` : '';
    return `
      <div class="picker-candidate border-bottom px-3 py-2">
        <div class="d-flex align-items-start gap-2">
          <div class="flex-grow-1 min-w-0">
            <div class="fw-medium lh-sm picker-desc">${escHtml(c.description)}</div>
            <div class="d-flex align-items-center gap-2 mt-1 flex-wrap">
              <span class="badge ${dtClass}" style="font-size:.6rem">${escHtml(c.dataType)}</span>
              ${servingLabel}
              <span class="text-muted picker-macros">${escHtml(macros)}</span>
            </div>
          </div>
          <button class="btn btn-outline-success btn-sm flex-shrink-0 ah-picker-select"
                  data-idx="${idx}">Select</button>
        </div>
      </div>`;
  }).join('');

  const moreBtn = has_more ? `
    <div class="text-center p-3">
      <button class="btn btn-outline-secondary btn-sm" id="ah-picker-next"
              data-offset="${offset + candidates.length}">
        <i class="bi bi-arrow-down me-1"></i>Next 10
      </button>
    </div>` : '';

  return header + rows + moreBtn;
}

function ahApplyRowPreselection(row, candidate) {
  row._preNutrition = {
    description: candidate.description,
    calories:    candidate.calories,
    protein_g:   candidate.protein_g,
    carbs_g:     candidate.carbs_g,
    fat_g:       candidate.fat_g,
    fiber_g:     candidate.fiber_g,
  };
  const btn = row.querySelector('.ah-ing-lookup');
  btn.innerHTML = '<i class="bi bi-check-lg"></i>';
  btn.className  = 'btn btn-success ah-ing-lookup';
  btn.title      = candidate.description;

  const panel = document.getElementById('ah-nutrition-panel');
  panel.classList.add('d-none');
  panel.innerHTML = '';
}

// ── Ad Hoc: Check Nutrition ───────────────────────────────────────────────────

async function ahCheckNutrition() {
  const errEl   = document.getElementById('adhoc-error');
  const spinner = document.getElementById('adhoc-check-spinner');
  const icon    = document.getElementById('adhoc-check-icon');
  const btn     = document.getElementById('btn-adhoc-check');
  const panel   = document.getElementById('ah-nutrition-panel');

  const ingredients = ahGetIngredients().filter(i => !i.is_header);
  if (!ingredients.length) {
    errEl.textContent = 'Add at least one ingredient before checking nutrition.';
    errEl.classList.remove('d-none');
    return;
  }

  errEl.classList.add('d-none');
  spinner.classList.remove('d-none');
  icon.classList.add('d-none');
  btn.disabled = true;

  try {
    const { totals, breakdown } = await api.recipes.estimateNutrition(ingredients);

    // Apply any row-level pre-selections
    const KEYS = ['calories', 'protein_g', 'fat_g', 'carbs_g', 'fiber_g'];
    ingredients.forEach((ing, idx) => {
      if (ing.preNutrition && idx < breakdown.length) {
        breakdown[idx] = {
          ...breakdown[idx], found: true,
          calories: ing.preNutrition.calories, protein_g: ing.preNutrition.protein_g,
          carbs_g:  ing.preNutrition.carbs_g,  fat_g:     ing.preNutrition.fat_g,
          fiber_g:  ing.preNutrition.fiber_g,  _override: ing.preNutrition.description,
        };
      }
    });

    const computed = Object.fromEntries(KEYS.map(k => [k, 0]));
    for (const row of breakdown) {
      if (row.found || row._override) for (const k of KEYS) computed[k] += row[k] || 0;
    }
    for (const k of KEYS) computed[k] = Math.round(computed[k] * 10) / 10;

    // Fill per-serving fields (total ÷ servings)
    const servings = +document.getElementById('adhoc-servings').value || 1;
    ahApplyNutritionToForm(computed, servings);

    // Show breakdown table
    panel.classList.remove('d-none');
    panel.innerHTML = ahRenderBreakdown(computed, breakdown, servings);
  } catch (e) {
    errEl.textContent = e.message;
    errEl.classList.remove('d-none');
  } finally {
    spinner.classList.add('d-none');
    icon.classList.remove('d-none');
    btn.disabled = false;
  }
}

function ahApplyNutritionToForm(totals, servings) {
  const s   = servings || 1;
  const fmtN = v => (v != null && v > 0) ? String(Math.round((v / s) * 10) / 10) : '';
  document.getElementById('adhoc-calories').value = totals.calories ? String(Math.round(totals.calories / s)) : '';
  document.getElementById('adhoc-protein').value  = fmtN(totals.protein_g);
  document.getElementById('adhoc-carbs').value    = fmtN(totals.carbs_g);
  document.getElementById('adhoc-fat').value      = fmtN(totals.fat_g);
  document.getElementById('adhoc-fiber').value    = fmtN(totals.fiber_g);
  ahUpdatePerServingPreview();
}

function ahUpdatePerServingPreview() {
  const preview  = document.getElementById('adhoc-per-serving-preview');
  const servings = +document.getElementById('adhoc-servings').value || 1;
  const cals  = parseFloat(document.getElementById('adhoc-calories').value);
  const prot  = parseFloat(document.getElementById('adhoc-protein').value);
  const carbs = parseFloat(document.getElementById('adhoc-carbs').value);
  const fat   = parseFloat(document.getElementById('adhoc-fat').value);
  const anyFilled = [cals, prot, carbs, fat].some(v => !isNaN(v) && v > 0);
  if (!anyFilled || servings <= 1) { preview.classList.add('d-none'); return; }
  preview.textContent =
    `Stored per serving: ${isNaN(cals) ? '—' : Math.round(cals)} kcal · ` +
    `${isNaN(prot) ? '—' : prot}g protein · ${isNaN(carbs) ? '—' : carbs}g carbs · ${isNaN(fat) ? '—' : fat}g fat`;
  preview.classList.remove('d-none');
}

function ahRenderBreakdown(totals, breakdown, servings) {
  const fmt = v => v == null ? '<span class="text-muted">—</span>' : Math.round(v * 10) / 10;
  const s   = servings || 1;

  const rows = breakdown.map(row => `
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
      </td>
      <td class="text-end">${fmt(row.calories)}</td>
      <td class="text-end">${fmt(row.protein_g)}</td>
      <td class="text-end">${fmt(row.carbs_g)}</td>
      <td class="text-end">${fmt(row.fat_g)}</td>
    </tr>`).join('');

  return `
    <div class="small fw-semibold text-muted text-uppercase mb-2" style="font-size:.7rem;letter-spacing:.05em">
      Estimated Nutrition
      <span class="badge badge-usda ms-1 text-lowercase" style="font-size:.65rem">USDA estimate</span>
    </div>
    <div style="max-height:200px;overflow-y:auto">
      <table class="table table-sm table-borderless mb-0" style="font-size:.8rem">
        <thead>
          <tr class="text-muted border-bottom">
            <th class="ps-0 fw-normal">Ingredient</th>
            <th class="text-end fw-normal">kcal</th>
            <th class="text-end fw-normal">Prot</th>
            <th class="text-end fw-normal">Carbs</th>
            <th class="text-end fw-normal">Fat</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
        <tfoot>
          <tr class="border-top fw-semibold">
            <td class="ps-0">Total</td>
            <td class="text-end">${Math.round(totals.calories)}</td>
            <td class="text-end">${fmt(totals.protein_g)}g</td>
            <td class="text-end">${fmt(totals.carbs_g)}g</td>
            <td class="text-end">${fmt(totals.fat_g)}g</td>
          </tr>
          ${s > 1 ? `
          <tr class="text-muted" style="font-size:.72rem">
            <td class="ps-0">Per serving (÷${s})</td>
            <td class="text-end">${Math.round(totals.calories / s)}</td>
            <td class="text-end">${fmt(totals.protein_g / s)}g</td>
            <td class="text-end">${fmt(totals.carbs_g   / s)}g</td>
            <td class="text-end">${fmt(totals.fat_g     / s)}g</td>
          </tr>` : ''}
        </tfoot>
      </table>
    </div>`;
}

// ── Ad Hoc Meal Modal ─────────────────────────────────────────────────────────

let _adhocEditId = null;  // null = create mode; entry id = edit mode

export function openAdHocModal(date, meal, entry = null) {
  _adhocEditId = entry ? entry.id : null;
  const n = entry?.nutrition || {};

  // Populate header fields
  document.getElementById('adhoc-name').value      = entry?.recipe_name || '';
  document.getElementById('adhoc-servings').value  = entry?.servings || 1;
  document.getElementById('adhoc-date').value      = entry?.date || date;
  document.getElementById('adhoc-meal-type').value = entry?.meal_type || meal || 'dinner';

  // Nutrition fields hold per-serving values
  document.getElementById('adhoc-calories').value = n.calories  != null ? Math.round(n.calories  * 10) / 10 : '';
  document.getElementById('adhoc-protein').value  = n.protein_g != null ? Math.round(n.protein_g * 10) / 10 : '';
  document.getElementById('adhoc-carbs').value    = n.carbs_g   != null ? Math.round(n.carbs_g   * 10) / 10 : '';
  document.getElementById('adhoc-fat').value      = n.fat_g     != null ? Math.round(n.fat_g     * 10) / 10 : '';
  document.getElementById('adhoc-fiber').value    = n.fiber_g   != null ? Math.round(n.fiber_g   * 10) / 10 : '';

  // Reset ingredient rows
  const container = document.getElementById('ah-ingredients');
  container.innerHTML = '';
  ahAddIngredientRow();
  ahAddIngredientRow();

  // Reset nutrition panel
  const panel = document.getElementById('ah-nutrition-panel');
  panel.classList.add('d-none');
  panel.innerHTML = `
    <div class="small fw-semibold text-muted text-uppercase mb-2" style="font-size:.7rem;letter-spacing:.05em">
      Estimated Nutrition <span class="badge badge-usda ms-1">USDA estimate</span>
    </div>
    <div id="ah-nutrition-values"></div>`;

  document.getElementById('adhoc-per-serving-preview').classList.add('d-none');
  document.getElementById('adhoc-error').classList.add('d-none');
  document.getElementById('ah-paste-area').classList.add('d-none');
  document.getElementById('ah-paste-input').value = '';

  // Reset Check Nutrition button
  document.getElementById('adhoc-check-icon').classList.remove('d-none');
  document.getElementById('adhoc-check-spinner').classList.add('d-none');

  // Update submit button and modal title for edit vs create
  document.getElementById('btn-adhoc-submit').innerHTML =
    `<span class="spinner-border spinner-border-sm d-none me-1" id="adhoc-spinner"></span>` +
    (_adhocEditId ? 'Save Changes' : 'Add to Planner');
  document.querySelector('#modal-adhoc-meal .modal-title').innerHTML =
    `<i class="bi bi-pencil-square me-1"></i>${_adhocEditId ? 'Edit Ad Hoc Meal' : 'Ad Hoc Meal'}`;

  bootstrap.Modal.getOrCreateInstance(document.getElementById('modal-adhoc-meal')).show();
  setTimeout(() => document.getElementById('adhoc-name').focus(), 300);
}

// Wire once at module load
document.addEventListener('DOMContentLoaded', () => {
  const submitBtn = document.getElementById('btn-adhoc-submit');
  if (!submitBtn) return;

  document.getElementById('ah-add-ingredient').addEventListener('click', () => ahAddIngredientRow());
  document.getElementById('ah-add-header').addEventListener('click',     () => ahAddHeaderRow());
  document.getElementById('btn-adhoc-check').addEventListener('click',   ahCheckNutrition);
  document.getElementById('adhoc-servings').addEventListener('input',    ahUpdatePerServingPreview);
  document.querySelectorAll('.ah-macro').forEach(el => el.addEventListener('input', ahUpdatePerServingPreview));

  document.getElementById('ah-paste-toggle').addEventListener('click', () => {
    const area   = document.getElementById('ah-paste-area');
    const hidden = area.classList.toggle('d-none');
    if (!hidden) setTimeout(() => document.getElementById('ah-paste-input').focus(), 50);
  });
  document.getElementById('ah-paste-parse').addEventListener('click', ahParsePasted);

  submitBtn.addEventListener('click', async () => {
    const name    = document.getElementById('adhoc-name').value.trim();
    const errEl   = document.getElementById('adhoc-error');
    const spinner = document.getElementById('adhoc-spinner');
    errEl.classList.add('d-none');
    if (!name) {
      errEl.textContent = 'A label is required.';
      errEl.classList.remove('d-none');
      document.getElementById('adhoc-name').focus();
      return;
    }
    const num      = id => { const v = parseFloat(document.getElementById(id).value); return isNaN(v) ? null : v; };
    const servings = +document.getElementById('adhoc-servings').value || 1;
    spinner.classList.remove('d-none');
    submitBtn.disabled = true;
    try {
      const payload = {
        date:            document.getElementById('adhoc-date').value,
        meal_type:       document.getElementById('adhoc-meal-type').value,
        servings,
        adhoc_name:      name,
        adhoc_calories:  num('adhoc-calories'),
        adhoc_protein_g: num('adhoc-protein'),
        adhoc_carbs_g:   num('adhoc-carbs'),
        adhoc_fat_g:     num('adhoc-fat'),
        adhoc_fiber_g:   num('adhoc-fiber'),
      };
      if (_adhocEditId) {
        await api.menu.update(_adhocEditId, payload);
      } else {
        await api.menu.add(payload);
      }
      bootstrap.Modal.getOrCreateInstance(document.getElementById('modal-adhoc-meal')).hide();
      if (typeof window._addMenuCallback === 'function') window._addMenuCallback();
    } catch (e) {
      errEl.textContent = e.message;
      errEl.classList.remove('d-none');
    } finally {
      spinner.classList.add('d-none');
      submitBtn.disabled = false;
    }
  });
});
