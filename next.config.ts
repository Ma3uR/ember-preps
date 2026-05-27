import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Keep the MCP SDK out of the Next.js bundler — its deep ESM `.js`
  // imports (NodeNext) don't survive bundling. Treating it as external
  // lets Node resolve it at runtime in the server build.
  serverExternalPackages: ["@modelcontextprotocol/sdk"],
};

export default nextConfig;
