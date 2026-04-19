import { api }                            from './api.js';
import { getWeekDates, formatDate, toast } from './utils.js';

let _el            = null;
let shoppingOffset = 0;
let _categories    = []; // recipe categories for the current week
let _checkedKeys   = new Set();
let _weekStart     = '';
let _showChecked   = false; // checked items hidden by default
let _saving        = false; // guard against double-tap / Enter+click on mobile

export async function renderShopping(el) {
  _el = el;
  el.innerHTML = `
    <div class="d-flex align-items-center gap-3 mb-4 flex-wrap">
      <h2 class="mb-0 fw-bold me-auto">Shopping List</h2>
      <button class="btn btn-outline-secondary btn-sm" id="shop-prev">
        <i class="bi bi-chevron-left"></i> Prev
      </button>
      <span id="shop-week-label" class="fw-semibold small"></span>
      <button class="btn btn-outline-secondary btn-sm" id="shop-next">
        Next <i class="bi bi-chevron-right"></i>
      </button>
      <button class="btn btn-outline-secondary btn-sm" id="shop-today">This Week</button>
      <button class="btn btn-outline-secondary btn-sm" id="btn-toggle-checked" title="Toggle checked items">
        <i class="bi bi-eye-slash me-1"></i>Checked
      </button>
      <button class="btn btn-outline-success btn-sm" id="btn-print-list">
        <i class="bi bi-printer me-1"></i>Print
      </button>
    </div>
    <div id="shop-body">
      <div class="loading-state"><div class="spinner-border text-success"></div></div>
    </div>

    <!-- Add Item Modal (lives outside shop-body so it survives reloads) -->
    <div class="modal fade" id="add-item-modal" tabindex="-1" aria-hidden="true">
      <div class="modal-dialog modal-sm">
        <div class="modal-content">
          <div class="modal-header py-2">
            <h6 class="modal-title mb-0"><i class="bi bi-plus-circle me-1"></i>Add Item</h6>
            <button type="button" class="btn-close btn-sm" data-bs-dismiss="modal"></button>
          </div>
          <div class="modal-body pb-2">
            <div class="mb-2">
              <label class="form-label small mb-1">Qty</label>
              <input class="form-control form-control-sm" id="modal-qty-input" placeholder="e.g. 2 cups">
            </div>
            <div class="mb-2">
              <label class="form-label small mb-1">Item name <span class="text-danger">*</span></label>
              <input class="form-control form-control-sm" id="modal-name-input" placeholder="e.g. olive oil">
            </div>
            <div class="mb-1">
              <label class="form-label small mb-1">Category</label>
              <select class="form-select form-select-sm" id="modal-category-select"></select>
            </div>
          </div>
          <div class="modal-footer py-2">
            <button type="button" class="btn btn-secondary btn-sm" data-bs-dismiss="modal">Cancel</button>
            <button type="button" class="btn btn-success btn-sm" id="modal-save-btn">
              <i class="bi bi-plus-lg me-1"></i>Add
            </button>
          </div>
        </div>
      </div>
    </div>`;

  document.getElementById('shop-prev').addEventListener('click',  () => { shoppingOffset--; loadList(); });
  document.getElementById('shop-next').addEventListener('click',  () => { shoppingOffset++; loadList(); });
  document.getElementById('shop-today').addEventListener('click', () => { shoppingOffset = 0; loadList(); });
  document.getElementById('btn-print-list').addEventListener('click', printList);
  document.getElementById('btn-toggle-checked').addEventListener('click', toggleCheckedVisibility);

  // Modal save – single persistent listener (modal lives outside shop-body)
  document.getElementById('modal-save-btn').addEventListener('click', saveModalItem);
  document.getElementById('modal-name-input').addEventListener('keydown', e => {
    if (e.key === 'Enter') saveModalItem();
  });

  await loadList();
}

// ── Modal ──────────────────────────────────────────────────────────────────────

function openAddModal(prefilledCategory = '') {
  const select = document.getElementById('modal-category-select');
  const options = [..._categories];
  if (!options.includes('Miscellaneous')) options.push('Miscellaneous');

  select.innerHTML = options.map(c =>
    `<option value="${c}"${c === prefilledCategory ? ' selected' : ''}>${c}</option>`
  ).join('');

  // Clear inputs
  document.getElementById('modal-name-input').value = '';
  document.getElementById('modal-qty-input').value  = '';

  bootstrap.Modal.getOrCreateInstance(document.getElementById('add-item-modal')).show();
  setTimeout(() => document.getElementById('modal-name-input').focus(), 350);
}

