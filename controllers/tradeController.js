const Trade = require('../models/Trade');
const Setup = require('../models/Setup');
const Notification = require('../models/Notification');
const { sendEmail } = require('../services/emailService');

// Helper to create a notification (only if not already exists)
const createNotificationIfNotExists = async (message, identifier) => {
  try {
    const exists = await Notification.findOne({ identifier });
    if (!exists) {
      const notif = new Notification({ message, identifier });
      await notif.save();
      await sendEmail('BIRDSTRIKEFX Journal Alert', message);
    }
  } catch (err) {
    console.error('Notification creation error:', err);
  }
};

// Record a trade
exports.recordTrade = async (req, res) => {
  try {
    const { date, pair, strategy, outcome, reason, entered } = req.body;
    if (!date || !pair || !strategy || !outcome) {
      return res.status(400).json({ error: 'All fields are required' });
    }

    const tradeData = { date, pair, strategy, outcome };
    if (reason !== undefined) tradeData.reason = reason;
    if (entered !== undefined) tradeData.entered = entered;

    const trade = new Trade(tradeData);
    await trade.save();

    // ----- Real-time consecutive-loss detection -----
    if (outcome === 'loss') {
      const recentTrades = await Trade.find({ pair, strategy })
        .sort({ date: -1 })
        .limit(3);

      if (recentTrades.length === 3 && recentTrades.every(t => t.outcome === 'loss')) {
        const setup = await Setup.findOneAndUpdate(
          { pair, strategy, isActive: true },
          { isActive: false, flaggedAt: new Date() },
          { new: true }
        );

        if (setup) {
          const message = `Setup ${pair} + ${strategy} has been flagged as failed (3 consecutive losses) and removed from active setups.`;
          await createNotificationIfNotExists(message, `failed_${pair}_${strategy}`);
        }
      }
    }
    // -------------------------------------------------

    res.status(201).json({ message: 'Trade successfully recorded', trade });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// Get trades with filters, sorting, limit, and stats
exports.getTrades = async (req, res) => {
  try {
    const {
      startDate,
      endDate,
      outcome,
      pair,
      strategy,
      sortBy,
      sortOrder,
      limit,
    } = req.query;

    const filter = {};
    if (startDate || endDate) {
      filter.date = {};
      if (startDate) filter.date.$gte = new Date(startDate);
      if (endDate) filter.date.$lte = new Date(endDate);
    }
    if (outcome) filter.outcome = outcome;
    if (pair) filter.pair = pair;
    if (strategy) filter.strategy = strategy;

    const sort = {};
    if (sortBy) {
      sort[sortBy] = sortOrder === 'desc' ? -1 : 1;
    }

    const query = Trade.find(filter).sort(sort);
    if (limit && limit !== '0') query.limit(Number(limit));

    const trades = await query;
    const totalTrades = await Trade.countDocuments(filter);
    const totalWins = await Trade.countDocuments({ ...filter, outcome: 'win' });
    const totalLosses = await Trade.countDocuments({ ...filter, outcome: 'loss' });
    const winRate = totalTrades ? ((totalWins / totalTrades) * 100).toFixed(2) : 0;
    const lossRate = totalTrades ? ((totalLosses / totalTrades) * 100).toFixed(2) : 0;

    const combos = await Trade.aggregate([
      { $match: filter },
      { $group: { _id: { pair: '$pair', strategy: '$strategy' } } },
      { $count: 'count' }
    ]);
    const distinctSetups = combos.length ? combos[0].count : 0;

    res.json({
      trades,
      totalTrades,
      totalWins,
      totalLosses,
      winRate,
      lossRate,
      setupsCount: distinctSetups,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// DELETE a trade by ID
exports.deleteTrade = async (req, res) => {
  try {
    const trade = await Trade.findByIdAndDelete(req.params.id);
    if (!trade) {
      return res.status(404).json({ error: 'Trade not found' });
    }
    res.json({ message: 'Trade deleted successfully' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};