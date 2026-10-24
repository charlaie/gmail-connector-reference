import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = new URL("../", import.meta.url);
const filenames = ["chatgpt-gmail.json", "grokbot-gmail.json"];
const catalogs = filenames.map((name) =>
	JSON.parse(readFileSync(new URL(`data/${name}`, root), "utf8")),
);
const expected = [21, 25];

for (const [index, catalog] of catalogs.entries()) {
	assert.equal(catalog.tools.length, expected[index]);
	assert.equal(
		new Set(catalog.tools.map((tool) => tool.name)).size,
		expected[index],
	);
	assert.equal(catalog.captured_on, "2026-10-24");
	for (const tool of catalog.tools) {
		assert(tool.name && tool.description && tool.summary);
		assert.equal(tool.input_schema.type, "object");
		assert(
			tool.behavior.length > 0 && tool.behavior.every((item) => item.text),
		);
		assert(Array.isArray(tool.examples));
		if (catalog.id === "grokbot") {
			assert.equal(tool.input_schema.additionalProperties, false);
			assert.equal(
				tool.response.evidence,
				"inferred-from-supplied-live-samples",
			);
			assert(tool.response.success_schema);
			assert.equal(tool.response.root_label, "result");
			assert(tool.response.successful_probe_count > 0);
			assert(tool.response.variants.length > 0);
			assert(
				tool.response.variants.reduce(
					(sum, variant) => sum + variant.sample_count,
					0,
				) === tool.response.successful_probe_count,
			);
			assert.equal(
				Boolean(tool.response.error_schema),
				tool.response.error_probe_count > 0,
			);
		}
		for (const example of tool.examples) {
			assert(example.title && example.request);
			assert(
				matchesSchema(example.request, tool.input_schema),
				`Example arguments do not match ${catalog.id}/${tool.name}`,
			);
			if (Object.hasOwn(example, "response")) {
				assert(
					matchesSchema(example.response, tool.response.success_schema),
					`Synthetic response does not match ${tool.name}`,
				);
			}
		}
	}
}

const grok = catalogs.find((catalog) => catalog.id === "grokbot");
assert.equal(
	grok.tools.reduce(
		(sum, tool) => sum + tool.response.successful_probe_count,
		0,
	),
	49,
);
assert.equal(
	grok.tools.reduce((sum, tool) => sum + tool.response.error_probe_count, 0),
	2,
);
for (const catalog of catalogs) {
	const stem = `${catalog.id}-gmail`;
	const definitions = JSON.parse(
		readFileSync(new URL(`data/${stem}-tools.json`, root), "utf8"),
	);
	const outputs = JSON.parse(
		readFileSync(new URL(`data/${stem}-outputs.json`, root), "utf8"),
	);
	assert.equal(definitions.tools.length, catalog.tools.length);
	assert.equal(outputs.tools.length, catalog.tools.length);
	for (const [index, tool] of catalog.tools.entries()) {
		assert.deepEqual(definitions.tools[index].inputSchema, tool.input_schema);
		assert.equal(definitions.tools[index].name, tool.runtime_name);
		assert.deepEqual(outputs.tools[index].response, tool.response);
	}
}

function matchesSchema(value, schema) {
	if (
		schema.anyOf &&
		!schema.anyOf.some((variant) => matchesSchema(value, variant))
	)
		return false;
	if (
		schema.oneOf &&
		schema.oneOf.filter((variant) => matchesSchema(value, variant)).length !== 1
	)
		return false;
	if (
		Object.hasOwn(schema, "const") &&
		JSON.stringify(value) !== JSON.stringify(schema.const)
	)
		return false;
	if (
		schema.enum &&
		!schema.enum.some((item) => JSON.stringify(item) === JSON.stringify(value))
	)
		return false;
	const types = {
		object: () =>
			value !== null && typeof value === "object" && !Array.isArray(value),
		array: () => Array.isArray(value),
		string: () => typeof value === "string",
		number: () => typeof value === "number" && Number.isFinite(value),
		integer: () => Number.isInteger(value),
		boolean: () => typeof value === "boolean",
		null: () => value === null,
	};
	if (schema.type && !types[schema.type]?.()) return false;
	if (typeof value === "number") {
		if (schema.minimum != null && value < schema.minimum) return false;
		if (schema.maximum != null && value > schema.maximum) return false;
		if (schema.exclusiveMinimum != null && value <= schema.exclusiveMinimum)
			return false;
	}
	if (typeof value === "string") {
		if (schema.minLength != null && value.length < schema.minLength)
			return false;
		if (schema.maxLength != null && value.length > schema.maxLength)
			return false;
		if (schema.pattern && !new RegExp(schema.pattern).test(value)) return false;
	}
	if (Array.isArray(value)) {
		if (schema.minItems != null && value.length < schema.minItems) return false;
		if (schema.maxItems != null && value.length > schema.maxItems) return false;
		if (
			schema.items &&
			!value.every((item) => matchesSchema(item, schema.items))
		)
			return false;
	}
	if (value !== null && typeof value === "object" && !Array.isArray(value)) {
		if (schema.required?.some((key) => !Object.hasOwn(value, key)))
			return false;
		if (
			schema.additionalProperties === false &&
			Object.keys(value).some(
				(key) => !Object.hasOwn(schema.properties || {}, key),
			)
		)
			return false;
		for (const [key, child] of Object.entries(schema.properties || {})) {
			if (Object.hasOwn(value, key) && !matchesSchema(value[key], child))
				return false;
		}
	}
	return true;
}

