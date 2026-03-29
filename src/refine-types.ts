/**
 * TypeScript definitions for Chrome's built-in AI APIs (Gemini Nano)
 * These are experimental APIs available in Chrome 138+
 * @see https://developer.chrome.com/docs/ai/built-in
 */

export interface LanguageModelAvailability {
	availability(): Promise<'readily' | 'after-download' | 'unavailable'>;
}

export interface LanguageModelParams {
	defaultTemperature: number;
	defaultTopK: number;
	maxTemperature: number;
	maxTopK: number;
}

export interface LanguageModelPrompt {
	role: 'system' | 'user' | 'assistant';
	content: string | LanguageModelContent[];
	prefix?: boolean;
}

export interface LanguageModelContent {
	type: 'text' | 'image' | 'audio';
	value: string | Blob | ArrayBuffer;
}

export interface LanguageModelCreateOptions {
	initialPrompts?: LanguageModelPrompt[];
	temperature?: number;
	topK?: number;
	signal?: AbortSignal;
	monitor?: (monitor: LanguageModelDownloadMonitor) => void;
	expectedInputs?: Array<{ type: string; languages?: string[] }>;
	expectedOutputs?: Array<{ type: string; languages?: string[] }>;
}

export interface LanguageModelDownloadMonitor {
	addEventListener(
		type: 'downloadprogress',
		listener: (event: LanguageModelDownloadEvent) => void
	): void;
}

export interface LanguageModelDownloadEvent extends Event {
	loaded: number;
	total: number;
}

export interface LanguageModelSession {
	prompt(input: string, options?: { signal?: AbortSignal; responseConstraint?: object }): Promise<string>;
	promptStreaming(input: string, options?: { signal?: AbortSignal }): AsyncIterable<string>;
	clone(): Promise<LanguageModelSession>;
	destroy(): void;
	readonly contextUsage: number;
	readonly contextWindow: number;
}

export interface LanguageModelAPI {
	availability(options?: LanguageModelCreateOptions): Promise<'available' | 'readily' | 'after-download' | 'unavailable' | 'no'>;
	create(options?: LanguageModelCreateOptions): Promise<LanguageModelSession>;
	params(): Promise<LanguageModelParams>;
}

export interface RewriterCreateOptions {
	tone?: 'more-formal' | 'as-is' | 'more-casual';
	format?: 'as-is' | 'markdown' | 'plain-text';
	length?: 'shorter' | 'as-is' | 'longer';
	sharedContext?: string;
	expectedInputLanguages?: string[];
	expectedContextLanguages?: string[];
	outputLanguage?: string;
	monitor?: (monitor: LanguageModelDownloadMonitor) => void;
}

export interface RewriterSession {
	rewrite(input: string, options?: { context?: string; signal?: AbortSignal }): Promise<string>;
	rewriteStreaming(input: string, options?: { context?: string; signal?: AbortSignal }): AsyncIterable<string>;
	destroy(): void;
}

export interface RewriterAPI {
	availability(options?: RewriterCreateOptions): Promise<'available' | 'readily' | 'after-download' | 'unavailable' | 'no'>;
	create(options?: RewriterCreateOptions): Promise<RewriterSession>;
}

export interface SummarizerCreateOptions {
	type?: 'key-points' | 'tl;dr' | 'teaser' | 'headline';
	format?: 'markdown' | 'plain-text';
	length?: 'short' | 'medium' | 'long';
	sharedContext?: string;
	expectedInputLanguages?: string[];
	expectedContextLanguages?: string[];
	outputLanguage?: string;
	monitor?: (monitor: LanguageModelDownloadMonitor) => void;
}

export interface SummarizerSession {
	summarize(input: string, options?: { context?: string; signal?: AbortSignal }): Promise<string>;
	summarizeStreaming(input: string, options?: { context?: string; signal?: AbortSignal }): AsyncIterable<string>;
	destroy(): void;
}

export interface SummarizerAPI {
	availability(options?: SummarizerCreateOptions): Promise<'available' | 'readily' | 'after-download' | 'unavailable' | 'no'>;
	create(options?: SummarizerCreateOptions): Promise<SummarizerSession>;
}

// Extend the global Window interface
declare global {
	interface Window {
		LanguageModel?: LanguageModelAPI;
		Rewriter?: RewriterAPI;
		Summarizer?: SummarizerAPI;
	}

	// Also available as globals
	var LanguageModel: LanguageModelAPI | undefined;
	var Rewriter: RewriterAPI | undefined;
	var Summarizer: SummarizerAPI | undefined;
}
