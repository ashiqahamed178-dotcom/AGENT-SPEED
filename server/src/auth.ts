import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { Router } from "express";
import type { NextFunction, Request, Response } from "express";
import rateLimit from "express-rate-limit";
import jwt from "jsonwebtoken";
import { z } from "zod";
import { config } from "./config";
import { db } from "./db";

const scrypt = promisify(scryptCallback) as (
  password: string,
  salt: Buffer,
  keyLength: number
) => Promise<Buffer>;

const COOKIE_NAME = "agentspend_session";
const SESSION_HOURS = 24;
const KEY_LENGTH = 64;

export type User = {
  id: string;
  email: string;
  name: string;
  role: "user" | "arbiter";
};

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: User;
    }
  }
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scrypt(password, salt, KEY_LENGTH);
  return `scrypt$${salt.toString("hex")}$${key.toString("hex")}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [, saltHex, keyHex] = stored.split("$");
  if (!saltHex || !keyHex) return false;

  const expected = Buffer.from(keyHex, "hex");
  const actual = await scrypt(password, Buffer.from(saltHex, "hex"), expected.length);
  return timingSafeEqual(actual, expected);
}

// Checked when an email is unknown, so response time doesn't reveal which
// emails have accounts.
const decoyHash = hashPassword(randomBytes(16).toString("hex"));

function setSessionCookie(res: Response, userId: string) {
  const token = jwt.sign({}, config.jwtSecret, {
    algorithm: "HS256",
    subject: userId,
    expiresIn: `${SESSION_HOURS}h`
  });

  res.cookie(COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: "strict",
    secure: config.isProduction,
    maxAge: SESSION_HOURS * 60 * 60 * 1000,
    path: "/"
  });
}

// The user is reloaded on every request, so role changes apply immediately.
export async function requireAuth(req: Request, res: Response, next: NextFunction) {
  const token: unknown = req.cookies?.[COOKIE_NAME];

  if (typeof token === "string") {
    try {
      const payload = jwt.verify(token, config.jwtSecret, { algorithms: ["HS256"] });
      const userId = typeof payload === "string" ? undefined : payload.sub;

      if (userId) {
        const result = await db.query<User>(
          "SELECT id, email, name, role FROM users WHERE id = $1",
          [userId]
        );
        req.user = result.rows[0];
      }
    } catch (error) {
      if (!(error instanceof jwt.JsonWebTokenError)) throw error;
    }
  }

  if (!req.user) {
    return res.status(401).json({ error: "Please log in to continue." });
  }

  return next();
}

const CredentialsSchema = z.object({
  email: z.string().trim().toLowerCase().pipe(z.email()),
  password: z.string().min(1).max(200)
});

const RegisterSchema = z.object({
  email: z.string().trim().toLowerCase().pipe(z.email()),
  name: z.string().trim().min(1).max(100),
  password: z.string().min(10, "Use at least 10 characters.").max(200)
});

const router = Router();

router.use(
  rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 30,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    skip: () => config.isTest,
    message: { error: "Too many attempts. Please try again later." }
  })
);

router.post("/register", async (req, res) => {
  const parsed = RegisterSchema.safeParse(req.body);

  if (!parsed.success) {
    return res.status(400).json({
      error: "Invalid registration details.",
      details: parsed.error.flatten()
    });
  }

  const { email, name, password } = parsed.data;
  const passwordHash = await hashPassword(password);

  const result = await db.query<User>(
    `INSERT INTO users (email, name, password_hash)
     VALUES ($1, $2, $3)
     ON CONFLICT (email) DO NOTHING
     RETURNING id, email, name, role`,
    [email, name, passwordHash]
  );

  const user = result.rows[0];

  if (!user) {
    return res.status(409).json({ error: "An account with this email already exists." });
  }

  setSessionCookie(res, user.id);
  return res.status(201).json(user);
});

router.post("/login", async (req, res) => {
  const parsed = CredentialsSchema.safeParse(req.body);

  if (!parsed.success) {
    return res.status(400).json({ error: "Please enter your email and password." });
  }

  const result = await db.query<User & { password_hash: string }>(
    "SELECT id, email, name, role, password_hash FROM users WHERE email = $1",
    [parsed.data.email]
  );

  const row = result.rows[0];
  const passwordMatches = await verifyPassword(
    parsed.data.password,
    row?.password_hash ?? (await decoyHash)
  );

  if (!row || !passwordMatches) {
    return res.status(401).json({ error: "Incorrect email or password." });
  }

  setSessionCookie(res, row.id);

  const { password_hash: _passwordHash, ...user } = row;
  return res.json(user);
});

router.post("/logout", (_req, res) => {
  res.clearCookie(COOKIE_NAME, { path: "/" });
  return res.status(204).end();
});

router.get("/me", requireAuth, (req, res) => {
  return res.json(req.user);
});

export default router;
