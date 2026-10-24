(() => {
	const dataset = globalThis.GMAIL_REFERENCE;
	const $ = (id) => document.getElementById(id);
	if (!dataset?.catalogs?.length) {
		$("content").textContent =
			"The catalog failed to load. Keep assets/ and data/ beside index.html.";
		return;
	}

	const formatDate = (date, month = "long") =>
		new Intl.DateTimeFormat("en-GB", {
			day: "numeric",
			month,
			year: "numeric",
			timeZone: "UTC",
		}).format(new Date(`${date}T00:00:00Z`));
	$("updated-date").textContent =
		`Last updated ${formatDate(dataset.updated_on, "short")}`;

	const providers = new Map(
		dataset.catalogs.map((catalog) => [catalog.id, catalog]),
	);
	const toolMaps = new Map(
		dataset.catalogs.map((catalog) => [
			catalog.id,
			new Map(catalog.tools.map((tool) => [tool.name, tool])),
		]),
	);
	const groups = new Map([
		["read", "Read and search"],
		["drafts", "Drafts"],
		["send", "Sending"],
		["organize", "Organization"],
		["account", "Account"],
	]);
	const tabNames = new Map([
		["behavior", "Behavior"],
		["inputs", "Inputs"],
		["responses", "Responses"],
		["examples", "Examples"],
	]);
	const counterpartNames = {
		chatgpt: {
			get_profile: "get_me",
			read_email_thread: "get_thread",
			forward_emails: "forward",
			batch_modify_email: "update_email_labels",
			delete_emails: "trash_email",
		},
		grokbot: {
			get_me: "get_profile",
			get_thread: "read_email_thread",
			forward: "forward_emails",
			update_email_labels: "batch_modify_email",
			trash_email: "delete_emails",
		},
	};

	function element(tag, attributes, ...children) {
		const node = document.createElement(tag);
		for (const [key, value] of Object.entries(attributes || {})) {
			if (key === "class") node.className = value;
			else if (key.startsWith("on")) node.addEventListener(key.slice(2), value);
			else if (value !== false && value != null)
				node.setAttribute(key, value === true ? "" : String(value));
		}
		for (const child of children.flat(Infinity)) {
			if (child != null && child !== false)
				node.append(
					child instanceof Node
						? child
						: document.createTextNode(String(child)),
				);
		}
		return node;
	}

	const text = (tag, value, className) =>
		element(tag, className ? { class: className } : {}, value);
	const link = (label, href, className) =>
		element("a", { href, class: className || "" }, label);
	const badge = (label, className) =>
		element("span", { class: `badge ${className || ""}` }, label);
	const button = (label, action, className) =>
		element(
			"button",
			{ type: "button", class: className || "button", onclick: action },
			label,
		);
	const json = (value) => JSON.stringify(value, null, 2);
	const toolUrl = (provider, tool, tab = "behavior") =>
		`#tool/${provider}/${tool}/${tab}`;
	const section = (heading, ...children) =>
		element(
			"section",
			{ class: "section" },
			element("div", { class: "section-heading" }, text("h2", heading)),
			children,
		);
	let noticeTimer;

	function notify(message) {
		$("notice").className = "copy-feedback";
		$("notice").textContent = message;
		$("notice").hidden = false;
		clearTimeout(noticeTimer);
		noticeTimer = setTimeout(() => {
			$("notice").hidden = true;
		}, 2500);
	}

	async function copy(value) {
		try {
			if (!navigator.clipboard) throw new Error("Clipboard unavailable");
			await navigator.clipboard.writeText(value);
			notify("Copied");
		} catch {
			const previousFocus = document.activeElement;
			const area = element("textarea", { "aria-label": "Copy buffer" }, value);
			area.style.position = "fixed";
			area.style.left = "-9999px";
			document.body.append(area);
			area.select();
			const copied = document.execCommand("copy");
			area.remove();
			previousFocus?.focus();
			notify(
				copied ? "Copied" : "Select the JSON and copy with your keyboard.",
			);
		}
	}

	function download(value, filename) {
		const url = URL.createObjectURL(
			new Blob([`${json(value)}\n`], {
				type: "application/json;charset=utf-8",
			}),
		);
		const anchor = element("a", { href: url, download: filename });
		document.body.append(anchor);
		anchor.click();
		anchor.remove();
		setTimeout(() => URL.revokeObjectURL(url), 1000);
	}

	function codeBlock(value, label) {
		const source = typeof value === "string" ? value : json(value);
		const box = element("div", { class: "code-box" });
		const expand = button("Expand", () => {
			const expanded = box.classList.toggle("expanded");
			expand.textContent = expanded ? "Collapse" : "Expand";
			expand.setAttribute("aria-expanded", String(expanded));
		});
		expand.setAttribute("aria-expanded", "false");
		box.append(
			element(
				"div",
				{ class: "code-toolbar" },
				text("span", label),
				element(
					"div",
					{ class: "code-actions" },
					expand,
					button("Copy", () => copy(source)),
				),
			),
			element(
				"pre",
				{ tabindex: "0", "aria-label": label },
				text("code", source),
			),
		);
		return box;
	}

	function schemaType(schema) {
		if (schema.anyOf) return schema.anyOf.map(schemaType).join(" | ");
		if (schema.oneOf) return schema.oneOf.map(schemaType).join(" | ");
		if (Object.hasOwn(schema, "const")) return json(schema.const);
		if (schema.enum) return schema.enum.map(json).join(" | ");
		if (schema.type === "array") {
			const type = schemaType(schema.items || {});
			return `${type.includes(" | ") ? `(${type})` : type}[]`;
		}
		return schema.type || "unknown";
	}

	function constraints(schema) {
		const names = {
			minimum: "minimum",
			maximum: "maximum",
			exclusiveMinimum: "greater than",
			minLength: "min length",
			maxLength: "max length",
			minItems: "min items",
			maxItems: "max items",
		};
		const values = Object.entries(names)
			.filter(([key]) => Object.hasOwn(schema, key))
			.map(([key, label]) => `${label}: ${schema[key]}`);
		if (Object.hasOwn(schema, "default"))
			values.push(`default: ${json(schema.default)}`);
		if (schema.pattern) values.push(`pattern: ${schema.pattern}`);
		return values.join("; ");
	}

	function schemaTree(schema, key, depth = 0) {
		const entries = schema.properties
			? Object.entries(schema.properties)
			: schema.type === "array"
				? [["items", schema.items || {}]]
				: (schema.anyOf || schema.oneOf || []).map((variant, index) => [
						`variant ${index + 1}`,
						variant,
					]);
		const label = element(
			"span",
			{},
			text("span", key, "schema-key"),
			text("span", schemaType(schema), "schema-type"),
		);
		const note = [schema.description, constraints(schema)]
			.filter(Boolean)
			.join(" ");
		const description = note ? text("p", note, "schema-description") : null;
		if (!entries.length)
			return element("div", { class: "schema-leaf" }, label, description);
		return element(
			"details",
			{ class: "schema-node", open: depth < 1 },
			element("summary", {}, label),
			description,
			element(
				"div",
				{ class: "schema-tree" },
				entries.map(([name, item]) => schemaTree(item, name, depth + 1)),
			),
		);
	}

	function readRoute() {
		const parts = location.hash.slice(1).split("/");
		if (!parts[0] || parts[0] === "overview" || parts[0] === "content")
			return { kind: "overview", provider: "chatgpt" };
		if (parts[0] === "methodology")
			return { kind: "overview", provider: "chatgpt" };
		if (parts[0] === "provider" && providers.has(parts[1]))
			return { kind: "provider", provider: parts[1] };
		if (parts[0] === "tool" && toolMaps.get(parts[1])?.has(parts[2])) {
			return {
				kind: "tool",
				provider: parts[1],
				tool: parts[2],
				tab: tabNames.has(parts[3]) ? parts[3] : "behavior",
			};
		}
		return { kind: "not-found", provider: "chatgpt" };
	}

	function renderNavigation(route) {
		$("provider").value = route.provider;
		for (const item of document.querySelectorAll(".main-nav a")) {
			if (item.dataset.page === route.kind)
				item.setAttribute("aria-current", "page");
			else item.removeAttribute("aria-current");
		}
		const catalog = providers.get(route.provider);
		const blocks = [];
		for (const [category, label] of groups) {
			const matching = catalog.tools.filter(
				(tool) => tool.category === category,
			);
			if (!matching.length) continue;
			blocks.push(
				element(
					"div",
					{ class: "tool-group" },
					text("div", label, "group-label"),
					matching.map((tool) =>
						element(
							"a",
							{
								class: "tool-link",
								href: toolUrl(catalog.id, tool.name),
								"aria-current":
									route.kind === "tool" && route.tool === tool.name
										? "page"
										: false,
							},
							tool.name,
						),
					),
				),
			);
		}
		$("tools").replaceChildren(...blocks);
	}

	function breadcrumb(catalog, current) {
		return element(
			"div",
			{ class: "breadcrumb" },
			link("Overview", "#overview"),
			text("span", "/", "small"),
			link(catalog.title, `#provider/${catalog.id}`),
			current ? text("span", "/", "small") : null,
			current ? text("span", current) : null,
		);
	}

	function evidenceBadge(catalog) {
		if (catalog.provenance.response_schema === "not-observed")
			return badge("Schema capture");
		return badge(
			catalog.id === "chatgpt" ? "Live tests" : "Supplied live samples",
			"observed",
		);
	}

	function fileDownload(label, filename) {
		return element(
			"a",
			{ class: "button", href: `data/${filename}`, download: filename },
			label,
		);
	}

	function downloadActions(catalog, includeBrowse = true) {
		const stem = `${catalog.id}-gmail`;
		return element(
			"div",
			{ class: "actions" },
			includeBrowse
				? link(
						`Browse ${catalog.tools.length} tools`,
						`#provider/${catalog.id}`,
						"button primary",
					)
				: null,
			button("Full catalog JSON", () => download(catalog, `${stem}.json`)),
			fileDownload("Tool definitions JSON", `${stem}-tools.json`),
			fileDownload("Response schemas JSON", `${stem}-outputs.json`),
		);
	}

	function overviewView() {
		const node = document.createDocumentFragment();
		node.append(
			element(
				"aside",
				{
					class: "disclaimer",
					"aria-label": "Unofficial reference disclaimer",
				},
				text("h2", "Unofficial. For reference only."),
				text(
					"p",
					"This documentation may contain errors, omissions, or outdated behavior. Verify schemas and tool behavior before use.",
				),
			),
			element(
				"div",
				{ class: "meta" },
				badge(`Last updated ${formatDate(dataset.updated_on)}`),
			),
			text("h1", "Gmail connector schemas and behavior"),
			text(
				"p",
				"Tool definitions from ChatGPT Gmail Plugin and Grok Bot / Cursor Gmail Connector.",
				"lead",
			),
		);
		const rows = [
			["Tools", "21", "25"],
			[
				"Input schemas",
				"Reconstructed from TypeScript declarations",
				"Captured JSON Schema",
			],
			[
				"Response shapes",
				"Inferred from controlled live samples",
				"Inferred from supplied live samples",
			],
			[
				"Composition",
				"Nested MIME payload",
				"Flat body, htmlBody, and attachments",
			],
			["Reading", "MIME trees, four formats", "Flat messages, five formats"],
			[
				"Draft updates",
				"A header-only patch preserved attachments",
				"An update reported droppedAttachments",
			],
			[
				"Attachments",
				"read_attachment returns files and extracted content",
				"The host downloads attachments",
			],
			["Evidence", "42 live calls", "51 Gmail calls and one host download"],
		];
		node.append(
			element(
				"div",
				{ class: "comparison-wrap" },
				element(
					"table",
					{ class: "comparison" },
					element(
						"thead",
						{},
						element(
							"tr",
							{},
							element("th", { scope: "col" }, "Comparison"),
							element("th", { scope: "col" }, "ChatGPT Gmail Plugin"),
							element(
								"th",
								{ scope: "col" },
								"Grok Bot / Cursor Gmail Connector",
							),
						),
					),
					element(
						"tbody",
						{},
						rows.map(([feature, chatgpt, grokbot]) =>
							element(
								"tr",
								{},
								element("th", { scope: "row" }, feature),
								text("td", chatgpt),
								text("td", grokbot),
							),
						),
					),
				),
			),
			section(
				"Catalogs",
				element(
					"div",
					{ class: "evidence-list" },
					dataset.catalogs.map((catalog) =>
						element(
							"div",
							{ class: "evidence-block" },
							text("h3", catalog.title),
							text("p", catalog.provenance.evidence),
							downloadActions(catalog),
						),
					),
				),
			),
			section(
				"Evidence labels",
				element(
					"div",
					{ class: "table-wrap" },
					element(
						"table",
						{},
						element(
							"thead",
							{},
							element(
								"tr",
								{},
								element("th", { scope: "col" }, "Label"),
								element("th", { scope: "col" }, "Meaning"),
							),
						),
						element(
							"tbody",
							{},
							[
								[
									"Observed",
									"The behavior occurred in a live test or the supplied capture.",
								],
								[
									"Declared",
									"The captured tool description states the behavior.",
								],
								[
									"Inferred response",
									"Samples establish the recorded shape. Other fields or variants may exist.",
								],
								[
									"Synthetic example",
									"The example uses placeholder values and was not executed.",
								],
							].map(([label, meaning]) =>
								element(
									"tr",
									{},
									element("th", { scope: "row" }, label),
									text("td", meaning),
								),
							),
						),
					),
				),
			),
			section(
				"Limitations",
				element(
					"div",
					{ class: "limitations" },
					text("h3", "Dated, product-specific captures"),
					text(
						"p",
						"The tools were captured on 24 October 2026. A later site update does not mean the tools were tested again. Future updates are not guaranteed. MCP defines tool discovery and calls. Each server defines its own catalog. Server endpoints, publishers, and maintainers remain unverified. These catalogs are not Google's official Gmail MCP specification.",
					),
					text("h3", "Schema sources"),
					text(
						"p",
						"ChatGPT input schemas come from exposed TypeScript declarations. Original tools/list schemas, output schemas, annotations, and server code were unavailable. Grok input schemas come from user-Gmail dynamic-tool discovery and retain their draft-07 constraints. Descriptions may state rules that the schemas do not enforce.",
					),
					text("h3", "Incomplete response contracts"),
					text(
						"p",
						"Response schemas come from samples. They do not establish a complete output contract or required fields. Empty arrays leave item types unknown. Null-only fields leave non-null types unknown. Observed formats and target types have separate variants. An empty collection does not establish the populated result shape.",
					),
					text("h3", "Limited test coverage"),
					text(
						"p",
						"ChatGPT tests covered selected arguments on one account. They did not cover large batches, rate limits, authentication failures, or every argument combination. Grok results come from a supplied 52-call log. This export uses that log without rerunning the calls.",
					),
					text("h3", "Edited public data"),
					text(
						"p",
						"The export excludes private transcripts, profiles, mailbox contents, live addresses and IDs, mailbox links, tokens, local paths, and attachment bytes. Example addresses and one label use placeholders. Captured tool and field descriptions otherwise keep their wording. Summaries and behavior notes use edited wording. Schema constraints are unchanged.",
					),
					text("h3", "Using the downloads"),
					text(
						"p",
						"Each download contains a catalog. Its input and response schema properties are JSON Schema fragments. The catalog itself is not a validating schema. The viewer and downloads use the same public data. The static viewer makes no connector calls and loads no external assets.",
					),
				),
				element(
					"div",
					{ class: "actions" },
					link("Repository guide", "README.md", "button"),
				),
			),
		);
		return node;
	}

	function toolRow(catalog, tool, includeProvider = false) {
		return element(
			"a",
			{ class: "catalog-row", href: toolUrl(catalog.id, tool.name) },
			element(
				"div",
				{},
				text("code", tool.name),
				includeProvider ? text("div", catalog.title, "small") : null,
			),
			text("p", tool.summary),
			tool.behavior.some((finding) => finding.evidence === "observed")
				? badge("Observed", "observed")
				: badge("Declared"),
		);
	}

	function providerView(route) {
		const catalog = providers.get(route.provider);
		return element(
			"div",
			{},
			breadcrumb(catalog),
			element(
				"div",
				{ class: "meta" },
				evidenceBadge(catalog),
				badge(`${catalog.tools.length} tools`),
			),
			text("h1", catalog.title),
			text("p", catalog.summary, "lead"),
			downloadActions(catalog, false),
			section(
				"Tool catalog",
				catalog.tools.map((tool) => toolRow(catalog, tool)),
			),
		);
	}

	function behaviorView(catalog, tool) {
		const node = document.createDocumentFragment();
		node.append(
			...tool.behavior.map((finding) =>
				element(
					"div",
					{ class: "behavior" },
					badge(
						finding.evidence === "observed"
							? finding.source === "supplied-live-capture"
								? "Observed in supplied capture"
								: "Observed in a live test"
							: "Declared in the description",
						finding.evidence === "observed" ? "observed" : "",
					),
					text("p", finding.text),
				),
			),
			section("Test coverage", text("p", catalog.provenance.evidence, "small")),
		);
		const otherProvider = catalog.id === "chatgpt" ? "grokbot" : "chatgpt";
		const otherName = toolMaps.get(otherProvider).has(tool.name)
			? tool.name
			: counterpartNames[catalog.id][tool.name];
		if (otherName)
			node.append(
				section(
					"Related tool",
					element(
						"p",
						{ class: "small" },
						"See ",
						link(otherName, toolUrl(otherProvider, otherName)),
						" in ",
						providers.get(otherProvider).title,
						". Its behavior and field names may differ.",
					),
				),
			);
		return node;
	}

	function inputsView(catalog, tool) {
		const node = document.createDocumentFragment();
		const properties = Object.entries(tool.input_schema.properties || {});
		const required = new Set(tool.input_schema.required || []);
		node.append(
			element(
				"div",
				{ class: "summary-note" },
				catalog.id === "chatgpt"
					? "Reconstructed from exposed TypeScript declarations. Hidden bounds and runtime rules remain unknown."
					: "Captured JSON Schema with placeholder example addresses and labels. Constraints, enums, required fields, and additionalProperties are unchanged. Descriptions may state rules that the schema does not enforce.",
			),
		);
		if (!properties.length) {
			node.append(
				section(
					"Arguments",
					element(
						"div",
						{ class: "empty" },
						tool.input_schema.additionalProperties === false
							? "This tool takes no arguments and rejects additional properties."
							: "The signature accepts a dictionary of unknown values and names no arguments.",
					),
				),
			);
		} else {
			node.append(
				element(
					"div",
					{ class: "table-wrap" },
					element(
						"table",
						{},
						element(
							"thead",
							{},
							element(
								"tr",
								{},
								element("th", { scope: "col" }, "Argument"),
								element("th", { scope: "col" }, "Presence"),
								element("th", { scope: "col" }, "Description"),
							),
						),
						element(
							"tbody",
							{},
							properties.map(([name, schema]) =>
								element(
									"tr",
									{},
									element(
										"td",
										{},
										text("span", name, "field-name"),
										text("span", schemaType(schema), "field-type"),
									),
									text(
										"td",
										required.has(name) ? "Required" : "Optional",
										"presence",
									),
									element(
										"td",
										{},
										text(
											"span",
											schema.description || "No captured description.",
											"field-description",
										),
										constraints(schema)
											? text("span", constraints(schema), "field-constraint")
											: null,
									),
								),
							),
						),
					),
				),
			);
		}
		node.append(
			element(
				"details",
				{ class: "response-variant" },
				element("summary", {}, "Captured tool description"),
				text("p", tool.description),
			),
			section("Nested structure", schemaTree(tool.input_schema, "arguments")),
			section("JSON Schema", codeBlock(tool.input_schema, "Input schema")),
		);
		return node;
	}

	function responsesView(_catalog, tool) {
		if (tool.response.evidence === "not-observed") {
			return element(
				"div",
				{ class: "empty" },
				text("h3", "No response sample."),
				text(
					"p",
					"The tool description states the return behavior. No test establishes the output shape.",
					"lead",
				),
			);
		}
		const node = document.createDocumentFragment();
		const rootLabel = tool.response.root_label || "structuredContent";
		node.append(
			element(
				"div",
				{ class: "summary-note" },
				text("p", tool.response.envelope),
				text("p", tool.response.caveat),
			),
			text(
				"p",
				`${tool.response.successful_probe_count} successful ${tool.response.successful_probe_count === 1 ? "sample" : "samples"}. ${tool.response.error_probe_count} error ${tool.response.error_probe_count === 1 ? "sample" : "samples"}.`,
				"small",
			),
		);
		const variants = tool.response.variants || [];
		if (variants.length > 1) {
			node.append(
				section(
					"Successful response variants",
					variants.map((variant, index) =>
						element(
							"details",
							{ class: "response-variant", open: index === 0 },
							element(
								"summary",
								{},
								variant.label,
								badge(
									variant.sample_count +
										(variant.sample_count === 1 ? " sample" : " samples"),
								),
							),
							text("p", `Selector: ${json(variant.when)}`, "small"),
							schemaTree(variant.schema, rootLabel),
							codeBlock(variant.schema, `${variant.label} response schema`),
						),
					),
				),
			);
		} else {
			node.append(
				section(
					"Successful response",
					schemaTree(tool.response.success_schema, rootLabel),
				),
			);
		}
		node.append(
			codeBlock(
				tool.response.success_schema,
				"Inferred success response schema",
			),
		);
		if (tool.response.error_schema) {
			node.append(
				section(
					"Observed errors",
					schemaTree(tool.response.error_schema, rootLabel),
					codeBlock(
						tool.response.error_schema,
						"Inferred error response schema",
					),
				),
			);
		} else {
			node.append(
				section(
					"Errors",
					text("p", "No error sample. The error shape is unknown.", "small"),
				),
			);
		}
		return node;
	}

	function examplesView(_catalog, tool) {
		const node = document.createDocumentFragment();
		node.append(
			element(
				"div",
				{ class: "summary-note" },
				badge("Synthetic examples", "synthetic"),
				text(
					"p",
					"These examples use synthetic values and were not executed. IDs are placeholders. Addresses use example.com.",
				),
			),
		);
		if (!tool.examples.length) {
			node.append(
				section(
					"Examples",
					element(
						"div",
						{ class: "empty" },
						"No example. See Inputs for the schema.",
					),
				),
			);
		}
		for (const example of tool.examples) {
			node.append(
				section(
					example.title,
					codeBlock(example.request, "Synthetic request arguments"),
					Object.hasOwn(example, "response")
						? codeBlock(
								example.response,
								tool.response.root_label === "result"
									? "Synthetic result"
									: "Synthetic structuredContent",
							)
						: null,
				),
			);
		}
		return node;
	}

	const toolViews = new Map([
		["behavior", behaviorView],
		["inputs", inputsView],
		["responses", responsesView],
		["examples", examplesView],
	]);

	function toolView(route) {
		const catalog = providers.get(route.provider);
		const tool = toolMaps.get(route.provider).get(route.tool);
		const node = document.createDocumentFragment();
		node.append(
			breadcrumb(catalog, groups.get(tool.category)),
			element(
				"div",
				{ class: "meta" },
				evidenceBadge(catalog),
				badge(groups.get(tool.category)),
			),
			element(
				"div",
				{ class: "title-line" },
				text("h1", tool.name, "tool-name"),
				button("Download tool JSON", () =>
					download(tool, `${catalog.id}-${tool.name}.json`),
				),
			),
			text("p", tool.summary, "tool-description"),
			text(
				"div",
				tool.runtime_name === tool.name
					? `${catalog.namespace} / ${tool.name}`
					: tool.runtime_name,
				"runtime-name",
			),
			element(
				"nav",
				{ class: "tabs", "aria-label": "Tool sections" },
				[...tabNames].map(([id, name]) =>
					element(
						"a",
						{
							href: toolUrl(catalog.id, tool.name, id),
							"aria-current": id === route.tab ? "page" : false,
						},
						name,
					),
				),
			),
			toolViews.get(route.tab)(catalog, tool),
		);
		return node;
	}

	function searchView(query) {
		const matches = [];
		const needle = query.toLocaleLowerCase();
		for (const catalog of dataset.catalogs) {
			for (const tool of catalog.tools) {
				const searchable = [
					tool.name,
					tool.summary,
					catalog.title,
					tool.description,
					...tool.behavior.map((item) => item.text),
				]
					.join(" ")
					.toLocaleLowerCase();
				if (searchable.includes(needle)) matches.push([catalog, tool]);
			}
		}
		const node = element(
			"div",
			{},
			text("h1", "Search results"),
			text("p", `${matches.length} of 46 tools match "${query}".`, "lead"),
		);
		node.append(
			section(
				"Across both connectors",
				matches.length
					? matches.map(([catalog, tool]) => toolRow(catalog, tool, true))
					: element(
							"div",
							{ class: "empty" },
							'No tools match. Try "draft", "attachment", or "labels".',
						),
			),
		);
		return node;
	}

	function notFoundView() {
		return element(
			"div",
			{ class: "empty" },
			text("h1", "Page not found."),
			element(
				"div",
				{ class: "actions" },
				link("Return to overview", "#overview", "button"),
			),
		);
	}

	const views = new Map([
		["overview", overviewView],
		["provider", providerView],
		["tool", toolView],
		["not-found", notFoundView],
	]);

	function closeNavigation() {
		$("sidebar").classList.remove("open");
		$("scrim").hidden = true;
		$("menu-button").setAttribute("aria-expanded", "false");
	}

	function render(focusContent = false) {
		const route = readRoute();
		renderNavigation(route);
		const query = $("search").value.trim();
		const content = query ? searchView(query) : views.get(route.kind)(route);
		$("content").replaceChildren(content);
		document.title =
			route.kind === "tool"
				? `${route.tool} · ${providers.get(route.provider).title}`
				: "Gmail Connector Reference";
		closeNavigation();
		if (focusContent) {
			window.scrollTo(0, 0);
			$("content").focus({ preventScroll: true });
		}
	}

	$("provider").addEventListener("change", () => {
		const route = readRoute();
		const id = $("provider").value;
		$("search").value = "";
		location.hash =
			route.kind === "tool" && toolMaps.get(id).has(route.tool)
				? toolUrl(id, route.tool, route.tab)
				: `#provider/${id}`;
	});
	$("search").addEventListener("input", () => render());
	$("menu-button").addEventListener("click", () => {
		const open = $("sidebar").classList.toggle("open");
		$("scrim").hidden = !open;
		$("menu-button").setAttribute("aria-expanded", String(open));
	});
	$("scrim").addEventListener("click", closeNavigation);
	document.addEventListener("click", (event) => {
		const anchor = event.target.closest("a");
		if (!anchor) return;
		const href = anchor.getAttribute("href");
		if (href === "#content") {
			event.preventDefault();
			closeNavigation();
			$("content").focus();
		} else if (href === location.hash && $("search").value) {
			event.preventDefault();
			$("search").value = "";
			render(true);
		}
	});
	document.addEventListener("keydown", (event) => {
		const typing = ["INPUT", "TEXTAREA", "SELECT"].includes(
			document.activeElement.tagName,
		);
		if (event.key === "/" && !typing) {
			event.preventDefault();
			$("search").focus();
		}
		if (event.key === "Escape") {
			closeNavigation();
			if (document.activeElement === $("search")) {
				$("search").value = "";
				render();
				$("search").blur();
			}
		}
	});
	window.addEventListener("hashchange", () => {
		$("search").value = "";
		render(true);
	});
	render();
})();
