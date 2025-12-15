# Gemini CLI Usage

This document outlines how the Gemini CLI is used in the Strata project to interact with the persistency layer.

## Overview

The Gemini CLI is the primary tool for developers to interact with the Strata AI agent. It provides a command-line
interface to start new sessions, feed context to the agent, and receive responses.

## `ai-start.sh`

The [`ai/ai-start.sh`](ai/ai-start.sh) script is a simple wrapper that streamlines the process of starting a new Gemini
session with the correct context.

### Behavior

1. **Locates Bootstrap Context**: The script finds the [`ai/ai-bootstrap.mdc`](ai/ai-bootstrap.mdc) file.
2. **Reads Content**: It reads the entire content of the bootstrap file.
3. **Executes Gemini**: It runs the `gemini` command, passing the bootstrap content as the initial prompt using the `-p`
   flag.

This ensures that every session starts with the foundational knowledge defined in the persistency layer.

### Example Usage

To start a new session with the Strata agent, run:

```bash
./ai/ai-start.sh
```

For more details on the agent's behavior and identity, see [`AGENTS.md`](AGENTS.md).
