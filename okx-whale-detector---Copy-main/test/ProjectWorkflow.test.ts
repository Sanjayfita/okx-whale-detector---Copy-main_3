import { describe, expect, it } from 'vitest';

import { existsSync, readFileSync } from 'node:fs';

import { resolve } from 'node:path';

interface PackageJson {
  main?: string;

  scripts?: Record<string, string>;

  dependencies?: Record<string, string>;

  devDependencies?: Record<string, string>;
}

const projectRoot = resolve(__dirname, '..');

const readProjectFile = (relativePath: string): string =>
  readFileSync(resolve(projectRoot, relativePath), 'utf8');

const findReadmePath = (): string => {
  const possibleNames = ['README.md', 'Readme.md', 'readme.md'];

  const found = possibleNames.find((filename) =>
    existsSync(resolve(projectRoot, filename)),
  );

  if (!found) {
    throw new Error('No README file was found');
  }

  return found;
};

describe('project workflow documentation', () => {
  const packageJson = JSON.parse(
    readProjectFile('package.json'),
  ) as PackageJson;

  const readmeFilename = findReadmePath();

  const readme = readProjectFile(readmeFilename);

  it('points package main to the compiled entry point', () => {
    expect(packageJson.main).toBe('dist/index.js');
  });

  it('defines the required workflow scripts', () => {
    expect(packageJson.scripts).toMatchObject({
      build: 'tsc',

      typecheck: 'tsc --noEmit',

      test: 'vitest run',

      dev: 'tsx src/index.ts',

      start: 'node dist/index.js',

      check: 'npm run typecheck && npm run lint && npm test',
    });
  });

  it('documents every supported command', () => {
    const requiredCommands = [
      'npm ci',
      'npm run check',
      'npm run dev',
      'npm run build',
      'npm start',
    ];

    for (const command of requiredCommands) {
      expect(readme).toContain(command);
    }
  });

  it('uses portable npm commands instead of Windows-only npx.cmd', () => {
    expect(readme).not.toContain('npx.cmd');
  });

  it('ignores generated correlated alert JSONL files', () => {
    expect(readProjectFile('.gitignore')).toContain('data/alerts/*.jsonl');
  });

  it('has balanced Markdown code fences', () => {
    const codeFenceCount = (readme.match(/```/g) ?? []).length;

    expect(codeFenceCount % 2).toBe(0);

    expect(codeFenceCount).toBeGreaterThan(0);
  });

  it('documents research and risk limitations', () => {
    expect(readme).toContain('heuristic research signals');

    expect(readme).toContain('not a guarantee of future price direction');

    expect(readme).toContain('must not be treated as a probability of profit');
  });

  it('documents project structure and watched-symbol configuration', () => {
    expect(readme).toContain('src/config/symbols.ts');

    expect(readme).toContain('src/clients/okx');

    expect(readme).toContain('src/core');

    expect(readme).toContain('src/types');

    expect(readme).toContain('test');
  });

  it('documents order-book data-integrity requirements', () => {
    expect(readme).toContain('full snapshot');

    expect(readme).toContain('sequence-continuity checks');

    expect(readme).toContain('local market state is reset');
  });

  it('does not retain undocumented dotenv usage', () => {
    const hasDotenv = packageJson.dependencies?.dotenv !== undefined;

    if (!hasDotenv) {
      expect(packageJson.dependencies?.dotenv).toBeUndefined();

      return;
    }

    const indexSource = readProjectFile('src/index.ts');

    const dotenvIsLoaded =
      indexSource.includes("import 'dotenv/config'") ||
      indexSource.includes('import "dotenv/config"') ||
      indexSource.includes("from 'dotenv'") ||
      indexSource.includes('from "dotenv"');

    const dotenvIsDocumented =
      readme.includes('.env') || readme.includes('environment variable');

    expect(
      dotenvIsLoaded,
      'dotenv is installed but is not loaded in src/index.ts',
    ).toBe(true);

    expect(
      dotenvIsDocumented,
      'dotenv is installed but environment configuration is not documented',
    ).toBe(true);
  });
});