async function saveModalItem() {
  if (_saving) return;
  const name = document.getElementById('modal-name-input').value.trim();
  if (!name) { document.getElementById('modal-name-input').focus(); return; }
  if (!_weekStart) { toast('Week not loaded yet — please wait', 'warning'); return; }

  const qty      = document.getElementById('modal-qty-input').value.trim() || null;
  const category = document.getElementById('modal-category-select').value || 'Miscellaneous';
  const btn      = document.getElementById('modal-save-btn');

  _saving = true;
  btn.disabled = true;
  try {
    await api.menu.customItems.add({ name, quantity: qty, category, week_start: _weekStart });
    bootstrap.Modal.getOrCreateInstance(document.getElementById('add-item-modal')).hide();
    await loadList();
  } catch (e) {
    toast(e.message, 'danger');
  } finally {
    _saving = false;
    btn.disabled = false;
  }
}

// ── Load / render ──────────────────────────────────────────────────────────────

async function loadList() {
  const { start, end } = getWeekDates(shoppingOffset);
  const labelEl = document.getElementById('shop-week-label');
  if (labelEl) {
    labelEl.textContent =
      `${formatDate(start, { month: 'short', day: 'numeric' })} – ${formatDate(end, { month: 'short', day: 'numeric', year: 'numeric' })}`;
  }

  const body = document.getElementById('shop-body');
  if (!body) return;
  body.innerHTML = `<div class="loading-state"><div class="spinner-border text-success"></div></div>`;

  try {
    const [data, custom, checkedArr] = await Promise.all([
      api.menu.shopping(start, end),
      api.menu.customItems.list(start),
      api.menu.shoppingChecked.get(start),
    ]);
    _checkedKeys = new Set(checkedArr);
    _weekStart   = start;
    renderList(body, data, custom);
  } catch (e) {
    body.innerHTML = `<div class="alert alert-danger">${e.message}</div>`;
  }
}

function shopItemHtml(item, isCustom = false) {
  const key       = isCustom ? `custom-${item.id}` : item.name.toLowerCase();
  const isChecked = _checkedKeys.has(key);
  return `
    <div class="shop-item${isChecked ? ' checked' : ''}" data-key="${key}"
         ${isCustom ? `data-custom-id="${item.id}" draggable="true"` : ''}>
      ${isCustom
        ? `<span class="drag-handle" title="Drag to change category"><i class="bi bi-grip-vertical"></i></span>`
        : ''}
      <input type="checkbox" ${isChecked ? 'checked' : ''}>
      <span class="shop-item-qty">${(item.quantity || '').trim()}</span>
      <span class="shop-item-name">${item.name.trim()}</span>
      ${!isCustom && item.recipes?.length
        ? `<span class="shop-item-recipes">${item.recipes.join(', ')}</span>`
        : ''}
      ${isCustom
        ? `<button class="btn-remove-custom ms-auto" data-id="${item.id}" title="Remove">
             <i class="bi bi-x"></i>
           </button>`
        : ''}
    </div>`;
}

function categorySection(cat, recipeItems, customItems) {
  const totalCount = recipeItems.length + customItems.length;
  const isMisc = cat === 'Miscellaneous';
  const icon   = isMisc ? 'bi-collection-fill' : 'bi-tag-fill';
  return `
    <div class="mb-4" data-section-category="${escAttr(cat)}">
      <div class="shop-category-header">
        <i class="bi ${icon} me-1"></i>${escHtml(cat)}
        <span class="text-muted fw-normal ms-1 section-count">(${totalCount})</span>
      </div>
      <div class="section-items">
        ${recipeItems.map(i => shopItemHtml(i)).join('')}
        ${customItems.map(i => shopItemHtml(i, true)).join('')}
      </div>
      <button class="btn-add-to-category" data-category="${escAttr(cat)}">
        <i class="bi bi-plus-sm"></i> Add Item
      </button>
    </div>`;
}

