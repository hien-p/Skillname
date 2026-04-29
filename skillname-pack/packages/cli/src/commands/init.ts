/**
 * skill init <name>
 *
 * Scaffolds a new skill bundle directory with a manifest.json template.
 *
 * Creates:
 *   <name>/
 *   ├── manifest.json
 *   ├── tools/
 *   ├── prompts/
 *   └── examples/
 */

import { writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";

export async function init(name: string): Promise<void> {
  // Validate name
  if (!/^[a-z0-9-]+$/.test(name)) {
    console.error(
      `Invalid name "${name}". Use lowercase letters, numbers, and hyphens only.`,
    );
    process.exit(1);
  }

  const dir = name;
  if (existsSync(dir)) {
    console.error(`Directory "${dir}" already exists.`);
    process.exit(1);
  }

  console.log(`→ Creating skill bundle: ${name}/`);

  // Create directories
  mkdirSync(join(dir, "tools"), { recursive: true });
  mkdirSync(join(dir, "prompts"), { recursive: true });
  mkdirSync(join(dir, "examples"), { recursive: true });

  // Create manifest.json
  const manifest = {
    $schema: "https://manifest.eth/schemas/skill-v1.json",
    name,
    ensName: `${name}.eth`,
    version: "1.0.0",
    description: "",
    author: "0x0000000000000000000000000000000000000000",
    createdAt: new Date().toISOString(),
    license: "MIT",
    tools: [
      {
        name: "my_tool",
        description: "Describe what this tool does",
        inputSchema: {
          type: "object",
          properties: {
            input: {
              type: "string",
              description: "Describe the input",
            },
          },
          required: ["input"],
        },
        execution: {
          type: "http",
          endpoint: "https://api.example.com/v1/action",
          method: "POST",
        },
      },
    ],
    trust: {
      ensip25: { enabled: false },
    },
  };

  writeFileSync(
    join(dir, "manifest.json"),
    JSON.stringify(manifest, null, 2) + "\n",
  );

  console.log(`  ✓ ${dir}/manifest.json`);
  console.log(`  ✓ ${dir}/tools/`);
  console.log(`  ✓ ${dir}/prompts/`);
  console.log(`  ✓ ${dir}/examples/`);
  console.log();
  console.log(`Next steps:`);
  console.log(
    `  1. Edit ${dir}/manifest.json — set ensName, description, tool config`,
  );
  console.log(`  2. skill verify ${name}.eth  — validate against schema`);
  console.log(
    `  3. skill publish ${dir}/ ${name}.eth  — pin to IPFS + set ENS records`,
  );
  console.log();
}
