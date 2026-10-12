import js from '@eslint/js';
import checkFile from 'eslint-plugin-check-file';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/coverage/**',
      '**/generated/**',
      '**/playwright-report/**',
      '**/test-results/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: { globals: { ...globals.node } },
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      '@typescript-eslint/consistent-type-imports': 'error',
    },
  },
  {
    files: ['apps/web/**/*.{ts,tsx}'],
    languageOptions: { globals: { ...globals.browser } },
    plugins: { 'react-hooks': reactHooks, 'react-refresh': reactRefresh },
    rules: {
      ...reactHooks.configs.recommended.rules,
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
    },
  },
  {
    // Field app (F09): React Native, so no DOM globals beyond what RN provides; hooks rules as on web.
    files: ['apps/mobile/**/*.{ts,tsx}'],
    languageOptions: { globals: { ...globals.browser, __DEV__: 'readonly' } },
    plugins: { 'react-hooks': reactHooks },
    rules: { ...reactHooks.configs.recommended.rules },
  },
  {
    // Jest/Metro/Babel config files in the field app are CommonJS.
    files: ['apps/mobile/*.config.js'],
    languageOptions: { sourceType: 'commonjs', globals: { ...globals.node } },
    rules: { '@typescript-eslint/no-require-imports': 'off' },
  },
  {
    files: ['apps/mobile/**/*.test.{ts,tsx}', 'apps/mobile/src/test/**'],
    languageOptions: { globals: { ...globals.jest } },
  },
  {
    // Generated shadcn/ui components export helpers next to components.
    files: ['apps/web/src/components/ui/**'],
    rules: { 'react-refresh/only-export-components': 'off' },
  },
  {
    // Kebab-case file and folder names (CR-03 / D-084). Exported components keep PascalCase; middle extensions
    // (`.test`, `.spec`, `.setup`, `.config`, `.d`) are ignored. Generated code is ignored above; Prisma
    // migrations, README.md and other non-JS files aren't linted.
    files: ['apps/**/*.{ts,tsx,js,jsx,mjs,cjs}', 'packages/**/*.{ts,tsx,js,jsx,mjs,cjs}'],
    plugins: { 'check-file': checkFile },
    rules: {
      'check-file/filename-naming-convention': [
        'error',
        { '**/*.{ts,tsx,js,jsx,mjs,cjs}': 'KEBAB_CASE' },
        { ignoreMiddleExtensions: true },
      ],
      'check-file/folder-naming-convention': ['error', { '{apps,packages}/**/': 'KEBAB_CASE' }],
    },
  },
  {
    // expo-router file names (F09): `_layout.tsx`, `+not-found.tsx`, `[id].tsx`, and `(group)` folders; the rest of
    // each name is still kebab-case.
    files: ['apps/mobile/src/app/**/*.{ts,tsx}'],
    rules: {
      'check-file/filename-naming-convention': [
        'error',
        { '**/*.{ts,tsx}': '@(_layout|+([a-z0-9-])|+([+])+([a-z0-9-])|\\[*([.])+([a-z0-9-])\\])' },
        { ignoreMiddleExtensions: true },
      ],
      'check-file/folder-naming-convention': [
        'error',
        { 'apps/mobile/src/app/**/': '@(+([a-z0-9-])|\\(+([a-z0-9-])\\)|\\[+([a-z0-9-])\\])' },
      ],
    },
  },
);
