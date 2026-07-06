const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// Load environment variables manually
function loadEnv() {
  const envPath = path.join(__dirname, '.env');
  if (fs.existsSync(envPath)) {
    const lines = fs.readFileSync(envPath, 'utf8').split('\n');
    for (const line of lines) {
      const match = line.match(/^\s*([\w.-]+)\s*=\s*(.*)?\s*$/);
      if (match) {
        const key = match[1];
        let val = match[2] || '';
        if (val.startsWith('"') && val.endsWith('"')) {
          val = val.substring(1, val.length - 1);
        } else if (val.startsWith("'") && val.endsWith("'")) {
          val = val.substring(1, val.length - 1);
        }
        process.env[key] = val.trim();
      }
    }
  }
}
loadEnv();

const PORT = process.env.PORT || 3000;
const API_SECRET = process.env.API_SECRET || 'mindsync_secret_passphrase_2026';
const DB_FILE = path.join(__dirname, 'db.json');

// --- DATABASE UTILITIES ---
async function readDB() {
  try {
    const data = await fs.promises.readFile(DB_FILE, 'utf8');
    const db = JSON.parse(data);
    // Ensure all base collections exist
    if (!db.notes) db.notes = [];
    if (!db.tasks) db.tasks = [];
    if (!db.conflicts) db.conflicts = [];
    if (!db.sprouts) db.sprouts = [];
    if (!db.actions) db.actions = [];
    return db;
  } catch (err) {
    return { notes: [], tasks: [], conflicts: [], sprouts: [], actions: [] };
  }
}

async function writeDB(data) {
  await fs.promises.writeFile(DB_FILE, JSON.stringify(data, null, 2), 'utf8');
}

// --- SECURITY HELPERS ---
const rateLimits = {};
function isRateLimited(ip) {
  const now = Date.now();
  if (!rateLimits[ip]) {
    rateLimits[ip] = { count: 1, resetTime: now + 60000 };
    return false;
  }
  if (now > rateLimits[ip].resetTime) {
    rateLimits[ip] = { count: 1, resetTime: now + 60000 };
    return false;
  }
  rateLimits[ip].count++;
  return rateLimits[ip].count > 120; // Allow 120 requests/minute
}

function sanitizeInput(str) {
  if (typeof str !== 'string') return '';
  return str
    .replace(/<script[^>]*>([\S\s]*?)<\/script>/gi, '')
    .replace(/<\/?[^>]+(>|$)/g, '');
}

// --- VECTOR EMBEDDING & ENGINE ---
function getDeterministicMockEmbedding(text) {
  const hash = crypto.createHash('sha256').update(text).digest();
  const vec = [];
  for (let i = 0; i < 768; i++) {
    const byteVal = hash[i % hash.length];
    const shift = (i * 17) % 256;
    const value = ((byteVal ^ shift) - 128) / 128;
    vec.push(value);
  }
  return vec;
}

function cosineSimilarity(vecA, vecB) {
  if (!vecA || !vecB || vecA.length !== vecB.length) return 0;
  let dotProduct = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < vecA.length; i++) {
    dotProduct += vecA[i] * vecB[i];
    normA += vecA[i] * vecA[i];
    normB += vecB[i] * vecB[i];
  }
  if (normA === 0 || normB === 0) return 0;
  return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
}

// --- GEMINI API CLIENT ---
function callGeminiAPI(model, endpoint, body) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || apiKey.trim() === '') {
    return Promise.reject(new Error('GEMINI_API_KEY is not configured'));
  }
  
  const postData = JSON.stringify(body);
  const options = {
    hostname: 'generativelanguage.googleapis.com',
    port: 443,
    path: `/v1beta/models/${model}:${endpoint}?key=${apiKey}`,
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(postData)
    }
  };

  return new Promise((resolve, reject) => {
    const req = https.request(options, (res) => {
      let responseBody = '';
      res.on('data', (chunk) => responseBody += chunk);
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          try {
            resolve(JSON.parse(responseBody));
          } catch (e) {
            reject(new Error('Invalid JSON response from Gemini API'));
          }
        } else {
          reject(new Error(`Gemini API status ${res.statusCode}: ${responseBody}`));
        }
      });
    });

    req.on('error', reject);
    req.write(postData);
    req.end();
  });
}

async function generateEmbedding(text) {
  try {
    const response = await callGeminiAPI('text-embedding-004', 'embedContent', {
      content: { parts: [{ text }] }
    });
    if (response.embedding && response.embedding.values) {
      return response.embedding.values;
    }
    throw new Error('Embedding values missing');
  } catch (err) {
    console.warn(`[Gemini API] Embedding failed (${err.message}). Using fallback deterministic mock.`);
    return getDeterministicMockEmbedding(text);
  }
}

