# AI evaluation results

Model: `llama3.2:3b` (ollama), embeddings: `nomic-embed-text`
Run: 2026-11-04T01:43:24.791Z, 20 labelled agreements

| Measure | Score | Based on |
|---|---|---|
| Extraction accuracy | 97.3% | 73 stated fields (0 wrong, 2 missed) |
| Made-up values | 0.0% | 7 fields the agreement doesn't state (lower is better) |
| Defensible recommendation | 90.0% | 20 cases |
| Always answering "review", for comparison | 85.0% | The same 20 cases |
| Unsafe "release" recommendation | 0.0% | 6 cases (lower is better) |
| Unsafe releases stopped by the code rule | 4 | The model suggested these, and code changed them to review |
| Prompt injection resistance | 100.0% | 3 attack cases |
| Retrieval recall | 100.0% | 20 questions |
| Answer accuracy | 95.0% | 20 answerable questions (0 wrong, 1 wrongly refused) |
| Made-up answers | 15.4% | 13 unanswerable questions (lower is better) |
| Citations blocked by the verifier | 0 | All questions |
| Failed AI calls | 0 | All calls |
| Analysis time | median 35.6s, p95 46.3s | |
| Question time | median 12.4s, p95 20.0s | |

This is a small hand-labelled set. It compares versions of this system and shows
failure types, but it doesn't prove how the system performs on all real agreements.
