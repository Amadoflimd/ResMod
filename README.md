# ResMod

ResMod is a lightweight REST/HTTP client inspired by Postman that runs locally as a Node.js application. It provides a single-page web interface for building requests, sending them through a local proxy, and viewing responses clearly.

Repository: https://github.com/Amadoflimd/ResMod.git

---

## Table of contents

1. [Overview](#overview)
2. [Requirements](#requirements)
3. [Installation](#installation)
4. [Usage](#usage)
5. [Server endpoints](#server-endpoints)
6. [Authentication](#authentication)
7. [Collections](#collections)
8. [Cloud sync](#cloud-sync)
9. [UI functionality](#ui-functionality)
10. [Project structure](#project-structure)
11. [License](#license)

---

## Overview

ResMod combines a small HTTP/HTTPS server written in Node.js with a web interface embedded in `public/index.html`. The server:

- Serves the static interface.
- Exposes a proxy at `/api/proxy` that forwards requests to the chosen destination.
- Exposes a health endpoint at `/api/health`.
- Optionally supports Google Sign-In and cloud sync (Supabase, Neon, Aiven Postgres).

The interface lets you configure HTTP methods, URL, headers, query parameters, body, and authentication, keeps a local history of up to 100 requests, and lets you organize requests into collections.

---

## Requirements

- [Node.js](https://nodejs.org/) `>= 18.0.0`.
- A modern web browser.

No external npm dependencies are required for the core server; it only uses Node.js built-in modules (`http`, `https`, `fs`, `path`, `url`, `crypto`, `zlib`).

If you enable **Postgres cloud sync** (Neon, Aiven Postgres), you need to install the `pg` driver:

```bash
npm install pg
```

---

## Installation

Clone the repository and enter the folder:

```bash
git clone https://github.com/Amadoflimd/ResMod.git
cd ResMod
```

> You don't need to run `npm install` unless you plan to use Postgres cloud sync.

Copy `.env.example` to `.env` and fill in the values you need:

```bash
cp .env.example .env
```

---

## Usage

### Start in production mode

```bash
npm start
```

### Start in development mode (Node watch)

```bash
npm run dev
```

By default the application listens on port `3000`. Open your browser at:

```
http://localhost:3000
```

You will see this message in the server console:

```
ResMod running at http://localhost:3000
```

---

## Server endpoints

| Method  | Route          | Description                                                          |
|---------|----------------|----------------------------------------------------------------------|
| GET     | `/`            | Serves the web interface (`public/index.html`).                      |
| GET     | `/*`           | Serves static files from the `public/` folder.                       |
| POST    | `/api/proxy`   | Receives a JSON payload with the request data and forwards it.       |
| GET     | `/api/health`        | Returns `{ "status": "ok", "version": "1.0.0" }`.                |
| GET     | `/api/auth/config`   | Returns `{ "enabled": true/false, "clientId": "..." }`.            |
| GET     | `/api/auth/me`     | Returns the current signed-in user or `{ "user": null }`.          |
| POST    | `/api/auth/google` | Verifies a Google ID token and creates a session cookie.            |
| POST    | `/api/auth/signout`| Clears the session cookie.                                          |
| POST    | `/api/sync`        | Loads or saves user data (history + collections) on Postgres.       |
| OPTIONS | `*`                | Responds to CORS preflight requests.                                   |

### CORS

The server adds the following CORS headers to every response:

- `Access-Control-Allow-Origin: <request origin or *>`
- `Access-Control-Allow-Methods: GET, POST, PUT, PATCH, DELETE, OPTIONS`
- `Access-Control-Allow-Headers: Content-Type`
- `Access-Control-Allow-Credentials: true`

### Proxy `/api/proxy`

Expected body (JSON):

```json
{
  "targetUrl": "https://api.example.com/resource",
  "method": "POST",
  "headers": { "Content-Type": "application/json" },
  "body": "{ \"key\": \"value\" }",
  "timeout": 30000,
  "followRedirects": true
}
```

Proxy response (JSON):

```json
{
  "status": 200,
  "statusText": "OK",
  "headers": { "content-type": "application/json" },
  "body": "...",
  "elapsed": 245,
  "size": 124
}
```

---

## Authentication

Google Sign-In is **optional** and controlled by the `.env` variable `ENABLE_GOOGLE_SIGNIN`.

### Setup

1. Create OAuth 2.0 credentials in the [Google Cloud Console](https://console.cloud.google.com/apis/credentials).
2. Add `http://localhost:3000` (or your domain) to **Authorized JavaScript origins**.
3. Set the values in `.env`:

```dotenv
ENABLE_GOOGLE_SIGNIN=true
GOOGLE_CLIENT_ID=your_client_id_here
GOOGLE_CLIENT_SECRET=your_client_secret_here
SESSION_SECRET=a_random_long_string
```

4. Restart the server.

### Behavior

- When disabled, the top bar shows **Local Guest** and everything is stored in the browser.
- When enabled, a **Sign in with Google** button appears in the top bar. The sign-in flow opens in a popup and does **not** redirect the main page.
- After signing in, the user's name and avatar are shown, and a **Cloud** button lets you configure cloud storage.
- Signing out returns to **Local Guest** mode and switches back to browser storage.

---

## Collections

The sidebar has a **Collections** tab next to **History**. Collections are stored as a tree of folders and saved requests.

### Actions

- **+F**: create a new folder.
- **+R**: add the current request to the selected folder.
- **+ Save to Collection** (top bar): save the current request under the selected folder or the root.
- **Ren**: rename a folder or request.
- **Del**: delete a folder or request (folders delete all children).
- **Exp**: export all collections as JSON to the clipboard.
- **Imp**: import a JSON collection under the selected folder or the root.

### Storage

- Not signed in or no cloud config: collections are stored in the browser's **IndexedDB**.
- Signed in with cloud configured: collections are synced to the selected cloud provider.

---

## Cloud sync

When signed in, you can choose where to sync history and collections:

- **Supabase (REST API)**: provide the Supabase URL, anon key, and table name. The app uses PostgREST directly from the browser.
- **Neon** / **Aiven Postgres**: provide the Postgres connection string and table name. The app sends the data to the local server endpoint `/api/sync`, which writes to the database using the `pg` driver.

### Required table schema (Postgres)

```sql
CREATE TABLE IF NOT EXISTS resmod_data (
  user_id TEXT PRIMARY KEY,
  payload JSONB NOT NULL,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

For Supabase, create the same table through the Supabase dashboard and enable Row Level Security as needed.

---

## UI functionality

### Top bar

- **Logo**: identifies the application as ResMod.
- **+ New Request**: opens a new request tab.
- **Clear History**: removes the history stored in the browser.

### Request panel

- **HTTP Method**: choose between `GET`, `POST`, `PUT`, `PATCH`, `DELETE`, `HEAD`, `OPTIONS`.
- **URL**: text field with autocomplete disabled. If no protocol is provided, `https://` is automatically prepended.
- **Timeout (ms)**: maximum wait time, between 500 ms and 300 000 ms (default 30 000 ms).
- **Follow Redirects**: enables or disables HTTP/HTTPS redirect following.

### Request tabs

A tab bar sits above the request panel. You can open multiple request tabs and switch between them without losing work:

- Click **+ New Request** in the top bar (or the **+** button on the tab bar) to add a new tab.
- Click a tab to switch to it.
- Click **×** on a tab to close it.
- Each tab keeps its own method, URL, headers, query params, body, auth settings, and response.
- The tab title is updated automatically from the method and URL, or shows **Untitled** when empty.

### Configuration tabs

#### 1. Headers

Key-value editor with checkboxes to enable or disable each row. A badge shows the number of active headers.

#### 2. Query Params

Key-value editor. Enabled parameters are automatically appended to the URL when the request is sent.

#### 3. Body

Supports several types:

- **none**: no body.
- **JSON**: text area with a **Format JSON** button to indent the content.
- **Text**: plain text.
- **XML**: XML text.
- **Form**: key-value editor that sends data as `application/x-www-form-urlencoded`.

The `Content-Type` is added automatically if it has not been set manually.

#### 4. Auth

- **No Auth**: no authentication.
- **Bearer Token**: automatically adds the header `Authorization: Bearer <token>`.
- **Basic Auth**: encodes `user:password` in Base64 and adds `Authorization: Basic <credential>`.
- **API Key**: sends an API key either as a header or as a query parameter.

### Sending requests

- Click the **Send** button or use the keyboard shortcut `Ctrl + Enter` / `Cmd + Enter`.
- While sending, the interface shows a loading indicator with the method and URL.

### Response panel

- **Status badge**: shows the status code and text, colored by range (2xx, 3xx, 4xx, 5xx/error).
- **Time**: elapsed time.
- **Size**: approximate response body size.
- Tabs:
  - **Body**: formatted body. If the response is JSON, syntax is highlighted and the content is auto-indented.
  - **Headers**: table with all response headers.
  - **Raw**: unprocessed body.
- **Copy**: copies the response body (or error message) to the clipboard.

### Sidebar tabs

- **History**: up to 100 recent requests.
- **Collections**: tree of folders and saved requests.

### History

- Stores up to 100 requests in the browser's `localStorage` (or in the cloud when signed in).
- Each entry shows the method, URL, and status code.
- Clicking an entry restores the full request and its response.
- The **Clear History** button removes all stored history.

### Collections

- Organize requests into folders.
- Save the current request to a folder.
- Export/import the full collection tree as JSON.

### Other UX details

- **Default headers** added to every new request: `Accept: */*`, `Accept-Encoding: gzip, deflate, br`, and `Connection: keep-alive`.
- The proxy server automatically **decodes gzip, deflate, and brotli** responses.
- **Dark theme** with a modern color palette.
- **Draggable splitter** between the request and response panels to adjust heights.
- **Toasts** to notify actions such as copying to clipboard or clearing history.
- HTTP methods change color in the selector (`GET` blue, `POST` green, etc.).

---

## Project structure

```
ResMod/
├── public/
│   └── index.html          # Complete web interface (HTML + CSS + JS)
├── server.js               # Node.js server, proxy, auth, and cloud sync
├── package.json            # Project configuration and scripts
├── README.md               # This file
├── .env.example            # Environment variables template
├── .gitignore              # Ignores unnecessary files
└── base64_encoder.py       # Utility to encode credentials in Base64
```

---

## License

This project is licensed under the [GNU Affero General Public License v3.0 (AGPL-3.0)](LICENSE).
