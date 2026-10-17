const Setup = require('../models/Setup');
const Trade = require('../models/Trade');
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

exports.getFinalAnalysis = async (req, res) => {
  try {
    const now = new Date();

    // ---------- Fetch all trades once ----------
    const allTrades = await Trade.find().sort({ date: 1, createdAt: 1 }).lean();

    // Group trades by pair||strategy (chronological order)
    const tradesBySetup = {};
    allTrades.forEach((t) => {
      const key = `${t.pair}||${t.strategy}`;
      if (!tradesBySetup[key]) tradesBySetup[key] = [];
      tradesBySetup[key].push(t);
    });

    // Helper: compute win rate for a key
    const computeWinRate = (key) => {
      const list = tradesBySetup[key] || [];
      const total = list.length;
      const wins = list.filter((t) => t.outcome === 'win').length;
      return {
        total,
        wins,
        losses: total - wins,
        winRate: total ? ((wins / total) * 100).toFixed(2) : '0.00',
      };
    };

    // Helper: last N trades pattern ('w'/'l'), oldest → newest
    const computeLastPattern = (key, n = 10) => {
      const list = tradesBySetup[key] || [];
      const last = list.slice(-n);
      const pattern = last.map((t) => (t.outcome === 'win' ? 'w' : 'l')).join('');
      const wins = last.filter((t) => t.outcome === 'win').length;
      return {
        pattern: pattern || '—',
        wins,
        losses: last.length - wins,
        totalInWindow: last.length,
      };
    };

    // ---------- i. Flagged setups (isActive = false) ----------
    const flaggedSetupsRaw = await Setup.find({ isActive: false }).lean();

    const flaggedSetups = flaggedSetupsRaw
      .map((s) => {
        const daysSinceFail = s.flaggedAt
          ? Math.floor((now - new Date(s.flaggedAt)) / (1000 * 60 * 60 * 24))
          : null;
        return {
          _id: s._id,
          pair: s.pair,
          strategy: s.strategy,
          flaggedAt: s.flaggedAt || null,
          daysSinceFail,
          readyForRetry: daysSinceFail !== null && daysSinceFail >= 90,
        };
      })
      .sort((a, b) => {
        const da = a.flaggedAt ? new Date(a.flaggedAt).getTime() : 0;
        const db = b.flaggedAt ? new Date(b.flaggedAt).getTime() : 0;
        return db - da;
      });

    // 3-month revival notifications
    const currentMonthKey = `${now.getFullYear()}-${now.getMonth() + 1}`;
    for (const s of flaggedSetups) {
      if (s.readyForRetry) {
        const identifier = `revive_${s.pair}_${s.strategy}_${currentMonthKey}`;
        const message = `🔄 Revival Check: Setup ${s.pair} + ${s.strategy} has been failed for ${s.daysSinceFail} days (over 3 months). Consider testing it again — you can re-add it from the Setup Analysis page to check if it has recovered.`;
        await createNotificationIfNotExists(message, identifier);
      }
    }

    // ---------- ii. Probation setups ----------
    const probationSetupsRaw = await Setup.find({ isActive: true, onProbation: true }).lean();

    const probationSetups = probationSetupsRaw
      .map((s) => ({
        _id: s._id,
        pair: s.pair,
        strategy: s.strategy,
        probationAt: s.probationAt || null,
      }))
      .sort((a, b) => {
        const da = a.probationAt ? new Date(a.probationAt).getTime() : 0;
        const db = b.probationAt ? new Date(b.probationAt).getTime() : 0;
        return db - da;
      });

    // ---------- iii. Restored setups ----------
    const restoredSetups = flaggedSetupsRaw
      .filter((s) => s.restoredAt && s.flaggedAt)
      .map((s) => ({
        pair: s.pair,
        strategy: s.strategy,
        daysToRestore: Math.round(
          (new Date(s.restoredAt) - new Date(s.flaggedAt)) / (1000 * 60 * 60 * 24)
        ),
      }))
      .sort((a, b) => a.pair.localeCompare(b.pair) || a.strategy.localeCompare(b.strategy));

    // ---------- iv. Hot winning setups (3 consecutive wins) ----------
    const hotWinningSetups = [];
    for (const [key, list] of Object.entries(tradesBySetup)) {
      let maxStreak = 0;
      let currentStreak = 0;
      for (const t of list) {
        if (t.outcome === 'win') {
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
    hotWinningSetups.sort(
      (a, b) => a.pair.localeCompare(b.pair) || a.strategy.localeCompare(b.strategy)
    );

    // ---------- v. Current active setups, with win rate ----------
    const currentSetupsRaw = await Setup.find({ isActive: true }).lean();
    const currentSetups = currentSetupsRaw
      .map((s) => {
        const key = `${s.pair}||${s.strategy}`;
        const stats = computeWinRate(key);
        return {
          _id: s._id,
          pair: s.pair,
          strategy: s.strategy,
          onProbation: !!s.onProbation,
          total: stats.total,
          wins: stats.wins,
          losses: stats.losses,
          winRate: stats.winRate,
        };
      })
      .sort((a, b) => {
        const wr = parseFloat(b.winRate) - parseFloat(a.winRate);
        if (wr !== 0) return wr;
        return a.pair.localeCompare(b.pair) || a.strategy.localeCompare(b.strategy);
      });

    // ---------- NEW: vi. Stale setups (No trades in 100 days) ----------
    const staleSetups = [];
    for (const setup of currentSetupsRaw) {
      const key = `${setup.pair}||${setup.strategy}`;
      const list = tradesBySetup[key] || [];
      
      let daysSinceLastTrade = 0;
      let lastTradeDate = null;

      if (list.length > 0) {
        const lastTrade = list[list.length - 1]; // Since sorted by date ascending
        lastTradeDate = lastTrade.date;
        daysSinceLastTrade = Math.floor(
          (now - new Date(lastTrade.date)) / (1000 * 60 * 60 * 24)
        );
      } else {
        // No trades ever recorded for this setup, check time since creation
        daysSinceLastTrade = Math.floor(
          (now - new Date(setup.createdAt)) / (1000 * 60 * 60 * 24)
        );
      }

      if (daysSinceLastTrade >= 100) {
        staleSetups.push({
          _id: setup._id,
          pair: setup.pair,
          strategy: setup.strategy,
          daysSinceLastTrade,
          lastTradeDate,
        });
      }
    }
    // Sort by longest time without a trade first
    staleSetups.sort((a, b) => b.daysSinceLastTrade - a.daysSinceLastTrade);

    // ---------- vii. Advice ----------
    const advice = [];
    if (currentSetups.length < 3) {
      const msg = `Less than 3 active setups. Please add more setups to diversify.`;
      advice.push(msg);
      await createNotificationIfNotExists(msg, 'advice_few_setups');
    }

    const activeStrategies = [...new Set(currentSetups.map((s) => s.strategy))];
    if (activeStrategies.length < 2) {
      const msg2 = `Less than 2 unique strategies in active setups. Consider adding new strategies to support existing ones.`;
      advice.push(msg2);
      await createNotificationIfNotExists(msg2, 'advice_few_strategies');
    }

    // ---------- viii. Setup failure and restore durations ----------
    const setupDurations = flaggedSetupsRaw
      .map((s) => ({
        pair: s.pair,
        strategy: s.strategy,
        daysToFail:
          s.flaggedAt && s.createdAt
            ? Math.round(
                (new Date(s.flaggedAt) - new Date(s.createdAt)) / (1000 * 60 * 60 * 24)
              )
            : null,
        daysToRestore:
          s.restoredAt && s.flaggedAt
            ? Math.round(
                (new Date(s.restoredAt) - new Date(s.flaggedAt)) / (1000 * 60 * 60 * 24)
              )
            : null,
      }))
      .sort((a, b) => a.pair.localeCompare(b.pair) || a.strategy.localeCompare(b.strategy));

    // ---------- ix. Recent pattern for probation + failed setups ----------
    const recentPatternSetups = [];

    probationSetups.forEach((s) => {
      const key = `${s.pair}||${s.strategy}`;
      const pat = computeLastPattern(key);
      recentPatternSetups.push({
        pair: s.pair,
        strategy: s.strategy,
        status: 'Probation',
        pattern: pat.pattern,
        wins: pat.wins,
        losses: pat.losses,
        totalInWindow: pat.totalInWindow,
      });
    });

    flaggedSetups.forEach((s) => {
      const key = `${s.pair}||${s.strategy}`;
      const pat = computeLastPattern(key);
      recentPatternSetups.push({
        pair: s.pair,
        strategy: s.strategy,
        status: 'Failed',
        pattern: pat.pattern,
        wins: pat.wins,
        losses: pat.losses,
        totalInWindow: pat.totalInWindow,
      });
    });

    const statusRank = { Probation: 0, Failed: 1 };
    recentPatternSetups.sort((a, b) => {
      const sr = statusRank[a.status] - statusRank[b.status];
      if (sr !== 0) return sr;
      return a.pair.localeCompare(b.pair) || a.strategy.localeCompare(b.strategy);
    });

    res.json({
      flaggedSetups,
      probationSetups,
      restoredSetups,
      hotWinningSetups,
      currentSetups,
      staleSetups, // Return new stale setups
      advice,
      strategyAdvice: activeStrategies.length < 2 ? advice[1] : '',
      setupDurations,
      recentPatternSetups,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
};