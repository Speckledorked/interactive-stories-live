# Setup Instructions

## Environment Variables

The application requires several environment variables to function properly. Follow these steps:

1. **Copy the example file:**
   ```bash
   cp .env.example .env
   ```

2. **Configure DATABASE_URL:**
   - You need a PostgreSQL database
   - Update the `DATABASE_URL` in `.env` with your database connection string
   - Format: `postgresql://user:password@host:port/database`

3. **Set JWT_SECRET:**
   - Generate a secure random string for JWT tokens
   - Example: `openssl rand -base64 32`

4. **Configure OpenAI API (Required for AI features):**
   - Get an API key from https://platform.openai.com/api-keys
   - Set `OPENAI_API_KEY` in your `.env`

5. **Configure Pusher (Required for real-time features):**
   - Sign up at https://pusher.com
   - Create an app and get your credentials from the dashboard
   - Set the following variables in your `.env` or `.env.local`:
     - `PUSHER_APP_ID` - Your Pusher app ID
     - `PUSHER_KEY` - Your Pusher key (for server-side)
     - `PUSHER_SECRET` - Your Pusher secret (keep this secure!)
     - `PUSHER_CLUSTER` - Your Pusher cluster (e.g., "mt1", "us2", "eu")
     - `NEXT_PUBLIC_PUSHER_KEY` - Your Pusher key (for client-side)
     - `NEXT_PUBLIC_PUSHER_CLUSTER` - Your Pusher cluster (for client-side)
   - **Note:** After adding/updating `.env.local`, restart your dev server for changes to take effect
   - Without Pusher, features like chat, notifications, and live scene updates won't work

## Database Setup

After configuring your `.env` file:

```bash
# Generate Prisma Client
npx prisma generate

# Run database migrations
npx prisma migrate dev

# (Optional) Seed the database
npx prisma db seed
```

## Running the Application

```bash
# Development mode
npm run dev

# Production build
npm run build
npm start
```

## Troubleshooting

### "Environment variable not found: DATABASE_URL"
- Make sure you have created a `.env` file (not `.env.example`)
- Ensure DATABASE_URL is properly set in the `.env` file

### Campaign creation fails with internal server error
- Check that your DATABASE_URL is correct and the database is accessible
- Verify that migrations have been run: `npx prisma migrate dev`
- Check the console for specific error messages

### Build fails with Pusher errors
- This should be fixed with fallback values, but ensure your `.env` has the Pusher variables (or set them to placeholders)
