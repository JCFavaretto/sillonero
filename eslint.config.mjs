import { defineConfig } from "eslint/config";
import expo from "eslint-config-expo/flat.js";
import tseslint from "typescript-eslint";

export default defineConfig(
  {
    ignores: [
      "**/node_modules/**",
      "scratch/**",
      "**/.expo/**",
      "**/dist/**",
      "**/build/**",
      "**/coverage/**",
      "apps/mobile/scripts/**",
      "docs/**",
      "prototipo-ahk/**",
    ],
  },
  // Reglas de TypeScript para todo el monorepo
  tseslint.configs.recommended,
  {
    rules: {
      // `const { x: _x, ...resto } = obj` es la forma de quitar un campo
      "@typescript-eslint/no-unused-vars": [
        "error",
        { ignoreRestSiblings: true, varsIgnorePattern: "^_", argsIgnorePattern: "^_" },
      ],
    },
  },
  // Reglas de React Native / hooks solo para la app del celu
  {
    files: ["apps/mobile/**/*.{ts,tsx,js,jsx}"],
    extends: [expo],
    settings: {
      "import/resolver": {
        typescript: { project: "./apps/mobile/tsconfig.json" },
      },
    },
  },
);
