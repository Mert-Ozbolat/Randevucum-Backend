# Web Rezervasyon API

Multi-tenant reservation system REST API for appointment-based businesses (hair salon, dental clinic, beauty center, restaurant, etc.) built with Express.js and MongoDB.

## Tech Stack

- **Express.js** – REST API
- **MongoDB + Mongoose** – Database
- **JWT** – Authentication
- **bcryptjs** – Password hashing
- **express-validator** – Request validation
- **dotenv** – Environment config

## Project Structure

```
src/
  config/         # DB connection, constants
  controllers/    # Route handlers
  middleware/     # auth, subscription, ownership
  models/         # Mongoose schemas
  routes/         # API routes
  utils/          # errors, response, slotCalculator
  validators/     # express-validator rules
  app.js
  server.js
```

## Setup

1. **Install dependencies**
   ```bash
   npm install
   ```

2. **Environment**
   - Copy `.env.example` to `.env`
   - Set `MONGODB_URI` and `JWT_SECRET`

3. **Run MongoDB** (local or Atlas)

4. **Start server**
   ```bash
   npm run dev   # development with nodemon
   npm start     # production
   ```

## Environment Variables (.env)

| Variable      | Description           | Example                    |
|---------------|-----------------------|----------------------------|
| PORT          | Server port            | 5000                       |
| MONGODB_URI   | MongoDB connection    | mongodb://localhost:27017/webrezervasyon |
| JWT_SECRET    | JWT signing secret    | your-secret-key            |
| JWT_EXPIRES_IN| Token expiry          | 7d                         |

## API Overview

### Authentication
- `POST /auth/register` – Register (customer or business_owner)
- `POST /auth/login` – Login, returns JWT

### Business
- `POST /business` – Create business (owner)
- `PUT /business/:id` – Update business
- `GET /business/:id` – Get one business
- `GET /business` – List (by type; owners see only their businesses when logged in)

### Subscription
- `POST /subscription/subscribe` – Activate monthly subscription (body: `businessId`)
- `GET /subscription/status/:businessId` – Subscription status

### Stripe (payments)
- `GET /payments/stripe/config` – Auth: business owner; returns `{ checkoutEnabled, publishableKey }`
- `POST /payments/stripe/checkout-session` – Body: `{ businessId, priceId? }`; returns `{ url }` for hosted Checkout
- `POST /payments/stripe/webhook` – Raw JSON body; configure `STRIPE_WEBHOOK_SECRET` (Dashboard or `stripe listen`)
- `POST /webhook` – Same Stripe webhook handler (for `https://api.randevucum.online/webhook`)

**Local webhook test:** Install [Stripe CLI](https://stripe.com/docs/stripe-cli), then:

```bash
stripe listen --forward-to http://localhost:5001/payments/stripe/webhook
```

Copy the printed `whsec_...` into `STRIPE_WEBHOOK_SECRET` in `backend/.env`. In Stripe Dashboard create a recurring **Price** and set `STRIPE_PRICE_ID` (or `STRIPE_PRICE_ID_MONTHLY`). Set `FRONTEND_URL` (e.g. `http://localhost:3000`).

**Multiple packages:** One Stripe account = one `sk` + one `pk`. Each product tier is a separate **Price** id (`price_...`). Set `STRIPE_PRICE_ID` + `STRIPE_PRICE_LABEL` and `STRIPE_PRICE_ID_2` + `STRIPE_PRICE_LABEL_2` (optional `STRIPE_PRICE_ID_3`). The subscription UI lists one pay button per plan.

### Services
- `POST /services` – Create service (body: businessId, name, durationMinutes, …)
- `PUT /services/:id` – Update service
- `DELETE /services/:id` – Delete service
- `GET /services/business/:businessId` – List services

### Staff
- `POST /staff` – Create staff (body: businessId, name, …)
- `PUT /staff/:id` – Update staff
- `GET /staff/business/:businessId` – List staff

### Reservations
- `GET /reservations/available-slots?businessId&serviceId&date&staffId` – Available time slots
- `POST /reservations` – Create reservation (requires active subscription)
- `GET /reservations/business/:businessId` – List by business (owner)
- `GET /reservations/customer/:customerId` – List by customer (self/admin)
- `GET /reservations/:id` – Get one reservation
- `PATCH /reservations/:id/status` – Approve/cancel (body: `status`: approved | canceled)
- `DELETE /reservations/:id` – Cancel reservation

## Roles

- **super_admin** – Platform owner
- **business_owner** – Business owner (salon, clinic, restaurant, etc.)
- **customer** – End customer making reservations

## Business Types

- `hair_salon` | `dental_clinic` | `beauty_center` | `restaurant` | `other`

## Postman

Import `postman/Webrezervasyon-API.postman_collection.json` and set `baseUrl` (e.g. `http://localhost:5000`).  
Run **Login** first to set `token`; then create Business → Subscribe → Services → Staff → Reservations. Collection variables (`businessId`, `serviceId`, etc.) are set from responses where applicable.

## Reservation Flow

1. Business owner creates business, then subscribes (monthly).
2. Owner adds services (name, duration) and staff.
3. Customer lists businesses (e.g. by `businessType`), picks a business and service.
4. Customer calls `GET /reservations/available-slots` for a date, then `POST /reservations` with date/time.
5. Owner can list reservations for their business and approve/cancel; customer can cancel own reservation.

## License

ISC
# rezervasyon-backend
# rezervasyon-backend
# Randevucum-Backend
