# Server vs. Client Start Order & Build Artifacts

Summary of two common questions about the FAIS server and client setup.

---

## 1. Should you start the server first or the client?

**Start the server first, then the client.**

- The client typically calls the server on load (auth, config, data). If the server isn’t running, those requests fail or show errors until it’s up.
- With the server already listening, the client’s first requests succeed instead of hitting connection refused or timeouts.
- Debugging is simpler when the API is known to be available before using the app.

**Recommended order:** run `server:start` (or `server:dev`), then `client:start`.

---

## 2. When you start the client, are artifacts copied to the server’s `dist` folder?

**No.** In this project, client artifacts are not copied into the server’s `dist` folder.

- **`client:start`** runs `ng serve` (Angular dev server). It serves the app from memory and does not write build output to the server’s `dist` (or anywhere for production use).
- **`client:build`** runs `ng build` and writes output to the **client’s** build directory (e.g. under `client/`). There is no script or config that copies that output into `server/dist`.
- The server compiles its own TypeScript into `server/dist` and does not serve static client files (no `express.static()` for the Angular app).

So start order does not affect “client artifacts in server dist”—they are never placed there in the current setup. To have the server serve the Angular app in production, you’d add a step that copies the client build into something like `server/dist/public` and serve it with `express.static()`.
