# Sale Order

A sale order / dispatch management app: customer, brand, exhibition, salesman
and season masters, sale order and dispatch tracking, a dashboard, and reports.

**Stack:** React (Create React App via craco) frontend + FastAPI (Python)
backend + MongoDB. This copy has been cleaned of Emergent-platform-specific
files and dependencies — it's a plain, portable web app.

---

## 1. Prerequisites

Install these once:

- **Node.js 18+** and **Yarn** — https://nodejs.org (Yarn: `npm install -g yarn`)
- **Python 3.10+** — https://python.org
- **MongoDB** — easiest option is Docker Desktop (https://www.docker.com/products/docker-desktop),
  used below. If you'd rather not use Docker, you can install MongoDB Community
  Server directly (https://www.mongodb.com/try/download/community), or use a
  free MongoDB Atlas cluster instead (see step 2).

---

## 2. Start the database

From the project root, with Docker Desktop running:

```bash
docker compose up -d
```

This starts MongoDB on `localhost:27017` and keeps its data in a Docker
volume between restarts.

**Alternative:** if you'd rather use a free MongoDB Atlas cluster instead of
running MongoDB locally, create one at https://www.mongodb.com/cloud/atlas
and use its connection string as `MONGO_URL` in step 3 — you can skip
`docker compose` entirely in that case.

---

## 3. Configure and run the backend

```bash
cd backend
python -m venv venv

# Activate the virtual environment:
#   Windows:      venv\Scripts\activate
#   Mac/Linux:    source venv/bin/activate

pip install -r requirements.txt

# Copy the example env file and edit if needed (defaults work with the
# docker-compose MongoDB from step 2 as-is):
#   Windows:      copy .env.example .env
#   Mac/Linux:    cp .env.example .env

uvicorn server:app --reload --port 8000
```

The API is now running at `http://localhost:8000` (docs at
`http://localhost:8000/docs`).

---

## 4. Configure and run the frontend

Open a **new terminal** (keep the backend running) and:

```bash
cd frontend
yarn install

# Copy the example env file and edit if needed (defaults work as-is):
#   Windows:      copy .env.example .env
#   Mac/Linux:    cp .env.example .env

yarn start
```

The app opens at `http://localhost:3000` and talks to the backend at the
`REACT_APP_BACKEND_URL` set in `frontend/.env`.

---

## 5. Checking a change works

There is no test suite. Verification is done by running the app and using it,
and — for anything with arithmetic in it — by pulling the real function out of
the shipped file and running it against known numbers.

The parts most worth checking that way, because a wrong answer there looks
plausible rather than broken:

- dispatched value, which is computed in four separate places that must agree
- dispatches saved before amounts existed, which fall back to the order's rates
- expense summary totals, which must equal the sum of the rows they sit under

`CLAUDE.md` explains why each of those matters.

---

## Project structure

```
backend/    FastAPI app (server.py), requirements.txt
frontend/   React app (craco + Tailwind + shadcn/radix components)
memory/     Original product requirements doc (PRD.md) from the build process
docker-compose.yml   Local MongoDB for development
```

`design_guidelines.json` documents the design system (fonts, colors, spacing
rules) the UI was built against — useful reference if you extend the UI later.

---

## Deploying / hosting

Nothing in this codebase is tied to a specific hosting provider — it's a
standard React static build + a FastAPI service + MongoDB. Once you've
confirmed it runs locally, common low-cost options are:

- **Backend + MongoDB:** Railway, Render, or Fly.io (free/low tiers available;
  MongoDB Atlas free tier works too if you don't want to self-host Mongo)
- **Frontend:** Vercel, Netlify, or Cloudflare Pages (`yarn build` produces a
  static `build/` folder)
- **Everything on one box:** a small VPS (e.g. Hetzner, DigitalOcean) running
  Docker, for full control at a flat monthly cost

Happy to help set any of these up when you're ready — just ask.
