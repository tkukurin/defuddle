/**
 * LLM-based content refinement for Defuddle
 *
 * Uses Chrome's built-in Gemini Nano in browsers, falls back to
 * Google's Gemini API for Node.js and Cloudflare Workers.
 */

import type { LanguageModelSession, RewriterSession } from './refine-types';

export interface RefineOptions {
	/**
	 * Gemini API key for server-side refinement (Node.js, Workers)
	 * Not needed in browsers with Chrome's built-in AI
	 */
	apiKey?: string;

	/**
	 * Gemini model to use for API calls
	 * @default 'gemini-1.5-flash'
	 */
	model?: string;

	/**
	 * Refinement strategy
	 * - 'prompt': Use Prompt API for flexible analysis and fixes
	 * - 'rewriter': Use Rewriter API for simpler text cleanup
	 * @default 'prompt'
	 */
	strategy?: 'prompt' | 'rewriter';

	/**
	 * Maximum length of original HTML to include in prompt (characters)
	 * @default 4000
	 */
	maxHtmlContext?: number;

	/**
	 * AbortSignal for cancellation
	 */
	signal?: AbortSignal;

	/**
	 * Callback for download progress (browser only)
	 */
	onDownloadProgress?: (loaded: number, total: number) => void;
}

export interface RefineResult {
	/** The refined content */
	content: string;
	/** Whether refinement was applied */
	refined: boolean;
	/** Which method was used */
	method: 'chrome-prompt' | 'chrome-rewriter' | 'gemini-api' | 'none';
	/** Error message if refinement failed but original content returned */
	error?: string;
}

const SYSTEM_PROMPT = `You are a web content extraction quality improver. Your task is to compare extracted markdown against the original HTML and fix any issues.

Common extraction problems to fix:
- Missing content that was incorrectly removed
- Broken markdown formatting (lists, tables, code blocks)
- Garbled text from incorrect encoding or JS rendering artifacts
- Missing or broken links/images
- Incomplete sentences or paragraphs
- Navigation/UI text that leaked into content

Rules:
- Return ONLY the improved markdown, no explanations
- Preserve the original structure and meaning
- Don't add content that wasn't in the original
- If the extraction looks correct, return it unchanged
- Keep the same markdown style (ATX headings, fenced code blocks, etc.)`;

const REWRITER_CONTEXT = `This is markdown extracted from a web page. Fix any extraction artifacts like broken formatting, garbled text, or incomplete content. Preserve all meaningful content and links.`;

/**
 * Check if Chrome's built-in LanguageModel API is available
 */
export async function isLanguageModelAvailable(): Promise<boolean> {
	if (typeof globalThis.LanguageModel === 'undefined') {
		return false;
	}
	try {
		const availability = await globalThis.LanguageModel.availability();
		// Chrome returns "available", "readily", "after-download", or "no"/"unavailable"
		return availability === 'available' || availability === 'readily' || availability === 'after-download';
	} catch {
		return false;
	}
}

/**
 * Check if Chrome's built-in Rewriter API is available
 */
export async function isRewriterAvailable(): Promise<boolean> {
	if (typeof globalThis.Rewriter === 'undefined') {
		return false;
	}
	try {
		const availability = await globalThis.Rewriter.availability();
		return availability === 'available' || availability === 'readily' || availability === 'after-download';
	} catch {
		return false;
	}
}

/**
 * Create a Chrome LanguageModel session for content refinement
 */
async function createLanguageModelSession(
	options: RefineOptions
): Promise<LanguageModelSession> {
	if (!globalThis.LanguageModel) {
		throw new Error('LanguageModel API not available');
	}

	return globalThis.LanguageModel.create({
		initialPrompts: [
			{ role: 'system', content: SYSTEM_PROMPT }
		],
		signal: options.signal,
		monitor: options.onDownloadProgress
			? (m) => {
				m.addEventListener('downloadprogress', (e) => {
					options.onDownloadProgress!(e.loaded, e.total);
				});
			}
			: undefined
	});
}

/**
 * Create a Chrome Rewriter session for content cleanup
 */
async function createRewriterSession(
	options: RefineOptions
): Promise<RewriterSession> {
	if (!globalThis.Rewriter) {
		throw new Error('Rewriter API not available');
	}

	return globalThis.Rewriter.create({
		tone: 'as-is',
		format: 'markdown',
		length: 'as-is',
		sharedContext: REWRITER_CONTEXT,
		monitor: options.onDownloadProgress
			? (m) => {
				m.addEventListener('downloadprogress', (e) => {
					options.onDownloadProgress!(e.loaded, e.total);
				});
			}
			: undefined
	});
}

/**
 * Build the prompt for content comparison and refinement
 */
function buildRefinementPrompt(html: string, markdown: string, maxHtmlContext: number): string {
	const truncatedHtml = html.length > maxHtmlContext
		? html.slice(0, maxHtmlContext) + '\n[... truncated ...]'
		: html;

	return `## Original HTML (for reference)
\`\`\`html
${truncatedHtml}
\`\`\`

## Extracted Markdown (to improve)
\`\`\`markdown
${markdown}
\`\`\`

Analyze the extraction and return the improved markdown:`;
}

/**
 * Refine content using Chrome's built-in Prompt API
 */