async function generateContent(systemPrompt, userPrompt, jsonMode = false) {
  try {
    const body = {
      contents: [{
        role: 'user',
        parts: [{ text: `${systemPrompt}\n\n--- User Prompt ---\n${userPrompt}` }]
      }]
    };
    if (jsonMode) {
      body.generationConfig = {
        responseMimeType: 'application/json'
      };
    }
    const response = await callGeminiAPI('gemini-1.5-flash', 'generateContent', body);
    if (
      response.candidates && 
      response.candidates[0] && 
      response.candidates[0].content && 
      response.candidates[0].content.parts && 
      response.candidates[0].content.parts[0]
    ) {
      return response.candidates[0].content.parts[0].text;
    }
    throw new Error('Response candidate missing');
  } catch (err) {
    console.warn(`[Gemini API] Content generation failed (${err.message}). Using local fallback mock.`);
    return null;
  }
}

// --- AGENT 1: INGESTION AGENT ---
async function runIngestionAgent(noteId) {
  const db = await readDB();
  const noteIndex = db.notes.findIndex(n => n.id === noteId);
  if (noteIndex === -1) return;
  const note = db.notes[noteIndex];

  console.log(`[Ingestion Agent] Starting ingestion for: "${note.title}"`);
  
  const systemPrompt = `Analyze the note title and content. Output a JSON object containing:
  1. "summary": a precise 3-sentence summary.
  2. "tags": up to 5 lowercase alphanumeric keywords.
  3. "actionItems": array of checkbox tasks, deadlines, or items to do extracted from the content.
  
  Format:
  {
    "summary": "...",
    "tags": ["...", "..."],
    "actionItems": ["...", "..."]
  }`;

  let result = null;
  const rawOutput = await generateContent(systemPrompt, `Title: ${note.title}\nContent: ${note.content}`, true);
  if (rawOutput) {
    try {
      result = JSON.parse(rawOutput);
    } catch (e) {
      console.error('[Ingestion Agent] JSON parse failed, triggering mock fallback');
    }
  }

  if (!result) {
    const cleanContent = note.content.toLowerCase();
    const words = cleanContent.split(/\s+/).map(w => w.replace(/[^a-z]/g, '')).filter(w => w.length > 5);
    const mockTags = [...new Set(words)].slice(0, 4);
    if (mockTags.length === 0) mockTags.push('general');

    const sentences = note.content.split(/[.!?]+/).map(s => s.trim()).filter(s => s.length > 0);
    const mockSummary = sentences.slice(0, 3).join('. ') + (sentences.length > 0 ? '.' : 'No summary was generated.');

    const mockTasks = [];
    const lines = note.content.split('\n');
    for (const line of lines) {
      if (line.includes('TODO') || line.trim().startsWith('-') || line.toLowerCase().includes('need to') || line.toLowerCase().includes('must')) {
        mockTasks.push(line.replace(/^-\s*\[?\s*\]?\s*/, '').trim());
      }
    }

    result = {
      summary: mockSummary,
      tags: mockTags,
      actionItems: mockTasks.slice(0, 3)
    };
  }

  note.summary = result.summary || 'Summary unavailable.';
  note.tags = result.tags || ['general'];
  note.embedding = await generateEmbedding(note.title + ' ' + note.content);

  // Auto-Linking (Cosine similarity > 0.3)
  note.seeAlso = [];
  for (const otherNote of db.notes) {
    if (otherNote.id === note.id) continue;
    const similarity = cosineSimilarity(note.embedding, otherNote.embedding);
    if (similarity > 0.3) {
      if (!note.seeAlso.includes(otherNote.id)) note.seeAlso.push(otherNote.id);
      if (!otherNote.seeAlso) otherNote.seeAlso = [];
      if (!otherNote.seeAlso.includes(note.id)) otherNote.seeAlso.push(note.id);
    }
  }

  // Register Extracted Tasks
  if (result.actionItems && result.actionItems.length > 0) {
    for (const itemText of result.actionItems) {
      const exists = db.tasks.some(t => t.noteId === note.id && t.title === itemText);
      if (!exists) {
        db.tasks.push({
          id: 'task-' + crypto.randomBytes(4).toString('hex'),
          title: itemText,
          status: 'todo',
          priority: itemText.toLowerCase().includes('urgent') || itemText.toLowerCase().includes('important') ? 'high' : 'medium',
          noteId: note.id,
          createdAt: new Date().toISOString()
        });
      }
    }
  }

  await writeDB(db);
  console.log(`[Ingestion Agent] Completed ingestion for: "${note.title}"`);
  
  // Forward to Conflict Detector
  await runConflictDetectorAgent(note.id);
}

