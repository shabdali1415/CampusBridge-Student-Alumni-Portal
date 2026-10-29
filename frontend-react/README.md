# CampusBridge React frontend

This React + TypeScript frontend uses the existing Express/MySQL API and keeps the original `client/` frontend available as a fallback. It includes sign-in/register/reset-password, event discovery and registration/cancellation, registration list, alumni directory and connection requests, job search/applications and alumni job posting, campus news, profile editing, and admin event creation, user management, alumni approvals, analytics, and QR ticket check-in.

## Run locally (two terminals)

Terminal 1, from the project root:

```powershell
npm install
Copy-Item .env.example .env   # only if .env does not already exist
npm run dev
```

Ensure MySQL is running and `.env` has correct DB settings. Backend: `http://localhost:5000`.

Terminal 2:

```powershell
cd frontend-react
npm install
npm run dev
```

Open `http://localhost:5173`. Vite proxies `/api`, `/uploads`, and Socket.IO requests to the backend on port 5000.

## Build React and serve from Express

```powershell
cd frontend-react
npm run build
cd ..
npm run dev
```

When `frontend-react/dist/index.html` exists, Express serves the built React app at `http://localhost:5000`. If no build exists, Express continues to serve the original `client/` pages. The API remains under `/api` in either mode.

## Notes

- The API enforces role, email-verification, and alumni-approval restrictions; the UI does not bypass these rules.
- If SMTP is not configured, local verification/reset links are printed in the backend terminal.
- Keep `.env` private and never include real secrets in the ZIP or source control.
