const BASE = '/api';

async function req(path, options = {}) {
  const res = await fetch(BASE + path, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || `HTTP ${res.status}`);
  }
  return res.status === 204 ? null : res.json();
}

export const api = {
  recipes: {
    list:      (p = {})       => req('/recipes/?' + new URLSearchParams(p)),
    get:       (id)           => req(`/recipes/${id}`),
    import:    (url)          => req('/recipes/import', { method: 'POST', body: JSON.stringify({ url }) }),
    create:    (data)         => req('/recipes/', { method: 'POST', body: JSON.stringify(data) }),
    update:    (id, data)     => req(`/recipes/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
    setRating: (id, rating)   => req(`/recipes/${id}/rating`, { method: 'PATCH', body: JSON.stringify({ rating }) }),
    delete:    (id)           => req(`/recipes/${id}`, { method: 'DELETE' }),
    tags:      ()             => req('/recipes/tags/'),
  },
  menu: {
    week:     ()        => req('/menu/week'),
    range:    (s, e)    => req(`/menu/?start=${s}&end=${e}`),
    add:      (data)    => req('/menu/', { method: 'POST', body: JSON.stringify(data) }),
    remove:   (id)      => req(`/menu/${id}`, { method: 'DELETE' }),
    summary:  (date)    => req(`/menu/daily-summary?date=${date}`),
    shopping: (s, e)    => req(`/menu/shopping-list?start=${s}&end=${e}`),
  },
  goals: {
    list:    () => req('/goals/'),
    current: () => req('/goals/current'),
    create:  (d) => req('/goals/', { method: 'POST', body: JSON.stringify(d) }),
  },
};
