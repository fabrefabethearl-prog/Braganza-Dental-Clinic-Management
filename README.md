# Braganza Dental Clinic

Clinic management web app with a Node.js HTTP API and a single-file browser front end.
The server stores all application data, accounts, sessions, and audit entries in SQLite.

## Requirements

- Node.js 20 or newer
- npm

## Local setup

```powershell
npm ci
Copy-Item .env.example .env
# Edit .env and set ADMIN_PASSWORD to a unique password with at least 12 characters
npm start
```

Open <http://127.0.0.1:4400>. The first start creates the SQLite database and schema
automatically, then seeds the clinic defaults and first administrator. Set a unique
`ADMIN_PASSWORD` in `.env` before real use. Change an existing password with:

```powershell
npm run set-password -- admin your-new-password
```

On macOS/Linux, use `cp .env.example .env` to copy the environment file. `start.bat` and
`start.sh` remain available for local use.

## Configuration

| Variable | Purpose | Default |
| --- | --- | --- |
| `HOST` | Address the HTTP server binds to (production always binds to `0.0.0.0`) | `127.0.0.1` locally |
| `PORT` | HTTP port; Render supplies this automatically | `4400` |
| `DATA_DIR` | Local data and backup directory | `data` |
| `SQLITE_PATH` | SQLite file path; takes precedence over `DATA_DIR` | `data/braganza-clinic.sqlite` |
| `SESSION_COOKIE` | Session cookie name | `bdc_session` |
| `SESSION_TTL_HOURS` | Sliding session lifetime | `12` |
| `SESSION_SECURE` | Add the cookie `Secure` attribute | `false` locally |
| `LOGIN_MAX_ATTEMPTS` | Failed login attempts per IP/login window | `8` |
| `LOGIN_WINDOW_MINUTES` | Login throttling window | `10` |
| `MAX_BODY_BYTES` | Maximum request body size | `8388608` |
| `TRUSTED_ORIGINS` | Optional comma-separated allowed origins | empty |
| `ADMIN_USERNAME` | Username created on first start | `admin` |
| `ADMIN_PASSWORD` | First administrator password; required for a new database (12+ characters) | unset |
| `ADMIN_EMAIL` | Email for the first administrator | `Demo@braganzadental.ph` |
| `ADMIN_NAME` | Display name for the first administrator | `Demo acc` |
| `ADMIN_DOCTOR_ID` | Doctor record linked to the first administrator | `DR-01` |
| `FIREBASE_API_KEY` | Firebase web-app API key (public client configuration) | unset |
| `FIREBASE_AUTH_DOMAIN` | Firebase Authentication domain | unset |
| `FIREBASE_PROJECT_ID` | Firebase project ID | unset |
| `FIREBASE_APP_ID` | Firebase web app ID | unset |
| `FIREBASE_SERVICE_ACCOUNT_JSON` | Private Firebase Admin service-account JSON | unset |
| `OTP_SECRET` | Private HMAC key (at least 32 bytes) used to hash OTPs and destinations | required for OTP |
| `OTP_EXPIRY_MINUTES` | OTP validity period | `5` |
| `OTP_RESEND_SECONDS` | Minimum delay between codes sent to one address/number | `60` |
| `OTP_RATE_WINDOW_MINUTES` | OTP request rate-limit window | `15` |
| `OTP_DESTINATION_LIMIT` | Maximum code requests per address/number per window | `5` |
| `OTP_IP_LIMIT` | Maximum OTP requests per client IP per window | `12` |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE` | SMTP server settings for Gmail verification messages | unset, `587`, `false` |
| `SMTP_USER`, `SMTP_PASSWORD`, `SMTP_FROM` | SMTP credentials and verified sender address | unset |
| `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN` | Twilio credentials for SMS delivery | unset |
| `TWILIO_FROM_NUMBER` | Twilio SMS-capable sending number in E.164 format | unset |

Relative `SQLITE_PATH` and `DATA_DIR` paths resolve from the project directory. Keep the
database outside temporary directories. The database uses SQLite WAL mode and foreign-key
enforcement; write operations use parameterized statements and transactions.

## Database

`server/db/sqlite.js` opens the configured SQLite file. On startup, `server/db/migrate.js`
applies `server/db/schema.sql` and tracks incremental migrations through schema version 3.
Tables include:

- `patients`, `doctors`, `appointments`, `treatments`, `invoices`, `prescriptions`,
  `inventory`, `procedures`, `threads`, and `notifications`
- `settings`, `counters`, `users`, `sessions`, `audit_log`, and `schema_migrations`

Collection rows retain indexed relational columns plus the full JSON record, preserving
nested front-end data and list order. Foreign keys protect account sessions and clinic
relationships. Indexes support common lookups, sorting, and filtering. The database is
created if missing; no external database service or manual schema setup is required.
Schema version 2 adds identity links and optional phone/profile columns. Schema version 3
adds hashed, expiring OTP challenges and persistent rate-limit buckets.

## Authentication

The sign-in screen supports password login, Google sign-in through Firebase, and
server-verified one-time codes sent to Gmail addresses or international E.164 phone
numbers. OTPs are generated and validated on the server, stored only as keyed hashes, and
never returned to the browser. Codes expire after five minutes by default, resend attempts
are rate-limited per destination and IP, and each code allows at most five guesses.

Configure SMTP and/or Twilio plus a stable random `OTP_SECRET` to enable delivery. If no
provider is configured, its OTP channel is disabled and the password/Google options remain
available. An administrator must create a user account before the person can sign in.
Google and OTP verification only link to an existing account with a matching email or
phone; they do not create accounts. New accounts default to the Receptionist role unless
an administrator selects another authorized role.

For Google sign-in, configure Firebase Authentication's Google provider, the web settings,
and the private Firebase Admin service-account JSON. For SMS, a Twilio account and an
SMS-capable number are required; provider charges and region restrictions may apply.

### Role-based access

Only authenticated Administrators can use the **Create Account** action or access account
creation, clinic settings, reports, audit, statistics, and backup APIs. Account creation
requires a name, username, email, password, and role; an E.164 phone number is optional.
Passwords must be at least eight characters. The account is active immediately and can
sign in with its username/email and password, Google identity, or a matching OTP identity.

Dashboard navigation is role-specific, and the server enforces the same policy for APIs.
Dentists can access clinical records and billing; Dental Hygienists and Dental Assistants
can access patient, appointment, treatment, and prescription workflows; Receptionists can
access patient, appointment, and billing workflows; other staff use the limited patient
and appointment workspace. Provider directories are readable for scheduling but can only
be managed by Administrators. State snapshots returned to staff contain only their
permitted collections, and staff snapshot updates cannot overwrite administrator-only
data.

The authenticated `GET /api/backup` endpoint downloads a JSON state snapshot. Use the
front-end restore action to load that snapshot into a new installation. User accounts and
active sessions are intentionally not part of the state snapshot; configure a new
administrator password on the destination.

## Render deployment

The included `render.yaml` defines a Node web service and a 1 GB persistent disk mounted at
`/var/data`. The service sets `SQLITE_PATH=/var/data/braganza-clinic.sqlite`, binds to
`0.0.0.0`, enables secure session cookies, and uses `/api/health` for health checks.

1. Push this project to a Git provider supported by Render.
2. In Render, choose **New → Blueprint** and select the repository.
3. Configure the Firebase, SMTP, and/or Twilio environment variables described above in the
   Blueprint prompts (or later in the Render dashboard). Set `ADMIN_PASSWORD` to the password
   you want to use for the first administrator; it must be at least 12 characters. Keep this
   value unchanged to retain the same configured password, and keep the generated `OTP_SECRET`
   stable across deployments.
4. Apply the Blueprint. Wait for deployment to pass its `/api/health` check, then open the Render URL and
   sign in with the configured administrator credentials.
5. To carry over clinic records from an existing installation, download its authenticated
   JSON backup and restore it from the destination app's Settings. Keep the export private
   because it contains clinic data.

The persistent disk is required: Render's ordinary service filesystem is ephemeral. This
SQLite deployment is intended for one web-service instance; do not scale it horizontally.
Back up the data separately using the application's JSON export before disk maintenance or
other operational changes.

## Commands

```sh
npm ci
npm start
npm run build
npm test
npm run set-password -- admin your-new-password
npm run approve-user -- user@example.com
```

There is no front-end compilation step; `npm run build` performs a server-entry syntax
check. `npm test` runs the end-to-end HTTP, authentication, validation, CRUD, and restart
durability checks against an isolated temporary SQLite database.

## API

All endpoints return JSON and require an authenticated session except where noted.

| Method | Path | Purpose |
| --- | --- | --- |
| POST | `/api/auth/login` | Sign in (public) |
| GET | `/api/auth/config` | Public Firebase web configuration/status |
| POST | `/api/auth/firebase` | Exchange a verified Firebase token for an app session (public) |
| POST | `/api/auth/logout` | Sign out |
| GET | `/api/auth/session` | Current user or `null` (public) |
| POST | `/api/auth/password` | Change password and revoke sessions |
| GET | `/api/health` | Health check (public) |
| POST | `/api/admin/accounts` | Create an account (Administrator only) |
| GET | `/api/state` | Role-scoped clinic snapshot |
| PUT / POST | `/api/state` | Replace permitted snapshot collections |
| GET / POST | `/api/{collection}` | List/create records permitted for the user's role |
| GET / PUT / PATCH / DELETE | `/api/{collection}/{id}` | Read/update/delete role-permitted records |
| GET / PATCH | `/api/settings` | Clinic settings (Administrator only) |
| GET / PATCH | `/api/counters` | ID counters (Administrator only) |
| GET | `/api/stats` | Collection counts (Administrator only) |
| GET | `/api/audit` | Recent audit entries (Administrator only) |
| GET | `/api/backup` | Download a JSON state snapshot (Administrator only) |

Collections: `patients`, `doctors`, `appointments`, `treatments`, `invoices`,
`prescriptions`, `inventory`, `procedures`, `threads`, and `notifications`.

## Security

Passwords are hashed with scrypt and a per-user salt and checked in constant time. Sessions
are stored server-side and referenced by HttpOnly, SameSite=Strict cookies. Login attempts
are rate-limited; mutating requests are checked for allowed origins; request bodies are
size-capped; and writes are recorded in `audit_log`. Never commit `.env` or database files.

## Phone OTP and Google sign-in

The login screen retains administrator username/password sign-in and adds phone OTP and
Google sign-in/sign-up. Both identity methods use Firebase Authentication; the browser sends
the resulting ID token to the server, which verifies it using the Firebase Admin SDK before
creating the existing SQLite-backed session cookie. OTP codes and Firebase tokens are not
stored in SQLite. Firebase supplies phone verification expiry, reCAPTCHA, and SMS abuse
protections; the app adds a resend countdown and a five-attempt UI limit. Firebase quotas
and rate limits also apply.

### Firebase project setup

1. Create a Firebase project and register a Web App in Project settings.
2. In **Authentication → Sign-in method**, enable **Phone** and **Google**. Configure the
   SMS region policy and check the project's current quotas and billing requirements.
3. Add `localhost` for local testing and the exact Render hostname to Firebase's authorized
   domains. Complete the Google provider setup in Firebase.
4. Copy the Web App's API key, Auth domain, Project ID, and App ID into the matching
   `FIREBASE_*` variables in local `.env` or the Render service environment.
5. Create a Firebase Admin service-account key for the same project and put its complete
   JSON in `FIREBASE_SERVICE_ACCOUNT_JSON`. Keep this private value only in the ignored
   local `.env` or Render secret environment settings; never put it in browser code, Git,
   or a Blueprint literal. Revoke and rotate the key if exposed.
6. Restart/redeploy and confirm the sign-in options appear on the login screen. Production
   phone auth requires HTTPS (Render provides it), Firebase reCAPTCHA/authorized domains,
   and may require a billing-enabled Firebase project. **Do not assume SMS OTP is free**;
   verify current pricing and quotas for the countries you serve.

Until all Firebase variables are configured, phone and Google options remain unavailable
and password login continues to work. Real SMS delivery and Google OAuth cannot be tested
without configuring a Firebase project and its provider settings.

### Account provisioning

Create each user from the Administrator dashboard before sharing sign-in instructions.
For Google sign-in, the user's verified Google email must match the email on the provisioned
account. For email or SMS OTP, the verified Gmail address or international phone number
must match the account. Unknown identities are rejected and do not create local accounts.
The Render Blueprint includes Firebase variable prompts; the Firebase Admin service-account
JSON must be entered as a secret and must never be committed.
