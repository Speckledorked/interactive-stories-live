# 🚀 Phase 9: Notifications & Alerts - Complete Setup Guide

## 📋 Overview
Phase 9 adds a comprehensive notification system to solve player engagement issues:
- **Turn Tracking**: Know exactly when it's your turn with automatic reminders
- **Smart Alerts**: Get notified about scene changes, mentions, and important events  
- **Multi-Channel Notifications**: Email, browser push, and sound effects
- **@Mentions**: Tag players in chat and notes with instant notifications
- **"Waiting On You" Indicators**: Clear visual cues about who needs to act
- **Dramatic Sound Effects**: Audio cues for critical moments and atmosphere

## 🎯 Problems This Solves
- ❌ Players don't know when it's their turn → ✅ Automatic turn tracking with reminders
- ❌ No alerts for scene changes → ✅ Real-time scene change notifications  
- ❌ Missing @mentions and whisper alerts → ✅ Comprehensive mention system
- ❌ No dramatic atmosphere → ✅ Sound effects for critical moments
- ❌ Players lose track of game state → ✅ "Waiting on you" indicators

## 📁 File Placement Guide

### 1. Database Schema Update
**File:** `prisma-schema-update.prisma`
**Action:** Add these models to your existing `prisma/schema.prisma` file
⚠️ **IMPORTANT**: Don't replace your entire schema! Only add the new models.

### 2. Library Files (Create new directories)
```
src/lib/notifications/
├── notification-service.ts     ← lib-notifications-notification-service.ts
├── turn-tracker.ts            ← lib-notifications-turn-tracker.ts
├── mention-service.ts         ← lib-notifications-mention-service.ts
├── email-service.ts           ← lib-notifications-email-service.ts
├── push-service.ts            ← lib-notifications-push-service.ts
└── sound-service.ts           ← lib-notifications-sound-service.ts

src/lib/realtime/
└── pusher-server.ts           ← Replace with lib-realtime-pusher-server.ts
```

### 3. API Routes (Create new directories)
```
src/app/api/
├── notifications/
│   ├── route.ts               ← api-notifications-route.ts
│   ├── [id]/
│   │   └── route.ts           ← api-notifications-id-route.ts
│   └── settings/
│       └── route.ts           ← api-notifications-settings-route.ts
└── campaigns/[id]/turns/
    └── route.ts               ← api-campaigns-id-turns-route.ts
```

### 4. Components (Create new directories)
```
src/components/
├── notifications/
│   └── NotificationPanel.tsx  ← components-notifications-NotificationPanel.tsx
├── turns/
│   └── TurnTracker.tsx        ← components-turns-TurnTracker.tsx
└── settings/
    └── NotificationSettings.tsx ← components-settings-NotificationSettings.tsx
```

### 5. Public Assets
```
public/
└── sounds/                    ← Create directory and add sound files
    ├── notification.mp3       ← See sound-files-setup.md
    ├── turn-reminder.mp3
    ├── your-turn.mp3
    └── ... (15+ sound files)
```

## 🔧 Setup Steps

### Step 1: Install Dependencies
```bash
npm install nodemailer
npm install --save-dev @types/nodemailer
```

### Step 2: Update Database Schema
1. Add the new models from `prisma-schema-update.prisma` to your `prisma/schema.prisma`
2. Run migration:
```bash
npx prisma migrate dev --name add_notifications_system
```

### Step 3: Configure Email (Choose One Option)

#### Option A: Gmail Setup (Recommended)
1. Enable 2-Factor Authentication on your Gmail account
2. Go to Google Account Settings → Security → App passwords
3. Generate a new app password for "Mail"
4. Add to your `.env`:
```
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=youremail@gmail.com
SMTP_PASSWORD=your-16-char-app-password
```

#### Option B: SendGrid
1. Create SendGrid account and get API key
2. Add to your `.env`:
```
SMTP_HOST=smtp.sendgrid.net
SMTP_PORT=587
SMTP_USER=apikey
SMTP_PASSWORD=your-sendgrid-api-key
```

