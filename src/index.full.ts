import { Defuddle as DefuddleBase } from './defuddle';
import { DefuddleOptions, DefuddleResponse } from './types';
import { toMarkdown, createMarkdownContent } from './markdown';
import { refineExtraction, getAvailableRefinementMethods } from './refine';

// Export types
export type { DefuddleOptions, DefuddleResponse };

// Export standalone markdown conversion and refinement utilities
export { createMarkdownContent, refineExtraction, getAvailableRefinementMethods };

class Defuddle {
	private defuddle: DefuddleBase;
	private options: DefuddleOptions;

	constructor(doc: Document, options: DefuddleOptions = {}) {
		this.defuddle = new DefuddleBase(doc, options);
		this.options = options;
	}

	parse(): DefuddleResponse {
		const result = this.defuddle.parse();
		toMarkdown(result, this.options, this.options.url ?? '');
		// Note: refinement is async-only, use parseAsync() for refine option
		return result;
	}

	async parseAsync(): Promise<DefuddleResponse> {
		const result = await this.defuddle.parseAsync();
		const contentHtmlForRefine = result.content;
		toMarkdown(result, this.options, this.options.url ?? '');

		// Apply LLM refinement if requested
		if (this.options.refine) {
			const refineOpts = typeof this.options.refine === 'object' ? this.options.refine : {};
			const refineResult = await refineExtraction(
				contentHtmlForRefine,
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
}

// Attach named exports as static properties for UMD/CJS consumers
(Defuddle as any).createMarkdownContent = createMarkdownContent;
(Defuddle as any).refineExtraction = refineExtraction;
(Defuddle as any).getAvailableRefinementMethods = getAvailableRefinementMethods;

// Export Defuddle as default
export default Defuddle;

// This file exists to ensure proper type generation for the full bundle
// The actual math module switching is handled by webpack's alias configuration