function renderList(body, data, custom = []) {
  // Group custom items by category
  const customByCat = {};
  for (const item of custom) {
    const cat = item.category || 'Miscellaneous';
    (customByCat[cat] = customByCat[cat] || []).push(item);
  }

  // All known categories (server always returns all, even if empty)
  const allCats = Object.keys(data.list || {});
  _categories = allCats.filter(c => c !== 'Miscellaneous'); // expose for modal dropdown

  const sections = [];

  // All recipe categories (always shown) + any matching custom items
  for (const cat of allCats) {
    sections.push(categorySection(cat, data.list[cat] || [], customByCat[cat] || []));
  }

  // Custom-item-only categories not already covered (not Miscellaneous)
  for (const cat of Object.keys(customByCat)) {
    if (cat !== 'Miscellaneous' && !allCats.includes(cat)) {
      sections.push(categorySection(cat, [], customByCat[cat]));
    }
  }

  // Miscellaneous always last (only if not already in allCats)
  if (!allCats.includes('Miscellaneous')) {
    sections.push(categorySection('Miscellaneous', [], customByCat['Miscellaneous'] || []));
  }

  const noMeals = allCats.every(cat => (data.list[cat] || []).length === 0)
    ? `<p class="text-muted small fst-italic mb-3">No meals planned — <a href="#planner">open the planner</a> to build your menu.</p>`
    : '';

  body.innerHTML = `
    <div class="row">
      <div class="col-lg-8">
        <div class="d-flex justify-content-between align-items-center mb-3 small text-muted">
          <span>${data.total_items} recipe items</span>
          <div class="d-flex align-items-center gap-2">
            <button class="btn btn-outline-success btn-sm" id="btn-add-item-top">
              <i class="bi bi-plus-lg me-1"></i>Add Item
            </button>
            <button class="btn btn-link btn-sm p-0 text-muted" id="btn-clear-checks">
              Clear all checks
            </button>
          </div>
        </div>
        ${noMeals}
        ${sections.join('')}
      </div>
    </div>`;

  // Top "+ Add Item" (no pre-filled category — defaults to first available)
  body.querySelector('#btn-add-item-top').addEventListener('click', () => {
    openAddModal(_categories[0] || 'Miscellaneous');
  });

  // Per-section "+ Add Item" buttons
  body.querySelectorAll('.btn-add-to-category').forEach(btn => {
    btn.addEventListener('click', () => openAddModal(btn.dataset.category));
  });

  // Checkbox toggle — whole row is the tap target for mobile friendliness.
  // A single handler on the row avoids the checkbox's own change event
  // firing a second time and double-toggling on touch devices.
  body.querySelectorAll('.shop-item').forEach(row => {
    row.addEventListener('click', async (e) => {
      if (e.target.closest('.btn-remove-custom')) return; // ignore delete button
      if (e.target.closest('.drag-handle')) return;       // ignore drag handle
      const cb = row.querySelector('input[type=checkbox]');
      if (!cb) return;
      // If the checkbox itself was clicked the browser already toggled it;
      // for clicks anywhere else on the row we toggle it manually.
      if (e.target !== cb) cb.checked = !cb.checked;
      const key = row.dataset.key;
      cb.checked ? _checkedKeys.add(key) : _checkedKeys.delete(key);
      row.classList.toggle('checked', cb.checked);
      applyCheckedVisibility();
      try {
        await api.menu.shoppingChecked.set(_weekStart, key, cb.checked);
      } catch (e) { toast(e.message, 'danger'); }
    });
  });

  // Clear all checks
  body.querySelector('#btn-clear-checks')?.addEventListener('click', async () => {
    body.querySelectorAll('.shop-item').forEach(row => {
      row.classList.remove('checked');
      row.style.display = '';
      row.querySelector('input[type=checkbox]').checked = false;
    });
    _checkedKeys.clear();
    try {
      await api.menu.shoppingChecked.clear(_weekStart);
    } catch (e) { toast(e.message, 'danger'); }
  });

  // Wire delete on existing custom rows
  body.querySelectorAll('[data-custom-id]').forEach(wireCustomDelete);

  // Drag-and-drop between categories (custom items only)
  setupDragAndDrop(body);

  // Apply current checked-visibility state
  applyCheckedVisibility();
}

// ── Drag and drop ─────────────────────────────────────────────────────────────

