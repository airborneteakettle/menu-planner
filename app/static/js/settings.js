import { api }   from './api.js';
import { toast }  from './utils.js';

export async function renderSettings(el) {
  el.innerHTML = `
    <h2 class="fw-bold mb-4">Settings</h2>

    <div class="row g-4">
      <div class="col-lg-6">

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
}

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
  return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}