#### Option C: Mailgun
1. Create Mailgun account and get SMTP credentials
2. Add to your `.env`:
```
SMTP_HOST=smtp.mailgun.org
SMTP_PORT=587
SMTP_USER=your-mailgun-smtp-username
SMTP_PASSWORD=your-mailgun-smtp-password
```

### Step 4: Add Environment Variables
Copy from `env-additions-phase9.txt` to your `.env` file:
```
# Email Configuration (choose one from Step 3)
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=your-email@gmail.com
SMTP_PASSWORD=your-app-password

# Application URL
NEXT_PUBLIC_APP_URL=http://localhost:3000
```

### Step 5: Set Up Sound Files
1. Create `public/sounds/` directory
2. Download sound files (see `sound-files-setup.md`)
3. Essential sounds needed:
   - `notification.mp3` - General notification
   - `your-turn.mp3` - Turn start alert
   - `mention.mp3` - @mention ping
   - `scene-change.mp3` - Scene transition
   - `success.mp3` - Success confirmation

### Step 6: Deploy Files
1. Create the directory structure shown above
2. Place each downloaded file in its correct location
3. Replace existing `pusher-server.ts` with the updated version

### Step 7: Test the System
```bash
npm run dev
```
1. Join a campaign with multiple users
2. Test turn tracking and reminders
3. Try @mentions in chat
4. Check notification settings page
5. Verify email delivery

## 🎮 New Features Guide

### Turn Tracking System
- **Automatic Turn Order**: AI manages turn order for scenes
- **Time Limits**: Configurable turn timeouts (default 60 minutes)
- **Smart Reminders**: Escalating reminders at 15, 5, and 1 minutes
- **Skip Turns**: GMs can skip inactive players
- **Visual Indicators**: Clear UI showing whose turn it is

### @Mention System
- **Chat Mentions**: Use @username in any message
- **Note Mentions**: Tag players in shared campaign notes
- **Autocomplete**: Smart username suggestions as you type
- **Instant Notifications**: Mentioned users get immediate alerts

### Notification Types
- 🎯 **Turn Reminders**: "It's your turn!"
- 🎬 **Scene Changes**: New scenes starting
- 💬 **Mentions**: When someone @mentions you
- 🔒 **Whispers**: Private message alerts
- 📝 **Notes**: Shared note updates
- 🎲 **Campaign Invites**: Invitation notifications
- ✅ **Scene Complete**: Resolution notifications
- 🤖 **AI Responses**: When AI has responded

### Sound Effects System
- **Notification Sounds**: Different sounds for different alert types
- **Dramatic Moments**: Epic sounds for critical successes/failures
- **Ambient Sounds**: Background atmosphere for different scene types
- **Volume Control**: User-configurable sound levels
- **Browser Support**: Works in all modern browsers

### Multi-Channel Notifications
- **Email**: Full HTML emails with campaign context
- **Browser Push**: Native browser notifications
- **Sound**: Audio alerts for immediate attention
- **Real-time**: Live updates via WebSocket

## ⚙️ Configuration Options

### User Notification Settings
Users can customize:
- ✅ Email notifications (per type)
- ✅ Browser push notifications  
- ✅ Sound effects (per type)
- ✅ Quiet hours (time-based restrictions)
- ✅ Daily/weekly digest emails

### Campaign Settings
Campaign admins can control:
- ✅ Turn timeout durations
- ✅ Auto-advance on timeout
- ✅ @mention functionality
- ✅ Sound effects for the campaign
- ✅ Notification priorities

### Developer Settings
Configure via environment variables:
- ✅ Email provider settings
- ✅ Notification rate limits
- ✅ Background task scheduling
- ✅ Sound file locations

## 🛠️ Advanced Features

### Background Tasks
Enable automatic processing:
```
ENABLE_BACKGROUND_TASKS=true
```
- Automatic turn reminders
- Expired notification cleanup
- Daily/weekly digest sending
- Turn timeout enforcement

### Push Notification Setup (Optional)
For advanced push notifications:
1. Generate VAPID keys at https://vapidkeys.com/
2. Add to `.env`:
```
NEXT_PUBLIC_VAPID_PUBLIC_KEY=your-public-key
VAPID_PRIVATE_KEY=your-private-key
```

