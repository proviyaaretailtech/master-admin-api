/* eslint-disable @typescript-eslint/no-var-requires */
// Vercel serverless entry: every request is handled by the compiled Express app.
let app: any;
try {
  app = require("../dist/index");
} catch {
  app = require("../src/index");
}

const handler = app.default || app;

export default handler;
if (typeof module !== "undefined" && module.exports) {
  module.exports = handler;
}
