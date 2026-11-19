#!/usr/bin/env node
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createServer } from './create.ts';

// Standard output carries the protocol, so nothing else may be written to it.
await createServer().connect(new StdioServerTransport());
