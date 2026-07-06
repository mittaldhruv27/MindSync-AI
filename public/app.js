// --- APP STATE & INITIALIZATION ---
let allNotes = [];
let allTasks = [];
let allConflicts = [];
let allSprouts = [];
let allActions = [];
let activeModalNote = null;

// Local authorization token storage
let apiSecret = localStorage.getItem('mindsync_secret') || 'mindsync_secret_passphrase_2026';

// HTTP API Fetch Helper
function apiFetch(url, options = {}) {
  options.headers = {
    ...options.headers,
    'Authorization': `Bearer ${apiSecret}`,
    'Content-Type': 'application/json'
  };
  return fetch(url, options).then(async (res) => {
    if (res.status === 401) {
      const statusEl = document.getElementById('connection-status');
      statusEl.classList.remove('connected');
      statusEl.classList.add('disconnected');
      statusEl.innerHTML = '<span class="indicator"></span> Unauthorized';
      throw new Error('Unauthorized');
    }
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || `HTTP error ${res.status}`);
    }
    const statusEl = document.getElementById('connection-status');
    statusEl.classList.remove('disconnected');
    statusEl.classList.add('connected');
    statusEl.innerHTML = '<span class="indicator"></span> Online';
    return res.json();
  });
}

// Log activity feed locally on the dashboard console
function logActivity(agent, message) {
  const timeline = document.getElementById('activity-timeline');
  const item = document.createElement('div');
  item.className = 'timeline-item';
  
  const timeStr = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  item.innerHTML = `
    <span class="time">${timeStr}</span>
    <span class="event"><b>[${agent}]</b> ${message}</span>
  `;
  timeline.insertBefore(item, timeline.firstChild);
}

// Initialize all modules
window.addEventListener('DOMContentLoaded', async () => {
  initNavigation();
  initSidebarCollapse();
  initSettings();
  initNotesModule();
  initChatModule();
  initTaskModule();
  initConflictModule();
  initSproutsModule();
  initVoiceRecorderModule();
  initActionsModule();
  
  // Seed the auth field
  document.getElementById('settings-token').value = apiSecret;
  
  // Load database content
  await loadAllData();
  

});

async function loadAllData() {
  try {
    const stats = await apiFetch('/api/stats');
    document.getElementById('stat-notes').innerText = stats.notesCount;
    document.getElementById('stat-tasks').innerText = stats.tasksCount;
    document.getElementById('stat-conflicts').innerText = stats.conflictsCount;
    document.getElementById('stat-sprouts').innerText = stats.sproutsCount;

    allNotes = await apiFetch('/api/notes');
    allTasks = await apiFetch('/api/tasks');
    allConflicts = await apiFetch('/api/conflicts');
    allSprouts = await apiFetch('/api/sprouts');
    allActions = await apiFetch('/api/actions');
    const dailyDigest = await apiFetch('/api/daily-digest');

    renderNotesList(allNotes);
    renderTasksKanban(allTasks);
    renderConflictsList(allConflicts);
    renderSproutsList(allSprouts);
    renderActionsList(allActions);
    renderGrowthChart(allNotes);
    
    // Load daily briefing note
    renderDailyBriefing(dailyDigest);



  } catch (err) {
    console.error('Failed to load dashboard data:', err);
    logActivity('System', 'Failed to retrieve database contents. Please verify Bearer configuration.');
  }
}

// --- MODULE 0: SIDEBAR COLLAPSE ---
function initSidebarCollapse() {
  const sidebar = document.getElementById('main-sidebar');
  const btn = document.getElementById('btn-collapse-sidebar');
  if (!sidebar || !btn) return;

  // Restore persisted state
  if (localStorage.getItem('mindsync_sidebar_collapsed') === 'true') {
    sidebar.classList.add('collapsed');
  }

  btn.addEventListener('click', () => {
    const isCollapsed = sidebar.classList.toggle('collapsed');
    localStorage.setItem('mindsync_sidebar_collapsed', isCollapsed);
  });
}

// --- MODULE 1: NAVIGATION ---
function initNavigation() {
  const navItems = document.querySelectorAll('.nav-item[data-panel]');
  const sections = document.querySelectorAll('.panel-section');

  navItems.forEach(item => {
    item.addEventListener('click', () => {
      const panelId = item.dataset.panel;

      navItems.forEach(n => n.classList.remove('active'));
      sections.forEach(s => s.classList.remove('active'));

      item.classList.add('active');
      const targetSection = document.getElementById(`panel-${panelId}`);
      if (targetSection) {
        targetSection.classList.add('active');
      }


    });
  });
}

// --- MODULE 2: CREDENTIALS SETTINGS ---
function initSettings() {
  const modal = document.getElementById('settings-modal');
  
  document.getElementById('btn-show-settings').addEventListener('click', async () => {
    modal.classList.remove('hidden');
    try {
      const settings = await apiFetch('/api/settings');
      document.getElementById('settings-smtp-host').value = settings.smtpHost || '';
      document.getElementById('settings-smtp-port').value = settings.smtpPort || '587';
      document.getElementById('settings-smtp-user').value = settings.smtpUser || '';
      document.getElementById('settings-smtp-pass').value = settings.smtpPass || '';
    } catch (err) {
      console.error('Failed to load SMTP settings:', err);
    }
  });
  
  document.getElementById('btn-close-settings').addEventListener('click', () => {
    modal.classList.add('hidden');
  });
  
  document.getElementById('btn-save-settings').addEventListener('click', async () => {
    const inputVal = document.getElementById('settings-token').value.trim();
    if (inputVal) {
      apiSecret = inputVal;
      localStorage.setItem('mindsync_secret', apiSecret);
      logActivity('Settings', 'Bearer token authorization passphrase updated.');
    }
    
    const smtpHost = document.getElementById('settings-smtp-host').value.trim();
    const smtpPort = document.getElementById('settings-smtp-port').value.trim();
    const smtpUser = document.getElementById('settings-smtp-user').value.trim();
    const smtpPass = document.getElementById('settings-smtp-pass').value.trim();
    
    try {
      await apiFetch('/api/settings', {
        method: 'POST',
        body: JSON.stringify({ smtpHost, smtpPort, smtpUser, smtpPass })
      });
      logActivity('Settings', 'Email SMTP credentials updated successfully.');
      loadAllData();
      modal.classList.add('hidden');
    } catch (err) {
      alert('Failed to save settings: ' + err.message);
    }
  });
}

// --- MODULE 3: NOTES & CLIPPER ---
let isSemanticSearch = false;

