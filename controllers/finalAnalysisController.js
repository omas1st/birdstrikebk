const Setup = require('../models/Setup');
const Trade = require('../models/Trade');
const Notification = require('../models/Notification');
const { sendEmail } = require('../services/emailService');

exports.getFinalAnalysis = async (req, res) => {
  try {
    // i. Flagged setups (isActive = false)
    const flaggedSetups = await Setup.find({ isActive: false }).lean();

    // ii. Restored setups (those with restoredAt)
    const restoredSetups = flaggedSetups
      .filter((s) => s.restoredAt)
      .map((s) => ({
        pair: s.pair,
        strategy: s.strategy,
        daysToRestore: Math.round(
          (s.restoredAt - s.flaggedAt) / (1000 * 60 * 60 * 24)
        ),
      }));

    // iii. Hot winning setups: setups that have 3 consecutive wins (any time)
    const allTrades = await Trade.find().sort({ date: 1 });
    const setupMap = {};
    allTrades.forEach((t) => {
      const key = `${t.pair}||${t.strategy}`;
      if (!setupMap[key]) setupMap[key] = [];
      setupMap[key].push(t.outcome);
    });
    const hotWinningSetups = [];
    for (const [key, outcomes] of Object.entries(setupMap)) {
      let maxStreak = 0,
        currentStreak = 0;
      for (const o of outcomes) {
        if (o === 'win') {
          currentStreak++;
          maxStreak = Math.max(maxStreak, currentStreak);
        } else {
          currentStreak = 0;
        }
      }
      if (maxStreak >= 3) {
        const [pair, strategy] = key.split('||');
        hotWinningSetups.push({ pair, strategy });
      }
    }

    // iv. Current active setups
    const currentSetups = await Setup.find({ isActive: true }).lean();

    // v. Advice: less than 3 active setups
    const advice = [];
    if (currentSetups.length < 3) {
      const msg = `Less than 3 active setups. Please add more setups to diversify.`;
      advice.push(msg);
      await createNotificationIfNotExists(msg, 'advice_few_setups');
    }

    // vi. Track working strategies: distinct strategies among active setups
    const activeStrategies = [...new Set(currentSetups.map((s) => s.strategy))];
    if (activeStrategies.length < 2) {
      const msg2 = `Less than 2 unique strategies in active setups. Consider adding new strategies to support existing ones.`;
      advice.push(msg2);
      await createNotificationIfNotExists(msg2, 'advice_few_strategies');
    }

    // vii. Setup failure and restore durations
    const setupDurations = flaggedSetups.map((s) => ({
      pair: s.pair,
      strategy: s.strategy,
      daysToFail: s.flaggedAt
        ? Math.round((s.flaggedAt - s.createdAt) / (1000 * 60 * 60 * 24))
        : null,
      daysToRestore: s.restoredAt
        ? Math.round((s.restoredAt - s.flaggedAt) / (1000 * 60 * 60 * 24))
        : null,
    }));

    res.json({
      flaggedSetups,
      restoredSetups,
      hotWinningSetups,
      currentSetups,
      advice,
      strategyAdvice: activeStrategies.length < 2 ? advice[1] : '',
      setupDurations,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// Helper (duplicated for convenience)
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