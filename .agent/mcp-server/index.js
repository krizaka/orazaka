import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

if (process.argv.length <= 2) {
    const monorepoRoot = path.resolve(__dirname, '../../');
    process.argv.push(monorepoRoot);
}

try {
    // The package is a CLI binary (no "main"/"exports"), so we import its dist entry directly.
    await import('@modelcontextprotocol/server-filesystem/dist/index.js');
} catch (error) {
    console.error("❌ MCP Server boot failure:", error);
    process.exit(1);
}
