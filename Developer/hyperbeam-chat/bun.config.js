// Bun configuration for HyperBEAM Chat
export default {
  // Development server configuration
  dev: {
    port: process.env.PORT || 3000,
    host: process.env.HOST || "localhost"
  },
  
  // Static file serving
  static: {
    directory: process.cwd(),
    fallback: "index.html" // SPA fallback
  },
  
  // CORS configuration for HyperBEAM integration
  cors: {
    origin: "*",
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    headers: ["Content-Type", "Authorization", "Cookie"]
  }
};