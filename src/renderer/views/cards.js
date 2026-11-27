import { h, iconEl, api, toast, plain } from '../ui.js';
import { t, tn } from '../i18n.js';

// The whole deck: add your own cards, and fix or delete any card.
export default function cards(root, S, ctx) {
  const page = h('div.page');
  root.append(page);
  let alive = true;
  let all = [];
  let query = '';
  let editing = null; // null: closed, {}: a new card, a card: editing it
  const list = h('div');

  const apply = (view) => {
    all = view.cards;
    ctx.setProfile(view.profile);
  };

  api(window.margin.listCards())
    .then((view) => {
      if (!alive) return;
      apply(view);
      draw();
    })
    .catch((e) => toast(e.message));

  function form() {
    const card = editing;
    const front = h('textarea.textarea', { id: 'card-front', maxlength: 300, rows: 2 });
    const back = h('textarea.textarea', { id: 'card-back', maxlength: 1000, rows: 3 });
    front.value = plain(card.front);
    back.value = plain(card.back);
    const papers = S.papers.filter((p) => p.status === 'ready');
    const source =
      card.id || !papers.length
        ? null
        : h(
            'select.select',
            { id: 'card-paper' },
            h('option', { value: '' }, t('No paper')),
            papers.map((p) => h('option', { value: p.id }, plain(p.outline.title))),
          );
    const error = h('p.error-text', { role: 'alert' });
    const submit = h('button.btn', { type: 'submit' }, card.id ? t('Save changes') : t('Add card'));
    return h(
      'form.cardform',
      {
        onsubmit: async (e) => {
          e.preventDefault();
          submit.disabled = true;
          try {
            apply(await api(window.margin.saveCard({ id: card.id, paperId: source?.value, front: front.value, back: back.value })));
            toast(card.id ? t('Card saved.') : t('Card added. It is ready to review now.'));
            editing = null;
            if (alive) draw();
          } catch (x) {
            error.textContent = x.message;
            submit.disabled = false;
          }
        },
      },
      h('label.label', { for: 'card-front' }, t('Question')),
      front,
      h('label.label', { for: 'card-back' }, t('Answer')),
      back,
      source ? [h('label.label', { for: 'card-paper' }, t('Paper (optional)')), source] : null,
      error,
      h(
        'div.row',
        {},
        submit,
        h(
          'button.btn.ghost',
          {
            type: 'button',
            onclick: () => {
              editing = null;
              draw();
            },
          },
          t('Cancel'),
        ),
      ),
    );
  }

  // Deleting a card cannot be undone, so it takes a second click.
  function deleteButton(card) {
    let armed = false;
    const button = h(
      'button.btn.sm.ghost',
      {
        onclick: async () => {
          if (!armed) {
            armed = true;
            button.textContent = t('Click again to remove');
            button.classList.replace('ghost', 'danger');
            setTimeout(() => {
              armed = false;
              button.textContent = t('Remove');
              button.classList.replace('danger', 'ghost');
            }, 3500);
            return;
          }
          try {
            apply(await api(window.margin.removeCard(card.id)));
            if (editing?.id === card.id) editing = null;
            if (alive) draw();
          } catch (e) {
            toast(e.message);
          }
        },
      },
      t('Remove'),
    );
    return button;
  }

  const open = (card) => {
    editing = card;
    draw();
    page.parentElement.scrollTop = 0;
    page.querySelector('#card-front').focus();
  };

  // Only the list is redrawn while searching, so the search box keeps focus.
  function drawList() {
    const q = query.trim().toLowerCase();
    const shown = q ? all.filter((c) => `${c.front} ${c.back} ${c.paperTitle}`.toLowerCase().includes(q)) : all;
    if (!shown.length) {
      list.replaceChildren(h('p.body', {}, q ? t('No cards match your search.') : t('No cards yet. Add your own, or finish a chapter.')));
      return;
    }
    list.replaceChildren(
      h(
        'table.table',
        {},
        h(
          'tbody',
          {},
          shown.map((c) =>
            h(
              'tr',
              {},
              h('td', {}, h('p.ptitle', {}, plain(c.front)), h('p.cardback', {}, plain(c.back)), h('p.small', {}, plain(c.paperTitle) || t('Your own card'))),
              h(
                'td',
                { style: 'width: 270px' },
                h('div.row', { style: 'justify-content: flex-end; gap: var(--s2)' }, h('button.btn.sm.secondary', { onclick: () => open(c) }, t('Edit')), deleteButton(c)),
              ),
            ),
          ),
        ),
      ),
    );
  }

  function draw() {
    const search = h('input.input.decksearch', {
      type: 'search',
      placeholder: t('Search your cards'),
      'aria-label': t('Search your cards'),
      oninput: (e) => {
        query = e.target.value;
        drawList();
      },
    });
    search.value = query;
    page.replaceChildren(
      h('button.link.quiet.back', { onclick: () => ctx.go({ name: 'review' }) }, iconEl('back'), t('Back to review')),
      h(
        'header.pagehead',
        {},
        h('div.stack', {}, h('p.label', {}, `${t('Review')} · ${tn(all.length, '{n} card in your deck|{n} cards in your deck')}`), h('h1.h1', {}, t('Your cards'))),
        editing ? null : h('button.btn', { onclick: () => open({ front: '', back: '' }) }, iconEl('plus'), t('Add card')),
      ),
      ...[editing ? form() : null, all.length > 5 ? search : null, list].filter(Boolean),
    );
    drawList();
  }

  return () => {
    alive = false;
  };
}