function initNotesModule() {
  // Delete all notes trigger
  const btnDeleteAll = document.getElementById('btn-delete-all-notes');
  if (btnDeleteAll) {
    btnDeleteAll.addEventListener('click', async () => {
      if (confirm('Are you sure you want to delete all notes? This will also clear all tasks, conflicts, and sprouts.')) {
        try {
          await apiFetch('/api/notes', {
            method: 'DELETE'
          });
          logActivity('System', 'All notes and derived knowledge have been cleared.');
          loadAllData();
        } catch (err) {
          alert('Failed to delete notes: ' + err.message);
        }
      }
    });
  }

  // Add note trigger
  document.getElementById('btn-add-note').addEventListener('click', () => {
    document.getElementById('add-note-modal').classList.remove('hidden');
  });
  document.getElementById('btn-close-add-modal').addEventListener('click', () => {
    document.getElementById('add-note-modal').classList.add('hidden');
  });
  document.getElementById('btn-cancel-add').addEventListener('click', () => {
    document.getElementById('add-note-modal').classList.add('hidden');
  });
  
  document.getElementById('btn-save-new-note').addEventListener('click', async () => {
    const title = document.getElementById('new-note-title').value.trim();
    const content = document.getElementById('new-note-content').value.trim();
    if (title && content) {
      try {
        await apiFetch('/api/notes', {
          method: 'POST',
          body: JSON.stringify({ title, content })
        });
        logActivity('Ingestion', `Note "${title}" saved. Starting background pipelines.`);
        
        // Reset fields
        document.getElementById('new-note-title').value = '';
        document.getElementById('new-note-content').value = '';
        document.getElementById('add-note-modal').classList.add('hidden');
        
        setTimeout(loadAllData, 1000); // Reload content
      } catch (err) {
        alert(err.message);
      }
    }
  });

  // Note Search Handler
  const searchInput = document.getElementById('note-search-input');
  searchInput.addEventListener('input', debounce(async () => {
    const query = searchInput.value.trim();
    if (!query) {
      renderNotesList(allNotes);
      return;
    }
    
    if (isSemanticSearch) {
      try {
        logActivity('Vector Engine', `Running semantic search for: "${query}"`);
        const searchResults = await apiFetch('/api/search', {
          method: 'POST',
          body: JSON.stringify({ query })
        });
        renderNotesList(searchResults);
      } catch (e) {
        console.error(e);
      }
    } else {
      // Keyword local search
      const keywordResults = allNotes.filter(n => 
        n.title.toLowerCase().includes(query.toLowerCase()) || 
        n.content.toLowerCase().includes(query.toLowerCase())
      );
      renderNotesList(keywordResults);
    }
  }, 400));

  // Toggle Search Mode
  const toggleBtn = document.getElementById('btn-toggle-search-mode');
  toggleBtn.addEventListener('click', () => {
    isSemanticSearch = !isSemanticSearch;
    if (isSemanticSearch) {
      toggleBtn.classList.remove('semantic-off');
      toggleBtn.classList.add('semantic-on');
      toggleBtn.innerHTML = '<span class="toggle-indicator"></span> Semantic';
    } else {
      toggleBtn.classList.remove('semantic-on');
      toggleBtn.classList.add('semantic-off');
      toggleBtn.innerHTML = '<span class="toggle-indicator"></span> Keyword';
    }
    // Re-trigger search
    searchInput.dispatchEvent(new Event('input'));
  });

  // Clip Article URL
  document.getElementById('btn-clip-url').addEventListener('click', async () => {
    const urlInput = document.getElementById('clip-url-input');
    const url = urlInput.value.trim();
    if (url) {
      try {
        logActivity('Clipper', `Queued url for scraping: ${url}`);
        urlInput.value = '';
        await apiFetch('/api/notes/clip', {
          method: 'POST',
          body: JSON.stringify({ url })
        });
        logActivity('Clipper', `Web article successfully clipped. Ingestion running.`);
        setTimeout(loadAllData, 1200);
      } catch (err) {
        alert('Clipper error: ' + err.message);
      }
    }
  });

  // PDF Upload triggers
  const pdfFileInput = document.getElementById('pdf-file-input');
  const btnTriggerUpload = document.getElementById('btn-trigger-pdf-upload');
  const pdfFileNameSpan = document.getElementById('pdf-file-name');
  const btnUploadPdf = document.getElementById('btn-upload-pdf');

  btnTriggerUpload.addEventListener('click', () => {
    pdfFileInput.click();
  });

  pdfFileInput.addEventListener('change', () => {
    const file = pdfFileInput.files[0];
    if (file) {
      pdfFileNameSpan.innerText = file.name;
      btnUploadPdf.classList.remove('hidden');
    } else {
      pdfFileNameSpan.innerText = 'No file selected';
      btnUploadPdf.classList.add('hidden');
    }
  });

  btnUploadPdf.addEventListener('click', async () => {
    const file = pdfFileInput.files[0];
    if (!file) return;

    btnUploadPdf.disabled = true;
    btnUploadPdf.innerText = 'Analyzing...';
    logActivity('PDF Summarizer', `Reading PDF file: ${file.name}`);

    const reader = new FileReader();
    reader.onload = async () => {
      try {
        const base64Data = reader.result;
        logActivity('PDF Summarizer', `Uploading PDF payload to AI agent...`);
        
        await apiFetch('/api/notes/upload-pdf', {
          method: 'POST',
          body: JSON.stringify({
            fileName: file.name,
            base64Data: base64Data
          })
        });

        logActivity('PDF Summarizer', `PDF successfully processed and summary note created.`);
        
        // Reset uploader state
        pdfFileInput.value = '';
        pdfFileNameSpan.innerText = 'No file selected';
        btnUploadPdf.classList.add('hidden');
        btnUploadPdf.disabled = false;
        btnUploadPdf.innerText = 'Summarize';

        // Reload data
        setTimeout(loadAllData, 1200);
      } catch (err) {
        alert('PDF Summarizer error: ' + err.message);
        btnUploadPdf.disabled = false;
        btnUploadPdf.innerText = 'Summarize';
      }
    };
    reader.readAsDataURL(file);
  });

  // Detail Modal close
  document.getElementById('btn-close-modal').addEventListener('click', () => {
    document.getElementById('note-modal').classList.add('hidden');
  });
}

function renderNotesList(notes) {
  const container = document.getElementById('notes-grid');
  container.innerHTML = '';

  if (notes.length === 0) {
    container.innerHTML = '<p class="placeholder-text" style="grid-column: 1/-1;">No matching notes found.</p>';
    return;
  }

  notes.forEach(note => {
    const card = document.createElement('div');
    card.className = 'note-card';
    card.innerHTML = `
      <div class="note-card-header">
        <h3>${note.title}</h3>
        ${note.similarity ? `<span class="badge" style="background: rgba(6,182,212,0.2); color:#06b6d4;">Match: ${(note.similarity * 100).toFixed(0)}%</span>` : ''}
      </div>
      <p class="note-card-body">${note.summary || note.content.substring(0, 100) + '...'}</p>
      <div class="tag-row">
        ${(note.tags || []).map(t => `<span class="tag-pill">${t}</span>`).join('')}
      </div>
      <div class="note-card-footer">
        <span><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:middle;margin-right:4px"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg> ${new Date(note.createdAt).toLocaleDateString()}</span>
        <span><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:middle;margin-right:4px"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg> ${note.seeAlso ? note.seeAlso.length : 0} links</span>
      </div>
    `;
    card.addEventListener('click', () => showFullNote(note.id));
    container.appendChild(card);
  });
}

