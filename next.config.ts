import path from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  turbopack: {
    // Pin the workspace root to this directory. Without it, Turbopack walks up
    // the filesystem looking for a lockfile and can settle on an unrelated one
    // in a parent directory, which changes how modules resolve.
    root: path.resolve(import.meta.dirname),
  },
};

export default nextConfig;
