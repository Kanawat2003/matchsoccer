# PorsBall ⚽

PorsBall is a football-field booking web application prototype focused on making it easy to find a field, book in real time, create matches, find teammates, and split the cost with players.

## Highlights

- Nearby football-field search with field-type and roof filters
- Real-time hourly availability and booking validation
- Match creation from confirmed bookings
- Find teammates / join and leave matches
- Automatic split-payment flow with share links
- Player points, wins, losses, and match statistics
- Notifications and session handling
- Owner dashboard for venues, bookings, status, and revenue
- Admin dashboard for users, roles, venue ownership, and bookings
- Responsive UI for desktop and mobile

## Tech stack

- Frontend: React 19 + TypeScript + Vite
- Backend: Node.js + Express
- Database: SQLite (better-sqlite3)
- Authentication: JWT + bcryptjs
- Development: VS Code

## Project structure

```text
porsball/
├─ client/    # React + TypeScript frontend
└─ server/    # Express API + SQLite backend
```

## Run locally

### Frontend

```bash
cd client
npm install
npm run dev
```

The development frontend runs at `http://localhost:5173`.

### Backend

```bash
cd server
npm install
npm start
```

The API runs at `http://127.0.0.1:4001`.

## Project status

This repository contains the current PorsBall development version and is being actively improved and tested.

> Note: local SQLite data, environment files, dependencies, build output, and temporary development files are intentionally excluded from Git.
