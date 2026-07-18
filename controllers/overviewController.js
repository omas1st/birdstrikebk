const Trade = require('../models/Trade');
const Setup = require('../models/Setup');
const Notification = require('../models/Notification');
const { sendEmail } = require('../services/emailService');

// Helper: create notification if not exists (using identifier)
const createNotificationIfNotExists = async (message, identifier) => {
  try {
    const exists = await Notification.findOne({ identifier });
    if (!exists) {
      const notif = new Notification({ message, identifier });
      await notif.save();
      // Send email
      await sendEmail('BIRDSTRIKEFX Journal Alert', message);
    }
  } catch (err) {
    console.error('Notification creation error:', err);
  }
};

exports.getOverview = async (req, res) => {
  try {
    const { startDate, endDate, topN = 3 } = req.query;
    const filter = {};
    if (startDate || endDate) {
      filter.date = {};
      if (startDate) filter.date.$gte = new Date(startDate);
      if (endDate) filter.date.$lte = new Date(endDate);
    }

    const trades = await Trade.find(filter).sort({ date: 1 });
    const totalTrades = trades.length;
    const totalWins = trades.filter((t) => t.outcome === 'win').length;
    const totalLosses = trades.filter((t) => t.outcome === 'loss').length;
    const winRate = totalTrades ? ((totalWins / totalTrades) * 100).toFixed(2) : 0;
    const lossRate = totalTrades ? ((totalLosses / totalTrades) * 100).toFixed(2) : 0;

    // ---- Section 2: Top pairs with most wins ----
    const topPairsWins = await Trade.aggregate([
      { $match: { ...filter, outcome: 'win' } },
      { $group: { _id: '$pair', wins: { $sum: 1 } } },
      { $sort: { wins: -1 } },
      { $limit: Number(topN) },
      { $project: { pair: '$_id', wins: 1, _id: 0 } },
    ]);

    // ---- Section 3: Top strategies with most wins ----
    const topStrategiesWins = await Trade.aggregate([
      { $match: { ...filter, outcome: 'win' } },
      { $group: { _id: '$strategy', wins: { $sum: 1 } } },
      { $sort: { wins: -1 } },
      { $limit: Number(topN) },
      { $project: { strategy: '$_id', wins: 1, _id: 0 } },
    ]);

    // ---- Section 4: Top pairs with most losses ----
    const topPairsLosses = await Trade.aggregate([
      { $match: { ...filter, outcome: 'loss' } },
      { $group: { _id: '$pair', losses: { $sum: 1 } } },
      { $sort: { losses: -1 } },
      { $limit: Number(topN) },
      { $project: { pair: '$_id', losses: 1, _id: 0 } },
    ]);

    // ---- Section 5: Top strategies with most losses ----
    const topStrategiesLosses = await Trade.aggregate([
      { $match: { ...filter, outcome: 'loss' } },
      { $group: { _id: '$strategy', losses: { $sum: 1 } } },
      { $sort: { losses: -1 } },
      { $limit: Number(topN) },
      { $project: { strategy: '$_id', losses: 1, _id: 0 } },
    ]);

    // ---- Section 6: Consecutive wins/losses per setup ----
    // Group trades by pair+strategy, sorted by date, check sequences
    const setupTrades = {};
    trades.forEach((t) => {
      const key = `${t.pair}||${t.strategy}`;
      if (!setupTrades[key]) setupTrades[key] = [];
      setupTrades[key].push(t.outcome);
    });

    let consecutiveWinsSetups = [];
    let consecutiveLossesSetups = [];

    for (const [key, outcomes] of Object.entries(setupTrades)) {
      let winStreak = 0,
        lossStreak = 0;
      let maxWinStreak = 0,
        maxLossStreak = 0;
      for (const outcome of outcomes) {
        if (outcome === 'win') {
          winStreak++;
          lossStreak = 0;
        } else {
          lossStreak++;
          winStreak = 0;
        }
        maxWinStreak = Math.max(maxWinStreak, winStreak);
        maxLossStreak = Math.max(maxLossStreak, lossStreak);
      }
      const [pair, strategy] = key.split('||');
      if (maxWinStreak >= 3) {
        consecutiveWinsSetups.push({ pair, strategy });
      }
      if (maxLossStreak >= 3) {
        consecutiveLossesSetups.push({ pair, strategy });
        // Flag the setup as failed and send notification
        await Setup.findOneAndUpdate(
          { pair, strategy, isActive: true },
          { isActive: false, flaggedAt: new Date() }
        );
        const message = `Setup ${pair} + ${strategy} has been flagged as failed (3 consecutive losses) and removed from active setups.`;
        await createNotificationIfNotExists(
          message,
          `failed_${pair}_${strategy}`
        );
      }
    }

    // ---- Section 7a: Most wins year, month, week, day ----
    const getMostWinsByPeriod = async (periodFormat, periodType) => {
      const agg = await Trade.aggregate([
        { $match: { ...filter, outcome: 'win' } },
        {
          $group: {
            _id: { $dateToString: { format: periodFormat, date: '$date' } },
            wins: { $sum: 1 },
          },
        },
        { $sort: { wins: -1 } },
        { $limit: 1 },
        { $project: { value: '$_id', wins: 1, _id: 0 } },
      ]);
      return agg.length ? agg[0] : { value: 'N/A', wins: 0 };
    };

    const mostWinsYear = await getMostWinsByPeriod('%Y', 'year');
    const mostWinsMonth = await getMostWinsByPeriod('%Y-%m', 'month');
    const mostWinsWeek = await getMostWinsByPeriod('%G-%V', 'week'); // ISO week
    const mostWinsDay = await getMostWinsByPeriod('%Y-%m-%d', 'day');

    // ---- Section 7b: Most losses by period ----
    const getMostLossesByPeriod = async (periodFormat) => {
      const agg = await Trade.aggregate([
        { $match: { ...filter, outcome: 'loss' } },
        {
          $group: {
            _id: { $dateToString: { format: periodFormat, date: '$date' } },
            losses: { $sum: 1 },
          },
        },
        { $sort: { losses: -1 } },
        { $limit: 1 },
        { $project: { value: '$_id', losses: 1, _id: 0 } },
      ]);
      return agg.length ? agg[0] : { value: 'N/A', losses: 0 };
    };

    const mostLossesYear = await getMostLossesByPeriod('%Y');
    const mostLossesMonth = await getMostLossesByPeriod('%Y-%m');
    const mostLossesWeek = await getMostLossesByPeriod('%G-%V');
    const mostLossesDay = await getMostLossesByPeriod('%Y-%m-%d');

    // ---- Section 8: Most/least traded pairs ----
    const tradeCountByPair = await Trade.aggregate([
      { $match: filter },
      { $group: { _id: '$pair', count: { $sum: 1 } } },
      { $sort: { count: -1 } },
    ]);

    const mostTradedPairs = tradeCountByPair.slice(0, Number(topN)).map((e) => ({ pair: e._id, count: e.count }));
    const leastTradedPairs = tradeCountByPair
      .slice(-Number(topN))
      .reverse()
      .map((e) => ({ pair: e._id, count: e.count }));

    // ---- Section 9: Most/least traded strategies ----
    const tradeCountByStrategy = await Trade.aggregate([
      { $match: filter },
      { $group: { _id: '$strategy', count: { $sum: 1 } } },
      { $sort: { count: -1 } },
    ]);

    const mostTradedStrategies = tradeCountByStrategy
      .slice(0, Number(topN))
      .map((e) => ({ strategy: e._id, count: e.count }));
    const leastTradedStrategies = tradeCountByStrategy
      .slice(-Number(topN))
      .reverse()
      .map((e) => ({ strategy: e._id, count: e.count }));

    // ---- Send notification for hot winning setups ----
    for (const s of consecutiveWinsSetups) {
      const message = `Hot Setup Alert: ${s.pair} + ${s.strategy} has achieved 3 consecutive wins!`;
      await createNotificationIfNotExists(message, `hot_${s.pair}_${s.strategy}`);
    }

    res.json({
      trades,
      topPairsWins,
      topStrategiesWins,
      topPairsLosses,
      topStrategiesLosses,
      consecutiveWins: consecutiveWinsSetups,
      consecutiveLosses: consecutiveLossesSetups,
      mostWinsYear,
      mostWinsMonth,
      mostWinsWeek,
      mostWinsDay,
      mostLossesYear,
      mostLossesMonth,
      mostLossesWeek,
      mostLossesDay,
      mostTradedPairs,
      leastTradedPairs,
      mostTradedStrategies,
      leastTradedStrategies,
      totalTrades,
      totalWins,
      totalLosses,
      winRate,
      lossRate,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
};