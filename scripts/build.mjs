import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = new URL("../", import.meta.url);
const names = ["chatgpt-gmail.json", "grokbot-gmail.json"];
const catalogs = names.map((name) =>
	JSON.parse(readFileSync(new URL(`data/${name}`, root), "utf8")),
);
const artifacts = new Map();

for (const catalog of catalogs) {
	const stem = `${catalog.id}-gmail`;
	const definitions = {
		format: "gmail-connector-tool-definitions/v1",
		id: catalog.id,
		title: catalog.title,
		captured_on: catalog.captured_on,
		namespace: catalog.namespace,
		provenance: {
			input_evidence: catalog.provenance.input_schema,
			note: "Tool definitions exposed by each product. ChatGPT input schemas come from TypeScript declarations. Grok input schemas come from captured JSON Schema. This export is not an original tools/list response.",
		},
		tools: catalog.tools.map((tool) => ({
			name: tool.runtime_name,
			description: tool.description,
			inputSchema: tool.input_schema,
		})),
	};
	const outputs = {
		format: "gmail-connector-response-schemas/v1",
		id: catalog.id,
		title: catalog.title,
		captured_on: catalog.provenance.response_capture_on || catalog.captured_on,
		evidence: catalog.provenance.response_schema,
		note: "Response schemas inferred from samples. They do not specify required fields or establish a complete MCP outputSchema. Observed variants and unknown types are preserved. Captured account values are excluded.",
		tools: catalog.tools.map((tool) => ({
			name: tool.name,
			runtime_name: tool.runtime_name,
			response: tool.response,
		})),
	};
	artifacts.set(
		`data/${stem}-tools.json`,
		`${JSON.stringify(definitions, null, "\t")}\n`,
	);
	artifacts.set(
		`data/${stem}-outputs.json`,
		`${JSON.stringify(outputs, null, "\t")}\n`,
	);
}

const data = {
	format: "gmail-connector-reference/v1",
	captured_on: "2026-10-24",
	updated_on: catalogs
		.map((catalog) => catalog.updated_on || catalog.captured_on)
		.sort()
		.at(-1),
	catalogs,
};
const serialized = JSON.stringify(data)
	.replaceAll("<", "\\u003c")
	.replaceAll("\u2028", "\\u2028")
	.replaceAll("\u2029", "\\u2029");
artifacts.set(
	"assets/catalog.js",
	`// Generated from public data/ catalogs. Run node scripts/build.mjs to refresh.\nglobalThis.GMAIL_REFERENCE = ${serialized};\n`,
);

for (const [filename, contents] of artifacts) {
	const target = new URL(filename, root);
	if (process.argv.includes("--check")) {
		if (readFileSync(target, "utf8") !== contents)
			throw new Error(`${filename} is stale. Run node scripts/build.mjs.`);
	} else {
		writeFileSync(target, contents);
	}
}
console.log(
	process.argv.includes("--check")
		? "The viewer, tool-definition downloads, and response-schema downloads match the public catalogs."
		: `Built ${artifacts.size} public artifacts under ${fileURLToPath(root)}.`,
);
