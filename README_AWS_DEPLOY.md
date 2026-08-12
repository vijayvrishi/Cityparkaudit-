# City Park Audit App — AWS Deployment

## Recommended AWS setup

- Frontend: AWS Amplify Hosting or S3 + CloudFront for `app.cityparkhotel.in`
- Backend: AWS App Runner from Docker image for `api.cityparkhotel.in`
- Database: MongoDB Atlas M10 or AWS DocumentDB-compatible MongoDB. MongoDB Atlas is simpler for this app.
- DNS: Route 53 records for `app.cityparkhotel.in` and `api.cityparkhotel.in`
- SSL: AWS Certificate Manager / Amplify managed HTTPS

## Backend deployment

1. Create MongoDB Atlas cluster and get connection string.
2. In backend environment variables, set:
   - `MONGO_URL`
   - `DB_NAME=citypark_audit`
   - `JWT_SECRET`
   - `ADMIN_EMAIL`
   - `ADMIN_PASSWORD`
   - `CORS_ORIGINS=https://app.cityparkhotel.in`
   - `STAFF_EMAIL_DOMAIN=cityparkhotel.in`
3. Build and push Docker image to AWS ECR:

```bash
cd backend
aws ecr create-repository --repository-name citypark-audit-backend
aws ecr get-login-password --region ap-south-1 | docker login --username AWS --password-stdin <ACCOUNT_ID>.dkr.ecr.ap-south-1.amazonaws.com
docker build -t citypark-audit-backend .
docker tag citypark-audit-backend:latest <ACCOUNT_ID>.dkr.ecr.ap-south-1.amazonaws.com/citypark-audit-backend:latest
docker push <ACCOUNT_ID>.dkr.ecr.ap-south-1.amazonaws.com/citypark-audit-backend:latest
```

4. Create AWS App Runner service from the ECR image.
5. Set port to `8001`.
6. Add custom domain `api.cityparkhotel.in`.

## Frontend deployment

1. Set frontend env:

```bash
cd frontend
cp .env.production.example .env
npm install
npx expo export --platform web
```

2. Upload the generated `dist/` folder to Amplify Hosting or S3 + CloudFront.
3. Add custom domain `app.cityparkhotel.in`.

## Important security

- Do not use the current local `.env` values in production.
- Change admin password before first production login.
- Use a long random `JWT_SECRET`.
- Keep backend CORS restricted to `https://app.cityparkhotel.in`.
