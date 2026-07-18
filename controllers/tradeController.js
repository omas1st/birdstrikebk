const Trade = require('../models/Trade');

// Record a trade
exports.recordTrade = async (req, res) => {
  try {
    const { date, pair, strategy, outcome } = req.body;
    if (!date || !pair || !strategy || !outcome) {
      return res.status(400).json({ error: 'All fields are required' });
    }

    const trade = new Trade({ date, pair, strategy, outcome });
    await trade.save();
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

    // Count distinct setups (pair+strategy) from trades (or active setups)
    const setupsCount = (await Trade.distinct('pair')).length; // simplified
    // To be more accurate, count unique pair+strategy combos:
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