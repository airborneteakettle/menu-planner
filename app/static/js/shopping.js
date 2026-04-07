import { api }                            from './api.js';
import { getWeekDates, formatDate, toast } from './utils.js';

let _el         = null;
let shoppingOffset = 0;

const CHECKED_KEY = 'menu-planner-checked';

function getChecked() {
  try { return new Set(JSON.parse(localStorage.getItem(CHECKED_KEY) || '[]')); }
  catch { return new Set(); }
}
function saveChecked(set) {
  localStorage.setItem(CHECKED_KEY, JSON.stringify([...set]));
}

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
      <button class="btn btn-outline-success btn-sm" id="btn-print-list">
        <i class="bi bi-printer me-1"></i>Print
      </button>
    </div>
    <div id="shop-body">
      <div class="loading-state"><div class="spinner-border text-success"></div></div>
    </div>`;

  document.getElementById('shop-prev').addEventListener('click',  () => { shoppingOffset--; loadList(); });
  document.getElementById('shop-next').addEventListener('click',  () => { shoppingOffset++; loadList(); });
  document.getElementById('shop-today').addEventListener('click', () => { shoppingOffset = 0; loadList(); });
  document.getElementById('btn-print-list').addEventListener('click', printList);

  await loadList();
}

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
    const data = await api.menu.shopping(start, end);
    renderList(body, data);
  } catch (e) {
    body.innerHTML = `<div class="alert alert-danger">${e.message}</div>`;
  }
}

function renderList(body, data) {
  const checked = getChecked();

  if (!data.total_items) {
    body.innerHTML = `
      <div class="text-center text-muted py-5">
        <i class="bi bi-bag-x fs-1 d-block mb-2"></i>
        No meals planned for this week yet.<br>
        <a href="#planner">Open the planner</a> to build your menu.
      </div>`;
    return;
  }

  const categories = data.list;
  const html = Object.entries(categories).map(([cat, items]) => `
    <div class="mb-4">
      <div class="shop-category-header">
        <i class="bi bi-tag-fill me-1"></i>${cat}
        <span class="text-muted fw-normal ms-1">(${items.length})</span>
      </div>
      ${items.map(item => {
        const key     = item.name.toLowerCase();
        const isChecked = checked.has(key);
        return `
          <div class="shop-item${isChecked ? ' checked' : ''}" data-key="${key}">
            <input type="checkbox" ${isChecked ? 'checked' : ''}>
            <div class="flex-grow-1">
              <span class="shop-item-name">${item.name}</span>
              ${item.recipes?.length
                ? `<div class="shop-item-recipes">Used in: ${item.recipes.join(', ')}</div>`
                : ''}
            </div>
          </div>`;
      }).join('')}
    </div>`).join('');

  body.innerHTML = `
    <div class="row">
      <div class="col-lg-8">
        <div class="d-flex justify-content-between align-items-center mb-3 small text-muted">
          <span>${data.total_items} items total</span>
          <button class="btn btn-link btn-sm p-0 text-muted" id="btn-clear-checks">
            Clear all checks
          </button>
        </div>
        ${html}
      </div>
    </div>`;

  body.querySelectorAll('.shop-item input[type=checkbox]').forEach(cb => {
    cb.addEventListener('change', () => {
      const row = cb.closest('.shop-item');
      const key = row.dataset.key;
      const set = getChecked();
      cb.checked ? set.add(key) : set.delete(key);
      saveChecked(set);
      row.classList.toggle('checked', cb.checked);
    });
  });

  body.querySelector('#btn-clear-checks')?.addEventListener('click', () => {
    saveChecked(new Set());
    body.querySelectorAll('.shop-item').forEach(row => {
      row.classList.remove('checked');
      row.querySelector('input[type=checkbox]').checked = false;
    });
  });
}

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
      .btn, .loading-state, #btn-clear-checks, button { display: none !important; }
    </style>
    </head><body>
    <h1>Shopping List &mdash; ${week}</h1>
    ${content}
    </body></html>`);
  win.document.close();
  win.print();
}
