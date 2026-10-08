import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The postgres driver should stay a server-side dependency.
  serverExternalPackages: ["postgres"],
};

export default nextConfig;
