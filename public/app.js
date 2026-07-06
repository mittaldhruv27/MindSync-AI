// --- APP STATE & INITIALIZATION ---
let allNotes = [];
let allTasks = [];
let allConflicts = [];
let allSprouts = [];
let allActions = [];

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

    renderNotesList(allNotes);
    renderTasksKanban(allTasks);
    renderConflictsList(allConflicts);
    renderSproutsList(allSprouts);
    renderActionsList(allActions);
    renderGrowthChart(allNotes);
    
    // Load daily briefing note
    renderDailyBriefing(allNotes);



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
  
  document.getElementById('btn-show-settings').addEventListener('click', () => {
    modal.classList.remove('hidden');
  });
  document.getElementById('btn-close-settings').addEventListener('click', () => {
    modal.classList.add('hidden');
  });
  document.getElementById('btn-save-settings').addEventListener('click', () => {
    const inputVal = document.getElementById('settings-token').value.trim();
    if (inputVal) {
      apiSecret = inputVal;
      localStorage.setItem('mindsync_secret', apiSecret);
      logActivity('Settings', 'Bearer token authorization passphrase updated.');
      loadAllData();
      modal.classList.add('hidden');
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
  
  escaped = escaped.replace(/^### (.*$)/gim, '<h3 style="margin-top:16px; margin-bottom:8px; color:var(--text); font-weight:600;">$1</h3>');
  escaped = escaped.replace(/^## (.*$)/gim, '<h2 style="margin-top:20px; margin-bottom:10px; color:var(--text); font-weight:600;">$1</h2>');
  escaped = escaped.replace(/^# (.*$)/gim, '<h1 style="margin-top:24px; margin-bottom:12px; color:var(--text); font-weight:600;">$1</h1>');
  
  escaped = escaped.replace(/^- (.*$)/gim, '<li style="margin-left:20px; margin-bottom:8px; color:var(--text-secondary); list-style-type: disc;">$1</li>');
  
  escaped = escaped.replace(/\n/g, '<br>');
  
  return escaped;
}

async function showFullNote(id) {
  try {
    const note = await apiFetch(`/api/notes/${id}`);
    
    document.getElementById('modal-note-title').innerText = note.title;
    document.getElementById('modal-note-date').innerText = new Date(note.createdAt).toLocaleString();
    document.getElementById('modal-note-summary').innerText = note.summary || 'Summary not processed yet.';
    document.getElementById('modal-note-content').innerHTML = formatNoteContent(note.content);

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

    // Delete Button setup
    const deleteBtn = document.getElementById('btn-modal-delete-note');
    // Clear old listeners
    const newDeleteBtn = deleteBtn.cloneNode(true);
    deleteBtn.parentNode.replaceChild(newDeleteBtn, deleteBtn);
    
    newDeleteBtn.addEventListener('click', async () => {
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
    });

    document.getElementById('note-modal').classList.remove('hidden');
  } catch (err) {
    alert(err.message);
  }
}

// Render the Latest Daily Briefing summary in the Morning Briefing panel
function renderDailyBriefing(notes) {
  const briefingBody = document.getElementById('digest-briefing-body');
  
  // Find latest digest note
  const digestNotes = notes.filter(n => n.id.startsWith('note-digest-') || n.title.startsWith('Daily Digest'));
  if (digestNotes.length > 0) {
    const latestDigest = digestNotes.sort((a,b) => new Date(b.createdAt) - new Date(a.createdAt))[0];
    briefingBody.innerHTML = `
      <div style="font-size:0.85rem; color:var(--text-muted); margin-bottom:8px;">Generated on ${new Date(latestDigest.createdAt).toLocaleString()}</div>
      <div class="digest-formatted-content">${latestDigest.content}</div>
    `;
  } else {
    briefingBody.innerHTML = `
      <p class="placeholder-text" style="text-align:left; margin-top:10px;">
        No briefing summaries generated yet. Run the "Daily Briefing" action inside the Action Runner panel or click "Run Digest" above to compile one.
      </p>
    `;
  }
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
    const result = await apiFetch('/api/chat', {
      method: 'POST',
      body: JSON.stringify({ message: userMsg })
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

    // Reload layout items (e.g. if note created/webhook hit)
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
  msg.innerHTML = `<div class="message-content">${text}</div>`;
  
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
    
    card.innerHTML = `
      <h4>${task.title}</h4>
      <div class="kanban-card-meta">
        <span class="priority-badge ${task.priority}">${task.priority.toUpperCase()}</span>
        <span>📅 ${new Date(task.createdAt).toLocaleDateString()}</span>
      </div>
    `;

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
    container.innerHTML = '<p class="placeholder-text" style="grid-column:1/-1;">Generate conceptual sprouts using the button above.</p>';
    return;
  }

  sprouts.forEach(sprout => {
    const card = document.createElement('div');
    card.className = 'sprout-card glass-panel';
    card.innerHTML = `
      <div>
        <h3><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:middle;margin-right:6px;color:var(--accent)"><path d="M7 20h10"/><path d="M10 20c5.5-2.5.8-6.4 3-10"/><path d="M9.5 9.4c1.1.8 1.8 2.2 2.3 3.7-2 .4-3.5.4-4.8-.3-1.2-.6-2.3-1.9-3-4.2 2.8-.5 4.4 0 5.5.8z"/><path d="M14.1 6a7 7 0 0 0-1.1 4c1.9-.1 3.3-.6 4.3-1.4 1-1 1.6-2.3 1.7-4.6-2.7.1-4 1-4.9 2z"/></svg> ${sprout.title}</h3>
        <p>${sprout.description}</p>
      </div>
      <div class="sprout-actions">
        <button class="primary-btn-sm" style="padding: 6px 12px; font-size:0.8rem;" onclick="convertSproutToNote('${sprout.id}')">Grow to Note</button>
      </div>
    `;
    container.appendChild(card);
  });
}

window.convertSproutToNote = async function(id) {
  const sprout = allSprouts.find(s => s.id === id);
  if (!sprout) return;
  try {
    logActivity('Sprout Engine', `Expanding sprout idea into complete note: "${sprout.title}"`);
    await apiFetch('/api/notes', {
      method: 'POST',
      body: JSON.stringify({
        title: sprout.title,
        content: `### Concept Sprout Expansion\n\n**Origin Summary:**\n${sprout.description}\n\n**Source References:**\n- Source IDs: ${sprout.sourceNotes.join(', ')}`
      })
    });
    logActivity('Ingestion', `Sprout expanded to Note. Background extraction pending.`);
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

      response.proposals.forEach((prop, index) => {
        const card = document.createElement('div');
        card.className = 'proposal-preview-card';
        card.innerHTML = `
          <h4>${prop.title}</h4>
          <p>${prop.content}</p>
          <div class="tag-row">
            ${(prop.actionItems || []).map(ti => `<span class="tag-pill" style="background:rgba(245,158,11,0.12); color:#f59e0b;">Todo: ${ti}</span>`).join('')}
          </div>
          <button class="primary-btn-sm" style="padding: 4px 8px; font-size:0.75rem;" onclick="saveRefinedProposal(${index}, '${btoa(JSON.stringify(prop))}')">Accept & Ingest</button>
        `;
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
  voiceRecognition.start();
}

function stopVoiceRecording() {
  if (!voiceRecognition) return;
  isRecordingVoice = false;
  document.getElementById('btn-record-mic').classList.remove('active');
  document.getElementById('record-status').innerText = 'Microphone stopped. Refine contents below.';
  voiceRecognition.stop();
}

window.saveRefinedProposal = async function(index, propBase64) {
  const prop = JSON.parse(atob(propBase64));
  try {
    logActivity('Ingestion', `Saving refined proposal: "${prop.title}"`);
    await apiFetch('/api/notes', {
      method: 'POST',
      body: JSON.stringify({
        title: prop.title,
        content: `${prop.content}\n\n${(prop.actionItems || []).map(item => `- TODO: ${item}`).join('\n')}`
      })
    });
    
    logActivity('Ingestion', `Saved. Background pipeline initialized.`);
    document.getElementsByClassName('proposal-preview-card')[index].remove();
    await loadAllData();
  } catch (err) {
    alert(err.message);
  }
};

// --- MODULE 10: ACTIONS RUNNER ---
function initActionsModule() {
  document.getElementById('btn-add-action').addEventListener('click', () => {
    document.getElementById('add-action-modal').classList.remove('hidden');
  });
  document.getElementById('btn-close-action-modal').addEventListener('click', () => {
    document.getElementById('add-action-modal').classList.add('hidden');
  });
  document.getElementById('btn-cancel-action').addEventListener('click', () => {
    document.getElementById('add-action-modal').classList.add('hidden');
  });

  document.getElementById('btn-save-new-action').addEventListener('click', async () => {
    const name = document.getElementById('new-action-name').value.trim();
    const type = document.getElementById('new-action-type').value;
    const target = document.getElementById('new-action-target').value.trim();

    if (name && target) {
      try {
        await apiFetch('/api/actions', {
          method: 'POST',
          body: JSON.stringify({ name, type, target })
        });
        logActivity('Action Runner', `Registered custom action: "${name}"`);
        document.getElementById('new-action-name').value = '';
        document.getElementById('new-action-target').value = '';
        document.getElementById('add-action-modal').classList.add('hidden');
        await loadAllData();
      } catch (err) {
        alert(err.message);
      }
    }
  });
}

function renderActionsList(actions) {
  const container = document.getElementById('actions-list');
  container.innerHTML = '';

  actions.forEach(action => {
    const card = document.createElement('div');
    card.className = 'action-item-card';
    card.innerHTML = `
      <div class="action-item-info">
        <h4>${action.name} ${action.status ? `<span class="run-status-badge ${action.status}">${action.status.toUpperCase()}</span>` : ''}</h4>
        <span>Type: ${action.type.toUpperCase()} | Target: ${action.target}</span><br>
        <span style="font-size:0.65rem;">Last Run: ${action.lastRun ? new Date(action.lastRun).toLocaleString() : 'Never'}</span>
      </div>
      <button class="primary-btn-sm" style="padding: 6px 12px; font-size:0.8rem;" onclick="runActionTrigger('${action.id}')">Execute</button>
    `;
    container.appendChild(card);
  });
}

window.runActionTrigger = async function(id) {
  const logs = document.getElementById('action-runs-logs');
  const action = allActions.find(a => a.id === id);
  if (!action) return;

  const logTime = new Date().toLocaleTimeString();
  const startLog = document.createElement('div');
  startLog.className = 'log-entry';
  startLog.innerText = `[${logTime}] Executing: "${action.name}"...`;
  logs.appendChild(startLog);

  try {
    const result = await apiFetch(`/api/actions/${id}/run`, { method: 'POST' });
    const successTime = new Date().toLocaleTimeString();
    const successLog = document.createElement('div');
    successLog.className = 'log-entry';
    successLog.style.color = '#10b981';
    successLog.innerText = `[${successTime}] Success. Status code: ${result.status.toUpperCase()}`;
    logs.appendChild(successLog);
    logActivity('Action Runner', `Completed action "${action.name}" successfully.`);
    await loadAllData();
  } catch (err) {
    const failTime = new Date().toLocaleTimeString();
    const failLog = document.createElement('div');
    failLog.className = 'log-entry';
    failLog.style.color = 'var(--accent-red)';
    failLog.innerText = `[${failTime}] Failed: ${err.message}`;
    logs.appendChild(failLog);
    logActivity('Action Runner', `Failed to run action: "${action.name}"`);
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
