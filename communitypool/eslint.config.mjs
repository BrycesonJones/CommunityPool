import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Foundry / vendor trees (not part of the Next.js app)
    "lib/forge-std/**",
    "lib/chainlink-brownie-contracts/**",
    "lib/openzeppelin-contracts/**",
    "lib/foundry-devops/**",
    // Foundry build outputs and broadcast artifacts
    "forge-out/**",
    "broadcast/**",
    "cache/**",
  ]),
]);

export default eslintConfig;
