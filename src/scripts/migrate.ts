/**
 * Master Admin no longer owns database migrations. The schema lives in the shared ecosystem
 * database project (../../database/migrations). This command exists only to say so.
 */
console.error(
  [
    "Master Admin does not run its own migrations any more.",
    "The schema is managed in the shared database project:",
    "  ../../database/migrations   (apply & verify with ../../database/check.sh)",
    "See backend/migrations/README.md.",
  ].join("\n")
);
process.exit(1);