### Email Templates
Customize email templates in `email-service.ts`:
- Welcome emails for new users
- Campaign invitations
- Daily/weekly digests
- Password reset emails

## 🎯 Usage Examples

### Turn Tracking
```javascript
// Initialize turn tracking for a scene
await TurnTracker.initializeScene(campaignId, sceneId, [
  { userId: 'user1', characterId: 'char1', name: 'Aragorn' },
  { userId: 'user2', characterId: 'char2', name: 'Legolas' },
  { userId: 'user3', characterId: 'char3', name: 'Gimli' }
], 60); // 60 minutes per turn

// Advance turn when player acts
await TurnTracker.advanceTurn(campaignId, sceneId, userId);
```

### @Mentions in Chat
```javascript
// Process mentions in a message
const result = await MentionService.processMentions(
  messageId,
  "Hey @john, did you see what happened to @sarah's character?",
  authorId,
  campaignId
);
// Automatically sends notifications to mentioned users
```

### Custom Notifications
```javascript
// Send custom notification
await NotificationService.createNotification({
  type: 'SCENE_CHANGE',
  title: '🎬 New Scene: The Dragon\'s Lair',
  message: 'The party enters the ancient dragon\'s lair...',
  userId: playerId,
  campaignId,
  priority: 'HIGH',
  triggerSound: 'scene-change',
  actionUrl: `/campaigns/${campaignId}`
});
```

### Sound Effects
```javascript
// Play dramatic sound for critical moment
await SoundService.playDramaticSound('critical_success', 1.0);

// Start ambient background for tavern scene
await SoundService.startAmbientSound('tavern');
```

## 🚨 Troubleshooting

### Email Not Sending
1. Check SMTP credentials in `.env`
2. Verify Gmail app password (not regular password)
3. Check email service logs in console
4. Test with: `EmailService.testConnection()`

### Sounds Not Playing
1. Check browser autoplay policy
2. Verify sound files exist in `public/sounds/`
3. Test sound permissions
4. Check console for audio errors

### Notifications Not Appearing
1. Verify Pusher credentials still working
2. Check browser notification permissions
3. Ensure user is campaign member
4. Check notification settings

### Turn Tracking Issues
1. Verify scene has active turn tracker
2. Check user permissions
3. Ensure turn order is properly set
4. Check for expired turns

## 📊 Monitoring & Analytics

The system provides comprehensive monitoring:
- **Notification Delivery**: Track email/push success rates
- **Turn Performance**: Average turn times, timeout rates
- **User Engagement**: Notification interaction rates
- **Sound Usage**: Popular sound effects, volume settings

## 🔒 Security Features

- **Rate Limiting**: Prevents notification spam
- **Permission Checks**: Only campaign members get notifications  
- **Input Sanitization**: @mention parsing prevents injection
- **Quiet Hours**: Respects user time preferences
- **Privacy Controls**: Users control what they receive

## 🎉 What Players Experience

With Phase 9 complete, players now enjoy:
- **Never Miss Their Turn**: Automatic reminders ensure engagement
- **Stay Informed**: Real-time alerts about important events
- **Rich Communication**: @mentions make coordination easy
- **Immersive Atmosphere**: Sound effects enhance drama
- **Personalized Experience**: Customizable notification preferences
- **Professional Polish**: Email notifications feel like a premium service

## 🚀 Ready for Production!

Your AI Game Master application now has **enterprise-grade notification features** that solve the core engagement problems of online tabletop gaming:

- ⏰ **Turn Management**: No more "whose turn is it?"
- 📧 **Professional Communication**: Email alerts keep players engaged
- 💬 **Smart Mentions**: Easy player coordination
- 🎵 **Atmospheric Audio**: Immersive sound design
- 🔔 **Multi-Modal Alerts**: Never miss important updates
- ⚙️ **User Control**: Comprehensive preference management

**Phase 9 Complete - Your AI GM now provides the engagement and polish of commercial gaming platforms! 🎲✨**