async function refineWithChromePrompt(
	html: string,
	markdown: string,
	options: RefineOptions
): Promise<RefineResult> {
	const session = await createLanguageModelSession(options);

	try {
		const prompt = buildRefinementPrompt(
			html,
			markdown,
			options.maxHtmlContext ?? 4000
		);

		const result = await session.prompt(prompt, {
			signal: options.signal
		});

		// Clean up markdown code fence if the model wrapped it
		let refined = result.trim();
		if (refined.startsWith('```markdown')) {
			refined = refined.slice(11);
		} else if (refined.startsWith('```')) {
			refined = refined.slice(3);
		}
		if (refined.endsWith('```')) {
			refined = refined.slice(0, -3);
		}
		refined = refined.trim();

		return {
			content: refined,
			refined: refined !== markdown,
			method: 'chrome-prompt'
		};
	} finally {
		session.destroy();
	}
}

/**
 * Refine content using Chrome's built-in Rewriter API
 */
async function refineWithChromeRewriter(
	markdown: string,
	options: RefineOptions
): Promise<RefineResult> {
	const session = await createRewriterSession(options);

	try {
		const result = await session.rewrite(markdown, {
			context: 'Fix any markdown formatting issues or extraction artifacts.',
			signal: options.signal
		});

		const refined = result.trim();

		return {
			content: refined,
			refined: refined !== markdown,
			method: 'chrome-rewriter'
		};
	} finally {
		session.destroy();
	}
}

/**
 * Refine content using Google's Gemini API (for Node.js / Workers)
 */
async function refineWithGeminiAPI(
	html: string,
	markdown: string,
	options: RefineOptions
): Promise<RefineResult> {
	if (!options.apiKey) {
		throw new Error('Gemini API key required for server-side refinement');
	}

	const model = options.model ?? 'gemini-1.5-flash';
	const maxHtmlContext = options.maxHtmlContext ?? 4000;

	const prompt = buildRefinementPrompt(html, markdown, maxHtmlContext);
	const fullPrompt = `${SYSTEM_PROMPT}\n\n${prompt}`;

	const response = await fetch(
		`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${options.apiKey}`,
		{
			method: 'POST',
			headers: {
				'Content-Type': 'application/json'
			},
			body: JSON.stringify({
				contents: [{
					parts: [{ text: fullPrompt }]
				}],
				generationConfig: {
					temperature: 0.2,
					maxOutputTokens: 8192
				}
			}),
			signal: options.signal
		}
	);

	if (!response.ok) {
		const error = await response.text();
		throw new Error(`Gemini API error: ${response.status} ${error}`);
	}

	const data = await response.json() as {
		candidates?: Array<{
			content?: {
				parts?: Array<{ text?: string }>;
			};
		}>;
	};

	const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
	if (!text) {
		throw new Error('No content in Gemini API response');
	}

	// Clean up markdown code fence if the model wrapped it
	let refined = text.trim();
	if (refined.startsWith('```markdown')) {
		refined = refined.slice(11);
	} else if (refined.startsWith('```')) {
		refined = refined.slice(3);
	}
	if (refined.endsWith('```')) {
		refined = refined.slice(0, -3);
	}
	refined = refined.trim();

	return {
		content: refined,
		refined: refined !== markdown,
		method: 'gemini-api'
	};
}

/**
 * Refine extracted content using LLM
 *
 * Automatically selects the best available method:
 * 1. Chrome's built-in Prompt API (browser)
 * 2. Chrome's built-in Rewriter API (browser, fallback)
 * 3. Google's Gemini API (Node.js, Workers)
 *
 * @param html - Original HTML content (used for comparison)
 * @param markdown - Extracted markdown to potentially improve
 * @param options - Refinement options
 * @returns Refined content and metadata
 *
 * @example
 * ```typescript
 * // Browser (uses Chrome's built-in AI)
 * const result = await refineExtraction(html, markdown);
 *
 * // Node.js / Workers (uses Gemini API)
 * const result = await refineExtraction(html, markdown, {
 *   apiKey: process.env.GEMINI_API_KEY
 * });
 * ```
 */
export async function refineExtraction(
	html: string,
	markdown: string,
	options: RefineOptions = {}
): Promise<RefineResult> {
	const strategy = options.strategy ?? 'prompt';

	try {
		// Try Chrome's built-in APIs first (browser environment)
		if (strategy === 'prompt' && await isLanguageModelAvailable()) {
			return await refineWithChromePrompt(html, markdown, options);
		}

		if (strategy === 'rewriter' && await isRewriterAvailable()) {
			return await refineWithChromeRewriter(markdown, options);
		}

		// Fall back to Prompt API if Rewriter was requested but unavailable
		if (strategy === 'rewriter' && await isLanguageModelAvailable()) {
			return await refineWithChromePrompt(html, markdown, options);
		}

		// Use Gemini API for server-side environments
		if (options.apiKey) {
			return await refineWithGeminiAPI(html, markdown, options);
		}

		// No refinement available
		return {
			content: markdown,
			refined: false,
			method: 'none',
			error: 'No LLM available (no Chrome AI, no API key)'
		};
	} catch (error) {
		// Return original content on error
		return {
			content: markdown,
			refined: false,
			method: 'none',
			error: error instanceof Error ? error.message : 'Unknown error'
		};
	}
}

/**
 * Check what refinement methods are available in the current environment
 */
export async function getAvailableRefinementMethods(): Promise<{
	chromePrompt: boolean;
	chromeRewriter: boolean;
	geminiApi: boolean;
}> {
	return {
		chromePrompt: await isLanguageModelAvailable(),
		chromeRewriter: await isRewriterAvailable(),
		geminiApi: true // Always available if API key is provided
	};
}