function setupDragAndDrop(body) {
  let dragSrc = null;

  body.querySelectorAll('[data-custom-id]').forEach(row => {
    row.addEventListener('dragstart', e => {
      dragSrc = row;
      row.classList.add('dragging');
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', row.dataset.customId);
    });

    row.addEventListener('dragend', () => {
      row.classList.remove('dragging');
      body.querySelectorAll('.section-items').forEach(z => z.classList.remove('drag-over'));
      dragSrc = null;
    });
  });

  body.querySelectorAll('.section-items').forEach(zone => {
    zone.addEventListener('dragover', e => {
      if (!dragSrc) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
    });

    zone.addEventListener('dragenter', e => {
      if (!dragSrc) return;
      e.preventDefault();
      const targetSection = zone.closest('[data-section-category]');
      const sourceSection = dragSrc.closest('[data-section-category]');
      if (targetSection !== sourceSection) zone.classList.add('drag-over');
    });

    zone.addEventListener('dragleave', e => {
      if (!zone.contains(e.relatedTarget)) zone.classList.remove('drag-over');
    });

    zone.addEventListener('drop', async e => {
      e.preventDefault();
      zone.classList.remove('drag-over');
      if (!dragSrc) return;

      const targetSection = zone.closest('[data-section-category]');
      const sourceSection = dragSrc.closest('[data-section-category]');
      if (!targetSection || !sourceSection || targetSection === sourceSection) return;

      const newCat = targetSection.dataset.sectionCategory;
      const id     = +dragSrc.dataset.customId;

      // Move the row into the target section-items
      zone.appendChild(dragSrc);

      // Refresh item counts on both sections
      refreshSectionCount(sourceSection);
      refreshSectionCount(targetSection);

      // Persist the category change
      try {
        await api.menu.customItems.update(id, { category: newCat });
      } catch (err) {
        toast(err.message, 'danger');
        await loadList(); // revert to server state on failure
      }
    });
  });
}

function applyCheckedVisibility() {
  const body = document.getElementById('shop-body');
  if (!body) return;

  // Set display directly on each item — more reliable than a CSS descendant
  // rule on mobile (avoids iOS Safari repaint issues with display:none toggling).
  body.querySelectorAll('.shop-item').forEach(row => {
    if (row.classList.contains('checked')) {
      row.style.display = _showChecked ? '' : 'none';
    } else {
      row.style.display = '';
    }
  });

  const btn  = document.getElementById('btn-toggle-checked');
  const icon = btn?.querySelector('i');
  if (_showChecked) {
    icon?.setAttribute('class', 'bi bi-eye me-1');
    btn?.classList.add('active');
  } else {
    icon?.setAttribute('class', 'bi bi-eye-slash me-1');
    btn?.classList.remove('active');
  }
}

function toggleCheckedVisibility() {
  _showChecked = !_showChecked;
  applyCheckedVisibility();
}

function wireCustomDelete(row) {
  row.querySelector('.btn-remove-custom')?.addEventListener('click', async () => {
    const id = +row.dataset.customId;
    try {
      await api.menu.customItems.remove(id);
      // Update section item count
      const section = row.closest('[data-section-category]');
      row.remove();
      if (section) refreshSectionCount(section);
    } catch (e) { toast(e.message, 'danger'); }
  });
}

function refreshSectionCount(section) {
  const n   = section.querySelectorAll('.shop-item').length;
  const el  = section.querySelector('.section-count');
  if (el) el.textContent = `(${n})`;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function escHtml(s) {
  return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}
function escAttr(s) {
  return s.replace(/"/g, '&quot;');
}

// ── Print ─────────────────────────────────────────────────────────────────────

function printList() {
  const content = document.getElementById('shop-body')?.innerHTML || '';
  const week    = document.getElementById('shop-week-label')?.textContent || '';
  const win = window.open('', '_blank');
  win.document.write(`
    <!DOCTYPE html><html><head>
    <title>Shopping List – ${week}</title>
    <style>
      body { font-family: sans-serif; font-size: 13px; padding: 20px; }
      h1 { font-size: 18px; margin-bottom: 16px; }
      .shop-category-header { font-weight: 700; font-size: 11px; text-transform: uppercase;
                              letter-spacing: .05em; margin: 16px 0 6px; border-bottom: 2px solid #ccc; }
      .shop-item { display: flex; align-items: center; gap: 8px; padding: 4px 0; border-bottom: 1px solid #eee; }
      .shop-item.checked .shop-item-name { text-decoration: line-through; color: #aaa; }
      .shop-item-recipes { font-size: 10px; color: #999; }
      input[type=checkbox] { width: 14px; height: 14px; }
      .btn, .loading-state, #btn-clear-checks, #btn-add-item-top, .btn-add-to-category, button { display: none !important; }
    </style>
    </head><body>
    <h1>Shopping List &mdash; ${week}</h1>
    ${content}
    </body></html>`);
  win.document.close();
  win.print();
}