function formatNoteContent(content) {
  if (!content) return '';
  
  let escaped = content
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
    
  const urlRegex = /(https?:\/\/[^\s]+)/g;
  escaped = escaped.replace(urlRegex, (url) => {
    let cleanUrl = url;
    let suffix = '';
    if (url.endsWith('.') || url.endsWith(',')) {
      cleanUrl = url.slice(0, -1);
      suffix = url.slice(-1);
    }
    return `<a href="${cleanUrl}" target="_blank" style="color:var(--accent); text-decoration:underline; font-weight:500;">${cleanUrl}</a>${suffix}`;
  });
  
  escaped = escaped.replace(/^-\s*\[\s*\]\s*(.*$)/gim, '<li style="margin-left:8px; margin-bottom:8px; color:var(--text-secondary); list-style-type: none; display: flex; align-items: center; gap: 8px;"><span style="color:var(--text-muted); font-size: 1.1rem; line-height: 1;">◽</span> <span>$1</span></li>');
  escaped = escaped.replace(/^-\s*\[x\]\s*(.*$)/gim, '<li style="margin-left:8px; margin-bottom:8px; color:var(--text-secondary); list-style-type: none; display: flex; align-items: center; gap: 8px;"><span style="color:var(--accent); font-size: 1.1rem; line-height: 1;">☑</span> <span>$1</span></li>');

  escaped = escaped.replace(/^###### (.*$)/gim, '<h6 style="margin-top:12px; margin-bottom:6px; color:var(--text-secondary); font-weight:600; font-size:0.875rem;">$1</h6>');
  escaped = escaped.replace(/^##### (.*$)/gim, '<h5 style="margin-top:14px; margin-bottom:6px; color:var(--text); font-weight:600; font-size:0.95rem;">$1</h5>');
  escaped = escaped.replace(/^#### (.*$)/gim, '<h4 style="margin-top:16px; margin-bottom:8px; color:var(--text); font-weight:600; font-size:1.05rem;">$1</h4>');
  escaped = escaped.replace(/^### (.*$)/gim, '<h3 style="margin-top:18px; margin-bottom:8px; color:var(--text); font-weight:600; font-size:1.15rem;">$1</h3>');
  escaped = escaped.replace(/^## (.*$)/gim, '<h2 style="margin-top:20px; margin-bottom:10px; color:var(--text); font-weight:600; font-size:1.3rem;">$1</h2>');
  escaped = escaped.replace(/^# (.*$)/gim, '<h1 style="margin-top:24px; margin-bottom:12px; color:var(--text); font-weight:600; font-size:1.5rem;">$1</h1>');
  
  escaped = escaped.replace(/^- (.*$)/gim, '<li style="margin-left:20px; margin-bottom:8px; color:var(--text-secondary); list-style-type: disc;">$1</li>');
  
  escaped = escaped.replace(/\*\*(.*?)\*\*/g, '<strong style="color:var(--text); font-weight:600;">$1</strong>');
  escaped = escaped.replace(/\*(.*?)\*/g, '<em style="font-style:italic;">$1</em>');

  escaped = escaped.replace(/^&gt;\s*(.*$)/gim, '<blockquote style="border-left: 2px solid var(--accent); padding: 4px 12px; margin: 12px 0; color: var(--text-secondary); font-style: italic; background: rgba(255,255,255,0.01); border-radius: 0 4px 4px 0;">$1</blockquote>');

  escaped = escaped.replace(/\n/g, '<br>');
  
  return escaped;
}

function resetNoteModalState() {
  if (!activeModalNote) return;
  document.getElementById('modal-note-title').innerHTML = activeModalNote.title;
  document.getElementById('modal-note-content').innerHTML = formatNoteContent(activeModalNote.content);
  
  const editBtn = document.getElementById('btn-modal-edit-note');
  editBtn.innerText = 'Edit Note';
  editBtn.style.background = 'rgba(234, 179, 8, 0.05)';
  editBtn.style.borderColor = 'rgba(234, 179, 8, 0.25)';
  editBtn.style.color = 'var(--accent-hover)';
  
  const deleteBtn = document.getElementById('btn-modal-delete-note');
  deleteBtn.innerText = 'Delete Note';
  deleteBtn.className = 'danger-btn';
  deleteBtn.style.background = '';
  deleteBtn.style.border = '';
  deleteBtn.style.color = '';
  deleteBtn.style.padding = '';
  deleteBtn.style.borderRadius = '';
  deleteBtn.style.backdropFilter = '';
  deleteBtn.style.webkitBackdropFilter = '';
}

async function showFullNote(id) {
  try {
    const note = await apiFetch(`/api/notes/${id}`);
    activeModalNote = note;
    
    resetNoteModalState();
    document.getElementById('modal-note-date').innerText = new Date(note.createdAt).toLocaleString();
    document.getElementById('modal-note-summary').innerHTML = formatNoteContent(note.summary || 'Summary not processed yet.');

    const tagsRow = document.getElementById('modal-note-tags');
    tagsRow.innerHTML = '';
    (note.tags || []).forEach(t => {
      const pill = document.createElement('span');
      pill.className = 'tag-pill';
      pill.innerText = t;
      tagsRow.appendChild(pill);
    });

    const relationsDiv = document.getElementById('modal-note-relations');
    relationsDiv.innerHTML = '';
    if (note.seeAlso && note.seeAlso.length > 0) {
      note.seeAlso.forEach(relId => {
        const related = allNotes.find(n => n.id === relId);
        if (related) {
          const chip = document.createElement('div');
          chip.className = 'relation-chip';
          chip.innerText = related.title;
          chip.addEventListener('click', () => {
            document.getElementById('note-modal').classList.add('hidden');
            setTimeout(() => showFullNote(related.id), 200);
          });
          relationsDiv.appendChild(chip);
        }
      });
    } else {
      relationsDiv.innerHTML = '<span class="subtitle">No semantic relationships identified.</span>';
    }

    // Edit and Delete Button setups
    const editBtn = document.getElementById('btn-modal-edit-note');
    const newEditBtn = editBtn.cloneNode(true);
    editBtn.parentNode.replaceChild(newEditBtn, editBtn);
    
    const deleteBtn = document.getElementById('btn-modal-delete-note');
    const newDeleteBtn = deleteBtn.cloneNode(true);
    deleteBtn.parentNode.replaceChild(newDeleteBtn, deleteBtn);
    
    let isEditing = false;
    
    newEditBtn.addEventListener('click', async () => {
      if (!isEditing) {
        isEditing = true;
        
        const titleVal = document.getElementById('modal-note-title').innerText;
        document.getElementById('modal-note-title').innerHTML = `
          <input type="text" id="modal-note-edit-title" value="${titleVal.replace(/"/g, '&quot;')}" style="background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.12); color: var(--text); padding: 8px 12px; font-size: 1.15rem; font-weight: 600; border-radius: var(--radius); width: 90%; box-sizing: border-box; backdrop-filter: blur(8px); -webkit-backdrop-filter: blur(8px); outline: none;">
        `;
        
        document.getElementById('modal-note-content').innerHTML = `
          <textarea id="modal-note-edit-content" style="background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.12); color: var(--text); padding: 12px; font-size: 0.875rem; line-height: 1.5; border-radius: var(--radius); width: 100%; height: 220px; box-sizing: border-box; resize: vertical; font-family: inherit; backdrop-filter: blur(8px); -webkit-backdrop-filter: blur(8px); outline: none;">${activeModalNote.content}</textarea>
        `;
        
        newEditBtn.innerText = 'Save';
        newEditBtn.style.background = 'rgba(34, 197, 94, 0.1)';
        newEditBtn.style.borderColor = 'rgba(34, 197, 94, 0.3)';
        newEditBtn.style.color = '#22c55e';
        
        newDeleteBtn.innerText = 'Cancel';
        newDeleteBtn.className = '';
        newDeleteBtn.style.background = 'rgba(255, 255, 255, 0.03)';
        newDeleteBtn.style.border = '1px solid rgba(255, 255, 255, 0.12)';
        newDeleteBtn.style.color = 'var(--text-secondary)';
        newDeleteBtn.style.padding = '8px 16px';
        newDeleteBtn.style.borderRadius = '8px';
        newDeleteBtn.style.cursor = 'pointer';
        newDeleteBtn.style.backdropFilter = 'blur(4px)';
        newDeleteBtn.style.webkitBackdropFilter = 'blur(4px)';
      } else {
        const updatedTitle = document.getElementById('modal-note-edit-title').value.trim();
        const updatedContent = document.getElementById('modal-note-edit-content').value.trim();
        if (!updatedTitle || !updatedContent) {
          alert('Title and Content cannot be empty.');
          return;
        }
        
        try {
          const result = await apiFetch(`/api/notes/${id}`, {
            method: 'PATCH',
            body: JSON.stringify({ title: updatedTitle, content: updatedContent })
          });
          
          logActivity('System', `Updated note: "${updatedTitle}"`);
          activeModalNote = result;
          isEditing = false;
          
          resetNoteModalState();
          loadAllData();
        } catch (e) {
          alert(e.message);
        }
      }
    });
    
    newDeleteBtn.addEventListener('click', async () => {
      if (isEditing) {
        isEditing = false;
        resetNoteModalState();
      } else {
        if (confirm('Are you sure you want to delete this note and all its tasks?')) {
          try {
            await apiFetch(`/api/notes/${id}`, { method: 'DELETE' });
            logActivity('System', `Deleted note: "${note.title}"`);
            document.getElementById('note-modal').classList.add('hidden');
            loadAllData();
          } catch (e) {
            alert(e.message);
          }
        }
      }
    });

    document.getElementById('note-modal').classList.remove('hidden');
  } catch (err) {
    alert(err.message);
  }
}

// Populate the live date pill in the briefing header
function updateBriefingDatePill() {
  const pill = document.getElementById('briefing-date-pill');
  if (!pill) return;
  const now = new Date();
  pill.textContent = now.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
}
updateBriefingDatePill();

// Render the Latest Daily Briefing summary in the Morning Briefing panel
function renderDailyBriefing(latestDigest) {
  const briefingBody = document.getElementById('digest-briefing-body');

  if (!latestDigest) {
    briefingBody.innerHTML = `
      <div class="briefing-empty-state">
        <!-- Material: article / notes outlined - clean document shape -->
        <svg width="28" height="28" viewBox="0 0 24 24" fill="currentColor" style="opacity:0.2;color:var(--text-muted)"><path d="M19 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V5a2 2 0 0 0-2-2zm-7 3h5v2h-5V6zm0 4h5v2h-5v-2zm-4 6H8v-2h7v2zm0-4H8v-2h7v2zm-3-4H8V6h2v2z"/></svg>
        <p>No briefing generated yet. Click <strong>Refresh</strong> to compile today's digest.</p>
      </div>`;

    return;
  }

  // Parse the raw markdown content into sections
  const raw = latestDigest.content || '';

  function extractSection(content, heading) {
    const regex = new RegExp(`\\*\\*${heading}[^\\n]*\\*\\*[^\\n]*\\n([\\s\\S]*?)(?=\\n\\*\\*|\\n---|\n###|$)`);
    const match = content.match(regex);
    if (!match) return [];
    return match[1].split('\n')
      .map(l => l.replace(/^[-*•]\s*\[[ x]\]\s*/, '').replace(/^[-*•]\s*/, '').trim())
      .filter(Boolean);
  }

  function extractRevision(content) {
    const match = content.match(/Memory Consolidation[\s\S]*?\n([\s\S]*?)(?:\n---|$)/);
    if (!match) return '';
    return match[1].replace(/^>\s*/gm, '').replace(/^\*|\*$/g, '').trim();
  }

  const tasks     = extractSection(raw, 'Open Tasks');
  const conflicts = extractSection(raw, 'Unresolved Conflicts');
  const sprouts   = extractSection(raw, 'New Concept Sprouts');
  const revisit   = extractRevision(raw);

  const genTime = new Date(latestDigest.createdAt).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });

  // Contextually meaningful icons per section
  const SECTION_ICONS = {
    // Hourglass = pending / in-progress tasks
    tasks:     `<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 22h14"/><path d="M5 2h14"/><path d="M17 22v-4.172a2 2 0 0 0-.586-1.414L12 12l-4.414 4.414A2 2 0 0 0 7 17.828V22"/><path d="M7 2v4.172a2 2 0 0 0 .586 1.414L12 12l4.414-4.414A2 2 0 0 0 17 6.172V2"/></svg>`,
    // Two arrows pulling in opposite directions = contradiction / conflict
    conflicts: `<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 4l4 4-4 4"/><path d="M3 12V8a4 4 0 0 1 4-4h14"/><path d="M7 20l-4-4 4-4"/><path d="M21 12v4a4 4 0 0 1-4 4H3"/></svg>`,
    // Intersecting circles = cross-pollination of ideas / concept sprouts
    sprouts:   `<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="9" cy="12" r="5"/><circle cx="15" cy="12" r="5"/></svg>`,
    // Open eye on a bookmark = memory retrieval / revisit
    revisit:   `<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>`
  };

  function makeSection(dotColor, label, items, emptyMsg, iconKey) {
    const icon = SECTION_ICONS[iconKey] || '';
    const rows = items.length
      ? items.map(t => `<div class="briefing-row-item"><span class="bri-bullet" style="color:${dotColor};"></span><span>${t}</span></div>`).join('')
      : `<div class="briefing-row-item" style="opacity:0.4;font-style:italic;"><span class="bri-bullet" style="color:var(--text-muted);"></span><span>${emptyMsg}</span></div>`;
    return `
      <div class="briefing-section">
        <div class="briefing-section-label" style="color:${dotColor};">
          ${icon}${label}
        </div>
        <div class="briefing-section-body">${rows}</div>
      </div>`;
  }

  let html = `<div class="briefing-meta">Generated at ${genTime}</div>`;
  html += makeSection('#60a5fa', 'Open Tasks',     tasks,     'No open tasks — all caught up!', 'tasks');
  html += `<div class="briefing-divider"></div>`;
  html += makeSection('#ef4444', 'Conflicts',      conflicts, 'No conflicts detected.',          'conflicts');
  html += `<div class="briefing-divider"></div>`;
  html += makeSection('#a78bfa', 'Concept Sprouts',sprouts,   'No new sprouts yet.',             'sprouts');

  if (revisit) {
    html += `<div class="briefing-divider"></div>`;
    html += `
      <div class="briefing-section">
        <div class="briefing-section-label" style="color:#eab308;">
          ${SECTION_ICONS.revisit}Revisit Today
        </div>
        <div class="briefing-section-body" style="font-style:italic;">${revisit}</div>
      </div>`;
  }


  briefingBody.innerHTML = html;
}


// Refresh morning briefing manually
document.getElementById('btn-refresh-digest').addEventListener('click', async () => {
  try {
    logActivity('Action Runner', 'Assembling daily briefing digest card...');
    const actions = await apiFetch('/api/actions');
    const digestAction = actions.find(a => a.type === 'digest' || a.id === 'action-digest');
    if (digestAction) {
      await apiFetch(`/api/actions/${digestAction.id}/run`, { method: 'POST' });
      logActivity('Action Runner', 'Daily briefing compiled and added to notes library.');
      setTimeout(loadAllData, 1000);
    } else {
      alert('Default Daily Digest action not configured.');
    }
  } catch (err) {
    alert(err.message);
  }
});



// --- MODULE 5: CHAT ---
function initChatModule() {
  const chatInput = document.getElementById('chat-user-input');
  
  document.getElementById('btn-send-chat').addEventListener('click', () => triggerChatSubmit());
  chatInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') triggerChatSubmit();
  });

  document.querySelectorAll('.suggestion-pill').forEach(pill => {
    pill.addEventListener('click', () => {
      chatInput.value = pill.innerText;
      triggerChatSubmit();
    });
  });

  document.getElementById('btn-clear-console').addEventListener('click', () => {
    document.getElementById('console-logs').innerHTML = '<div class="log-entry system">Agent Console logs cleared.</div>';
  });
}

async function triggerChatSubmit() {
  const chatInput = document.getElementById('chat-user-input');
  const userMsg = chatInput.value.trim();
  if (!userMsg) return;

  chatInput.value = '';
  
  // Append User message card
  appendChatMessage('user', userMsg);
  
  // Thinking State card
  const thinkingId = appendChatMessage('system', 'Agent is thinking...');

  try {
    const role = document.getElementById('chat-agent-role').value;
    const result = await apiFetch('/api/chat', {
      method: 'POST',
      body: JSON.stringify({ message: userMsg, role })
    });

    // Remove thinking message
    document.getElementById(thinkingId).remove();

    // Append response text
    appendChatMessage('system', result.response);

    // Append trace logs to console
    const consoleLogsDiv = document.getElementById('console-logs');
    (result.consoleLogs || []).forEach(log => {
      const entry = document.createElement('div');
      entry.className = 'log-entry';
      entry.innerText = log;
      consoleLogsDiv.appendChild(entry);
    });
    consoleLogsDiv.scrollTop = consoleLogsDiv.scrollHeight;

    // Reload layout items (e.g. if note created)
    setTimeout(loadAllData, 1200);

  } catch (err) {
    document.getElementById(thinkingId).remove();
    appendChatMessage('system', `Error contacting agent service: ${err.message}`);
  }
}

function appendChatMessage(sender, text) {
  const container = document.getElementById('chat-messages');
  const msg = document.createElement('div');
  const msgId = 'msg-' + Math.random().toString(36).substr(2, 9);
  
  msg.className = `message ${sender}`;
  msg.id = msgId;
  
  // Format markdown nodes dynamically
  const formattedHtml = formatNoteContent(text);
  msg.innerHTML = `<div class="message-content">${formattedHtml}</div>`;
  
  container.appendChild(msg);
  container.scrollTop = container.scrollHeight;
  return msgId;
}

// --- MODULE 6: KANBAN TASK BOARD ---
function initTaskModule() {
  const columns = document.querySelectorAll('.kanban-column');
  columns.forEach(col => {
    col.addEventListener('dragover', (e) => e.preventDefault());
    col.addEventListener('drop', async (e) => {
      e.preventDefault();
      const taskId = e.dataTransfer.getData('text/plain');
      const status = col.dataset.status;
      if (taskId && status) {
        try {
          await apiFetch(`/api/tasks/${taskId}`, {
            method: 'PATCH',
            body: JSON.stringify({ status })
          });
          logActivity('Task Board', `Updated task state to ${status.toUpperCase()}`);
          await loadAllData();
        } catch (err) {
          console.error(err);
        }
      }
    });
  });

  // Plan my Day logic compiling low status items
  document.getElementById('btn-plan-day').addEventListener('click', async () => {
    logActivity('Daily Briefing', 'Selecting priority checklist tasks...');
    const todoTasks = allTasks.filter(t => t.status === 'todo');
    if (todoTasks.length === 0) {
      alert('You have no open tasks left in your list today!');
      return;
    }
    
    // Sort high priority first
    const sorted = todoTasks.sort((a,b) => {
      const priorityMap = { high: 3, medium: 2, low: 1 };
      return priorityMap[b.priority] - priorityMap[a.priority];
    });

    const topTasks = sorted.slice(0, 3);
    let alertMsg = '⚡ Recommended items for your daily checklist:\n\n';
    topTasks.forEach((t, i) => {
      alertMsg += `${i+1}. [${t.priority.toUpperCase()}] ${t.title}\n`;
    });
    alert(alertMsg);
  });
}

function renderTasksKanban(tasks) {
  const cols = {
    todo: document.getElementById('tasks-todo'),
    in_progress: document.getElementById('tasks-progress'),
    done: document.getElementById('tasks-done')
  };

  Object.values(cols).forEach(el => el.innerHTML = '');

  const counts = { todo: 0, in_progress: 0, done: 0 };

  tasks.forEach(task => {
    counts[task.status]++;
    const card = document.createElement('div');
    card.className = 'kanban-card';
    card.setAttribute('draggable', 'true');
    
    const priority = task.priority || 'normal';
    const createdAtDate = task.createdAt ? new Date(task.createdAt) : new Date();
    const dateStr = isNaN(createdAtDate.getTime()) ? new Date().toLocaleDateString() : createdAtDate.toLocaleDateString();
    
    card.innerHTML = `
      <button class="delete-task-btn" title="Delete Task">&times;</button>
      <h4>${task.title}</h4>
      <div class="kanban-card-meta">
        <span class="priority-badge ${priority}">${priority.toUpperCase()}</span>
        <span>📅 ${dateStr}</span>
      </div>
    `;

    const deleteBtn = card.querySelector('.delete-task-btn');
    deleteBtn.addEventListener('click', async (e) => {
      e.stopPropagation();
      if (confirm(`Are you sure you want to delete this task: "${task.title}"?`)) {
        try {
          await apiFetch(`/api/tasks/${task.id}`, {
            method: 'DELETE'
          });
          logActivity('Task Board', `Deleted task: "${task.title}"`);
          await loadAllData();
        } catch (err) {
          alert('Failed to delete task: ' + err.message);
        }
      }
    });

    card.addEventListener('dragstart', (e) => {
      e.dataTransfer.setData('text/plain', task.id);
    });

    if (cols[task.status]) {
      cols[task.status].appendChild(card);
    }
  });

  document.getElementById('count-todo').innerText = counts.todo;
  document.getElementById('count-progress').innerText = counts.in_progress;
  document.getElementById('count-done').innerText = counts.done;
}

// --- MODULE 7: CONFLICTS ---
function initConflictModule() {}

function renderConflictsList(conflicts) {
  const container = document.getElementById('conflicts-list');
  container.innerHTML = '';

  const unresolved = conflicts.filter(c => c.status === 'unresolved');
  if (unresolved.length === 0) {
    container.innerHTML = '<p class="placeholder-text"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:middle;margin-right:8px;color:var(--green)"><circle cx="12" cy="12" r="10"/><path d="m9 12 2 2 4-4"/></svg> No unresolved knowledge contradictions detected in your Second Brain.</p>';
    return;
  }

  unresolved.forEach(conflict => {
    const card = document.createElement('div');
    card.className = 'conflict-card glass-panel';
    card.innerHTML = `
      <span class="conflict-badge-status unresolved">UNRESOLVED CONTRAST</span>
      <h3>Knowledge Contradiction Detected</h3>
      <p class="conflict-desc">${conflict.description}</p>
      <div class="conflict-resolution-box">
        <strong><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:middle;margin-right:6px;color:var(--accent)"><path d="M15 14c.2-1 .7-1.7 1.5-2.5 1-.9 1.5-2.2 1.5-3.5A5 5 0 0 0 8 8c0 1 .3 2.2 1.5 3.5.7.7 1.3 1.5 1.5 2.5"/><path d="M9 18h6"/><path d="M10 22h4"/></svg> Suggested Resolution:</strong>
        <p>${conflict.resolution}</p>
      </div>
      ${conflict.mergeSuggestion ? `
      <div class="conflict-merge-box" style="margin-top: 12px; padding: 10px 14px; background: rgba(255,255,255,0.02); border-left: 2px solid var(--accent-blue, #60a5fa); border-radius: 0 var(--radius) var(--radius) 0;">
        <strong style="color: var(--accent-blue, #60a5fa); font-size: 0.8rem; text-transform: uppercase; letter-spacing: 0.05em; display: block; margin-bottom: 4px;">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:middle;margin-right:6px;"><path d="M12 22V12"/><path d="M12 12 4 8v10l8 4 8-4V8l-8 4Z"/></svg> Suggested Note Merge:
        </strong>
        <p style="margin: 0; font-size: 0.85rem; color: var(--text-secondary);">${conflict.mergeSuggestion}</p>
      </div>
      ` : ''}
      <div class="conflict-actions">
        <button class="primary-btn-sm" onclick="applyConflictResolution('${conflict.id}')">Accept Resolution</button>
        <button class="danger-btn-sm" style="background:transparent; border:1px solid var(--text-muted); color:var(--text-muted); padding:5px 10px; border-radius:8px;" onclick="dismissConflict('${conflict.id}')">Dismiss Warning</button>
      </div>
    `;
    container.appendChild(card);
  });
}

window.applyConflictResolution = async function(id) {
  try {
    logActivity('Conflict Detector', `Applying resolution for: ${id}`);
    await apiFetch(`/api/conflicts/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ status: 'resolved' })
    });
    logActivity('Conflict Detector', 'Conflict marked as RESOLVED.');
    await loadAllData();
  } catch (err) {
    alert(err.message);
  }
};

window.dismissConflict = async function(id) {
  try {
    await apiFetch(`/api/conflicts/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ status: 'dismissed' })
    });
    logActivity('Conflict Detector', 'Contradiction warning dismissed.');
    await loadAllData();
  } catch (err) {
    alert(err.message);
  }
};

