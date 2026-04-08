import { renderDashboard } from './dashboard.js';
import { renderRecipes }   from './recipes.js';
import { renderPlanner }   from './planner.js';
import { renderShopping }  from './shopping.js';
import { renderGoals }     from './goals.js';
import { renderSettings }  from './settings.js';
import { api }             from './api.js';
import { toast, today }    from './utils.js';

const VIEWS = {
  dashboard: { el: 'view-dashboard', fn: renderDashboard },
  recipes:   { el: 'view-recipes',   fn: renderRecipes },
  planner:   { el: 'view-planner',   fn: renderPlanner },
  shopping:  { el: 'view-shopping',  fn: renderShopping },
  goals:     { el: 'view-goals',     fn: renderGoals },
  settings:  { el: 'view-settings',  fn: renderSettings },
};

let activeView = null;

function route() {
  const name = (location.hash.slice(1) || 'dashboard').split('/')[0];
  const key  = VIEWS[name] ? name : 'dashboard';
  const view = VIEWS[key];

  document.querySelectorAll('#main-nav .nav-link').forEach(a =>
    a.classList.toggle('active', a.getAttribute('href') === '#' + key)
  );

  document.querySelectorAll('#bottom-nav a').forEach(a =>
    a.classList.toggle('active', a.getAttribute('href') === '#' + key)
  );

  Object.values(VIEWS).forEach(v =>
    document.getElementById(v.el).classList.add('d-none')
  );

  const el = document.getElementById(view.el);
  el.classList.remove('d-none');

  if (activeView !== key) {
    activeView = key;
    view.fn(el);
  }
}

// Any module can trigger a full re-render of the current view
window.refreshView = () => { activeView = null; route(); };

// ── Add-to-menu modal (shared between recipes, dashboard, planner) ────────────
window._addMenuCallback = null;

window.openAddMenuModal = function(recipeId, recipeName, prefillDate, prefillMeal) {
  document.getElementById('add-menu-recipe-id').value    = recipeId;
  document.getElementById('add-menu-recipe-name').textContent = recipeName || '';
  document.getElementById('add-menu-date').value         = prefillDate || today();
  document.getElementById('add-menu-meal-type').value    = prefillMeal || 'dinner';
  document.getElementById('add-menu-servings').value     = 1;
  document.getElementById('add-menu-error').classList.add('d-none');
  bootstrap.Modal.getOrCreateInstance(document.getElementById('modal-add-menu')).show();
};

document.addEventListener('DOMContentLoaded', () => {
  // Submit handler for add-to-menu modal
  document.getElementById('btn-add-menu-submit').addEventListener('click', async () => {
    const spinner = document.getElementById('add-menu-spinner');
    const errEl   = document.getElementById('add-menu-error');
    errEl.classList.add('d-none');
    spinner.classList.remove('d-none');

    try {
      await api.menu.add({
        recipe_id: +document.getElementById('add-menu-recipe-id').value,
        date:      document.getElementById('add-menu-date').value,
        meal_type: document.getElementById('add-menu-meal-type').value,
        servings:  +document.getElementById('add-menu-servings').value,
      });
      bootstrap.Modal.getOrCreateInstance(document.getElementById('modal-add-menu')).hide();
      toast('Added to menu');
      if (typeof window._addMenuCallback === 'function') window._addMenuCallback();
    } catch (e) {
      errEl.textContent = e.message;
      errEl.classList.remove('d-none');
    } finally {
      spinner.classList.add('d-none');
    }
  });

  route();
});

window.addEventListener('hashchange', route);
