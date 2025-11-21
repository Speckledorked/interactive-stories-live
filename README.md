# AI Game Master App

An interactive AI-powered Game Master for tabletop RPGs, built with Next.js 14, TypeScript, and Prisma.

## Features

- 🎭 AI-powered game master using OpenAI
- 🎲 Real-time multiplayer with Pusher
- 📖 Rich storytelling with dynamic scenes
- 👥 Character creation and management
- 🔐 Secure authentication with JWT
- 🎨 Beautiful dark-themed UI with Tailwind CSS

## Tech Stack

- **Framework**: Next.js 14 (App Router)
- **Language**: TypeScript
- **Database**: PostgreSQL with Prisma ORM
- **Styling**: Tailwind CSS
- **Real-time**: Pusher
- **AI**: OpenAI API
- **Auth**: JWT (JSON Web Tokens)

## Deployment to Vercel

### Prerequisites

1. A Vercel account
2. A PostgreSQL database (e.g., Vercel Postgres, Supabase, or Railway)
3. OpenAI API key
4. Pusher account and credentials

### Step-by-Step Deployment

1. **Fork or clone this repository**

2. **Set up your database**
   - Create a PostgreSQL database
   - Copy the connection string

3. **Deploy to Vercel**
   - Go to [Vercel](https://vercel.com)
   - Click "New Project"
   - Import your repository
   - Configure environment variables (see below)

4. **Configure Environment Variables**

   In your Vercel project settings, add these environment variables:

   ```
   DATABASE_URL=postgresql://user:password@host:port/database
   JWT_SECRET=your-secure-random-secret
   OPENAI_API_KEY=sk-your-openai-api-key
   PUSHER_APP_ID=your-pusher-app-id
   PUSHER_SECRET=your-pusher-secret
   NEXT_PUBLIC_PUSHER_KEY=your-pusher-key
   NEXT_PUBLIC_PUSHER_CLUSTER=your-pusher-cluster
   NEXT_PUBLIC_APP_URL=https://your-app.vercel.app
   ```

5. **Deploy**
   - Click "Deploy"
   - Vercel will automatically:
     - Install dependencies
     - Generate Prisma client
     - Run database migrations
     - Build the application

6. **Verify Deployment**
   - Visit your deployed URL
   - Create an account
   - Start a new campaign!

## Local Development

1. **Clone the repository**
   ```bash
   git clone <your-repo-url>
   cd interactive-stories-live
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Set up environment variables**
   - Copy `.env.example` to `.env`
   - Fill in your credentials

4. **Set up the database**
   ```bash
   npx prisma generate
   npx prisma migrate dev
   ```

5. **Run the development server**
   ```bash
   npm run dev
   ```

6. **Open [http://localhost:3000](http://localhost:3000)**

## Project Structure

```
/
├── src/
│   ├── app/              # Next.js app router pages
│   │   ├── api/          # API routes
│   │   ├── campaigns/    # Campaign pages
│   │   ├── login/        # Authentication pages
│   │   └── globals.css   # Global styles
│   ├── components/       # React components
│   ├── lib/             # Utility libraries
│   │   ├── auth.ts      # Authentication helpers
│   │   ├── prisma.ts    # Prisma client
│   │   └── ai/          # OpenAI integration
│   └── types/           # TypeScript types
├── prisma/
│   └── schema.prisma    # Database schema
├── .env.example         # Environment variables template
├── next.config.js       # Next.js configuration
├── tailwind.config.js   # Tailwind configuration
└── vercel.json          # Vercel deployment config
```

## Key Scripts

- `npm run dev` - Start development server
- `npm run build` - Build for production
- `npm run start` - Start production server
- `npm run lint` - Run ESLint
- `npm run prisma:generate` - Generate Prisma client
- `npm run prisma:migrate` - Run database migrations
- `npm run prisma:studio` - Open Prisma Studio

## Environment Variables

See `.env.example` for a complete list of required environment variables.

## Design System

The app features a rich, modern dark theme with:
- Gradient backgrounds and buttons
- Glass morphism effects
- Smooth animations and transitions
- Enhanced hover states
- Custom scrollbars
- Responsive design

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## License

MIT License - feel free to use this project for your own campaigns!

## Support

For issues or questions, please open an issue on GitHub.

---

**Happy adventuring! 🎲✨**