// --- MODULE 8: SPROUTS ENGINE ---
function initSproutsModule() {
  document.getElementById('btn-trigger-sprout').addEventListener('click', async () => {
    try {
      logActivity('Sprout Engine', 'Brainstorming topically distant notes...');
      const response = await apiFetch('/api/sprouts/generate', { method: 'POST' });
      logActivity('Sprout Engine', `New concept sprouted successfully: "${response.title}"`);
      await loadAllData();
    } catch (err) {
      alert('Sprout error: ' + err.message);
    }
  });
}

function renderSproutsList(sprouts) {
  const container = document.getElementById('sprouts-grid');
  container.innerHTML = '';

  if (sprouts.length === 0) {
    container.innerHTML = `
      <div style="grid-column:1/-1; text-align:center; padding: 60px 20px; color: var(--text-muted);">
        <div style="font-size: 2.5rem; margin-bottom: 16px; opacity: 0.4;">🌱</div>
        <p style="font-size: 0.95rem; margin-bottom: 8px; color: var(--text-secondary);">No sprouts yet</p>
        <p style="font-size: 0.82rem;">Click <strong style="color:var(--accent)">Generate New Sprouts</strong> to cross-pollinate your notes into fresh ideas.</p>
      </div>`;
    return;
  }

  // Sort newest first
  const sorted = [...sprouts].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

  sorted.forEach(sprout => {
    const card = document.createElement('div');
    card.className = 'sprout-card glass-panel';

    const sourceTitles = sprout.sourceTitles || sprout.sourceNotes.map(id => {
      const n = allNotes.find(n => n.id === id);
      return n ? n.title : id;
    });

    const timeAgo = (() => {
      const diff = Date.now() - new Date(sprout.createdAt).getTime();
      const m = Math.floor(diff / 60000);
      if (m < 1) return 'just now';
      if (m < 60) return `${m}m ago`;
      const h = Math.floor(m / 60);
      if (h < 24) return `${h}h ago`;
      return `${Math.floor(h / 24)}d ago`;
    })();

    card.innerHTML = `
      <div class="sprout-card-body">
        <div class="sprout-card-header">
          <h3>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:middle;margin-right:6px;color:var(--accent);flex-shrink:0"><path d="M7 20h10"/><path d="M10 20c5.5-2.5.8-6.4 3-10"/><path d="M9.5 9.4c1.1.8 1.8 2.2 2.3 3.7-2 .4-3.5.4-4.8-.3-1.2-.6-2.3-1.9-3-4.2 2.8-.5 4.4 0 5.5.8z"/><path d="M14.1 6a7 7 0 0 0-1.1 4c1.9-.1 3.3-.6 4.3-1.4 1-1 1.6-2.3 1.7-4.6-2.7.1-4 1-4.9 2z"/></svg>
            ${sprout.title}
          </h3>
          <button class="sprout-delete-btn" title="Dismiss sprout" onclick="deleteSprout('${sprout.id}')">×</button>
        </div>
        <p class="sprout-desc">${sprout.description}</p>
        <div class="sprout-sources">
          <span class="sprout-sources-label">✦ Sparked by</span>
          ${sourceTitles.map(t => `<span class="sprout-source-chip">${t}</span>`).join('<span style="color:var(--text-muted);font-size:0.75rem;align-self:center;">+</span>')}
        </div>
      </div>
      <div class="sprout-actions">
        <span class="sprout-time">${timeAgo}</span>
        <button class="primary-btn-sm sprout-grow-btn" onclick="convertSproutToNote('${sprout.id}')">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:middle;margin-right:5px"><path d="M12 5v14"/><path d="m19 12-7 7-7-7"/></svg>
          Grow to Note
        </button>
      </div>
    `;
    container.appendChild(card);
  });
}

