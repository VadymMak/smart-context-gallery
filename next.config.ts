import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // sharp is a native module — must NOT be bundled by webpack
  serverExternalPackages: ["sharp"],
};

export default nextConfig;
