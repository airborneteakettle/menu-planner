import { api }                               from './api.js';
import { getWeekDates, formatDate, today,
         toISODate, toast, MEAL_TYPES }       from './utils.js';
import { openRecipeModal }                    from './recipes.js';

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

// ── Ad Hoc Meal USDA Lookup ───────────────────────────────────────────────────

let _adhocPickerOffset     = 0;
let _adhocPickerCandidates = [];
let _adhocPickerIngredient = '';

function _adhocEscHtml(s) {
  return String(s).replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

function openAdhocPicker() {
  const name = document.getElementById('adhoc-name').value.trim();
  if (!name) { document.getElementById('adhoc-name').focus(); return; }
  _adhocPickerIngredient = name;
  _adhocPickerOffset     = 0;
  _adhocPickerCandidates = [];
  loadAdhocPickerPage(0);
}

async function loadAdhocPickerPage(offset) {
  _adhocPickerOffset = offset;
  const panel = document.getElementById('adhoc-picker-panel');
  panel.classList.remove('d-none');
  panel.innerHTML = `<div class="loading-state py-3"><div class="spinner-border spinner-border-sm text-success"></div></div>`;

  try {
    const data = await api.recipes.searchIngredient(_adhocPickerIngredient, offset);
    _adhocPickerCandidates = data.candidates;
    panel.innerHTML = renderAdhocPickerPage(data);

    panel.querySelectorAll('.btn-adhoc-select').forEach(btn => {
      btn.addEventListener('click', () => {
        applyAdhocSelection(_adhocPickerCandidates[+btn.dataset.idx]);
      });
    });
    const nextBtn = panel.querySelector('#adhoc-picker-next');
    if (nextBtn) {
      nextBtn.addEventListener('click', () => loadAdhocPickerPage(+nextBtn.dataset.offset));
    }
  } catch (e) {
    panel.innerHTML = `<div class="alert alert-danger m-2">${_adhocEscHtml(e.message)}</div>`;
  }
}

function renderAdhocPickerPage(data) {
  const { food_name, grams, candidates, has_more, offset, total } = data;

  if (!candidates.length) {
    return `<p class="text-muted small p-3 mb-0">No results found for "${_adhocEscHtml(food_name)}".</p>`;
  }

  const unit   = grams != null ? `scaled to ${grams}g` : 'per 100g';
  const header = `
    <div class="d-flex align-items-center justify-content-between px-3 pt-2 pb-1 border-bottom"
         style="font-size:.75rem;color:#666">
      <span>Showing ${offset + 1}–${offset + candidates.length}${total > 0 ? ' of ' + total : ''} · values ${unit}</span>
      <button class="btn btn-link btn-sm p-0 text-muted" id="adhoc-picker-close" style="font-size:.75rem">
        Close
      </button>
    </div>`;

  const rows = candidates.map((c, idx) => {
    const dtClass = c.dataType === 'Foundation'
      ? 'bg-success-subtle text-success-emphasis'
      : c.dataType === 'Branded'
        ? 'bg-warning-subtle text-warning-emphasis'
        : 'bg-secondary-subtle text-secondary-emphasis';
    const calStr  = c.calories  != null ? Math.round(c.calories)  + ' kcal' : '—';
    const protStr = c.protein_g != null ? c.protein_g + 'g prot'  : '';
    const carbStr = c.carbs_g   != null ? c.carbs_g   + 'g carbs' : '';
    const fatStr  = c.fat_g     != null ? c.fat_g     + 'g fat'   : '';
    const macros  = [calStr, protStr, carbStr, fatStr].filter(Boolean).join(' · ');
    const servingLabel = c.serving_size_g
      ? `<span class="text-muted" style="font-size:.65rem">${c.serving_size_g}g/serving</span>`
      : '';
    return `
      <div class="border-bottom px-3 py-2" style="transition:background .1s" onmouseover="this.style.background='#f8f9fa'" onmouseout="this.style.background=''">
        <div class="d-flex align-items-start gap-2">
          <div class="flex-grow-1 min-w-0">
            <div class="fw-medium lh-sm" style="font-size:.82rem">${_adhocEscHtml(c.description)}</div>
            <div class="d-flex align-items-center gap-2 mt-1 flex-wrap">
              <span class="badge ${dtClass}" style="font-size:.6rem">${_adhocEscHtml(c.dataType)}</span>
              ${servingLabel}
              <span class="text-muted" style="font-size:.72rem">${_adhocEscHtml(macros)}</span>
            </div>
          </div>
          <button class="btn btn-outline-success btn-sm flex-shrink-0 btn-adhoc-select"
                  data-idx="${idx}">Select</button>
        </div>
      </div>`;
  }).join('');

  const moreBtn = has_more ? `
    <div class="text-center p-3">
      <button class="btn btn-outline-secondary btn-sm" id="adhoc-picker-next"
              data-offset="${offset + candidates.length}">
        <i class="bi bi-arrow-down me-1"></i>Next 10
      </button>
    </div>` : '';

  return header + rows + moreBtn;
}

function applyAdhocSelection(candidate) {
  const fmt1 = v => (v != null && v > 0) ? String(Math.round(v * 10) / 10) : '';
  document.getElementById('adhoc-calories').value = candidate.calories != null ? String(Math.round(candidate.calories)) : '';
  document.getElementById('adhoc-protein').value  = fmt1(candidate.protein_g);
  document.getElementById('adhoc-carbs').value    = fmt1(candidate.carbs_g);
  document.getElementById('adhoc-fat').value      = fmt1(candidate.fat_g);
  document.getElementById('adhoc-fiber').value    = fmt1(candidate.fiber_g);

  // Update lookup button to show it's been linked
  const btn = document.getElementById('btn-adhoc-lookup');
  btn.innerHTML = '<i class="bi bi-check-lg"></i>';
  btn.classList.remove('btn-outline-secondary');
  btn.classList.add('btn-success');
  btn.title = candidate.description;

  // Close the picker panel
  document.getElementById('adhoc-picker-panel').classList.add('d-none');
}

// ── Ad Hoc Meal Modal ─────────────────────────────────────────────────────────

let _adhocEditId = null;  // null = create mode; entry id = edit mode

export function openAdHocModal(date, meal, entry = null) {
  _adhocEditId = entry ? entry.id : null;
  const n = entry?.nutrition || {};
  document.getElementById('adhoc-name').value      = entry?.recipe_name || '';
  document.getElementById('adhoc-date').value      = entry?.date || date;
  document.getElementById('adhoc-meal-type').value = entry?.meal_type || meal || 'dinner';
  document.getElementById('adhoc-calories').value  = n.calories  != null ? n.calories  : '';
  document.getElementById('adhoc-protein').value   = n.protein_g != null ? n.protein_g : '';
  document.getElementById('adhoc-carbs').value     = n.carbs_g   != null ? n.carbs_g   : '';
  document.getElementById('adhoc-fat').value       = n.fat_g     != null ? n.fat_g     : '';
  document.getElementById('adhoc-fiber').value     = n.fiber_g   != null ? n.fiber_g   : '';
  document.getElementById('adhoc-error').classList.add('d-none');
  document.getElementById('adhoc-picker-panel').classList.add('d-none');
  // Reset lookup button to default state
  const lookupBtn = document.getElementById('btn-adhoc-lookup');
  lookupBtn.innerHTML = '<i class="bi bi-search"></i>';
  lookupBtn.className  = 'btn btn-outline-secondary';
  lookupBtn.title      = 'Look up in USDA database';
  // Update submit button label and modal title for edit vs create
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

  // Lookup button
  document.getElementById('btn-adhoc-lookup').addEventListener('click', openAdhocPicker);
  // Typing clears the linked state
  document.getElementById('adhoc-name').addEventListener('input', () => {
    const btn = document.getElementById('btn-adhoc-lookup');
    if (btn.classList.contains('btn-success')) {
      btn.innerHTML = '<i class="bi bi-search"></i>';
      btn.className  = 'btn btn-outline-secondary';
      btn.title      = 'Look up in USDA database';
    }
  });
  // Close picker via event delegation (the close button is dynamically rendered)
  document.getElementById('adhoc-picker-panel').addEventListener('click', e => {
    if (e.target.closest('#adhoc-picker-close')) {
      document.getElementById('adhoc-picker-panel').classList.add('d-none');
    }
  });
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
    const num = id => { const v = parseFloat(document.getElementById(id).value); return isNaN(v) ? null : v; };
    spinner.classList.remove('d-none');
    submitBtn.disabled = true;
    try {
      const payload = {
        date:            document.getElementById('adhoc-date').value,
        meal_type:       document.getElementById('adhoc-meal-type').value,
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