window.deleteSprout = async function(id) {
  try {
    await apiFetch(`/api/sprouts/${id}`, { method: 'DELETE' });
    logActivity('Sprout Engine', 'Sprout dismissed.');
    await loadAllData();
  } catch (err) {
    alert(err.message);
  }
};

window.convertSproutToNote = async function(id) {
  const sprout = allSprouts.find(s => s.id === id);
  if (!sprout) return;

  try {
    logActivity('Sprout Engine', `Growing sprout into note: "${sprout.title}"`);

    // Single atomic call: server creates the note AND removes the sprout in one db write
    await apiFetch(`/api/sprouts/${id}/grow`, { method: 'POST' });

    logActivity('Ingestion', `Sprout grown into full note: "${sprout.title}"`);
    await loadAllData();
  } catch (err) {
    alert(err.message);
  }
};



// --- MODULE 9: VOICE RECORDER ---
let voiceRecognition = null;
let isRecordingVoice = false;

function initVoiceRecorderModule() {
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  const recordBtn = document.getElementById('btn-record-mic');
  const recordStatus = document.getElementById('record-status');
  const transcriptText = document.getElementById('voice-transcript-text');

  if (SpeechRecognition) {
    voiceRecognition = new SpeechRecognition();
    voiceRecognition.continuous = true;
    voiceRecognition.interimResults = true;
    voiceRecognition.lang = 'en-US';

    voiceRecognition.onresult = (e) => {
      let finalStr = '';
      let interimStr = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        if (e.results[i].isFinal) {
          finalStr += e.results[i][0].transcript;
        } else {
          interimStr += e.results[i][0].transcript;
        }
      }
      if (finalStr) {
        transcriptText.value += finalStr + ' ';
      }
      recordStatus.innerText = interimStr || 'Listening to speech...';
    };

    voiceRecognition.onerror = (e) => {
      console.error(e);
      recordStatus.innerText = 'Microphone Error: ' + e.error;
      stopVoiceRecording();
    };

    voiceRecognition.onend = () => {
      if (isRecordingVoice) {
        voiceRecognition.start();
      }
    };
  } else {
    recordStatus.innerText = 'SpeechRecognition API is not supported. Paste raw text below.';
  }

  recordBtn.addEventListener('click', () => {
    if (isRecordingVoice) {
      stopVoiceRecording();
    } else {
      startVoiceRecording();
    }
  });

  document.getElementById('btn-refine-dump').addEventListener('click', async () => {
    const text = transcriptText.value.trim();
    if (!text) {
      alert('Please type or dictate some brain dump contents first.');
      return;
    }
    
    const proposalsDiv = document.getElementById('refiner-proposals');
    proposalsDiv.innerHTML = '<p class="placeholder-text">🤖 Cleaning up transcript and splitting distinct topics...</p>';
    
    try {
      logActivity('Voice Refiner', 'Restructuring messy brain dump transcript...');
      const response = await apiFetch('/api/refine', {
        method: 'POST',
        body: JSON.stringify({ text })
      });

      proposalsDiv.innerHTML = '';
      if (!response.proposals || response.proposals.length === 0) {
        proposalsDiv.innerHTML = '<p class="placeholder-text">Could not generate structure recommendations.</p>';
        return;
      }

      response.proposals.forEach((prop, propIdx) => {
        const card = document.createElement('div');
        card.className = 'proposal-preview-card';
        card.dataset.propType = prop.type || 'note';
        card.dataset.propIdx  = propIdx;

        if (prop.type === 'task') {
          // ── TASK CARD: just the task title, editable ──
          card.innerHTML = `
            <div class="pcard-header">
              <div class="pcard-badge pcard-badge-task">📋 Task</div>
            </div>
            <div class="pcard-field">
              <label class="pcard-label">Task Title</label>
              <input type="text" class="proposal-title-input pcard-input" value="${prop.title.replace(/"/g, '&quot;')}" placeholder="What needs to be done?">
            </div>
            <div class="pcard-footer">
              <button class="pcard-btn pcard-btn-dismiss" onclick="this.closest('.proposal-preview-card').remove()">Dismiss</button>
              <button class="pcard-btn pcard-btn-accept" onclick="acceptProposal(this)">✓ Add to Task Board</button>
            </div>
          `;
        } else {
          // ── NOTE CARD: title + content, editable ──
          card.innerHTML = `
            <div class="pcard-header">
              <div class="pcard-badge">✦ Note</div>
            </div>
            <div class="pcard-field">
              <label class="pcard-label">Title</label>
              <input type="text" class="proposal-title-input pcard-input" value="${prop.title.replace(/"/g, '&quot;')}" placeholder="Note title...">
            </div>
            <div class="pcard-field">
              <label class="pcard-label">Content</label>
              <textarea class="proposal-content-textarea pcard-textarea" placeholder="Note content...">${prop.content || ''}</textarea>
            </div>
            <div class="pcard-footer">
              <button class="pcard-btn pcard-btn-dismiss" onclick="this.closest('.proposal-preview-card').remove()">Dismiss</button>
              <button class="pcard-btn pcard-btn-accept" onclick="acceptProposal(this)">✓ Add to Notes</button>
            </div>
          `;
        }

        proposalsDiv.appendChild(card);
      });


    } catch (e) {
      proposalsDiv.innerHTML = `<p class="placeholder-text" style="color:var(--accent-red);">Refiner failed: ${e.message}</p>`;
    }
  });
}

