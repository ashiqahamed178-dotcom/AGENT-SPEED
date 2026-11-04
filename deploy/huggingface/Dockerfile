# Runs AgentSpend and its AI model together in one container, so no AI API key is
# needed. Hugging Face builds this file from your Space. See docs/DEPLOY.md.
FROM node:24-slim

ARG REPO_URL=https://github.com/ashiqahamed178-dotcom/AGENT-SPEED.git
ARG BRANCH=main

RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates curl git zstd \
  && rm -rf /var/lib/apt/lists/*

RUN curl -fsSL https://ollama.com/install.sh | sh

# Saving the models in the image means a restart doesn't download them again.
ENV OLLAMA_MODELS=/opt/ollama
RUN mkdir -p /opt/ollama \
  && (ollama serve & OLLAMA_PID=$! \
      && until curl -fsS http://127.0.0.1:11434/api/version > /dev/null; do sleep 1; done \
      && ollama pull llama3.2:3b \
      && ollama pull nomic-embed-text \
      && kill $OLLAMA_PID) \
  && chmod -R a+rX /opt/ollama

RUN git clone --depth 1 --branch "$BRANCH" "$REPO_URL" /app

WORKDIR /app/client
RUN npm ci && npm run build && rm -rf node_modules

WORKDIR /app/server
RUN npm ci && npm run build && npm prune --omit=dev

# Hugging Face runs containers as user 1000, which is "node" in this image.
RUN chown -R node /opt/ollama
USER node

ENV NODE_ENV=production
ENV PORT=7860
ENV LLM_PROVIDER=ollama
# Slow shared processors need longer, and keeping the model loaded saves time.
ENV LLM_TIMEOUT_MS=600000
ENV OLLAMA_KEEP_ALIVE=-1
EXPOSE 7860

CMD ["sh", "-c", "ollama serve & until curl -fsS http://127.0.0.1:11434/api/version > /dev/null; do sleep 1; done; exec node dist/index.js"]
