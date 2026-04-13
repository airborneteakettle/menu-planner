const BASE = '/api';

async function req(path, options = {}) {
  const res = await fetch(BASE + path, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  if (res.status === 401) {
    window.location.href = '/login';
    return;
  }
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    const err = new Error(data.error || `HTTP ${res.status}`);
    err.data = data;
    throw err;
  }
  return res.status === 204 ? null : res.json();
}

export const api = {
  recipes: {
    list:      (p = {})       => req('/recipes/?' + new URLSearchParams(p)),
    get:       (id)           => req(`/recipes/${id}`),
    import:    (url, fallbackName) => req('/recipes/import', { method: 'POST', body: JSON.stringify({ url, fallback_name: fallbackName || undefined }) }),
    estimateNutrition: (ings) => req('/recipes/estimate-nutrition', { method: 'POST', body: JSON.stringify({ ingredients: ings }) }),
    searchIngredient:  (ingredient, offset = 0) => req('/recipes/search-ingredient', { method: 'POST', body: JSON.stringify({ ingredient, offset }) }),
    create:    (data)         => req('/recipes/', { method: 'POST', body: JSON.stringify(data) }),
    update:    (id, data)     => req(`/recipes/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
    setRating: (id, rating)   => req(`/recipes/${id}/rating`, { method: 'PATCH', body: JSON.stringify({ rating }) }),
    delete:    (id)           => req(`/recipes/${id}`, { method: 'DELETE' }),
    tags:      (p = {})       => req('/recipes/tags/?' + new URLSearchParams(p)),
  },
  menu: {
    week:     ()        => req('/menu/week'),
    range:    (s, e)    => req(`/menu/?start=${s}&end=${e}`),
    add:      (data)    => req('/menu/', { method: 'POST', body: JSON.stringify(data) }),
    update:   (id, data) => req(`/menu/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
    remove:   (id)      => req(`/menu/${id}`, { method: 'DELETE' }),
    summary:  (date)    => req(`/menu/daily-summary?date=${date}`),
    weeklySummary: (start) => req(`/menu/weekly-summary${start ? '?start=' + start : ''}`),
    shopping: (s, e)    => req(`/menu/shopping-list?start=${s}&end=${e}`),
    share:   (id, userId) => req(`/menu/${id}/share`, { method: 'POST', body: JSON.stringify({ user_id: userId }) }),
    unshare: (id, userId) => req(`/menu/${id}/share/${userId}`, { method: 'DELETE' }),
    customItems: {
      list:   (weekStart) => req(`/menu/custom-items?week_start=${weekStart || ''}`),
      add:    (data)      => req('/menu/custom-items', { method: 'POST', body: JSON.stringify(data) }),
      remove: (id)        => req(`/menu/custom-items/${id}`, { method: 'DELETE' }),
    },
    shoppingChecked: {
      get:   (weekStart)              => req(`/menu/shopping-checked?week_start=${weekStart}`),
      set:   (weekStart, key, checked) => req('/menu/shopping-checked', { method: 'POST', body: JSON.stringify({ week_start: weekStart, item_key: key, checked }) }),
      clear: (weekStart)              => req(`/menu/shopping-checked?week_start=${weekStart}`, { method: 'DELETE' }),
    },
  },
  goals: {
    list:    () => req('/goals/'),
    current: () => req('/goals/current'),
    create:  (d) => req('/goals/', { method: 'POST', body: JSON.stringify(d) }),
  },
  users: {
    list: () => req('/users/'),
  },
  settings: {
    getAccount:      ()        => req('/settings/account'),
    updateAccount:   (email)   => req('/settings/account', { method: 'POST', body: JSON.stringify({ email }) }),
    autoTagRecipes:       ()  => req('/settings/auto-tag-recipes',       { method: 'POST' }),
    refreshUsdaNutrition: ()  => req('/settings/refresh-usda-nutrition', { method: 'POST' }),
    changePassword: (current_password, new_password) =>
      req('/settings/change-password', { method: 'POST', body: JSON.stringify({ current_password, new_password }) }),
  },
  household: {
    get:    ()           => req('/household/'),
    create: (name)       => req('/household/', { method: 'POST', body: JSON.stringify({ name }) }),
    invite: (identifier) => req('/household/invite', { method: 'POST', body: JSON.stringify({ identifier }) }),
    remove: (userId)     => req(`/household/members/${userId}`, { method: 'DELETE' }),
  },
  weight: {
    list:   ()     => req('/weight/'),
    log:    (data) => req('/weight/', { method: 'POST', body: JSON.stringify(data) }),
    remove: (id)   => req(`/weight/${id}`, { method: 'DELETE' }),
  },
};
