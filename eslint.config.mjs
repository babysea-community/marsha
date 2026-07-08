// Flat ESLint config for the the app starter.
//
// Goals:
// - Catch obvious bugs (`@eslint/js` recommended + typescript-eslint recommended)
// - Apply Next.js Core Web Vitals rules
// - Block client-side imports of server-only modules (defense-in-depth on top
//   of `import 'server-only'`, which already throws at build time)
import js from '@eslint/js';
import nextPlugin from '@next/eslint-plugin-next';
import tseslint from 'typescript-eslint';
import globals from 'globals';

const SERVER_ONLY_PATTERNS = [
  {
    group: ['@/lib/database/admin', '@/lib/database/admin.*'],
    message:
      'lib/database/admin is server-only. Call it from a route handler, server module, script, or test. Type-only imports are allowed.',
    allowTypeImports: true,
  },
  {
    group: ['@/lib/babysea', '@/lib/babysea.*'],
    message:
      'BabySea SDK calls must stay server-only. Call them from a route handler or server module. Type-only imports are allowed.',
    allowTypeImports: true,
  },
  {
    group: [
      '@/lib/api',
      '@/lib/api/*',
      '@/lib/chains/runner',
      '@/lib/chains/runner.*',
      '@/lib/chains/store',
      '@/lib/chains/store.*',
    ],
    message:
      'The app API and chain runtime modules are server-only. Call them from a route handler, server module, script, or test. Type-only imports are allowed.',
    allowTypeImports: true,
  },
  {
    group: [
      '@/lib/monitoring/sentry-server',
      '@/lib/security/crypto',
      '@/lib/security/http',
      '@/lib/security/network-safety',
    ],
    message: 'This module is server-only. Type-only imports are allowed.',
    allowTypeImports: true,
  },
];

export default [
  {
    ignores: [
      '.next/**',
      '.pnpm-store/**',
      'node_modules/**',
      'next-env.d.ts',
      'lib/database.types.ts',
      'public/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    plugins: {
      '@next/next': nextPlugin,
    },
    rules: {
      ...nextPlugin.configs.recommended.rules,
      ...nextPlugin.configs['core-web-vitals'].rules,
      '@typescript-eslint/no-unused-vars': [
        'warn',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/no-explicit-any': 'warn',
      // The starter ships a static landing page with internal anchor links;
      // `next/link` would force client-router behavior on every nav.
      '@next/next/no-html-link-for-pages': 'off',
      // Media renders straight from Cloudflare image delivery/provider
      // URLs; the Next.js image optimizer is intentionally not used.
      '@next/next/no-img-element': 'off',
      // ESLint 10 recommended rules surface stylistic preferences that the
      // starter does not enforce: error-cause wrapping (verbose, hides root
      // cause in logs), useless-assignments in defensive declarations, and
      // ts-nocheck for scripts that intentionally relax type checking.
      'preserve-caught-error': 'off',
      'no-useless-assignment': 'off',
      '@typescript-eslint/ban-ts-comment': 'off',
    },
  },
  {
    languageOptions: {
      globals: { ...globals.browser, ...globals.node },
    },
  },
  {
    // Restrict server-only imports from any file that opts into the client
    // runtime via the `'use client'` directive. Files that need these modules
    // should remain server components/server actions/route handlers.
    // Type-only imports are allowed because they are erased at compile time.
    files: ['**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': 'off',
      '@typescript-eslint/no-restricted-imports': [
        'error',
        {
          patterns: SERVER_ONLY_PATTERNS,
        },
      ],
    },
  },
  {
    // Server code is allowed to import the above modules freely.
    files: [
      'app/**/route.ts',
      'app/**/_lib/**',
      'app/**/_actions/**',
      'app/**/actions.ts',
      'app/**/server-actions.ts',
      'app/**/page.tsx',
      'app/**/layout.tsx',
      'app/**/loading.tsx',
      'app/**/error.tsx',
      'app/**/global-error.tsx',
      'app/**/not-found.tsx',
      'app/**/template.tsx',
      'lib/**',
      'instrumentation.ts',
      'next.config.ts',
      'scripts/**',
      'vitest.config.ts',
      '**/*.test.ts',
    ],
    rules: {
      'no-restricted-imports': 'off',
      '@typescript-eslint/no-restricted-imports': 'off',
    },
  },
  {
    files: ['scripts/**/*.mjs'],
    rules: {
      '@typescript-eslint/no-unused-vars': 'off',
    },
  },
];
