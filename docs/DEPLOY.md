# Deploying AgentSpend

These steps need your own accounts, so only you can do them. Never paste a key or
password into a chat, a commit, or the README. Put them only in the place each step says.

Free plans and model names change, so check each site's current details.

## 1. Database: Neon

1. Create a free account and project at [neon.com](https://neon.com).
2. Copy the connection string. It looks like `postgresql://...neon.tech/...?sslmode=require`.

The app creates its own tables and turns on `pgvector` the first time it starts.

## 2. AI model: Gemini (or another OpenAI-compatible API)

1. Create an API key at [Google AI Studio](https://aistudio.google.com).
2. Note the values you need:
   - `LLM_BASE_URL`: `https://generativelanguage.googleapis.com/v1beta/openai`
   - `LLM_MODEL`: a current chat model from Google's model list
   - `EMBEDDING_MODEL`: a current embedding model from the same list

The app stores 768-number embeddings and asks the provider for that size. If a model
returns another size, the app reports a clear error, so choose one that supports 768.

## 3. Hosting: Render

1. Merge this branch into `main`, or select this branch in Render.
2. At [render.com](https://render.com), choose **New > Blueprint** and select this repository.
   Render reads `render.yaml`.
3. Enter the values from steps 1 and 2 when asked. Render creates `JWT_SECRET` for you.
4. Open the address Render gives you, and check that `/api/health` shows your cloud model.

On the free plan the app sleeps after 15 minutes without visitors, and the next visit waits
about a minute. Open it yourself before showing it to anyone.

## 4. Make an arbiter

Disputes need an arbiter, and no web page can grant that role, on purpose.

1. Register an account for the arbiter in the live app.
2. On your computer, temporarily set `DATABASE_URL` in `server/.env` to the Neon string.
3. Run this, using that account's email:

```bash
cd server
npm run make-arbiter -- arbiter@example.com
```

4. Remove `DATABASE_URL` from `server/.env`, so local development can't touch live data.

## 5. Smart contract: Base Sepolia test network

Use a **new wallet that only ever holds test money**. Never use a wallet with real funds.

1. Create the new wallet and copy its private key.
2. Get free test ETH from a faucet listed in the
   [Base docs](https://docs.base.org/get-started/get-funds).
3. Save the key in Hardhat's encrypted store and deploy:

```bash
cd contracts
npx hardhat keystore set TESTNET_PRIVATE_KEY
```

```bash
npx hardhat ignition deploy ignition/modules/AgentSpendEscrow.ts --network baseSepolia
```

4. Find the contract address it prints on [Base Sepolia's explorer](https://sepolia.basescan.org),
   and add that link to the README.
