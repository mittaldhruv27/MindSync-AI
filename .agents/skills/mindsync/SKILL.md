---
name: MindSync AI
description: Manage notes, tasks, search semantically, and connect thoughts in your local-first agentic second brain.
---

# MindSync AI Customization Skill

MindSync AI is a zero-dependency, local-first Agentic Second Brain. It runs a local Node.js backend server (`server.js`) on port 3000 and exposes a JSON-RPC stdio Model Context Protocol (MCP) server.

## Launching MindSync AI

To start the server, open a terminal in the project directory and run:
```bash
node server.js
```
The client UI will be available at `http://localhost:3000`.

## Integrating the MCP Server

You can register the MindSync MCP server in your Antigravity client to search, add notes, and retrieve tasks from any Antigravity chat.

Add the following configuration to your `mcp_config.json` (located in the global config directory at `~/.gemini/config/config.json` or `mcp_config.json` depending on configuration):

```json
{
  "mcpServers": {
    "mindsync": {
      "command": "node",
      "args": ["/Users/krishverma/Desktop/MindSync-AI/mcp_server.js"],
      "env": {
        "PORT": "3000",
        "API_SECRET": "mindsync_secret_passphrase_2026"
      }
    }
  }
}
```

## Available MCP Tools

Once registered, you can invoke the following tools:
1. `mindsync_search(query: string)`: Run semantic search query on notes.
2. `mindsync_add_note(title: string, content: string)`: Add a note (triggers Ingestion Agent).
3. `mindsync_clip_url(url: string)`: Clips and parses web article text.
4. `mindsync_list_tasks()`: List extracted to-do task status.
5. `mindsync_list_conflicts()`: View contradictions detected.
6. `mindsync_list_sprouts()`: List generated concept sprouts.

## Standard Prompts for AGY Agents

- "Using the mindsync tools, search my notes for any references to local app security."
- "Clip the URL https://en.wikipedia.org/wiki/Second_Brain into my second brain."
- "Show me what tasks are open on my MindSync task board."
