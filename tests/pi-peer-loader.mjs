import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));

function createMappings() {
	const explicitRoot = process.env.PI_CODING_AGENT_PACKAGE_ROOT;
	if (explicitRoot && explicitRoot.length > 0) return packageRootMappings(explicitRoot);
	const local = localPeerMappings();
	return local ?? packageRootMappings(globalPiCodingAgentRoot());
}

function localPeerMappings() {
	const mappings = new Map([
		["@earendil-works/pi-coding-agent", join(repoRoot, "node_modules/@earendil-works/pi-coding-agent/dist/index.js")],
		["@earendil-works/pi-ai", join(repoRoot, "node_modules/@earendil-works/pi-ai/dist/index.js")],
		["@earendil-works/pi-tui", join(repoRoot, "node_modules/@earendil-works/pi-tui/dist/index.js")],
		["typebox", join(repoRoot, "node_modules/typebox/build/index.mjs")],
		["typebox/compile", join(repoRoot, "node_modules/typebox/build/compile/index.mjs")],
	]);
	return [...mappings.values()].every((path) => existsSync(path)) ? mappings : undefined;
}

function packageRootMappings(packageRoot) {
	return new Map([
		["@earendil-works/pi-coding-agent", `${packageRoot}/dist/index.js`],
		["@earendil-works/pi-ai", `${packageRoot}/node_modules/@earendil-works/pi-ai/dist/index.js`],
		["@earendil-works/pi-tui", `${packageRoot}/node_modules/@earendil-works/pi-tui/dist/index.js`],
		["typebox", `${packageRoot}/node_modules/typebox/build/index.mjs`],
		["typebox/compile", `${packageRoot}/node_modules/typebox/build/compile/index.mjs`],
	]);
}

function globalPiCodingAgentRoot() {
	const globalNodeModules = execFileSync("npm", ["--silent", "root", "-g"], { encoding: "utf8" }).trim();
	return join(globalNodeModules, "@earendil-works/pi-coding-agent");
}

const MAPPINGS = createMappings();

export async function resolve(specifier, context, nextResolve) {
	const mapped = MAPPINGS.get(specifier);
	if (mapped) return { url: pathToFileURL(mapped).href, shortCircuit: true };
	return nextResolve(specifier, context);
}
