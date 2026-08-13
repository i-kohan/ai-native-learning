# ai-native-learning

Capstone harness for learning AI-native / agentic software engineering.

## Quick start

1. Copy env and fill credentials:

```bash
cp .env.example .env
# OPENAI_API_KEY=...
# OPENAI_MODEL=...
```

2. Install and run deterministic checks:

```bash
npm install --prefix target-app
npm install --prefix harness
npm test
```

3. Run a benchmark task:

```bash
npm run benchmark --prefix harness -- T01
```

Learning docs: `docs/learning/`.
