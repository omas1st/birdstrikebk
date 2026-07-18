const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
require('dotenv').config();

const setupRoutes = require('./routes/setupRoutes');
const tradeRoutes = require('./routes/tradeRoutes');
const overviewRoutes = require('./routes/overviewRoutes');
const finalAnalysisRoutes = require('./routes/finalAnalysisRoutes');
const notificationRoutes = require('./routes/notificationRoutes');

const app = express();
const PORT = process.env.PORT || 5000;

// Middleware
app.use(cors());
app.use(express.json());

// Health check
app.get('/', (req, res) => {
  res.send('BIRDSTRIKEFX JOURNAL Backend is running');
});

// API info (to avoid "Cannot GET /api")
app.get('/api', (req, res) => {
  res.json({
    message: 'BIRDSTRIKEFX API',
    endpoints: {
      setups: '/api/setups',
      trades: '/api/trades',
      overview: '/api/overview',
      finalAnalysis: '/api/final-analysis',
      notifications: '/api/notifications',
    },
  });
});

// Routes
app.use('/api/setups', setupRoutes);
app.use('/api/trades', tradeRoutes);
app.use('/api/overview', overviewRoutes);
app.use('/api/final-analysis', finalAnalysisRoutes);
app.use('/api/notifications', notificationRoutes);

// MongoDB connection
mongoose
  .connect(process.env.MONGO_URI)
  .then(() => {
    console.log('MongoDB connected');
    app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
  })
  .catch((err) => console.error('MongoDB connection error:', err));