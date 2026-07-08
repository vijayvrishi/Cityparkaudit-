# Test Credentials — CityPark Audit

## Admin (seeded, approved)
- Email: admin@citypark.com
- Password: CityPark2026!
- Role: admin (can approve/reject users in Profile screen)

## Approved test auditor
- Email: auditor@test.com
- Password: test123
- Role: auditor (approved)

## Notes
- New registrations are created with approved=false and CANNOT log in until the admin approves them via POST /api/users/{id}/approve or the Profile screen.
- All /api/* routes (except /api/auth/register and /api/auth/login) require Authorization: Bearer <token>.
- Login: POST /api/auth/login {email, password} -> {access_token, user}
