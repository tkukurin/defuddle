/**
 * Evaluate LLM refinement against the test fixtures.
 *
 * Usage:
 *   GEMINI_API_KEY=xxx npx tsx eval-refine.ts [--limit N] [--filter pattern]
 *
 * This script:
 * 1. Loads fixtures from tests/fixtures/
 * 2. Runs Defuddle with and without refinement
 * 3. Compares both to expected output
 * 4. Reports which version is closer to expected
 */

import { readFileSync, readdirSync } from 'fs';
import { join, basename } from 'path';
import { Defuddle } from './src/node';
import { parseLinkedomHTML } from './src/utils/linkedom-compat';

const FIXTURES_DIR = join(__dirname, 'tests/fixtures');
const EXPECTED_DIR = join(__dirname, 'tests/expected');

interface EvalResult {
  name: string;
  baseScore: number;
  refinedScore: number;
  improved: boolean;
  degraded: boolean;
  refinedBy: string;
  error?: string;
}

// Simple diff score: Levenshtein distance normalized by length
function similarity(a: string, b: string): number {
  if (a === b) return 1;
  const longer = a.length > b.length ? a : b;
  const shorter = a.length > b.length ? b : a;
  if (longer.length === 0) return 1;

  // For long strings, use line-based comparison
  const aLines = a.trim().split('\n');
  const bLines = b.trim().split('\n');

  let matches = 0;
  const bSet = new Set(bLines.map(l => l.trim()));
  for (const line of aLines) {
    if (bSet.has(line.trim())) matches++;
  }

  return matches / Math.max(aLines.length, bLines.length);
}

function extractMarkdownFromExpected(content: string): string {
  // Expected files have JSON preamble in ```json``` block, then markdown
  const match = content.match(/```json\n[\s\S]*?\n```\n\n([\s\S]*)/);
  return match ? match[1].trim() : content.trim();
}

async function evaluateFixture(
  fixturePath: string,
  expectedPath: string,
  apiKey?: string
): Promise<EvalResult> {
  const name = basename(fixturePath, '.html');

  try {
    const html = readFileSync(fixturePath, 'utf-8');
    const expected = readFileSync(expectedPath, 'utf-8');
    const expectedMd = extractMarkdownFromExpected(expected);

    // Extract URL from fixture
    const frontmatterMatch = html.match(/<!--\s*(\{"url":.*?\})\s*-->/);
    const frontmatter = frontmatterMatch ? JSON.parse(frontmatterMatch[1]) : {};
    const urlName = name.replace(/^[a-z]+--/, '');
    const url = frontmatter.url || `https://${urlName}`;

    const doc = parseLinkedomHTML(html, url);

    // Run without refinement
    const baseResult = await Defuddle(doc, url, { markdown: true });
    const baseScore = similarity(baseResult.content, expectedMd);

    // Run with refinement (if API key provided)
    let refinedScore = baseScore;
    let refinedBy = 'none';

    if (apiKey) {
      const doc2 = parseLinkedomHTML(html, url);
      const refinedResult = await Defuddle(doc2, url, {
        markdown: true,
        refine: { apiKey }
      });
      refinedScore = similarity(refinedResult.content, expectedMd);
      refinedBy = refinedResult.refineInfo?.method || 'none';
    }

    return {
      name,
      baseScore,
      refinedScore,
      improved: refinedScore > baseScore + 0.01,
      degraded: refinedScore < baseScore - 0.01,
      refinedBy
    };
  } catch (e) {
    return {
      name,
      baseScore: 0,
      refinedScore: 0,
      improved: false,
      degraded: false,
      refinedBy: 'error',
      error: e instanceof Error ? e.message : String(e)
    };
  }
}

async function main() {
  const args = process.argv.slice(2);
  const limitIdx = args.indexOf('--limit');
  const filterIdx = args.indexOf('--filter');

  const limit = limitIdx >= 0 ? parseInt(args[limitIdx + 1]) : 10;
  const filter = filterIdx >= 0 ? args[filterIdx + 1] : null;

  const apiKey = process.env.GEMINI_API_KEY;

  if (!apiKey) {
    console.log('Warning: No GEMINI_API_KEY - will only show base scores\n');
  }

  // Get fixtures
  let fixtures = readdirSync(FIXTURES_DIR)
    .filter(f => f.endsWith('.html'))
    .map(f => ({
      fixture: join(FIXTURES_DIR, f),
      expected: join(EXPECTED_DIR, f.replace('.html', '.md'))
    }))
    .filter(({ expected }) => {
      try { readFileSync(expected); return true; } catch { return false; }
    });

  if (filter) {
    fixtures = fixtures.filter(f => f.fixture.includes(filter));
  }

  fixtures = fixtures.slice(0, limit);

  console.log(`Evaluating ${fixtures.length} fixtures...\n`);
  console.log('Name'.padEnd(60) + 'Base'.padStart(8) + 'Refined'.padStart(10) + '  Result');
  console.log('-'.repeat(90));

  const results: EvalResult[] = [];

  for (const { fixture, expected } of fixtures) {
    const result = await evaluateFixture(fixture, expected, apiKey);
    results.push(result);

    const status = result.error ? '❌ ERROR'
      : result.improved ? '✅ IMPROVED'
      : result.degraded ? '⚠️  DEGRADED'
      : '➖ SAME';

    console.log(
      result.name.slice(0, 58).padEnd(60) +
      (result.baseScore * 100).toFixed(1).padStart(7) + '%' +
      (result.refinedScore * 100).toFixed(1).padStart(9) + '%' +
      '  ' + status
    );

    if (result.error) {
      console.log(`   Error: ${result.error.slice(0, 80)}`);
    }
  }

  // Summary
  console.log('\n' + '='.repeat(90));
  const improved = results.filter(r => r.improved).length;
  const degraded = results.filter(r => r.degraded).length;
  const same = results.filter(r => !r.improved && !r.degraded && !r.error).length;
  const errors = results.filter(r => r.error).length;

  const avgBase = results.reduce((s, r) => s + r.baseScore, 0) / results.length;
  const avgRefined = results.reduce((s, r) => s + r.refinedScore, 0) / results.length;

  console.log(`\nSummary:`);
  console.log(`  Improved:  ${improved}`);
  console.log(`  Degraded:  ${degraded}`);
  console.log(`  Same:      ${same}`);
  console.log(`  Errors:    ${errors}`);
  console.log(`\n  Avg base score:    ${(avgBase * 100).toFixed(1)}%`);
  console.log(`  Avg refined score: ${(avgRefined * 100).toFixed(1)}%`);
}

main().catch(console.error);