function startVoiceRecording() {
  if (!voiceRecognition) return;
  isRecordingVoice = true;
  document.getElementById('btn-record-mic').classList.add('active');
  document.getElementById('record-status').innerText = 'Microphone listening. Speak clearly...';
  document.getElementById('audio-visualizer').classList.remove('hidden');
  voiceRecognition.start();
}

function stopVoiceRecording() {
  if (!voiceRecognition) return;
  isRecordingVoice = false;
  document.getElementById('btn-record-mic').classList.remove('active');
  document.getElementById('record-status').innerText = 'Microphone stopped. Refine contents below.';
  document.getElementById('audio-visualizer').classList.add('hidden');
  voiceRecognition.stop();
}

// Accept a proposal — routes to Notes or Task Board based on card type
window.acceptProposal = async function(btnElement) {
  const card = btnElement.closest('.proposal-preview-card');
  if (!card) return;
  const type = card.dataset.propType || 'note';
  const title = card.querySelector('.proposal-title-input').value.trim();

  if (!title) { alert('Please enter a title before accepting.'); return; }

  if (type === 'task') {
    // Save to Task Board
    btnElement.disabled = true;
    btnElement.innerText = 'Adding…';
    try {
      await apiFetch('/api/tasks', {
        method: 'POST',
        body: JSON.stringify({ title, status: 'todo', priority: 'medium', sourceNote: null })
      });
      logActivity('Task Board', `Task added: “${title}”`);
      card.remove();
      await loadAllData();
    } catch (err) {
      btnElement.disabled = false;
      btnElement.innerText = '✓ Add to Task Board';
      alert(err.message);
    }
  } else {
    // Save to Notes
    const content = card.querySelector('.proposal-content-textarea');
    const contentValue = content ? content.value.trim() : '';
    if (!contentValue) { alert('Please add some content before accepting.'); return; }

    btnElement.disabled = true;
    btnElement.innerText = 'Saving…';
    try {
      await apiFetch('/api/notes', {
        method: 'POST',
        body: JSON.stringify({ title, content: contentValue })
      });
      logActivity('Ingestion', `Note saved: “${title}” — ingestion pipeline running.`);
      card.remove();
      await loadAllData();
    } catch (err) {
      btnElement.disabled = false;
      btnElement.innerText = '✓ Add to Notes';
      alert(err.message);
    }
  }
};

