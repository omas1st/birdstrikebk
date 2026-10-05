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

    // ----- Two-tier consecutive-loss detection -----
    if (outcome === 'loss') {
      // Fetch last 3 trades for this pair+strategy, newest first
      const recentTrades = await Trade.find({ pair, strategy })
        .sort({ date: -1, createdAt: -1 })
        .limit(3);

      // Count consecutive losses from the top
      let consecutiveLosses = 0;
      for (const t of recentTrades) {
        if (t.outcome === 'loss') consecutiveLosses++;
        else break;
      }

      // Tier 2: 3 consecutive losses → hard failure (remove setup)
      if (consecutiveLosses >= 3) {
        const setup = await Setup.findOneAndUpdate(
          { pair, strategy, isActive: true },
          { isActive: false, onProbation: false, probationAt: null, flaggedAt: new Date() },
          { returnDocument: 'after' }
        );

        if (setup) {
          const message = `Setup ${pair} + ${strategy} has been flagged as failed (3 consecutive losses) and removed from active setups.`;
          await createNotificationIfNotExists(message, `failed_${pair}_${strategy}`);
        }
      }
      // Tier 1: exactly 2 consecutive losses → probation + warning
      else if (consecutiveLosses === 2) {
        // Anchor the identifier to the date of the older loss so we only notify
        // once per streak (and don't repeat on the 3rd loss).
        const anchorDate = new Date(recentTrades[1].date)
          .toISOString()
          .slice(0, 10);
        const identifier = `probation_${pair}_${strategy}_${anchorDate}`;

        const setup = await Setup.findOneAndUpdate(
          { pair, strategy, isActive: true },
          { onProbation: true, probationAt: new Date() },
          { returnDocument: 'after' }
        );

        if (setup) {
          const message = `⚠️ Warning: Setup ${pair} + ${strategy} is now ON PROBATION (2 consecutive losses). Reduce position size on the next trade and watch closely — a 3rd loss will remove the setup.`;
          await createNotificationIfNotExists(message, identifier);
        }
      }
    } else if (outcome === 'win') {
      // A win clears probation for this setup (if it was on probation)
      const clearedSetup = await Setup.findOneAndUpdate(
        { pair, strategy, isActive: true, onProbation: true },
        { onProbation: false, probationAt: null },
        { returnDocument: 'after' }
      );

      if (clearedSetup) {
        // Anchor identifier to the win's date so each recovery only fires once
        const winAnchorDate = new Date(date).toISOString().slice(0, 10);
        const identifier = `probation_cleared_${pair}_${strategy}_${winAnchorDate}`;
        const message = `✅ Good news: Setup ${pair} + ${strategy} has RECOVERED from probation. The 2-loss streak was broken with a win — you can trade it at normal size again.`;
        await createNotificationIfNotExists(message, identifier);
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

// UPDATE a trade by ID
exports.updateTrade = async (req, res) => {
  try {
    const { date, pair, strategy, outcome, reason, entered } = req.body;
    if (!date || !pair || !strategy || !outcome) {
      return res.status(400).json({ error: 'All fields are required' });
    }

    const trade = await Trade.findByIdAndUpdate(
      req.params.id,
      { date, pair, strategy, outcome, reason, entered },
      { returnDocument: 'after', runValidators: true }
    );

    if (!trade) {
      return res.status(404).json({ error: 'Trade not found' });
    }

    res.json({ message: 'Trade updated successfully', trade });
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