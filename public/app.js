/* Frontend logic for the dictionary UI */
const $ = (sel) => document.querySelector(sel);
const wordListEl = $('#wordList');
const detailEl = $('#detail');
const searchInput = $('#searchInput');
const clearSearchBtn = $('#clearSearchBtn');

let currentWord = null;
let debounceTimer = null;

function renderWordItem(word) {
  const li = document.createElement('li');
  li.textContent = word;
  li.addEventListener('click', () => selectWord(word, li));
  return li;
}

function setActiveItem(li) {
  [...wordListEl.children].forEach(item => item.classList.remove('active'));
  if (li) li.classList.add('active');
}

async function selectWord(word, li) {
  currentWord = word;
  setActiveItem(li);
  detailEl.innerHTML = '<div class="placeholder">در حال بارگذاری...</div>';
  try {
    const res = await fetch(`/api/words/${encodeURIComponent(word)}`);
    if (!res.ok) throw new Error('Failed');
    const data = await res.json();
    renderDetail(data);
  } catch (e) {
    detailEl.innerHTML = '<div class="placeholder">خطا در دریافت اطلاعات</div>';
  }
}

function renderDetail({ word, meaning, audioUrl, wikiUrl }) {
  const googleUrl = `https://www.google.com/search?q=${encodeURIComponent(word)}`;

  detailEl.innerHTML = `
    <h2 class="word ltr">${escapeHtml(word)}</h2>
    <div class="meaning rtl">${formatMeaning(meaning)}</div>
    <div class="actions with-icons">
      ${audioUrl ? `
        <button class="button" id="playBtn">
          <img class="icon-img" src="/icons/ic2.ico" alt="" aria-hidden="true" />
          Pronounce
        </button>` : ''}
      ${wikiUrl ? `
        <button class="button" onclick="window.open('${escapeAttribute(wikiUrl)}', '_blank')">
          <img class="icon-img" src="/icons/ic4.ico" alt="" aria-hidden="true" />
          Wikipedia
        </button>` : ''}
      <button class="button" onclick="window.open('${googleUrl}', '_blank')">
        <img class="icon-img" src="/icons/ic3.ico" alt="" aria-hidden="true" />
        Search on Google
      </button>
    </div>
  `;
  
  // After setting innerHTML, find and render placeholders.
  // This is safer as it avoids re-parsing the live DOM.
  detailEl.querySelectorAll('[data-math-placeholder]').forEach(el => {
    const formula = el.getAttribute('data-math-placeholder');
    const isDisplay = el.getAttribute('data-math-mode') === 'display';
    try {
      katex.render(formula, el, {
        throwOnError: false,
        displayMode: isDisplay,
        macros: {
          "\\u": "\\mathbf{u}",
          "\\g": "\\mathbf{g}"
        },
        trust: true,
      });
    } catch (e) {
      console.error('KaTeX Error:', e);
      el.textContent = formula;
    }
  });

  if ($('#playBtn')) {
    $('#playBtn').addEventListener('click', () => {
      const audioUrls = String(audioUrl).trim().split(/\s+/).filter(url => url.length > 0);
      
      if (audioUrls.length === 0) return;
      
      let currentIndex = 0;
      
      function playNext() {
        if (currentIndex >= audioUrls.length) return;
        
        const audio = new Audio(`${escapeAttribute(audioUrls[currentIndex])}`);
        audio.currentTime = 0;
        
        audio.addEventListener('ended', () => {
          currentIndex++;
          setTimeout(playNext, 200);
        });
        
        audio.addEventListener('error', () => {
          currentIndex++;
          playNext();
        });
        
        audio.play();
      }
      
      playNext();
    });
  }
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;','\'':'&#39;'}[c]));
}

function escapeAttribute(s) {
  return String(s).replace(/["'`<>]/g, c => ({'"':'&quot;','\'':'&#39;','`':'&#96;','<':'&lt;','>':'&gt;'}[c]));
}

function formatMeaning(s) {
  if (!s) return '<em style="color:#9ca3af">(بدون تعریف)</em>';
  
  let content = String(s);
  const replacements = [];
  let counter = 0;

  // Use a Markdown-safe placeholder that looks like an HTML comment.
  const placeholder = (i) => `<!--knt-math-p${i}-->`;

  // Stash display math $$...$$
  content = content.replace(/\$\$([\s\S]*?)\$\$/g, (match, formula) => {
    const id = counter++;
    replacements[id] = { formula: formula.trim(), isDisplay: true };
    return placeholder(id);
  });

  // Stash inline math $...$ using a more robust regex.
  content = content.replace(/\$([^\$]+?)\$/g, (match, formula) => {
    const id = counter++;
    replacements[id] = { formula: formula.trim(), isDisplay: false };
    return placeholder(id);
  });

  // Convert markdown to HTML
  let html = marked.parse(content, { breaks: true });

  // Restore math as placeholders to be rendered by KaTeX in the DOM
  for (let i = 0; i < replacements.length; i++) {
    const rep = replacements[i];
    if (!rep) continue;
    const placeholderHtml = `<span data-math-placeholder="${escapeAttribute(rep.formula)}" data-math-mode="${rep.isDisplay ? 'display' : 'inline'}"></span>`;
    html = html.replace(placeholder(i), placeholderHtml);
  }

  return html;
}

async function loadWords(q = '') {
  wordListEl.innerHTML = '';
  const url = q ? `/api/words?search=${encodeURIComponent(q)}` : '/api/words';
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error('Failed');
    const data = await res.json();
    if (!Array.isArray(data.items)) throw new Error('Bad data');
    data.items.forEach(w => wordListEl.appendChild(renderWordItem(w)));
  } catch (e) {
    wordListEl.innerHTML = '<li style="color:#f87171">خطا در دریافت لیست لغات</li>';
  }
}

searchInput.addEventListener('input', () => {
  const query = searchInput.value;
  clearSearchBtn.style.display = query.length > 0 ? 'block' : 'none';
  clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => loadWords(query.trim()), 300);
});

clearSearchBtn.addEventListener('click', () => {
  searchInput.value = '';
  loadWords('');
  clearSearchBtn.style.display = 'none';
  searchInput.focus();
});

loadWords();