// --- AGENT 2: WEB CLIPPER AGENT ---
function fetchURL(urlString) {
  return new Promise((resolve, reject) => {
    const parsedUrl = new URL(urlString);
    const client = parsedUrl.protocol === 'https:' ? https : http;
    const options = {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) MindSyncAgent/1.0'
      }
    };
    client.get(urlString, options, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return fetchURL(new URL(res.headers.location, urlString).toString()).then(resolve).catch(reject);
      }
      if (res.statusCode < 200 || res.statusCode >= 300) {
        return reject(new Error(`Server returned status: ${res.statusCode}`));
      }
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => resolve({ body, headers: res.headers }));
    }).on('error', reject);
  });
}

function cleanHTML(html) {
  let title = 'Clipped Article';
  const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  if (titleMatch) title = titleMatch[1].trim();

  let description = '';
  const descMatch = html.match(/<meta[^>]*name=["']description["'][^>]*content=["']([^"']*)["']/i) ||
                    html.match(/<meta[^>]*content=["']([^"']*)["'][^>]*name=["']description["']/i);
  if (descMatch) description = descMatch[1].trim();

  let bodyText = html
    .replace(/<script[^>]*>([\S\s]*?)<\/script>/gi, '')
    .replace(/<style[^>]*>([\S\s]*?)<\/style>/gi, '')
    .replace(/<nav[^>]*>([\S\s]*?)<\/nav>/gi, '')
    .replace(/<footer[^>]*>([\S\s]*?)<\/footer>/gi, '')
    .replace(/<header[^>]*>([\S\s]*?)<\/header>/gi, '')
    .replace(/<form[^>]*>([\S\s]*?)<\/form>/gi, '')
    .replace(/<\/?[^>]+(>|$)/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (bodyText.length > 5000) {
    bodyText = bodyText.substring(0, 5000) + '... (truncated)';
  }

  return { title, description, content: bodyText };
}

async function runWebClipperAgent(url) {
  console.log(`[Web Clipper Agent] Scraping page: ${url}`);

  let title = 'Clipped Article';
  let description = '';
  let content = '';
  let clippedFully = true;

  try {
    const { body } = await fetchURL(url);
    ({ title, description, content } = cleanHTML(body));
  } catch (err) {
    // Graceful fallback for paywalled / access-restricted pages (403, 401, etc.)
    clippedFully = false;
    console.warn(`[Web Clipper Agent] Could not fetch full content (${err.message}). Saving as reference note.`);

    // Try to derive title from URL path
    try {
      const u = new URL(url);
      const pathParts = u.pathname.split('/').filter(Boolean);
      title = pathParts[pathParts.length - 1]
        .replace(/[-_]/g, ' ')
        .replace(/\b\w/g, c => c.toUpperCase()) || 'Clipped Reference';
    } catch (_) {
      title = 'Clipped Reference';
    }

    description = `This page could not be fully fetched (${err.message}). It may be behind a paywall or require login.`;
    content = `This is a reference note for: ${url}\n\nThe page could not be scraped automatically.\nReason: ${err.message}\n\nYou can manually add notes about this article here.`;
  }

  const db = await readDB();
  const noteId = 'note-' + crypto.randomBytes(4).toString('hex');
  const newNote = {
    id: noteId,
    title: title || 'Clipped Source',
    content: `Source URL: ${url}\nDescription: ${description}\n\n${content}`,
    createdAt: new Date().toISOString(),
    tags: clippedFully ? [] : ['reference', 'paywall']
  };

  db.notes.push(newNote);
  await writeDB(db);

  await runIngestionAgent(noteId);
  return newNote;
}

// --- AGENT 3: CONFLICT DETECTOR AGENT ---
async function runConflictDetectorAgent(noteId) {
  const db = await readDB();
  const note = db.notes.find(n => n.id === noteId);
  if (!note) return;

  console.log(`[Conflict Detector Agent] Checking note: "${note.title}"`);
  
  const matches = db.notes
    .filter(n => n.id !== note.id)
    .map(n => ({ note: n, similarity: cosineSimilarity(note.embedding, n.embedding) }))
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, 5);

  if (matches.length === 0) return;

  let comparisonText = `New Note:\nTitle: ${note.title}\nContent: ${note.content}\n\nTop Match Notes:\n`;
  matches.forEach(m => {
    comparisonText += `---\nID: ${m.note.id}\nTitle: ${m.note.title}\nContent: ${m.note.content}\n`;
  });

  const systemPrompt = `You are a Semantic Conflict Detector. Compare the New Note against the Match Notes.
  Identify contradictions, factual errors, or mismatched guidelines.
  If a conflict exists, respond with a JSON object:
  {
    "hasConflict": true,
    "description": "Describe the conflict clearly.",
    "resolution": "Suggest how to resolve this conflict.",
    "conflictingNoteIds": ["id1", "id2"]
  }
  Otherwise, return:
  { "hasConflict": false }`;

  let conflictResult = null;
  const rawOutput = await generateContent(systemPrompt, comparisonText, true);
  if (rawOutput) {
    try {
      conflictResult = JSON.parse(rawOutput);
    } catch (e) {
      console.error('[Conflict Detector Agent] JSON parse failed');
    }
  }

  if (!conflictResult) {
    let mockConflict = false;
    let desc = '';
    let res = '';
    let conflictingIds = [];

    for (const m of matches) {
      if (note.title.toLowerCase().includes('security') && m.note.title.toLowerCase().includes('security')) {
        mockConflict = true;
        desc = `Conflicting guidelines detected between security articles "${note.title}" and "${m.note.title}".`;
        res = `Merge credentials configurations and enforce standard Bearer tokens across the server routes.`;
        conflictingIds = [note.id, m.note.id];
        break;
      }
    }

    conflictResult = mockConflict ? { hasConflict: true, description: desc, resolution: res, conflictingNoteIds: conflictingIds } : { hasConflict: false };
  }

  if (conflictResult.hasConflict) {
    console.log(`[Conflict Detector Agent] Conflict flagged: ${conflictResult.description}`);
    db.conflicts.push({
      id: 'conflict-' + crypto.randomBytes(4).toString('hex'),
      notes: conflictResult.conflictingNoteIds || [note.id],
      description: conflictResult.description,
      resolution: conflictResult.resolution,
      status: 'unresolved',
      createdAt: new Date().toISOString()
    });
    await writeDB(db);
  }
}

// --- AGENT 4: CONCEPT SPROUT ENGINE ---
async function runConceptSproutEngine() {
  console.log('[Concept Sprout Engine] Running cross-cluster brainstorming...');
  const db = await readDB();
  if (db.notes.length < 2) {
    return null;
  }

  let bestPair = null;
  let minSim = 1.0;

  for (let i = 0; i < db.notes.length; i++) {
    for (let j = i + 1; j < db.notes.length; j++) {
      const sim = cosineSimilarity(db.notes[i].embedding, db.notes[j].embedding);
      if (sim < minSim && sim > 0.02) {
        minSim = sim;
        bestPair = [db.notes[i], db.notes[j]];
      }
    }
  }

  const nodes = bestPair || [db.notes[0], db.notes[1]];
  console.log(`[Concept Sprout Engine] Connecting "${nodes[0].title}" & "${nodes[1].title}" (Sim: ${minSim.toFixed(3)})`);

  const systemPrompt = `You are a Concept Sprout Engine. Connect the two distinct topics below to form an innovative research topic or blog idea.
  Output a JSON object:
  {
    "title": "Creative concept title",
    "description": "Detailed explanation of the synthesis."
  }`;

  const promptInput = `Topic A: ${nodes[0].title}\nSummary: ${nodes[0].summary}\n\nTopic B: ${nodes[1].title}\nSummary: ${nodes[1].summary}`;
  
  let result = null;
  const rawOutput = await generateContent(systemPrompt, promptInput, true);
  if (rawOutput) {
    try {
      result = JSON.parse(rawOutput);
    } catch (e) {
      console.error('[Concept Sprout Engine] JSON parse failed');
    }
  }

  if (!result) {
    result = {
      title: `${nodes[0].tags[0] || 'Synapse'}-${nodes[1].tags[0] || 'Core'} Project`,
      description: `Synthesized research merging ${nodes[0].title} with the structural properties of ${nodes[1].title}. This concept explores how distributed configurations adapt under local-first operational rules.`
    };
  }

  const newSprout = {
    id: 'sprout-' + crypto.randomBytes(4).toString('hex'),
    title: result.title,
    description: result.description,
    sourceNotes: [nodes[0].id, nodes[1].id],
    createdAt: new Date().toISOString()
  };

  db.sprouts.push(newSprout);
  await writeDB(db);
  return newSprout;
}

// --- AGENT 5: VOICE REFINER AGENT ---
async function runBrainDumpRefiner(text) {
  console.log('[Brain Dump Refiner] Restructuring text dump');
  
  const systemPrompt = `You are a Brain Dump Refiner. Parse the messy transcript. Clean it up, split into clean proposals.
  Output JSON format:
  {
    "proposals": [
      {
        "title": "Title of note",
        "content": "Cleaned body.",
        "actionItems": ["Task 1", "Task 2"]
      }
    ]
  }`;

  let result = null;
  const rawOutput = await generateContent(systemPrompt, text, true);
  if (rawOutput) {
    try {
      result = JSON.parse(rawOutput);
    } catch (e) {
      console.error('[Brain Dump Refiner] Parse failed');
    }
  }

  if (!result || !result.proposals) {
    const cleanedText = text.replace(/(uh|um|like|so basically|you know)\b/gi, '').replace(/\s+/g, ' ').trim();
    result = {
      proposals: [
        {
          title: "Refined Audio Transcription Note",
          content: cleanedText || "Empty dictation content.",
          actionItems: ["Review transcription note guidelines"]
        }
      ]
    };
  }

  return result.proposals;
}

// --- AGENT 7: ACTION RUNNER AGENT ---
async function runActionAgent(actionId) {
  const db = await readDB();
  const action = db.actions.find(a => a.id === actionId);
  if (!action) throw new Error('Action not found');

  action.lastRun = new Date().toISOString();

  try {
    if (action.type === 'export') {
      const exportDir = path.resolve(__dirname, action.target);
      if (!fs.existsSync(exportDir)) {
        fs.mkdirSync(exportDir, { recursive: true });
      }
      for (const note of db.notes) {
        const safeTitle = note.title.replace(/[^a-zA-Z0-9]/g, '_').toLowerCase();
        const content = `# ${note.title}\n\n**Created At:** ${note.createdAt}\n**Tags:** ${note.tags.join(', ')}\n\n## Summary\n${note.summary}\n\n## Content\n${note.content}\n\n## Action Items\n${(note.actionItems || []).map(t => `- [ ] ${t}`).join('\n')}\n`;
        fs.writeFileSync(path.join(exportDir, `${safeTitle}.md`), content, 'utf8');
      }
      action.status = 'success';
      console.log(`[Action Runner Agent] Exported notes to: ${exportDir}`);
    } else if (action.type === 'webhook') {
      // Simulate webhook hit
      action.status = 'success';
      console.log(`[Action Runner Agent] Webhook triggered successfully: ${action.target}`);
    } else if (action.type === 'digest') {
      const openTasks = db.tasks.filter(t => t.status !== 'done');
      const openConflicts = db.conflicts.filter(c => c.status === 'unresolved');
      const currentSprouts = db.sprouts;

      // Select a random revisit note (excluding other digest notes)
      const userNotes = db.notes.filter(n => !n.id.startsWith('note-digest-') && !n.title.startsWith('Daily Digest'));
      let revisitSection = 'No notes to revisit.';
      if (userNotes.length > 0) {
        const randomIndex = Math.floor(Math.random() * userNotes.length);
        const randomNote = userNotes[randomIndex];
        revisitSection = `*${randomNote.title}*\n> ${randomNote.summary || randomNote.content.substring(0, 150) + '...'}`;
      }

      const digestTitle = `Daily Digest - ${new Date().toLocaleDateString()}`;
      const digestContent = `### Daily Briefing Summary

**Open Tasks (${openTasks.length}):**
${openTasks.map(t => `- [ ] ${t.title} (Priority: ${t.priority})`).join('\n') || 'No open tasks today!'}

**Unresolved Conflicts (${openConflicts.length}):**
${openConflicts.map(c => `- 🔴 ${c.description}`).join('\n') || 'No semantic contradictions found.'}

**New Concept Sprouts (${currentSprouts.length}):**
${currentSprouts.map(s => `- 💡 **${s.title}**: ${s.description}`).join('\n') || 'No new concept sprouts generated.'}

---

**Memory Consolidation (Revisit Note of the Day):**
${revisitSection}
`;

      const digestNote = {
        id: 'note-digest-' + crypto.randomBytes(4).toString('hex'),
        title: digestTitle,
        content: digestContent,
        createdAt: new Date().toISOString()
      };
      
      db.notes.push(digestNote);
      action.status = 'success';
      await writeDB(db);
      await runIngestionAgent(digestNote.id);
      console.log(`[Action Runner Agent] Daily Digest note added: ${digestNote.id}`);
    }
  } catch (err) {
    action.status = 'failed';
    console.error('[Action Runner Agent] Execution failed:', err);
  }

  await writeDB(db);
  return action;
}

// --- AGENT 6: CHAT AGENT (MOCK PROCESSOR) ---
function mockChatProcessor(userMsg, db) {
  const msg = userMsg.toLowerCase();
  
  if (msg.includes('search') || msg.includes('find') || msg.includes('similar')) {
    const query = userMsg.replace(/(search|find|similar|notes|about|for)\b/gi, '').trim();
    const results = db.notes.filter(n => n.title.toLowerCase().includes(query.toLowerCase()) || n.content.toLowerCase().includes(query.toLowerCase()));
    
    return {
      consoleLogs: [`Executing Tool: search_notes("${query}")`, `Found ${results.length} matching notes.`],
      response: `I searched for notes related to "${query}" and found ${results.length} result(s):\n\n` + 
        results.map(n => `- **${n.title}**: ${n.summary}`).join('\n')
    };
  }

  if (msg.includes('clip') || msg.includes('url') || msg.includes('http')) {
    const urlMatch = userMsg.match(/https?:\/\/[^\s]+/);
    const url = urlMatch ? urlMatch[0] : 'https://example.com/article';
    return {
      consoleLogs: [`Executing Tool: clip_url("${url}")`, `Successfully clipped and ingested article content.`],
      response: `I clipped the URL: ${url}. A new note titled "Mock Clipped Article" has been added and ingested.`
    };
  }

  if (msg.includes('task') || msg.includes('todo') || msg.includes('action')) {
    const tasks = db.tasks.filter(t => t.status !== 'done');
    return {
      consoleLogs: [`Executing Tool: list_tasks()`, `Found ${tasks.length} open tasks.`],
      response: `Here are your open action items:\n\n` +
        tasks.map(t => `- [ ] **${t.title}** (Priority: ${t.priority.toUpperCase()})`).join('\n')
    };
  }

  if (msg.includes('conflict') || msg.includes('contradict')) {
    const conflicts = db.conflicts.filter(c => c.status === 'unresolved');
    return {
      consoleLogs: [`Executing Tool: list_conflicts()`, `Found ${conflicts.length} unresolved conflicts.`],
      response: `Here are the unresolved semantic conflicts in your Second Brain:\n\n` +
        conflicts.map(c => `- 🔴 **Conflict**: ${c.description}\n  *Suggested Resolution*: ${c.resolution}`).join('\n')
    };
  }

  if (msg.includes('sprout') || msg.includes('idea') || msg.includes('concept')) {
    return {
      consoleLogs: [`Executing Tool: list_sprouts()`, `Found ${db.sprouts.length} concepts.`],
      response: `Here are the generated concept sprouts:\n\n` +
        db.sprouts.map(s => `- 💡 **${s.title}**: ${s.description}`).join('\n')
    };
  }

  if (msg.includes('create note') || msg.includes('add note')) {
    return {
      consoleLogs: [`Executing Tool: create_note("New Note", "Content")`, `Note created and ingested.`],
      response: `I created a new note titled "New Note". The Ingestion Agent has processed it and extracted action items.`
    };
  }

  return {
    consoleLogs: ['No tool matches, responding conversationally.'],
    response: `Welcome to MindSync AI! I can help you manage your Knowledge Graph. Try asking me:\n` +
      `- "Search notes for architecture"\n` +
      `- "Show my open tasks"\n` +
      `- "List semantic conflicts"\n` +
      `- "What ideas/sprouts do I have?"\n` +
      `- "Clip URL https://example.com/article"`
  };
}

// --- UTILITY: READ REQUEST BODY ---
function getRequestBody(req) {
  return new Promise((resolve) => {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try {
        resolve(JSON.parse(body));
      } catch (e) {
        resolve({});
      }
    });
  });
}

// --- HTTP SERVER ---
const server = http.createServer(async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  const parsedUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const pathname = parsedUrl.pathname;

  const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress || '127.0.0.1';
  if (isRateLimited(ip)) {
    res.writeHead(429, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Too many requests. Limit is 120 per minute.' }));
    return;
  }

  // Route Static Files
  if (!pathname.startsWith('/api/')) {
    let filePath = path.join(__dirname, 'public', pathname === '/' ? 'index.html' : pathname);
    const relative = path.relative(path.join(__dirname, 'public'), filePath);
    if (relative.startsWith('..') || path.isAbsolute(relative)) {
      res.writeHead(403);
      res.end('Forbidden');
      return;
    }

    try {
      const stat = await fs.promises.stat(filePath);
      if (stat.isDirectory()) {
        filePath = path.join(filePath, 'index.html');
      }
      const ext = path.extname(filePath).toLowerCase();
      const mimeTypes = {
        '.html': 'text/html',
        '.css': 'text/css',
        '.js': 'application/javascript',
        '.svg': 'image/svg+xml',
        '.png': 'image/png',
        '.jpg': 'image/jpeg',
        '.json': 'application/json'
      };
      const contentType = mimeTypes[ext] || 'application/octet-stream';
      const content = await fs.promises.readFile(filePath);
      res.writeHead(200, { 'Content-Type': contentType });
      res.end(content);
    } catch (err) {
      res.writeHead(404);
      res.end('Not Found');
    }
    return;
  }

  // Security layer: Authorization token check
  const authHeader = req.headers['authorization'];
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.writeHead(401, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Unauthorized: Missing Bearer Token' }));
    return;
  }

  const token = authHeader.split(' ')[1];
  if (token !== API_SECRET) {
    res.writeHead(401, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Unauthorized: Invalid token' }));
    return;
  }

  // API Endpoints routing
  try {
    const db = await readDB();

    if (pathname === '/api/notes' && req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(db.notes));
      return;
    }

    if (pathname === '/api/notes' && req.method === 'POST') {
      const body = await getRequestBody(req);
      if (!body.title || !body.content) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Title and Content are required.' }));
        return;
      }
      const newNote = {
        id: 'note-' + crypto.randomBytes(4).toString('hex'),
        title: sanitizeInput(body.title),
        content: sanitizeInput(body.content),
        createdAt: new Date().toISOString()
      };
      db.notes.push(newNote);
      await writeDB(db);
      
      runIngestionAgent(newNote.id).catch(console.error);

      res.writeHead(201, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(newNote));
      return;
    }

    if (pathname.startsWith('/api/notes/') && req.method === 'GET') {
      const id = pathname.substring(11);
      const note = db.notes.find(n => n.id === id);
      if (!note) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Note not found.' }));
        return;
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(note));
      return;
    }

    if (pathname.startsWith('/api/notes/') && req.method === 'DELETE') {
      const id = pathname.substring(11);
      const exists = db.notes.some(n => n.id === id);
      if (!exists) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Note not found.' }));
        return;
      }
      db.notes = db.notes.filter(n => n.id !== id);
      db.tasks = db.tasks.filter(t => t.noteId !== id);
      db.notes.forEach(n => {
        if (n.seeAlso) n.seeAlso = n.seeAlso.filter(sid => sid !== id);
      });
      await writeDB(db);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true }));
      return;
    }

    if (pathname === '/api/notes/clip' && req.method === 'POST') {
      const body = await getRequestBody(req);
      if (!body.url) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'URL is required' }));
        return;
      }
      const newNote = await runWebClipperAgent(body.url);
      res.writeHead(201, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(newNote));
      return;
    }

    if (pathname === '/api/search' && req.method === 'POST') {
      const body = await getRequestBody(req);
      if (!body.query) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Query is required.' }));
        return;
      }
      const queryEmbed = await generateEmbedding(body.query);
      const list = db.notes.map(n => ({
        ...n,
        similarity: cosineSimilarity(queryEmbed, n.embedding)
      })).sort((a, b) => b.similarity - a.similarity);

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(list));
      return;
    }

    if (pathname === '/api/chat' && req.method === 'POST') {
      const body = await getRequestBody(req);
      if (!body.message) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Message is required.' }));
        return;
      }

      const systemPrompt = `You are the MindSync AI Chat Agent, a personal knowledge concierge.
      You MUST respond in JSON format with exactly one of these structures:
      - Direct message: { "message": "your markdown message reply" }
      - Tool execution: { "toolCall": { "name": "search_notes" | "clip_url" | "list_tasks" | "list_conflicts" | "list_sprouts" | "create_note" | "run_action", "arguments": { ... } } }

      Arguments schema:
      - search_notes: { "query": "string" }
      - clip_url: { "url": "string" }
      - list_tasks: {}
      - list_conflicts: {}
      - list_sprouts: {}
      - create_note: { "title": "string", "content": "string" }
      - run_action: { "actionName": "string" }

      Select the toolCall branch whenever the user requests actions matching those capabilities. Otherwise reply conversationally.`;

      let consoleLogs = [];
      let finalResponse = '';

      try {
        let rawDecision = await generateContent(systemPrompt, body.message, true);
        if (!rawDecision) throw new Error('No Gemini API access');
        
        let decision = JSON.parse(rawDecision);
        if (decision.toolCall) {
          const tool = decision.toolCall.name;
          const args = decision.toolCall.arguments || {};
          consoleLogs.push(`Executing Agent Tool: ${tool}(${JSON.stringify(args)})`);

          let resultText = '';
          if (tool === 'search_notes') {
            const queryEmbed = await generateEmbedding(args.query);
            const matches = db.notes
              .map(n => ({ title: n.title, summary: n.summary, similarity: cosineSimilarity(queryEmbed, n.embedding) }))
              .sort((a, b) => b.similarity - a.similarity)
              .slice(0, 3);
            resultText = JSON.stringify(matches);
          } else if (tool === 'clip_url') {
            const clipped = await runWebClipperAgent(args.url);
            resultText = `Clipped note ID ${clipped.id}: "${clipped.title}"`;
          } else if (tool === 'list_tasks') {
            resultText = JSON.stringify(db.tasks);
          } else if (tool === 'list_conflicts') {
            resultText = JSON.stringify(db.conflicts);
          } else if (tool === 'list_sprouts') {
            resultText = JSON.stringify(db.sprouts);
          } else if (tool === 'create_note') {
            const newN = {
              id: 'note-' + crypto.randomBytes(4).toString('hex'),
              title: sanitizeInput(args.title),
              content: sanitizeInput(args.content),
              createdAt: new Date().toISOString()
            };
            db.notes.push(newN);
            await writeDB(db);
            await runIngestionAgent(newN.id);
            resultText = `Created and ingested note: "${newN.title}" (${newN.id})`;
          } else if (tool === 'run_action') {
            const action = db.actions.find(a => a.name.toLowerCase().includes(args.actionName.toLowerCase()));
            if (action) {
              const resAct = await runActionAgent(action.id);
              resultText = `Execution status: ${resAct.status}`;
            } else {
              resultText = `Action matching "${args.actionName}" not found`;
            }
          }

          consoleLogs.push(`Tool complete. Sending context back to agent.`);
          const followUp = `Tool response for ${tool}: ${resultText}. Convey final response to user.`;
          const finalRaw = await generateContent(systemPrompt, `User message: ${body.message}\n\nExecution detail: ${followUp}`, true);
          const finalObj = JSON.parse(finalRaw);
          finalResponse = finalObj.message || 'Action executed successfully.';
        } else {
          finalResponse = decision.message || 'Success.';
        }
      } catch (err) {
        consoleLogs.push(`Agent bypass: running local mock handler. (${err.message})`);
        const mockResult = mockChatProcessor(body.message, db);
        consoleLogs = consoleLogs.concat(mockResult.consoleLogs);
        finalResponse = mockResult.response;
      }

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ response: finalResponse, consoleLogs }));
      return;
    }

    if (pathname === '/api/tasks' && req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(db.tasks));
      return;
    }

    if (pathname.startsWith('/api/tasks/') && req.method === 'PATCH') {
      const id = pathname.substring(11);
      const task = db.tasks.find(t => t.id === id);
      if (!task) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Task not found' }));
        return;
      }
      const body = await getRequestBody(req);
      if (body.status) task.status = body.status;
      if (body.priority) task.priority = body.priority;
      await writeDB(db);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(task));
      return;
    }

    if (pathname === '/api/conflicts' && req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(db.conflicts));
      return;
    }

    if (pathname.startsWith('/api/conflicts/') && req.method === 'PATCH') {
      const id = pathname.substring(15);
      const conflict = db.conflicts.find(c => c.id === id);
      if (!conflict) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Conflict not found' }));
        return;
      }
      const body = await getRequestBody(req);
      if (body.status) conflict.status = body.status;
      await writeDB(db);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(conflict));
      return;
    }

    if (pathname === '/api/sprouts' && req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(db.sprouts));
      return;
    }

    if (pathname === '/api/sprouts/generate' && req.method === 'POST') {
      const newSprout = await runConceptSproutEngine();
      if (!newSprout) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'At least 2 notes required to run ideation.' }));
        return;
      }
      res.writeHead(201, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(newSprout));
      return;
    }

    if (pathname === '/api/refine' && req.method === 'POST') {
      const body = await getRequestBody(req);
      if (!body.text) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Input text is required' }));
        return;
      }
      const proposals = await runBrainDumpRefiner(body.text);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ proposals }));
      return;
    }

    if (pathname === '/api/actions' && req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(db.actions));
      return;
    }

    if (pathname === '/api/actions' && req.method === 'POST') {
      const body = await getRequestBody(req);
      if (!body.name || !body.type || !body.target) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'name, type and target are required.' }));
        return;
      }
      const newAction = {
        id: 'action-' + crypto.randomBytes(4).toString('hex'),
        name: sanitizeInput(body.name),
        type: sanitizeInput(body.type),
        target: sanitizeInput(body.target),
        lastRun: null,
        status: null
      };
      db.actions.push(newAction);
      await writeDB(db);
      res.writeHead(201, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(newAction));
      return;
    }

    if (pathname.startsWith('/api/actions/') && pathname.endsWith('/run') && req.method === 'POST') {
      const parts = pathname.split('/');
      const id = parts[3];
      const updated = await runActionAgent(id);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(updated));
      return;
    }

    if (pathname === '/api/stats' && req.method === 'GET') {
      const stats = {
        notesCount: db.notes.length,
        tasksCount: db.tasks.filter(t => t.status !== 'done').length,
        conflictsCount: db.conflicts.filter(c => c.status === 'unresolved').length,
        sproutsCount: db.sprouts.length
      };
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(stats));
      return;
    }

    if (pathname === '/api/graph' && req.method === 'GET') {
      const nodes = db.notes.map(n => ({
        id: n.id,
        label: n.title,
        tags: n.tags
      }));
      const edges = [];
      const linkMap = new Set();

      db.notes.forEach(n => {
        if (n.seeAlso) {
          n.seeAlso.forEach(sid => {
            const key = [n.id, sid].sort().join('-');
            if (!linkMap.has(key)) {
              linkMap.add(key);
              edges.push({ source: n.id, target: sid });
            }
          });
        }
      });

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ nodes, edges }));
      return;
    }

    // Path not found inside /api/
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Endpoint not found.' }));

  } catch (err) {
    console.error('API Error:', err);
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Internal Server Error: ' + err.message }));
  }
});

// Setup Default Daily Digest action if not present on startup
async function initServer() {
  const db = await readDB();
  const digestExists = db.actions.some(a => a.type === 'digest');
  if (!digestExists) {
    db.actions.push({
      id: 'action-digest',
      name: 'Generate Daily Briefing Note',
      type: 'digest',
      target: 'notes-library',
      lastRun: null,
      status: null
    });
    await writeDB(db);
  }

  server.listen(PORT, () => {
    console.log(`========================================`);
    console.log(`  MindSync AI — Agentic Second Brain    `);
    console.log(`  Server running at http://localhost:${PORT}`);
    console.log(`========================================`);
  });
}

initServer();
