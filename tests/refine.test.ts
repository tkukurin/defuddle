import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import { Defuddle } from '../src/node';
import { parseLinkedomHTML } from '../src/utils/linkedom-compat';

/**
 * LLM Refinement regression tests
 *
 * These tests ensure that LLM refinement doesn't degrade extraction quality.
 * Skipped if GEMINI_API_KEY is not set.
 *
 * Run with: GEMINI_API_KEY=xxx npm test -- tests/refine.test.ts
 */

const FIXTURES_DIR = join(__dirname, 'fixtures');
const EXPECTED_DIR = join(__dirname, 'expected');

const API_KEY = process.env.GEMINI_API_KEY;

// Simple line-based similarity score
function similarity(a: string, b: string): number {
  if (a === b) return 1;
  const aLines = a.trim().split('\n').map(l => l.trim()).filter(Boolean);
  const bLines = b.trim().split('\n').map(l => l.trim()).filter(Boolean);
  const bSet = new Set(bLines);
  let matches = 0;
  for (const line of aLines) {
    if (bSet.has(line)) matches++;
  }
  return matches / Math.max(aLines.length, bLines.length);
}

function extractExpectedMd(content: string): string {
  const match = content.match(/```json\n[\s\S]*?\n```\n\n([\s\S]*)/);
  return match ? match[1].trim() : content.trim();
}

function getFixturesWithExpected(): Array<{ name: string; fixture: string; expected: string }> {
  const fixtures = readdirSync(FIXTURES_DIR).filter(f => f.endsWith('.html'));
  return fixtures
    .map(f => {
      const name = f.replace('.html', '');
      const expectedPath = join(EXPECTED_DIR, `${name}.md`);
      try {
        readFileSync(expectedPath);
        return {
          name,
          fixture: join(FIXTURES_DIR, f),
          expected: expectedPath
        };
      } catch {
        return null;
      }
    })
    .filter((x): x is NonNullable<typeof x> => x !== null);
}

// Find fixtures where base extraction isn't perfect (potential for improvement)
async function findImperfectFixtures(limit = 10): Promise<Array<{ name: string; fixture: string; expected: string; baseScore: number }>> {
  const all = getFixturesWithExpected();
  const imperfect: Array<{ name: string; fixture: string; expected: string; baseScore: number }> = [];

  for (const { name, fixture, expected } of all) {
    if (imperfect.length >= limit) break;

    const html = readFileSync(fixture, 'utf-8');
    const expectedContent = readFileSync(expected, 'utf-8');
    const expectedMd = extractExpectedMd(expectedContent);

    const urlMatch = html.match(/<!--\s*\{"url":\s*"([^"]+)"\}\s*-->/);
    const url = urlMatch ? urlMatch[1] : `https://${name}`;

    const doc = parseLinkedomHTML(html, url);
    const result = await Defuddle(doc, url, { markdown: true });
    const baseScore = similarity(result.content, expectedMd);

    if (baseScore < 0.99) {
      imperfect.push({ name, fixture, expected, baseScore });
    }
  }

  return imperfect;
}

describe.skipIf(!API_KEY)('LLM Refinement', () => {
  // Test a sample of fixtures to ensure refinement doesn't cause major regressions
  const sampleFixtures = getFixturesWithExpected().slice(0, 5);

  test.each(sampleFixtures)(
    'should not regress: $name',
    async ({ name, fixture, expected }) => {
      const html = readFileSync(fixture, 'utf-8');
      const expectedContent = readFileSync(expected, 'utf-8');
      const expectedMd = extractExpectedMd(expectedContent);

      const urlMatch = html.match(/<!--\s*\{"url":\s*"([^"]+)"\}\s*-->/);
      const url = urlMatch ? urlMatch[1] : `https://${name}`;

      // Base extraction
      const doc1 = parseLinkedomHTML(html, url);
      const baseResult = await Defuddle(doc1, url, { markdown: true });
      const baseScore = similarity(baseResult.content, expectedMd);

      // With refinement
      const doc2 = parseLinkedomHTML(html, url);
      const refinedResult = await Defuddle(doc2, url, {
        markdown: true,
        refine: { apiKey: API_KEY }
      });
      const refinedScore = similarity(refinedResult.content, expectedMd);

      // Refinement should not degrade by more than 10%
      const maxDegradation = 0.1;
      expect(refinedScore).toBeGreaterThanOrEqual(baseScore - maxDegradation);

      // Log results for visibility
      console.log(`  ${name}: base=${(baseScore * 100).toFixed(1)}% refined=${(refinedScore * 100).toFixed(1)}% (${refinedResult.refineInfo?.method})`);
    },
    30000
  );
});

describe.skipIf(!API_KEY)('LLM Refinement Improvements', () => {
  let imperfectFixtures: Array<{ name: string; fixture: string; expected: string; baseScore: number }> = [];

  beforeAll(async () => {
    // Find fixtures where base extraction isn't perfect
    imperfectFixtures = await findImperfectFixtures(5);
    if (imperfectFixtures.length === 0) {
      console.log('  No imperfect fixtures found - all extractions match expected');
    } else {
      console.log(`  Found ${imperfectFixtures.length} fixtures with imperfect extraction:`);
      imperfectFixtures.forEach(f => console.log(`    - ${f.name}: ${(f.baseScore * 100).toFixed(1)}%`));
    }
  });

  test('should find improvement opportunities', async () => {
    if (imperfectFixtures.length === 0) {
      // All fixtures are perfect, nothing to improve
      expect(true).toBe(true);
      return;
    }

    let improved = 0;
    let degraded = 0;

    for (const { name, fixture, expected, baseScore } of imperfectFixtures) {
      const html = readFileSync(fixture, 'utf-8');
      const expectedContent = readFileSync(expected, 'utf-8');
      const expectedMd = extractExpectedMd(expectedContent);

      const urlMatch = html.match(/<!--\s*\{"url":\s*"([^"]+)"\}\s*-->/);
      const url = urlMatch ? urlMatch[1] : `https://${name}`;

      const doc = parseLinkedomHTML(html, url);
      const refinedResult = await Defuddle(doc, url, {
        markdown: true,
        refine: { apiKey: API_KEY }
      });
      const refinedScore = similarity(refinedResult.content, expectedMd);

      const delta = refinedScore - baseScore;
      if (delta > 0.01) improved++;
      if (delta < -0.01) degraded++;

      console.log(`  ${name}: ${(baseScore * 100).toFixed(1)}% -> ${(refinedScore * 100).toFixed(1)}% (${delta > 0 ? '+' : ''}${(delta * 100).toFixed(1)}%)`);
    }

    console.log(`\n  Summary: ${improved} improved, ${degraded} degraded out of ${imperfectFixtures.length}`);

    // At minimum, degraded should not exceed improved
    expect(degraded).toBeLessThanOrEqual(improved + 1);
  }, 120000);
});

// Quick smoke test that runs without API key
describe('LLM Refinement (no API key)', () => {
  test('should gracefully skip refinement when no LLM available', async () => {
    const html = '<html><body><article><h1>Test</h1><p>Content here.</p></article></body></html>';
    const doc = parseLinkedomHTML(html, 'https://example.com');

    const result = await Defuddle(doc, 'https://example.com', {
      markdown: true,
      refine: true // No API key, should skip
    });

    expect(result.content).toContain('Content here');
    expect(result.refineInfo?.method).toBe('none');
    expect(result.refineInfo?.refined).toBe(false);
  });
});
