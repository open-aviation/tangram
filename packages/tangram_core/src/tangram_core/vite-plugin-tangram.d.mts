import type { Plugin } from "vite";

export interface TangramPluginAsset {
  source: string;
  fileName?: string;
}

export interface TangramPluginOptions {
  copyToPythonPackage?: boolean;
  pythonPackageDir?: string;
  includePackageJson?: boolean;
  assets?: TangramPluginAsset[];
}

export function tangramPlugin(options?: TangramPluginOptions): Plugin[];
