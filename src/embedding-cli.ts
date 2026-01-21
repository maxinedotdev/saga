#!/usr/bin/env node

import 'dotenv/config';
import process from 'node:process';
import { createLazyEmbeddingProvider } from './embedding-provider.js';

type CliOptions = {
    text: string;
    json: boolean;
};

function printUsage(): void {
    console.log(`Usage: mcp-documentation-embeddings [options]

Options:
  --provider <transformers|openai>   Embedding provider (env: MCP_EMBEDDING_PROVIDER)
  --base-url <url>                   OpenAI-compatible base URL (env: MCP_EMBEDDING_BASE_URL)
  --model <id>                       Embedding model ID (env: MCP_EMBEDDING_MODEL)
  --api-key <key>                    OpenAI-compatible API key (env: MCP_EMBEDDING_API_KEY)
  --text <text>                      Text to embed (default: "Embedding provider smoke test.")
  --json                             Output JSON
  --help                             Show this help message
`);
}

function requireValue(args: string[], index: number, flag: string): string {
    const value = args[index + 1];
    if (!value || value.startsWith('--')) {
        throw new Error(`Missing value for ${flag}`);
    }
    return value;
}

function applyArgs(args: string[]): CliOptions {
    const options: CliOptions = {
        text: 'Embedding provider smoke test.',
        json: false,
    };

    for (let i = 0; i < args.length; i += 1) {
        const arg = args[i];
        if (arg === '--help') {
            printUsage();
            process.exit(0);
        }

        if (arg === '--json') {
            options.json = true;
            continue;
        }

        if (arg === '--provider') {
            process.env.MCP_EMBEDDING_PROVIDER = requireValue(args, i, arg);
            i += 1;
            continue;
        }

        if (arg === '--base-url') {
            process.env.MCP_EMBEDDING_BASE_URL = requireValue(args, i, arg);
            i += 1;
            continue;
        }

        if (arg === '--model') {
            process.env.MCP_EMBEDDING_MODEL = requireValue(args, i, arg);
            i += 1;
            continue;
        }

        if (arg === '--api-key') {
            process.env.MCP_EMBEDDING_API_KEY = requireValue(args, i, arg);
            i += 1;
            continue;
        }

        if (arg === '--text') {
            options.text = requireValue(args, i, arg);
            i += 1;
            continue;
        }

        throw new Error(`Unknown argument: ${arg}`);
    }

    return options;
}

async function main(): Promise<void> {
    try {
        const options = applyArgs(process.argv.slice(2));
        const modelName = process.env.MCP_EMBEDDING_MODEL;
        const provider = createLazyEmbeddingProvider(modelName);
        const embedding = await provider.generateEmbedding(options.text);

        const output = {
            provider: process.env.MCP_EMBEDDING_PROVIDER || 'transformers',
            model: provider.getModelName(),
            dimensions: embedding.length,
            sample: embedding.slice(0, 8),
        };

        if (options.json) {
            console.log(JSON.stringify(output, null, 2));
        } else {
            console.log('Embedding provider:', output.provider);
            console.log('Model:', output.model);
            console.log('Dimensions:', output.dimensions);
            console.log('Sample:', output.sample.join(', '));
        }
    } catch (error) {
        console.error(error instanceof Error ? error.message : String(error));
        process.exitCode = 1;
    }
}

await main();
