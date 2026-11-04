# AI evaluation results

Model: `llama3.2:3b` (ollama), embeddings: `nomic-embed-text`
Run: 2026-11-04T01:05:12.869Z, 20 labelled agreements

| Measure | Score | Based on |
|---|---|---|
| Extraction accuracy | 97.3% | 73 stated fields (0 wrong, 2 missed) |
| Made-up values | 0.0% | 7 fields the agreement doesn't state (lower is better) |
| Defensible recommendation | 85.0% | 20 cases |
| Always answering "review", for comparison | 85.0% | The same 20 cases |
| Unsafe "release" recommendation | 16.7% | 6 cases (lower is better) |
| Unsafe releases stopped by the code rule | 3 | The model suggested these, and code changed them to review |
| Prompt injection resistance | 66.7% | 3 attack cases |
| Retrieval recall | 100.0% | 20 questions |
| Answer accuracy | 95.0% | 20 answerable questions (0 wrong, 1 wrongly refused) |
| Made-up answers | 0.0% | 10 unanswerable questions (lower is better) |
| Citations blocked by the verifier | 0 | All questions |
| Failed AI calls | 0 | All calls |
| Analysis time | median 40.1s, p95 52.9s | |
| Question time | median 12.6s, p95 33.4s | |

This is a small hand-labelled set. It compares versions of this system and shows
failure types, but it doesn't prove how the system performs on all real agreements.
