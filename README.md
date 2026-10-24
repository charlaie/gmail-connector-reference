# Gmail Connector Reference

## AI Use Disclaimer
This repo, research, and site all make use of AI. AI was used to explore the Gmail connectors, collect example data, and infer schema types. AI was also used to generate the site to view those schemas in a friendly way.

## About

This is an unofficial reference to two Gmail connectors, the ChatGPT Gmail plugin and the Grok Bot Gmail connector. As the details of the Gmail connectors are not made public, this may be useful for anyone wanting to know exactly what tools they are giving their agent, or anyone who wants to reference the Gmail connector for their own MCP server.

This documentation may contain errors, omissions, or outdated behavior. Use it only as a reference and verify schemas and tool behavior before use.

| Connector | Tools | Input schemas | Response evidence |
| --- | --- | --- | --- |
| ChatGPT Gmail | 21 | Reconstructed from exposed TypeScript declarations | 42 live test calls |
| Grok Bot / Cursor Gmail | 25 | Captured JSON Schema | A supplied log of 51 Gmail calls and one host attachment download. |



## Files

| Path | Purpose |
| --- | --- |
| [data/chatgpt-gmail.json](data/chatgpt-gmail.json) | Editable ChatGPT catalog |
| [data/grokbot-gmail.json](data/grokbot-gmail.json) | Editable Grok Bot / Cursor catalog |
| `data/*-tools.json` | Generated tool names, captured descriptions, and `inputSchema` definitions |
| `data/*-outputs.json` | Generated response schemas, variants, sample counts, and caveats |
| `index.html`, `assets/app.js`, `assets/styles.css` | Static viewer |
| `assets/catalog.js` | Generated copy of both catalogs for offline use |
| `scripts/build.mjs` | Generate the browser bundle and four JSON exports |
| `scripts/check.mjs` | Check catalog structure, examples, privacy patterns, and generated files |
| `.github/workflows/pages.yml` | Build, check, and deploy to GitHub Pages |

The JSON files provide direct downloads and schema diffs in Git history. Edit the two full catalogs. Do not edit generated files by hand.

## Interpret the schemas

Each download contains a catalog. The catalog itself is not a validating JSON Schema.

- `input_schema` describes arguments. ChatGPT schemas come from TypeScript declarations and cannot recover hidden runtime validation. Grok schemas retain captured draft-07 constraints.
- `response.success_schema` and `response.error_schema` describe observed shapes. A null value means no sample. These are inferred fragments, not provider-declared MCP `outputSchema` values.
- `response.variants` separates observed formats and target types. Each variant has a selector and sample count.
- Response schemas do not specify required properties. Empty arrays leave item types unknown. Null-only fields leave non-null types unknown.
- Tool-definition downloads use `inputSchema`. They contain normalized definitions, not original server `tools/list` responses.

Behavior notes distinguish observed test results from rules declared in descriptions. Examples use synthetic values and were not executed. Addresses use `example.com`; IDs are placeholders.

Captured types, required fields, bounds, patterns, and enums are unchanged. Example addresses and one label in descriptions use placeholders. Grok response schemas contain types and property names derived from the supplied log, without captured account values.

## Known limits

The Grok capture has error samples only for `update_email_labels` and `get_draft`. Draft reads cover `PLAIN_TEXT` and `FULL_CONTENT`. The only `list_filters` sample was an empty object, so populated results remain unknown.

A recorded search with `maxResults=0` returned results despite the schema minimum of 1. The capture does not establish whether the host rewrote the argument or the server accepted it. The public schema keeps the declared minimum. Removing TRASH did not always restore INBOX in the supplied capture.

Tests did not cover every argument combination, large batches, rate limits, or authentication failures. Samples do not establish complete response contracts.