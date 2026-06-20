import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // sharp is a native module — must NOT be bundled by webpack
  serverExternalPackages: ["sharp"],
  async headers() {
    return [
      {
        // COOP + COEP required for SharedArrayBuffer (FFmpeg WASM)
        // NEXT_DISABLE_TURBOPACK=1 must be set in Vercel env to avoid
        // turbopack worker COEP conflict (webpack build has no workers)
        source: "/convert",
        headers: [
          { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
          { key: "Cross-Origin-Embedder-Policy", value: "credentialless" },
        ],
      },
    ];
  },
};

export default nextConfig;
