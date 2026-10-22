// Flat config format for ESLint (used when file is named `eslint.config.js`)
const tsPlugin = require('@typescript-eslint/eslint-plugin');

module.exports = [
   {
      ignores: ['dist/**', 'build/**', 'node_modules/**'],
   },
   {
      files: ['**/*.{js,jsx,ts,tsx}'],
      languageOptions: {
         parser: require('@typescript-eslint/parser'),
      },
      plugins: {
         '@typescript-eslint': tsPlugin,
      },
      rules: {
         'no-unused-vars': 'off',
         '@typescript-eslint/no-unused-vars': [
            'error',
            {
               args: 'all',
               argsIgnorePattern: '^_',
               caughtErrors: 'all',
               caughtErrorsIgnorePattern: '^_',
               destructuredArrayIgnorePattern: '^_',
               varsIgnorePattern: '^_',
               ignoreRestSiblings: true,
            },
         ],
      },
   },
];
