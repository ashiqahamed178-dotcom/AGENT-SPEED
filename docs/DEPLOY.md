# Deploying AgentSpend

These steps need your own accounts, so only you can do them. Never paste a key or
password into a chat, a commit, or the README. Put them only in the place each step says.

Free plans and model names change, so check each site's current details.

There are two ways to go live:

- **No AI API key (recommended):** Hugging Face runs the app and a small model together. Follow
  steps 1 and A, then 4 and 5. It's slow, because the model shares a few processors.
- **Cloud AI model:** Render runs the app and Gemini runs the model, which is much faster. It
  needs a Gemini API key. Follow steps 1 to 5.

## 1. Database: Neon

1. Create a free account and project at [neon.com](https://neon.com).
2. Copy the connection string. It looks like `postgresql://...neon.tech/...?sslmode=require`.

The app creates its own tables and turns on `pgvector` the first time it starts.

## A. Hosting without an API key: Hugging Face Spaces

GitHub Actions builds this image and asks a real question through it on each push, so the setup
is tested. It hasn't been run on Hugging Face itself until you do this.

1. Merge this branch into `main`. The image is built from `main` on GitHub.
2. Create a free account at [huggingface.co](https://huggingface.co).
3. Choose **New Space**, then **Docker** and **Blank**, with the free CPU hardware. Keep it public.
4. In the Space's **Files** tab, add two files, copying the contents from this repository:
   - [`deploy/huggingface/README.md`](../deploy/huggingface/README.md), replacing the existing `README.md`
   - [`deploy/huggingface/Dockerfile`](../deploy/huggingface/Dockerfile), named `Dockerfile`
5. In **Settings > Variables and secrets**, add two **secrets**:
   - `DATABASE_URL`: the Neon connection string
   - `JWT_SECRET`: a long random value, which this command prints:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```

6. Wait for the build, which downloads the model and can take several minutes.
7. Open the app at its direct address, `https://YOUR-NAME-SPACE-NAME.hf.space`. Logging in won't
   work inside the Hugging Face page, because the session cookie is deliberately blocked in frames.

Free Spaces sleep when nobody uses them, and the next visit has to wake up and reload the model.
Open it yourself a few minutes before showing it to anyone.

To use a newer version later, choose **Factory rebuild** in the Space's settings.

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

To grant the role on the Hugging Face version, use the same steps. The app and the command share
the Neon database.

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
