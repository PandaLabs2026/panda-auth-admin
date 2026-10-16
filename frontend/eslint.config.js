import js from '@eslint/js';
import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import tseslint from 'typescript-eslint';

// 前端 lint 门禁(范式承自 panda-fleet-admin,组织内最新先例)。规则用于拦截
// 真实缺陷(未用变量、hooks 规则、any 泄漏),而非强制排版——排版由既有房屋
// 风格决定,不引入 prettier 重排噪声。react-hooks 7 附带 react-compiler 规则族;
// 这里只显式启用两条经典规则,不引入 compiler 噪声。
export default tseslint.config(
  { ignores: ['dist', 'coverage'] },
  {
    files: ['**/*.{ts,tsx}'],
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    languageOptions: { ecmaVersion: 2022, globals: globals.browser },
    plugins: { 'react-hooks': reactHooks, 'react-refresh': reactRefresh },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'error',
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
      // `_` 前缀是"有意未用"的惯例(测试 mock 形参、占位解构);不视为缺陷。
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
      ],
    },
  },
  {
    // Node 语境:构建/测试配置与测试文件(vitest globals 由 tsc types 提供,eslint 关 no-undef)。
    files: ['*.config.{ts,js}', 'src/test/**/*.{ts,tsx}', '**/*.test.{ts,tsx}'],
    languageOptions: { globals: { ...globals.browser, ...globals.node } },
  },
);
