import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { SOURCE_FILE_BUDGET } from "./package-policy.ts";

const roots = SOURCE_FILE_BUDGET.rootDirectories.map((directory) => join(process.cwd(), directory));

async function collectTypeScriptFiles(dir: string): Promise<string[]> {
	const entries = await readdir(dir, { withFileTypes: true });
	const files: string[] = [];
	for (const entry of entries) {
		const path = join(dir, entry.name);
		if (entry.isDirectory()) files.push(...await collectTypeScriptFiles(path));
		else if (entry.isFile() && path.endsWith(".ts")) files.push(path);
	}
	return files;
}

const files = (await Promise.all(roots.map(collectTypeScriptFiles))).flat();
const failures: string[] = [];
for (const file of files) {
	const content = await readFile(file);
	const lines = content.toString("utf8").split("\n").length;
	if (lines > SOURCE_FILE_BUDGET.maxLines || content.length > SOURCE_FILE_BUDGET.maxBytes) failures.push(`${file}: ${lines} lines, ${content.length} bytes`);
}
assert.equal(failures.length, 0, `Source files exceed ${SOURCE_FILE_BUDGET.maxLines} lines or ${SOURCE_FILE_BUDGET.maxBytes} bytes:\n${failures.join("\n")}`);
