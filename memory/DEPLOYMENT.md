# CityPark Audit — Deployment Spec & Infrastructure Reference

Live production deployment on AWS (account `516887748193`, region `ap-south-1`) + MongoDB Atlas.
No custom domain wired up yet — using default AWS/S3 URLs.

## Live URLs

| Component | URL |
|---|---|
| Frontend (web) | http://citypark-audit-frontend-516887748193-ap-south-1.s3-website.ap-south-1.amazonaws.com |
| Backend API | https://ub8pyznzb7.execute-api.ap-south-1.amazonaws.com |

Actual secret values (passwords, keys, connection strings) are **not** in this file or in git —
see the separate credentials note delivered directly to the account owner. This file only
documents *structure*: resource names, IDs, and how to change things.

---

## Architecture

```
Browser
  │
  ├── GET/static assets ──────────────► S3 static website hosting
  │                                     bucket: citypark-audit-frontend-516887748193-ap-south-1
  │                                     (Expo web export, built via `npm run export:web`,
  │                                      which also injects PWA <head> tags - see Gotcha #6)
  │
  └── fetch('EXPO_PUBLIC_BACKEND_URL/api/...')
                │
                ▼
      API Gateway HTTP API (ub8pyznzb7)
      route: $default  →  AWS_PROXY integration  →  Lambda
                │
                ▼
      Lambda function: citypark-audit-backend
      runtime: python3.11, handler: lambda_handler.handler
      (backend/lambda_handler.py wraps backend/server.py's FastAPI app with Mangum)
                │
                ▼
      MongoDB Atlas — cluster0.ssbdzsy.mongodb.net
      db: citypark_audit, user: Citypark_app

      (Gemini API called directly from Lambda for POST /api/audits/{id}/summary,
       not through any AWS service — needs GEMINI_API_KEY env var)
```

