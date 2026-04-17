import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  serverExternalPackages: ["postgres", "pg-boss", "playwright"],
};

export default nextConfig;
