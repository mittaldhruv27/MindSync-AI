# MindSync AI — The Agentic Second Brain (Full Capstone Edition)

> **Track:** Concierge Agents (also touches Agents for Good, Business, and Freestyle)  
> **Tagline:** *"Your knowledge, alive and thinking."*

MindSync AI is a **zero-dependency, local-first Agentic Second Brain** that doesn't just store your notes — it reads them, understands them, connects them, challenges them, and acts on them. It is a personal knowledge workspace powered by a team of autonomous AI agents that continuously work in the background to organize, enrich, and surface insights from everything you save.

---

## 🚀 Quick Start (Single-Command Launch)

MindSync AI is built with zero external npm or Python dependencies. It runs on pure, native Node.js.

1. **Clone the repository and set up environment:**
   Create a `.env` file in the root directory:
   ```env
   GEMINI_API_KEY=your_gemini_api_key_here
   API_SECRET=mindsync_secret_passphrase_2026
   PORT=3000
   ```
   *(If `GEMINI_API_KEY` is not set, MindSync runs in a robust **Mock Mode** using deterministic embedding hashes and local text classifiers so that the application remains fully interactive and responsive!)*

2. **Start the server:**
   ```bash
   node server.js
   ```

3. **Open the App:**
   Navigate to `http://localhost:3000` in your web browser.

---

## 🔌 Model Context Protocol (MCP) Server Setup

MindSync AI acts as an MCP server over stdio. This allows external tools (like the Antigravity chat, Claude Desktop, etc.) to access your knowledge base.

To register this server in your Antigravity config (`~/.gemini/config/config.json`), add the following to the `mcpServers` object:

```json
{
  "mcpServers": {
    "mindsync": {
      "command": "node",
      "args": ["/Users/krishverma/Desktop/MindSyncAI/MindSync-AI/mcp_server.js"],
      "env": {
        "PORT": "3000",
        "API_SECRET": "mindsync_secret_passphrase_2026"
      }
    }
  }
}
```

---

## 🤖 The Seven Background Agents

MindSync AI coordinates 7 autonomous sub-agents working together on a shared database state (`db.json`):

1. **Ingestion Agent (Background Processor):** Triggered when a note is saved. Generates a 3-sentence summary, tags (up to 5 keywords), action items, and calculates semantic embedding.
2. **Web Clipper Agent (Dynamic Reader):** Scrapes the readable main body text of a URL, stripping boilerplate, and forwards it to the Ingestion Agent.
3. **Conflict Detector Agent (Active Critic):** Retrieves similar notes via cosine similarity and uses Gemini to flag factual contradictions, outdated claims, or schedule incompatibilities.
4. **Concept Sprout Engine (Brainstormer):** Selects topically distant notes and synthesizes them to formulate innovative research ideas, blog concepts, or project proposals.
5. **Brain Dump Refiner Agent (Voice Restructurer):** Captures microphone input via browser Web Speech APIs and refines messy transcriptions into formatted markdown notes.
6. **Chat Agent (RAG Conversationalist):** Answers user questions by executing tools (`search_notes`, `clip_url`, `list_tasks`, `list_conflicts`, `list_sprouts`) and summarizes findings with citations.
7. **Action Runner Agent (Webhook Integrator):** Triggers webhook updates, exports notes to markdown, or compiles daily briefing briefing digests.

---

## 🎨 Frontend Design (9 Panels View)

- **Panel 1: Dashboard Overview:** Morning briefing, statistics cards, and canvas growth charts.
- **Panel 2: Notes Library:** Filter and manage notes. Features semantic search toggles and web article clipping.
- **Panel 3: Knowledge Graph:** Interactive canvas simulation rendering notes as glowing nodes linked by semantic similarity.
- **Panel 4: Agent Chat:** Conversational chat interface featuring an collapsible execution log trace panel.
- **Panel 5: Task Board:** Kanban task board (To Do, In Progress, Done) with HTML5 drag-and-drop.
- **Panel 6: Conflict Center:** Resolve contradiction alerts flagged by the Conflict Detector.
- **Panel 7: Concept Sprouts:** Create or grow cross-disciplinary idea sprouts into full notes.
- **Panel 8: Voice Recorder:** Pulsing recording microphone to dictate notes via browser Speech Recognition.
- **Panel 9: Action Runner:** Run custom webhooks or markdown folder exports.

---

## 🛡️ Security Features

- **Bearer Token Auth:** API secret is validated via standard `Authorization` headers for all endpoint routes.
- **Rate Limiting:** Protects endpoints from browser-level denial-of-service attempts by restricting clients to 120 req/min.
- **XSS Sanitization:** Note titles and content are sanitized of HTML tags and script elements.
- **Prompt Injection Defense:** User inputs are wrapped in strict delimiters inside system prompts to enforce safety limits.
- **Isolation:** Environment credentials are kept out of exports, git, and log files.

---

## 🎓 Capstone Key Concepts Mapping

| Key Concept | Status | Where Demonstrated |
|---|---|---|
| **Agent / Multi-agent system** | ✅ | Code — 7 specialized agents with orchestration, tool-use, delegation, and shared state |
| **MCP Server** | ✅ | Code — `mcp_server.js` exposing 6 tools via JSON-RPC stdio protocol |
| **Antigravity** | ✅ | Video — Built & run entirely inside Antigravity using `agy-node` |
| **Security features** | ✅ | Code — API auth, input sanitization, rate limiting, prompt injection guard |
| **Deployability** | ✅ | Video — Zero-dependency, single-command launch, no npm/pip needed |
| **Agent skills** | ✅ | Code — Antigravity skill (`SKILL.md`) for MindSync integration |