# Strata: A Living Knowledge Base PoC

Strata is a proof-of-concept project that transforms product documentation into a living, conversational knowledge base.
It does this by establishing a "persistency layer" managed by an AI agent.

## The Persistency Layer

The core of this project is the **persistency layer**, which is the `ai/` directory. This folder is the single source of
truth for all product knowledge, including:

- Functional requirements
- Technical architecture
- AI agent behavior and identity

This approach replaces static documentation with a dynamic, version-controlled knowledge base that evolves alongside the
codebase.

For a detailed breakdown of the directory structure, see the [Directory Map in `AGENTS.md`](AGENTS.md#directory-map).
The rules governing this layer are defined in [
`ai/functional/requirements/persistency-layer.mdc`](ai/functional/requirements/persistency-layer.mdc).

## The Strata Agent

The project features an AI assistant named Strata, which is responsible for managing the persistency layer. Developers
and other stakeholders interact with the agent to query, update, and maintain the knowledge base.

- **To learn more about the agent, read `AGENTS.md`**.
- **To understand how to interact with the agent, see `GEMINI.md`**.

## Getting Started

To get the project up and running, follow these steps:

1. Install dependencies:

   ```bash
   npm install
   ```

2. Copy the example environment file:

   ```bash
   cp .env.example .env
   ```

3. Add your API keys and PostgreSQL connection string to the `.env` file.

4. Migrate the database schema:

   ```bash
   npm run db:migrate
   ```

5. Start the development server:
   ```bash
   npm run dev
   ```

To interact with the Strata agent, use the `ai-start.sh` script:

```bash
./ai/ai-start.sh
```

Your project should now be running on [http://localhost:3000](http://localhost:3000).