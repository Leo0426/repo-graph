/* Presentation preferences and paging for already-authorized, loaded lists. */
const LIST_PAGE_SIZE = 50;
let listDensity = 'comfortable';
try { if (localStorage.getItem('repograph_list_density') === 'compact') listDensity = 'compact'; } catch (_) {}

function applyListDensity() {
  document.documentElement.dataset.listDensity = listDensity;
  document.querySelectorAll('[data-list-density-toggle]').forEach(button => {
    button.setAttribute('aria-pressed', String(listDensity === 'compact'));
  });
}

function toggleListDensity() {
  listDensity = listDensity === 'compact' ? 'comfortable' : 'compact';
  try { localStorage.setItem('repograph_list_density', listDensity); } catch (_) {}
  applyListDensity();
}

function renderListPagination(id, listId, total, requestedPage, change) {
  const pager = document.getElementById(id);
  const page = Math.max(0, Math.min(requestedPage, Math.max(0, Math.ceil(total / LIST_PAGE_SIZE) - 1)));
  pager.hidden = total === 0;
  if (!total) { pager.replaceChildren(); return page; }
  pager.innerHTML = `<span role="status">${esc(t('list.range', page * LIST_PAGE_SIZE + 1, Math.min(total, (page + 1) * LIST_PAGE_SIZE), total))}</span>
    ${total > LIST_PAGE_SIZE ? `<button type="button" class="btn btn-ghost" data-page-previous ${page === 0 ? 'disabled' : ''}>${esc(t('list.previous'))}</button>
    <button type="button" class="btn btn-ghost" data-page-next ${(page + 1) * LIST_PAGE_SIZE >= total ? 'disabled' : ''}>${esc(t('list.next'))}</button>` : ''}`;
  pager.querySelectorAll('button').forEach(button => button.addEventListener('click', () => {
    change(page + (button.hasAttribute('data-page-next') ? 1 : -1));
    const list = document.getElementById(listId);
    list.tabIndex = -1;
    list.focus({ preventScroll: true });
    list.scrollIntoView({ block: 'start', behavior: 'instant' });
  }));
  return page;
}

document.addEventListener('DOMContentLoaded', applyListDensity);
