import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // sharp is a native module — must NOT be bundled by webpack
  serverExternalPackages: ["sharp"],
  async headers() {
    return [
      {
        source: "/convert",
        headers: [
          { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
          { key: "Cross-Origin-Embedder-Policy", value: "require-corp" },
        ],
      },
    ];
  },
};

export default nextConfig;