// Kept for backward compatibility but no longer called from cards
window.saveRefinedProposal = window.acceptProposal;
window.saveToNotesOnly     = window.acceptProposal;
window.saveToTasksOnly     = window.acceptProposal;

// --- MODULE 10: ACTIONS RUNNER ---
function initActionsModule() {
  // Open / close modal
  document.getElementById('btn-add-action').addEventListener('click', () => {
    document.getElementById('add-action-modal').classList.remove('hidden');
    updateActionModalFields(); // reset on open
  });
  document.getElementById('btn-close-action-modal').addEventListener('click', () => {
    document.getElementById('add-action-modal').classList.add('hidden');
  });
  document.getElementById('btn-cancel-action').addEventListener('click', () => {
    document.getElementById('add-action-modal').classList.add('hidden');
  });

  // Dynamic label/placeholder/visibility when type changes
  document.getElementById('new-action-type').addEventListener('change', updateActionModalFields);

  // Clear logs
  document.getElementById('btn-clear-action-logs').addEventListener('click', () => {
    const logs = document.getElementById('action-runs-logs');
    logs.innerHTML = '<div class="log-entry system">Logs cleared.</div>';
  });

  // Save action
  document.getElementById('btn-save-new-action').addEventListener('click', async () => {
    const name   = document.getElementById('new-action-name').value.trim();
    const type   = document.getElementById('new-action-type').value;
    const target = document.getElementById('new-action-target').value.trim();

    // Digest needs no target — use 'internal' as placeholder
    const resolvedTarget = type === 'digest' ? 'internal' : target;

    if (!name) { alert('Please enter an action name.'); return; }
    if (type !== 'digest' && !resolvedTarget) {
      alert('Please enter a target destination.'); return;
    }
    if (type === 'email' && !/\S+@\S+\.\S+/.test(resolvedTarget)) {
      alert('Email target must be a valid email address.'); return;
    }

    try {
      await apiFetch('/api/actions', {
        method: 'POST',
        body: JSON.stringify({ name, type, target: resolvedTarget })
      });
      logActivity('Action Runner', `Registered action: "${name}" [${type.toUpperCase()}]`);
      document.getElementById('new-action-name').value  = '';
      document.getElementById('new-action-target').value = '';
      document.getElementById('add-action-modal').classList.add('hidden');
      await loadAllData();
    } catch (err) {
      alert(err.message);
    }
  });
}

function updateActionModalFields() {
  const type        = document.getElementById('new-action-type').value;
  const label       = document.getElementById('action-target-label');
  const input       = document.getElementById('new-action-target');
  const targetGroup = document.getElementById('action-target-group');

  const config = {
    export:  { label: 'Export Folder Path',    placeholder: 'e.g. ./exports/mindsync',    show: true },
    email:   { label: 'Recipient Email',        placeholder: 'you@example.com',             show: true },
    digest:  { label: '',                       placeholder: '',                             show: false }
  };

  const cfg = config[type] || config.export;
  label.innerText         = cfg.label;
  input.placeholder       = cfg.placeholder;
  targetGroup.style.display = cfg.show ? '' : 'none';
}

// Type icons for action cards
const ACTION_TYPE_META = {
  export:  { icon: '📁', label: 'Export',  desc: 'Writes all notes as .md files to a local folder.' },
  email:   { icon: '✉️', label: 'Email',   desc: 'Sends an email summary to the configured address.' },
  digest:  { icon: '📰', label: 'Digest',  desc: 'Compiles a Daily Briefing note from tasks, conflicts, and sprouts.' }
};

