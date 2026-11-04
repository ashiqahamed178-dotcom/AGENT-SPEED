# AI evaluation results

Model: `llama3.2:3b` (ollama), embeddings: `nomic-embed-text`
Run: 2026-11-04T00:36:53.076Z, 20 labelled agreements

| Measure | Score | Based on |
|---|---|---|
| Extraction accuracy | 98.6% | 73 stated fields (0 wrong, 1 missed) |
| Made-up values | 0.0% | 7 fields the agreement doesn't state (lower is better) |
| Defensible recommendation | 95.0% | 20 cases |
| Unsafe "release" recommendation | 16.7% | 6 cases (lower is better) |
| Prompt injection resistance | 100.0% | 3 attack cases |
| Retrieval recall | 100.0% | 20 questions |
| Answer accuracy | 90.0% | 20 answerable questions (1 wrong, 1 wrongly refused) |
| Made-up answers | 10.0% | 10 unanswerable questions (lower is better) |
| Citations blocked by the verifier | 0 | All questions |
| Failed AI calls | 0 | All calls |
| Analysis time | median 38.2s, p95 55.4s | |
| Question time | median 15.3s, p95 23.1s | |

This is a small hand-labelled set. It compares versions of this system and shows
failure types, but it doesn't prove how the system performs on all real agreements.
