import globals from 'globals';
import { configs, plugins } from 'eslint-config-airbnb-extended';
import prettierConfig from 'eslint-config-prettier';

export default [
  {
    ignores: ['node_modules/', 'build/', 'coverage/', 'example/', 'scripts/', 'eslint.config.mjs'],
  },
  plugins.stylistic,
  plugins.importX,
  ...configs.base.recommended,
  {
    files: ['**/*.js'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: {
        ...globals.node,
      },
      parserOptions: {
        ecmaVersion: 'latest',
      },
    },
    rules: {
      'import-x/extensions': ['error', 'ignorePackages'],
      'import-x/no-useless-path-segments': ['error', { noUselessIndex: false }],
      'no-plusplus': 'off',
      'no-await-in-loop': 'off',
      'no-restricted-syntax': 'off',
      'no-param-reassign': ['error', { props: false }],
      'no-underscore-dangle': 'off',
      'class-methods-use-this': 'off',
      radix: 'off',
    },
  },
  {
    files: ['*.test.js'],
    languageOptions: {
      globals: {
        describe: 'readonly',
        it: 'readonly',
        beforeEach: 'readonly',
        afterEach: 'readonly',
        before: 'readonly',
        after: 'readonly',
      },
    },
    rules: {
      'no-unused-expressions': 'off',
    },
  },
  {
    files: ['mocks/**/*.js'],
    rules: {
      'class-methods-use-this': 'off',
      'import-x/no-extraneous-dependencies': 'off',
    },
  },
  prettierConfig,
];
