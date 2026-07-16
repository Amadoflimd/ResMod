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
6. [UI functionality](#ui-functionality)
7. [Project structure](#project-structure)
8. [License](#license)

---

## Overview

ResMod combines a small HTTP/HTTPS server written in Node.js with a web interface embedded in `public/index.html`. The server:

- Serves the static interface.
- Exposes a proxy at `/api/proxy` that forwards requests to the chosen destination.
- Exposes a health endpoint at `/api/health`.

The interface lets you configure HTTP methods, URL, headers, query parameters, body, and authentication, and keeps a local history of up to 100 requests.

---

## Requirements

- [Node.js](https://nodejs.org/) `>= 18.0.0`.
- A modern web browser.

No external npm dependencies are required; it only uses Node.js built-in modules (`http`, `https`, `fs`, `path`, `url`).

---

## Installation

Clone the repository and enter the folder:

```bash
git clone https://github.com/Amadoflimd/ResMod.git
cd ResMod
```

> You don't need to run `npm install` because the project has no third-party dependencies.

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
| GET     | `/api/health`  | Returns `{ "status": "ok", "version": "1.0.0" }`.                    |
| OPTIONS | `*`            | Responds to CORS preflight requests.                                   |

### CORS

The server adds the following CORS headers to every response:

- `Access-Control-Allow-Origin: *`
- `Access-Control-Allow-Methods: GET, POST, PUT, PATCH, DELETE, OPTIONS`
- `Access-Control-Allow-Headers: Content-Type`

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

## UI functionality

### Top bar

- **Logo**: identifies the application as ResMod.
- **+ New Request**: clears all fields to start a new request.
- **Clear History**: removes the history stored in the browser.

### Request panel

- **HTTP Method**: choose between `GET`, `POST`, `PUT`, `PATCH`, `DELETE`, `HEAD`, `OPTIONS`.
- **URL**: text field with autocomplete disabled. If no protocol is provided, `https://` is automatically prepended.
- **Timeout (ms)**: maximum wait time, between 500 ms and 300 000 ms (default 30 000 ms).
- **Follow Redirects**: enables or disables HTTP/HTTPS redirect following.

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

### History sidebar

- Stores up to 100 requests in the browser's `localStorage` under the key `resmod_history`.
- Each entry shows the method, URL, and status code.
- Clicking an entry restores the full request and its response.
- The **Clear History** button removes all stored history.

### Other UX details

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
├── server.js               # Node.js server and proxy
├── package.json            # Project configuration and scripts
├── README.md               # This file
├── .gitignore              # Ignores unnecessary files
└── base64_encoder.py       # Utility to encode credentials in Base64
```

---

## License

This project is licensed under the [GNU Affero General Public License v3.0 (AGPL-3.0)](LICENSE).