function filesAt(directory) {
	return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
		if (
			[".git", "node_modules", "NOINCLUDE", "_site", ".DS_Store"].includes(
				entry.name,
			)
		)
			return [];
		const child = new URL(
			entry.name + (entry.isDirectory() ? "/" : ""),
			directory,
		);
		return entry.isDirectory() ? filesAt(child) : [child];
	});
}

const trackedPrivateFiles = spawnSync("git", ["ls-files", "--", "NOINCLUDE"], {
	cwd: fileURLToPath(root),
	encoding: "utf8",
});
if (trackedPrivateFiles.status === 0) {
	assert.equal(
		trackedPrivateFiles.stdout.trim(),
		"",
		"NOINCLUDE must not contain tracked files.",
	);
}

const files = filesAt(root);
const addresses =
	/[A-Z0-9.!#$%&'*+/=?^_`{|}~-]+@([A-Z0-9-]+(?:\.[A-Z0-9-]+)+)/gi;
const privatePatterns = [
	{ name: "local home path", pattern: /\/(?:Users|home)\/[A-Za-z0-9._-]+\// },
	{ name: "mailbox URL", pattern: /https?:\/\/mail\.google\.com\// },
	{
		name: "profile or signed-file host",
		pattern: /https?:\/\/[A-Za-z0-9.-]*googleusercontent\.com\//,
	},
	{
		name: "file reference from a capture",
		pattern: /sediment:\/\/file_[A-Za-z0-9_]+/,
	},
	{ name: "capture-shaped message ID", pattern: /\b[0-9a-f]{16,}\b/ },
	{ name: "capture-shaped draft ID", pattern: /\br-\d{12,}\b/ },
	{ name: "OAuth access token", pattern: /\bya29\.[A-Za-z0-9_-]+/ },
	{
		name: "private key",
		pattern: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
	},
	{ name: "captured transport signature", pattern: /b=[A-Za-z0-9+/]{40,}/ },
];
for (const file of files) {
	assert(!file.pathname.endsWith(".DS_Store"), "Remove filesystem metadata.");
	assert(
		!/observations|tool-definitions|gmail-research\.html/.test(file.pathname),
		"Private-source filename is not allowed in the public tree.",
	);
	const source = readFileSync(file, "utf8");
	for (const match of source.matchAll(addresses)) {
		assert(
			["example.com", "example.org", "example.net"].includes(
				match[1].toLowerCase(),
			),
			`Non-example email address in ${file.pathname}`,
		);
	}
	for (const rule of privatePatterns) {
		assert(
			!rule.pattern.test(source),
			`${rule.name} detected in ${file.pathname}`,
		);
	}
	if (file.pathname.endsWith(".js") || file.pathname.endsWith(".mjs")) {
		const syntax = spawnSync(
			process.execPath,
			["--check", fileURLToPath(file)],
			{ encoding: "utf8" },
		);
		assert.equal(syntax.status, 0, syntax.stderr);
	}
}
const html = readFileSync(new URL("index.html", root), "utf8");
assert(
	!/<(?:script|link|img)[^>]+(?:src|href)=["']https?:/i.test(html),
	"The viewer must not load remote assets.",
);
assert(
	html.includes("connect-src 'none'"),
	"Keep the viewer disconnected from services.",
);
const buildCheck = spawnSync(
	process.execPath,
	[fileURLToPath(new URL("scripts/build.mjs", root)), "--check"],
	{ encoding: "utf8" },
);
assert.equal(buildCheck.status, 0, buildCheck.stderr);
console.log(buildCheck.stdout.trim());
console.log(
	"Checked 46 tools, synthetic examples, public-file privacy patterns, script syntax, and offline assets.",
);
