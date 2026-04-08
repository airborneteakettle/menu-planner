import { api }   from './api.js';
import { toast }  from './utils.js';

export async function renderSettings(el) {
  el.innerHTML = `
    <h2 class="fw-bold mb-4">Settings</h2>
    <div class="row g-4">
      <div class="col-lg-6">

        <!-- Household card -->
        <div class="card mb-4" id="household-card">
          <div class="card-header bg-white fw-semibold">
            <i class="bi bi-house-heart me-2 text-success"></i>Household
          </div>
          <div class="card-body" id="household-body">
            <div class="text-center py-3">
              <div class="spinner-border spinner-border-sm text-success"></div>
            </div>
          </div>
        </div>

        <!-- Auto-tag card -->
        <div class="card">
          <div class="card-header bg-white fw-semibold">
            <i class="bi bi-tags me-2 text-success"></i>Auto-Tag Recipes by Protein
          </div>
          <div class="card-body">
            <p class="text-muted small mb-3">
              Scans every recipe's ingredients and automatically applies protein tags
              (chicken, beef, salmon, tofu, etc.) as well as
              <strong>vegetarian</strong> and <strong>vegan</strong> where applicable.
              Already-tagged recipes will only receive new tags — nothing is removed.
            </p>
            <button class="btn btn-success" id="btn-run-auto-tag">
              <i class="bi bi-play-fill me-1"></i>Run Auto-Tag
            </button>
          </div>
          <div id="auto-tag-results" class="card-body border-top d-none pt-3">
          </div>
        </div>

      </div>
    </div>`;

  document.getElementById('btn-run-auto-tag').addEventListener('click', runAutoTag);
  await loadHousehold();
}

// ── Household ─────────────────────────────────────────────────────────────────

async function loadHousehold() {
  const body = document.getElementById('household-body');
  try {
    const h = await api.household.get();
    renderHouseholdBody(body, h);
  } catch (e) {
    body.innerHTML = `<p class="text-danger small">${esc(e.message)}</p>`;
  }
}

function renderHouseholdBody(body, h) {
  if (!h) {
    body.innerHTML = `
      <p class="text-muted small mb-3">
        You're not part of a household yet. Create one to share your menu and
        shopping list with family or housemates.
      </p>
      <button class="btn btn-success btn-sm" id="btn-create-household">
        <i class="bi bi-plus-lg me-1"></i>Create Household
      </button>`;
    document.getElementById('btn-create-household').addEventListener('click', createHousehold);
    return;
  }

  const memberRows = h.members.map(m => `
    <li class="list-group-item d-flex align-items-center gap-2 py-1 px-2">
      <i class="bi bi-person-circle text-muted"></i>
      <span class="flex-grow-1 small">${esc(m.username)}</span>
      <button class="btn btn-link btn-sm p-0 text-danger btn-remove-member"
              data-user-id="${m.id}" title="Remove">
        <i class="bi bi-x-lg"></i>
      </button>
    </li>`).join('');

  body.innerHTML = `
    ${h.name ? `<p class="small text-muted mb-2 fw-semibold">${esc(h.name)}</p>` : ''}
    <ul class="list-group list-group-flush mb-3">${memberRows}</ul>
    <div class="d-flex gap-2">
      <input class="form-control form-control-sm" id="invite-identifier"
             placeholder="Username or email…" style="max-width:220px">
      <button class="btn btn-outline-success btn-sm" id="btn-invite-member">
        <i class="bi bi-person-plus me-1"></i>Add
      </button>
    </div>`;

  body.querySelectorAll('.btn-remove-member').forEach(btn => {
    btn.addEventListener('click', () => removeMember(+btn.dataset.userId));
  });

  document.getElementById('btn-invite-member').addEventListener('click', inviteMember);
  document.getElementById('invite-identifier').addEventListener('keydown', e => {
    if (e.key === 'Enter') inviteMember();
  });
}

async function createHousehold() {
  try {
    const h = await api.household.create('');
    renderHouseholdBody(document.getElementById('household-body'), h);
    toast('Household created');
  } catch (e) { toast(e.message, 'danger'); }
}

async function inviteMember() {
  const input = document.getElementById('invite-identifier');
  const identifier = (input.value || '').trim();
  if (!identifier) return;
  try {
    await api.household.invite(identifier);
    input.value = '';
    toast(`Added ${esc(identifier)} to household`);
    await loadHousehold();
  } catch (e) { toast(e.message, 'danger'); }
}

async function removeMember(userId) {
  try {
    await api.household.remove(userId);
    await loadHousehold();
  } catch (e) { toast(e.message, 'danger'); }
}

// ── Auto-tag ──────────────────────────────────────────────────────────────────

async function runAutoTag() {
  const btn     = document.getElementById('btn-run-auto-tag');
  const results = document.getElementById('auto-tag-results');

  btn.disabled = true;
  btn.innerHTML = `<span class="spinner-border spinner-border-sm me-1"></span>Running…`;
  results.classList.add('d-none');

  try {
    const data = await api.settings.autoTagRecipes();
    renderResults(results, data);
    toast(`Auto-tag complete — ${data.tags_added} tag${data.tags_added !== 1 ? 's' : ''} added across ${data.recipes_processed} recipes`);
  } catch (e) {
    toast(e.message, 'danger');
  } finally {
    btn.disabled = false;
    btn.innerHTML = `<i class="bi bi-play-fill me-1"></i>Run Auto-Tag`;
  }
}

function renderResults(container, data) {
  const changed = data.results.filter(r => r.added.length > 0);

  let html = `
    <div class="d-flex gap-3 mb-3 small">
      <span><strong>${data.recipes_processed}</strong> recipes scanned</span>
      <span><strong>${data.tags_added}</strong> tags added</span>
    </div>`;

  if (changed.length === 0) {
    html += `<p class="text-muted small fst-italic mb-0">All recipes were already up to date.</p>`;
  } else {
    html += `
      <div class="small fw-semibold text-muted mb-2 text-uppercase" style="font-size:.7rem;letter-spacing:.05em">
        Changes
      </div>
      <div style="max-height:300px;overflow-y:auto">
        <table class="table table-sm table-borderless mb-0" style="font-size:.82rem">
          <tbody>
            ${changed.map(r => `
              <tr>
                <td class="text-truncate" style="max-width:200px">${esc(r.name)}</td>
                <td>
                  ${r.added.map(t => `<span class="badge bg-light text-dark border me-1">${esc(t)}</span>`).join('')}
                </td>
              </tr>`).join('')}
          </tbody>
        </table>
      </div>`;
  }

  container.innerHTML = html;
  container.classList.remove('d-none');
}

function esc(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}