`backend/server.py` is the single source of truth for the API and is shared by two possible
deployment paths:
- **Lambda + API Gateway** (what's live now) via `backend/lambda_handler.py`
- **Docker + App Runner/ECS** (built, not currently deployed — see "Alternate Docker path" below)

---

## AWS resource inventory

| Resource | Name / ID | ARN | Purpose |
|---|---|---|---|
| Lambda function | `citypark-audit-backend` | `arn:aws:lambda:ap-south-1:516887748193:function:citypark-audit-backend` | Runs the FastAPI backend |
| IAM role (Lambda exec) | `citypark-audit-lambda-role` | `arn:aws:iam::516887748193:role/citypark-audit-lambda-role` | Lambda execution role; has `AWSLambdaBasicExecutionRole` (CloudWatch Logs only) |
| API Gateway HTTP API | `ub8pyznzb7` | `arn:aws:execute-api:ap-south-1:516887748193:ub8pyznzb7` | Public HTTPS entrypoint, `$default` route → Lambda proxy, payload format v2.0 |
| Lambda permission | statement id `apigw-invoke-v2` | — | Grants `ub8pyznzb7/*` permission to invoke the Lambda. **Must use HTTP-API-style source ARN** (`{api-id}/*`), not the REST-API `{api-id}/*/*/{proxy+}` pattern — the latter silently fails to authorize (see Gotchas) |
| S3 bucket (frontend) | `citypark-audit-frontend-516887748193-ap-south-1` | `arn:aws:s3:::citypark-audit-frontend-516887748193-ap-south-1` | Static website hosting for the Expo web build; public-read bucket policy, `index.html` as both index and error document (SPA routing) |
| S3 bucket (source/build artifacts) | `citypark-audit-src-516887748193-ap-south-1` | `arn:aws:s3:::citypark-audit-src-516887748193-ap-south-1` | Holds `backend-src.zip` (CodeBuild source), `buildspec.yml`, `lambda-backend.zip` (Lambda deployment package) — private |
| ECR repository | `citypark-audit-backend` | `arn:aws:ecr:ap-south-1:516887748193:repository/citypark-audit-backend` | Docker image for the alternate App Runner/ECS path (built successfully, image tag `latest`) |
| CodeBuild project | `citypark-audit-backend-build` | `arn:aws:codebuild:ap-south-1:516887748193:project/citypark-audit-backend-build` | Builds `backend/Dockerfile` and pushes to ECR (used because this dev sandbox can't pull Docker Hub images directly) |
| IAM role (CodeBuild) | `citypark-audit-codebuild-role` | `arn:aws:iam::516887748193:role/citypark-audit-codebuild-role` | CodeBuild service role: CloudWatch Logs, S3 read on the source bucket, ECR push |
| IAM role (App Runner, unused) | `citypark-audit-apprunner-ecr-access` | `arn:aws:iam::516887748193:role/citypark-audit-apprunner-ecr-access` | Created for App Runner's ECR access; App Runner itself was blocked by a new-account restriction, so this role is provisioned but has no attached service — safe to delete or reuse later |

### MongoDB Atlas

| Field | Value |
|---|---|
| Cluster host | `cluster0.ssbdzsy.mongodb.net` |
| Database name | `citypark_audit` |
| Database user | `Citypark_app` (created under Atlas → Security → Database Access, role "Read and write to any database") |
| Network access | `0.0.0.0/0` allowed (Atlas → Security → Network Access) — required since Lambda has no static IP |

### Lambda environment variables

Set via `aws lambda update-function-configuration --function-name citypark-audit-backend --environment ...`.
Names only — see the separate credentials handoff for values.

| Variable | Notes |
|---|---|
| `MONGO_URL` | Full `mongodb+srv://` connection string including credentials |
| `DB_NAME` | `citypark_audit` |
| `JWT_SECRET` | Random 64-hex-char string, generated for this deployment |
| `ADMIN_EMAIL` | `admin@cityparkhotel.in` |
| `ADMIN_PASSWORD` | Seeded admin password — change after first login |
| `CORS_ORIGINS` | Currently `*` (open) — tighten to the real frontend origin once a custom domain is set |
| `STAFF_EMAIL_DOMAIN` | `cityparkhotel.in` — restricts self-registration |
| `GEMINI_API_KEY` | Google AI Studio key for the AI audit-summary feature (model `gemini-3-flash-preview`) |

---

## Runbooks

### Update backend code and redeploy

The Lambda deployment package is a zip of `backend/server.py` + `backend/lambda_handler.py` +
all pip dependencies, built for the `manylinux2014_x86_64` / Python 3.11 platform tag (must
match Lambda's runtime glibc — see Gotchas).

```bash
# from a clean directory
mkdir lambda_pkg && cd lambda_pkg
pip install -q \
  --platform manylinux2014_x86_64 --implementation cp --python-version 3.11 \
  --only-binary=:all: --target . \
  mangum==0.17.0 fastapi==0.110.1 motor==3.3.1 pymongo==4.6.3 bcrypt==4.1.3 \
  PyJWT==2.13.0 python-dotenv==1.2.2 pydantic==2.13.4 pydantic-core starlette==0.37.2 \
  python-multipart==0.0.32 email-validator==2.3.0 dnspython google-genai==2.10.0

cp ../backend/server.py ../backend/lambda_handler.py .
zip -qr ../lambda-backend.zip . -x "__pycache__/*" -x "*.pyc"
cd ..

aws s3 cp lambda-backend.zip s3://citypark-audit-src-516887748193-ap-south-1/lambda-backend.zip
aws lambda update-function-code --function-name citypark-audit-backend \
  --s3-bucket citypark-audit-src-516887748193-ap-south-1 --s3-key lambda-backend.zip \
  --region ap-south-1
```

### Update frontend and redeploy

```bash
cd frontend
# frontend/.env.production should already have:
#   EXPO_PUBLIC_BACKEND_URL=https://ub8pyznzb7.execute-api.ap-south-1.amazonaws.com
EXPO_OFFLINE=1 npm run export:web   # = expo export --platform web + inject-pwa-head.js
aws s3 sync dist s3://citypark-audit-frontend-516887748193-ap-south-1 --region ap-south-1 --delete
```

### Update an environment variable / rotate a secret

```bash
aws lambda update-function-configuration --function-name citypark-audit-backend \
  --environment 'Variables={MONGO_URL=...,DB_NAME=citypark_audit,JWT_SECRET=...,ADMIN_EMAIL=...,ADMIN_PASSWORD=...,CORS_ORIGINS=*,STAFF_EMAIL_DOMAIN=cityparkhotel.in,GEMINI_API_KEY=...}' \
  --region ap-south-1
```
(Must pass the **entire** variable set each time — this call replaces the whole map, it doesn't merge.)

### Tear down everything

```bash
aws lambda delete-function --function-name citypark-audit-backend --region ap-south-1
aws apigatewayv2 delete-api --api-id ub8pyznzb7 --region ap-south-1
aws s3 rb s3://citypark-audit-frontend-516887748193-ap-south-1 --force
aws s3 rb s3://citypark-audit-src-516887748193-ap-south-1 --force
aws ecr delete-repository --repository-name citypark-audit-backend --force --region ap-south-1
aws codebuild delete-project --name citypark-audit-backend-build --region ap-south-1
aws iam delete-role-policy --role-name citypark-audit-codebuild-role --policy-name citypark-audit-codebuild-policy
aws iam delete-role --role-name citypark-audit-codebuild-role
aws iam detach-role-policy --role-name citypark-audit-apprunner-ecr-access --policy-arn arn:aws:iam::aws:policy/service-role/AWSAppRunnerServicePolicyForECRAccess
aws iam delete-role --role-name citypark-audit-apprunner-ecr-access
aws iam detach-role-policy --role-name citypark-audit-lambda-role --policy-arn arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole
aws iam delete-role --role-name citypark-audit-lambda-role
```
Atlas cluster and database user must be deleted separately in the Atlas console.

---

## Alternate Docker / App Runner path

`backend/Dockerfile` still works as a normal Docker deployment target (App Runner, ECS Fargate,
or any container host). The image is already built and pushed to
`516887748193.dkr.ecr.ap-south-1.amazonaws.com/citypark-audit-backend:latest` via the
`citypark-audit-backend-build` CodeBuild project (this was necessary because Docker Hub /
CloudFront image pulls are blocked from the dev sandbox that built this — CodeBuild builds
inside AWS itself and isn't subject to that restriction).

App Runner deployment was attempted first but blocked with `SubscriptionRequiredException` —
this is AWS's automatic new-account restriction on compute services (App Runner, EC2, Lightsail,
ECS/EKS Fargate), separate from billing status. It typically lifts within 24–48 hours, or can be
lifted immediately via an AWS Support "service limit increase" case. Once available, App Runner
can be created directly from the ECR image:

```bash
aws apprunner create-service --cli-input-json file://apprunner-config.json --region ap-south-1
```
using `citypark-audit-apprunner-ecr-access` as the `AccessRoleArn` and the same env vars as the
Lambda function (`Port: "8001"` since the Dockerfile's uvicorn binds there).

---

## Gotchas (things that broke during setup — don't repeat these)

1. **glibc mismatch**: installing Python deps with plain `pip install` on a non-Lambda Linux box
   can produce `manylinux_2_28`+ wheels (e.g. for `bcrypt`) that fail on Lambda's runtime with
   `GLIBC_2.28 not found`. Always install Lambda deps with
   `--platform manylinux2014_x86_64 --implementation cp --python-version 3.11 --only-binary=:all:`.

2. **Motor/Mangum + Lambda warm invocations**: `backend/server.py`'s `@app.on_event("startup")`
   handler (seeds admin user + templates) runs through Mangum's ASGI lifespan protocol. By default
   Mangum re-runs lifespan startup on every invocation, and on a warm container this reuses the
   global `AsyncIOMotorClient` that was bound to a *previous, now-closed* asyncio event loop,
   raising `pymongo.errors.InvalidOperation: Cannot use MongoClient after close`. Fix:
   `Mangum(app, lifespan="off")` in `lambda_handler.py`. This means the startup seed only ever
   ran once (already done, and it's idempotent) — if you need to re-seed after wiping the DB,
   temporarily flip `lifespan="auto"`, invoke once, then flip back to `"off"`.

3. **Lambda invoke permission ARN pattern**: for an HTTP API (v2) with a `$default` catch-all
   route, the `aws lambda add-permission --source-arn` must be `arn:aws:execute-api:...:{api-id}/*`.
   The commonly-copied REST-API pattern `{api-id}/*/*/{proxy+}` does **not** match and API Gateway
   will return a generic `{"message":"Internal Server Error"}` (500) to the client with **no
   corresponding Lambda invocation or CloudWatch log entry at all** — easy to misdiagnose as a
   code bug when it's actually a permissions/ARN-pattern mismatch.

4. **`aws lambda update-function-code` replaces the whole package** — it is not additive. Always
   re-zip the full dependency + source tree, not just the changed file.

5. **This dev sandbox can't pull from Docker Hub or the ECR public gallery** (CloudFront-fronted
   registries return `403 Forbidden` through its egress proxy), and can't open raw TCP to MongoDB
   Atlas (`mongodb+srv://` wire protocol isn't HTTP-proxied). Neither restriction applies to
   resources actually running in AWS (Lambda, CodeBuild) — only to testing directly from this
   sandbox.

6. **`app/+html.tsx` is ignored** because `app.json`'s `web.output` is `"single"` (client-only SPA) —
   expo-router only honors that file for `"static"`/`"server"` output. The PWA `<head>` tags
   (manifest link, icons, service worker registration) are injected into `dist/index.html` after
   the fact by `frontend/scripts/inject-pwa-head.js`, run via `npm run export:web`. If you ever
   switch `web.output` to `"static"`, move that logic back into `+html.tsx` and delete the script.

7. **PWA installability needs HTTPS.** Service workers won't register on a plain-HTTP origin
   (browsers require HTTPS or `localhost`). The manifest/icons/service worker are all deployed and
   working, but "Add to Home Screen" / install-prompt behavior won't fully activate until the
   frontend is served over HTTPS (e.g. via CloudFront in front of the S3 bucket, or a custom
   domain with ACM).
