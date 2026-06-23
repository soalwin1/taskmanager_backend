import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import http from 'http';
import { Server } from 'socket.io';
import jwt from 'jsonwebtoken';
import morgan from 'morgan';
import logger, { getUserLogger } from './utils/logger.js';
import getRedisClient from './utils/redisClient.js';
import errorHandler from './middleware/errorHandler.js';
import authRoutes from './routes/auth.js';
import taskRoutes from './routes/tasks.js';
import adminRoutes from './routes/admin.js';
import userRoutes from './routes/user.js';
import notificationRoutes from './routes/notification.js';
import chatRoutes from './routes/chat.js';
import sequelize from './config/database.js';

// Load all models and set up associations
import './models/index.js';
import Employee from './models/Employee.js';
import bcrypt from 'bcrypt';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 5000;

// Register custom Morgan tokens to extract user information from JWT token
morgan.token('user-email', (req) => {
  return req.user && req.user.email ? req.user.email : 'anonymous';
});

morgan.token('user-name', (req) => {
  return req.user && req.user.fullName ? req.user.fullName : 'anonymous';
});

// Morgan middleware wrapper to capture req context (including req.user) inside the log stream
app.use((req, res, next) => {
  morgan(':method :url | Status: :status | Size: :res[content-length] B | Time: :response-time ms | User: :user-name (:user-email)', {
    stream: {
      write: (message) => {
        const logMsg = message.trim();
        // Log to central combined logs
        logger.http(logMsg);
        // Log to user-specific logs folder
        const userName = req.user?.fullName || 'anonymous';
        const userLogger = getUserLogger(userName);
        if (userLogger) {
          userLogger.http(logMsg);
        }
      }
    }
  })(req, res, next);
});

// Create HTTP server wrapping Express
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  }
});

// Socket.io Authentication Middleware using JWT
io.use((socket, next) => {
  const token = socket.handshake.auth?.token;
  if (!token) {
    return next(new Error('Authentication error: No token provided'));
  }
  try {
    const decoded = jwt.verify(token.replace('Bearer ', ''), process.env.JWT_SECRET);
    socket.user = decoded.user;
    next();
  } catch (err) {
    return next(new Error('Authentication error: Invalid token'));
  }
});

// Socket.io Connection Handler
io.on('connection', (socket) => {
  console.log(`Socket client connected: ${socket.user.id} (${socket.id})`);
  
  // Join a room unique to the user ID to send target notifications
  socket.join(`user_${socket.user.id}`);
  
  // Handle real-time typing indicators
  socket.on('typing', (data) => {
    const { receiverId, isTyping } = data;
    socket.to(`user_${receiverId}`).emit('user_typing', {
      senderId: socket.user.id,
      isTyping
    });
  });
  
  socket.on('disconnect', () => {
    console.log(`Socket client disconnected: ${socket.user.id} (${socket.id})`);
  });
});

// Middleware to attach socket.io instance to requests
app.use((req, res, next) => {
  req.io = io;
  next();
});

// Middleware
app.use(cors());
app.use(express.json());

// Health check (used by Docker HEALTHCHECK)
app.get('/api/health', (_req, res) => res.status(200).json({ status: 'ok' }));

// Routes
app.use('/api', authRoutes);
app.use('/api/tasks', taskRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/user', userRoutes);
app.use('/api/user/notifications', notificationRoutes);
app.use('/api/chat', chatRoutes);

// Static files
app.use('/api/uploads', express.static(path.join(__dirname, 'uploads')));

// Global Error Handler Middleware
app.use(errorHandler);

// Process-level uncaught exception & unhandled promise rejection handling
process.on('uncaughtException', (err) => {
  logger.error('Uncaught Exception! Shutting down server...', err);
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  logger.error('Unhandled Promise Rejection at:', promise, 'reason:', reason);
});

// Check environment variables
if (!process.env.DATABASE_URL) {
  logger.error('FATAL ERROR: DATABASE_URL is not defined. Ensure you have a .env file with DATABASE_URL set.');
  process.exit(1);
}

// PostgreSQL connection via Sequelize
sequelize.authenticate()
  .then(() => {
    logger.info('Connected to PostgreSQL');

    // Sync all models (create tables if they don't exist)
    // Use { alter: true } during development to update table columns safely
    return sequelize.sync({ alter: true });
  })
  .then(async () => {
    logger.info('All models synced with PostgreSQL');

    // Seed default admin user if not exists
    try {
      const adminEmail = 'admin@gmail.com';
      const existingAdmin = await Employee.findOne({ where: { email: adminEmail } });
      if (!existingAdmin) {
        const salt = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash('password', salt);
        await Employee.create({
          fullName: 'Admin User',
          email: adminEmail,
          phone: '1234567890',
          department: null,
          designation: 'CTO',
          password: hashedPassword,
          role: 'admin'
        });
        logger.info(`Seeded default admin user: ${adminEmail}`);
      } else if (existingAdmin.department !== null) {
        await existingAdmin.update({ department: null });
        logger.info(`Updated existing admin user department to null`);
      }
    } catch (seedErr) {
      logger.error('Failed to seed default admin user:', seedErr);
    }

    // Initialize Redis connection at startup
    getRedisClient();

    server.listen(PORT, () => {
      logger.info(`Server is running on port ${PORT}`);
    });
  })
  .catch((error) => {
    logger.error('PostgreSQL connection error:', error);
    process.exit(1);
  });
