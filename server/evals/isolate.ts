// Must be imported first. It forces the temporary in-memory database, so an
// evaluation can never write to real data, even when .env points at Neon.
process.env.NODE_ENV = "test";
process.env.DATABASE_URL = "";
