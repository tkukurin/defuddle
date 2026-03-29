import { Defuddle as DefuddleClass } from './defuddle';
import type { DefuddleOptions, DefuddleResponse } from './types';
import { toMarkdown } from './markdown';
import { refineExtraction } from './refine';

/**
 * Parse HTML content from a Document, HTML string, or JSDOM instance.
 * Accepts any DOM Document implementation (linkedom, JSDOM, happy-dom, etc.).
 * @param input Document instance, HTML string, or JSDOM-like object with window.document
 * @param url URL of the page being parsed
 * @param options Optional parsing options
 * @returns Promise with parsed content and metadata
 */
export async function Defuddle(
	input: Document | string | { window: { document: Document; location: { href: string } } },
	url?: string,
	options?: DefuddleOptions
): Promise<DefuddleResponse> {
	let doc: Document;
	let originalHtml: string | undefined;

	if (typeof input === 'string') {
		// @deprecated Pass a Document instead of an HTML string.
		// String input will be removed in the next major version.
		originalHtml = input;
		const { parseLinkedomHTML } = await import('./utils/linkedom-compat');
		doc = parseLinkedomHTML(input, url);
	} else if (typeof input === 'object' && input !== null && 'window' in input && input.window?.document) {
		// @deprecated Pass doc.window.document directly instead of a JSDOM instance.
		// JSDOM instance input will be removed in the next major version.
		doc = input.window.document;
		url = url || input.window.location?.href;
	} else {
		doc = input as Document;
	}

	const pageUrl = url || (doc as any).URL || 'about:blank';

	const defuddle = new DefuddleClass(doc, {
		...options,
		url: pageUrl
	});

	const result = await defuddle.parseAsync();

	// Get HTML before markdown conversion for refinement comparison
	const contentHtmlForRefine = result.content;

	toMarkdown(result, options ?? {}, pageUrl);

	// Apply LLM refinement if requested
	if (options?.refine) {
		const refineOpts = typeof options.refine === 'object' ? options.refine : {};
		const htmlContext = originalHtml || contentHtmlForRefine;

		const refineResult = await refineExtraction(
			htmlContext,
			result.content,
			refineOpts
		);

		result.content = refineResult.content;
		result.refineInfo = {
			refined: refineResult.refined,
			method: refineResult.method,
			error: refineResult.error
		};
	}

	return result;
}

export { DefuddleClass, DefuddleOptions, DefuddleResponse };