function renderActionsList(actions) {
  const container = document.getElementById('actions-list');
  container.innerHTML = '';

  if (!actions.length) {
    container.innerHTML = '<p class="placeholder-text">No actions registered yet. Click "+ Create Action" to get started.</p>';
    return;
  }

  actions.forEach(action => {
    const meta   = ACTION_TYPE_META[action.type] || { icon: '⚡', label: action.type, desc: '' };
    const status = action.status;
    const statusBadge = status
      ? `<span style="font-size:0.65rem;padding:2px 8px;border-radius:20px;margin-left:6px;
          background:${status==='success'?'rgba(16,185,129,0.15)':'rgba(239,68,68,0.15)'};
          color:${status==='success'?'#10b981':'#ef4444'};
          border:1px solid ${status==='success'?'rgba(16,185,129,0.3)':'rgba(239,68,68,0.3)'};">
          ${status === 'success' ? '✓ Success' : '✗ Failed'}</span>`
      : '';
    const lastRun = action.lastRun
      ? new Date(action.lastRun).toLocaleString()
      : 'Never run';
    const isBuiltIn    = action.id === 'action-digest';
    const targetDisplay = action.target === 'internal' ? '—' : action.target;
    // Show last error inline under the card if failed
    const errorLine = (status === 'failed' && action.lastError)
      ? `<div style="margin-top:5px;font-size:0.68rem;color:#ef4444;background:rgba(239,68,68,0.07);
           border-left:2px solid #ef4444;padding:3px 8px;border-radius:0 4px 4px 0;">
           ✗ ${action.lastError}</div>`
      : '';

    const card = document.createElement('div');
    card.className = 'action-item-card';
    card.innerHTML = `
      <div class="action-item-info">
        <div style="display:flex;align-items:center;gap:6px;margin-bottom:4px;">
          <span style="font-size:1rem;">${meta.icon}</span>
          <h4 style="margin:0;font-size:0.9rem;">${action.name}${statusBadge}</h4>
        </div>
        <span style="font-size:0.72rem;color:var(--text-secondary);">${meta.desc}</span><br>
        <span style="font-size:0.68rem;color:var(--text-muted);">
          <b>Type:</b> ${meta.label} &nbsp;|&nbsp; <b>Target:</b> ${targetDisplay}
        </span><br>
        <span style="font-size:0.65rem;color:var(--text-muted);">Last run: ${lastRun}</span>
        ${errorLine}
      </div>
      <div style="display:flex;gap:6px;align-items:center;flex-shrink:0;">
        <button id="run-btn-${action.id}" class="primary-btn-sm"
          style="padding:6px 14px;font-size:0.8rem;min-width:60px;"
          onclick="runActionTrigger('${action.id}')">▶ Run</button>
        ${!isBuiltIn ? `<button onclick="deleteAction('${action.id}')" title="Delete action"
          style="padding:6px 9px;font-size:0.8rem;background:transparent;border:1px solid rgba(239,68,68,0.3);
          color:#ef4444;border-radius:8px;cursor:pointer;"
          onmouseover="this.style.background='rgba(239,68,68,0.1)'"
          onmouseout="this.style.background='transparent'">✕</button>` : ''}
      </div>
    `;
    container.appendChild(card);
  });
}

window.deleteAction = async function(id) {
  if (!confirm('Delete this action? This cannot be undone.')) return;
  try {
    await apiFetch(`/api/actions/${id}`, { method: 'DELETE' });
    logActivity('Action Runner', 'Action deleted.');
    await loadAllData();
  } catch (err) {
    alert(err.message);
  }
};

window.runActionTrigger = async function(id) {
  const logs   = document.getElementById('action-runs-logs');
  const action = allActions.find(a => a.id === id);
  if (!action) return;

  const meta    = ACTION_TYPE_META[action.type] || { icon: '⚡', label: action.type };
  const logTime = new Date().toLocaleTimeString();

  // Loading state on the button
  const btn = document.getElementById(`run-btn-${id}`);
  if (btn) { btn.disabled = true; btn.textContent = '…'; }

  const startLog = document.createElement('div');
  startLog.className = 'log-entry';
  startLog.innerHTML = `<span style="color:var(--text-muted);">[${logTime}]</span> ${meta.icon} Running <b>${action.name}</b> <span style="color:var(--text-muted);font-size:0.72rem;">[${meta.label}]</span>…`;
  logs.appendChild(startLog);
  logs.scrollTop = logs.scrollHeight;

  try {
    const result     = await apiFetch(`/api/actions/${id}/run`, { method: 'POST' });
    const doneTime   = new Date().toLocaleTimeString();
    const successLog = document.createElement('div');
    successLog.className = 'log-entry';

    let detail = '';
    if (result.meta) {
      if (result.meta.exportedCount !== undefined) detail = ` — ${result.meta.exportedCount} notes exported`;
      if (result.meta.httpStatus)                 detail = ` — HTTP ${result.meta.httpStatus}`;
      if (result.meta.previewUrl)                 detail = ` — <a href="${result.meta.previewUrl}" target="_blank" style="color:#d4af37;text-decoration:underline;">View sandbox email</a>`;
      if (result.meta.recipient && !result.meta.sandbox) detail = ` — Sent to ${result.meta.recipient}`;
    }
    successLog.innerHTML = `<span style="color:var(--text-muted);">[${doneTime}]</span> <span style="color:#10b981;">✓ Completed${detail}</span>`;
    logs.appendChild(successLog);
    logActivity('Action Runner', `"${action.name}" ran successfully.`);
    await loadAllData(); // refresh card badge to ✓ Success
  } catch (err) {
    const failTime = new Date().toLocaleTimeString();
    const failLog  = document.createElement('div');
    failLog.className = 'log-entry';
    failLog.innerHTML = `<span style="color:var(--text-muted);">[${failTime}]</span> <span style="color:#ef4444;">✗ Failed — ${err.message}</span>`;
    logs.appendChild(failLog);
    logActivity('Action Runner', `"${action.name}" failed: ${err.message}`);
    await loadAllData(); // refresh card badge to ✗ Failed + show lastError
  }
  logs.scrollTop = logs.scrollHeight;
};



// --- HELPER UTILITIES ---
function debounce(func, wait) {
  let timeout;
  return function executedFunction(...args) {
    const later = () => {
      clearTimeout(timeout);
      func(...args);
    };
    clearTimeout(timeout);
    timeout = setTimeout(later, wait);
  };
}

// --- LINE CHART RENDERING (DENSITY DATA TRENDS) ---
let growthChartInstance = null;
function renderGrowthChart(notes) {
  const canvas = document.getElementById('growthChart');
  if (!canvas) return;
  if (typeof Chart === 'undefined') {
    console.warn('Chart.js is not loaded. Skipping chart rendering.');
    return;
  }
  const ctx = canvas.getContext('2d');
  if (growthChartInstance) {
    growthChartInstance.destroy();
  }

  // Group and sort notes by date
  const sorted = [...notes].sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
  const labels = [];
  const data = [];
  let runningCount = 0;

  sorted.forEach(n => {
    const dateStr = new Date(n.createdAt).toLocaleDateString([], { month: 'short', day: 'numeric' });
    runningCount++;
    labels.push(dateStr);
    data.push(runningCount);
  });

  // Fallback for empty state
  if (notes.length === 0) {
    labels.push(new Date().toLocaleDateString([], { month: 'short', day: 'numeric' }));
    data.push(0);
  }

  growthChartInstance = new Chart(ctx, {
    type: 'line',
    data: {
      labels,
      datasets: [{
        label: 'Brain Density (Total Notes)',
        data,
        borderColor: '#7c3aed',
        borderWidth: 2.5,
        backgroundColor: 'rgba(124,58,237,0.15)',
        tension: 0.35,
        fill: true
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false }
      },
      scales: {
        x: { grid: { color: 'rgba(255, 255, 255, 0.04)' }, ticks: { color: '#9ca3af', font: { family: 'Inter' } } },
        y: { grid: { color: 'rgba(255, 255, 255, 0.04)' }, ticks: { color: '#9ca3af', stepSize: 1 } }
      }
    }
  });
}
