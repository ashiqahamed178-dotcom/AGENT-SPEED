// Gives an existing account the arbiter role: npm run make-arbiter -- someone@example.com
// There is no API for this on purpose, so nobody can make themselves an arbiter.
import { db } from "../db";

async function main() {
  const email = process.argv[2]?.trim().toLowerCase();

  if (!email) {
    throw new Error("Usage: npm run make-arbiter -- someone@example.com");
  }

  const result = await db.query(
    "UPDATE users SET role = 'arbiter' WHERE email = $1 RETURNING id",
    [email]
  );

  if (result.rows.length === 0) {
    throw new Error(`No account found for ${email}.`);
  }

  console.log(`${email} is now an arbiter.`);
}

main()
  .then(() => process.exit(0))
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
